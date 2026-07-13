package integrations

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/db"
	"autoto/internal/secrets"
)

func TestConnectionServiceResolvesSecretsAndPublicViewDoesNotLeak(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.CreateIntegrationConnection(ctx, db.IntegrationConnection{
		Kind: "github", Name: "primary", Enabled: true, Endpoint: "https://api.example.test",
		SettingsJSON: json.RawMessage(`{"owner":"example"}`),
		SecretRefs:   map[string]string{"apiKey": "env:PRIVATE_GITHUB_KEY"},
	})
	if err != nil {
		t.Fatal(err)
	}
	storedJSON, err := json.Marshal(connection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(storedJSON), "PRIVATE_GITHUB_KEY") || strings.Contains(string(storedJSON), "env:") {
		t.Fatalf("stored connection JSON leaked secret reference: %s", storedJSON)
	}
	const secretValue = "resolved-secret-value"
	service := NewConnectionService(store, secrets.EnvResolver{LookupEnv: func(name string) (string, bool) {
		if name != "PRIVATE_GITHUB_KEY" {
			t.Fatalf("unexpected environment variable: %s", name)
		}
		return secretValue, true
	}})
	resolved, err := service.Resolve(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Secrets["apiKey"] != secretValue {
		t.Fatal("expected resolved secret for internal caller")
	}
	resolvedJSON, err := json.Marshal(resolved)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(resolvedJSON), secretValue) || strings.Contains(string(resolvedJSON), "PRIVATE_GITHUB_KEY") || strings.Contains(string(resolvedJSON), "env:") {
		t.Fatalf("resolved JSON leaked secret material or reference: %s", resolvedJSON)
	}

	public, err := service.GetPublic(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !public.SecretConfigured["apiKey"] {
		t.Fatalf("expected configured status: %+v", public)
	}
	publicJSON, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(publicJSON), secretValue) || strings.Contains(string(publicJSON), "PRIVATE_GITHUB_KEY") || strings.Contains(string(publicJSON), "env:") {
		t.Fatalf("public view leaked secret material or reference: %s", publicJSON)
	}
	if !strings.Contains(string(publicJSON), `"secretConfigured":{"apiKey":true}`) {
		t.Fatalf("public view omitted configured state: %s", publicJSON)
	}
	listed, err := service.ListPublic(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != connection.ID || !listed[0].SecretConfigured["apiKey"] {
		t.Fatalf("unexpected public list: %+v", listed)
	}
}

func TestConnectionServiceReportsMissingEnvWithoutSecretLeak(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.CreateIntegrationConnection(ctx, db.IntegrationConnection{Kind: "test", Name: "missing", SecretRefs: map[string]string{"token": "env:MISSING_TOKEN"}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewConnectionService(store, secrets.EnvResolver{LookupEnv: func(string) (string, bool) { return "not-a-real-value", false }})
	_, err = service.Resolve(ctx, connection.ID)
	if err == nil {
		t.Fatal("expected missing environment secret to fail")
	}
	if strings.Contains(err.Error(), "not-a-real-value") {
		t.Fatalf("error leaked secret value: %v", err)
	}
}
