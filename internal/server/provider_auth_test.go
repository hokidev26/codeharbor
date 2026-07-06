package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"codeharbor/internal/config"
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
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","uploaded":1}`))
	}))
	defer upstream.Close()

	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		BaseURL:        upstream.URL + "/v1",
		Model:          "gpt-5.5",
		APIKeyOptional: true,
	}}}}, nil, nil, nil)

	payload := []byte(`{"filename":"codex.json","content":"{\"refresh_token\":\"rt\"}"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/providers/cliproxyapi/auth-files/import", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
