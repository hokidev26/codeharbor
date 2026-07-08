package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

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
