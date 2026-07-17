import test from "node:test";
import assert from "node:assert/strict";

import {
  createBackgroundTasksController,
  normalizeBackgroundTask,
  normalizeContinuation,
  summarizeBackgroundTasks,
} from "./background-tasks.mjs";

test("background task normalization accepts API aliases and derives duration", () => {
  const task = normalizeBackgroundTask({
    taskId: "task-1",
    taskKind: "subagent",
    state: "completed",
    started_at: "2026-07-16T10:00:00Z",
    endedAt: "2026-07-16T10:00:03Z",
    childAgent: { id: "child-1" },
    childRun: { id: "run-1" },
  });
  assert.equal(task.id, "task-1");
  assert.equal(task.kind, "subagent");
  assert.equal(task.durationMs, 3000);
  assert.equal(task.childAgentId, "child-1");
  assert.equal(task.childRunId, "run-1");
});

test("task summary derives readable titles and separates running from queued work", () => {
  const shell = normalizeBackgroundTask({ id: "shell-1", kind: "shell", status: "running", publicSummary: { program: "go", subcommand: "test" } });
  const child = normalizeBackgroundTask({ id: "agent-1", kind: "agent", status: "queued", publicSummary: { description: "Inspect auth flow", model: "codex:gpt" } });
  assert.equal(shell.title, "go test");
  assert.equal(child.title, "Inspect auth flow");
  const summary = summarizeBackgroundTasks([
    shell,
    child,
    { id: "approval-1", kind: "shell", status: "waiting_approval", publicSummary: JSON.stringify({ program: "npm" }) },
    { id: "done-1", kind: "shell", status: "succeeded", title: "Finished" },
  ]);
  assert.equal(summary.current.id, "shell-1");
  assert.equal(summary.current.title, "go test");
  assert.equal(summary.runningCount, 1);
  assert.equal(summary.queuedCount, 2);
  assert.equal(summary.activeCount, 3);
  assert.equal(summary.totalCount, 4);
});

test("task panel reports open and close transitions for the shared chat utility column", async () => {
  const transitions = [];
  const controller = createBackgroundTasksController({
    request: async (path) => path.includes("/output?")
      ? { chunks: [] }
      : { id: "task-1", agentId: "agent-1", kind: "shell", status: "running", title: "Run checks" },
    onOpenChange: (open, detail) => transitions.push({ open, reason: detail.reason }),
  });
  controller.setAgent("agent-1");
  controller.applySnapshot({ backgroundTasks: [{ id: "task-1", agentId: "agent-1", status: "running", title: "Run checks" }] }, { agentId: "agent-1" });

  await controller.selectTask("task-1");
  assert.equal(controller.state().trayOpen, true);
  assert.deepEqual(transitions[0], { open: true, reason: "task-selected" });

  assert.equal(controller.closeTray("details-open"), true);
  assert.equal(controller.state().trayOpen, false);
  assert.deepEqual(transitions[1], { open: false, reason: "details-open" });
  assert.equal(controller.closeTray(), false);
});

test("controller reconciles snapshots and live task events without duplicating order", () => {
  const controller = createBackgroundTasksController({ request: async () => [] });
  controller.setAgent("agent-1");
  controller.applySnapshot({
    agent: { id: "agent-1" },
    backgroundTasks: [{ id: "task-1", kind: "bash", status: "running" }],
    recentBackgroundTasks: [{ id: "task-2", kind: "subagent", status: "completed" }],
    continuation: { mode: "safe", continuationCount: 2, totalTurns: 8, maxTotalTurns: 20 },
  });
  controller.handleEvent({ type: "task.status", agentId: "agent-1", data: { taskId: "task-1", status: "waiting" } });
  controller.handleEvent({ type: "task.completed", agentId: "agent-1", data: { taskId: "task-1", status: "completed" } });

  const state = controller.state();
  assert.deepEqual(state.order, ["task-1", "task-2"]);
  assert.equal(state.tasksById["task-1"].status, "completed");
  assert.equal(state.continuation.mode, "safe");
  assert.equal(state.continuation.count, 2);
  assert.equal(state.continuation.turnsUsed, 8);
});

test("output pagination tracks cursors, deduplicates chunks, and marks truncation", async () => {
  const requests = [];
  const pages = [
    { chunks: [{ sequence: 1, text: "one\n" }, { sequence: 2, text: "two\n" }], nextSequence: 2, hasMore: true },
    { chunks: [{ sequence: 2, text: "two\n" }, { sequence: 3, text: "three\n" }], nextSequence: 3, truncated: true, hasMore: false },
  ];
  const controller = createBackgroundTasksController({
    request: async (path) => {
      requests.push(path);
      return pages.shift();
    },
  });
  await controller.setAgent("agent-1");
  controller.applySnapshot({ backgroundTasks: [{ id: "task-1", agentId: "agent-1", status: "running" }] }, { agentId: "agent-1" });
  await controller.loadOutput("task-1", { afterSequence: 0 });
  await controller.loadOutput("task-1");

  assert.deepEqual(requests, [
    "/api/background-tasks/task-1/output?afterSequence=0",
    "/api/background-tasks/task-1/output?afterSequence=2",
  ]);
  assert.deepEqual(controller.state().outputs["task-1"].map((chunk) => chunk.text), ["one\n", "two\n", "three\n"]);
  assert.equal(controller.state().outputCursors["task-1"], 3);
  assert.equal(controller.getTask("task-1").truncated, true);
});

test("wait and cancel use agreed endpoints and expose busy state during requests", async () => {
  const calls = [];
  let releaseCancel;
  const controller = createBackgroundTasksController({
    request: async (path, options) => {
      calls.push({ path, method: options.method });
      if (path.endsWith("/wait")) return { id: "task-1", status: "completed" };
      if (path.endsWith("/output?afterSequence=0")) return { chunks: [] };
      if (path.endsWith("/cancel")) return new Promise((resolve) => { releaseCancel = () => resolve({ id: "task-2", status: "cancelled" }); });
      return {};
    },
  });
  controller.setAgent("agent-1");
  controller.applySnapshot({ backgroundTasks: [
    { id: "task-1", status: "running" },
    { id: "task-2", status: "queued" },
  ] }, { agentId: "agent-1" });

  await controller.wait("task-1");
  const cancellation = controller.cancel("task-2");
  assert.deepEqual(controller.state().cancelBusy, ["task-2"]);
  releaseCancel();
  await cancellation;

  assert.deepEqual(calls.map((call) => call.path), [
    "/api/background-tasks/task-1/wait",
    "/api/background-tasks/task-1/output?afterSequence=0",
    "/api/background-tasks/task-2/cancel",
  ]);
  assert.equal(controller.getTask("task-2").status, "cancelled");
  assert.deepEqual(controller.state().cancelBusy, []);
});

test("in-flight task requests cannot repopulate state after an Agent change", async () => {
  const pending = new Map();
  const controller = createBackgroundTasksController({
    request: (path) => new Promise((resolve) => pending.set(path, resolve)),
  });
  controller.setAgent("agent-1");
  controller.applySnapshot({ backgroundTasks: [{ id: "task-1", agentId: "agent-1", status: "running" }] }, { agentId: "agent-1" });

  const taskRequest = controller.loadTask("task-1");
  const outputRequest = controller.loadOutput("task-1", { afterSequence: 0 });
  const waitRequest = controller.wait("task-1");
  const cancelRequest = controller.cancel("task-1");
  controller.setAgent("agent-2");

  pending.get("/api/background-tasks/task-1")?.({ id: "task-1", agentId: "agent-1", status: "completed" });
  pending.get("/api/background-tasks/task-1/output?afterSequence=0")?.({ chunks: [{ sequence: 1, text: "stale" }] });
  pending.get("/api/background-tasks/task-1/wait")?.({ id: "task-1", agentId: "agent-1", status: "completed" });
  pending.get("/api/background-tasks/task-1/cancel")?.({ id: "task-1", agentId: "agent-1", status: "cancelled" });
  await Promise.all([taskRequest, outputRequest, waitRequest, cancelRequest]);

  const state = controller.state();
  assert.equal(state.agentId, "agent-2");
  assert.deepEqual(state.tasksById, {});
  assert.deepEqual(state.outputs, {});
  assert.deepEqual(state.waitBusy, []);
  assert.deepEqual(state.cancelBusy, []);
});

test("continuation events retain budgets while updating lifecycle status", () => {
  const normalized = normalizeContinuation({
    autoContinuationMode: "safe",
    count: 1,
    segmentTurns: 4,
    budgets: { maxTotalTurns: 24, maxTokens: 8000, durationMs: 120000 },
  });
  assert.equal(normalized.mode, "safe");
  assert.equal(normalized.maxTotalTurns, 24);
  assert.equal(normalized.tokenBudget, 8000);

  const controller = createBackgroundTasksController({ request: async () => ({}) });
  controller.setAgent("agent-1");
  controller.applySnapshot({ continuation: normalized }, { agentId: "agent-1" });
  controller.handleEvent({ type: "agent.continuation_blocked", agentId: "agent-1", data: { reason: "waiting approval", waitingTaskId: "task-3" } });
  controller.handleEvent({ type: "agent.budget_exhausted", agentId: "agent-1", data: { reason: "token budget", tokensUsed: 8000 } });
  const continuation = controller.getContinuation();
  assert.equal(continuation.status, "budget_exhausted");
  assert.equal(continuation.reason, "token budget");
  assert.equal(continuation.tokenBudget, 8000);
  assert.equal(continuation.tokensUsed, 8000);
});
