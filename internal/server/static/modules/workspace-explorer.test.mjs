import test from "node:test";
import assert from "node:assert/strict";

import {
  PREVIEW_IFRAME_SANDBOX,
  buildPreviewURL,
  buildWorkspaceSavePayload,
  createWorkspaceExplorerController,
  renderPreviewFrameHTML,
  renderWorkspaceEntriesHTML,
  workspaceParentPath,
} from "./workspace-explorer.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("workspace parent path handles root and nested relative paths", () => {
  assert.equal(workspaceParentPath(""), "");
  assert.equal(workspaceParentPath("src"), "");
  assert.equal(workspaceParentPath("src/modules"), "src");
  assert.equal(workspaceParentPath("/src/modules/"), "src");
  assert.equal(workspaceParentPath("src\\modules\\ui"), "src/modules");
});

test("workspace save payload includes optimistic mod time", () => {
  assert.deepEqual(buildWorkspaceSavePayload("src/app.js", "next", "2025-01-02T03:04:05Z"), {
    path: "src/app.js",
    content: "next",
    expectedModTime: "2025-01-02T03:04:05Z",
  });
});

test("workspace controller sends PUT payload with expectedModTime", async () => {
  const calls = [];
  const state = { agent: { id: "agent/a" } };
  const controller = createWorkspaceExplorerController({
    state,
    request: async (path, options) => {
      calls.push({ path, options });
      return { modTime: "m2" };
    },
    getElementById: () => null,
  });
  controller.setAgent(state.agent);
  state.workspaceFile = { path: "src/app.js", modTime: "m1", readOnly: false, truncated: false };
  state.workspaceFilePath = "src/app.js";
  state.workspaceFileContent = "new content";
  state.workspaceOriginalContent = "old content";

  assert.equal(await controller.saveFile(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/agents/agent%2Fa/workspace/file?path=src%2Fapp.js");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    path: "src/app.js",
    content: "new content",
    expectedModTime: "m1",
  });
});

test("workspace save conflict clearly requires reload", async () => {
  const state = { agent: { id: "agent-a" } };
  const controller = createWorkspaceExplorerController({
    state,
    request: async () => {
      const error = new Error("conflict");
      error.status = 409;
      throw error;
    },
    getElementById: () => null,
  });
  controller.setAgent(state.agent);
  state.workspaceFile = { path: "src/app.js", modTime: "m1", readOnly: false, truncated: false };
  state.workspaceFileContent = "changed";
  state.workspaceOriginalContent = "old";

  assert.equal(await controller.saveFile(), false);
  assert.match(state.workspaceFileStatus, /磁盘上变更.*重新加载/);
});

test("workspace entry HTML escapes all service-provided text and attributes", () => {
  const html = renderWorkspaceEntriesHTML([{
    name: '<img src=x onerror="boom">',
    path: "bad'\"><script>alert(1)</script>",
    isDir: false,
    size: 12,
    editable: false,
  }]);

  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.match(html, /bad&#39;&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("stale workspace tree response is discarded after Agent switch", async () => {
  const first = deferred();
  const state = { agent: { id: "agent-a" } };
  const controller = createWorkspaceExplorerController({
    state,
    request: () => first.promise,
    getElementById: () => null,
  });
  controller.setAgent(state.agent);

  const loading = controller.loadTree("old");
  state.agent = { id: "agent-b" };
  controller.setAgent(state.agent);
  first.resolve({ path: "old", entries: [{ name: "stale.txt", path: "old/stale.txt", isDir: false }] });
  await loading;

  assert.equal(state.workspaceAgentId, "agent-b");
  assert.equal(state.workspacePath, "");
  assert.deepEqual(state.workspaceEntries, []);
});

test("read-only and truncated files are blocked before save request", async () => {
  let calls = 0;
  const state = { agent: { id: "agent-a" } };
  const controller = createWorkspaceExplorerController({
    state,
    request: async () => {
      calls += 1;
      return {};
    },
    getElementById: () => null,
  });
  controller.setAgent(state.agent);

  state.workspaceFile = { path: "README.md", modTime: "m1", readOnly: true, truncated: false };
  state.workspaceFileContent = "changed";
  assert.equal(await controller.saveFile(), false);

  state.workspaceFile = { path: "large.log", modTime: "m2", readOnly: false, truncated: true };
  assert.equal(await controller.saveFile(), false);
  assert.equal(calls, 0);
});

test("preview URL stays cross-origin and iframe sandbox forbids origin and top navigation", () => {
  const locationLike = {
    origin: "http://127.0.0.1:7788",
    protocol: "http:",
    hostname: "127.0.0.1",
  };
  assert.equal(buildPreviewURL({ url: "/preview/proxy" }, locationLike), "");
  assert.equal(buildPreviewURL({ port: 3000 }, locationLike), "http://127.0.0.1:3000/");

  const html = renderPreviewFrameHTML("http://127.0.0.1:3000/");
  assert.match(html, /src="http:\/\/127\.0\.0\.1:3000\/"/);
  assert.match(html, new RegExp(`sandbox="${PREVIEW_IFRAME_SANDBOX}"`));
  assert.doesNotMatch(PREVIEW_IFRAME_SANDBOX, /allow-same-origin/);
  assert.doesNotMatch(PREVIEW_IFRAME_SANDBOX, /allow-top-navigation/);
});

test("Agent switch closes workspace, clears file and preview state, and invalidates sequences", () => {
  const state = { agent: { id: "agent-a" } };
  const controller = createWorkspaceExplorerController({
    state,
    request: async () => ({}),
    getElementById: () => null,
  });
  controller.setAgent(state.agent);
  state.workspaceOpen = true;
  state.workspacePath = "src";
  state.workspaceEntries = [{ path: "src/a.js" }];
  state.workspaceFile = { path: "src/a.js" };
  state.workspaceFilePath = "src/a.js";
  state.workspaceFileContent = "dirty";
  state.workspaceProfiles = [{ id: "dev" }];
  state.workspacePreviewStatus = { running: true, port: 3000 };
  const before = {
    tree: state.workspaceTreeSeq,
    file: state.workspaceFileSeq,
    save: state.workspaceSaveSeq,
    preview: state.workspacePreviewSeq,
  };

  state.agent = { id: "agent-b" };
  controller.setAgent(state.agent);

  assert.equal(state.workspaceOpen, false);
  assert.equal(state.workspacePath, "");
  assert.deepEqual(state.workspaceEntries, []);
  assert.equal(state.workspaceFile, null);
  assert.equal(state.workspaceFileContent, "");
  assert.deepEqual(state.workspaceProfiles, []);
  assert.equal(state.workspacePreviewStatus, null);
  assert.ok(state.workspaceTreeSeq > before.tree);
  assert.ok(state.workspaceFileSeq > before.file);
  assert.ok(state.workspaceSaveSeq > before.save);
  assert.ok(state.workspacePreviewSeq > before.preview);
});
