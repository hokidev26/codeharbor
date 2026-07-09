package agent

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"time"

	"codeharbor/internal/db"
)

const gitCheckpointTimeout = 3 * time.Second

func (r *Runner) captureRunCheckpoint(ctx context.Context, narrator db.Narrator, runID string) {
	if r == nil || r.store == nil || strings.TrimSpace(runID) == "" {
		return
	}
	repoRoot, ok := gitRepoRoot(ctx, narrator.CWD)
	if !ok || !gitWorktreeClean(ctx, repoRoot) {
		return
	}
	head, ok := gitHead(ctx, repoRoot)
	if !ok {
		return
	}
	_ = r.store.UpdateRunBaseHead(context.Background(), runID, head)
}

func (r *Runner) captureRunEndHead(runID string) {
	if r == nil || r.store == nil || strings.TrimSpace(runID) == "" {
		return
	}
	run, err := r.store.GetRunByID(context.Background(), runID)
	if err != nil || strings.TrimSpace(run.BaseHead) == "" {
		return
	}
	narrator, err := r.store.GetNarrator(context.Background(), run.NarratorID)
	if err != nil {
		return
	}
	repoRoot, ok := gitRepoRoot(context.Background(), narrator.CWD)
	if !ok {
		return
	}
	if head, ok := gitHead(context.Background(), repoRoot); ok {
		_ = r.store.UpdateRunEndHead(context.Background(), runID, head)
	}
}

func gitRepoRoot(ctx context.Context, cwd string) (string, bool) {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return "", false
	}
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return "", false
	}
	out, err := runCheckpointGit(ctx, cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", false
	}
	repoRoot := strings.TrimSpace(out)
	return repoRoot, repoRoot != ""
}

func gitHead(ctx context.Context, repoRoot string) (string, bool) {
	out, err := runCheckpointGit(ctx, repoRoot, "rev-parse", "HEAD")
	if err != nil {
		return "", false
	}
	head := strings.TrimSpace(out)
	return head, head != ""
}

func gitWorktreeClean(ctx context.Context, repoRoot string) bool {
	out, err := runCheckpointGit(ctx, repoRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	return err == nil && out == ""
}

func runCheckpointGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, gitCheckpointTimeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "git", args...)
	cmd.Dir = dir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}
