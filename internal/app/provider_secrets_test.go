package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/secrets"
)

func TestHydrateProviderSecretsMigratesLegacyConfigAndRestoresStoredValue(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	configPath := filepath.Join(home, "config.json")
	if err := os.WriteFile(configPath, []byte(`{"paths":{"homeDir":"`+strings.ReplaceAll(home, `\`, `\\`)+`"},"providers":{"instances":[{"name":"relay","type":"openai-compatible","baseUrl":"https://relay.example/v1","model":"relay-model","apiKey":"legacy-secret"}]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(ctx, filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{
		Paths: homePaths(home),
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "relay", Type: "openai-compatible", BaseURL: "https://relay.example/v1", Model: "relay-model", APIKey: "legacy-secret",
		}}},
	}
	inputs, err := config.InspectProviderAPIKeyInputs(configPath, cfg)
	if err != nil {
		t.Fatal(err)
	}
	vault := secrets.NewProviderVault(store, home)
	got, warnings := hydrateProviderSecrets(ctx, cfg, vault, inputs, configPath)
	if len(warnings) != 0 {
		t.Fatalf("unexpected migration warnings: %v", warnings)
	}
	provider := got.Providers.Instances[0]
	if provider.APIKey != "legacy-secret" || provider.APIKeySource != secrets.ProviderSecretSourceStored || provider.SecretRevision != 1 {
		t.Fatalf("unexpected migrated provider: %+v", provider)
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(written), "legacy-secret") {
		t.Fatal("legacy config still contains the API key")
	}
	resolved, metadata, err := vault.Resolve(ctx, providerSecretBinding(provider))
	if err != nil || resolved != "legacy-secret" || !metadata.Persisted {
		t.Fatalf("stored credential not recoverable: value=%q metadata=%+v err=%v", resolved, metadata, err)
	}
}

func TestHydrateProviderSecretsMigratesLegacyTransportSecrets(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	configPath := filepath.Join(home, "config.json")
	raw := `{"paths":{"homeDir":"` + strings.ReplaceAll(home, `\`, `\\`) + `"},"providers":{"instances":[{"name":"relay","type":"openai-compatible","baseUrl":"https://relay.example/v1","model":"relay-model","proxyUrl":"http://proxy-user:proxy-pass@127.0.0.1:7890","requestHeaders":[{"name":"X-Tenant","value":"tenant-secret"}]}]}}`
	if err := os.WriteFile(configPath, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	provider := cfg.Providers.Instances[0]
	if provider.ProxyURL != "http://127.0.0.1:7890" || provider.ProxyUsername != "" || provider.ProxyPassword != "" || len(provider.RequestHeaders) != 1 || provider.RequestHeaders[0].Value != "" {
		t.Fatalf("legacy transport plaintext entered normalized config: %+v", provider)
	}
	inputs, err := config.InspectProviderAPIKeyInputs(configPath, cfg)
	if err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(ctx, filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	vault := secrets.NewProviderVault(store, home)
	got, warnings := hydrateProviderSecrets(ctx, cfg, vault, inputs, configPath)
	if len(warnings) != 0 {
		t.Fatalf("unexpected transport migration warnings: %v", warnings)
	}
	provider = got.Providers.Instances[0]
	if provider.TransportSecretRevision != 1 || provider.ProxyURL != "http://127.0.0.1:7890" || provider.ProxyUsername != "proxy-user" || provider.ProxyPassword != "proxy-pass" || provider.ProxyAuthSource != secrets.ProviderSecretSourceStored {
		t.Fatalf("unexpected migrated proxy state: %+v", provider)
	}
	if len(provider.RequestHeaders) != 1 || provider.RequestHeaders[0].Name != "X-Tenant" || provider.RequestHeaders[0].Value != "tenant-secret" || provider.RequestHeadersSource != secrets.ProviderSecretSourceStored {
		t.Fatalf("unexpected migrated header state: %+v", provider.RequestHeaders)
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"proxy-user", "proxy-pass", "tenant-secret"} {
		if strings.Contains(string(written), secret) {
			t.Fatalf("scrubbed config leaked %q: %s", secret, written)
		}
	}
	binding := providerSecretBinding(provider)
	proxySecret, _, err := vault.ResolveKind(ctx, binding, secrets.ProviderProxyAuthKind)
	if err != nil {
		t.Fatal(err)
	}
	var proxy providerProxyAuthPayload
	if err := json.Unmarshal([]byte(proxySecret), &proxy); err != nil || proxy.Username != "proxy-user" || proxy.Password != "proxy-pass" {
		t.Fatalf("stored proxy secret = %q proxy=%+v err=%v", proxySecret, proxy, err)
	}
	headerSecret, _, err := vault.ResolveKind(ctx, binding, secrets.ProviderRequestHeadersKind)
	if err != nil {
		t.Fatal(err)
	}
	var headers map[string]string
	if err := json.Unmarshal([]byte(headerSecret), &headers); err != nil || headers["X-Tenant"] != "tenant-secret" {
		t.Fatalf("stored header secret = %q headers=%+v err=%v", headerSecret, headers, err)
	}
}

func TestHydrateProviderSecretsPreservesLegacyTransportWhenStoredSecretsUnavailable(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	configPath := filepath.Join(home, "config.json")
	raw := `{"paths":{"homeDir":"` + strings.ReplaceAll(home, `\`, `\\`) + `"},"providers":{"instances":[{"name":"relay","type":"openai-compatible","baseUrl":"https://relay.example/v1","model":"relay-model","transportSecretRevision":1,"proxyUrl":"http://legacy-user:legacy-pass@127.0.0.1:7890","requestHeaders":[{"name":"X-Tenant","value":"legacy-header"}]}]}}`
	if err := os.WriteFile(configPath, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(ctx, filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	vault := secrets.NewProviderVault(store, home)
	binding := providerSecretBinding(cfg.Providers.Instances[0])
	proxyPayload, err := json.Marshal(providerProxyAuthPayload{Username: "stored-user", Password: "stored-pass"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vault.PrepareSetKind(ctx, binding, secrets.ProviderProxyAuthKind, string(proxyPayload), ""); err != nil {
		t.Fatal(err)
	}
	if err := vault.CommitPendingKind(ctx, binding.Name, secrets.ProviderProxyAuthKind); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.PrepareSetKind(ctx, binding, secrets.ProviderRequestHeadersKind, `{"X-Tenant":"stored-header"}`, ""); err != nil {
		t.Fatal(err)
	}
	if err := vault.CommitPendingKind(ctx, binding.Name, secrets.ProviderRequestHeadersKind); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Clean(vault.KeyPath())); err != nil {
		t.Fatal(err)
	}

	unavailableVault := secrets.NewProviderVault(store, home)
	got, warnings := hydrateProviderSecrets(ctx, cfg, unavailableVault, map[string]config.ProviderAPIKeyInput{}, configPath)
	if len(warnings) == 0 {
		t.Fatal("unavailable stored transport secrets did not produce a recovery warning")
	}
	provider := got.Providers.Instances[0]
	if provider.ProxyAuthSource != secrets.ProviderSecretSourceStoredUnavailable || provider.RequestHeadersSource != secrets.ProviderSecretSourceStoredUnavailable {
		t.Fatalf("unavailable transport secrets did not fail closed: %+v", provider)
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, legacy := range []string{"legacy-user", "legacy-pass", "legacy-header"} {
		if !strings.Contains(string(written), legacy) {
			t.Fatalf("recoverable legacy value %q was scrubbed while the vault was unavailable: %s", legacy, written)
		}
	}
	if _, err := os.Stat(unavailableVault.KeyPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing provider key was unexpectedly replaced: %v", err)
	}
}

func TestHydrateProviderSecretsRollsBackPreparedMigrationsWhenTransportMigrationIsBlocked(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	configPath := filepath.Join(home, "config.json")
	raw := `{"paths":{"homeDir":"` + strings.ReplaceAll(home, `\`, `\\`) + `"},"providers":{"instances":[{"name":"api-provider","type":"openai-compatible","baseUrl":"https://api.example/v1","model":"api-model","apiKey":"legacy-api-key"},{"name":"blocked-provider","type":"openai-compatible","baseUrl":"https://blocked.example/v1","model":"blocked-model","transportSecretRevision":1,"proxyUrl":"http://legacy-user:legacy-pass@127.0.0.1:7890"}]}}`
	if err := os.WriteFile(configPath, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	inputs, err := config.InspectProviderAPIKeyInputs(configPath, cfg)
	if err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(ctx, filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	vault := secrets.NewProviderVault(store, home)
	blocked := cfg.Providers.Instances[1]
	mismatched := blocked
	mismatched.BaseURL = "https://other.example/v1"
	proxyPayload, err := json.Marshal(providerProxyAuthPayload{Username: "stored-user", Password: "stored-pass"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vault.PrepareSetKind(ctx, providerSecretBinding(mismatched), secrets.ProviderProxyAuthKind, string(proxyPayload), ""); err != nil {
		t.Fatal(err)
	}
	if err := vault.CommitPendingKind(ctx, blocked.Name, secrets.ProviderProxyAuthKind); err != nil {
		t.Fatal(err)
	}

	got, warnings := hydrateProviderSecrets(ctx, cfg, vault, inputs, configPath)
	if len(warnings) == 0 {
		t.Fatal("blocked transport migration did not produce a warning")
	}
	apiProvider := got.Providers.Instances[0]
	if apiProvider.APIKey != "legacy-api-key" || apiProvider.APIKeySource != secrets.ProviderSecretSourceRuntime || apiProvider.SecretRevision != 0 {
		t.Fatalf("prepared API key migration was not rolled back to runtime state: %+v", apiProvider)
	}
	blocked = got.Providers.Instances[1]
	if blocked.ProxyAuthSource != secrets.ProviderSecretSourceStoredUnavailable {
		t.Fatalf("blocked transport secret did not remain unavailable: %+v", blocked)
	}
	written, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, recoverable := range []string{"legacy-api-key", "legacy-user", "legacy-pass"} {
		if !strings.Contains(string(written), recoverable) {
			t.Fatalf("recoverable legacy value %q was scrubbed after a partial migration: %s", recoverable, written)
		}
	}
	if _, _, err := vault.Resolve(ctx, providerSecretBinding(apiProvider)); !errors.Is(err, secrets.ErrProviderSecretNotConfigured) {
		t.Fatalf("rolled-back API key unexpectedly remained pending or stored: %v", err)
	}
}

func TestHydrateProviderSecretsKeepsEnvironmentAheadOfStoredValue(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	store, err := db.Open(ctx, filepath.Join(home, "autoto.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{
		Paths: homePaths(home),
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "relay", Type: "openai-compatible", BaseURL: "https://relay.example/v1", Model: "relay-model", APIKey: "environment-secret", SecretRevision: 1,
		}}},
	}
	vault := secrets.NewProviderVault(store, home)
	binding := providerSecretBinding(cfg.Providers.Instances[0])
	if _, err := vault.PrepareSet(ctx, binding, "stored-secret"); err != nil {
		t.Fatal(err)
	}
	if err := vault.CommitPending(ctx, "relay"); err != nil {
		t.Fatal(err)
	}
	inputs := map[string]config.ProviderAPIKeyInput{"relay": {Source: config.ProviderAPIKeySourceEnvironment, APIKey: "environment-secret"}}
	got, warnings := hydrateProviderSecrets(ctx, cfg, vault, inputs, filepath.Join(home, "config.json"))
	if len(warnings) != 0 {
		t.Fatalf("unexpected environment warnings: %v", warnings)
	}
	provider := got.Providers.Instances[0]
	if provider.APIKey != "environment-secret" || provider.APIKeySource != secrets.ProviderSecretSourceEnvironment {
		t.Fatalf("environment key was not retained: %+v", provider)
	}
	if _, _, err := vault.Resolve(ctx, binding); err != nil && !errors.Is(err, secrets.ErrProviderSecretBindingMismatch) {
		t.Fatalf("stored value unexpectedly unavailable: %v", err)
	}
}

func homePaths(home string) config.PathsConfig {
	return config.PathsConfig{HomeDir: home, DatabasePath: filepath.Join(home, "autoto.db")}
}
