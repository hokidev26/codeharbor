package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"autoto/internal/config"
	updatepkg "autoto/internal/update"
)

func TestUpdateStatusDevelopmentBuildNeverClaimsAvailability(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	manifest := updatepkg.Manifest{Channel: "stable", Edges: []updatepkg.Edge{
		serverTestUpdateEdge("0.1.0", "0.2.0"),
	}}
	if err := app.SetUpdateManifestForTesting(manifest); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.ClearUpdateManifestForTesting)

	response := requestUpdateStatus(t, app)
	if response.Status != UpdateStatusDevelopmentBuild || response.Available {
		t.Fatalf("development build must not claim an update: %+v", response)
	}
	if response.CurrentVersion != config.Version || response.TargetVersion != "" || len(response.Path) != 0 {
		t.Fatalf("development response leaked a false update plan: %+v", response)
	}
}

func TestUpdateStatusWithoutTrustedManifestIsUnavailable(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	if err := app.ConfigureUpdateStatusForTesting("v1.0.0", "stable", nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.ClearUpdateManifestForTesting)

	response := requestUpdateStatus(t, app)
	if response.Status != UpdateStatusUnavailable || response.Available {
		t.Fatalf("missing manifest must be unavailable: %+v", response)
	}
}

func TestUpdateStatusUsesOnlyValidatedInjectedPath(t *testing.T) {
	app := New(config.Config{}, nil, nil, nil)
	manifest := updatepkg.Manifest{Channel: "stable", Edges: []updatepkg.Edge{
		serverTestUpdateEdge("1.0.0", "1.1.0"),
		func() updatepkg.Edge {
			edge := serverTestUpdateEdge("1.1.0", "1.2.0")
			edge.RequiresRestart = true
			return edge
		}(),
	}}
	if err := app.ConfigureUpdateStatusForTesting("v1.0.0", "stable", manifest); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.ClearUpdateManifestForTesting)

	response := requestUpdateStatus(t, app)
	if response.Status != UpdateStatusAvailable || !response.Available || response.TargetVersion != "1.2.0" {
		t.Fatalf("unexpected available status: %+v", response)
	}
	if len(response.Path) != 2 || !response.RequiresRestart {
		t.Fatalf("unexpected validated path: %+v", response)
	}
}

func requestUpdateStatus(t *testing.T, app *Server) UpdateStatusResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, UpdateStatusPath, nil)
	app.UpdateRoutes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response UpdateStatusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return response
}

func serverTestUpdateEdge(source, target string) updatepkg.Edge {
	return updatepkg.Edge{
		SourceVersion:  source,
		TargetVersion:  target,
		DB:             updatepkg.SchemaTransition{From: 1, To: 1},
		Config:         updatepkg.SchemaTransition{From: 1, To: 1},
		Preferences:    updatepkg.SchemaTransition{From: 1, To: 1},
		RequiresBackup: true,
		Notes:          updatepkg.Notes{"Validated metadata only."},
	}
}
