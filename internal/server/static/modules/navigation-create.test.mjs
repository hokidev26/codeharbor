import test from "node:test";
import assert from "node:assert/strict";

import { navigationCreateLabelKey, navigationCreateTarget } from "./navigation-create.mjs";

test("schedules mode always creates a schedule regardless of navigation mode", () => {
  for (const navigationMode of ["conversations", "projects", "all", "", undefined]) {
    assert.equal(navigationCreateTarget({ activeWorkbench: "schedules", navigationMode }), "schedule");
  }
});

test("outside schedules the navigation mode chooses between conversation and project", () => {
  assert.equal(navigationCreateTarget({ activeWorkbench: "conversation", navigationMode: "conversations" }), "conversation");
  assert.equal(navigationCreateTarget({ activeWorkbench: "conversation", navigationMode: "projects" }), "project");
  assert.equal(navigationCreateTarget({ activeWorkbench: "workbench", navigationMode: "conversations" }), "conversation");
  assert.equal(navigationCreateTarget({ activeWorkbench: "workbench", navigationMode: "projects" }), "project");
});

test("anything other than the conversations mode creates a project", () => {
  // "all" and unset both list projects, so the button must offer folder
  // selection rather than silently creating a standalone conversation.
  for (const navigationMode of ["all", "", undefined, null, "unknown"]) {
    assert.equal(navigationCreateTarget({ activeWorkbench: "conversation", navigationMode }), "project");
  }
  assert.equal(navigationCreateTarget(), "project");
  assert.equal(navigationCreateTarget({}), "project");
});

test("each target has a label and the labels stay distinct", () => {
  assert.equal(navigationCreateLabelKey("schedule"), "shell.newSchedule");
  assert.equal(navigationCreateLabelKey("project"), "shell.chooseFolder");
  assert.equal(navigationCreateLabelKey("conversation"), "shell.newConversation");
  const keys = ["schedule", "project", "conversation"].map(navigationCreateLabelKey);
  assert.equal(new Set(keys).size, 3, "the three targets must not share a label");
});

test("the label agrees with the target for every reachable state", () => {
  // The button's tooltip and aria-label are derived from the same target it
  // acts on; a mismatch would announce one action and perform another.
  const expected = {
    schedule: "shell.newSchedule",
    project: "shell.chooseFolder",
    conversation: "shell.newConversation",
  };
  for (const activeWorkbench of ["conversation", "workbench", "schedules"]) {
    for (const navigationMode of ["conversations", "projects", "all"]) {
      const target = navigationCreateTarget({ activeWorkbench, navigationMode });
      assert.equal(navigationCreateLabelKey(target), expected[target], `${activeWorkbench}/${navigationMode}`);
    }
  }
});

test("an unknown target falls back to the conversation label", () => {
  assert.equal(navigationCreateLabelKey("nonsense"), "shell.newConversation");
  assert.equal(navigationCreateLabelKey(undefined), "shell.newConversation");
});
