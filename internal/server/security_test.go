package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nhooyr.io/websocket"

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

func TestLocalRequestGuardRejectsCrossOriginAPI(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "localhost:7788"
	request.Header.Set("Origin", "http://evil.test")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestLocalRequestGuardRejectsFetchSiteCrossSiteWithoutOrigin(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "localhost:7788"
	request.Header.Set("Sec-Fetch-Site", "cross-site")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for Sec-Fetch-Site cross-site, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestLocalRequestGuardRequiresTokenForFetchSiteBrowserAPI(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)

	missing := httptest.NewRecorder()
	missingReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	missingReq.Host = "localhost:7788"
	missingReq.Header.Set("Sec-Fetch-Site", "same-origin")
	app.Routes().ServeHTTP(missing, missingReq)
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token for Sec-Fetch-Site browser request, got %d: %s", missing.Code, missing.Body.String())
	}

	ok := httptest.NewRecorder()
	okReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	okReq.Host = "localhost:7788"
	okReq.Header.Set("Sec-Fetch-Site", "same-origin")
	okReq.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(ok, okReq)
	if ok.Code != http.StatusOK {
		t.Fatalf("expected 200 with token for Sec-Fetch-Site browser request, got %d: %s", ok.Code, ok.Body.String())
	}
}

func TestLocalRequestGuardRequiresTokenForBrowserAPI(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)

	missing := httptest.NewRecorder()
	missingReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	missingReq.Header.Set("Origin", "http://localhost:7788")
	missingReq.Host = "localhost:7788"
	app.Routes().ServeHTTP(missing, missingReq)
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d: %s", missing.Code, missing.Body.String())
	}

	ok := httptest.NewRecorder()
	okReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	okReq.Header.Set("Origin", "http://localhost:7788")
	okReq.Header.Set(localTokenHeader, app.localToken)
	okReq.Host = "localhost:7788"
	app.Routes().ServeHTTP(ok, okReq)
	if ok.Code != http.StatusOK {
		t.Fatalf("expected 200 with token, got %d: %s", ok.Code, ok.Body.String())
	}
}

func TestLocalRequestGuardAllowsNonBrowserLocalAPI(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "localhost:7788"

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 for non-browser local request, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestIndexInjectsLocalToken(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "localhost:7788"

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "window.CODEHARBOR_LOCAL_TOKEN=") || !strings.Contains(recorder.Body.String(), app.localToken) {
		t.Fatalf("expected local token injection in index")
	}
	if cookie := recorder.Result().Cookies(); len(cookie) == 0 {
		t.Fatal("expected local token cookie")
	}
}

func TestWebSocketRejectsBadOriginAndMissingToken(t *testing.T) {
	app := New(config.Config{}, nil, nil, agent.NewHub())
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/narrator?id=n1"

	ctx := t.Context()
	_, _, err := websocket.Dial(ctx, wsURL+"&token="+app.localToken, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://evil.test"}}})
	if err == nil {
		t.Fatal("expected bad origin websocket dial to fail")
	}

	_, _, err = websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{server.URL}}})
	if err == nil {
		t.Fatal("expected missing token websocket dial to fail")
	}
}

func TestRemoteAccessGateRendersLoginPageForRemoteIndex(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "demo.trycloudflare.com"
	request.Header.Set("Accept", "text/html")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 login page, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "CODEHARBOR_ACCESS_PASSWORD") {
		t.Fatalf("expected password configuration guidance, got %s", recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "window.CODEHARBOR_LOCAL_TOKEN=") {
		t.Fatal("remote login page must not leak local token")
	}
}

func TestRemoteAccessGateAllowsRemoteRequestAfterPasswordLogin(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)

	login := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=secret"))
	loginReq.Host = "demo.trycloudflare.com"
	loginReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	app.Routes().ServeHTTP(login, loginReq)
	if login.Code != http.StatusSeeOther {
		t.Fatalf("expected login redirect, got %d: %s", login.Code, login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected remote access cookie")
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "demo.trycloudflare.com"
	request.Header.Set("Origin", "http://demo.trycloudflare.com")
	request.Header.Set(localTokenHeader, app.localToken)
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 after remote login, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessGateAllowsBearerPasswordForAPI(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "demo.trycloudflare.com"
	request.Header.Set("Authorization", "Bearer secret")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 with bearer password, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessGateDetectsForwardedRemoteHost(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "localhost:7788"
	request.Header.Set("X-Forwarded-Host", "demo.trycloudflare.com")
	request.Header.Set("Accept", "text/html")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 forwarded remote login page, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "window.CODEHARBOR_LOCAL_TOKEN=") {
		t.Fatal("forwarded remote page must not leak local token")
	}
}

func TestRemoteAccessGateUsesForwardedHostForSameOrigin(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "localhost:7788"
	request.Header.Set("X-Forwarded-Host", "demo.trycloudflare.com")
	request.Header.Set("Origin", "https://demo.trycloudflare.com")
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set(localTokenHeader, app.localToken)

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 with forwarded same-origin host, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessGateUsesStandardForwardedHostForSameOrigin(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Host = "localhost:7788"
	request.Header.Set("Forwarded", `for=203.0.113.7;host="demo.trycloudflare.com";proto=https`)
	request.Header.Set("Origin", "https://demo.trycloudflare.com")
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set(localTokenHeader, app.localToken)

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 with standard Forwarded host, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func postRemoteAccessPassword(app *Server, remoteAddr string, password string, headers http.Header) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password="+password))
	request.Host = "demo.trycloudflare.com"
	if remoteAddr != "" {
		request.RemoteAddr = remoteAddr
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for name, values := range headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	app.Routes().ServeHTTP(recorder, request)
	return recorder
}

func postRemoteAccessLogout(app *Server, remoteAddr string, headers http.Header) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/auth/remote-access/logout", nil)
	request.Host = "demo.trycloudflare.com"
	if remoteAddr != "" {
		request.RemoteAddr = remoteAddr
	}
	for name, values := range headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	app.Routes().ServeHTTP(recorder, request)
	return recorder
}

func TestRemoteAccessLoginLocksAfterTenBadPasswords(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	for i := 0; i < remoteAccessMaxFailures; i++ {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=wrong"))
		request.Host = "demo.trycloudflare.com"
		request.RemoteAddr = "203.0.113.10:5555"
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		app.Routes().ServeHTTP(recorder, request)
		if i < remoteAccessMaxFailures-1 && recorder.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d expected 401, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
		if i == remoteAccessMaxFailures-1 && recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("attempt %d expected 429, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=secret"))
	request.Host = "demo.trycloudflare.com"
	request.RemoteAddr = "203.0.113.10:5555"
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected locked correct password to remain 429, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessLockoutUsesForwardedClientIPFromLocalProxy(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	a := http.Header{"CF-Connecting-IP": []string{"203.0.113.21"}}
	b := http.Header{"CF-Connecting-IP": []string{"203.0.113.22"}}

	for i := 0; i < remoteAccessMaxFailures; i++ {
		recorder := postRemoteAccessPassword(app, "127.0.0.1:5555", "wrong", a)
		if i < remoteAccessMaxFailures-1 && recorder.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d expected 401, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
		if i == remoteAccessMaxFailures-1 && recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("attempt %d expected 429, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}

	recorder := postRemoteAccessPassword(app, "127.0.0.1:5555", "secret", b)
	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("expected different forwarded client to avoid shared tunnel lock, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessLockoutIgnoresForgedForwardedForFromDirectRemote(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	forgedForwardedFor := []string{
		"198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4", "198.51.100.5",
		"198.51.100.6", "198.51.100.7", "198.51.100.8", "198.51.100.9", "198.51.100.10",
	}
	if len(forgedForwardedFor) < remoteAccessMaxFailures {
		t.Fatalf("test needs at least %d forged client IPs", remoteAccessMaxFailures)
	}
	for i := 0; i < remoteAccessMaxFailures; i++ {
		recorder := postRemoteAccessPassword(app, "203.0.113.23:5555", "wrong", http.Header{"X-Forwarded-For": []string{forgedForwardedFor[i]}})
		if i < remoteAccessMaxFailures-1 && recorder.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d expected 401, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
		if i == remoteAccessMaxFailures-1 && recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("attempt %d expected 429 despite changing forged XFF, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}
}

func TestRemoteAccessLockoutExpires(t *testing.T) {
	current := time.Date(2026, 7, 8, 12, 0, 0, 0, time.UTC)
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	app.clock = func() time.Time { return current }

	for i := 0; i < remoteAccessMaxFailures; i++ {
		postRemoteAccessPassword(app, "203.0.113.24:5555", "wrong", nil)
	}
	locked := postRemoteAccessPassword(app, "203.0.113.24:5555", "secret", nil)
	if locked.Code != http.StatusTooManyRequests {
		t.Fatalf("expected correct password to be locked before expiry, got %d: %s", locked.Code, locked.Body.String())
	}

	current = current.Add(remoteAccessLockDuration + time.Second)
	unlocked := postRemoteAccessPassword(app, "203.0.113.24:5555", "secret", nil)
	if unlocked.Code != http.StatusSeeOther {
		t.Fatalf("expected lockout to expire, got %d: %s", unlocked.Code, unlocked.Body.String())
	}
}

func TestRemoteAccessFailureWindowResetsCount(t *testing.T) {
	current := time.Date(2026, 7, 8, 12, 0, 0, 0, time.UTC)
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	app.clock = func() time.Time { return current }

	for i := 0; i < remoteAccessMaxFailures-1; i++ {
		recorder := postRemoteAccessPassword(app, "203.0.113.25:5555", "wrong", nil)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("initial attempt %d expected 401, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}
	current = current.Add(remoteAccessFailureWindow + time.Second)
	recorder := postRemoteAccessPassword(app, "203.0.113.25:5555", "wrong", nil)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected first attempt after window reset to stay 401, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestRemoteAccessLogoutOnlyClearsFailuresWhenAuthenticated(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	for i := 0; i < remoteAccessMaxFailures; i++ {
		postRemoteAccessPassword(app, "203.0.113.26:5555", "wrong", nil)
	}

	unauthLogout := postRemoteAccessLogout(app, "203.0.113.26:5555", http.Header{"Accept": []string{"application/json"}})
	if unauthLogout.Code != http.StatusOK {
		t.Fatalf("expected unauthenticated logout to still clear cookie, got %d: %s", unauthLogout.Code, unauthLogout.Body.String())
	}
	stillLocked := postRemoteAccessPassword(app, "203.0.113.26:5555", "secret", nil)
	if stillLocked.Code != http.StatusTooManyRequests {
		t.Fatalf("expected unauthenticated logout not to clear failure lock, got %d: %s", stillLocked.Code, stillLocked.Body.String())
	}

	authLogout := postRemoteAccessLogout(app, "203.0.113.26:5555", http.Header{"Authorization": []string{"Bearer secret"}, "Accept": []string{"application/json"}})
	if authLogout.Code != http.StatusOK {
		t.Fatalf("expected authenticated logout, got %d: %s", authLogout.Code, authLogout.Body.String())
	}
	unlocked := postRemoteAccessPassword(app, "203.0.113.26:5555", "secret", nil)
	if unlocked.Code != http.StatusSeeOther {
		t.Fatalf("expected authenticated logout to clear failure lock, got %d: %s", unlocked.Code, unlocked.Body.String())
	}
}

func TestRemoteAccessLoginSuccessClearsBadPasswordCount(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	for i := 0; i < remoteAccessMaxFailures-1; i++ {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=wrong"))
		request.Host = "demo.trycloudflare.com"
		request.RemoteAddr = "203.0.113.11:5555"
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		app.Routes().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d expected 401, got %d: %s", i+1, recorder.Code, recorder.Body.String())
		}
	}

	success := httptest.NewRecorder()
	successReq := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=secret"))
	successReq.Host = "demo.trycloudflare.com"
	successReq.RemoteAddr = "203.0.113.11:5555"
	successReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	app.Routes().ServeHTTP(success, successReq)
	if success.Code != http.StatusSeeOther {
		t.Fatalf("expected successful login after bad attempts, got %d: %s", success.Code, success.Body.String())
	}

	badAgain := httptest.NewRecorder()
	badAgainReq := httptest.NewRequest(http.MethodPost, "/auth/remote-access", strings.NewReader("password=wrong"))
	badAgainReq.Host = "demo.trycloudflare.com"
	badAgainReq.RemoteAddr = "203.0.113.11:5555"
	badAgainReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	app.Routes().ServeHTTP(badAgain, badAgainReq)
	if badAgain.Code != http.StatusUnauthorized || !strings.Contains(badAgain.Body.String(), "密码不正确") {
		t.Fatalf("expected counter reset after success, got %d: %s", badAgain.Code, badAgain.Body.String())
	}
	if strings.Contains(badAgain.Body.String(), "剩余") {
		t.Fatalf("expected login failure page not to reveal remaining attempts, got %s", badAgain.Body.String())
	}
}

func TestRemoteAccessLogoutClearsCookie(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/auth/remote-access/logout", nil)
	request.Host = "demo.trycloudflare.com"
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("Accept", "application/json")

	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 logout, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var found bool
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == remoteAccessCookieName {
			found = true
			if cookie.MaxAge >= 0 || cookie.Value != "" {
				t.Fatalf("expected clearing cookie, got %+v", cookie)
			}
		}
	}
	if !found {
		t.Fatal("expected clearing remote access cookie")
	}
}

func TestRemoteHardeningRejectsTerminalWebSocketByDefault(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Security: config.SecurityConfig{Exposed: true, AccessPassword: "secret"}}, store, nil, nil)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal?narratorId=" + narrator.ID + "&token=" + app.localToken

	_, _, err = websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer secret"}}})
	if err == nil {
		t.Fatal("expected remote terminal websocket to be rejected by default")
	}
}

func TestRemoteHardeningRejectsBypassPermissionMode(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{Security: config.SecurityConfig{Exposed: true, AccessPassword: "secret"}}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/narrators/"+narrator.ID+"/permission-mode", strings.NewReader(`{"permissionMode":"bypassPermissions"}`))
	request.Host = "localhost:7788"
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "bypassPermissions is disabled") {
		t.Fatalf("expected bypass disabled error, got %s", recorder.Body.String())
	}
}

func TestRemoteHardeningClampsDefaultBypassForNewProject(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectDir := filepath.Join(t.TempDir(), "project")
	cfg := config.Config{
		Paths:    config.PathsConfig{DefaultProjectDir: t.TempDir()},
		Agent:    config.AgentConfig{DefaultModel: "fake:test", DefaultPermissionMode: "bypassPermissions"},
		Security: config.SecurityConfig{Exposed: true, AccessPassword: "secret"},
	}
	app := New(cfg, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/projects", strings.NewReader(`{"name":"Demo","gitPath":"`+projectDir+`"}`))
	request.Host = "localhost:7788"
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Narrator db.Narrator `json:"narrator"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Narrator.PermissionMode != "acceptEdits" {
		t.Fatalf("expected acceptEdits cap, got %q", body.Narrator.PermissionMode)
	}
}
