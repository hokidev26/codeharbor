package db

import (
	"context"
	"path/filepath"
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
