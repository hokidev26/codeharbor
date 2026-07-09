package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"codeharbor/internal/config"
	"codeharbor/internal/db"
)

func TestRunRoutesExposeSummaryAndPendingApprovals(t *testing.T) {
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
	run, err := store.CreateRun(ctx, db.Run{NarratorID: narrator.ID, Status: "running"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{NarratorID: narrator.ID, RunID: run.ID, Role: "assistant", ContentText: "hello"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, db.ToolCall{NarratorID: narrator.ID, RunID: run.ID, ToolUseID: "tool-1", ToolName: "Bash", InputJSON: json.RawMessage(`{"command":"printf hi"}`), Status: "pending_approval"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddAPIRequest(ctx, db.APIRequest{NarratorID: narrator.ID, RunID: run.ID, Kind: "model", Provider: "fake", Model: "test", InputTokens: 12, OutputTokens: 3, CostUSD: 0.001}); err != nil {
		t.Fatal(err)
	}

	app := New(config.Config{}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/runs?limit=5", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var runs []db.Run
	if err := json.NewDecoder(recorder.Body).Decode(&runs); err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("unexpected runs response: %+v", runs)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/runs/"+run.ID, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var summary db.RunSummary
	if err := json.NewDecoder(recorder.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.Run.ID != run.ID || summary.MessageCount != 1 || summary.ToolCallCount != 1 || summary.PendingApprovals != 1 || summary.APIRequestCount != 1 || summary.InputTokens != 12 || summary.OutputTokens != 3 {
		t.Fatalf("unexpected run summary: %+v", summary)
	}
	if len(summary.RecentMessages) != 1 || summary.RecentMessages[0].ContentText != "hello" {
		t.Fatalf("unexpected recent message preview: %+v", summary.RecentMessages)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/narrators/"+narrator.ID+"/tool-calls/pending", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var pending []db.ToolCall
	if err := json.NewDecoder(recorder.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].ToolUseID != "tool-1" || pending[0].RunID != run.ID {
		t.Fatalf("unexpected pending calls response: %+v", pending)
	}
}
