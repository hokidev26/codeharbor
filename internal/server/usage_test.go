package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestUsageSummaryRouteReturnsDatabaseStats(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:gpt-4.1-mini", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, Role: "user", ContentText: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, Role: "assistant", ContentText: "hi"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, db.ToolCall{AgentID: agent.ID, MessageID: userMessage.ID, ToolUseID: "tool-1", ToolName: "Read", Status: "succeeded", DurationMS: 120}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, db.ToolCall{AgentID: agent.ID, ToolUseID: "tool-2", ToolName: "Read", Status: "failed", DurationMS: 30, ErrorMessage: "boom"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateBackend(ctx, db.Backend{Name: "Local", Kind: "local", BaseURL: "http://127.0.0.1:8000", APIKey: "secret"}); err != nil {
		t.Fatal(err)
	}
	now := db.Now()
	if _, err := store.DB().ExecContext(ctx, `INSERT INTO api_requests (id, agent_id, message_id, kind, provider, model, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens, duration_ms, cost_usd, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, db.NewID(), agent.ID, userMessage.ID, "model", "openai", "gpt-4.1-mini", 100, 40, 5, 12, 250, 0.03, "", now); err != nil {
		t.Fatal(err)
	}
	app := New(config.Config{}, store, nil, nil)
	recorder := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/api/usage/summary", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body usageSummaryResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Counts.Projects != 1 || body.Counts.Worklines != 1 || body.Counts.Agents != 1 {
		t.Fatalf("unexpected core counts: %+v", body.Counts)
	}
	if body.Counts.Messages != 2 || body.Messages.ByRole["user"] != 1 || body.Messages.ByRole["assistant"] != 1 {
		t.Fatalf("unexpected message stats: %+v", body.Messages)
	}
	if body.Counts.ToolCalls != 2 || body.ToolCalls.ByStatus["succeeded"] != 1 || body.ToolCalls.ByStatus["failed"] != 1 {
		t.Fatalf("unexpected tool stats: %+v", body.ToolCalls)
	}
	if len(body.ToolCalls.TopTools) != 1 || body.ToolCalls.TopTools[0].Name != "Read" || body.ToolCalls.TopTools[0].Count != 2 {
		t.Fatalf("unexpected top tools: %+v", body.ToolCalls.TopTools)
	}
	if body.APIRequests.InputTokens != 100 || body.APIRequests.OutputTokens != 40 || body.APIRequests.ReasoningTokens != 5 || body.APIRequests.CachedInputTokens != 12 {
		t.Fatalf("unexpected api token stats: %+v", body.APIRequests)
	}
	if body.Backends.Active != 1 || body.Backends.APIKeyConfigured != 1 {
		t.Fatalf("unexpected backend stats: %+v", body.Backends)
	}
}
