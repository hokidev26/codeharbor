//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package background

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"autoto/internal/db"
)

func TestShellExecutorRunsAndPersistsOutput(t *testing.T) {
	ctx := context.Background()
	store, agent := testStoreAndAgent(t)
	defer store.Close()
	manager := NewManager(store, Options{WorkerCount: 1, PollInterval: 5 * time.Millisecond})
	if err := manager.RegisterExecutor(db.BackgroundTaskKindShell, NewShellExecutor()); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer manager.Close(context.Background())
	payload, _ := json.Marshal(ShellPayload{Command: "printf shell-ok; printf shell-err >&2"})
	task, err := manager.Submit(ctx, db.BackgroundTask{OwnerAgentID: agent.ID, Kind: db.BackgroundTaskKindShell, PayloadJSON: payload})
	if err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	completed, err := manager.Wait(waitCtx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != db.BackgroundTaskStatusSucceeded || completed.ExitCode == nil || *completed.ExitCode != 0 {
		t.Fatalf("unexpected shell task: %+v", completed)
	}
	page, err := manager.ListOutput(ctx, task.ID, 0, 4096)
	if err != nil {
		t.Fatal(err)
	}
	var combined strings.Builder
	for _, item := range page.Items {
		combined.Write(item.Chunk)
	}
	if output := combined.String(); !strings.Contains(output, "shell-ok") || !strings.Contains(output, "shell-err") {
		t.Fatalf("unexpected shell output %q", output)
	}
}

func TestParseShellPayloadRejectsUnknownEnvironment(t *testing.T) {
	if _, err := parseShellPayload(json.RawMessage(`{"command":"printf ok","env":{"TOKEN":"secret"}}`)); err == nil {
		t.Fatal("shell payload unexpectedly accepted env")
	}
	if _, err := parseShellPayload(json.RawMessage(`{"command":"printf ok","timeoutMs":1,"cwd":"/tmp"}`)); err != nil {
		t.Fatalf("valid shell payload rejected: %v", err)
	}
}

func TestShellExecutorCancellationUsesProcessGroup(t *testing.T) {
	ctx := context.Background()
	store, agent := testStoreAndAgent(t)
	defer store.Close()
	manager := NewManager(store, Options{WorkerCount: 1, PollInterval: 5 * time.Millisecond})
	shell := NewShellExecutor()
	shell.TerminateGrace = 50 * time.Millisecond
	if err := manager.RegisterExecutor(db.BackgroundTaskKindShell, shell); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer manager.Close(context.Background())
	payload, _ := json.Marshal(ShellPayload{Command: "trap '' TERM; sleep 10"})
	task, err := manager.Submit(ctx, db.BackgroundTask{OwnerAgentID: agent.ID, Kind: db.BackgroundTaskKindShell, PayloadJSON: payload})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		current, err := manager.Get(ctx, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == db.BackgroundTaskStatusRunning {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("shell task did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	started := time.Now()
	if _, err := manager.Cancel(ctx, task.ID); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	canceled, err := manager.Wait(waitCtx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if canceled.Status != db.BackgroundTaskStatusCanceled {
		t.Fatalf("unexpected canceled shell task: %+v", canceled)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("shell process group cancellation took %s", elapsed)
	}
}
