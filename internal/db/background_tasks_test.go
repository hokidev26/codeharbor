package db

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestBackgroundTaskFreshSchemaAndV38Upgrade(t *testing.T) {
	ctx := context.Background()
	fresh, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	if version := readUserVersion(t, ctx, fresh.DB()); version != 40 {
		t.Fatalf("fresh version = %d, want 40", version)
	}
	for _, table := range []string{"background_tasks", "background_task_output"} {
		if !testTableExists(t, ctx, fresh.DB(), table) {
			t.Fatalf("fresh schema missing %s", table)
		}
	}
	for _, column := range []string{"auto_continuation_mode", "continuation_count", "continuation_segment_turns", "waiting_background_task_id"} {
		if !testColumnExists(t, ctx, fresh.DB(), "runs", column) {
			t.Fatalf("fresh runs missing %s", column)
		}
	}
	for _, trigger := range []string{"trg_runs_auto_continuation_mode_insert", "trg_runs_auto_continuation_mode_update"} {
		var count int
		if err := fresh.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?`, trigger).Scan(&count); err != nil || count != 1 {
			t.Fatalf("fresh continuation constraint trigger %s: count=%d err=%v", trigger, count, err)
		}
	}
	fresh.Close()

	path := filepath.Join(t.TempDir(), "v38.db")
	legacy, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	legacy.Close()
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, `DROP TABLE background_task_output; DROP TABLE background_tasks; PRAGMA user_version = 38`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	raw.Close()
	upgraded, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	if version := readUserVersion(t, ctx, upgraded.DB()); version != 40 {
		t.Fatalf("upgraded version = %d, want 40", version)
	}
	for _, table := range []string{"background_tasks", "background_task_output"} {
		if !testTableExists(t, ctx, upgraded.DB(), table) {
			t.Fatalf("v38 upgrade missing %s", table)
		}
	}
	for table, columns := range map[string][]string{
		"agent_messages": {"completion_state", "stop_reason"},
		"api_requests":   {"stop_reason", "turn_index", "continuation_index"},
	} {
		for _, column := range columns {
			if !testColumnExists(t, ctx, upgraded.DB(), table, column) {
				t.Fatalf("v38 upgrade missing %s.%s", table, column)
			}
		}
	}
}

func TestBackgroundTaskStoreCASProjectionOutputAndReconcile(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Background", "", t.TempDir(), "fake:model", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}

	created, err := store.CreateBackgroundTask(ctx, BackgroundTask{
		OwnerAgentID:      agent.ID,
		Kind:              BackgroundTaskKindShell,
		PayloadJSON:       json.RawMessage(`{"command":"secret-command","token":"sensitive"}`),
		PublicSummaryJSON: json.RawMessage(`{"label":"safe"}`),
		Priority:          5,
		MaxAttempts:       2,
	})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListBackgroundTasks(ctx, BackgroundTaskListOptions{OwnerAgentID: agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || string(listed[0].PayloadJSON) != `{}` || bytes.Contains(listed[0].PayloadJSON, []byte("secret")) {
		t.Fatalf("list projection leaked payload: %+v", listed)
	}
	full, err := store.GetBackgroundTaskForExecution(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(full.PayloadJSON, []byte("secret-command")) {
		t.Fatalf("execution projection missing payload: %s", full.PayloadJSON)
	}

	claimed, err := store.ClaimQueuedBackgroundTask(ctx, BackgroundTaskClaimOptions{WorkerInstanceID: "worker-one"})
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Status != BackgroundTaskStatusRunning || claimed.Revision != 2 || claimed.AttemptCount != 1 {
		t.Fatalf("unexpected claim: %+v", claimed)
	}
	attached, err := store.AttachBackgroundTaskChild(ctx, claimed.ID, claimed.Revision, agent.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if attached.ChildAgentID != agent.ID || attached.Revision != 3 {
		t.Fatalf("unexpected child attachment: %+v", attached)
	}
	if _, err := store.TransitionBackgroundTask(ctx, claimed.ID, BackgroundTaskTransition{ExpectedRevision: claimed.Revision, FromStatuses: []string{BackgroundTaskStatusRunning}, Status: BackgroundTaskStatusSucceeded}); !IsConflict(err) {
		t.Fatalf("stale transition error = %v, want conflict", err)
	}

	if _, err := store.AppendBackgroundTaskOutput(ctx, claimed.ID, "stdout", []byte("first-output"), 64); err != nil {
		t.Fatal(err)
	}
	appendResult, err := store.AppendBackgroundTaskOutput(ctx, claimed.ID, "stderr", bytes.Repeat([]byte("x"), 64), 64)
	if err != nil {
		t.Fatal(err)
	}
	if !appendResult.Truncated || appendResult.OutputBytes > 64 {
		t.Fatalf("unexpected truncation result: %+v", appendResult)
	}
	page, err := store.ListBackgroundTaskOutput(ctx, claimed.ID, 0, 16)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 || page.NextSequence == 0 || !page.HasMore || !page.Truncated {
		t.Fatalf("unexpected output page: %+v", page)
	}
	next, err := store.ListBackgroundTaskOutput(ctx, claimed.ID, page.NextSequence, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Items) == 0 || next.Items[len(next.Items)-1].Stream != "truncated" {
		t.Fatalf("missing truncated marker: %+v", next)
	}

	cancelRequested, err := store.RequestBackgroundTaskCancel(ctx, claimed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelRequested.Status != BackgroundTaskStatusCancelRequested {
		t.Fatalf("cancel status = %s", cancelRequested.Status)
	}
	if count, err := store.ReconcileBackgroundTasksAfterRestart(ctx, "worker-two"); err != nil || count != 1 {
		t.Fatalf("reconcile count=%d err=%v", count, err)
	}
	interrupted, err := store.GetBackgroundTask(ctx, claimed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if interrupted.Status != BackgroundTaskStatusInterrupted || interrupted.ErrorCode != "process_restarted" {
		t.Fatalf("unexpected reconciled task: %+v", interrupted)
	}
	if count, err := store.ReconcileBackgroundTasksAfterRestart(ctx, "worker-two"); err != nil || count != 0 {
		t.Fatalf("idempotent reconcile count=%d err=%v", count, err)
	}
	stats, err := store.BackgroundTaskStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 1 || stats.ByStatus[BackgroundTaskStatusInterrupted] != 1 || stats.TruncatedTasks != 1 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
}

func TestBackgroundTaskQueuedCancelAndContinuationCAS(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "continuation.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, agent, err := store.CreateProject(ctx, "Continuation", "", t.TempDir(), "fake:model", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateBackgroundTask(ctx, BackgroundTask{OwnerAgentID: agent.ID, Kind: BackgroundTaskKindAgent})
	if err != nil {
		t.Fatal(err)
	}
	canceled, err := store.RequestBackgroundTaskCancel(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if canceled.Status != BackgroundTaskStatusCanceled || canceled.CompletedAt == "" {
		t.Fatalf("queued cancel did not terminate task: %+v", canceled)
	}
	if _, err := store.ClaimQueuedBackgroundTask(ctx, BackgroundTaskClaimOptions{WorkerInstanceID: "worker"}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("claim canceled task error = %v, want no rows", err)
	}

	run, err := store.CreateRun(ctx, Run{AgentID: agent.ID, Status: "running", AutoContinuationMode: "safe", ContinuationSegmentTurns: 4, MaxContinuations: 3, MaxTotalTurns: 12})
	if err != nil {
		t.Fatal(err)
	}
	if run.ContinuationSegmentTurns != 4 {
		t.Fatalf("run continuation segment snapshot was not persisted: %+v", run)
	}
	usage, err := store.RecordRunSegmentUsage(ctx, run.ID, 0, 0, 2, 100, 20)
	if err != nil {
		t.Fatal(err)
	}
	if usage.TurnCount != 2 || usage.ConsumedInputTokens != 100 || usage.ConsumedOutputTokens != 20 {
		t.Fatalf("unexpected recorded usage: %+v", usage)
	}
	if _, err := store.RecordRunSegmentUsage(ctx, run.ID, 0, 0, 1, 1, 1); !IsConflict(err) {
		t.Fatalf("stale usage error = %v, want conflict", err)
	}
	pending, err := store.MarkRunContinuationPending(ctx, run.ID, RunContinuationPendingInput{
		ExpectedContinuationCount: 0,
		TurnCount:                 usage.TurnCount,
		ConsumedInputTokens:       usage.ConsumedInputTokens,
		ConsumedOutputTokens:      usage.ConsumedOutputTokens,
		LastStopReason:            "background_wait",
		ContinuationReason:        "waiting for child",
		WaitingBackgroundTaskID:   task.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != "continuation_pending" || pending.ContinuationCount != 1 || pending.WaitingBackgroundTaskID != task.ID || pending.TurnCount != 2 || pending.ConsumedInputTokens != 100 || pending.ConsumedOutputTokens != 20 {
		t.Fatalf("unexpected pending run: %+v", pending)
	}
	pendingRuns, err := store.ListContinuationPendingRuns(ctx, 10)
	if err != nil || len(pendingRuns) != 1 {
		t.Fatalf("pending runs=%d err=%v", len(pendingRuns), err)
	}
	if _, err := store.ResumeContinuationRun(ctx, run.ID, 0); !IsConflict(err) {
		t.Fatalf("stale resume error = %v, want conflict", err)
	}
	resumed, err := store.ResumeContinuationRun(ctx, run.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.Status != "running" || resumed.WaitingBackgroundTaskID != "" {
		t.Fatalf("unexpected resumed run: %+v", resumed)
	}
	pending, err = store.MarkRunContinuationPending(ctx, run.ID, RunContinuationPendingInput{ExpectedContinuationCount: 1, TurnCount: 3})
	if err != nil {
		t.Fatal(err)
	}
	if pending.TurnCount != 3 || pending.ConsumedInputTokens != 100 || pending.ConsumedOutputTokens != 20 {
		t.Fatalf("continuation transition rolled back recorded usage: %+v", pending)
	}
	canceledRun, err := store.CancelContinuationRun(ctx, run.ID, pending.ContinuationCount, "operator canceled")
	if err != nil {
		t.Fatal(err)
	}
	if canceledRun.Status != "interrupted" || canceledRun.ErrorMessage != "operator canceled" {
		t.Fatalf("unexpected canceled continuation: %+v", canceledRun)
	}
}
