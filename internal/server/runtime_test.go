package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

func TestRuntimeSummaryRouteReturnsProcessAndConfigStats(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	cfg := config.Config{
		Server: config.ServerConfig{Host: "127.0.0.1", Port: 9090},
		Paths: config.PathsConfig{
			HomeDir:           filepath.Join(t.TempDir(), "home"),
			DatabasePath:      filepath.Join(t.TempDir(), "codeharbor.db"),
			DefaultProjectDir: filepath.Join(t.TempDir(), "projects"),
		},
		Agent: config.AgentConfig{
			DefaultModel:          "openai:gpt-4.1-mini",
			SummaryModel:          "anthropic:claude-sonnet-4-5",
			DefaultPermissionMode: "acceptEdits",
			MaxTurns:              120,
			FirstTokenTimeoutMs:   45000,
			MaxTransientRetries:   3,
		},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{
			{Name: "openai", Type: "openai", APIKey: "runtime-only", Model: "gpt-4.1-mini"},
			{Name: "local", Type: "openai-compatible", BaseURL: "http://127.0.0.1:8317/v1", Model: "gpt-5.5", APIKeyOptional: true},
			{Name: "manual", Type: "manual", Model: "noop"},
		}},
		Backends: config.BackendsConfig{Instances: []config.BackendConfig{
			{Name: "Local", Kind: "local", BaseURL: "http://127.0.0.1:8000", Active: true},
			{Name: "Cloud", Kind: "cloud", BaseURL: "https://example.invalid"},
		}},
	}

	app := New(cfg, store, nil, nil)
	configPath := filepath.Join(t.TempDir(), "config.json")
	app.SetConfigPath(configPath)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/runtime/summary", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body runtimeSummaryResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Version != config.Version || body.Server.Address != "127.0.0.1:9090" || body.Server.ConfigPath != configPath {
		t.Fatalf("unexpected server summary: %+v", body.Server)
	}
	if body.Process.PID <= 0 || body.Process.StartedAt == "" || body.Process.UptimeSeconds < 0 {
		t.Fatalf("unexpected process summary: %+v", body.Process)
	}
	if body.Go.Version == "" || body.Go.CPUs <= 0 || body.Go.Goroutines <= 0 {
		t.Fatalf("unexpected go summary: %+v", body.Go)
	}
	if body.Memory.SysBytes == 0 || body.Memory.HeapInuseBytes == 0 {
		t.Fatalf("unexpected memory summary: %+v", body.Memory)
	}
	if body.Providers.Total != 3 || body.Providers.Configured != 2 {
		t.Fatalf("unexpected provider stats: %+v", body.Providers)
	}
	if body.Backends.Configured != 2 || body.Backends.Active != 1 {
		t.Fatalf("unexpected backend stats: %+v", body.Backends)
	}
	if len(body.Paths) != 4 || body.Agent.DefaultModel != "openai:gpt-4.1-mini" || body.Agent.MaxTurns != 120 {
		t.Fatalf("unexpected config summary: paths=%+v agent=%+v", body.Paths, body.Agent)
	}
}

func TestBuildRuntimeSummaryUsesSafeDefaults(t *testing.T) {
	started := time.Now().Add(-2 * time.Minute)
	summary := buildRuntimeSummary(config.Config{}, "", started)
	if summary.Server.Address != "localhost:7788" {
		t.Fatalf("expected safe default address, got %q", summary.Server.Address)
	}
	if summary.Process.UptimeSeconds < 100 {
		t.Fatalf("expected uptime from provided start time, got %+v", summary.Process)
	}
	if summary.Version != config.Version || summary.GeneratedAt == "" {
		t.Fatalf("unexpected metadata: %+v", summary)
	}
}
