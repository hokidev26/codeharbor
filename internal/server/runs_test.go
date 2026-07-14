package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestRunRoutesExposeSummaryAndPendingApprovals(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, db.Run{AgentID: agent.ID, Status: "running"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, RunID: run.ID, Role: "assistant", ContentText: "hello"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, db.ToolCall{AgentID: agent.ID, RunID: run.ID, ToolUseID: "tool-1", ToolName: "Bash", InputJSON: json.RawMessage(`{"command":"printf hi"}`), Status: "pending_approval"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 13; i++ {
		if _, err := store.AddToolCall(ctx, db.ToolCall{AgentID: agent.ID, RunID: run.ID, ToolUseID: fmt.Sprintf("completed-%02d", i), ToolName: "Read", InputJSON: json.RawMessage(fmt.Sprintf(`{"file_path":"secret-%02d.txt"}`, i)), OutputJSON: json.RawMessage(`{"output":"private"}`), Status: "completed"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.AddAPIRequest(ctx, db.APIRequest{AgentID: agent.ID, RunID: run.ID, Kind: "model", Provider: "fake", Model: "test", InputTokens: 12, OutputTokens: 3, CostUSD: 0.001}); err != nil {
		t.Fatal(err)
	}

	app := New(config.Config{}, store, nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/agents/"+agent.ID+"/runs?limit=5", nil)
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
	request = httptest.NewRequest(http.MethodGet, "/api/agents/"+agent.ID+"/runs/"+run.ID, nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var summary db.RunSummary
	if err := json.NewDecoder(recorder.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.Run.ID != run.ID || summary.MessageCount != 1 || summary.ToolCallCount != 14 || summary.PendingApprovals != 1 || summary.APIRequestCount != 1 || summary.InputTokens != 12 || summary.OutputTokens != 3 {
		t.Fatalf("unexpected run summary: %+v", summary)
	}
	if len(summary.ToolCalls) != 12 || strings.Contains(recorder.Body.String(), "inputJson") || strings.Contains(recorder.Body.String(), "secret-") || strings.Contains(recorder.Body.String(), "private") {
		t.Fatalf("run summary must return a bounded lightweight tool projection: %s", recorder.Body.String())
	}
	if len(summary.RecentMessages) != 1 || summary.RecentMessages[0].ContentText != "hello" {
		t.Fatalf("unexpected recent message preview: %+v", summary.RecentMessages)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/agents/"+agent.ID+"/runs/active", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected active summary 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var active db.ActiveRunSummary
	if err := json.NewDecoder(recorder.Body).Decode(&active); err != nil {
		t.Fatal(err)
	}
	if active.Run.ID != run.ID || active.Run.Status != "running" || active.ToolCallCount != 14 || active.PendingApprovals != 1 || len(active.ToolCalls) != 6 || strings.Contains(recorder.Body.String(), "inputJson") {
		t.Fatalf("unexpected lightweight active summary: %+v", active)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/agents/"+agent.ID+"/runs/"+run.ID+"/tool-calls", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected full tool list 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var fullCalls []db.ToolCall
	if err := json.NewDecoder(recorder.Body).Decode(&fullCalls); err != nil {
		t.Fatal(err)
	}
	if len(fullCalls) != 14 || len(fullCalls[0].InputJSON) == 0 {
		t.Fatalf("expected complete tool details endpoint, got %+v", fullCalls)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/agents/"+agent.ID+"/tool-calls/pending", nil)
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
