package background

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"autoto/internal/tools"
)

func TestServiceScopesAndProjectsPublicTask(t *testing.T) {
	ctx := context.Background()
	store, owner := testStoreAndAgent(t)
	defer store.Close()
	manager := NewManager(store, Options{})
	service := NewService(manager, store)
	payload := json.RawMessage(`{"command":"printf secret","cwd":"/private"}`)
	task, err := service.Submit(ctx, tools.BackgroundTaskRequest{Kind: tools.BackgroundTaskKindShell, OwnerAgentID: owner.ID, Payload: payload, PublicSummary: json.RawMessage(`{"program":"printf"}`)})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(task)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "workerInstanceId") {
		t.Fatalf("public task leaked private execution data: %s", encoded)
	}
	if _, err := service.Get(ctx, "another-agent", task.ID); err == nil {
		t.Fatal("cross-owner lookup unexpectedly succeeded")
	}
	if _, err := store.AppendBackgroundTaskOutput(ctx, task.ID, "stdout", []byte{'o', 'k', 0xff}, 4096); err != nil {
		t.Fatal(err)
	}
	page, err := service.Output(ctx, owner.ID, task.ID, 0, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Chunks) != 1 || !strings.Contains(page.Chunks[0].Text, "ok") || !strings.Contains(page.Chunks[0].Text, "�") {
		t.Fatalf("output was not projected as safe UTF-8: %+v", page)
	}
}

func TestServiceWaitHonorsTimeout(t *testing.T) {
	ctx := context.Background()
	store, owner := testStoreAndAgent(t)
	defer store.Close()
	service := NewService(NewManager(store, Options{PollInterval: time.Millisecond}), store)
	task, err := service.Submit(ctx, tools.BackgroundTaskRequest{Kind: tools.BackgroundTaskKindAgent, OwnerAgentID: owner.ID, Payload: json.RawMessage(`{"prompt":"wait"}`)})
	if err != nil {
		t.Fatal(err)
	}
	current, err := service.Wait(ctx, owner.ID, task.ID, 5)
	if err != nil || current.ID != task.ID || current.Status != "queued" {
		t.Fatalf("expected current task after wait timeout, task=%+v err=%v", current, err)
	}
}

func TestAgentPayloadAndCapabilityBoundaries(t *testing.T) {
	if _, err := parseAgentPayload(json.RawMessage(`{"prompt":"ok","env":{"SECRET":"no"}}`)); err == nil {
		t.Fatal("unknown agent payload field was accepted")
	}
	if _, err := childPermissionCap("readOnly", "acceptEdits"); err == nil {
		t.Fatal("child capability was allowed to widen parent capability")
	}
	if cap, err := childPermissionCap("acceptEdits", "readOnly"); err != nil || cap != "readOnly" {
		t.Fatalf("unexpected narrowed child capability cap=%q err=%v", cap, err)
	}
}
