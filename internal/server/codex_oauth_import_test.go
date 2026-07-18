package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"autoto/internal/codexauth"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
)

func authenticatedCodexRequest(app *Server, method, target string, body io.Reader) *http.Request {
	request := newTestRequest(method, target, body)
	request.Header.Set(localTokenHeader, app.localToken)
	return request
}

func TestNativeCodexCredentialRoutesRequireCanonicalToken(t *testing.T) {
	app := New(config.Config{Paths: config.PathsConfig{HomeDir: t.TempDir()}}, nil, nil, nil, providers.NewRegistry())
	tests := []struct {
		name       string
		method     string
		target     string
		body       string
		validCodes []int
	}{
		{name: "accounts list", method: http.MethodGet, target: "/api/providers/oauth/codex/accounts", validCodes: []int{http.StatusOK}},
		{name: "account export", method: http.MethodGet, target: "/api/providers/oauth/codex/accounts/codex_fixture/export", validCodes: []int{http.StatusBadRequest}},
		{name: "account patch", method: http.MethodPatch, target: "/api/providers/oauth/codex/accounts/codex_fixture", body: `{}`, validCodes: []int{http.StatusBadRequest}},
		{name: "account refresh", method: http.MethodPost, target: "/api/providers/oauth/codex/accounts/codex_fixture/refresh", validCodes: []int{http.StatusNotFound}},
		{name: "account delete", method: http.MethodDelete, target: "/api/providers/oauth/codex/accounts/codex_fixture", validCodes: []int{http.StatusOK}},
		{name: "native import", method: http.MethodPost, target: "/api/providers/oauth/codex/import", body: `{}`, validCodes: []int{http.StatusBadRequest}},
		{name: "oauth login status", method: http.MethodGet, target: "/api/providers/oauth/codex/login/codex_login_fixture", validCodes: []int{http.StatusNotFound}},
		{name: "oauth login cancel", method: http.MethodDelete, target: "/api/providers/oauth/codex/login/codex_login_fixture", validCodes: []int{http.StatusNotFound}},
		{name: "generic codex list", method: http.MethodGet, target: "/api/providers/codex/auth-files", validCodes: []int{http.StatusOK}},
		{name: "generic codex import", method: http.MethodPost, target: "/api/providers/codex/auth-files/import", body: `{}`, validCodes: []int{http.StatusBadRequest}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			newRequest := func() *http.Request {
				request := newTestRequest(test.method, test.target, strings.NewReader(test.body))
				if test.body != "" {
					request.Header.Set("Content-Type", "application/json")
				}
				return request
			}

			missing := httptest.NewRecorder()
			app.Routes().ServeHTTP(missing, newRequest())
			if missing.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 without token, got %d: %s", missing.Code, missing.Body.String())
			}

			wrongRequest := newRequest()
			wrongRequest.Header.Set(localTokenHeader, "wrong-fixture-token")
			wrong := httptest.NewRecorder()
			app.Routes().ServeHTTP(wrong, wrongRequest)
			if wrong.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 with wrong token, got %d: %s", wrong.Code, wrong.Body.String())
			}

			legacyRequest := newRequest()
			legacyRequest.Header.Set(legacyLocalTokenHeader, app.localToken)
			legacy := httptest.NewRecorder()
			app.Routes().ServeHTTP(legacy, legacyRequest)
			if legacy.Code != http.StatusUnauthorized {
				t.Fatalf("expected legacy header rejection, got %d: %s", legacy.Code, legacy.Body.String())
			}

			validRequest := newRequest()
			validRequest.Header.Set(localTokenHeader, app.localToken)
			valid := httptest.NewRecorder()
			app.Routes().ServeHTTP(valid, validRequest)
			matched := false
			for _, code := range test.validCodes {
				matched = matched || valid.Code == code
			}
			if !matched {
				t.Fatalf("canonical token did not reach handler, got %d: %s", valid.Code, valid.Body.String())
			}
		})
	}

	crossOriginRequest := authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts", nil)
	crossOriginRequest.Host = "localhost:7788"
	crossOriginRequest.Header.Set("Sec-Fetch-Site", "cross-site")
	crossOrigin := httptest.NewRecorder()
	app.Routes().ServeHTTP(crossOrigin, crossOriginRequest)
	if crossOrigin.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-origin Codex credential request, got %d: %s", crossOrigin.Code, crossOrigin.Body.String())
	}
	crossOriginExport := authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts/codex_fixture/export", nil)
	crossOriginExport.Header.Set("X-Autoto-Confirm", "export-codex-account")
	crossOriginExport.Host = "localhost:7788"
	crossOriginExport.Header.Set("Sec-Fetch-Site", "cross-site")
	crossOriginExportRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(crossOriginExportRecorder, crossOriginExport)
	if crossOriginExportRecorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-origin Codex export, got %d: %s", crossOriginExportRecorder.Code, crossOriginExportRecorder.Body.String())
	}
}

func TestNativeCodexImportStoresLocallyAndRegistersProvider(t *testing.T) {
	home := t.TempDir()
	registry := providers.NewRegistry()
	app := New(config.Config{
		Paths: config.PathsConfig{HomeDir: home},
		Agent: config.AgentConfig{DefaultModel: "codex:gpt-test"},
	}, nil, nil, nil, registry)
	configPath := filepath.Join(home, "config.json")
	app.SetConfigPath(configPath)

	source := map[string]any{
		"format": "sub2api",
		"accounts": []any{
			map[string]any{"name": "account-one", "platform": "openai", "credentials": map[string]any{"access_token": "fixture-access-one", "refresh_token": "rt_fixture_one", "chatgpt_account_id": "account-one-id", "email": "one@example.test"}},
			map[string]any{"name": "account-two", "platform": "openai", "credentials": map[string]any{"access_token": "fixture-access-two", "chatgpt_account_id": "account-two-id"}},
		},
	}
	content, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	requestBody, err := json.Marshal(importAuthFileRequest{Filename: "autoto-codex-auth.json", Content: string(content)})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := authenticatedCodexRequest(app, http.MethodPost, "/api/providers/oauth/codex/import", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	for _, secret := range []string{"fixture-access-one", "fixture-access-two", "rt_fixture_one"} {
		if strings.Contains(recorder.Body.String(), secret) {
			t.Fatalf("credential leaked in import response: %s", recorder.Body.String())
		}
	}
	var result providerAuthImportResponse
	if err := json.NewDecoder(recorder.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "ok" || result.Format != "sub2api" || result.Imported != 2 || result.Skipped != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	if _, ok := registry.Get("codex"); !ok {
		t.Fatal("native Codex provider was not registered")
	}
	settingsRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(settingsRecorder, newTestRequest(http.MethodGet, "/api/settings", nil))
	if settingsRecorder.Code != http.StatusOK {
		t.Fatalf("expected settings 200, got %d: %s", settingsRecorder.Code, settingsRecorder.Body.String())
	}
	var settingsBody struct {
		Providers []settingsProviderResponse `json:"providers"`
	}
	if err := json.NewDecoder(settingsRecorder.Body).Decode(&settingsBody); err != nil {
		t.Fatal(err)
	}
	if len(settingsBody.Providers) != 1 || settingsBody.Providers[0].Name != "codex" || !settingsBody.Providers[0].Configured {
		t.Fatalf("native Codex readiness missing from settings: %+v", settingsBody.Providers)
	}
	providerConfig, ok := app.providerConfig("codex")
	if !ok || providerConfig.Type != config.ProviderTypeCodex || providerConfig.BaseURL != codexauth.DefaultBaseURL {
		t.Fatalf("unexpected registered Codex config: %+v", providerConfig)
	}

	accountsRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(accountsRecorder, authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts", nil))
	if accountsRecorder.Code != http.StatusOK {
		t.Fatalf("expected accounts 200, got %d: %s", accountsRecorder.Code, accountsRecorder.Body.String())
	}
	for _, secret := range []string{"fixture-access-one", "fixture-access-two", "rt_fixture_one"} {
		if strings.Contains(accountsRecorder.Body.String(), secret) {
			t.Fatalf("credential leaked in accounts response: %s", accountsRecorder.Body.String())
		}
	}
	var accounts codexOAuthAccountsResponse
	if err := json.NewDecoder(accountsRecorder.Body).Decode(&accounts); err != nil {
		t.Fatal(err)
	}
	if accounts.Count != 2 || len(accounts.Accounts) != 2 {
		t.Fatalf("unexpected accounts response: %+v", accounts)
	}

	entries, err := os.ReadDir(codexauth.DefaultStoreDir(home))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected two local credential files, got %d", len(entries))
	}
	persistedConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"fixture-access-one", "fixture-access-two", "rt_fixture_one"} {
		if strings.Contains(string(persistedConfig), secret) {
			t.Fatalf("credential leaked in config.json: %s", persistedConfig)
		}
	}
}

func TestNativeCodexAccountManagementEndpointsAndSecretSafety(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/backend-api/wham/usage" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer fixture-management-access" || r.Header.Get("ChatGPT-Account-ID") != "management-account" {
			t.Fatalf("unexpected quota headers: auth=%q account=%q", r.Header.Get("Authorization"), r.Header.Get("ChatGPT-Account-ID"))
		}
		_, _ = w.Write([]byte(`{"plan_type":"team","rate_limit":{"primary_window":{"used_percent":40,"limit_window_seconds":18000},"secondary_window":{"used_percent":70,"limit_window_seconds":604800}}}`))
	}))
	defer upstream.Close()

	home := t.TempDir()
	database, err := db.Open(context.Background(), filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	registry := providers.NewRegistry()
	app := New(config.Config{
		Paths: config.PathsConfig{HomeDir: home},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "codex", Type: config.ProviderTypeCodex, BaseURL: upstream.URL + "/backend-api/codex", Model: "gpt-test", CodexAllowInsecureTestEndpoint: true,
		}}},
	}, database, nil, nil, registry)

	payload, _ := json.Marshal(importAuthFileRequest{Filename: "management.json", Content: `{"access_token":"fixture-management-access","refresh_token":"rt_management_fixture","account_id":"management-account","email":"manage@example.test"}`})
	importRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(importRecorder, authenticatedCodexRequest(app, http.MethodPost, "/api/providers/oauth/codex/import", bytes.NewReader(payload)))
	if importRecorder.Code != http.StatusOK {
		t.Fatalf("import failed: %d %s", importRecorder.Code, importRecorder.Body.String())
	}

	accountsRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(accountsRecorder, authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts", nil))
	if accountsRecorder.Code != http.StatusOK {
		t.Fatalf("list failed: %d %s", accountsRecorder.Code, accountsRecorder.Body.String())
	}
	assertCodexResponseHasNoSecrets(t, accountsRecorder.Body.Bytes())
	var listed codexOAuthAccountsResponse
	if err := json.Unmarshal(accountsRecorder.Body.Bytes(), &listed); err != nil || len(listed.Accounts) != 1 {
		t.Fatalf("unexpected list response: %+v err=%v", listed, err)
	}
	id := listed.Accounts[0].ID
	if !strings.HasPrefix(id, "codex_") || listed.Accounts[0].Priority != codexauth.DefaultPriority {
		t.Fatalf("missing stable account metadata: %+v", listed.Accounts[0])
	}
	if _, err := database.DB().Exec(`INSERT INTO api_requests (id, provider, credential_id, input_tokens, output_tokens, cost_usd, created_at) VALUES ('codex-usage-fixture', 'codex', ?, 120, 30, 1.25, ?)`, id, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	accountsRecorder = httptest.NewRecorder()
	app.Routes().ServeHTTP(accountsRecorder, authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts", nil))
	if accountsRecorder.Code != http.StatusOK {
		t.Fatalf("usage list failed: %d %s", accountsRecorder.Code, accountsRecorder.Body.String())
	}
	if err := json.NewDecoder(accountsRecorder.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	usage := listed.Accounts[0].Usage
	if usage.Total.RequestCount != 1 || usage.Total.InputTokens != 120 || usage.Total.OutputTokens != 30 || usage.Total.TotalTokens != 150 || usage.Total.CostUSD != 1.25 || usage.Last5Hours.RequestCount != 1 || usage.Last7Days.RequestCount != 1 {
		t.Fatalf("unexpected account usage: %+v", usage)
	}

	missingConfirmation := httptest.NewRecorder()
	app.Routes().ServeHTTP(missingConfirmation, authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts/"+id+"/export", nil))
	if missingConfirmation.Code != http.StatusBadRequest {
		t.Fatalf("export without explicit confirmation should be rejected, got %d: %s", missingConfirmation.Code, missingConfirmation.Body.String())
	}

	exportRequest := authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts/"+id+"/export", nil)
	exportRequest.Header.Set("X-Autoto-Confirm", "export-codex-account")
	exportRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(exportRecorder, exportRequest)
	if exportRecorder.Code != http.StatusOK {
		t.Fatalf("export failed: %d %s", exportRecorder.Code, exportRecorder.Body.String())
	}
	if got := exportRecorder.Header().Get("Content-Disposition"); !strings.Contains(got, `attachment`) || !strings.Contains(got, listed.Accounts[0].Name) {
		t.Fatalf("unexpected export disposition: %q", got)
	}
	if exportRecorder.Header().Get("Cache-Control") == "" || !strings.Contains(exportRecorder.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("export response is cacheable: %q", exportRecorder.Header().Get("Cache-Control"))
	}
	if !json.Valid(exportRecorder.Body.Bytes()) || !strings.Contains(exportRecorder.Body.String(), "fixture-management-access") || !strings.Contains(exportRecorder.Body.String(), "rt_management_fixture") {
		t.Fatalf("export did not contain a valid complete credential: %s", exportRecorder.Body.String())
	}

	remoteExport := authenticatedCodexRequest(app, http.MethodGet, "/api/providers/oauth/codex/accounts/"+id+"/export", nil)
	remoteExport.Header.Set("X-Autoto-Confirm", "export-codex-account")
	remoteExport.Host = "remote.example.test"
	markRemoteHTTPS(remoteExport)
	remoteRecorder := httptest.NewRecorder()
	app.exportCodexOAuthAccount(remoteRecorder, remoteExport)
	if remoteRecorder.Code != http.StatusForbidden {
		t.Fatalf("remote export should be denied, got %d: %s", remoteRecorder.Code, remoteRecorder.Body.String())
	}

	patchBody := bytes.NewBufferString(`{"alias":"Primary <script>","priority":7,"disabled":false}`)
	patchRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(patchRecorder, authenticatedCodexRequest(app, http.MethodPatch, "/api/providers/oauth/codex/accounts/"+id, patchBody))
	if patchRecorder.Code != http.StatusOK || !strings.Contains(patchRecorder.Body.String(), `"priority":7`) {
		t.Fatalf("patch failed: %d %s", patchRecorder.Code, patchRecorder.Body.String())
	}
	assertCodexResponseHasNoSecrets(t, patchRecorder.Body.Bytes())

	refreshRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(refreshRecorder, authenticatedCodexRequest(app, http.MethodPost, "/api/providers/oauth/codex/accounts/"+id+"/refresh", nil))
	if refreshRecorder.Code != http.StatusOK || !strings.Contains(refreshRecorder.Body.String(), `"plan_type":"team"`) {
		t.Fatalf("refresh failed: %d %s", refreshRecorder.Code, refreshRecorder.Body.String())
	}
	assertCodexResponseHasNoSecrets(t, refreshRecorder.Body.Bytes())
	var refreshed codexOAuthAccountResponse
	if err := json.Unmarshal(refreshRecorder.Body.Bytes(), &refreshed); err != nil {
		t.Fatal(err)
	}
	if refreshed.Usage.Total.RequestCount != 1 || refreshed.Usage.Total.TotalTokens != 150 || refreshed.Usage.Total.CostUSD != 1.25 {
		t.Fatalf("refresh response omitted account usage: %+v", refreshed.Usage)
	}

	if _, err := database.DB().Exec(`CREATE TRIGGER fail_codex_stats_delete BEFORE DELETE ON provider_account_stats BEGIN SELECT RAISE(ABORT, 'fixture cleanup failure'); END;`); err != nil {
		t.Fatal(err)
	}
	deleteRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(deleteRecorder, authenticatedCodexRequest(app, http.MethodDelete, "/api/providers/oauth/codex/accounts/"+id, nil))
	if deleteRecorder.Code != http.StatusMultiStatus ||
		!strings.Contains(deleteRecorder.Body.String(), `"status":"partial"`) ||
		!strings.Contains(deleteRecorder.Body.String(), `"credential_deleted":true`) ||
		!strings.Contains(deleteRecorder.Body.String(), `"cleanup_pending":true`) ||
		!strings.Contains(deleteRecorder.Body.String(), `"retryable":true`) {
		t.Fatalf("expected retryable partial delete response, got %d %s", deleteRecorder.Code, deleteRecorder.Body.String())
	}
	if _, err := database.DB().Exec(`DROP TRIGGER fail_codex_stats_delete`); err != nil {
		t.Fatal(err)
	}
	retryRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(retryRecorder, authenticatedCodexRequest(app, http.MethodDelete, "/api/providers/oauth/codex/accounts/"+id, nil))
	if retryRecorder.Code != http.StatusOK ||
		!strings.Contains(retryRecorder.Body.String(), `"already_missing":true`) ||
		!strings.Contains(retryRecorder.Body.String(), `"stats_deleted":true`) ||
		!strings.Contains(retryRecorder.Body.String(), `"cleanup_pending":false`) ||
		!strings.Contains(retryRecorder.Body.String(), `"retryable":false`) {
		t.Fatalf("delete cleanup retry failed: %d %s", retryRecorder.Code, retryRecorder.Body.String())
	}
	if stats, err := database.ListProviderAccountStats(context.Background(), "codex"); err != nil || len(stats) != 0 {
		t.Fatalf("account stats were not cleaned: %+v err=%v", stats, err)
	}
}

func assertCodexResponseHasNoSecrets(t *testing.T, body []byte) {
	t.Helper()
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	var visit func(any)
	visit = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			for key, child := range typed {
				normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(key))
				for _, forbidden := range []string{"accesstoken", "refreshtoken", "idtoken", "authorization", "cookie", "jwt"} {
					if strings.Contains(normalized, forbidden) {
						t.Fatalf("sensitive key %q leaked in response: %s", key, body)
					}
				}
				visit(child)
			}
		case []any:
			for _, child := range typed {
				visit(child)
			}
		case string:
			for _, secret := range []string{"fixture-management-access", "rt_management_fixture"} {
				if strings.Contains(typed, secret) {
					t.Fatalf("secret value leaked in response: %s", body)
				}
			}
		}
	}
	visit(value)
}

func TestNativeCodexImportFeedsModelCatalogWithoutProxy(t *testing.T) {
	var modelRequests int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			http.NotFound(w, r)
			return
		}
		modelRequests++
		if r.Header.Get("Authorization") != "Bearer fixture-access" || r.Header.Get("ChatGPT-Account-ID") != "account-1" {
			t.Fatalf("unexpected direct Codex headers: authorization=%q account=%q", r.Header.Get("Authorization"), r.Header.Get("ChatGPT-Account-ID"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-native"}]}`))
	}))
	defer upstream.Close()

	home := t.TempDir()
	cfg := config.Config{
		Paths: config.PathsConfig{HomeDir: home},
		Agent: config.AgentConfig{DefaultModel: "codex:gpt-native"},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "codex", Type: config.ProviderTypeCodex, BaseURL: upstream.URL, Model: "gpt-native", CodexAllowInsecureTestEndpoint: true,
		}}},
	}
	registry := providers.NewRegistry()
	app := New(cfg, nil, nil, nil, registry)
	payload, err := json.Marshal(importAuthFileRequest{Content: `{"access_token":"fixture-access","account_id":"account-1"}`})
	if err != nil {
		t.Fatal(err)
	}
	importRecorder := httptest.NewRecorder()
	importRequest := authenticatedCodexRequest(app, http.MethodPost, "/api/providers/oauth/codex/import", bytes.NewReader(payload))
	importRequest.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(importRecorder, importRequest)
	if importRecorder.Code != http.StatusOK {
		t.Fatalf("expected import 200, got %d: %s", importRecorder.Code, importRecorder.Body.String())
	}

	modelsRecorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(modelsRecorder, newTestRequest(http.MethodGet, "/api/models", nil))
	if modelsRecorder.Code != http.StatusOK {
		t.Fatalf("expected models 200, got %d: %s", modelsRecorder.Code, modelsRecorder.Body.String())
	}
	if modelRequests != 1 {
		t.Fatalf("expected one direct model request, got %d", modelRequests)
	}
	var response modelsResponse
	if err := json.NewDecoder(modelsRecorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if len(response.Providers) != 1 || response.Providers[0].Name != "codex" || !response.Providers[0].Configured || len(response.Providers[0].Models) != 1 || response.Providers[0].Models[0] != "gpt-native" {
		t.Fatalf("unexpected model catalog response: %+v", response)
	}

	registered, ok := registry.Get("codex")
	if !ok {
		t.Fatal("Codex provider not registered")
	}
	models, err := registered.ListModels(context.Background())
	if err != nil || len(models) != 1 || models[0] != "gpt-native" {
		t.Fatalf("registered provider cannot reuse local credentials: models=%v err=%v", models, err)
	}
}

func TestNativeCodexImportDoesNotReactivateDisabledProvider(t *testing.T) {
	home := t.TempDir()
	codex := config.ProviderConfig{Name: "codex", Type: config.ProviderTypeCodex, BaseURL: codexauth.DefaultBaseURL, Model: "gpt-test", Disabled: true}
	registry := providers.NewRegistry()
	registry.Register(providers.NewCodexProvider(config.ProviderConfig{
		Name: "codex", Type: config.ProviderTypeCodex, BaseURL: codexauth.DefaultBaseURL, Model: "gpt-test", CredentialStorePath: codexauth.DefaultStoreDir(home),
	}))
	app := New(config.Config{Paths: config.PathsConfig{HomeDir: home}, Agent: config.AgentConfig{DefaultModel: "codex:gpt-test"}, Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{codex}}}, nil, nil, nil, registry)
	payload, err := json.Marshal(importAuthFileRequest{Content: `{"access_token":"fixture-disabled-access","account_id":"disabled-account"}`})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := authenticatedCodexRequest(app, http.MethodPost, "/api/providers/oauth/codex/import", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("disabled Codex import should still store credentials: %d %s", recorder.Code, recorder.Body.String())
	}
	if _, ok := registry.Get("codex"); ok {
		t.Fatal("credential import re-registered disabled Codex provider")
	}
	stored, ok := app.providerConfig("codex")
	if !ok || !stored.Disabled {
		t.Fatalf("import changed disabled Codex config: %+v", stored)
	}
}
