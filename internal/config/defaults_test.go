package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SchemaVersion != CurrentConfigVersion {
		t.Fatalf("expected config version %d, got %d", CurrentConfigVersion, cfg.SchemaVersion)
	}
	if cfg.Server.Port != 7788 {
		t.Fatalf("expected default port 7788, got %d", cfg.Server.Port)
	}
	if cfg.Paths.HomeDir == "" || cfg.Paths.DatabasePath == "" {
		t.Fatal("expected default paths")
	}
	if cfg.Agent.DefaultPermissionMode == "" {
		t.Fatal("expected default permission mode")
	}
	if cfg.Agent.ContextTokenLimit <= 0 {
		t.Fatalf("expected positive context token limit, got %d", cfg.Agent.ContextTokenLimit)
	}
	if cfg.Security.Exposed || cfg.Security.AccessPassword != "" {
		t.Fatalf("expected local security defaults, got %+v", cfg.Security)
	}
	provider := providerByName(cfg, "cliproxyapi")
	if provider == nil {
		t.Fatal("expected CLIProxyAPI provider preset")
	}
	if provider.Type != "openai-compatible" || provider.BaseURL != "http://127.0.0.1:8317/v1" || provider.Model != "gpt-5.5" || !provider.APIKeyOptional {
		t.Fatalf("unexpected CLIProxyAPI provider preset: %+v", *provider)
	}
}

func TestContextTokenLimitFromEnv(t *testing.T) {
	t.Setenv("CODEHARBOR_CONTEXT_TOKEN_LIMIT", "12345")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.ContextTokenLimit != 12345 {
		t.Fatalf("expected env context token limit, got %d", cfg.Agent.ContextTokenLimit)
	}
}

func TestSecurityConfigFromEnv(t *testing.T) {
	t.Setenv("CODEHARBOR_EXPOSED", "true")
	t.Setenv("CODEHARBOR_ACCESS_PASSWORD", "remote-secret")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Security.Exposed || cfg.Security.AccessPassword != "remote-secret" {
		t.Fatalf("expected security env overrides, got %+v", cfg.Security)
	}
}

func TestLoadBackfillsLegacyConfigVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{
  "server": {"host": "127.0.0.1", "port": 9000},
  "paths": {"homeDir": "/tmp/codeharbor", "databasePath": "/tmp/codeharbor/db.sqlite", "defaultProjectDir": "/tmp/codeharbor/projects"},
  "agent": {"defaultModel": "openai:test", "summaryModel": "openai:test", "defaultPermissionMode": "acceptEdits", "maxTurns": 3, "contextTokenLimit": 1000},
  "auth": {"registrationOpen": true},
  "providers": {"instances": []},
  "backends": {"instances": []}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SchemaVersion != CurrentConfigVersion {
		t.Fatalf("expected legacy config version backfill to %d, got %d", CurrentConfigVersion, cfg.SchemaVersion)
	}
	if cfg.Server.Port != 9000 {
		t.Fatalf("expected loaded legacy server port, got %d", cfg.Server.Port)
	}
}

func TestMigrateConfigBackfillsLegacyVersion(t *testing.T) {
	cfg := migrateConfig(Config{})
	if cfg.SchemaVersion != CurrentConfigVersion {
		t.Fatalf("expected legacy config to migrate to %d, got %d", CurrentConfigVersion, cfg.SchemaVersion)
	}
}

func TestMigrateConfigKeepsFutureVersion(t *testing.T) {
	cfg := migrateConfig(Config{SchemaVersion: CurrentConfigVersion + 1})
	if cfg.SchemaVersion != CurrentConfigVersion+1 {
		t.Fatalf("expected future config version to be preserved, got %d", cfg.SchemaVersion)
	}
}

func TestDefaultBackendsFromEnv(t *testing.T) {
	t.Setenv("CODEHARBOR_AGENT_BACKEND_URL", "http://127.0.0.1:8000/")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_API_KEY", "secret")

	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Backends.Instances) != 1 {
		t.Fatalf("expected one backend, got %d", len(cfg.Backends.Instances))
	}
	backend := cfg.Backends.Instances[0]
	if backend.BaseURL != "http://127.0.0.1:8000" || backend.APIKey != "secret" || !backend.Active {
		t.Fatalf("unexpected backend seed: %+v", backend)
	}
}

func TestLoadWritesDefaultConfigWithoutEnvSecrets(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "openai-secret")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-secret")
	t.Setenv("OPENAI_COMPATIBLE_API_KEY", "compatible-secret")
	t.Setenv("CLIPROXYAPI_API_KEY", "cliproxy-secret")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_URL", "http://127.0.0.1:8000")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_API_KEY", "backend-secret")
	t.Setenv("CODEHARBOR_ACCESS_PASSWORD", "remote-access-secret")

	path := filepath.Join(t.TempDir(), "config.json")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	expectedRuntimeKeys := map[string]string{
		"openai":            "openai-secret",
		"anthropic":         "anthropic-secret",
		"cliproxyapi":       "cliproxy-secret",
		"openai-compatible": "compatible-secret",
	}
	for _, provider := range cfg.Providers.Instances {
		if expected, ok := expectedRuntimeKeys[provider.Name]; ok && provider.APIKey != expected {
			t.Fatalf("expected runtime config to keep %s env secret, got %q", provider.Name, provider.APIKey)
		}
	}
	if len(cfg.Backends.Instances) != 1 || cfg.Backends.Instances[0].APIKey != "backend-secret" {
		t.Fatal("expected runtime config to keep backend env secret")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"openai-secret", "anthropic-secret", "cliproxy-secret", "compatible-secret", "backend-secret", "remote-access-secret"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("persisted config contains secret %q", secret)
		}
	}

	var persisted Config
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.SchemaVersion != CurrentConfigVersion {
		t.Fatalf("expected persisted config version %d, got %d", CurrentConfigVersion, persisted.SchemaVersion)
	}
	for _, provider := range persisted.Providers.Instances {
		if provider.APIKey != "" {
			t.Fatalf("expected persisted provider api key to be empty for %s", provider.Name)
		}
	}
	for _, backend := range persisted.Backends.Instances {
		if backend.APIKey != "" {
			t.Fatalf("expected persisted backend api key to be empty for %s", backend.Name)
		}
	}
	if persisted.Security.AccessPassword != "" {
		t.Fatal("expected persisted remote access password to be empty")
	}
}

func providerByName(cfg Config, name string) *ProviderConfig {
	for i := range cfg.Providers.Instances {
		if cfg.Providers.Instances[i].Name == name {
			return &cfg.Providers.Instances[i]
		}
	}
	return nil
}
