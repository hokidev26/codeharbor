package automation

import (
	"encoding/json"
	"testing"
	"time"

	"autoto/internal/agent"
)

func TestDeliveryDedupeUsesExecutionGenerationAcrossRecoveryPaths(t *testing.T) {
	base := agent.NotificationEvent{Event: "completed", AgentID: "agent-1", RunID: "live-run", Status: "completed", ExecutionGeneration: 7}
	recovered := base
	recovered.RunID = "snapshot-run-id"
	if deliveryDedupe("webhook", "sink", base) != deliveryDedupe("webhook", "sink", recovered) {
		t.Fatal("same execution generation and event should dedupe across live/snapshot paths")
	}
	next := base
	next.ExecutionGeneration = 8
	if deliveryDedupe("webhook", "sink", base) == deliveryDedupe("webhook", "sink", next) {
		t.Fatal("next execution generation must produce a new delivery key")
	}
	approvalA := base
	approvalA.Event = "approval_required"
	approvalA.ToolUseID = "tool-a"
	approvalB := approvalA
	approvalB.ToolUseID = "tool-b"
	if deliveryDedupe("telegram", "pairing", approvalA) == deliveryDedupe("telegram", "pairing", approvalB) {
		t.Fatal("approval events for different tools must not collapse")
	}
	legacyA := base
	legacyA.ExecutionGeneration = 0
	legacyA.RunID = "legacy-a"
	legacyB := legacyA
	legacyB.RunID = "legacy-b"
	if deliveryDedupe("webhook", "sink", legacyA) == deliveryDedupe("webhook", "sink", legacyB) {
		t.Fatal("legacy generation-zero events must retain run id identity")
	}
}

func TestNotificationPayloadCarriesExecutionGeneration(t *testing.T) {
	payload, err := notificationPayload(agent.NotificationEvent{Event: "error", AgentID: "agent", RunID: "run", Status: "error", ExecutionGeneration: 12}, time.Unix(0, 0))
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["executionGeneration"] != float64(12) {
		t.Fatalf("execution generation missing from payload: %s", payload)
	}
}
