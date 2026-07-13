package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/compat"
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
	if filepath.Base(cfg.Paths.HomeDir) != ".autoto" || filepath.Base(cfg.Paths.DatabasePath) != "autoto.db" {
		t.Fatalf("expected Autoto default paths, got %+v", cfg.Paths)
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

func TestCodeHarborEnvFallbacksRemainSupported(t *testing.T) {
	t.Setenv("CODEHARBOR_DEFAULT_MODEL", "legacy:default")
	t.Setenv("CODEHARBOR_SUMMARY_MODEL", "legacy:summary")
	t.Setenv("CODEHARBOR_CONTEXT_TOKEN_LIMIT", "23456")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.DefaultModel != "legacy:default" || cfg.Agent.SummaryModel != "legacy:summary" || cfg.Agent.ContextTokenLimit != 23456 {
		t.Fatalf("expected legacy agent env fallbacks, got %+v", cfg.Agent)
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

func TestAutotoEnvTakesPriorityOverCodeHarborEnv(t *testing.T) {
	t.Setenv("AUTOTO_DEFAULT_MODEL", "autoto:default")
	t.Setenv("CODEHARBOR_DEFAULT_MODEL", "legacy:default")
	t.Setenv("AUTOTO_SUMMARY_MODEL", "autoto:summary")
	t.Setenv("CODEHARBOR_SUMMARY_MODEL", "legacy:summary")
	t.Setenv("AUTOTO_CONTEXT_TOKEN_LIMIT", "54321")
	t.Setenv("CODEHARBOR_CONTEXT_TOKEN_LIMIT", "12345")
	t.Setenv("AUTOTO_EXPOSED", "false")
	t.Setenv("CODEHARBOR_EXPOSED", "true")
	t.Setenv("AUTOTO_ACCESS_PASSWORD", "autoto-secret")
	t.Setenv("CODEHARBOR_ACCESS_PASSWORD", "legacy-secret")
	t.Setenv("AUTOTO_REMOTE_TERMINAL", "true")
	t.Setenv("CODEHARBOR_REMOTE_TERMINAL", "false")
	t.Setenv("AUTOTO_AGENT_BACKEND_URL", "http://127.0.0.1:9000/")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_URL", "http://127.0.0.1:8000/")
	t.Setenv("AUTOTO_AGENT_BACKEND_NAME", "Autoto Backend")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_NAME", "Legacy Backend")
	t.Setenv("AUTOTO_AGENT_BACKEND_KIND", "cloud")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_KIND", "local")
	t.Setenv("AUTOTO_AGENT_BACKEND_API_KEY", "autoto-key")
	t.Setenv("CODEHARBOR_AGENT_BACKEND_API_KEY", "legacy-key")

	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.DefaultModel != "autoto:default" || cfg.Agent.SummaryModel != "autoto:summary" || cfg.Agent.ContextTokenLimit != 54321 {
		t.Fatalf("expected canonical agent env values, got %+v", cfg.Agent)
	}
	if cfg.Security.Exposed || cfg.Security.AccessPassword != "autoto-secret" || !cfg.Security.AllowRemoteTerminal {
		t.Fatalf("expected canonical security env values, got %+v", cfg.Security)
	}
	if len(cfg.Backends.Instances) != 1 {
		t.Fatalf("expected one canonical backend, got %+v", cfg.Backends.Instances)
	}
	backend := cfg.Backends.Instances[0]
	if backend.BaseURL != "http://127.0.0.1:9000" || backend.Name != "Autoto Backend" || backend.Kind != "cloud" || backend.APIKey != "autoto-key" {
		t.Fatalf("expected canonical backend env values, got %+v", backend)
	}
}

func TestSecurityConfigFromEnv(t *testing.T) {
	t.Setenv("CODEHARBOR_EXPOSED", "true")
	t.Setenv("CODEHARBOR_ACCESS_PASSWORD", "remote-secret")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Security.Exposed || cfg.Security.AccessPassword != "remote-secret" || cfg.Security.AllowRemoteTerminal {
		t.Fatalf("expected security env overrides without remote terminal, got %+v", cfg.Security)
	}
	t.Setenv("CODEHARBOR_REMOTE_TERMINAL", "true")
	cfg, err = Default()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Security.AllowRemoteTerminal {
		t.Fatalf("expected remote terminal env override, got %+v", cfg.Security)
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

func TestLoadMigratesLegacyConfigToCanonicalPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyDir := filepath.Join(home, ".codeharbor")
	legacyPath := filepath.Join(legacyDir, "config.json")
	legacyDatabasePath := filepath.Join(legacyDir, "codeharbor.db")
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyData := []byte(`{
  "version": 1,
  "server": {"host": "127.0.0.1", "port": 9091},
  "paths": {"homeDir": "` + legacyDir + `", "databasePath": "` + legacyDatabasePath + `", "defaultProjectDir": "` + filepath.Join(home, "projects") + `"},
  "agent": {"defaultModel": "openai:legacy", "summaryModel": "openai:legacy", "defaultPermissionMode": "acceptEdits", "maxTurns": 3, "contextTokenLimit": 1000}
}`)
	if err := os.WriteFile(legacyPath, legacyData, 0o600); err != nil {
		t.Fatal(err)
	}

	canonicalPath, err := ResolvePath("")
	if err != nil {
		t.Fatal(err)
	}
	cfg, report, err := LoadWithReport(canonicalPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reportHasLegacy(report, "~/.codeharbor/config.json") {
		t.Fatalf("expected copied legacy config report, got %+v", report.Usages)
	}
	if cfg.Server.Port != 9091 || cfg.Paths.DatabasePath != legacyDatabasePath {
		t.Fatalf("expected migrated legacy values and database path, got %+v", cfg)
	}
	canonicalData, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(canonicalData) != string(legacyData) {
		t.Fatalf("expected byte-for-byte config copy, got %q", canonicalData)
	}
	if _, err := os.Stat(legacyDatabasePath); !os.IsNotExist(err) {
		t.Fatalf("migration must not create or move the legacy database, stat err=%v", err)
	}
	if legacyAfter, err := os.ReadFile(legacyPath); err != nil || string(legacyAfter) != string(legacyData) {
		t.Fatalf("expected legacy config to remain unchanged, err=%v", err)
	}
}

func TestLoadExplicitPathDoesNotMigrateLegacyConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyDir := filepath.Join(home, ".codeharbor")
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "config.json"), []byte(`{"server":{"port":9091}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	explicitPath := filepath.Join(home, "custom", "config.json")
	cfg, err := Load(explicitPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Port != 7788 {
		t.Fatalf("expected explicit path to use new defaults, got port %d", cfg.Server.Port)
	}
	if _, err := os.Stat(explicitPath); err != nil {
		t.Fatalf("expected explicit config to be created: %v", err)
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

func TestNormalizeProvidersDerivesLegacyCLIProxyProfile(t *testing.T) {
	providers := normalizeProviders(ProvidersConfig{Instances: []ProviderConfig{{
		Name: "cliproxyapi",
		Type: "openai-compatible",
	}}})
	if len(providers.Instances) != 1 || providers.Instances[0].Profile != ProviderProfileCLIProxyAPI {
		t.Fatalf("expected legacy profile derivation, got %+v", providers.Instances)
	}
}

func TestNormalizeProvidersPreservesExplicitProfile(t *testing.T) {
	providers := normalizeProviders(ProvidersConfig{Instances: []ProviderConfig{{
		Name:    "local-codex",
		Type:    "openai-compatible",
		Profile: ProviderProfileCLIProxyAPI,
	}}})
	if len(providers.Instances) != 1 || providers.Instances[0].Profile != ProviderProfileCLIProxyAPI {
		t.Fatalf("expected explicit profile to remain intact, got %+v", providers.Instances)
	}
}

func TestDefaultWithReportTracksOnlyEffectiveLegacyFallbacks(t *testing.T) {
	for _, name := range []string{
		"AUTOTO_DEFAULT_MODEL",
		"CODEHARBOR_DEFAULT_MODEL",
		"AUTOTO_SUMMARY_MODEL",
		"CODEHARBOR_SUMMARY_MODEL",
	} {
		t.Setenv(name, "")
	}
	const secretValue = "legacy-secret-model"
	t.Setenv("CODEHARBOR_DEFAULT_MODEL", secretValue)

	cfg, report, err := DefaultWithReport()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.DefaultModel != secretValue || cfg.Agent.SummaryModel != secretValue {
		t.Fatalf("expected effective legacy fallback, got %+v", cfg.Agent)
	}
	if len(report.Usages) != 1 || report.Usages[0].Legacy != "CODEHARBOR_DEFAULT_MODEL" || report.Usages[0].Replacement != "AUTOTO_DEFAULT_MODEL" {
		t.Fatalf("unexpected legacy report: %+v", report.Usages)
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secretValue) {
		t.Fatalf("legacy report leaked fallback value: %s", encoded)
	}
}

func TestDefaultWithReportCanonicalEnvSuppressesLegacyReport(t *testing.T) {
	t.Setenv("AUTOTO_DEFAULT_MODEL", "canonical-model")
	t.Setenv("CODEHARBOR_DEFAULT_MODEL", "legacy-secret-model")

	cfg, report, err := DefaultWithReport()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.DefaultModel != "canonical-model" {
		t.Fatalf("expected canonical value, got %q", cfg.Agent.DefaultModel)
	}
	if reportHasLegacy(report, "CODEHARBOR_DEFAULT_MODEL") {
		t.Fatalf("canonical env must suppress legacy report: %+v", report.Usages)
	}
}

func TestDefaultWithReportInvalidLegacyEnvIsNotReported(t *testing.T) {
	t.Setenv("AUTOTO_EXPOSED", "")
	t.Setenv("CODEHARBOR_EXPOSED", "not-a-bool")

	cfg, report, err := DefaultWithReport()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Security.Exposed {
		t.Fatal("invalid legacy bool must not become effective")
	}
	if reportHasLegacy(report, "CODEHARBOR_EXPOSED") {
		t.Fatalf("invalid legacy env must not be reported: %+v", report.Usages)
	}
}

func TestLoadWithReportFiltersConfigOverriddenLegacyDefaults(t *testing.T) {
	t.Setenv("AUTOTO_DEFAULT_MODEL", "")
	t.Setenv("CODEHARBOR_DEFAULT_MODEL", "legacy-secret-model")
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"agent":{"defaultModel":"canonical:file","summaryModel":"canonical:summary"}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, report, err := LoadWithReport(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.DefaultModel != "canonical:file" || cfg.Agent.SummaryModel != "canonical:summary" {
		t.Fatalf("expected config values, got %+v", cfg.Agent)
	}
	if reportHasLegacy(report, "CODEHARBOR_DEFAULT_MODEL") {
		t.Fatalf("config-overridden fallback must not be reported: %+v", report.Usages)
	}
}

func TestLoadWithReportTracksExplicitLegacyConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyPath := filepath.Join(home, ".codeharbor", "config.json")
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, []byte(`{"server":{"port":9092}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, report, err := LoadWithReport(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Port != 9092 {
		t.Fatalf("expected explicitly loaded legacy config, got port %d", cfg.Server.Port)
	}
	if !reportHasLegacy(report, "~/.codeharbor/config.json") {
		t.Fatalf("expected explicit legacy config report, got %+v", report.Usages)
	}
}

func TestLoadWithReportTracksNewConfigCreatedAtExplicitLegacyPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyPath := filepath.Join(home, ".codeharbor", "config.json")

	cfg, report, err := LoadWithReport(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Port != 7788 {
		t.Fatalf("expected default config at explicit legacy path, got port %d", cfg.Server.Port)
	}
	if !reportHasLegacy(report, "~/.codeharbor/config.json") {
		t.Fatalf("expected explicit legacy path usage report, got %+v", report.Usages)
	}
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("expected config to be written at explicit legacy path: %v", err)
	}
}

func reportHasLegacy(report compat.Report, legacy string) bool {
	for _, usage := range report.Usages {
		if usage.Legacy == legacy {
			return true
		}
	}
	return false
}

func providerByName(cfg Config, name string) *ProviderConfig {
	for i := range cfg.Providers.Instances {
		if cfg.Providers.Instances[i].Name == name {
			return &cfg.Providers.Instances[i]
		}
	}
	return nil
}
