package db

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestP2P3FreshSchemaAndV18Migration(t *testing.T) {
	ctx := context.Background()
	fresh, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if version := readUserVersion(t, ctx, fresh.DB()); version != CurrentDBVersion {
		t.Fatalf("expected version %d, got %d", CurrentDBVersion, version)
	}
	for _, table := range []string{"schedules", "notification_deliveries", "channel_pairings", "channel_events", "channel_cursors", "device_action_requests"} {
		if !testTableExists(t, ctx, fresh.DB(), table) {
			t.Fatalf("fresh schema missing %s", table)
		}
	}
	for _, column := range []string{"source", "source_id", "permission_mode_cap"} {
		if !testColumnExists(t, ctx, fresh.DB(), "runs", column) {
			t.Fatalf("fresh runs missing %s", column)
		}
	}
	if !testColumnExists(t, ctx, fresh.DB(), "schedules", "timezone") {
		t.Fatal("fresh schedules missing timezone")
	}

	path := filepath.Join(t.TempDir(), "v18.db")
	raw := openRawDB(t, path)
	v18Schema := strings.TrimSuffix(schemaSQL, schedulesSchemaSQL+notificationDeliveriesSchemaSQL+channelPersistenceSchemaSQL+deviceActionRequestsSchemaSQL)
	v18Schema = strings.Replace(v18Schema, "  rolled_back_at TEXT,\n  source TEXT NOT NULL DEFAULT 'manual',\n  source_id TEXT NOT NULL DEFAULT '',\n  permission_mode_cap TEXT NOT NULL DEFAULT '',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (permission_mode_cap IN ('', 'readOnly', 'acceptEdits'))\n);", "  rolled_back_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);", 1)
	if _, err := raw.ExecContext(ctx, v18Schema); err != nil {
		t.Fatal(err)
	}
	now := Now()
	if _, err := raw.ExecContext(ctx, `INSERT INTO users (id, username, role, created_at) VALUES ('user-v18','v18','user',?)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('project-v18','V18',?,?)`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO worklines (id, project_id, title, created_at, updated_at) VALUES ('workline-v18','project-v18','V18',?,?)`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO agents (id, workline_id, title, model, created_at, updated_at) VALUES ('agent-v18','workline-v18','V18','test',?,?)`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO runs (id, agent_id, status, started_at, created_at, updated_at) VALUES ('run-v18','agent-v18','completed',?,?,?)`, now, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 18`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	migrated, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer migrated.Close()
	if version := readUserVersion(t, ctx, migrated.DB()); version != CurrentDBVersion {
		t.Fatalf("expected migrated version %d, got %d", CurrentDBVersion, version)
	}
	legacyRun, err := migrated.GetRunByID(ctx, "run-v18")
	if err != nil {
		t.Fatal(err)
	}
	if legacyRun.Source != "manual" || legacyRun.SourceID != "" || legacyRun.PermissionModeCap != "" {
		t.Fatalf("unexpected migrated run defaults: %+v", legacyRun)
	}
	for _, table := range []string{"schedules", "notification_deliveries", "channel_pairings", "channel_events", "channel_cursors", "device_action_requests"} {
		if !testTableExists(t, ctx, migrated.DB(), table) {
			t.Fatalf("migrated schema missing %s", table)
		}
	}
}

func TestScheduleCRUDCASLeaseTimezoneAndRunSource(t *testing.T) {
	ctx := context.Background()
	store, agent, _ := p2p3TestStore(t, ctx)
	defer store.Close()

	now := time.Now().UTC()
	schedule, err := store.CreateSchedule(ctx, Schedule{
		Name: " Nightly ", AgentID: agent.ID, Expression: "0 2 * * *", Timezone: "America/Los_Angeles",
		Prompt: "Run tests", PermissionMode: "acceptEdits", Enabled: true, NextRunAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if schedule.Name != "Nightly" || schedule.Timezone != "America/Los_Angeles" {
		t.Fatalf("unexpected canonical schedule: %+v", schedule)
	}
	invalid := schedule
	invalid.ID = ""
	invalid.Timezone = "Mars/Olympus"
	invalid.UpdatedAt = ""
	if _, err := store.CreateSchedule(ctx, invalid); err == nil {
		t.Fatal("expected invalid IANA timezone to fail")
	}
	stale := schedule
	schedule.Prompt = "Run all tests"
	updated, err := store.UpdateSchedule(ctx, schedule)
	if err != nil {
		t.Fatal(err)
	}
	stale.Prompt = "stale"
	if _, err := store.UpdateSchedule(ctx, stale); !IsConflict(err) {
		t.Fatalf("expected schedule CAS conflict, got %v", err)
	}
	leaseUntil := now.Add(time.Minute).Format(time.RFC3339Nano)
	claimed, err := store.ClaimDueSchedules(ctx, now.Format(time.RFC3339Nano), leaseUntil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 || claimed[0].ID != schedule.ID || claimed[0].LeaseUntil == "" {
		t.Fatalf("unexpected claimed schedules: %+v", claimed)
	}
	claimedAgain, err := store.ClaimDueSchedules(ctx, now.Format(time.RFC3339Nano), leaseUntil, 10)
	if err != nil || len(claimedAgain) != 0 {
		t.Fatalf("lease must prevent duplicate claim: %+v err=%v", claimedAgain, err)
	}
	run, err := store.CreateRun(ctx, Run{AgentID: agent.ID, Status: "completed", Source: "schedule", SourceID: schedule.ID, PermissionModeCap: "acceptEdits"})
	if err != nil {
		t.Fatal(err)
	}
	gotRun, err := store.GetRunByID(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotRun.Source != "schedule" || gotRun.SourceID != schedule.ID || gotRun.PermissionModeCap != "acceptEdits" {
		t.Fatalf("run source fields did not round trip: %+v", gotRun)
	}
	completed, err := store.RecordScheduleRun(ctx, schedule.ID, leaseUntil, run.ID, "success", "", now.Add(time.Hour).Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}
	if completed.LastRunID != run.ID || completed.LastOutcome != "success" || completed.LeaseUntil != "" {
		t.Fatalf("unexpected completed schedule: %+v", completed)
	}
	stats, err := store.ScheduleStats(ctx, now.Format(time.RFC3339Nano))
	if err != nil || stats.Total != 1 || stats.Enabled != 1 {
		t.Fatalf("unexpected schedule stats: %+v err=%v", stats, err)
	}
	updated.UpdatedAt = completed.UpdatedAt
	if err := store.DeleteSchedule(ctx, schedule.ID, completed.UpdatedAt); err != nil {
		t.Fatal(err)
	}
}

func TestNotificationDeliveryDedupeLeaseTransitionsStatsAndSafeJSON(t *testing.T) {
	ctx := context.Background()
	store, agent, _ := p2p3TestStore(t, ctx)
	defer store.Close()
	now := time.Now().UTC()
	base := NotificationDelivery{
		DedupeKey: "run.done:1", SinkType: "webhook", SinkID: "primary", EventType: "run.done", AgentID: agent.ID,
		PayloadJSON: json.RawMessage(`{"summary":{"ok":true}}`), MaxAttempts: 3, NextAttemptAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
	}
	created, inserted, err := store.EnqueueNotificationDelivery(ctx, base)
	if err != nil || !inserted {
		t.Fatalf("enqueue failed: %+v inserted=%v err=%v", created, inserted, err)
	}
	again, inserted, err := store.EnqueueNotificationDelivery(ctx, base)
	if err != nil || inserted || again.ID != created.ID {
		t.Fatalf("dedupe must return existing row: %+v inserted=%v err=%v", again, inserted, err)
	}
	bad := base
	bad.DedupeKey = "bad"
	bad.PayloadJSON = json.RawMessage(`{"nested":{"authorization":"secret"}}`)
	if _, err := store.CreateNotificationDelivery(ctx, bad); err == nil {
		t.Fatal("expected sensitive notification payload to fail")
	}
	lease := now.Add(time.Minute).Format(time.RFC3339Nano)
	claimed, err := store.ClaimNotificationDeliveries(ctx, now.Format(time.RFC3339Nano), lease, 10)
	if err != nil || len(claimed) != 1 || claimed[0].AttemptCount != 1 || claimed[0].Status != "inflight" {
		t.Fatalf("unexpected first claim: %+v err=%v", claimed, err)
	}
	retryAt := now.Add(2 * time.Minute).Format(time.RFC3339Nano)
	if err := store.MarkNotificationDeliveryRetry(ctx, created.ID, 503, "temporary", retryAt); err != nil {
		t.Fatal(err)
	}
	claimed, err = store.ClaimNotificationDeliveries(ctx, now.Add(3*time.Minute).Format(time.RFC3339Nano), now.Add(4*time.Minute).Format(time.RFC3339Nano), 10)
	if err != nil || len(claimed) != 1 || claimed[0].AttemptCount != 2 {
		t.Fatalf("unexpected retry claim: %+v err=%v", claimed, err)
	}
	if err := store.MarkNotificationDeliveryDelivered(ctx, created.ID, 204); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkNotificationDeliveryRetry(ctx, created.ID, 500, "late", retryAt); !IsConflict(err) {
		t.Fatalf("terminal delivery must reject retry, got %v", err)
	}
	stats, err := store.NotificationDeliveryStats(ctx)
	if err != nil || stats.Total != 1 || stats.Delivered != 1 || stats.Attempts != 2 {
		t.Fatalf("unexpected notification stats: %+v err=%v", stats, err)
	}
}

func TestChannelPairingEventsCursorIdempotencyAndPublicJSON(t *testing.T) {
	ctx := context.Background()
	store, agent, connection := p2p3TestStore(t, ctx)
	defer store.Close()
	now := time.Now().UTC()
	pairing, err := store.CreateChannelPairing(ctx, ChannelPairing{
		ConnectionID: connection.ID, AgentID: agent.ID, CodeHash: strings.Repeat("a", 64), ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), CredentialRevision: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(pairing)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "CodeHash") || strings.Contains(string(encoded), strings.Repeat("a", 64)) || strings.Contains(string(encoded), "codeHash") {
		t.Fatalf("public pairing JSON leaked code hash: %s", encoded)
	}
	locked, err := store.RecordChannelPairingFailure(ctx, pairing.ID, 1, now.Add(time.Minute).Format(time.RFC3339Nano))
	if err != nil || locked.LockedUntil == "" {
		t.Fatalf("expected failed pairing lock: %+v err=%v", locked, err)
	}
	if _, err := store.ActivateChannelPairing(ctx, pairing.ID, strings.Repeat("a", 64), "chat", "user", 2); !IsConflict(err) {
		t.Fatalf("locked pairing must not activate, got %v", err)
	}
	second, err := store.CreateChannelPairing(ctx, ChannelPairing{ConnectionID: connection.ID, AgentID: agent.ID, CodeHash: strings.Repeat("b", 64), ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)})
	if err != nil {
		t.Fatal(err)
	}
	active, err := store.ActivateChannelPairing(ctx, second.ID, strings.Repeat("b", 64), "chat", "user", 3)
	if err != nil || active.Status != "active" || active.CodeHash != "" || active.CredentialRevision != 3 {
		t.Fatalf("unexpected active pairing: %+v err=%v", active, err)
	}
	if _, err := store.RevokeChannelPairing(ctx, active.ID); err != nil {
		t.Fatal(err)
	}

	event := ChannelEvent{ConnectionID: connection.ID, ExternalEventID: "update-1", EventType: "message", AgentID: agent.ID, PayloadJSON: json.RawMessage(`{"command":"status"}`)}
	first, inserted, err := store.InsertChannelEvent(ctx, event)
	if err != nil || !inserted {
		t.Fatalf("insert event failed: %+v inserted=%v err=%v", first, inserted, err)
	}
	duplicate, inserted, err := store.InsertChannelEvent(ctx, event)
	if err != nil || inserted || duplicate.ID != first.ID {
		t.Fatalf("event idempotency failed: %+v inserted=%v err=%v", duplicate, inserted, err)
	}
	bad := event
	bad.ExternalEventID = "update-2"
	bad.PayloadJSON = json.RawMessage(`{"raw_payload":{"text":"secret"}}`)
	if _, err := store.CreateChannelEvent(ctx, bad); err == nil {
		t.Fatal("expected raw channel payload key to fail")
	}
	cursor, err := store.AdvanceChannelCursor(ctx, connection.ID, 0, 10)
	if err != nil || cursor.Offset != 10 {
		t.Fatalf("unexpected cursor: %+v err=%v", cursor, err)
	}
	if _, err := store.AdvanceChannelCursor(ctx, connection.ID, 0, 11); !IsConflict(err) {
		t.Fatalf("stale cursor CAS must conflict, got %v", err)
	}
	if _, err := store.MarkChannelEventProcessed(ctx, first.ID, ""); err != nil {
		t.Fatal(err)
	}
	stats, err := store.ChannelStats(ctx, connection.ID)
	if err != nil || stats.Events != 1 || stats.Pending != 0 || stats.Pairings.Total != 2 {
		t.Fatalf("unexpected channel stats: %+v err=%v", stats, err)
	}
}

func TestDeviceActionRequestStateMachineConstraintsAndSafeJSON(t *testing.T) {
	ctx := context.Background()
	store, _, connection := p2p3TestStore(t, ctx)
	defer store.Close()
	now := time.Now().UTC()
	request, err := store.CreateDeviceActionRequest(ctx, DeviceActionRequest{
		ConnectionID: connection.ID, EntityID: "light.kitchen", Domain: "light", Service: "turn_on",
		PayloadJSON: json.RawMessage(`{"brightness":50}`), Risk: "medium", RequestedBy: "telegram:user", ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.StartDeviceActionRequest(ctx, request.ID); !IsConflict(err) {
		t.Fatalf("pending request must not execute, got %v", err)
	}
	approved, err := store.ApproveDeviceActionRequest(ctx, request.ID, "admin")
	if err != nil || approved.Status != "approved" {
		t.Fatalf("approve failed: %+v err=%v", approved, err)
	}
	executing, err := store.StartDeviceActionRequest(ctx, request.ID)
	if err != nil || executing.Status != "executing" {
		t.Fatalf("start failed: %+v err=%v", executing, err)
	}
	completed, err := store.CompleteDeviceActionRequest(ctx, request.ID, "succeeded", "ignored")
	if err != nil || completed.Status != "succeeded" || completed.CompletedAt == "" || completed.LastError != "" {
		t.Fatalf("complete failed: %+v err=%v", completed, err)
	}
	if _, err := store.CompleteDeviceActionRequest(ctx, request.ID, "failed", "late"); !IsConflict(err) {
		t.Fatalf("terminal request must not be overwritten, got %v", err)
	}
	bad := DeviceActionRequest{ConnectionID: connection.ID, EntityID: "lock.front", Domain: "lock", Service: "unlock", PayloadJSON: json.RawMessage(`{"password":"hidden"}`), Risk: "critical", RequestedBy: "test", ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)}
	if _, err := store.CreateDeviceActionRequest(ctx, bad); err == nil {
		t.Fatal("expected sensitive device payload to fail")
	}
	if _, err := store.DB().ExecContext(ctx, `INSERT INTO device_action_requests (id, connection_id, entity_id, domain, service, payload_json, risk, status, requested_by, expires_at, created_at, updated_at) VALUES ('invalid', ?, 'x', 'light', 'on', '{}', 'unsafe', 'pending', 'test', ?, ?, ?)`, connection.ID, now.Add(time.Hour).Format(time.RFC3339Nano), Now(), Now()); err == nil {
		t.Fatal("expected database risk constraint to reject invalid enum")
	}
	stats, err := store.DeviceActionRequestStats(ctx)
	if err != nil || stats.Total != 1 || stats.Succeeded != 1 {
		t.Fatalf("unexpected device stats: %+v err=%v", stats, err)
	}
}

func TestP2P3StoredPayloadValidationFailsClosed(t *testing.T) {
	ctx := context.Background()
	store, agent, _ := p2p3TestStore(t, ctx)
	defer store.Close()
	now := Now()
	if _, err := store.DB().ExecContext(ctx, `INSERT INTO notification_deliveries (id, dedupe_key, sink_type, sink_id, event_type, agent_id, payload_json, status, attempt_count, max_attempts, next_attempt_at, created_at, updated_at) VALUES ('corrupt','corrupt','webhook','sink','event',?,'{"token":"hidden"}','queued',0,3,?,?,?)`, agent.ID, now, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetNotificationDelivery(ctx, "corrupt"); err == nil {
		t.Fatal("expected corrupt stored payload to fail validation")
	}
}

func p2p3TestStore(t *testing.T, ctx context.Context) (*Store, Agent, IntegrationConnection) {
	t.Helper()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, agent, err := store.CreateProject(ctx, "P2P3", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	connection, err := store.CreateIntegrationConnection(ctx, IntegrationConnection{Kind: "telegram", Name: "primary", Enabled: true})
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, agent, connection
}
