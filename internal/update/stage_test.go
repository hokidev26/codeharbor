package update

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStageLocalBinaryRoundTrip(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "autoto-desktop")
	payload := []byte("fake-binary-content-v2")
	if err := os.WriteFile(src, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	hexSum := hex.EncodeToString(sum[:])

	pending, err := StageLocalBinary(home, src, "0.2.0", hexSum)
	if err != nil {
		t.Fatal(err)
	}
	if pending.Version != "0.2.0" || pending.SHA256 != hexSum {
		t.Fatalf("pending=%+v", pending)
	}
	if _, err := os.Stat(pending.StagedPath); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(pending.StagedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("staged bytes mismatch")
	}

	loaded, ok, err := ReadPendingReplace(home)
	if err != nil || !ok {
		t.Fatalf("load ok=%v err=%v", ok, err)
	}
	if loaded.StagedPath != pending.StagedPath {
		t.Fatalf("loaded=%+v", loaded)
	}
	if err := ClearPendingReplace(home); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := ReadPendingReplace(home); err != nil || ok {
		t.Fatalf("expected cleared, ok=%v err=%v", ok, err)
	}
}

func TestStageLocalBinaryRejectsBadHashAndTraversalVersion(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "bin")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := StageLocalBinary(home, src, "1.0.0", "deadbeef"); err == nil {
		t.Fatal("expected sha format reject")
	}
	sum := sha256.Sum256([]byte("x"))
	bad := hex.EncodeToString(sum[:])
	// Flip one nibble so length stays 64 but content mismatches.
	if bad[0] == 'a' {
		bad = "b" + bad[1:]
	} else {
		bad = "a" + bad[1:]
	}
	if _, err := StageLocalBinary(home, src, "1.0.0", bad); err == nil {
		t.Fatal("expected sha mismatch")
	}
	if _, err := StageLocalBinary(home, src, "../evil", ""); err == nil {
		t.Fatal("expected path version reject")
	}
	// Empty expected hash is still allowed by StageLocalBinary (server requires it).
	if _, err := StageLocalBinary(home, src, "1.0.1", ""); err != nil {
		t.Fatalf("empty expected hash should compute: %v", err)
	}
}

// WritePendingReplace is the exported, lock-taking wrapper around
// writePendingReplaceLocked, for hosts that record a pending apply without going
// through StageLocalBinary. Cover it directly so the public entry point keeps a
// round trip with ReadPendingReplace.
func TestWritePendingReplaceRoundTripsWithoutStaging(t *testing.T) {
	home := t.TempDir()
	payload := []byte("staged-payload")
	sum := sha256.Sum256(payload)
	// ReadPendingReplace only reports a pending apply whose staged binary is
	// still on disk, so the record has to point at a real file.
	stagedPath := filepath.Join(home, "updates", "staged", "0.4.0-autoto-desktop")
	if err := os.MkdirAll(filepath.Dir(stagedPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stagedPath, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	pending := PendingReplace{
		Version:    "0.4.0",
		StagedPath: stagedPath,
		SHA256:     hex.EncodeToString(sum[:]),
		SourcePath: filepath.Join(home, "downloads", "autoto-desktop"),
		CreatedAt:  time.Now().UTC().Truncate(time.Second),
	}
	if err := WritePendingReplace(home, pending); err != nil {
		t.Fatal(err)
	}
	loaded, ok, err := ReadPendingReplace(home)
	if err != nil || !ok {
		t.Fatalf("load ok=%v err=%v", ok, err)
	}
	if loaded.Version != pending.Version || loaded.StagedPath != pending.StagedPath || loaded.SHA256 != pending.SHA256 {
		t.Fatalf("loaded=%+v want=%+v", loaded, pending)
	}
	if !loaded.CreatedAt.Equal(pending.CreatedAt) {
		t.Fatalf("createdAt round trip: got %s want %s", loaded.CreatedAt, pending.CreatedAt)
	}
	if err := ClearPendingReplace(home); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := ReadPendingReplace(home); err != nil || ok {
		t.Fatalf("expected cleared, ok=%v err=%v", ok, err)
	}
}
