package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const CurrentDBVersion = 3

type migration struct {
	version int
	name    string
	up      func(context.Context, *sql.Tx) error
}

var migrations = []migration{
	{version: 1, name: "baseline schema", up: migrateV1Baseline},
	{version: 2, name: "run tracking", up: migrateV2RunTracking},
	{version: 3, name: "notification settings", up: migrateV3NotificationSettings},
}

func runMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("enable sqlite foreign keys: %w", err)
	}

	version, err := getUserVersion(ctx, db)
	if err != nil {
		return err
	}
	if version > CurrentDBVersion {
		return fmt.Errorf("database version %d is newer than supported version %d", version, CurrentDBVersion)
	}

	if version == 0 {
		empty, err := databaseIsEmpty(ctx, db)
		if err != nil {
			return err
		}
		if !empty {
			if err := migrateLegacyZeroVersion(ctx, db); err != nil {
				return err
			}
			version = 1
		}
	}

	for _, m := range migrations {
		if m.version <= version {
			continue
		}
		if err := runMigration(ctx, db, m); err != nil {
			return err
		}
		version = m.version
	}
	return nil
}

func runMigration(ctx context.Context, db *sql.DB, m migration) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration %d %s: %w", m.version, m.name, err)
	}
	defer tx.Rollback()

	if err := m.up(ctx, tx); err != nil {
		return fmt.Errorf("run migration %d %s: %w", m.version, m.name, err)
	}
	if err := setUserVersion(ctx, tx, m.version); err != nil {
		return fmt.Errorf("set database version %d: %w", m.version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %d %s: %w", m.version, m.name, err)
	}
	return nil
}

func migrateV1Baseline(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, schemaSQL)
	return err
}

func migrateV2RunTracking(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  narrator_id TEXT NOT NULL REFERENCES narrators(id) ON DELETE CASCADE,
  trigger_message_id TEXT REFERENCES narrator_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  base_head TEXT,
  end_head TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_narrator_started ON runs(narrator_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
`); err != nil {
		return err
	}
	if err := ensureColumn(ctx, tx, "narrator_messages", "run_id", "TEXT REFERENCES runs(id) ON DELETE SET NULL"); err != nil {
		return err
	}
	if err := ensureColumn(ctx, tx, "narrator_tool_calls", "run_id", "TEXT REFERENCES runs(id) ON DELETE SET NULL"); err != nil {
		return err
	}
	if err := ensureColumn(ctx, tx, "api_requests", "run_id", "TEXT REFERENCES runs(id) ON DELETE SET NULL"); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
CREATE INDEX IF NOT EXISTS idx_messages_run ON narrator_messages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON narrator_tool_calls(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_requests_run ON api_requests(run_id, created_at);
`)
	return err
}

func migrateV3NotificationSettings(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT,
  notify_on_approval INTEGER NOT NULL DEFAULT 1,
  notify_on_done INTEGER NOT NULL DEFAULT 1,
  notify_on_error INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`)
	return err
}

func migrateLegacyZeroVersion(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin legacy database migration: %w", err)
	}
	defer tx.Rollback()

	if err := execSchemaStatements(ctx, tx, func(stmt string) bool {
		upper := strings.ToUpper(strings.TrimSpace(stmt))
		return strings.HasPrefix(upper, "PRAGMA ") || strings.HasPrefix(upper, "CREATE TABLE ")
	}); err != nil {
		return fmt.Errorf("create missing legacy tables: %w", err)
	}
	if err := ensureLegacyColumns(ctx, tx); err != nil {
		return fmt.Errorf("ensure legacy columns: %w", err)
	}
	if err := execSchemaStatements(ctx, tx, func(stmt string) bool {
		upper := strings.ToUpper(strings.TrimSpace(stmt))
		return strings.HasPrefix(upper, "CREATE INDEX ") || strings.HasPrefix(upper, "CREATE UNIQUE INDEX ")
	}); err != nil {
		return fmt.Errorf("create missing legacy indexes: %w", err)
	}
	if err := setUserVersion(ctx, tx, 1); err != nil {
		return fmt.Errorf("set legacy database version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit legacy database migration: %w", err)
	}
	return nil
}

func execSchemaStatements(ctx context.Context, tx *sql.Tx, include func(string) bool) error {
	for _, raw := range strings.Split(schemaSQL, ";") {
		stmt := strings.TrimSpace(raw)
		if stmt == "" || !include(stmt) {
			continue
		}
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", firstLine(stmt), err)
		}
	}
	return nil
}

func firstLine(stmt string) string {
	line, _, _ := strings.Cut(stmt, "\n")
	return strings.TrimSpace(line)
}

func databaseIsEmpty(ctx context.Context, db *sql.DB) (bool, error) {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') AND name NOT LIKE 'sqlite_%'`).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect database objects: %w", err)
	}
	return count == 0, nil
}

func getUserVersion(ctx context.Context, db *sql.DB) (int, error) {
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return 0, fmt.Errorf("read database user_version: %w", err)
	}
	return version, nil
}

func setUserVersion(ctx context.Context, tx *sql.Tx, version int) error {
	_, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", version))
	return err
}

type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type rowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func tableExists(ctx context.Context, q rowQuerier, table string) (bool, error) {
	var count int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func columnExists(ctx context.Context, q rowsQuerier, table, column string) (bool, error) {
	rows, err := q.QueryContext(ctx, `PRAGMA table_info(`+quoteIdentifier(table)+`)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

func ensureColumn(ctx context.Context, tx *sql.Tx, table, column, definition string) error {
	exists, err := tableExists(ctx, tx, table)
	if err != nil {
		return fmt.Errorf("inspect table %s: %w", table, err)
	}
	if !exists {
		return nil
	}
	exists, err = columnExists(ctx, tx, table, column)
	if err != nil {
		return fmt.Errorf("inspect column %s.%s: %w", table, column, err)
	}
	if exists {
		return nil
	}
	stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", quoteIdentifier(table), quoteIdentifier(column), definition)
	if _, err := tx.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("add column %s.%s: %w", table, column, err)
	}
	return nil
}

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func ensureLegacyColumns(ctx context.Context, tx *sql.Tx) error {
	columns := []struct {
		table      string
		column     string
		definition string
	}{
		{"users", "password_hash", "TEXT"},
		{"users", "role", "TEXT NOT NULL DEFAULT 'user'"},
		{"users", "avatar_color", "TEXT"},
		{"users", "avatar_image_id", "TEXT"},
		{"users", "git_username", "TEXT"},
		{"users", "git_email", "TEXT"},
		{"projects", "description", "TEXT"},
		{"projects", "status", "TEXT NOT NULL DEFAULT 'active'"},
		{"projects", "flow_mode", "TEXT NOT NULL DEFAULT 'workspace'"},
		{"projects", "git_path", "TEXT"},
		{"projects", "remote_url", "TEXT"},
		{"projects", "default_branch", "TEXT"},
		{"projects", "startup_script", "TEXT"},
		{"projects", "copy_files", "TEXT"},
		{"projects", "chapter_settings", "TEXT"},
		{"projects", "proxy_domain", "TEXT"},
		{"chapters", "description", "TEXT"},
		{"chapters", "status", "TEXT NOT NULL DEFAULT 'active'"},
		{"chapters", "role", "TEXT NOT NULL DEFAULT 'root'"},
		{"chapters", "branch", "TEXT"},
		{"chapters", "worktree_path", "TEXT"},
		{"chapters", "base_branch", "TEXT"},
		{"chapters", "parent_chapter_id", "TEXT"},
		{"chapters", "fork_point", "TEXT"},
		{"chapters", "merged_into_chapter_id", "TEXT"},
		{"chapters", "merge_commit_sha", "TEXT"},
		{"chapters", "merge_strategy", "TEXT"},
		{"chapters", "pre_merge_target_sha", "TEXT"},
		{"chapters", "container_config", "TEXT"},
		{"chapters", "exploration_group_id", "TEXT"},
		{"chapters", "is_root", "INTEGER NOT NULL DEFAULT 0"},
		{"chapters", "head_commit_sha", "TEXT"},
		{"chapters", "start_commit_sha", "TEXT"},
		{"chapters", "commit_count", "INTEGER NOT NULL DEFAULT 0"},
		{"chapters", "color", "TEXT"},
		{"chapters", "group_label", "TEXT"},
		{"chapters", "pinned", "INTEGER NOT NULL DEFAULT 0"},
		{"chapters", "position_x", "REAL"},
		{"chapters", "position_y", "REAL"},
		{"chapters", "panel_expanded", "INTEGER"},
		{"chapters", "panel_width", "REAL"},
		{"chapters", "panel_height", "REAL"},
		{"chapters", "review_source_chapter_id", "TEXT"},
		{"chapters", "review_status", "TEXT"},
		{"chapters", "last_accessed_at", "TEXT"},
		{"narrators", "api_conversation_id", "TEXT"},
		{"narrators", "fork_message_id", "TEXT"},
		{"narrators", "subagent_type", "TEXT"},
		{"narrators", "inherit_mode", "TEXT"},
		{"narrators", "parent_narrator_id", "TEXT"},
		{"narrators", "context_summary", "TEXT"},
		{"narrators", "system_prompt", "TEXT"},
		{"narrators", "previous_permission_mode", "TEXT"},
		{"narrators", "reasoning_effort", "TEXT"},
		{"narrators", "fast_mode", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "relaxed_plan", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "message_count", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "total_cost_usd", "REAL NOT NULL DEFAULT 0"},
		{"narrators", "last_message_at", "TEXT"},
		{"narrators", "plan_mode", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "cwd", "TEXT"},
		{"narrators", "error_message", "TEXT"},
		{"narrators", "todos_json", "TEXT"},
		{"narrators", "todos_tool_use_id", "TEXT"},
		{"narrators", "prune_boundary_message_id", "TEXT"},
		{"narrators", "pruned_percent", "INTEGER"},
		{"narrators", "prune_enabled", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "is_background", "INTEGER NOT NULL DEFAULT 0"},
		{"narrators", "background_status", "TEXT"},
		{"narrators", "background_result", "TEXT"},
		{"narrators", "background_completed_at", "TEXT"},
		{"narrator_messages", "run_id", "TEXT"},
		{"narrator_messages", "sdk_message_uuid", "TEXT"},
		{"narrator_messages", "parent_tool_use_id", "TEXT"},
		{"narrator_messages", "content_json", "TEXT"},
		{"narrator_messages", "content_text", "TEXT"},
		{"narrator_messages", "tokens_in", "INTEGER"},
		{"narrator_messages", "cost_usd", "REAL"},
		{"narrator_messages", "turn_usage_json", "TEXT"},
		{"narrator_messages", "context_percent", "REAL"},
		{"narrator_messages", "meter_usage", "REAL"},
		{"narrator_messages", "meter_unit", "TEXT"},
		{"narrator_messages", "commit_sha", "TEXT"},
		{"narrator_messages", "command_text", "TEXT"},
		{"narrator_messages", "created_by", "TEXT"},
		{"narrator_tool_calls", "run_id", "TEXT"},
		{"narrator_tool_calls", "message_id", "TEXT"},
		{"narrator_tool_calls", "input_json", "TEXT"},
		{"narrator_tool_calls", "output_json", "TEXT"},
		{"narrator_tool_calls", "duration_ms", "INTEGER"},
		{"narrator_tool_calls", "error_message", "TEXT"},
		{"narrator_tool_calls", "permission_decided_by", "TEXT"},
		{"narrator_tool_calls", "permission_decided_at", "TEXT"},
		{"narrator_tool_calls", "permission_deny_message", "TEXT"},
		{"narrator_tool_calls", "permission_decision_reason", "TEXT"},
		{"narrator_tool_calls", "permission_suggestions", "TEXT"},
		{"narrator_tool_calls", "is_background", "INTEGER NOT NULL DEFAULT 0"},
		{"narrator_tool_calls", "input_tokens", "INTEGER"},
		{"narrator_tool_calls", "output_tokens", "INTEGER"},
		{"narrator_tool_calls", "total_cost", "REAL"},
		{"narrator_tool_calls", "provider", "TEXT"},
		{"narrator_tool_calls", "model", "TEXT"},
		{"narrator_tool_calls", "result_message_id", "TEXT"},
		{"api_requests", "run_id", "TEXT"},
		{"api_requests", "kind", "TEXT NOT NULL DEFAULT 'model'"},
		{"api_requests", "provider", "TEXT"},
		{"api_requests", "credential_id", "TEXT"},
		{"api_requests", "model", "TEXT"},
		{"api_requests", "input_tokens", "INTEGER"},
		{"api_requests", "output_tokens", "INTEGER"},
		{"api_requests", "cached_input_tokens", "INTEGER"},
		{"api_requests", "reasoning_tokens", "INTEGER"},
		{"api_requests", "ttft_ms", "INTEGER"},
		{"api_requests", "duration_ms", "INTEGER"},
		{"api_requests", "cost_usd", "REAL"},
		{"api_requests", "context_percent", "REAL"},
		{"api_requests", "meter_usage", "REAL"},
		{"api_requests", "meter_unit", "TEXT"},
		{"api_requests", "error_message", "TEXT"},
		{"api_requests", "raw_dump_json", "TEXT"},
		{"agent_backends", "kind", "TEXT NOT NULL DEFAULT 'local'"},
		{"agent_backends", "api_key", "TEXT"},
		{"agent_backends", "active", "INTEGER NOT NULL DEFAULT 0"},
		{"mcp_servers", "transport", "TEXT NOT NULL DEFAULT 'stdio'"},
		{"mcp_servers", "args_json", "TEXT"},
		{"mcp_servers", "cwd", "TEXT"},
		{"mcp_servers", "env_json", "TEXT"},
		{"mcp_servers", "enabled", "INTEGER NOT NULL DEFAULT 1"},
	}
	for _, column := range columns {
		if err := ensureColumn(ctx, tx, column.table, column.column, column.definition); err != nil {
			return err
		}
	}
	return nil
}
