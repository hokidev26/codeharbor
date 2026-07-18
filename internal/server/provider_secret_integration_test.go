package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/secrets"
)

func TestProviderConfigPersistsEncryptedAPIKeyAndExposesOnlyLastFive(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer relay-secret-value" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"relay-model"}]}`))
	}))
	defer upstream.Close()

	tempDir := t.TempDir()
	store, err := db.Open(context.Background(), filepath.Join(tempDir, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{
		Paths: config.PathsConfig{HomeDir: tempDir},
		Agent: config.AgentConfig{DefaultModel: "fallback:fallback-model"},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{
			{Name: "openai-compatible", Type: "openai-compatible", BaseURL: upstream.URL + "/v1", Model: "relay-model"},
			{Name: "fallback", Type: "openai-compatible", BaseURL: "http://127.0.0.1:9/v1", Model: "fallback-model", APIKeyOptional: true},
		}},
	}
	registry := providers.NewRegistry()
	app := New(cfg, store, nil, nil, registry)
	app.SetProviderVault(secrets.NewProviderVault(store, tempDir))
	configPath := filepath.Join(tempDir, "config.json")
	app.SetConfigPath(configPath)

	payload := []byte(`{"name":"openai-compatible","type":"openai-compatible","baseUrl":"` + upstream.URL + `/v1","apiKey":"relay-secret-value","model":"relay-model"}`)
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPut, "/api/providers/openai-compatible/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "relay-secret-value") {
		t.Fatal("provider response leaked the complete API key")
	}
	var response struct {
		Provider struct {
			APIKeyConfigured bool   `json:"apiKeyConfigured"`
			APIKeyPersisted  bool   `json:"apiKeyPersisted"`
			APIKeyLastFive   string `json:"apiKeyLastFive"`
		} `json:"provider"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Provider.APIKeyConfigured || !response.Provider.APIKeyPersisted || response.Provider.APIKeyLastFive != "value" {
		t.Fatalf("unexpected API key metadata: %+v", response.Provider)
	}
	for _, path := range []string{"/api/settings", "/api/models"} {
		catalog := httptest.NewRecorder()
		getRequest := newTestRequest(http.MethodGet, path, nil)
		getRequest.Header.Set(localTokenHeader, app.localToken)
		app.Routes().ServeHTTP(catalog, getRequest)
		if catalog.Code != http.StatusOK {
			t.Fatalf("%s expected 200, got %d: %s", path, catalog.Code, catalog.Body.String())
		}
		if strings.Contains(catalog.Body.String(), "relay-secret-value") || !strings.Contains(catalog.Body.String(), `"apiKeyLastFive":"value"`) {
			t.Fatalf("%s exposed unsafe provider credential data: %s", path, catalog.Body.String())
		}
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(written), "relay-secret-value") {
		t.Fatal("config.json contains the complete API key")
	}
	var raw string
	if err := store.DB().QueryRowContext(context.Background(), `SELECT COALESCE(CAST(active_ciphertext AS TEXT), '') FROM provider_secrets WHERE provider_name = 'openai-compatible' AND secret_kind = 'api_key'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "relay-secret-value") {
		t.Fatal("SQLite contains the complete API key")
	}

	clearPayload := strings.NewReader(`{"name":"openai-compatible","type":"openai-compatible","baseUrl":"` + upstream.URL + `/v1","model":"relay-model","clearApiKey":true}`)
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodPut, "/api/providers/openai-compatible/config", clearPayload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("clear expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var count int
	if err := store.DB().QueryRowContext(context.Background(), `SELECT COUNT(*) FROM provider_secrets WHERE provider_name = 'openai-compatible' AND secret_kind = 'api_key'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("clear retained %d provider secret rows", count)
	}
}
