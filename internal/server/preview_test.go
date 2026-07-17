package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/preview"
)

func TestPreviewRoutesUseAgentWorkspaceAndExposeSafeState(t *testing.T) {
	routes, manager, agentID, root := newPreviewRouteTestServer(t, true)

	detect := performPreviewRequest(t, routes, http.MethodGet, "/api/agents/"+agentID+"/preview/detect", nil)
	if detect.Code != http.StatusOK {
		t.Fatalf("detect returned %d: %s", detect.Code, detect.Body.String())
	}
	if strings.Contains(detect.Body.String(), root) {
		t.Fatalf("detect response leaked absolute workspace path: %s", detect.Body.String())
	}
	var detected struct {
		Profiles []preview.Profile `json:"profiles"`
	}
	if err := json.NewDecoder(detect.Body).Decode(&detected); err != nil {
		t.Fatal(err)
	}
	if len(detected.Profiles) != 1 || detected.Profiles[0].Kind != preview.KindStatic {
		t.Fatalf("unexpected profiles: %+v", detected.Profiles)
	}

	invalid := performPreviewRequest(t, routes, http.MethodPost, "/api/agents/"+agentID+"/preview/start", map[string]any{
		"profileId": detected.Profiles[0].ID,
		"command":   "rm -rf /",
	})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("client command must be rejected, got %d: %s", invalid.Code, invalid.Body.String())
	}

	started := performPreviewRequest(t, routes, http.MethodPost, "/api/agents/"+agentID+"/preview/start", map[string]any{
		"profileId": detected.Profiles[0].ID,
	})
	if started.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", started.Code, started.Body.String())
	}
	var ready preview.Status
	if err := json.NewDecoder(started.Body).Decode(&ready); err != nil {
		t.Fatal(err)
	}
	if ready.Status != preview.StateReady || !ready.Running || ready.ProfileID != detected.Profiles[0].ID || ready.Port == 0 || ready.URL == "" {
		t.Fatalf("unexpected start response: %+v", ready)
	}
	serialized, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(serialized))
	if strings.Contains(string(serialized), root) || strings.Contains(lower, "pid") || strings.Contains(lower, "argv") || strings.Contains(lower, "cwd") {
		t.Fatalf("preview status leaked execution details: %s", serialized)
	}

	status := performPreviewRequest(t, routes, http.MethodGet, "/api/agents/"+agentID+"/preview/status", nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"status":"ready"`) {
		t.Fatalf("unexpected status response: %d %s", status.Code, status.Body.String())
	}
	logs := performPreviewRequest(t, routes, http.MethodGet, "/api/agents/"+agentID+"/preview/logs", nil)
	if logs.Code != http.StatusOK || !strings.Contains(logs.Body.String(), `"lines":[]`) {
		t.Fatalf("unexpected logs response: %d %s", logs.Code, logs.Body.String())
	}

	stopped := performPreviewRequest(t, routes, http.MethodPost, "/api/agents/"+agentID+"/preview/stop", nil)
	if stopped.Code != http.StatusOK || !strings.Contains(stopped.Body.String(), `"status":"stopped"`) {
		t.Fatalf("unexpected stop response: %d %s", stopped.Code, stopped.Body.String())
	}
	if manager.Status(agentID).Running {
		t.Fatal("stop route left preview running")
	}
}

func TestPreviewStartReturnsConflictForStaleProfile(t *testing.T) {
	routes, _, agentID, root := newPreviewRouteTestServer(t, true)
	detect := performPreviewRequest(t, routes, http.MethodGet, "/api/agents/"+agentID+"/preview/detect", nil)
	var detected struct {
		Profiles []preview.Profile `json:"profiles"`
	}
	if err := json.NewDecoder(detect.Body).Decode(&detected); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := performPreviewRequest(t, routes, http.MethodPost, "/api/agents/"+agentID+"/preview/start", map[string]any{"profileId": detected.Profiles[0].ID})
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "stale") {
		t.Fatalf("expected stale conflict, got %d: %s", response.Code, response.Body.String())
	}
}

func TestPreviewRoutesReturnServiceAndAgentErrors(t *testing.T) {
	routesWithoutManager, _, agentID, _ := newPreviewRouteTestServer(t, false)
	unavailable := performPreviewRequest(t, routesWithoutManager, http.MethodGet, "/api/agents/"+agentID+"/preview/status", nil)
	if unavailable.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without manager, got %d: %s", unavailable.Code, unavailable.Body.String())
	}

	routes, _, _, _ := newPreviewRouteTestServer(t, true)
	missing := performPreviewRequest(t, routes, http.MethodGet, "/api/agents/missing/preview/detect", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing agent, got %d: %s", missing.Code, missing.Body.String())
	}
}

func newPreviewRouteTestServer(t *testing.T, withManager bool) (http.Handler, *preview.Manager, string, string) {
	t.Helper()
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "preview.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("preview"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, agent, err := store.CreateProject(ctx, "Preview", "", root, "test:model", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	manager := preview.NewManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	app := New(config.Config{}, store, nil, nil)
	if withManager {
		app.SetPreviewManager(manager)
	}
	return app.Routes(), manager, agent.ID, root
}

func performPreviewRequest(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	request := newTestRequest(method, path, bytes.NewReader(data))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
