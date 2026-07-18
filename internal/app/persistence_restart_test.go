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

func TestProviderSecretSurvivesRealRestartAndMissingKeyFailsClosed(t *testing.T) {
	ctx := context.Background()
	userHome := t.TempDir()
	t.Setenv("HOME", userHome)
	appHome := filepath.Join(userHome, ".autoto")
	configPath := filepath.Join(appHome, "config.json")
	databasePath := filepath.Join(appHome, "autoto.db")
	const plaintext = "restart-provider-secret-Ω-7319"

	cfg := config.Config{
		SchemaVersion: config.CurrentConfigVersion,
		Paths: config.PathsConfig{
			HomeDir:           appHome,
			DatabasePath:      databasePath,
			DefaultProjectDir: filepath.Join(appHome, "projects"),
		},
		Agent: config.AgentConfig{DefaultModel: "relay:relay-model", SummaryModel: "relay:relay-model"},
		Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
			Name: "relay", Type: "openai-compatible", BaseURL: "https://relay.example/v1", Model: "relay-model", SecretRevision: 1,
		}}},
	}
	if err := config.Save(configPath, cfg); err != nil {
		t.Fatal(err)
	}

	firstStore, err := db.Open(ctx, databasePath)
	if err != nil {
		t.Fatal(err)
	}
	firstVault := secrets.NewProviderVault(firstStore, appHome)
	binding := providerSecretBinding(cfg.Providers.Instances[0])
	prepared, err := firstVault.PrepareSet(ctx, binding, plaintext)
	if err != nil {
		_ = firstStore.Close()
		t.Fatal(err)
	}
	if !prepared.Configured || !prepared.Persisted || prepared.LastFive != "-7319" {
		_ = firstStore.Close()
		t.Fatalf("unexpected prepared metadata: %+v", prepared)
	}
	keyPath := firstVault.KeyPath()
	if _, err := os.Stat(keyPath); err != nil {
		_ = firstStore.Close()
		t.Fatal(err)
	}
	// Leave the database record pending. A fresh process must reconcile the
	// matching durable config revision before resolving the secret.
	if err := firstStore.Close(); err != nil {
		t.Fatal(err)
	}

	reloadedConfig, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	inputs, err := config.InspectProviderAPIKeyInputs(configPath, reloadedConfig)
	if err != nil {
		t.Fatal(err)
	}
	secondStore, err := db.Open(ctx, reloadedConfig.Paths.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	secondVault := secrets.NewProviderVault(secondStore, reloadedConfig.Paths.HomeDir)
	hydrated, warnings := hydrateProviderSecrets(ctx, reloadedConfig, secondVault, inputs, configPath)
	if len(warnings) != 0 {
		_ = secondStore.Close()
		t.Fatalf("unexpected restart recovery warnings: %v", warnings)
	}
	provider := providerByName(t, hydrated, "relay")
	if provider.APIKey != plaintext || provider.APIKeySource != secrets.ProviderSecretSourceStored {
		_ = secondStore.Close()
		t.Fatalf("restart did not hydrate stored provider secret: %+v", provider)
	}
	resolved, metadata, err := secondVault.Resolve(ctx, providerSecretBinding(provider))
	if err != nil || resolved != plaintext || !metadata.Configured || !metadata.Persisted || metadata.LastFive != "-7319" {
		_ = secondStore.Close()
		t.Fatalf("restart resolve failed: value=%q metadata=%+v err=%v", resolved, metadata, err)
	}
	ordinaryResponse, err := json.Marshal(struct {
		Providers        []config.ProviderSummary `json:"providers"`
		APIKeyConfigured bool                     `json:"apiKeyConfigured"`
		APIKeyPersisted  bool                     `json:"apiKeyPersisted"`
		APIKeyLastFive   string                   `json:"apiKeyLastFive,omitempty"`
		APIKeySource     string                   `json:"apiKeySource"`
	}{
		Providers:        hydrated.Providers.Summaries(),
		APIKeyConfigured: metadata.Configured,
		APIKeyPersisted:  metadata.Persisted,
		APIKeyLastFive:   metadata.LastFive,
		APIKeySource:     metadata.Source,
	})
	if err != nil {
		_ = secondStore.Close()
		t.Fatal(err)
	}
	if strings.Contains(string(ordinaryResponse), plaintext) {
		_ = secondStore.Close()
		t.Fatalf("ordinary response exposed provider secret: %s", ordinaryResponse)
	}
	if err := secondStore.Close(); err != nil {
		t.Fatal(err)
	}
	assertProviderPlaintextAbsent(t, plaintext, ordinaryResponse, configPath, databasePath)

	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	missingKeyConfig, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	missingKeyInputs, err := config.InspectProviderAPIKeyInputs(configPath, missingKeyConfig)
	if err != nil {
		t.Fatal(err)
	}
	thirdStore, err := db.Open(ctx, missingKeyConfig.Paths.DatabasePath)
	if err != nil {
		t.Fatal(err)
	}
	missingKeyVault := secrets.NewProviderVault(thirdStore, missingKeyConfig.Paths.HomeDir)
	failedClosed, warnings := hydrateProviderSecrets(ctx, missingKeyConfig, missingKeyVault, missingKeyInputs, configPath)
	if len(warnings) == 0 {
		_ = thirdStore.Close()
		t.Fatal("missing provider key material did not produce a recovery warning")
	}
	provider = providerByName(t, failedClosed, "relay")
	if provider.APIKey != "" || provider.APIKeySource != secrets.ProviderSecretSourceStoredUnavailable {
		_ = thirdStore.Close()
		t.Fatalf("missing key material did not fail closed: %+v", provider)
	}
	if _, metadata, err = missingKeyVault.Resolve(ctx, providerSecretBinding(provider)); !errors.Is(err, secrets.ErrProviderSecretKeyUnavailable) || metadata.Configured || !metadata.Persisted {
		_ = thirdStore.Close()
		t.Fatalf("missing key resolve state = metadata=%+v err=%v", metadata, err)
	}
	if _, err := os.Stat(keyPath); !errors.Is(err, os.ErrNotExist) {
		_ = thirdStore.Close()
		t.Fatalf("missing provider key was unexpectedly replaced: %v", err)
	}
	failedClosedResponse, err := json.Marshal(failedClosed.Providers.Summaries())
	if err != nil {
		_ = thirdStore.Close()
		t.Fatal(err)
	}
	if err := thirdStore.Close(); err != nil {
		t.Fatal(err)
	}
	assertProviderPlaintextAbsent(t, plaintext, append(ordinaryResponse, failedClosedResponse...), configPath, databasePath)
}

func providerByName(t *testing.T, cfg config.Config, name string) config.ProviderConfig {
	t.Helper()
	for _, provider := range cfg.Providers.Instances {
		if provider.Name == name {
			return provider
		}
	}
	t.Fatalf("provider %q not found after reload", name)
	return config.ProviderConfig{}
}

func assertProviderPlaintextAbsent(t *testing.T, plaintext string, response []byte, configPath, databasePath string) {
	t.Helper()
	if strings.Contains(string(response), plaintext) {
		t.Fatal("ordinary response contains provider secret plaintext")
	}
	paths := []string{configPath, databasePath, databasePath + "-wal", databasePath + "-shm", databasePath + "-journal"}
	for _, path := range paths {
		contents, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatalf("read persistence artifact %s: %v", path, err)
		}
		if strings.Contains(string(contents), plaintext) {
			t.Fatalf("persistence artifact %s contains provider secret plaintext", path)
		}
	}
}
