package app

import (
	"context"
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
