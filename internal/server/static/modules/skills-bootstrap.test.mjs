import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEffectiveSkillsV2URL,
  buildSkillsV2URL,
  createSkillRestorePayload,
  createSkillsPhaseBController,
  ensureSkillsContextState,
  normalizeSkillsPage,
  skillContextKey,
} from "./skills-bootstrap.mjs";

test("v2 context keys isolate global, project, and workspace records", () => {
  assert.equal(skillContextKey({ scope: "global" }), "global");
  assert.equal(skillContextKey({ scope: "project", projectId: "p-1" }), "project:p-1");
  assert.equal(skillContextKey({ scope: "workspace", worklineId: "w-1" }), "workspace:w-1");
  assert.match(buildSkillsV2URL({ scope: "workspace", worklineId: "w 1" }, { cursor: "next", limit: 10 }), /scope=workspace/);
  assert.match(buildSkillsV2URL({ scope: "workspace", worklineId: "w 1" }, { cursor: "next", limit: 10 }), /worklineId=w\+1/);
  assert.match(buildEffectiveSkillsV2URL("a/1", { scope: "project", projectId: "p-1" }), /agents\/a%2F1\/skills\/effective/);
});

test("v2 envelope normalization and restore payload retain concurrency fields", () => {
  assert.deepEqual(normalizeSkillsPage({ items: [{ id: "a" }], nextCursor: "b", snapshotSequence: 4 }), {
    items: [{ id: "a" }], nextCursor: "b", snapshotSequence: 4,
  });
  assert.deepEqual(createSkillRestorePayload({ revisionNo: 2 }, { expectedUpdatedAt: "2026-07-13T00:00:00Z", acknowledgeRisk: true }), {
    revisionNo: 2, expectedUpdatedAt: "2026-07-13T00:00:00Z", acknowledgeRisk: true,
  });
  assert.throws(() => createSkillRestorePayload({}), /修订版本缺失/);
  assert.throws(() => createSkillRestorePayload({ revisionNo: 2 }), /时间戳缺失/);
});

test("v2 controller appends pages inside only the requested context", async () => {
  const state = {};
  const requests = [];
  const api = async (url) => {
    requests.push(url);
    if (url.includes("projectId=p-1") && url.includes("cursor=more")) return { items: [{ id: "p-2" }], nextCursor: "", snapshotSequence: 7 };
    if (url.includes("projectId=p-1")) return { items: [{ id: "p-1" }], nextCursor: "more", snapshotSequence: 7 };
    return { items: [{ id: "global-1" }], nextCursor: "", snapshotSequence: 2 };
  };
  const controller = createSkillsPhaseBController({ state, api, pageSize: 20 });
  await controller.load({ scope: "global" });
  await controller.load({ scope: "project", projectId: "p-1" });
  await controller.loadMore({ scope: "project", projectId: "p-1" });
  assert.deepEqual(ensureSkillsContextState(state, { scope: "global" }).items.map((item) => item.id), ["global-1"]);
  assert.deepEqual(ensureSkillsContextState(state, { scope: "project", projectId: "p-1" }).items.map((item) => item.id), ["p-1", "p-2"]);
  assert.equal(requests.filter((url) => url.includes("projectId=p-1")).length, 2);
});

test("v2 detail failures discard prompts and keep the server command shadow", async () => {
  const state = {};
  const controller = createSkillsPhaseBController({
    state,
    api: async (url) => {
      if (url.includes("/skills/s-1?")) throw new Error("detail offline");
      return { items: [{ id: "s-1", command: "/reserved", prompt: "old", enabled: false }], nextCursor: "" };
    },
  });
  await controller.load({ scope: "global" });
  await assert.rejects(controller.loadDetail("s-1", { scope: "global" }), /detail offline/);
  const skill = ensureSkillsContextState(state, { scope: "global" }).items[0];
  assert.equal(skill.command, "/reserved");
  assert.equal(skill.prompt, undefined);
  assert.equal(skill.detailLoaded, false);
  assert.equal(skill.detailError, "detail offline");
});

test("v2 revisions and restore use the revision path and payload", async () => {
  const state = {};
  const calls = [];
  const controller = createSkillsPhaseBController({
    state,
    api: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/revisions?")) return { items: [{ revisionNo: 1 }], nextCursor: "", snapshotSequence: 3 };
      if (url.includes("/restore?")) return { id: "s-1", revisionNo: 2, command: "/review" };
      return { items: [{ id: "s-1", revisionNo: 1, updatedAt: "2026-07-13T00:00:00Z", command: "/review" }], nextCursor: "", snapshotSequence: 3 };
    },
  });
  await controller.load({ scope: "workspace", worklineId: "w-1" });
  await controller.loadRevisions("s-1", { scope: "workspace", worklineId: "w-1" });
  await controller.restoreRevision("s-1", { revisionNo: 1 }, { scope: "workspace", worklineId: "w-1" }, { expectedUpdatedAt: "2026-07-13T00:00:00Z" });
  const restore = calls.find((call) => call.url.includes("/restore?"));
  assert.match(restore.url, /revisions\/1\/restore/);
  assert.deepEqual(JSON.parse(restore.options.body), { revisionNo: 1, expectedUpdatedAt: "2026-07-13T00:00:00Z", acknowledgeRisk: false });
});
