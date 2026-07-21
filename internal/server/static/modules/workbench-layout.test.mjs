import test from "node:test";
import assert from "node:assert/strict";

import { primaryWorkbenchLayout } from "./workbench-sidebar-render.mjs";

const panels = ["overviewDashboard", "conversationPanel", "workbenchPanel", "schedulePanel"];

function visiblePanels(layout) {
  return panels.filter((id) => layout.hidden[id] === false);
}

function activeBodyClasses(layout) {
  return Object.entries(layout.bodyClasses).filter(([, on]) => on).map(([name]) => name);
}

test("exactly one primary panel is visible for every mode and overview combination", () => {
  for (const mode of ["conversation", "workbench", "schedules"]) {
    for (const overviewActive of [false, true]) {
      const layout = primaryWorkbenchLayout(mode, { overviewActive });
      assert.deepEqual(
        visiblePanels(layout).length,
        1,
        `mode=${mode} overview=${overviewActive} should show exactly one panel, got ${visiblePanels(layout).join(",")}`,
      );
      assert.equal(
        activeBodyClasses(layout).length,
        overviewActive || mode !== "conversation" ? 1 : 0,
        `mode=${mode} overview=${overviewActive} body classes: ${activeBodyClasses(layout).join(",")}`,
      );
    }
  }
});

test("each mode shows its own panel when overview is inactive", () => {
  assert.deepEqual(visiblePanels(primaryWorkbenchLayout("conversation")), ["conversationPanel"]);
  assert.deepEqual(visiblePanels(primaryWorkbenchLayout("workbench")), ["workbenchPanel"]);
  assert.deepEqual(visiblePanels(primaryWorkbenchLayout("schedules")), ["schedulePanel"]);

  assert.deepEqual(activeBodyClasses(primaryWorkbenchLayout("conversation")), []);
  assert.deepEqual(activeBodyClasses(primaryWorkbenchLayout("workbench")), ["workbench-mode"]);
  assert.deepEqual(activeBodyClasses(primaryWorkbenchLayout("schedules")), ["schedule-mode"]);
});

test("overview is a full-page surface that suppresses every other panel", () => {
  for (const mode of ["conversation", "workbench", "schedules"]) {
    const layout = primaryWorkbenchLayout(mode, { overviewActive: true });
    assert.deepEqual(visiblePanels(layout), ["overviewDashboard"], `overview must win over mode=${mode}`);
    assert.deepEqual(activeBodyClasses(layout), ["overview-mode"]);
    // The mode is remembered underneath so leaving overview restores it, but
    // it must not be reported as an active surface while overview is up.
    assert.equal(layout.workbench, false);
    assert.equal(layout.schedules, false);
  }
});

test("an unknown mode falls back to showing the conversation panel", () => {
  for (const mode of ["", null, undefined, "tasks", "nonsense"]) {
    const layout = primaryWorkbenchLayout(mode);
    assert.deepEqual(visiblePanels(layout), ["conversationPanel"], `mode=${String(mode)} should fall back`);
    assert.deepEqual(activeBodyClasses(layout), []);
  }
});

test("overviewActive is strict: only the boolean true counts as overview", () => {
  // The flag is read straight off shared state, where a stale string or a
  // truthy object must not silently blank the conversation panel.
  for (const truthy of ["true", 1, {}, []]) {
    const layout = primaryWorkbenchLayout("conversation", { overviewActive: truthy });
    assert.deepEqual(visiblePanels(layout), ["conversationPanel"], `overviewActive=${JSON.stringify(truthy)}`);
  }
  assert.deepEqual(visiblePanels(primaryWorkbenchLayout("conversation", { overviewActive: true })), ["overviewDashboard"]);
});
