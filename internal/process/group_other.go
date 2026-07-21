//go:build plan9 || js || wasip1

package process

import (
	"os/exec"
	"time"
)

type otherGroup struct{}

func preparePlatform(cmd *exec.Cmd) platformGroup {
	return otherGroup{}
}

func (otherGroup) started(*exec.Cmd) error { return nil }

func (otherGroup) terminate(cmd *exec.Cmd, done <-chan error, grace time.Duration) error {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if done != nil {
		return <-done
	}
	return nil
}

func (otherGroup) kill(cmd *exec.Cmd) error {
	if cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

func (otherGroup) close() error { return nil }
