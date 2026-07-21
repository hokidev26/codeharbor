//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package background

import "os/exec"

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("/bin/sh", "-c", command)
}
