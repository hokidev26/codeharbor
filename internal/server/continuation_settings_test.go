package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

func TestContinuationSettingsEndpointPersistsBeforeApplying(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg, err := config.Default()
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, cfg); err != nil {
		t.Fatal(err)
	}
	runner := agent.NewRunner(store, providers.NewRegistry(), tools.NewRegistry(), agent.NewHub(), cfg.Agent)
	app := New(cfg, store, runner, agent.NewHub())
	app.SetConfigPath(configPath)
	body := []byte(`{"mode":"off","segmentTurns":5,"maxContinuations":0,"maxTotalTurns":5,"maxRunDurationMs":1000,"maxRunTokens":1000}`)
	request := newTestRequest(http.MethodPatch, "/api/runtime/continuation-settings", bytes.NewReader(body))
	request.Host, request.RemoteAddr = "localhost:7788", "127.0.0.1:1234"
	request.Header.Set(localTokenHeader, app.localToken)
	response := httptest.NewRecorder()
	app.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if got := runner.GetContinuationSettings(); got.Mode != "off" || got.MaxTotalTurns != 5 {
		t.Fatalf("runner settings were not applied: %+v", got)
	}
	persisted, _, err := config.LoadWithReport(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Agent.AutoContinuationMode != "off" || persisted.Agent.MaxTotalTurns != 5 {
		t.Fatalf("settings were not persisted: %+v", persisted.Agent)
	}

	invalid := newTestRequest(http.MethodPatch, "/api/runtime/continuation-settings", bytes.NewReader([]byte(`{"mode":"unsafe"}`)))
	invalid.Host, invalid.RemoteAddr = "localhost:7788", "127.0.0.1:1234"
	invalid.Header.Set(localTokenHeader, app.localToken)
	invalidResponse := httptest.NewRecorder()
	app.Routes().ServeHTTP(invalidResponse, invalid)
	if invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected strict validation failure, got %d: %s", invalidResponse.Code, invalidResponse.Body.String())
	}
	var settings map[string]any
	settingsResponse := httptest.NewRecorder()
	settingsRequest := newTestRequest(http.MethodGet, "/api/settings", nil)
	settingsRequest.Host, settingsRequest.RemoteAddr = "localhost:7788", "127.0.0.1:1234"
	app.Routes().ServeHTTP(settingsResponse, settingsRequest)
	if settingsResponse.Code != http.StatusOK || json.Unmarshal(settingsResponse.Body.Bytes(), &settings) != nil || settings["continuationSettingsEndpoint"] != "/api/runtime/continuation-settings" {
		t.Fatalf("settings endpoint was not advertised: %d %s", settingsResponse.Code, settingsResponse.Body.String())
	}
}
