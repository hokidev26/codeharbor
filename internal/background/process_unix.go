//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package background

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("/bin/sh", "-c", command)
}

func configureCommandProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateCommandProcessGroup(command *exec.Cmd, done <-chan error, grace time.Duration) error {
	if command.Process == nil {
		return <-done
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
		_ = command.Process.Kill()
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
			_ = command.Process.Kill()
		}
		return <-done
	}
}
