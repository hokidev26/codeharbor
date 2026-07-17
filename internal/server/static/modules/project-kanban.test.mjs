import test from "node:test";
import assert from "node:assert/strict";

import {
  createProjectKanbanController,
  projectKanbanStatuses,
  renderProjectKanban,
} from "./project-kanban.mjs";

function boardState(tasks = [], overrides = {}) {
  return {
    rootAgent: { id: "agent-1", title: "Agent 1" },
    selectedAgentId: "agent-1",
    board: { agentId: "agent-1", revision: 1, tasks },
    loading: false,
    loaded: true,
    saving: false,
    error: "",
    ...overrides,
  };
}

function task(id, status, text = id, overrides = {}) {
  return {
    id,
    agentId: "agent-1",
    text,
    status,
    protected: false,
    position: 0,
    revision: 1,
    sourceType: "manual",
    ...overrides,
  };
}

test("project Kanban renders four escaped status columns", () => {
  const html = renderProjectKanban(boardState([
    task("todo-1", "todo", "<script>alert(1)</script>"),
    task("doing-1", "doing"),
    task("blocked-1", "blocked", "Blocked", { protected: true }),
    task("done-1", "done"),
  ]), { labels: { title: "Agent tasks" } });

  assert.deepEqual(projectKanbanStatuses, ["todo", "doing", "blocked", "done"]);
  for (const status of projectKanbanStatuses) assert.match(html, new RegExp(`data-kanban-status="${status}"`));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /class="project-kanban-card protected"/);
});

test("project Kanban renders loading, error, and no-agent states", () => {
  const loading = renderProjectKanban(boardState([], { selectedAgentId: "", loading: true, loaded: false }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /project-kanban-loading/);
  assert.match(loading, /project-kanban-empty/);

  const failed = renderProjectKanban(boardState([], { error: "<failed>" }));
  assert.match(failed, /project-kanban-error/);
  assert.match(failed, /&lt;failed&gt;/);
});

test("project Kanban delegates mutations to the shared Spec controller", async () => {
  let snapshot = boardState([task("task-1", "todo", "Ship it")]);
  const calls = [];
  const listeners = new Set();
  const specBoard = {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setAgent(agent) { calls.push(["setAgent", agent]); },
    async createTask(input) { calls.push(["create", input]); return true; },
    async updateTask(id, input) { calls.push(["update", id, input]); return true; },
    async deleteTask(id) { calls.push(["delete", id]); return true; },
  };
  const host = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const controller = createProjectKanbanController({ specBoard, host });
  const destroy = controller.bind();

  assert.match(host.innerHTML, /Ship it/);
  assert.equal(await controller.changeStatus("task-1", "doing"), true);
  assert.deepEqual(calls.at(-1), ["update", "task-1", { text: "Ship it", status: "doing", protected: false }]);
  assert.equal(await controller.createTask({ text: "Next", status: "todo", protected: false }), true);
  assert.equal(await controller.deleteTask("task-1"), true);
  assert.equal(controller.setAgent({ id: "agent-2", title: "Agent 2" }), true);
  assert.deepEqual(calls.at(-1), ["setAgent", { id: "agent-2", title: "Agent 2" }]);

  destroy();
  assert.equal(listeners.size, 0);
});

test("project Kanban focuses the task creator for the task-mode add action", () => {
  const calls = [];
  const input = {
    disabled: false,
    scrollIntoView(options) { calls.push(["scroll", options]); },
    focus() { calls.push(["focus"]); },
  };
  const snapshot = boardState([]);
  const specBoard = {
    getState: () => snapshot,
    subscribe(listener) { listener(snapshot); return () => {}; },
  };
  const host = {
    innerHTML: "",
    querySelector(selector) { return selector === "[data-kanban-create-text]" ? input : null; },
    querySelectorAll: () => [],
  };
  const controller = createProjectKanbanController({ specBoard, host });
  controller.bind();

  assert.equal(controller.focusCreate(), true);
  assert.deepEqual(calls, [
    ["scroll", { block: "center", behavior: "smooth" }],
    ["focus"],
  ]);
  input.disabled = true;
  assert.equal(controller.focusCreate(), false);
});

test("project Kanban clears ephemeral editing when the selected Agent changes", () => {
  let snapshot = boardState([task("task-1", "todo")]);
  let listener;
  const specBoard = {
    getState: () => snapshot,
    subscribe(next) { listener = next; next(snapshot); return () => {}; },
    async updateTask() { return true; },
  };
  const host = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const controller = createProjectKanbanController({ specBoard, host });
  controller.bind();
  assert.equal(controller.startEdit("task-1"), true);
  assert.equal(controller.getState().editingTaskId, "task-1");

  snapshot = boardState([], {
    rootAgent: { id: "agent-2", title: "Agent 2" },
    selectedAgentId: "agent-2",
    board: { agentId: "agent-2", revision: 0, tasks: [] },
  });
  listener(snapshot);
  assert.equal(controller.getState().editingTaskId, "");
});
