package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"autoto/internal/config"
	"autoto/internal/db"
)

func TestStorageSummaryRouteReturnsConfiguredPathStats(t *testing.T) {
	root := t.TempDir()
	homeDir := filepath.Join(root, "home")
	projectDir := filepath.Join(root, "projects")
	if err := os.MkdirAll(filepath.Join(projectDir, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(homeDir, "config.json")
	databasePath := filepath.Join(homeDir, "autoto.db")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`{"server":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(databasePath, []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(databasePath+"-wal", []byte("wal"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "demo", "main.go"), []byte("package main"), 0o600); err != nil {
		t.Fatal(err)
	}

	store, err := db.Open(context.Background(), filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := New(config.Config{Paths: config.PathsConfig{HomeDir: homeDir, DatabasePath: databasePath, DefaultProjectDir: projectDir}}, store, nil, nil)
	app.SetConfigPath(configPath)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/storage/summary", nil)
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body storageSummaryResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.TotalKnownBytes <= 0 || len(body.Entries) != 4 {
		t.Fatalf("unexpected storage summary: %+v", body)
	}
	database := storageEntryByKey(body.Entries, "database")
	if !database.Exists || database.FileCount != 2 || database.SizeBytes != 5 {
		t.Fatalf("unexpected database entry: %+v", database)
	}
	projects := storageEntryByKey(body.Entries, "projects")
	if !projects.Exists || !projects.IsDir || projects.FileCount != 1 || projects.DirectoryCount < 2 {
		t.Fatalf("unexpected projects entry: %+v", projects)
	}
	configEntry := storageEntryByKey(body.Entries, "config")
	if !configEntry.Exists || configEntry.FileCount != 1 {
		t.Fatalf("unexpected config entry: %+v", configEntry)
	}
}

func TestBuildStorageSummaryTruncatesLargeDirectoryScan(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(root, "projects")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if err := os.WriteFile(filepath.Join(projectDir, db.NewID()+".txt"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	summary := buildStorageSummary(context.Background(), config.Config{Paths: config.PathsConfig{DefaultProjectDir: projectDir}}, "", 3)
	projects := storageEntryByKey(summary.Entries, "projects")
	if !projects.Truncated {
		t.Fatalf("expected truncated projects scan, got %+v", projects)
	}
	if projects.EntriesScanned > 3 {
		t.Fatalf("expected bounded scan, got %+v", projects)
	}
}

func storageEntryByKey(entries []storageEntry, key string) storageEntry {
	for _, entry := range entries {
		if entry.Key == key {
			return entry
		}
	}
	return storageEntry{}
}
