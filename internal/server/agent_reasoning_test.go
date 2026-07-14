package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestUpdateAgentReasoningEffortRoute(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "gemini:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/agents/"+agent.ID+"/reasoning-effort", strings.NewReader(`{"reasoningEffort":"high"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var updated db.Agent
	if err := json.NewDecoder(recorder.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.ReasoningEffort != "high" {
		t.Fatalf("unexpected agent response: %+v", updated)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPatch, "/api/agents/"+agent.ID+"/reasoning-effort", strings.NewReader(`{"reasoningEffort":"maximum"}`))
	request.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid effort to be rejected, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
