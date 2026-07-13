//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package preview

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func dynamicSupported() bool { return true }

func prepareDynamicProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateDynamicProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func killDynamicProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func validateLoopbackListener(ctx context.Context, port int) error {
	lsof, err := exec.LookPath("lsof")
	if err != nil {
		return nil
	}
	checkCtx, cancel := context.WithTimeout(ctx, 1500_000_000)
	defer cancel()
	output, runErr := exec.CommandContext(
		checkCtx,
		lsof,
		"-nP",
		"-iTCP:"+strconv.Itoa(port),
		"-sTCP:LISTEN",
		"-Fn",
	).Output()
	if runErr != nil && len(output) == 0 {
		return nil
	}
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.HasPrefix(line, "n") {
			continue
		}
		listener := strings.ToLower(strings.TrimPrefix(line, "n"))
		if strings.HasPrefix(listener, "*:") || strings.HasPrefix(listener, "0.0.0.0:") || strings.HasPrefix(listener, "[::]:") || strings.HasPrefix(listener, ":::") {
			return fmt.Errorf("preview server exposed a wildcard listener")
		}
	}
	return nil
}
