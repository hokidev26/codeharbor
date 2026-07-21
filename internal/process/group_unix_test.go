//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package process

import (
	"os/exec"
	"testing"
	"time"
)

func TestUnixGroupTerminatesProcessTree(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "trap '' TERM; sleep 30")
	group := Prepare(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := group.Started(cmd); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	started := time.Now()
	if err := group.Terminate(cmd, done, 50*time.Millisecond); err == nil {
		// Wait may return an exit error; either way the process should end quickly.
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("process group terminate took %s", elapsed)
	}
	_ = group.Close()
}
