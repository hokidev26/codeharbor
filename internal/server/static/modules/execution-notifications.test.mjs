import test from "node:test";
import assert from "node:assert/strict";

import {
  createExecutionNotifications,
  executionNotificationFamily,
  executionNotificationKey,
  executionNotificationDefaults,
} from "./execution-notifications.mjs";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("execution notification keys normalize live and snapshot event families", () => {
  assert.equal(executionNotificationFamily("agent.done"), "completed");
  assert.equal(executionNotificationFamily({ status: "failed" }), "error");
  assert.equal(executionNotificationFamily("tool.approval_required"), "approval_required");
  assert.equal(executionNotificationKey("agent-1", 7, "agent.done"), "agent-1:7:completed");
  assert.equal(executionNotificationFamily({ type: "task.completed", data: { status: "failed" } }), "task_terminal");
  assert.equal(executionNotificationKey("agent-1", 7, { type: "task.completed", data: { taskId: "task-1" } }), "agent-1:7:task:task-1:task_terminal");
  assert.equal(executionNotificationKey("agent-1", 7, { type: "agent.continuation_blocked", data: { count: 2 } }), "agent-1:7:continuation:2:continuation_blocked");
  assert.equal(executionNotificationKey("agent-1", 7, { type: "agent.budget_exhausted", data: { budgetKind: "tokens" } }), "agent-1:7:budget:tokens:budget_exhausted");
  assert.equal(executionNotificationDefaults.storageKey, "autoto.executionNotifications.v1");
});

test("initial snapshot establishes checkpoints without replaying historical notifications", async () => {
  const storage = new MemoryStorage();
  const notices = [];
  const controller = createExecutionNotifications({ storage, notifier: (notice) => notices.push(notice) });

  const result = await controller.initial({
    agent: { id: "agent-1", executionGeneration: 4 },
    executionGeneration: 4,
    executionsSince: [
      { id: "run-3", agentId: "agent-1", executionGeneration: 3, status: "failed" },
      { id: "run-4", agentId: "agent-1", executionGeneration: 4, status: "completed" },
    ],
    latestRun: { id: "run-4", agentId: "agent-1", executionGeneration: 4, status: "completed" },
  });

  assert.equal(result.notified, 0);
  assert.equal(controller.checkpoint("agent-1"), 4);
  assert.deepEqual(notices, []);
  assert.deepEqual(controller.state().seen, ["agent-1:3:error", "agent-1:4:completed"]);

  await controller.live({ type: "agent.done", agentId: "agent-1", data: { executionGeneration: 4, runId: "run-4" } });
  assert.deepEqual(notices, []);
  await controller.live({ type: "tool.approval_required", agentId: "agent-1", data: { executionGeneration: 5, runId: "run-5", toolUseId: "tool-1" } });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].key, "agent-1:5:approval_required");
  assert.equal(controller.getCheckpoint("agent-1"), 5);
});

test("live and recovery snapshots share one dedupe set", async () => {
  const notices = [];
  const controller = createExecutionNotifications({
    storage: new MemoryStorage(),
    notifier: (notice) => notices.push(notice),
  });

  await controller.live({ type: "agent.done", agentId: "agent-1", data: { executionGeneration: 6, runId: "run-6" } });
  await controller.snapshot({
    agent: { id: "agent-1" },
    executionGeneration: 7,
    executionsSince: [
      { id: "run-6", agentId: "agent-1", executionGeneration: 6, status: "completed" },
      { id: "run-7", agentId: "agent-1", executionGeneration: 7, status: "failed" },
    ],
    executionsTruncated: false,
  });

  assert.deepEqual(notices.map((notice) => notice.key), [
    "agent-1:6:completed",
    "agent-1:7:error",
  ]);
  assert.equal(notices[1].source, "snapshot");
  assert.equal(controller.checkpoint("agent-1"), 7);
});

test("truncated recovery emits one summary and marks included events as seen", async () => {
  const notices = [];
  const controller = createExecutionNotifications({
    storage: new MemoryStorage(),
    notifier: (notice) => notices.push(notice),
  });
  const truncated = {
    agent: { id: "agent-1" },
    executionGeneration: 12,
    executionsSince: [
      { id: "run-10", agentId: "agent-1", executionGeneration: 10, status: "completed" },
      { id: "run-11", agentId: "agent-1", executionGeneration: 11, status: "failed" },
    ],
    executionsTruncated: true,
  };

  const first = await controller.snapshot(truncated);
  assert.equal(first.notified, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].family, "truncated");
  assert.equal(notices[0].key, "agent-1:12:truncated");
  assert.equal(notices[0].recoveredCount, 2);
  assert.equal(controller.checkpoint("agent-1"), 12);

  await controller.live({ type: "agent.done", agentId: "agent-1", data: { executionGeneration: 10, runId: "run-10" } });
  await controller.snapshot(truncated);
  assert.equal(notices.length, 1);
});

test("task terminals and continuation failures use scoped dedupe keys", async () => {
  const notices = [];
  const controller = createExecutionNotifications({
    storage: new MemoryStorage(),
    notifier: (notice) => notices.push(notice),
  });

  await controller.live({ type: "task.completed", agentId: "agent-1", data: { taskId: "task-1", executionGeneration: 8, status: "completed" } });
  await controller.live({ type: "task.completed", agentId: "agent-1", data: { taskId: "task-2", executionGeneration: 8, status: "failed" } });
  await controller.live({ type: "task.status", agentId: "agent-1", data: { taskId: "task-2", executionGeneration: 8, status: "failed" } });
  await controller.live({ type: "agent.continuation_blocked", agentId: "agent-1", data: { executionGeneration: 8, count: 2, reason: "approval" } });
  await controller.live({ type: "agent.budget_exhausted", agentId: "agent-1", data: { executionGeneration: 8, budgetKind: "tokens" } });

  assert.deepEqual(notices.map((notice) => notice.key), [
    "agent-1:8:task:task-1:task_terminal",
    "agent-1:8:task:task-2:task_terminal",
    "agent-1:8:continuation:2:continuation_blocked",
    "agent-1:8:budget:tokens:budget_exhausted",
  ]);
});

test("recovery snapshots include terminal tasks and blocked continuations once", async () => {
  const notices = [];
  const controller = createExecutionNotifications({ storage: new MemoryStorage(), notifier: (notice) => notices.push(notice) });
  const snapshot = {
    agent: { id: "agent-1" },
    executionGeneration: 9,
    recentBackgroundTasks: [{ id: "task-9", status: "completed" }],
    continuation: { status: "blocked", count: 3, reason: "waiting task" },
  };
  await controller.snapshot(snapshot);
  await controller.snapshot(snapshot);
  assert.deepEqual(notices.map((notice) => notice.key), [
    "agent-1:9:task:task-9:task_terminal",
    "agent-1:9:continuation:3:continuation_blocked",
  ]);
});

test("session storage state remains bounded and survives controller recreation", async () => {
  const storage = new MemoryStorage();
  const notices = [];
  const controller = createExecutionNotifications({
    storage,
    notifier: (notice) => notices.push(notice),
    maxEntries: 3,
  });

  for (let generation = 1; generation <= 5; generation += 1) {
    await controller.live({
      type: generation % 2 ? "agent.done" : "agent.error",
      agentId: "agent-1",
      data: { executionGeneration: generation, runId: `run-${generation}` },
    });
  }

  assert.equal(controller.state().seen.length, 3);
  const stored = JSON.parse(storage.getItem(executionNotificationDefaults.storageKey));
  assert.equal(stored.seen.length, 3);
  assert.equal(stored.checkpoints[0].generation, 5);

  const recreatedNotices = [];
  const recreated = createExecutionNotifications({
    storage,
    notifier: (notice) => recreatedNotices.push(notice),
    maxEntries: 3,
  });
  await recreated.live({ type: "agent.done", agentId: "agent-1", data: { executionGeneration: 5 } });
  assert.equal(recreatedNotices.length, 0);
});
