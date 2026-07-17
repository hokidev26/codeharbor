package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
)

func remoteSecurityRegressionServer(t *testing.T, mode string) *Server {
	t.Helper()
	hash, err := config.HashAccessPassword("Correct-Horse-1!")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Security: config.SecurityConfig{
		AccessPasswordHash:      hash,
		AllowRemoteFullAccess:   mode == remoteAccessModeFull,
		DefaultRemoteAccessMode: mode,
		CredentialRevision:      1,
	}}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	app := New(cfg, nil, nil, nil)
	app.SetConfigPath(path)
	return app
}

func remoteSecurityRegressionLogin(t *testing.T, app *Server, clientMode string) []*http.Cookie {
	t.Helper()
	req := newTestRequest(http.MethodPost, remoteAccessPath, strings.NewReader("password=Correct-Horse-1!&mode="+clientMode))
	req.Host = "remote.example.test"
	markRemoteHTTPS(req)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res := httptest.NewRecorder()
	app.Routes().ServeHTTP(res, req)
	if res.Code != http.StatusSeeOther {
		t.Fatalf("remote login returned %d: %s", res.Code, res.Body.String())
	}
	return res.Result().Cookies()
}

func addRemoteSecurityRegressionCookies(req *http.Request, cookies []*http.Cookie) {
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
}

func TestRemoteSecurityRegressionHostPolicyOverridesClientMode(t *testing.T) {
	tests := []struct {
		name       string
		hostMode   string
		clientMode string
		permission string
		filesystem string
	}{
		{name: "restricted host ignores client full", hostMode: remoteAccessModeRestricted, clientMode: remoteAccessModeFull, permission: "acceptEdits", filesystem: "project"},
		{name: "full host ignores client restricted", hostMode: remoteAccessModeFull, clientMode: remoteAccessModeRestricted, permission: "bypassPermissions", filesystem: "host"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := remoteSecurityRegressionServer(t, tt.hostMode)
			cookies := remoteSecurityRegressionLogin(t, app, tt.clientMode)

			req := newTestRequest(http.MethodGet, "/api/security/remote-access", nil)
			req.Host = "remote.example.test"
			markRemoteHTTPS(req)
			addRemoteSecurityRegressionCookies(req, cookies)
			res := httptest.NewRecorder()
			app.Routes().ServeHTTP(res, req)
			if res.Code != http.StatusOK {
				t.Fatalf("remote settings returned %d: %s", res.Code, res.Body.String())
			}
			var body struct {
				Session struct {
					Mode string `json:"mode"`
				} `json:"session"`
				Capabilities struct {
					MaxPermissionMode string `json:"maxPermissionMode"`
					FilesystemScope   string `json:"filesystemScope"`
				} `json:"capabilities"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Session.Mode != tt.hostMode || body.Capabilities.MaxPermissionMode != tt.permission || body.Capabilities.FilesystemScope != tt.filesystem {
				t.Fatalf("client mode %q changed host policy %q: %+v", tt.clientMode, tt.hostMode, body)
			}
		})
	}
}

func TestRemoteSecurityRegressionFullSessionCannotMutatePolicyOrPassword(t *testing.T) {
	app := remoteSecurityRegressionServer(t, remoteAccessModeFull)
	cookies := remoteSecurityRegressionLogin(t, app, remoteAccessModeRestricted)
	beforeConfig := app.configSnapshot().Security
	beforeDisk, err := os.ReadFile(app.configPathSnapshot())
	if err != nil {
		t.Fatal(err)
	}

	policy := newTestRequest(http.MethodPatch, "/api/security/remote-access/policy", strings.NewReader(`{"allowFullAccess":false,"defaultMode":"restricted","allowRemoteNativePicker":false,"revision":1}`))
	policy.Host = "remote.example.test"
	markRemoteHTTPS(policy)
	policy.Header.Set("Content-Type", "application/json")
	policy.Header.Set(localTokenHeader, app.localToken)
	addRemoteSecurityRegressionCookies(policy, cookies)
	policyRes := httptest.NewRecorder()
	app.Routes().ServeHTTP(policyRes, policy)
	if policyRes.Code != http.StatusForbidden || !strings.Contains(policyRes.Body.String(), "localhost") {
		t.Fatalf("full remote session changed policy or received wrong denial: %d %s", policyRes.Code, policyRes.Body.String())
	}

	password := newTestRequest(http.MethodPut, "/api/security/remote-access/password", strings.NewReader(`{"strategy":"custom","password":"New-Remote-Password-2!"}`))
	password.Host = "remote.example.test"
	markRemoteHTTPS(password)
	password.Header.Set("Content-Type", "application/json")
	password.Header.Set(localTokenHeader, app.localToken)
	addRemoteSecurityRegressionCookies(password, cookies)
	passwordRes := httptest.NewRecorder()
	app.Routes().ServeHTTP(passwordRes, password)
	if passwordRes.Code != http.StatusForbidden || !strings.Contains(passwordRes.Body.String(), "localhost") {
		t.Fatalf("full remote session changed password or received wrong denial: %d %s", passwordRes.Code, passwordRes.Body.String())
	}

	afterConfig := app.configSnapshot().Security
	afterDisk, err := os.ReadFile(app.configPathSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	if afterConfig != beforeConfig || string(afterDisk) != string(beforeDisk) {
		t.Fatalf("rejected remote security mutations changed configuration: before=%+v after=%+v", beforeConfig, afterConfig)
	}
}

func TestRemoteSecurityRegressionForwardedOriginTrustedOnlyFromLoopbackProxy(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	headers := []struct {
		name  string
		key   string
		value string
	}{
		{name: "X-Forwarded-Host", key: "X-Forwarded-Host", value: "demo.trycloudflare.com"},
		{name: "Forwarded", key: "Forwarded", value: `for=203.0.113.7;host="demo.trycloudflare.com";proto=https`},
	}

	for _, header := range headers {
		t.Run(header.name, func(t *testing.T) {
			for _, peer := range []struct {
				name string
				addr string
				want int
			}{
				{name: "direct remote peer cannot forge origin host", addr: "203.0.113.70:4444", want: http.StatusForbidden},
				{name: "loopback proxy may forward origin host", addr: "127.0.0.1:4444", want: http.StatusOK},
			} {
				t.Run(peer.name, func(t *testing.T) {
					req := newTestRequest(http.MethodGet, "/api/health", nil)
					req.Host = "localhost:7788"
					req.RemoteAddr = peer.addr
					req.Header.Set(header.key, header.value)
					if header.key == "X-Forwarded-Host" {
						req.Header.Set("X-Forwarded-Proto", "https")
					}
					req.Header.Set("Origin", "https://demo.trycloudflare.com")
					req.Header.Set("Authorization", "Bearer secret")
					res := httptest.NewRecorder()
					app.Routes().ServeHTTP(res, req)
					if res.Code != peer.want {
						t.Fatalf("%s returned %d, want %d: %s", header.name, res.Code, peer.want, res.Body.String())
					}
				})
			}
		})
	}
}

func TestRemoteSecurityRegressionLoopbackProxyClientIdentityHeadersAreRemote(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	for _, header := range []struct {
		name string
		key  string
	}{
		{name: "X-Real-IP", key: "X-Real-IP"},
		{name: "True-Client-IP", key: "True-Client-IP"},
	} {
		t.Run(header.name, func(t *testing.T) {
			req := newTestRequest(http.MethodGet, "/api/health", nil)
			req.Host = "localhost:7788"
			req.RemoteAddr = "127.0.0.1:5555"
			req.Header.Set(header.key, "203.0.113.88")
			req.Header.Set("X-Forwarded-Proto", "https")
			if !app.remoteAccessGateRequired(req) {
				t.Fatalf("loopback proxy with %s must be treated as remote", header.key)
			}
			res := httptest.NewRecorder()
			app.Routes().ServeHTTP(res, req)
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("uncredentialed proxied remote request with %s returned %d: %s", header.key, res.Code, res.Body.String())
			}
		})
	}
}

func TestRemoteSecurityRegressionForwardedMetadataUsesOnlyTheLastTrustedHop(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	tests := []struct {
		name      string
		xProto    string
		xHost     string
		forwarded string
		want      int
	}{
		{
			name:   "proxy appended https and host win over client prefix",
			xProto: "http, https",
			xHost:  "evil.example, demo.trycloudflare.com",
			want:   http.StatusOK,
		},
		{
			name: "last forwarded hop is authoritative",
			forwarded: `for=198.51.100.20;host="evil.example";proto=http, ` +
				`for=203.0.113.90;host="demo.trycloudflare.com";proto=https`,
			want: http.StatusOK,
		},
		{
			name:   "client cannot hide a final plaintext hop",
			xProto: "https, http",
			xHost:  "evil.example, demo.trycloudflare.com",
			want:   http.StatusForbidden,
		},
		{
			name:      "conflicting protocol headers fail closed",
			xProto:    "https",
			xHost:     "demo.trycloudflare.com",
			forwarded: `for=203.0.113.90;host="demo.trycloudflare.com";proto=http`,
			want:      http.StatusForbidden,
		},
		{
			name:      "conflicting host headers fail closed",
			xProto:    "https",
			xHost:     "demo.trycloudflare.com",
			forwarded: `for=203.0.113.90;host="evil.example";proto=https`,
			want:      http.StatusForbidden,
		},
		{
			name:   "invalid final protocol fails closed",
			xProto: "https, javascript",
			xHost:  "evil.example, demo.trycloudflare.com",
			want:   http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := newTestRequest(http.MethodGet, "/api/health", nil)
			req.Host = "localhost:7788"
			req.RemoteAddr = "127.0.0.1:5555"
			req.Header.Set("CF-Connecting-IP", "203.0.113.90")
			req.Header.Set("Origin", "https://demo.trycloudflare.com")
			req.Header.Set("Authorization", "Bearer secret")
			if tt.xProto != "" {
				req.Header.Set("X-Forwarded-Proto", tt.xProto)
			}
			if tt.xHost != "" {
				req.Header.Set("X-Forwarded-Host", tt.xHost)
			}
			if tt.forwarded != "" {
				req.Header.Set("Forwarded", tt.forwarded)
			}
			res := httptest.NewRecorder()
			app.Routes().ServeHTTP(res, req)
			if res.Code != tt.want {
				t.Fatalf("forwarded metadata returned %d, want %d: %s", res.Code, tt.want, res.Body.String())
			}
		})
	}
}

func TestRemoteSecurityRegressionProxiedRemoteRequiresExplicitHTTPSMetadata(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	req := newTestRequest(http.MethodGet, "/api/health", nil)
	req.Host = "demo.trycloudflare.com"
	req.RemoteAddr = "127.0.0.1:5555"
	req.Header.Set("CF-Connecting-IP", "203.0.113.91")
	req.Header.Set("Authorization", "Bearer secret")
	res := httptest.NewRecorder()
	app.Routes().ServeHTTP(res, req)
	if res.Code != http.StatusForbidden || !strings.Contains(res.Body.String(), "HTTPS") {
		t.Fatalf("proxied remote request without trusted HTTPS metadata returned %d: %s", res.Code, res.Body.String())
	}
}

func TestRemoteSecurityRegressionDirectTLSIgnoresForgedForwardingMetadata(t *testing.T) {
	app := New(config.Config{Security: config.SecurityConfig{AccessPassword: "secret"}}, nil, nil, nil)
	req := newTestRequest(http.MethodGet, "/api/health", nil)
	req.Host = "localhost:7788"
	markRemoteHTTPS(req)
	req.Header.Set("X-Forwarded-Proto", "http")
	req.Header.Set("X-Forwarded-Host", "evil.example")
	req.Header.Set("Authorization", "Bearer secret")
	res := httptest.NewRecorder()
	app.Routes().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("direct remote TLS must ignore forged forwarding metadata, got %d: %s", res.Code, res.Body.String())
	}
}
