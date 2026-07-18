package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestMigrationV45CreatesOAuthAppTablesAndPreservesExistingData(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v44.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
DROP TABLE oauth_app_sessions;
DROP TABLE oauth_app_identities;
INSERT INTO users (id, username, handle, handle_key, password_hash, role, created_at)
VALUES ('legacy-user', 'LegacyUser', 'LegacyUser', 'legacyuser', 'legacy-hash', 'user', '2026-01-01T00:00:00Z');
PRAGMA user_version = 44;
`); err != nil {
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
	for _, table := range []string{"oauth_app_identities", "oauth_app_sessions"} {
		if !testTableExists(t, ctx, store.DB(), table) {
			store.Close()
			t.Fatalf("v45 migration is missing %s", table)
		}
	}
	for _, index := range []string{"idx_oauth_app_identities_user", "idx_oauth_app_sessions_user", "idx_oauth_app_sessions_expiry"} {
		if !usageHistoryTestIndexExists(t, ctx, store.DB(), index) {
			store.Close()
			t.Fatalf("v45 migration is missing %s", index)
		}
	}
	if version := readUserVersion(t, ctx, store.DB()); version != CurrentDBVersion {
		store.Close()
		t.Fatalf("migrated database version = %d, want %d", version, CurrentDBVersion)
	}
	user, err := store.GetUser(ctx, "legacy-user")
	if err != nil || user.Handle != "LegacyUser" {
		store.Close()
		t.Fatalf("legacy user was not preserved: user=%+v err=%v", user, err)
	}
	identity, err := store.UpsertOAuthAppIdentity(ctx, OAuthAppIdentity{Issuer: "https://issuer.example", Subject: "legacy-subject", UserID: user.ID})
	if err != nil || identity.UserID != user.ID {
		store.Close()
		t.Fatalf("migrated identity table is unusable: identity=%+v err=%v", identity, err)
	}
	if _, err := store.CreateOAuthAppSession(ctx, OAuthAppSession{
		TokenHash: HashSessionToken("migration-session-token"),
		UserID:    user.ID,
		Scopes:    []string{"profile:read"},
		ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano),
	}); err != nil {
		store.Close()
		t.Fatalf("migrated session table is unusable: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	raw = openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 44`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.GetOAuthAppIdentity(ctx, "https://issuer.example", "legacy-subject"); err != nil {
		t.Fatalf("idempotent migration lost existing OAuth app data: %v", err)
	}
}
