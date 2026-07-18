import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorkState, normalizeWorkStateSnapshot, renderWorkStateHTML, workStateLimits } from "./work-state.mjs";

const labels = {
  title: "Work state",
  goal: "Goal",
  role: "Role",
  taskCounts: "Task counts",
  activeTask: "Active task",
  verification: "Verification",
  reviewer: "Reviewer",
  declaredTest: "Declared test",
  taskStatuses: { todo: "Todo", doing: "Doing", done: "Done", blocked: "Blocked" },
  verificationStatuses: { passed: "Passed", failed: "Failed" },
  reviewerStatuses: { pass: "Pass", needs_human: "Needs human review" },
};

test("normalization safely degrades for missing and old snapshots", () => {
  assert.equal(normalizeWorkStateSnapshot(null), null);
  assert.equal(normalizeWorkStateSnapshot({ protocol: 1, agent: { id: "old-agent" }, messages: [] }), null);
  assert.deepEqual(normalizeWorkState({
    goal: { text: "Ship the read-only panel" },
    role: { name: "Implementer" },
    tasks: [
      { title: "Inspect", state: "completed" },
      { text: "Implement", status: "in_progress" },
      "Verify",
    ],
    declared_tests: ["node --test work-state.test.mjs"],
  }), {
    agentId: "",
    goal: "Ship the read-only panel",
    role: "Implementer",
    counts: { todo: 1, doing: 1, done: 1, blocked: 0 },
    activeTasks: [
      { text: "Implement", status: "doing" },
      { text: "Verify", status: "todo" },
    ],
    verification: { status: "declared", summary: "", reviewerVerdict: "", declaredTests: ["node --test work-state.test.mjs"] },
    hasTaskData: true,
  });
});

test("rendering escapes and bounds every snapshot-provided text", () => {
  const attack = `<img src=x onerror=alert(1)>${"x".repeat(workStateLimits.goal + 50)}`;
  const html = renderWorkStateHTML({
    workState: {
      goal: attack,
      role: "<script>bad()</script>",
      activeTasks: Array.from({ length: 12 }, (_, index) => ({ text: `<b>task ${index}</b>`, status: "doing" })),
      verification: { summary: "<svg/onload=bad>", declaredTests: ["<test>"] },
    },
  }, labels);

  assert.doesNotMatch(html, /<img|<script|<svg|<b>|<test>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/<span>Active task<\/span>/g) || []).length, 3);
  assert.ok(normalizeWorkState({ goal: attack }).goal.length <= workStateLimits.goal);
});

test("reviewer pass is rendered as review evidence, never as tests passed", () => {
  const html = renderWorkStateHTML({
    goal: "Check the change",
    verification: {
      reviewVerdict: "pass",
      declaredTests: ["node --test focused.test.mjs"],
    },
  }, labels);

  assert.match(html, /<span>Reviewer<\/span><strong>Pass<\/strong>/);
  assert.match(html, /<span>Declared test<\/span>/);
  assert.doesNotMatch(html.toLowerCase(), /tests passed/);
  assert.doesNotMatch(html, /<span>Verification<\/span><strong>Passed<\/strong>/);
});

test("authoritative snapshots replace rather than merge work state", () => {
  const first = normalizeWorkStateSnapshot({ agent: { id: "a" }, workState: { goal: "old", role: "builder" } });
  const replacement = normalizeWorkStateSnapshot({ agent: { id: "a" }, workState: { goal: "new" } });
  const projectedRole = normalizeWorkStateSnapshot({
    agent: { id: "a" },
    workState: { executionRoles: [{ agentId: "a", role: "primary" }, { agentId: "child", role: "reviewer" }] },
  });
  const cleared = normalizeWorkStateSnapshot({ agent: { id: "a" }, protocol: 1 });

  assert.equal(first.role, "builder");
  assert.equal(replacement.goal, "new");
  assert.equal(replacement.role, "");
  assert.equal(projectedRole.role, "reviewer");
  assert.equal(cleared, null);
});
