package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateProjectCreatesCoreRecords(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	project, chapter, narrator, err := store.CreateProject(context.Background(), "Demo", "desc", t.TempDir(), "openai-compatible:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if project.ID == "" || chapter.ID == "" || narrator.ID == "" {
		t.Fatal("expected ids")
	}
	got, err := store.GetNarrator(context.Background(), narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ChapterID != chapter.ID {
		t.Fatalf("expected narrator chapter %s, got %s", chapter.ID, got.ChapterID)
	}
}

func TestUpdateNarratorContextSummaryRoundTrips(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateNarratorContextSummary(ctx, narrator.ID, "summary text", "message-1", 42); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetNarrator(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ContextSummary != "summary text" || got.PruneBoundaryMessageID != "message-1" || got.PrunedPercent != 42 {
		t.Fatalf("unexpected context summary round trip: %+v", got)
	}
}

func TestListProjectsReturnsEmptySlice(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	projects, err := store.ListProjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if projects == nil {
		t.Fatal("expected empty slice, got nil")
	}
	if len(projects) != 0 {
		t.Fatalf("expected no projects, got %d", len(projects))
	}
}

func TestAddAPIRequestPersistsUsage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, Role: "user", ContentText: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"id": "raw"})
	request, err := store.AddAPIRequest(ctx, APIRequest{NarratorID: narrator.ID, MessageID: message.ID, Provider: "openai", Model: "gpt-test", InputTokens: 10, OutputTokens: 4, CachedInputTokens: 2, ReasoningTokens: 1, DurationMS: 123, ErrorMessage: "", RawDumpJSON: raw})
	if err != nil {
		t.Fatal(err)
	}
	if request.ID == "" || request.Kind != "model" || request.CreatedAt == "" {
		t.Fatalf("unexpected request metadata: %+v", request)
	}
	var count, inputTokens, outputTokens int64
	if err := store.DB().QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM api_requests WHERE narrator_id = ? AND message_id = ?`, narrator.ID, message.ID).Scan(&count, &inputTokens, &outputTokens); err != nil {
		t.Fatal(err)
	}
	if count != 1 || inputTokens != 10 || outputTokens != 4 {
		t.Fatalf("unexpected stored api request stats: count=%d input=%d output=%d", count, inputTokens, outputTokens)
	}
}

func TestAddMessageRoundTripsToolContentJSON(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`[{"type":"tool_result","toolUseId":"tool-1","toolName":"Read","output":"ok","isError":true}]`)
	message, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, Role: "user", ContentText: "tool result", ContentJSON: raw, ParentToolID: "tool-1"})
	if err != nil {
		t.Fatal(err)
	}
	messages, err := store.ListMessages(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].ID != message.ID || string(messages[0].ContentJSON) != string(raw) || messages[0].ParentToolID != "tool-1" {
		t.Fatalf("unexpected round-trip message: %+v", messages)
	}
}

func TestBackendRegistryActivatesSingleBackend(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	first, err := store.CreateBackend(ctx, Backend{Name: "Local", Kind: "local", BaseURL: "http://127.0.0.1:8000"})
	if err != nil {
		t.Fatal(err)
	}
	if !first.Active {
		t.Fatal("expected first backend to become active")
	}
	second, err := store.CreateBackend(ctx, Backend{Name: "Cloud", Kind: "cloud", BaseURL: "https://example.test", Active: true})
	if err != nil {
		t.Fatal(err)
	}
	if !second.Active {
		t.Fatal("expected requested backend to become active")
	}

	backends, err := store.ListBackends(ctx)
	if err != nil {
		t.Fatal(err)
	}
	activeCount := 0
	for _, backend := range backends {
		if backend.Active {
			activeCount++
			if backend.ID != second.ID {
				t.Fatalf("expected second backend active, got %s", backend.ID)
			}
		}
	}
	if activeCount != 1 {
		t.Fatalf("expected exactly one active backend, got %d", activeCount)
	}
}

func TestMCPServerRegistryRoundTripsConfig(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	created, err := store.CreateMCPServer(ctx, MCPServer{Name: "Fake", Transport: "stdio", Command: "node", Args: []string{"server.js"}, CWD: "/tmp", Env: map[string]string{"TOKEN": "secret"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.GetMCPServer(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Command != "node" || got.Args[0] != "server.js" || got.Env["TOKEN"] != "secret" || !got.Enabled {
		t.Fatalf("unexpected MCP server round trip: %+v", got)
	}

	got.Enabled = false
	got.Args = []string{"other.js"}
	updated, err := store.UpdateMCPServer(ctx, got)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Enabled || updated.Args[0] != "other.js" {
		t.Fatalf("unexpected MCP server update: %+v", updated)
	}

	servers, err := store.ListMCPServers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(servers) != 1 || servers[0].ID != created.ID {
		t.Fatalf("expected one MCP server, got %+v", servers)
	}
	if err := store.DeleteMCPServer(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetMCPServer(ctx, created.ID); !IsNotFound(err) {
		t.Fatalf("expected deleted MCP server to be missing, got %v", err)
	}
}

func TestRunStoreRoundTripsAndSummarizes(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, _, narrator, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	trigger, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, Role: "user", ContentText: "start"})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(ctx, Run{NarratorID: narrator.ID, TriggerMessageID: trigger.ID})
	if err != nil {
		t.Fatal(err)
	}
	assistant, err := store.AddMessage(ctx, Message{NarratorID: narrator.ID, RunID: run.ID, Role: "assistant", ContentText: "tool"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddToolCall(ctx, ToolCall{NarratorID: narrator.ID, RunID: run.ID, MessageID: assistant.ID, ToolUseID: "tool-1", ToolName: "Read", InputJSON: json.RawMessage(`{"file_path":"README.md"}`), Status: "pending_approval"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddAPIRequest(ctx, APIRequest{NarratorID: narrator.ID, RunID: run.ID, Provider: "openai", Model: "gpt", InputTokens: 10, OutputTokens: 5, CostUSD: 0.25}); err != nil {
		t.Fatal(err)
	}
	pending, err := store.ListPendingToolCalls(ctx, narrator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].RunID != run.ID || pending[0].ToolUseID != "tool-1" {
		t.Fatalf("unexpected pending calls: %+v", pending)
	}
	if err := store.CompleteRun(ctx, run.ID, "completed", ""); err != nil {
		t.Fatal(err)
	}
	summary, err := store.RunSummary(ctx, narrator.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Run.Status != "completed" || summary.MessageCount != 1 || summary.ToolCallCount != 1 || summary.PendingApprovals != 1 || summary.APIRequestCount != 1 || summary.InputTokens != 10 || summary.OutputTokens != 5 || summary.CostUSD != 0.25 {
		t.Fatalf("unexpected run summary: %+v", summary)
	}
	runs, err := store.ListRuns(ctx, narrator.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID {
		t.Fatalf("unexpected runs: %+v", runs)
	}
}

func TestOpenInitializesUserVersionForNewDatabase(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	version := readUserVersion(t, ctx, store.DB())
	if version != CurrentDBVersion {
		t.Fatalf("expected database version %d, got %d", CurrentDBVersion, version)
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.CreateProject(ctx, "Demo", "", t.TempDir(), "openai:test", "acceptEdits"); err != nil {
		t.Fatal(err)
	}
	store.Close()

	store, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	version := readUserVersion(t, ctx, store.DB())
	if version != CurrentDBVersion {
		t.Fatalf("expected database version %d, got %d", CurrentDBVersion, version)
	}
	projects, err := store.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Name != "Demo" {
		t.Fatalf("expected preserved project after idempotent open, got %+v", projects)
	}
}

func TestOpenMigratesVersionOneDatabaseToRunTracking(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v1.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 1`); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if version := readUserVersion(t, ctx, store.DB()); version != CurrentDBVersion {
		t.Fatalf("expected migrated version %d, got %d", CurrentDBVersion, version)
	}
	for _, column := range []struct {
		table  string
		column string
	}{
		{"narrator_messages", "run_id"},
		{"narrator_tool_calls", "run_id"},
		{"api_requests", "run_id"},
	} {
		if !testColumnExists(t, ctx, store.DB(), column.table, column.column) {
			t.Fatalf("expected column %s.%s to exist after migration", column.table, column.column)
		}
	}
	if !testTableExists(t, ctx, store.DB(), "runs") {
		t.Fatal("expected runs table after migration")
	}
}

func TestOpenRejectsFutureDatabaseVersion(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "future.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 999`); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	store, err := Open(ctx, path)
	if err == nil {
		store.Close()
		t.Fatal("expected future database version to be rejected")
	}
	if !strings.Contains(err.Error(), "newer than supported") {
		t.Fatalf("expected clear future version error, got %v", err)
	}
}

func TestOpenMigratesLegacyDatabaseMissingNarratorColumns(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	raw := openRawDB(t, path)
	_, err := raw.ExecContext(ctx, `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  flow_mode TEXT NOT NULL DEFAULT 'workspace',
  git_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'root',
  worktree_path TEXT,
  is_root INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE narrators (
  id TEXT PRIMARY KEY,
  chapter_id TEXT,
  type TEXT NOT NULL DEFAULT 'primary',
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
  status TEXT NOT NULL DEFAULT 'idle',
  plan_mode INTEGER NOT NULL DEFAULT 0,
  cwd TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO projects (id, name, description, status, flow_mode, git_path, created_at, updated_at)
VALUES ('project-1', 'Legacy', '', 'active', 'workspace', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO chapters (id, project_id, title, status, role, worktree_path, is_root, created_at, updated_at)
VALUES ('chapter-1', 'project-1', 'main', 'active', 'root', '', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO narrators (id, chapter_id, type, title, model, permission_mode, status, plan_mode, cwd, message_count, created_at, updated_at)
VALUES ('narrator-1', 'chapter-1', 'primary', 'Legacy', 'openai:test', 'acceptEdits', 'idle', 0, '', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
`)
	if err != nil {
		t.Fatal(err)
	}
	raw.Close()

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if version := readUserVersion(t, ctx, store.DB()); version != CurrentDBVersion {
		t.Fatalf("expected migrated version %d, got %d", CurrentDBVersion, version)
	}
	for _, column := range []struct {
		table  string
		column string
	}{
		{"narrators", "subagent_type"},
		{"narrators", "context_summary"},
		{"narrators", "prune_boundary_message_id"},
		{"narrators", "pruned_percent"},
		{"narrators", "prune_enabled"},
		{"narrators", "parent_narrator_id"},
		{"api_requests", "ttft_ms"},
	} {
		if !testColumnExists(t, ctx, store.DB(), column.table, column.column) {
			t.Fatalf("expected column %s.%s to exist after migration", column.table, column.column)
		}
	}
	narrator, err := store.GetNarrator(ctx, "narrator-1")
	if err != nil {
		t.Fatal(err)
	}
	if narrator.Title != "Legacy" || narrator.PruneBoundaryMessageID != "" || narrator.PrunedPercent != 0 {
		t.Fatalf("unexpected migrated narrator: %+v", narrator)
	}
}

func TestForeignKeysEnabledAfterOpen(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var enabled int
	if err := store.DB().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 1 {
		t.Fatalf("expected foreign keys to be enabled, got %d", enabled)
	}
}

func readUserVersion(t *testing.T, ctx context.Context, db *sql.DB) int {
	t.Helper()
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	return version
}

func openRawDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func testTableExists(t *testing.T, ctx context.Context, db *sql.DB, table string) bool {
	t.Helper()
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func testColumnExists(t *testing.T, ctx context.Context, db *sql.DB, table, column string) bool {
	t.Helper()
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+quoteIdentifier(table)+`)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if name == column {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return false
}
