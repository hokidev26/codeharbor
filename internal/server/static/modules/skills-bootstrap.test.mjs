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
  assert.equal(skillContextKey({ scope: "workspace", projectId: "p-1", worklineId: "w-1" }), "workspace:p-1:w-1");
  const workspaceURL = buildSkillsV2URL({ scope: "workspace", projectId: "p 1", worklineId: "w 1" }, { cursor: "next", limit: 10 });
  assert.match(workspaceURL, /scope=workspace/);
  assert.match(workspaceURL, /projectId=p\+1/);
  assert.match(workspaceURL, /worklineId=w\+1/);
  assert.match(buildEffectiveSkillsV2URL("a/1", { scope: "project", projectId: "p-1" }), /agents\/a%2F1\/skills\/effective/);
});

test("v2 envelope normalization and restore payload retain concurrency fields", () => {
  assert.deepEqual(normalizeSkillsPage({ items: [{ id: "a" }], nextCursor: "b", snapshotSequence: 4 }), {
    items: [{ id: "a" }], nextCursor: "b", snapshotSequence: 4,
  });
  assert.deepEqual(createSkillRestorePayload({ revisionNo: 2 }, {
    expectedUpdatedAt: "2026-07-13T00:00:00Z", acknowledgeRisk: true, acknowledgedContentHash: "hash-2",
  }), {
    revisionNo: 2,
    expectedUpdatedAt: "2026-07-13T00:00:00Z",
    acknowledgeRisk: true,
    acknowledgedContentHash: "hash-2",
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
  const workspace = { scope: "workspace", projectId: "p-1", worklineId: "w-1" };
  await controller.load(workspace);
  await controller.loadRevisions("s-1", workspace);
  await controller.restoreRevision("s-1", { revisionNo: 1 }, workspace, { expectedUpdatedAt: "2026-07-13T00:00:00Z" });
  const restore = calls.find((call) => call.url.includes("/restore?"));
  assert.match(restore.url, /revisions\/1\/restore/);
  assert.deepEqual(JSON.parse(restore.options.body), {
    revisionNo: 1,
    expectedUpdatedAt: "2026-07-13T00:00:00Z",
    acknowledgeRisk: false,
    acknowledgedContentHash: "",
  });
});

test("workspace scope append discards a mismatched snapshot and refreshes without mixing pages", async () => {
  const state = {};
  let firstPageLoads = 0;
  const controller = createSkillsPhaseBController({
    state,
    api: async (url) => {
      if (url.includes("cursor=old-cursor")) return { items: [{ id: "mixed" }], nextCursor: "", snapshotSequence: 8 };
      firstPageLoads += 1;
      if (firstPageLoads === 1) return { items: [{ id: "old" }], nextCursor: "old-cursor", snapshotSequence: 7 };
      return { items: [{ id: "fresh" }], nextCursor: "", snapshotSequence: 8 };
    },
  });
  const context = { scope: "workspace", projectId: "p-1", worklineId: "w-1" };
  await controller.load(context);
  await controller.loadMore(context);
  const bucket = ensureSkillsContextState(state, context);
  assert.deepEqual(bucket.items.map((item) => item.id), ["fresh"]);
  assert.equal(bucket.snapshotSequence, 8);
  assert.equal(bucket.nextCursor, "");
  assert.equal(firstPageLoads, 2);
});

test("revision append discards a mismatched snapshot and refreshes the revision list", async () => {
  const state = {};
  let revisionFirstPages = 0;
  const controller = createSkillsPhaseBController({
    state,
    api: async (url) => {
      if (url.includes("/revisions?") && url.includes("cursor=old-revisions")) {
        return { items: [{ revisionNo: 98 }], nextCursor: "", snapshotSequence: 12 };
      }
      if (url.includes("/revisions?")) {
        revisionFirstPages += 1;
        if (revisionFirstPages === 1) return { items: [{ revisionNo: 3 }], nextCursor: "old-revisions", snapshotSequence: 11 };
        return { items: [{ revisionNo: 4 }], nextCursor: "", snapshotSequence: 12 };
      }
      return { items: [{ id: "s-1" }], nextCursor: "", snapshotSequence: 1 };
    },
  });
  await controller.load({ scope: "global" });
  await controller.loadRevisions("s-1", { scope: "global" });
  await controller.loadRevisions("s-1", { scope: "global" }, { append: true });
  const revisions = ensureSkillsContextState(state, { scope: "global" }).revisions["s-1"];
  assert.deepEqual(revisions.items.map((item) => item.revisionNo), [4]);
  assert.equal(revisions.snapshotSequence, 12);
  assert.equal(revisionFirstPages, 2);
});

test("effective policy loads every cursor page and retains last-known data as stale", async () => {
  const state = {};
  let offline = false;
  const requests = [];
  const controller = createSkillsPhaseBController({
    state,
    pageSize: 1,
    api: async (url) => {
      requests.push(url);
      if (offline) throw new Error("offline");
      if (url.includes("cursor=effective-next")) return { items: [{ id: "workspace-owner" }], nextCursor: "", snapshotSequence: 21 };
      return { items: [{ id: "project-owner" }], nextCursor: "effective-next", snapshotSequence: 21 };
    },
  });
  const context = { scope: "workspace", projectId: "p-1", worklineId: "w-1" };
  await controller.loadEffective("agent-1", context);
  let policy = controller.getEffectivePolicy("agent-1", context);
  assert.deepEqual(policy.items.map((item) => item.id), ["project-owner", "workspace-owner"]);
  assert.equal(policy.hasAuthoritativeData, true);
  assert.equal(policy.status, "ready");
  assert.equal(requests.length, 2);
  offline = true;
  await assert.rejects(controller.loadEffective("agent-1", context), /offline/);
  policy = controller.getEffectivePolicy("agent-1", context);
  assert.deepEqual(policy.items.map((item) => item.id), ["project-owner", "workspace-owner"]);
  assert.equal(policy.hasAuthoritativeData, true);
  assert.equal(policy.status, "stale");
});

test("initial effective policy failure remains fail closed without authoritative data", async () => {
  const state = {};
  const controller = createSkillsPhaseBController({ state, api: async () => { throw new Error("offline"); } });
  const context = { scope: "workspace", projectId: "p-1", worklineId: "w-1" };
  await assert.rejects(controller.loadEffective("agent-1", context), /offline/);
  const policy = controller.getEffectivePolicy("agent-1", context);
  assert.equal(policy.hasAuthoritativeData, false);
  assert.equal(policy.status, "error");
  assert.deepEqual(policy.items, []);
});

test("restore invalidates old scope and revision cursors then refreshes both snapshots", async () => {
  const state = {};
  let scopeLoads = 0;
  let revisionLoads = 0;
  const controller = createSkillsPhaseBController({
    state,
    api: async (url) => {
      if (url.includes("/restore?")) return { id: "s-1", revisionNo: 3, updatedAt: "new", command: "/restore" };
      if (url.includes("/revisions?")) {
        revisionLoads += 1;
        return revisionLoads === 1
          ? { items: [{ revisionNo: 2 }], nextCursor: "old-revision-cursor", snapshotSequence: 30 }
          : { items: [{ revisionNo: 3 }], nextCursor: "", snapshotSequence: 31 };
      }
      scopeLoads += 1;
      return scopeLoads === 1
        ? { items: [{ id: "s-1", updatedAt: "old" }], nextCursor: "old-scope-cursor", snapshotSequence: 30 }
        : { items: [{ id: "s-1", updatedAt: "new" }], nextCursor: "", snapshotSequence: 31 };
    },
  });
  await controller.load({ scope: "global" });
  await controller.loadRevisions("s-1", { scope: "global" });
  await controller.restoreRevision("s-1", { revisionNo: 2 }, { scope: "global" }, { expectedUpdatedAt: "old" });
  const bucket = ensureSkillsContextState(state, { scope: "global" });
  assert.equal(bucket.nextCursor, "");
  assert.equal(bucket.snapshotSequence, 31);
  assert.deepEqual(bucket.items.map((item) => item.updatedAt), ["new"]);
  assert.equal(bucket.revisions["s-1"].nextCursor, "");
  assert.equal(bucket.revisions["s-1"].snapshotSequence, 31);
  assert.deepEqual(bucket.revisions["s-1"].items.map((item) => item.revisionNo), [3]);
});
