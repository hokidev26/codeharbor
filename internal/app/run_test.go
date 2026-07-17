package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/review"
	"autoto/internal/runtime"
	"autoto/internal/server"
)

type orderedService struct {
	name   string
	mu     *sync.Mutex
	closed *[]string
}

func (s orderedService) Start(context.Context) error { return nil }
func (s orderedService) Close(context.Context) error {
	s.mu.Lock()
	*s.closed = append(*s.closed, s.name)
	s.mu.Unlock()
	return nil
}

func TestRuntimeRegistrationClosesHTTPAndGatewayBeforeWorkers(t *testing.T) {
	var mu sync.Mutex
	closed := []string{}
	service := func(name string) orderedService { return orderedService{name: name, mu: &mu, closed: &closed} }
	supervisor := runtime.NewSupervisor()
	if err := registerRuntimeServices(supervisor, service("preview"), service("channels"), service("automation"), service("background"), service("gateway"), service("http")); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"http", "gateway", "background", "automation", "channels", "preview"}
	if !reflect.DeepEqual(closed, want) {
		t.Fatalf("unexpected close order: got %v want %v", closed, want)
	}
}

func TestNewGatewayHTTPServerHonorsDisabledConfig(t *testing.T) {
	server, err := newGatewayHTTPServer(config.Config{}, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if server != nil {
		t.Fatal("disabled gateway unexpectedly created an HTTP server")
	}
}

func TestNewGatewayHTTPServerUsesIndependentGatewayRouter(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{Gateway: config.GatewayConfig{
		Enabled:              true,
		Host:                 "127.0.0.1",
		Port:                 8788,
		MaxGlobalConcurrency: 4,
		MaxRequestBytes:      1 << 20,
	}}
	server, err := newGatewayHTTPServer(cfg, store, providers.NewRegistry(), func(context.Context, string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if server == nil || server.Addr != "127.0.0.1:8788" || server.MaxHeaderBytes != 32<<10 || server.ReadHeaderTimeout != 10*time.Second || server.ReadTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second || server.WriteTimeout != 0 {
		t.Fatalf("unexpected gateway HTTP server: %+v", server)
	}

	gatewayResponse := httptest.NewRecorder()
	server.Handler.ServeHTTP(gatewayResponse, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if gatewayResponse.Code != http.StatusUnauthorized {
		t.Fatalf("gateway route returned %d: %s", gatewayResponse.Code, gatewayResponse.Body.String())
	}
	adminResponse := httptest.NewRecorder()
	server.Handler.ServeHTTP(adminResponse, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if adminResponse.Code != http.StatusNotFound {
		t.Fatalf("gateway router exposed an admin route: %d %s", adminResponse.Code, adminResponse.Body.String())
	}
}

func TestProviderConfigForRuntimeInjectsInstallationIdentity(t *testing.T) {
	settings := db.RuntimeSettings{InstallationID: "123e4567-e89b-42d3-a456-426614174000"}
	original := config.ProviderConfig{Name: "openai", Type: "openai", Model: "gpt-5"}
	got := providerConfigForRuntime(original, settings)
	if got.ClientVersion != config.Version || got.InstallationID != settings.InstallationID {
		t.Fatalf("runtime identity was not injected: %+v", got)
	}
	if original.ClientVersion != "" || original.InstallationID != "" {
		t.Fatalf("provider config input was mutated: %+v", original)
	}
	if _, err := providers.NewProvider(got); err != nil {
		t.Fatalf("injected provider config should remain valid: %v", err)
	}
}

type reviewRegistrationProvider struct {
	request providers.GenerateRequest
}

func (p *reviewRegistrationProvider) Name() string { return "review" }
func (p *reviewRegistrationProvider) Capabilities() providers.Capabilities {
	return providers.Capabilities{Streaming: true}
}
func (p *reviewRegistrationProvider) ListModels(context.Context) ([]string, error) {
	return []string{"dedicated"}, nil
}
func (p *reviewRegistrationProvider) Generate(_ context.Context, request providers.GenerateRequest) (<-chan providers.Event, error) {
	p.request = request
	out := make(chan providers.Event, 2)
	out <- providers.Event{Type: "text", Text: `{"verdict":"pass","reason":"looks good"}`}
	out <- providers.Event{Type: "done", Done: true, StopReason: "end_turn"}
	close(out)
	return out, nil
}

func TestConfiguredReviewServiceUsesDedicatedModelWithoutTools(t *testing.T) {
	provider := &reviewRegistrationProvider{}
	registry := providers.NewRegistry()
	registry.Register(provider)
	service := server.NewReviewService(registry, "review:dedicated")
	result, err := service.Review(context.Background(), review.Request{
		Subject: "review planned change",
		Draft:   review.PlanDraft{Goal: "change", Assumptions: []string{}, Steps: []string{"edit"}, Risks: []string{}, Tests: []string{"test"}, Rollback: []string{}},
	})
	if err != nil || result.Verdict != review.VerdictPass {
		t.Fatalf("unexpected review service result: result=%+v err=%v", result, err)
	}
	if provider.request.Model != "dedicated" || provider.request.Tools != nil {
		t.Fatalf("review service must use configured dedicated model without tools: %+v", provider.request)
	}
}

func TestAggregateSourceFromStorePreservesMemberOrder(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	want := []string{"second:model-b", "first:model-a"}
	if _, err := store.UpsertModelAggregate(ctx, db.ModelAggregate{Name: "fast", Mode: "priority", Members: want}, 0); err != nil {
		t.Fatal(err)
	}
	registry := providers.NewRegistry()
	registry.SetAggregateSource(aggregateSourceFromStore(store))
	provider, model, err := registry.Resolve("aggregate:fast")
	if err != nil {
		t.Fatal(err)
	}
	if model != "fast" {
		t.Fatalf("unexpected aggregate model name %q", model)
	}
	models, err := provider.ListModels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(models, want) {
		t.Fatalf("aggregate order changed: got %v want %v", models, want)
	}
}
