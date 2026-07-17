package db

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func openLearnedFeatureStore(t *testing.T) (*Store, Project, Agent) {
	t.Helper()
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "learned.db"))
	if err != nil {
		t.Fatal(err)
	}
	project, _, agent, err := store.CreateProject(ctx, "Learned", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, project, agent
}

func TestExecutionGenerationIsMonotonicUnderConcurrentCreates(t *testing.T) {
	store, _, agent := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()
	const count = 12
	generations := make(chan int64, count)
	errs := make(chan error, count)
	var wg sync.WaitGroup
	for index := 0; index < count; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			run, err := store.CreateRun(ctx, Run{AgentID: agent.ID, Status: "pending"})
			if err != nil {
				errs <- err
				return
			}
			generations <- run.ExecutionGeneration
		}()
	}
	wg.Wait()
	close(errs)
	close(generations)
	for err := range errs {
		t.Fatal(err)
	}
	seen := make(map[int64]bool, count)
	for generation := range generations {
		seen[generation] = true
	}
	for expected := int64(1); expected <= count; expected++ {
		if !seen[expected] {
			t.Fatalf("missing execution generation %d: %#v", expected, seen)
		}
	}
	maximum, err := store.MaxExecutionGeneration(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if maximum != count {
		t.Fatalf("expected max generation %d, got %d", count, maximum)
	}
}

func TestSpecBoardProtectedCASGoalAndOrdering(t *testing.T) {
	store, _, agent := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()
	board, err := store.CreateSpecTask(ctx, SpecTask{AgentID: agent.ID, Text: "first", Status: "todo", Protected: true})
	if err != nil {
		t.Fatal(err)
	}
	board, err = store.CreateSpecTask(ctx, SpecTask{AgentID: agent.ID, Text: "second", Status: "doing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Tasks) != 2 || board.Tasks[0].Text != "first" || board.Tasks[1].Text != "second" {
		t.Fatalf("unexpected board: %+v", board)
	}
	status := "done"
	if _, err := store.UpdateSpecTask(ctx, agent.ID, board.Tasks[0].ID, SpecTaskMutation{Status: &status, ExpectedRevision: board.Tasks[0].Revision}); !errors.Is(err, ErrConflict) {
		t.Fatalf("protected update must require acknowledgement, got %v", err)
	}
	board, err = store.UpdateSpecTask(ctx, agent.ID, board.Tasks[0].ID, SpecTaskMutation{Status: &status, ExpectedRevision: board.Tasks[0].Revision, AcknowledgeProtected: true, Actor: "test"})
	if err != nil {
		t.Fatal(err)
	}
	board, err = store.ReorderSpecTasks(ctx, agent.ID, []string{board.Tasks[1].ID, board.Tasks[0].ID}, board.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if board.Tasks[0].Text != "second" || board.Tasks[1].Text != "first" {
		t.Fatalf("task order was not preserved: %+v", board.Tasks)
	}
	goalBoard, confirmation, err := store.CreateGoal(ctx, agent.ID, "ship the learned features")
	if err != nil {
		t.Fatal(err)
	}
	if confirmation.QueueState != "idle" || confirmation.Status != "confirmed" {
		t.Fatalf("unexpected goal confirmation: %+v", confirmation)
	}
	if len(goalBoard.Tasks) != 3 || !goalBoard.Tasks[2].Protected || goalBoard.Tasks[2].SourceType != "goal" {
		t.Fatalf("goal task was not persisted: %+v", goalBoard.Tasks)
	}
}

func TestSpecReminderSnapshotIsBoundedActiveAndReadOnly(t *testing.T) {
	store, _, agent := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()

	var board SpecBoard
	for _, task := range []SpecTask{
		{AgentID: agent.ID, Text: "completed first", Status: "done"},
		{AgentID: agent.ID, Text: "active doing", Status: "doing", Protected: true},
		{AgentID: agent.ID, Text: "active todo", Status: "todo"},
		{AgentID: agent.ID, Text: "active blocked", Status: "blocked"},
		{AgentID: agent.ID, Text: "completed last", Status: "done"},
	} {
		var err error
		board, err = store.CreateSpecTask(ctx, task)
		if err != nil {
			t.Fatal(err)
		}
	}

	snapshot, err := store.ReadSpecReminderSnapshot(ctx, agent.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.AgentID != agent.ID || snapshot.Revision != board.Revision || snapshot.Omitted != 1 || len(snapshot.Tasks) != 2 {
		t.Fatalf("unexpected bounded snapshot: %+v", snapshot)
	}
	if snapshot.Tasks[0].Text != "active doing" || !snapshot.Tasks[0].Protected || snapshot.Tasks[1].Text != "active todo" {
		t.Fatalf("active task ordering or projection changed: %+v", snapshot.Tasks)
	}

	countOnly, err := store.ReadSpecReminderSnapshot(ctx, agent.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if countOnly.Revision != board.Revision || len(countOnly.Tasks) != 0 || countOnly.Omitted != 3 {
		t.Fatalf("unexpected count-only snapshot: %+v", countOnly)
	}
	after, err := store.GetSpecBoard(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != board.Revision || len(after.Tasks) != len(board.Tasks) {
		t.Fatalf("reminder read mutated the board: before=%+v after=%+v", board, after)
	}

	emptyAgent, err := store.CreateAgent(ctx, Agent{Title: "Empty Spec", Model: "openai:test", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	empty, err := store.ReadSpecReminderSnapshot(ctx, emptyAgent.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Revision != 0 || len(empty.Tasks) != 0 || empty.Omitted != 0 {
		t.Fatalf("unexpected empty snapshot: %+v", empty)
	}
	if _, err := store.ReadSpecReminderSnapshot(ctx, "missing-agent", 2); err == nil {
		t.Fatal("expected a missing Agent to be rejected")
	}
}

func TestAgentReasoningEffortXHighRoundTripsAcrossModelChanges(t *testing.T) {
	store, _, agent := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()

	updated, err := store.UpdateAgentReasoningEffort(ctx, agent.ID, "xhigh")
	if err != nil {
		t.Fatal(err)
	}
	if updated.ReasoningEffort != "xhigh" {
		t.Fatalf("expected persisted xhigh effort, got %+v", updated)
	}
	updated, err = store.UpdateAgentModel(ctx, agent.ID, "anthropic:claude")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Model != "anthropic:claude" || updated.ReasoningEffort != "xhigh" {
		t.Fatalf("model switch should preserve agent reasoning effort for runtime validation: %+v", updated)
	}
	if _, err := store.UpdateAgentReasoningEffort(ctx, agent.ID, "extreme"); err == nil {
		t.Fatal("expected invalid reasoning effort to be rejected")
	}
}

func TestV25ReasoningEffortMigratesLegacyBooleanEncodings(t *testing.T) {
	ctx := context.Background()
	raw := openRawDB(t, filepath.Join(t.TempDir(), "v25-legacy-reasoning.db"))
	defer raw.Close()
	if _, err := raw.ExecContext(ctx, `
CREATE TABLE agents (id TEXT PRIMARY KEY, reasoning_effort);
INSERT INTO agents (id, reasoning_effort) VALUES
  ('integer-zero', 0),
  ('integer-one', 1),
  ('text-zero', '0'),
  ('text-one', '1'),
  ('text-false', 'false'),
  ('text-true', 'true'),
  ('auto', 'auto'),
  ('low', 'low'),
  ('medium', 'medium'),
  ('high', 'high'),
  ('unknown', 'legacy-value');
`); err != nil {
		t.Fatal(err)
	}
	tx, err := raw.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateV25ModelClient(ctx, tx); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"integer-zero": "auto", "integer-one": "high", "text-zero": "auto", "text-one": "high",
		"text-false": "auto", "text-true": "high", "auto": "auto", "low": "low", "medium": "medium", "high": "high",
		"unknown": "auto",
	}
	for id, expected := range want {
		var actual string
		if err := raw.QueryRowContext(ctx, `SELECT reasoning_effort FROM agents WHERE id = ?`, id).Scan(&actual); err != nil {
			t.Fatalf("read migrated %s: %v", id, err)
		}
		if actual != expected {
			t.Errorf("migrated %s as %q, want %q", id, actual, expected)
		}
	}
}

func TestReasoningEffortXHighMigrationPreservesLegacyValues(t *testing.T) {
	ctx := context.Background()
	raw := openRawDB(t, filepath.Join(t.TempDir(), "legacy-reasoning.db"))
	defer raw.Close()
	if _, err := raw.ExecContext(ctx, `
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  reasoning_effort TEXT,
  CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('auto', 'low', 'medium', 'high'))
);
CREATE TRIGGER agents_reasoning_effort_insert BEFORE INSERT ON agents
WHEN NEW.reasoning_effort IS NOT NULL AND NEW.reasoning_effort NOT IN ('auto', 'low', 'medium', 'high')
BEGIN SELECT RAISE(ABORT, 'invalid agent reasoning effort'); END;
CREATE TRIGGER agents_reasoning_effort_update BEFORE UPDATE OF reasoning_effort ON agents
WHEN NEW.reasoning_effort IS NOT NULL AND NEW.reasoning_effort NOT IN ('auto', 'low', 'medium', 'high')
BEGIN SELECT RAISE(ABORT, 'invalid agent reasoning effort'); END;
INSERT INTO agents (id, reasoning_effort) VALUES ('legacy-agent', 'high');
PRAGMA user_version = 28;
`); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(ctx, raw); err != nil {
		t.Fatal(err)
	}
	var effort string
	if err := raw.QueryRowContext(ctx, `SELECT reasoning_effort FROM agents WHERE id = 'legacy-agent'`).Scan(&effort); err != nil || effort != "high" {
		t.Fatalf("legacy reasoning effort was not preserved: effort=%q err=%v", effort, err)
	}
	if _, err := raw.ExecContext(ctx, `UPDATE agents SET reasoning_effort = 'xhigh' WHERE id = 'legacy-agent'`); err != nil {
		t.Fatalf("xhigh should be accepted after migration: %v", err)
	}
	if _, err := raw.ExecContext(ctx, `UPDATE agents SET reasoning_effort = 'extreme' WHERE id = 'legacy-agent'`); err == nil {
		t.Fatal("invalid reasoning effort should remain rejected after migration")
	}
}

func TestModelAggregateOrderAndRuntimeIdentity(t *testing.T) {
	store, _, _ := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()
	created, err := store.UpsertModelAggregate(ctx, ModelAggregate{Name: "fast-first", Mode: "priority", Members: []string{"openai:gpt-5", "anthropic:claude"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || created.Members[0] != "openai:gpt-5" {
		t.Fatalf("unexpected aggregate: %+v", created)
	}
	updated, err := store.UpsertModelAggregate(ctx, ModelAggregate{Name: created.Name, Members: []string{"anthropic:claude", "openai:gpt-5"}}, created.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Members[0] != "anthropic:claude" || updated.Revision != 2 {
		t.Fatalf("aggregate order/revision was lost: %+v", updated)
	}
	if _, err := store.UpsertModelAggregate(ctx, ModelAggregate{Name: "nested", Members: []string{"aggregate:fast-first"}}, 0); err == nil {
		t.Fatal("expected nested aggregate rejection")
	}
	settings, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	original := settings.InstallationID
	tier := "education_k12"
	effort := "high"
	email := "admin@example.edu"
	settings, err = store.UpdateRuntimeSettings(ctx, RuntimeSettingsPatch{DefaultReasoningEffort: &effort, SubscriptionTier: &tier, AccountEmail: &email, ExpectedRevision: settings.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if settings.SubscriptionTier != tier || settings.DefaultReasoningEffort != effort {
		t.Fatalf("unexpected runtime settings: %+v", settings)
	}
	settings, err = store.RotateInstallationID(ctx, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if settings.InstallationID == original {
		t.Fatal("installation id did not rotate")
	}
}

func TestRemoteExecutionScaffoldFailsClosedAndRedactsFingerprint(t *testing.T) {
	store, project, agent := openLearnedFeatureStore(t)
	defer store.Close()
	ctx := context.Background()
	device, err := store.RegisterRemoteExecutionDevice(ctx, ExecutionDeviceRegistration{Name: "build-host", IdentityFingerprint: "sha256:0123456789abcdef", Capabilities: json.RawMessage(`{"tools":["Read"]}`)})
	if err != nil {
		t.Fatal(err)
	}
	if device.Enabled || device.Status != "disabled" {
		t.Fatalf("remote device must be disabled by default: %+v", device)
	}
	encoded, err := json.Marshal(device)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" || containsJSONText(encoded, "fingerprint") || containsJSONText(encoded, "0123456789abcdef") {
		t.Fatalf("public device leaked identity fingerprint: %s", encoded)
	}
	_, err = store.CreateRemoteExecutionTask(ctx, RemoteExecutionTask{IdempotencyKey: "task-1", ProjectID: project.ID, AgentID: agent.ID, ExecutionDeviceID: device.ID, Payload: json.RawMessage(`{"operation":"read"}`)})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("disabled remote target must fail closed, got %v", err)
	}
	if _, err := store.CreateRemoteExecutionTask(ctx, RemoteExecutionTask{IdempotencyKey: "task-2", ProjectID: project.ID, AgentID: agent.ID, ExecutionDeviceID: device.ID, Payload: json.RawMessage(`{"token":"secret"}`)}); err == nil {
		t.Fatal("sensitive execution payload key must be rejected")
	}
}

func containsJSONText(data []byte, value string) bool {
	return strings.Contains(strings.ToLower(string(data)), strings.ToLower(value))
}
