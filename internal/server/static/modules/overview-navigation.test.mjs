import test from "node:test";
import assert from "node:assert/strict";

import { overviewNavigationRoute } from "./overview-dashboard.mjs";

test("every overview card action routes to its surface", () => {
  const expected = {
    conversation: { handler: "rail-conversation", usesId: false },
    tasks: { handler: "task", usesId: false },
    "open-task": { handler: "task", usesId: true },
    schedules: { handler: "schedules", usesId: true },
    "open-schedule": { handler: "schedules", usesId: true },
    approvals: { handler: "approvals", usesId: false },
    runs: { handler: "runs", usesId: true },
    "open-run": { handler: "runs", usesId: true },
    "open-conversation": { handler: "conversation", usesId: true },
  };
  for (const [action, route] of Object.entries(expected)) {
    assert.deepEqual(overviewNavigationRoute(action), route, `action ${action}`);
  }
});

test("bare and open- variants share a surface but differ on carrying a selection", () => {
  // "tasks" opens the surface with nothing selected; "open-task" selects the
  // entity the card refers to. Collapsing the two would either always select
  // the first task or never select any.
  assert.equal(overviewNavigationRoute("tasks").handler, overviewNavigationRoute("open-task").handler);
  assert.equal(overviewNavigationRoute("tasks").usesId, false);
  assert.equal(overviewNavigationRoute("open-task").usesId, true);

  assert.equal(overviewNavigationRoute("runs").handler, overviewNavigationRoute("open-run").handler);
  assert.equal(overviewNavigationRoute("schedules").handler, overviewNavigationRoute("open-schedule").handler);
});

test("approvals and the rail conversation action never carry an entity id", () => {
  assert.equal(overviewNavigationRoute("approvals").usesId, false);
  assert.equal(overviewNavigationRoute("conversation").usesId, false);
});

test("unknown, empty, and non-string actions are ignored rather than guessed", () => {
  // Overview payloads are server-provided; an unrecognised action must not be
  // coerced into some nearby surface.
  for (const action of ["", null, undefined, "im-gateway", "settings", "open", 42, {}]) {
    assert.equal(overviewNavigationRoute(action), null, `action ${JSON.stringify(action)} should not route`);
  }
});

test("the schedules action does not route into settings", () => {
  // Regression guard: opening a schedule from overview once fell through to the
  // IM gateway settings panel instead of the schedule workspace.
  assert.equal(overviewNavigationRoute("schedules").handler, "schedules");
  assert.equal(overviewNavigationRoute("open-schedule").handler, "schedules");
  const handlers = new Set(["rail-conversation", "task", "schedules", "approvals", "runs", "conversation"]);
  for (const action of ["conversation", "tasks", "open-task", "schedules", "open-schedule", "approvals", "runs", "open-run", "open-conversation"]) {
    assert.ok(handlers.has(overviewNavigationRoute(action).handler), `${action} must stay inside the known surfaces`);
  }
});
