package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestV13RenamesAgentWorklineSchemaAndPreservesData(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v12.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, legacyNamingSchemaSQL()); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO projects (id, name, status, flow_mode, created_at, updated_at) VALUES ('project-1', 'Legacy', 'active', 'workspace', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO chapters (id, project_id, title, status, role, is_root, created_at, updated_at) VALUES ('chapter-1', 'project-1', 'main', 'active', 'root', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO narrators (id, chapter_id, type, title, model, permission_mode, status, created_at, updated_at) VALUES ('agent-1', 'chapter-1', 'primary', 'Legacy agent', 'fake:test', 'acceptEdits', 'idle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO narrator_messages (id, narrator_id, role, content_text, created_at) VALUES ('message-1', 'agent-1', 'user', 'hello', '2026-01-01T00:00:00Z')`,
	} {
		if _, err := raw.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 12`); err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, table := range []string{"worklines", "agents", "agent_messages", "agent_message_attachments", "agent_tool_calls"} {
		if !testTableExists(t, ctx, store.DB(), table) {
			t.Fatalf("expected renamed table %s", table)
		}
	}
	if testTableExists(t, ctx, store.DB(), "chapters") || testTableExists(t, ctx, store.DB(), "narrators") {
		t.Fatal("legacy naming tables must be removed by v13")
	}
	agent, err := store.GetAgent(ctx, "agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if agent.WorklineID != "chapter-1" || agent.Title != "Legacy agent" {
		t.Fatalf("unexpected migrated agent: %+v", agent)
	}
	messages, err := store.ListMessages(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].ContentText != "hello" {
		t.Fatalf("unexpected migrated messages: %+v", messages)
	}
}
