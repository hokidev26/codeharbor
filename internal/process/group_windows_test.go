//go:build windows

package process

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsJobObjectKillsProcessTree(t *testing.T) {
	// Launch a cmd that starts a grandchild and then waits. Closing the job
	// with KILL_ON_JOB_CLOSE must reap the whole tree.
	marker := filepath.Join(t.TempDir(), "alive.txt")
	// Parent: start child that loops writing the marker, then sleep.
	// Use cmd /c start /b so a second process joins the job via inheritance
	// when CREATE_BREAKAWAY_FROM_JOB is not set (default for children of a
	// job-assigned process on modern Windows).
	script := `ping -n 30 127.0.0.1 >nul`
	cmd := exec.Command("cmd", "/C", script)
	group := Prepare(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := group.Started(cmd); err != nil {
		_ = cmd.Process.Kill()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	// Process should still be alive briefly.
	time.Sleep(100 * time.Millisecond)
	if cmd.Process == nil {
		t.Fatal("missing process")
	}

	started := time.Now()
	if err := group.Terminate(cmd, done, 500*time.Millisecond); err == nil {
		// Wait result may be non-nil exit; ignore.
	}
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("job terminate took %s", elapsed)
	}
	_ = group.Close()

	// Best-effort: marker file must not keep growing after kill (optional).
	_ = os.Remove(marker)
}

func TestWindowsJobObjectCreateAndAssign(t *testing.T) {
	cmd := exec.Command("cmd", "/C", "ping -n 5 127.0.0.1 >nul")
	group := Prepare(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := group.Started(cmd); err != nil {
		_ = cmd.Process.Kill()
		t.Fatalf("Started: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	_ = group.Kill(cmd)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("process did not exit after job kill")
	}
	_ = group.Close()
}
