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

func TestProviderConfigEncryptsTransportSecretsAndAppliesThem(t *testing.T) {
	const (
		proxyUser    = "proxy-user"
		proxyPass    = "proxy-pass"
		headerSecret = "tenant-secret"
	)
	proxyCalls := 0
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls++
		if got := r.Header.Get("Proxy-Authorization"); got == "" {
			t.Fatal("proxy credentials were not applied")
		}
		if got := r.Header.Get("User-Agent"); got != "Autoto Secure Transport/1.0" {
			t.Fatalf("unexpected user agent %q", got)
		}
		if got := r.Header.Get("X-Tenant"); got != headerSecret {
			t.Fatalf("unexpected custom header %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"transport-model"}]}`))
	}))
	defer proxy.Close()

	tempDir := t.TempDir()
	store, err := db.Open(context.Background(), filepath.Join(tempDir, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{
		Paths: config.PathsConfig{HomeDir: tempDir},
		Agent: config.AgentConfig{DefaultModel: "fallback:fallback-model"},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "fallback", Type: "openai-compatible", BaseURL: "http://127.0.0.1:9/v1", Model: "fallback-model", APIKeyOptional: true,
		}}},
	}
	app := New(cfg, store, nil, nil, providers.NewRegistry())
	app.SetProviderVault(secrets.NewProviderVault(store, tempDir))
	configPath := filepath.Join(tempDir, "config.json")
	app.SetConfigPath(configPath)
	proxyWithAuth := strings.Replace(proxy.URL, "http://", "http://"+proxyUser+":"+proxyPass+"@", 1)
	payload := []byte(`{"name":"transport-provider","type":"openai-compatible","baseUrl":"http://127.0.0.1:65535/v1","model":"transport-model","apiKeyOptional":true,"proxyUrl":"` + proxyWithAuth + `","userAgent":"Autoto Secure Transport/1.0","requestHeaders":[{"name":"X-Tenant","value":"` + headerSecret + `"}],"insecureSkipTLSVerify":true}`)
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodPut, "/api/providers/transport-provider/config", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("save expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	for _, secret := range []string{proxyUser, proxyPass, headerSecret} {
		if strings.Contains(recorder.Body.String(), secret) {
			t.Fatalf("provider response leaked %q: %s", secret, recorder.Body.String())
		}
	}
	var response struct {
		Provider struct {
			ProxyURL                string `json:"proxyUrl"`
			ProxyAuthConfigured     bool   `json:"proxyAuthConfigured"`
			ProxyAuthPersisted      bool   `json:"proxyAuthPersisted"`
			RequestHeadersPersisted bool   `json:"requestHeadersPersisted"`
			RequestHeaders          []struct {
				Name       string `json:"name"`
				Configured bool   `json:"configured"`
			} `json:"requestHeaders"`
		} `json:"provider"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Provider.ProxyURL != proxy.URL || !response.Provider.ProxyAuthConfigured || !response.Provider.ProxyAuthPersisted || !response.Provider.RequestHeadersPersisted || len(response.Provider.RequestHeaders) != 1 || response.Provider.RequestHeaders[0].Name != "X-Tenant" || !response.Provider.RequestHeaders[0].Configured {
		t.Fatalf("unexpected transport metadata: %+v", response.Provider)
	}

	testRecorder := httptest.NewRecorder()
	testRequest := newTestRequest(http.MethodPost, "/api/providers/transport-provider/test", nil)
	testRequest.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(testRecorder, testRequest)
	if testRecorder.Code != http.StatusOK || proxyCalls != 1 {
		t.Fatalf("saved transport settings were not applied: status=%d calls=%d body=%s", testRecorder.Code, proxyCalls, testRecorder.Body.String())
	}

	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{proxyUser, proxyPass, headerSecret} {
		if strings.Contains(string(written), secret) {
			t.Fatalf("config.json leaked %q: %s", secret, written)
		}
	}
	if !strings.Contains(string(written), `"proxyUrl": "`+proxy.URL+`"`) || !strings.Contains(string(written), `"name": "X-Tenant"`) || !strings.Contains(string(written), `"insecureSkipTLSVerify": true`) {
		t.Fatalf("transport metadata was not persisted: %s", written)
	}
	rows, err := store.DB().QueryContext(context.Background(), `SELECT secret_kind, COALESCE(CAST(active_ciphertext AS TEXT), '') FROM provider_secrets WHERE provider_name = 'transport-provider' ORDER BY secret_kind`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	kinds := map[string]bool{}
	for rows.Next() {
		var kind, ciphertext string
		if err := rows.Scan(&kind, &ciphertext); err != nil {
			t.Fatal(err)
		}
		kinds[kind] = true
		for _, secret := range []string{proxyUser, proxyPass, headerSecret} {
			if strings.Contains(ciphertext, secret) {
				t.Fatalf("encrypted vault row %s leaked %q", kind, secret)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !kinds[secrets.ProviderProxyAuthKind] || !kinds[secrets.ProviderRequestHeadersKind] {
		t.Fatalf("missing encrypted transport secret kinds: %v", kinds)
	}

	clearPayload := strings.NewReader(`{"name":"transport-provider","type":"openai-compatible","baseUrl":"http://127.0.0.1:65535/v1","model":"transport-model","apiKeyOptional":true,"proxyUrl":"` + proxy.URL + `","clearProxyAuth":true,"userAgent":"Autoto Secure Transport/1.0","requestHeaders":[],"insecureSkipTLSVerify":true}`)
	recorder = httptest.NewRecorder()
	request = newTestRequest(http.MethodPut, "/api/providers/transport-provider/config", clearPayload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(localTokenHeader, app.localToken)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("clear expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var count int
	if err := store.DB().QueryRowContext(context.Background(), `SELECT COUNT(*) FROM provider_secrets WHERE provider_name = 'transport-provider' AND secret_kind IN ('proxy_auth', 'request_headers')`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("clear retained %d transport secret rows", count)
	}
}
