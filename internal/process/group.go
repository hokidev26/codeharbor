// Package process provides cross-platform process-group helpers so managed
// child trees can be terminated together when Autoto stops a task, closes a
// preview, or shuts down a desktop runtime.
//
// Unix builds use a process group (Setpgid). Windows builds use a Job Object
// with KILL_ON_JOB_CLOSE so descendants die when the job handle is closed.
package process

import (
	"os/exec"
	"time"
)

// Group tracks platform-specific state for a managed process tree.
type Group struct {
	platform platformGroup
}

// Prepare configures cmd so its process can join a managed group. Call this
// before cmd.Start(). On success, call Started after Start succeeds.
func Prepare(cmd *exec.Cmd) *Group {
	if cmd == nil {
		return &Group{}
	}
	return &Group{platform: preparePlatform(cmd)}
}

// Started finalizes group membership after cmd.Start() succeeds.
func (g *Group) Started(cmd *exec.Cmd) error {
	if g == nil {
		return nil
	}
	return g.platform.started(cmd)
}

// Terminate requests a graceful shutdown of the group, then escalates after grace.
// done must be the channel that receives cmd.Wait()'s result.
func (g *Group) Terminate(cmd *exec.Cmd, done <-chan error, grace time.Duration) error {
	if g == nil {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		if done != nil {
			return <-done
		}
		return nil
	}
	if grace <= 0 {
		grace = 2 * time.Second
	}
	return g.platform.terminate(cmd, done, grace)
}

// Kill forcefully stops the managed group.
func (g *Group) Kill(cmd *exec.Cmd) error {
	if g == nil {
		if cmd != nil && cmd.Process != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
	return g.platform.kill(cmd)
}

// Close releases platform handles. On Windows this also kills remaining job
// members when KILL_ON_JOB_CLOSE is set.
func (g *Group) Close() error {
	if g == nil {
		return nil
	}
	return g.platform.close()
}

type platformGroup interface {
	started(cmd *exec.Cmd) error
	terminate(cmd *exec.Cmd, done <-chan error, grace time.Duration) error
	kill(cmd *exec.Cmd) error
	close() error
}
