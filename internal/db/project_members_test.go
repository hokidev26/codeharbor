package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMigrationV21AssignsExistingProjectsToEarliestUser(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v20.db")
	raw := openRawDB(t, path)
	if _, err := raw.ExecContext(ctx, schemaSQL); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `DROP TABLE project_members; INSERT INTO users (id, username, handle, handle_key, password_hash, role, created_at) VALUES ('later', 'later', 'later', 'later', 'hash', 'user', '2026-01-02T00:00:00Z'), ('earlier', 'earlier', 'earlier', 'earlier', 'hash', 'user', '2026-01-01T00:00:00Z'); INSERT INTO projects (id, name, status, flow_mode, created_at, updated_at) VALUES ('legacy-project', 'legacy', 'active', 'workspace', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'); PRAGMA user_version = 20`); err != nil {
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
	members, err := store.ListProjectMembers(ctx, "legacy-project")
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 || members[0].UserID != "earlier" || members[0].Role != "owner" {
		t.Fatalf("expected earliest user to own migrated project, got %+v", members)
	}
	if version := readUserVersion(t, ctx, store.DB()); version != CurrentDBVersion {
		t.Fatalf("expected v%d, got v%d", CurrentDBVersion, version)
	}
}

func TestFirstUserClaimsUnownedProjectsAndCreatesOwnedProjects(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	legacy, _, _, err := store.CreateProject(ctx, "legacy", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CreateUser(ctx, "first", "hash")
	if err != nil {
		t.Fatal(err)
	}
	legacyMembers, err := store.ListProjectMembers(ctx, legacy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(legacyMembers) != 1 || legacyMembers[0].UserID != first.ID || legacyMembers[0].Role != "owner" {
		t.Fatalf("expected first user to own legacy project, got %+v", legacyMembers)
	}

	project, workline, agent, err := store.CreateProjectForUser(ctx, first.ID, "owned", "", t.TempDir(), "fake:test", "acceptEdits")
	if err != nil {
		t.Fatal(err)
	}
	if project.ID == "" || workline.ProjectID != project.ID || agent.WorklineID != workline.ID {
		t.Fatalf("unexpected created hierarchy: project=%+v workline=%+v agent=%+v", project, workline, agent)
	}
	ownedMembers, err := store.ListProjectMembers(ctx, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownedMembers) != 1 || ownedMembers[0].UserID != first.ID || ownedMembers[0].Role != "owner" {
		t.Fatalf("expected creating user to own new project, got %+v", ownedMembers)
	}
}
