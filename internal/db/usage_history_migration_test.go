package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestMigrationV36CreatesAPIRequestHistoryIndexesIdempotently(t *testing.T) {
	ctx := context.Background()
	indexNames := []string{
		"idx_api_requests_created",
		"idx_api_requests_provider_model_created",
	}

	fresh, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range indexNames {
		if !usageHistoryTestIndexExists(t, ctx, fresh.DB(), name) {
			fresh.Close()
			t.Fatalf("fresh schema is missing %s", name)
		}
	}
	if version := readUserVersion(t, ctx, fresh.DB()); version != CurrentDBVersion {
		fresh.Close()
		t.Fatalf("expected fresh database version %d, got %d", CurrentDBVersion, version)
	}
	if err := fresh.Close(); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "v35.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `
DROP INDEX idx_api_requests_created;
DROP INDEX idx_api_requests_provider_model_created;
PRAGMA user_version = 35;
`); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	migrated, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range indexNames {
		if !usageHistoryTestIndexExists(t, ctx, migrated.DB(), name) {
			migrated.Close()
			t.Fatalf("v36 migration is missing %s", name)
		}
	}
	if version := readUserVersion(t, ctx, migrated.DB()); version != CurrentDBVersion {
		migrated.Close()
		t.Fatalf("expected migrated database version %d, got %d", CurrentDBVersion, version)
	}
	if err := migrated.Close(); err != nil {
		t.Fatal(err)
	}

	raw = openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, `PRAGMA user_version = 35`); err != nil {
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
	for _, name := range indexNames {
		if !usageHistoryTestIndexExists(t, ctx, reopened.DB(), name) {
			t.Fatalf("idempotent reopen is missing %s", name)
		}
	}
}

func usageHistoryTestIndexExists(t *testing.T, ctx context.Context, database *sql.DB, name string) bool {
	t.Helper()
	var count int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, name).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count == 1
}
