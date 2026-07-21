//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package process

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

type unixGroup struct{}

func preparePlatform(cmd *exec.Cmd) platformGroup {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return unixGroup{}
}

func (unixGroup) started(*exec.Cmd) error { return nil }

func (unixGroup) terminate(cmd *exec.Cmd, done <-chan error, grace time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		if done != nil {
			return <-done
		}
		return nil
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
		_ = cmd.Process.Kill()
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
			_ = cmd.Process.Kill()
		}
		if done != nil {
			return <-done
		}
		return nil
	}
}

func (unixGroup) kill(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func (unixGroup) close() error { return nil }
