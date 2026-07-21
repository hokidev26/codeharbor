//go:build plan9 || js || wasip1

package background

import "os/exec"

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("sh", "-c", command)
}
