package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestUserHandleUnicodeCaseConflictAndValidation(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	user, err := store.CreateUser(ctx, "Ａlice", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if user.Handle != "Alice" {
		t.Fatalf("expected NFKC handle, got %q", user.Handle)
	}
	if _, err := store.CreateUser(ctx, "alice", "hash"); !IsConflict(err) {
		t.Fatalf("expected Unicode/case handle conflict, got %v", err)
	}
	for _, handle := range []string{"a b", "a@b", "a/b", "a\\b", "a\u200db", "a\nb"} {
		if _, err := store.CreateUser(ctx, handle, "hash"); err == nil {
			t.Fatalf("expected invalid handle %q to be rejected", handle)
		}
	}
}

func TestMigrationV18BackfillsHandlesFromV17Users(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
PRAGMA foreign_keys = OFF;
DROP TABLE auth_sessions;
DROP TABLE message_drafts;
CREATE TABLE users_v17 (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  avatar_color TEXT,
  avatar_image_id TEXT,
  git_username TEXT,
  git_email TEXT,
  created_at TEXT NOT NULL
);
DROP TABLE users;
ALTER TABLE users_v17 RENAME TO users;
PRAGMA foreign_keys = ON;
`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	now := Now()
	if _, err := raw.ExecContext(ctx, `INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('legacy-user', 'Ａlice', 'hash', 'user', ?)`, now); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 17`); err != nil {
		raw.Close()
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
	var handle, handleKey string
	if err := store.DB().QueryRowContext(ctx, `SELECT handle, handle_key FROM users WHERE id = 'legacy-user'`).Scan(&handle, &handleKey); err != nil {
		t.Fatal(err)
	}
	if handle != "Alice" || handleKey != "alice" {
		t.Fatalf("unexpected v18 handle backfill: handle=%q key=%q", handle, handleKey)
	}
	if !testColumnExists(t, ctx, store.DB(), "agent_messages", "correction_of_message_id") {
		t.Fatal("expected v20 correction column")
	}
}
