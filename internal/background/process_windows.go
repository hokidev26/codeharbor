//go:build windows

package background

import (
	"os/exec"
	"syscall"
	"time"
)

const createNewProcessGroup = 0x00000200

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("cmd.exe", "/C", command)
}

func configureCommandProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}

func terminateCommandProcessGroup(command *exec.Cmd, done <-chan error, grace time.Duration) error {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
	return <-done
}
