package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"codeharbor/internal/agent"
	"codeharbor/internal/config"
	"codeharbor/internal/db"
	"codeharbor/internal/providers"
	"codeharbor/internal/tools"
)

type interruptBlockingProvider struct {
	started chan struct{}
	once    sync.Once
}

func (p *interruptBlockingProvider) Name() string { return "fake" }
func (p *interruptBlockingProvider) ListModels(context.Context) ([]string, error) {
	return []string{"test"}, nil
}
func (p *interruptBlockingProvider) Generate(context.Context, providers.GenerateRequest) (<-chan providers.Event, error) {
	p.once.Do(func() { close(p.started) })
	return make(chan providers.Event), nil
}

func TestInterruptNarratorRouteCancelsActiveRun(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, Role: "user", ContentText: "wait"}); err != nil {
		t.Fatal(err)
	}
	provider := &interruptBlockingProvider{started: make(chan struct{})}
	registry := providers.NewRegistry()
	registry.Register(provider)
	toolRegistry := tools.NewRegistry()
	tools.RegisterCore(toolRegistry)
	hub := agent.NewHub()
	runner := agent.NewRunner(store, registry, toolRegistry, hub, config.AgentConfig{MaxTurns: 2})
	app := New(config.Config{}, store, runner, hub, registry)

	done := make(chan struct{})
	go func() {
		runner.Run(ctx, narrator.ID)
		close(done)
	}()
	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider did not start")
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/narrators/"+narrator.ID+"/interrupt", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Interrupted bool `json:"interrupted"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Interrupted {
		t.Fatalf("expected interrupted response, got %+v", body)
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runner did not stop after interrupt route")
	}
	updated, err := store.GetNarrator(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "interrupted" {
		t.Fatalf("expected interrupted status, got %q", updated.Status)
	}
}
