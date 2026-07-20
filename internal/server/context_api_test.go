package server

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	agentpkg "autoto/internal/agent"
	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

func TestContextAPIStatusPreferencesClearAndAccess(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "context.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg, err := config.Default()
	if err != nil {
		t.Fatal(err)
	}
	cfg.Auth.RegistrationOpen = true
	hub := agentpkg.NewHub()
	runner := agentpkg.NewRunner(store, providers.NewRegistry(), tools.NewRegistry(), hub, cfg.Agent)
	app := New(cfg, store, runner, hub, providers.NewRegistry())

	ownerCookie := registerCollaborationTestUser(t, app, "context-owner")
	owner, _, err := store.GetUserByHandle(ctx, "context-owner")
	if err != nil {
		t.Fatal(err)
	}
	_, _, ownedAgent, err := store.CreateProjectForUser(ctx, owner.ID, "Owned", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	latest, err := store.AddMessage(ctx, db.Message{AgentID: ownedAgent.ID, Role: "user", ContentText: "hello context"})
	if err != nil {
		t.Fatal(err)
	}
	outsiderCookie := registerCollaborationTestUser(t, app, "context-outsider")

	for _, prefix := range []string{"/api/agents", "/api/narrators"} {
		response := agentAPIRequest(app.Routes(), http.MethodGet, prefix+"/"+ownedAgent.ID+"/context", nil, ownerCookie)
		if response.Code != http.StatusOK {
			t.Fatalf("GET context alias returned %d: %s", response.Code, response.Body.String())
		}
		var body struct {
			Context agentpkg.ContextTokenStatus `json:"context"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !body.Context.Estimated || body.Context.LatestMessageID != latest.ID {
			t.Fatalf("unexpected context status: %+v", body.Context)
		}
	}

	denied := agentAPIRequest(app.Routes(), http.MethodGet, "/api/agents/"+ownedAgent.ID+"/context", nil, outsiderCookie)
	if denied.Code != http.StatusNotFound && denied.Code != http.StatusForbidden {
		t.Fatalf("outsider context access returned %d: %s", denied.Code, denied.Body.String())
	}

	current, err := store.GetAgent(ctx, ownedAgent.ID)
	if err != nil {
		t.Fatal(err)
	}
	preferences := agentAPIRequest(app.Routes(), http.MethodPatch, "/api/agents/"+ownedAgent.ID+"/context/preferences", map[string]any{"pruneEnabled": true, "entityGeneration": current.EntityGeneration}, ownerCookie)
	if preferences.Code != http.StatusOK {
		t.Fatalf("PATCH preferences returned %d: %s", preferences.Code, preferences.Body.String())
	}
	current, err = store.GetAgent(ctx, ownedAgent.ID)
	if err != nil || !current.PruneEnabled {
		t.Fatalf("prune preference was not persisted: %+v %v", current, err)
	}
	if err := store.UpdateAgentContextSummary(ctx, ownedAgent.ID, "secret summary", latest.ID, 100); err != nil {
		t.Fatal(err)
	}
	clear := agentAPIRequest(app.Routes(), http.MethodPost, "/api/agents/"+ownedAgent.ID+"/context/clear", map[string]any{"entityGeneration": current.EntityGeneration, "expectedLatestMessageId": latest.ID}, ownerCookie)
	if clear.Code != http.StatusOK {
		t.Fatalf("POST clear returned %d: %s", clear.Code, clear.Body.String())
	}
	cleared, err := store.GetAgent(ctx, ownedAgent.ID)
	if err != nil || cleared.ContextSummary != "" || cleared.PruneBoundaryMessageID != latest.ID {
		t.Fatalf("context was not logically cleared: %+v %v", cleared, err)
	}
}

func TestRuntimeContextSettingsPersist(t *testing.T) {
	cfg, err := config.Default()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	app := New(cfg, nil, nil, nil)
	app.SetConfigPath(path)
	response := agentAPIRequest(app.Routes(), http.MethodPatch, "/api/runtime/context-settings", map[string]any{"compactKeepTurns": 4, "minPrunePercent": 35, "maxPrunePercent": 75}, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("PATCH runtime context settings returned %d: %s", response.Code, response.Body.String())
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ContextManagement.CompactKeepTurns != 4 || loaded.ContextManagement.MinPrunePercent != 35 || loaded.ContextManagement.MaxPrunePercent != 75 {
		t.Fatalf("context settings were not persisted: %+v", loaded.ContextManagement)
	}
	inverted := agentAPIRequest(app.Routes(), http.MethodPatch, "/api/runtime/context-settings", map[string]any{"standard": map[string]any{"pruneStart": 99, "compactStart": 95}}, nil)
	if inverted.Code != http.StatusOK {
		t.Fatalf("prune >= compact should be accepted as direct-compaction mode, got %d: %s", inverted.Code, inverted.Body.String())
	}
	invalid := agentAPIRequest(app.Routes(), http.MethodPatch, "/api/runtime/context-settings", map[string]any{"minPrunePercent": 90, "maxPrunePercent": 10}, nil)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid prune range returned %d: %s", invalid.Code, invalid.Body.String())
	}
}
