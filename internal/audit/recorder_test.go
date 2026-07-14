package audit

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"autoto/internal/db"
)

func TestStoreRecorderRecordsStructuredEventAndReturnsFailures(t *testing.T) {
	ctx := context.Background()
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	recorder := NewRecorder(store)
	if err := recorder.Record(ctx, Event{
		Category: "automation",
		Action:   "policy.evaluated",
		Actor:    "scheduler",
		Outcome:  "success",
		Risk:     "low",
		Details:  map[string]any{"decision": "allow", "ruleCount": 2},
	}); err != nil {
		t.Fatal(err)
	}
	events, err := store.ListAutomationAuditEvents(ctx, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != "policy.evaluated" || !strings.Contains(string(events[0].DetailsJSON), `"decision":"allow"`) {
		t.Fatalf("unexpected recorded event: %+v", events)
	}

	if err := recorder.Record(ctx, Event{
		Category: "automation",
		Action:   "tool.requested",
		Actor:    "agent",
		Outcome:  "denied",
		Risk:     "high",
		Details:  map[string]any{"tool": map[string]any{"rawToolInput": map[string]any{"command": "sensitive"}}},
	}); err == nil || !strings.Contains(err.Error(), "forbidden sensitive key") {
		t.Fatalf("expected raw tool input rejection, got %v", err)
	}

	if _, err := store.DB().ExecContext(ctx, `CREATE TRIGGER fail_automation_audit BEFORE INSERT ON automation_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := recorder.Record(ctx, Event{Category: "automation", Action: "run.failed", Actor: "scheduler", Outcome: "failure", Risk: "medium"}); err == nil || !strings.Contains(err.Error(), "audit unavailable") {
		t.Fatalf("expected recorder to return storage failure, got %v", err)
	}
}

func TestStoreRecorderRejectsNilStoreAndUnencodableDetails(t *testing.T) {
	ctx := context.Background()
	if err := NewStoreRecorder(nil).Record(ctx, Event{}); err == nil {
		t.Fatal("expected nil store recorder to fail")
	}
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := NewStoreRecorder(store).Record(ctx, Event{
		Category: "automation", Action: "encode.failed", Actor: "test", Outcome: "error", Risk: "none",
		Details: map[string]any{"unsupported": make(chan int)},
	}); err == nil || !strings.Contains(err.Error(), "encode automation audit details") {
		t.Fatalf("expected encoding failure, got %v", err)
	}
}
