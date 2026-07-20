package db

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestAddAPIRequestPersistsUsage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.AddMessage(ctx, Message{AgentID: agent.ID, Role: "user", ContentText: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"id": "raw"})
	request, err := store.AddAPIRequest(ctx, APIRequest{AgentID: agent.ID, MessageID: message.ID, Provider: "openai", Model: "gpt-test", InputTokens: 10, OutputTokens: 4, CachedInputTokens: 2, ReasoningTokens: 1, TTFTMS: 23, DurationMS: 123, ErrorMessage: "", RawDumpJSON: raw})
	if err != nil {
		t.Fatal(err)
	}
	if request.ID == "" || request.Kind != "model" || request.CreatedAt == "" {
		t.Fatalf("unexpected request metadata: %+v", request)
	}
	var count, inputTokens, outputTokens, ttftMS int64
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(MAX(ttft_ms),0) FROM api_requests WHERE agent_id = ? AND message_id = ?`, agent.ID, message.ID).Scan(&count, &inputTokens, &outputTokens, &ttftMS); err != nil {
		t.Fatal(err)
	}
	if count != 1 || inputTokens != 10 || outputTokens != 4 || ttftMS != 23 {
		t.Fatalf("unexpected stored api request stats: count=%d input=%d output=%d ttft=%d", count, inputTokens, outputTokens, ttftMS)
	}
}

func TestRunStoreRoundTripsAndSummarizes(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	trigger, err := store.AddMessage(ctx, Message{AgentID: agent.ID, Role: "user", ContentText: "start"})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, Run{AgentID: agent.ID, TriggerMessageID: trigger.ID})
	if err != nil {
		t.Fatal(err)
	}
	assistant, err := store.AddMessage(ctx, Message{AgentID: agent.ID, RunID: run.ID, Role: "assistant", ContentText: "tool"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, ToolCall{AgentID: agent.ID, RunID: run.ID, MessageID: assistant.ID, ToolUseID: "tool-1", ToolName: "Read", InputJSON: json.RawMessage(`{"file_path":"README.md"}`), Status: "pending_approval"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddAPIRequest(ctx, APIRequest{AgentID: agent.ID, RunID: run.ID, Provider: "openai", Model: "gpt", InputTokens: 10, OutputTokens: 5, CostUSD: 0.25}); err != nil {
		t.Fatal(err)
	}
	pending, err := store.ListPendingToolCalls(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].RunID != run.ID || pending[0].ToolUseID != "tool-1" {
		t.Fatalf("unexpected pending calls: %+v", pending)
	}
	if err := store.CompleteRun(ctx, run.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	summary, err := store.RunSummary(ctx, agent.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Run.Status != "completed" || summary.MessageCount != 1 || summary.ToolCallCount != 1 || summary.PendingApprovals != 1 || summary.APIRequestCount != 1 || summary.InputTokens != 10 || summary.OutputTokens != 5 || summary.CostUSD != 0.25 {
		t.Fatalf("unexpected run summary: %+v", summary)
	}
	runs, err := store.ListRuns(ctx, agent.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("unexpected runs: %+v", runs)
	}
}

func TestRunAndToolLifecycleTimestampsFollowStateTransitions(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Lifecycle", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	queued, err := store.CreateRun(ctx, Run{AgentID: agent.ID, Status: "pending"})
	if err != nil {
		t.Fatal(err)
	}
	if queued.StartedAt != "" || queued.CompletedAt != "" {
		t.Fatalf("queued run must not have lifecycle times: %+v", queued)
	}
	if err := store.UpdateRunStatus(ctx, queued.ID, "running", ""); err != nil {
		t.Fatal(err)
	}
	started, err := store.GetRun(ctx, agent.ID, queued.ID)
	if err != nil {
		t.Fatal(err)
	}
	if started.StartedAt == "" || started.CompletedAt != "" {
		t.Fatalf("running run must have only a start time: %+v", started)
	}
	if err := store.UpdateRunStatus(ctx, queued.ID, "running", ""); !IsConflict(err) {
		t.Fatalf("second queued-to-running transition must conflict, got %v", err)
	}
	if err := store.CompleteRun(ctx, queued.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	completed, err := store.GetRun(ctx, agent.ID, queued.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.StartedAt != started.StartedAt || completed.CompletedAt == "" || completed.UpdatedAt == "" {
		t.Fatalf("completion must preserve start and write completion/update time: %+v", completed)
	}

	call, err := store.AddToolCall(ctx, ToolCall{AgentID: agent.ID, RunID: queued.ID, ToolUseID: "lifecycle-tool", ToolName: "Bash", InputJSON: json.RawMessage(`{"command":"printf hi"}`), Status: "pending_approval"})
	if err != nil {
		t.Fatal(err)
	}
	if call.StartedAt != "" || call.CompletedAt != "" || call.UpdatedAt == "" {
		t.Fatalf("pending tool must not have execution times: %+v", call)
	}
	if err := store.UpdateToolCallApproval(ctx, agent.ID, call.ToolUseID, "approved", "tester", "", "ok", ""); err != nil {
		t.Fatal(err)
	}
	approved, err := store.GetToolCallByUseID(ctx, agent.ID, call.ToolUseID)
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != "approved" || approved.StartedAt != "" || approved.CompletedAt != "" || approved.PermissionDecidedAt == "" {
		t.Fatalf("approval must not start execution: %+v", approved)
	}
	if err := store.MarkToolCallRunning(ctx, agent.ID, call.ToolUseID); err != nil {
		t.Fatal(err)
	}
	runningCall, err := store.GetToolCallByUseID(ctx, agent.ID, call.ToolUseID)
	if err != nil {
		t.Fatal(err)
	}
	if runningCall.Status != "running" || runningCall.StartedAt == "" || runningCall.CompletedAt != "" {
		t.Fatalf("running tool must have only start time: %+v", runningCall)
	}
	if err := store.UpdateToolCallResult(ctx, agent.ID, call.ToolUseID, json.RawMessage(`{"output":"ok"}`), "completed", 12, ""); err != nil {
		t.Fatal(err)
	}
	finished, err := store.GetToolCallByUseID(ctx, agent.ID, call.ToolUseID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != "completed" || finished.StartedAt != runningCall.StartedAt || finished.CompletedAt == "" || finished.UpdatedAt == "" {
		t.Fatalf("completed tool must retain start and have completion/update times: %+v", finished)
	}
}
