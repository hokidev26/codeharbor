package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"autoto/internal/config"
)

func TestCLIProxyAPIAuthFilesRouteProxiesManagementAPI(t *testing.T) {
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", "secret")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v0/management/auth-files" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("X-Management-Key") != "secret" {
			t.Fatalf("missing management key")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"files":[{"name":"codex.json","provider":"codex"}]}`))
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		Profile:        config.ProviderProfileCLIProxyAPI,
		BaseURL:        upstream.URL + "/v1",
		Model:          "gpt-5.5",
		APIKeyOptional: true,
	}}}}, nil, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/providers/cliproxyapi/auth-files", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Files []struct {
			Name string `json:"name"`
		} `json:"files"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Files) != 1 || body.Files[0].Name != "codex.json" {
		t.Fatalf("unexpected auth files response: %+v", body)
	}
}

func TestCLIProxyAPIImportAuthFileUploadsMultipart(t *testing.T) {
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", "secret")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v0/management/auth-files" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("expected multipart upload, got %s", r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		files := r.MultipartForm.File["file"]
		if len(files) != 1 {
			t.Fatalf("expected one uploaded file, got %d", len(files))
		}
		if !strings.HasPrefix(files[0].Filename, "autoto-codex-") || !strings.HasSuffix(files[0].Filename, ".json") {
			t.Fatalf("expected Autoto default filename, got %q", files[0].Filename)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","uploaded":1}`))
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		Profile:        config.ProviderProfileCLIProxyAPI,
		BaseURL:        upstream.URL + "/v1",
		Model:          "gpt-5.5",
		APIKeyOptional: true,
	}}}}, nil, nil, nil)

	payload := []byte(`{"content":"{\"refresh_token\":\"rt\"}"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/providers/cliproxyapi/auth-files/import", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestAuthFileProviderUsesProfileRatherThanLegacyName(t *testing.T) {
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:    "local-codex",
		Type:    "openai-compatible",
		Profile: config.ProviderProfileCLIProxyAPI,
		Model:   "gpt-5.5",
	}}}}, nil, nil, nil)
	provider, err := app.authFileProvider("local-codex")
	if err != nil || provider.Name != "local-codex" || provider.Profile != config.ProviderProfileCLIProxyAPI {
		t.Fatalf("expected profile-selected provider, provider=%+v err=%v", provider, err)
	}
}

func TestGenericProviderAuthHandlerUsesURLProviderName(t *testing.T) {
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", "secret")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v0/management/auth-files" || r.Header.Get("X-Management-Key") != "secret" {
			t.Fatalf("unexpected generic auth request: %s key=%q", r.URL.Path, r.Header.Get("X-Management-Key"))
		}
		_, _ = w.Write([]byte(`{"files":[]}`))
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:    "local-codex",
		Type:    "openai-compatible",
		Profile: config.ProviderProfileCLIProxyAPI,
		BaseURL: upstream.URL + "/v1",
		Model:   "gpt-5.5",
	}}}}, nil, nil, nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("name", "local-codex")
	request := httptest.NewRequest(http.MethodGet, "/api/providers/local-codex/auth-files", nil).WithContext(context.WithValue(context.Background(), chi.RouteCtxKey, routeContext))
	recorder := httptest.NewRecorder()
	app.listProviderAuthFiles(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestCLIProxyAPIManagementUsesAutotoDefaultKey(t *testing.T) {
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", "")
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if got := r.Header.Get("X-Management-Key"); got != defaultCLIProxyAPIManagementKey {
			t.Fatalf("expected Autoto default management key, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"files":[]}`))
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name: "cliproxyapi", Type: "openai-compatible", BaseURL: upstream.URL + "/v1", Model: "gpt-5.5", APIKeyOptional: true,
	}}}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/providers/cliproxyapi/auth-files", nil))
	if recorder.Code != http.StatusOK || requests != 1 {
		t.Fatalf("expected one successful request, got status=%d requests=%d body=%s", recorder.Code, requests, recorder.Body.String())
	}
}

func TestCLIProxyAPIManagementRetriesLegacyDefaultKeyAfterUnauthorized(t *testing.T) {
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", "")
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch requests {
		case 1:
			if got := r.Header.Get("X-Management-Key"); got != defaultCLIProxyAPIManagementKey {
				t.Fatalf("expected Autoto default key first, got %q", got)
			}
			w.WriteHeader(http.StatusUnauthorized)
		case 2:
			if got := r.Header.Get("X-Management-Key"); got != legacyCLIProxyAPIManagementKey {
				t.Fatalf("expected legacy compatibility key second, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"files":[]}`))
		default:
			t.Fatalf("unexpected management request %d", requests)
		}
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name: "cliproxyapi", Type: "openai-compatible", BaseURL: upstream.URL + "/v1", Model: "gpt-5.5", APIKeyOptional: true,
	}}}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/providers/cliproxyapi/auth-files", nil))
	if recorder.Code != http.StatusOK || requests != 2 {
		t.Fatalf("expected compatibility retry to succeed, got status=%d requests=%d body=%s", recorder.Code, requests, recorder.Body.String())
	}
}

func TestCLIProxyAPIManagementDoesNotRetryExplicitKeyOrExposeIt(t *testing.T) {
	const explicitKey = "custom-management-key"
	t.Setenv("CLIPROXYAPI_MANAGEMENT_KEY", explicitKey)
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if got := r.Header.Get("X-Management-Key"); got != explicitKey {
			t.Fatalf("expected explicit management key, got %q", got)
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name: "cliproxyapi", Type: "openai-compatible", BaseURL: upstream.URL + "/v1", Model: "gpt-5.5", APIKeyOptional: true,
	}}}}, nil, nil, nil)
	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/providers/cliproxyapi/auth-files", nil))
	if recorder.Code != http.StatusBadGateway || requests != 1 {
		t.Fatalf("expected one failed explicit-key request, got status=%d requests=%d body=%s", recorder.Code, requests, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), explicitKey) {
		t.Fatalf("management key leaked in response: %s", recorder.Body.String())
	}
}
