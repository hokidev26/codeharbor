package agent

import (
	"context"
	"strings"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
	"autoto/internal/providers"
)

func TestSelectContextTurnCandidatesKeepsCompleteRecentTurns(t *testing.T) {
	messages := []db.Message{
		{ID: "u1", Role: "user"}, {ID: "a1", Role: "assistant"}, {ID: "t1", Role: "tool", ParentToolID: "call-1"},
		{ID: "u2", Role: "user"}, {ID: "a2", Role: "assistant"},
		{ID: "u3", Role: "user"}, {ID: "a3", Role: "assistant"},
	}
	got := selectContextTurnCandidates(messages, "", 2)
	if len(got) != 3 || got[0].ID != "u1" || got[len(got)-1].ID != "t1" {
		t.Fatalf("expected first complete turn, got %+v", got)
	}
}

func TestContextTurnDetectionDoesNotCountToolResultsAsUserTurns(t *testing.T) {
	messages := []db.Message{
		{ID: "u1", Role: "user"},
		{ID: "tool-result", Role: "user", ParentToolID: "call-1"},
		{ID: "u2", Role: "user"},
		{ID: "u3", Role: "user"},
	}
	got := selectContextTurnCandidates(messages, "", 2)
	if len(got) != 2 || got[0].ID != "u1" || got[1].ID != "tool-result" {
		t.Fatalf("tool result was counted as a separate turn: %+v", got)
	}
}

func TestInvalidContextBoundaryNeverDuplicatesSummary(t *testing.T) {
	messages := []db.Message{{ID: "message-1", Role: "user", ContentText: "durable text"}}
	agent := db.Agent{ContextSummary: "untrusted stale summary", PruneBoundaryMessageID: "missing-boundary"}
	providerMessages := providerMessagesForContext(agent, messages)
	if len(providerMessages) != 1 || providerMessages[0].Content != "durable text" {
		t.Fatalf("invalid boundary duplicated or hid raw context: %+v", providerMessages)
	}
}

func TestContextStatusUsesRunnerEstimateAndWindowClass(t *testing.T) {
	ctx := context.Background()
	store, agent := newAgentTestStore(t, t.TempDir(), "acceptEdits")
	defer store.Close()
	if _, err := store.AddMessage(ctx, db.Message{AgentID: agent.ID, Role: "user", ContentText: strings.Repeat("context ", 100)}); err != nil {
		t.Fatal(err)
	}
	runner := newAgentTestRunner(store, &scriptedProvider{}, config.AgentConfig{ContextTokenLimit: 700001})
	runner.SetContextManagementConfig(config.ContextManagementConfig{})
	status, _, err := runner.ContextStatus(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Estimated || status.EstimatedTokens <= 0 || status.LimitTokens != 700001 || status.WindowClass != ContextWindowLarge || status.LatestMessageID == "" {
		t.Fatalf("unexpected estimated context status: %+v", status)
	}
}

func TestRequiredPipelineControlParticipatesInBudget(t *testing.T) {
	conversation := []providers.Message{{Role: "user", Content: "hello"}}
	text := strings.Repeat("required pipeline control ", 20)
	pipeline := providers.Message{Role: "system", Content: text, Blocks: []providers.ContentBlock{{Type: "text", Text: text, Kind: "server_tool_output_pipeline_control"}}}
	base := estimateRequestTokens("", conversation, nil)
	if _, err := fitTurnSystemControls("", conversation, nil, base, turnSystemControls{pipeline: &pipeline}); err == nil || !strings.Contains(err.Error(), "context token budget exceeded") {
		t.Fatalf("expected required pipeline control budget failure, got %v", err)
	}
}
