//go:build windows

package background

import "os/exec"

func newShellCommand(command string) *exec.Cmd {
	return exec.Command("cmd.exe", "/C", command)
}
