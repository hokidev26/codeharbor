package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
	"autoto/internal/tools"
)

func TestReadOnlyRunCapturesModelOutputWhileKeepingRawAuditResult(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	longTail := "AUDIT_ONLY_" + strings.Repeat("z", 300)
	fileContent := strings.Repeat("preview-padding\n", 20) + "TARGET_LINE\n" + longTail
	if err := writeTestFile(projectDir, "pipeline.txt", fileContent); err != nil {
		t.Fatal(err)
	}
	store, createdAgent := newAgentTestStore(t, projectDir, "readOnly")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{AgentID: createdAgent.ID, Role: "user", ContentText: "inspect pipeline.txt"}); err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{turns: [][]providers.Event{
		{
			{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "pipeline-start", Name: "StartPipeline", Input: json.RawMessage(`{"label":"inspect output"}`)}},
			{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "pipeline-read", Name: "Read", Input: json.RawMessage(`{"file_path":"pipeline.txt"}`)}},
			{Type: "done", Done: true, StopReason: "tool_use"},
		},
		{
			{Type: "text", Text: "premature answer from previews"},
			{Type: "done", Done: true, StopReason: "end_turn"},
		},
		{
			{Type: "tool_call", ToolCall: &providers.ToolCall{ID: "pipeline-end", Name: "EndPipeline", Input: json.RawMessage(`{"rule":"from p1 | grep TARGET_LINE","format":"plain"}`)}},
			{Type: "done", Done: true, StopReason: "tool_use"},
		},
		{
			{Type: "text", Text: "pipeline complete"},
			{Type: "done", Done: true, StopReason: "end_turn"},
		},
	}}
	runner := newAgentTestRunner(store, provider, config.AgentConfig{ContinuationSegmentTurns: 6, MaxTotalTurns: 12, MaxContinuations: 2})
	runner.Run(ctx, createdAgent.ID)

	if provider.requestCount() != 4 {
		t.Fatalf("unexpected model request count: %d", provider.requestCount())
	}
	if !requestContainsSystemKind(provider.request(1), "server_tool_output_pipeline_control") || !requestContainsSystemKind(provider.request(2), "server_tool_output_pipeline_control") {
		t.Fatal("active pipeline control was not injected before subsequent turns")
	}
	messages, err := store.ListMessages(ctx, createdAgent.ID)
	if err != nil {
		t.Fatal(err)
	}
	var readMessage, endMessage string
	for _, message := range messages {
		switch message.ParentToolID {
		case "pipeline-read":
			readMessage = message.ContentText
		case "pipeline-end":
			endMessage = message.ContentText
		}
		if strings.Contains(message.ContentText, "premature answer from previews") {
			t.Fatalf("premature final answer was persisted: %+v", message)
		}
	}
	if !strings.Contains(readMessage, "Captured as p1") || strings.Contains(readMessage, longTail) {
		t.Fatalf("model-visible read result was not compacted safely: %q", readMessage)
	}
	if !strings.Contains(endMessage, "TARGET_LINE") {
		t.Fatalf("EndPipeline did not return filtered capture: %q", endMessage)
	}
	runs, err := store.ListRuns(ctx, createdAgent.ID, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("load run: runs=%+v err=%v", runs, err)
	}
	calls, err := store.ListToolCallsByRun(ctx, createdAgent.ID, runs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	foundRaw := false
	for _, call := range calls {
		if call.ToolUseID == "pipeline-read" {
			foundRaw = strings.Contains(string(call.OutputJSON), longTail)
		}
	}
	if !foundRaw {
		t.Fatal("raw Read output was not retained in the Tool Call audit record")
	}
	if runner.toolOutputPipelineActive(createdAgent.ID, runs[0].ID) {
		t.Fatal("pipeline state remained active after successful EndPipeline")
	}
}

func TestDirectPipelineControlCallIsDeniedEvenForReadOnlyAgent(t *testing.T) {
	ctx := context.Background()
	store, createdAgent := newAgentTestStore(t, t.TempDir(), "readOnly")
	defer store.Close()
	runner := newAgentTestRunner(store, &scriptedProvider{}, config.AgentConfig{})
	result, err := runner.ExecuteTool(ctx, createdAgent.ID, tools.Call{Name: "StartPipeline", Input: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || !strings.Contains(result.Output, "only available inside the model loop") {
		t.Fatalf("direct pipeline control was not denied: %+v", result)
	}
}

func requestContainsSystemKind(request providers.GenerateRequest, kind string) bool {
	for _, message := range request.Messages {
		for _, block := range message.Blocks {
			if block.Kind == kind {
				return true
			}
		}
	}
	return false
}
