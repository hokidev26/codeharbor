package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"autoto/internal/config"
	"autoto/internal/providers"
)

func TestUpdateProviderConfigRegistersRuntimeProvider(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer relay-secret" {
			t.Fatalf("missing relay api key")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"relay-model"}]}`))
	}))
	defer upstream.Close()

	registry := providers.NewRegistry()
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:    "openai-compatible",
		Type:    "openai-compatible",
		BaseURL: "http://old.example/v1",
		Model:   "old-model",
	}}}}, nil, nil, nil, registry)
	configPath := filepath.Join(t.TempDir(), "config.json")
	app.SetConfigPath(configPath)

	payload := []byte(`{"name":"openai-compatible","type":"openai-compatible","baseUrl":"` + upstream.URL + `/v1","apiKey":"relay-secret","model":"relay-model"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/providers/openai-compatible/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/models", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var models modelsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&models); err != nil {
		t.Fatal(err)
	}
	if len(models.Providers) != 1 || len(models.Providers[0].Models) != 1 || models.Providers[0].Models[0] != "relay-model" {
		t.Fatalf("unexpected models response: %+v", models)
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(written, []byte("relay-secret")) {
		t.Fatal("API key should not be persisted to disk")
	}
}

func TestUpdateProviderConfigPreservesRuntimeAPIKeyWhenBlank(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer runtime-secret" {
			t.Fatalf("expected preserved runtime api key, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"new-model"}]}`))
	}))
	defer upstream.Close()

	registry := providers.NewRegistry()
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:    "openai-compatible",
		Type:    "openai-compatible",
		BaseURL: upstream.URL + "/v1",
		APIKey:  "runtime-secret",
		Model:   "old-model",
	}}}}, nil, nil, nil, registry)

	payload := []byte(`{"name":"openai-compatible","type":"openai-compatible","baseUrl":"` + upstream.URL + `/v1","model":"new-model"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/providers/openai-compatible/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/models", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestUpdateProviderConfigDoesNotMutateRuntimeWhenSaveFails(t *testing.T) {
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:    "openai-compatible",
		Type:    "openai-compatible",
		BaseURL: "http://old.example/v1",
		Model:   "old-model",
	}}}}, nil, nil, nil, providers.NewRegistry())
	app.SetConfigPath(t.TempDir())

	payload := []byte(`{"name":"openai-compatible","type":"openai-compatible","baseUrl":"http://new.example/v1","apiKey":"secret","model":"new-model"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/providers/openai-compatible/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected settings 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Providers []config.ProviderSummary `json:"providers"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Providers) != 1 || body.Providers[0].BaseURL != "http://old.example/v1" || body.Providers[0].Model != "old-model" {
		t.Fatalf("provider config mutated despite save failure: %+v", body.Providers)
	}
}

func TestUpdateProviderConfigCreatesCustomProvider(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openai/v1/models" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer groq-secret" {
			t.Fatalf("missing custom provider api key")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"openai/gpt-oss-20b"}]}`))
	}))
	defer upstream.Close()

	registry := providers.NewRegistry()
	app := New(config.Config{Providers: config.ProvidersConfig{}}, nil, nil, nil, registry)
	configPath := filepath.Join(t.TempDir(), "config.json")
	app.SetConfigPath(configPath)

	payload := []byte(`{"name":"groq","type":"openai-compatible","baseUrl":"` + upstream.URL + `/openai/v1","apiKey":"groq-secret","model":"openai/gpt-oss-20b"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/providers/groq/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/models", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var models modelsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&models); err != nil {
		t.Fatal(err)
	}
	if len(models.Providers) != 1 {
		t.Fatalf("expected one provider, got %+v", models.Providers)
	}
	provider := models.Providers[0]
	if provider.Name != "groq" || provider.Type != "openai-compatible" || !provider.Configured {
		t.Fatalf("unexpected custom provider response: %+v", provider)
	}
	if len(provider.Models) != 1 || provider.Models[0] != "openai/gpt-oss-20b" {
		t.Fatalf("unexpected custom provider models: %+v", provider.Models)
	}

	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(written, []byte("groq-secret")) {
		t.Fatal("custom provider API key should not be persisted to disk")
	}
	if !bytes.Contains(written, []byte("groq")) {
		t.Fatalf("expected custom provider to be persisted, got %s", string(written))
	}
}

func TestProviderConfigUpdatePreservesProfileWithoutNameBasedAPIKeyOverride(t *testing.T) {
	existing := config.ProviderConfig{Name: "local-codex", Type: "openai-compatible", Profile: config.ProviderProfileCLIProxyAPI, Model: "gpt-5.5"}
	updated, err := providerConfigFromUpdateRequest("local-codex", existing, providerConfigUpdateRequest{
		Name:    "local-codex",
		Type:    "openai-compatible",
		BaseURL: "http://127.0.0.1:8317/v1",
		Model:   "gpt-5.5",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Profile != config.ProviderProfileCLIProxyAPI {
		t.Fatalf("expected profile preservation, got %+v", updated)
	}
	if updated.APIKeyOptional {
		t.Fatalf("apiKeyOptional should only follow config, got %+v", updated)
	}
}

func TestUpdateProviderConfigRejectsInvalidProviderName(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil, providers.NewRegistry())

	payload := []byte(`{"name":"bad name","type":"openai-compatible","baseUrl":"http://example.com/v1","model":"model"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/providers/bad%20name/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
