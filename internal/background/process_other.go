//go:build plan9 || js || wasip1

package background

import (
	"os/exec"
	"time"
)

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("sh", "-c", command)
}

func configureCommandProcessGroup(command *exec.Cmd) {}

func terminateCommandProcessGroup(command *exec.Cmd, done <-chan error, grace time.Duration) error {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
	return <-done
}
