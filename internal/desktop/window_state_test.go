//go:build desktop

package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowStateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "desktop-window.json")
	state := windowState{
		Version:     windowStateVersion,
		Width:       1400,
		Height:      900,
		X:           120,
		Y:           80,
		Maximised:   false,
		HasPosition: true,
	}
	if err := saveWindowState(path, state); err != nil {
		t.Fatal(err)
	}
	loaded, ok := loadWindowState(path)
	if !ok {
		t.Fatal("expected load ok")
	}
	if loaded.Width != 1400 || loaded.Height != 900 || loaded.X != 120 || loaded.Y != 80 {
		t.Fatalf("loaded=%+v", loaded)
	}
	if !loaded.HasPosition || loaded.Maximised {
		t.Fatalf("flags=%+v", loaded)
	}
}

func TestLoadWindowStateRejectsInvalid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"width":10,"height":10}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := loadWindowState(path); ok {
		t.Fatal("tiny size should be rejected")
	}
	if _, ok := loadWindowState(filepath.Join(dir, "missing.json")); ok {
		t.Fatal("missing file should fail")
	}
}
