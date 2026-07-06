package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
)

type fakeModelProvider struct {
	name   string
	models []string
	err    error
}

func (p fakeModelProvider) Name() string { return p.name }

func (p fakeModelProvider) ListModels(ctx context.Context) ([]string, error) {
	if p.err != nil {
		return nil, p.err
	}
	return p.models, nil
}

func (p fakeModelProvider) Generate(ctx context.Context, req providers.GenerateRequest) (<-chan providers.Event, error) {
	out := make(chan providers.Event)
	close(out)
	return out, nil
}

func TestCreateProjectUsesRequestedModel(t *testing.T) {
	store, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projectDir := filepath.Join(t.TempDir(), "project")
	app := New(config.Config{
		Paths: config.PathsConfig{DefaultProjectDir: t.TempDir()},
		Agent: config.AgentConfig{DefaultModel: "openai:default", DefaultPermissionMode: "acceptEdits"},
	}, store, nil, nil)

	payload := []byte(`{"name":"Demo","gitPath":"` + projectDir + `","model":"cliproxyapi:gpt-dynamic"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/projects", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Narrator db.Narrator `json:"narrator"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Narrator.Model != "cliproxyapi:gpt-dynamic" {
		t.Fatalf("expected requested model, got %q", body.Narrator.Model)
	}
}

func TestModelsRouteReturnsDynamicProviderModels(t *testing.T) {
	registry := providers.NewRegistry()
	registry.Register(fakeModelProvider{name: "cliproxyapi", models: []string{"z-model", "a-model", "a-model"}})
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		BaseURL:        "http://127.0.0.1:8317/v1",
		Model:          "fallback-model",
		APIKeyOptional: true,
	}}}}, nil, nil, nil, registry)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/models", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body modelsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Providers) != 1 {
		t.Fatalf("expected one provider, got %+v", body.Providers)
	}
	provider := body.Providers[0]
	if provider.Error != "" {
		t.Fatalf("expected no error, got %q", provider.Error)
	}
	if provider.ManagementURL != "http://127.0.0.1:8317/management.html" {
		t.Fatalf("unexpected management URL %q", provider.ManagementURL)
	}
	expected := []string{"a-model", "z-model"}
	if len(provider.Models) != len(expected) {
		t.Fatalf("expected models %+v, got %+v", expected, provider.Models)
	}
	for i := range expected {
		if provider.Models[i] != expected[i] {
			t.Fatalf("expected models %+v, got %+v", expected, provider.Models)
		}
	}
}

func TestModelsRouteFallsBackWhenProviderModelListFails(t *testing.T) {
	registry := providers.NewRegistry()
	registry.Register(fakeModelProvider{name: "cliproxyapi", err: errors.New("connection refused")})
	app := New(config.Config{Providers: config.ProvidersConfig{Instances: []config.ProviderConfig{{
		Name:           "cliproxyapi",
		Type:           "openai-compatible",
		BaseURL:        "http://127.0.0.1:8317/v1",
		Model:          "fallback-model",
		APIKeyOptional: true,
	}}}}, nil, nil, nil, registry)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/models", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body modelsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	provider := body.Providers[0]
	if len(provider.Models) != 1 || provider.Models[0] != "fallback-model" {
		t.Fatalf("expected fallback model, got %+v", provider.Models)
	}
	if provider.Error == "" {
		t.Fatal("expected provider error message")
	}
}
