package update

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
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
		t.Fatal("expected sha mismatch")
	}
	if _, err := StageLocalBinary(home, src, "../evil", ""); err == nil {
		t.Fatal("expected path version reject")
	}
}
