import test from "node:test";
import assert from "node:assert/strict";

import {
  createRemoteAccessSettingsController,
  isEnvironmentCredential,
  normalizeRemoteAccess,
  passwordPayload,
  policyPayload,
} from "./remote-access-settings.mjs";

const baseAccess = {
  credential: { configured: true, source: "config" },
  policy: { allowFullAccess: false, defaultMode: "restricted", allowRemoteNativePicker: false, revision: 1 },
  session: { remote: true, authenticated: true, mode: "restricted", expiresAt: "2026-07-17T00:00:00Z" },
  capabilities: { maxPermissionMode: "acceptEdits", terminalAllowed: false, filesystemScope: "project", nativePickerAllowed: false, securityAdminAllowed: false },
};

const localAccess = {
  ...baseAccess,
  session: { remote: false, authenticated: true, mode: "local", expiresAt: "" },
  capabilities: { maxPermissionMode: "bypassPermissions", terminalAllowed: true, filesystemScope: "host", nativePickerAllowed: true, securityAdminAllowed: true },
};

test("normalizes remote access state and recognizes environment credentials", () => {
  assert.deepEqual(normalizeRemoteAccess({ policy: { defaultMode: "unexpected" } }).policy, {
    allowFullAccess: false,
    defaultMode: "restricted",
    allowRemoteNativePicker: false,
    revision: 0,
  });
  assert.equal(isEnvironmentCredential("environment"), true);
  assert.equal(isEnvironmentCredential("env"), true);
  assert.equal(isEnvironmentCredential("stored"), false);
});

test("policy and password payloads carry currentPassword only when supplied", () => {
  assert.deepEqual(policyPayload(baseAccess, baseAccess.policy, "current"), {
    allowFullAccess: false,
    defaultMode: "restricted",
    allowRemoteNativePicker: false,
    revision: 1,
    currentPassword: "current",
  });
  assert.deepEqual(policyPayload(baseAccess, { defaultMode: "full", allowRemoteNativePicker: true }), {
    allowFullAccess: true,
    defaultMode: "full",
    allowRemoteNativePicker: true,
    revision: 1,
  });
  assert.deepEqual(passwordPayload("generate"), { strategy: "generate" });
  assert.deepEqual(passwordPayload("custom", "new-password", "current"), {
    strategy: "custom",
    password: "new-password",
    currentPassword: "current",
  });
});

test("normalizes and controls a temporary tunnel through the security endpoint", async () => {
  const requests = [];
  const state = { remoteAccess: localAccess };
  const controller = createRemoteAccessSettingsController({
    state,
    request: async (path, options) => {
      requests.push({ path, options });
      return options.method === "POST"
        ? { available: true, status: "running", publicUrl: "https://bright-sun.trycloudflare.com", startedAt: "2026-07-18T00:00:00Z" }
        : { available: true, status: "idle" };
    },
  });

  const running = await controller.startTunnel();
  assert.deepEqual(running, {
    available: true,
    status: "running",
    publicUrl: "https://bright-sun.trycloudflare.com",
    error: "",
    startedAt: "2026-07-18T00:00:00Z",
  });
  assert.equal(state.remoteAccess.tunnel.publicUrl, "https://bright-sun.trycloudflare.com");

  const stopped = await controller.stopTunnel();
  assert.equal(stopped.status, "idle");
  assert.deepEqual(requests.map(({ path, options }) => [path, options.method]), [
    ["/api/security/remote-access/tunnel", "POST"],
    ["/api/security/remote-access/tunnel", "DELETE"],
  ]);
});

test("saves host-local policy with revision", async () => {
  const requests = [];
  const state = { remoteAccess: localAccess };
  const controller = createRemoteAccessSettingsController({
    state,
    request: async (path, options) => {
      requests.push({ path, options });
      return { ...localAccess.policy, allowFullAccess: true, defaultMode: "full", revision: 2 };
    },
  });

  await controller.savePolicy({ ...localAccess.policy, allowFullAccess: true, defaultMode: "full" });

  assert.deepEqual(requests, [{
    path: "/api/security/remote-access/policy",
    options: {
      method: "PATCH",
      body: JSON.stringify({
        allowFullAccess: true,
        defaultMode: "full",
        allowRemoteNativePicker: false,
        revision: 1,
      }),
    },
  }]);
  assert.equal(state.remoteAccess.policy.defaultMode, "full");
  assert.equal(state.remoteAccess.session.authenticated, true);
  assert.equal(state.remoteAccess.capabilities.securityAdminAllowed, true);
  assert.doesNotMatch(controller.render(), /href="\/auth\/remote-access"/);
});

test("generates and consumes a one-time password locally without retaining it in state", async () => {
  const requests = [];
  const state = { remoteAccess: localAccess };
  const controller = createRemoteAccessSettingsController({
    state,
    request: async (path, options) => {
      requests.push({ path, options });
      return { credential: { configured: true, source: "config" }, revision: 2, generatedPassword: "generated-once" };
    },
  });

  const result = await controller.updatePassword("generate");

  assert.equal(result.generatedPassword, "generated-once");
  assert.equal(controller.generatedPasswordValue(), "generated-once");
  assert.equal(state.remoteAccess.generatedPassword, undefined);
  assert.equal(controller.consumeGeneratedPassword(), "generated-once");
  assert.equal(controller.generatedPasswordValue(), "");
  assert.deepEqual(JSON.parse(requests[0].options.body), { strategy: "generate" });
});

test("renders remote security settings read-only and host-local settings editable", () => {
  const restricted = createRemoteAccessSettingsController({ state: { remoteAccess: baseAccess } });
  const restrictedHTML = restricted.render();
  assert.match(restrictedHTML, /id="remoteAccessDefaultMode"[^>]*disabled/);
  assert.match(restrictedHTML, /id="remoteAccessNativePicker"[^>]*disabled/);
  assert.match(restrictedHTML, /data-remote-policy-submit[^>]*disabled/);
  assert.match(restrictedHTML, /data-remote-generate-submit[^>]*disabled/);
  assert.match(restrictedHTML, /data-remote-custom-submit[^>]*disabled/);

  const fullRemoteState = {
    remoteAccess: {
      ...baseAccess,
      session: { ...baseAccess.session, mode: "full" },
      capabilities: { ...localAccess.capabilities, nativePickerAllowed: false, securityAdminAllowed: false },
    },
  };
  const fullRemoteHTML = createRemoteAccessSettingsController({ state: fullRemoteState }).render();
  assert.match(fullRemoteHTML, /id="remoteAccessDefaultMode"[^>]*disabled/);
  assert.match(fullRemoteHTML, /data-remote-policy-submit[^>]*disabled/);

  const localHTML = createRemoteAccessSettingsController({ state: { remoteAccess: localAccess } }).render();
  assert.doesNotMatch(localHTML, /remoteAccessAllowFull/);
  assert.match(localHTML, /<option value="full"[^>]*>远程操控（所有操作权限）<\/option>/);
  for (const pattern of [
    /<select id="remoteAccessDefaultMode"[^>]*>/,
    /<option value="full"[^>]*>/,
    /<input id="remoteAccessNativePicker"[^>]*>/,
    /<button class="settings-action-btn primary" type="submit" data-remote-policy-submit[^>]*>/,
  ]) {
    const tag = localHTML.match(pattern)?.[0] || "";
    assert.ok(tag);
    assert.equal(tag.includes("disabled"), false);
  }

  const environmentLocal = createRemoteAccessSettingsController({
    state: { remoteAccess: { ...localAccess, credential: { configured: true, source: "environment" } } },
  });
  const environmentLocalHTML = environmentLocal.render();
  assert.match(environmentLocalHTML, /id="remoteAccessGeneratePasswordForm"/);
  assert.match(environmentLocalHTML, /id="remoteAccessCustomPasswordForm"/);
  assert.doesNotMatch(environmentLocalHTML, /data-remote-generate-submit[^>]*disabled/);
  assert.doesNotMatch(environmentLocalHTML, /data-remote-custom-submit[^>]*disabled/);

  const environmentRemote = createRemoteAccessSettingsController({
    state: { remoteAccess: { ...baseAccess, credential: { configured: true, source: "environment" } } },
  });
  const environmentRemoteHTML = environmentRemote.render();
  assert.match(environmentRemoteHTML, /data-remote-generate-submit[^>]*disabled/);
  assert.match(environmentRemoteHTML, /data-remote-custom-submit[^>]*disabled/);
});

test("updates a custom password locally without exposing a generated password", async () => {
  const requests = [];
  const state = { remoteAccess: localAccess };
  const controller = createRemoteAccessSettingsController({
    state,
    request: async (path, options) => {
      requests.push({ path, options });
      return { credential: { configured: true, source: "config" }, revision: 2 };
    },
  });

  const result = await controller.updatePassword("custom", "new-secret");

  assert.equal(result.generatedPassword, "");
  assert.equal(controller.generatedPasswordValue(), "");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    strategy: "custom",
    password: "new-secret",
  });
});

test("remote access load fails closed on 401 and notifies immediately", async () => {
  const state = { remoteAccess: { ...baseAccess, session: { ...baseAccess.session, mode: "full" }, capabilities: { ...localAccess.capabilities, securityAdminAllowed: false } } };
  let changes = 0;
  const controller = createRemoteAccessSettingsController({
    state,
    request: async () => {
      const error = new Error("session expired");
      error.status = 401;
      throw error;
    },
    onChange: () => { changes += 1; },
  });

  await assert.rejects(controller.load(), /session expired/);
  assert.equal(state.remoteAccessFailClosed, true);
  assert.equal(state.remoteAccess.session.authenticated, false);
  assert.equal(state.remoteAccess.capabilities.terminalAllowed, false);
  assert.equal(state.remoteAccess.capabilities.maxPermissionMode, "acceptEdits");
  assert.equal(changes, 1);
});

test("localhost authorization errors do not synthesize a remote fail-closed session", async () => {
  for (const status of [401, 403]) {
    const state = { remoteAccess: localAccess, remoteAccessFailClosed: false };
    const controller = createRemoteAccessSettingsController({
      state,
      request: async () => {
        const error = new Error(`local-${status}`);
        error.status = status;
        throw error;
      },
    });

    await assert.rejects(controller.load(), new RegExp(`local-${status}`));
    assert.equal(state.remoteAccessFailClosed, false);
    assert.equal(state.remoteAccess.session.remote, false);
    assert.equal(state.remoteAccess.capabilities.terminalAllowed, true);
  }
});

test("a stale successful load cannot clear a newer authorization failure", async () => {
  const state = {
    remoteAccess: {
      ...baseAccess,
      session: { ...baseAccess.session, mode: "full" },
      capabilities: { ...localAccess.capabilities, securityAdminAllowed: false },
    },
  };
  const requests = [];
  const controller = createRemoteAccessSettingsController({
    state,
    request: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  });

  const staleSuccess = controller.load();
  const currentFailure = controller.load();
  const error = new Error("expired");
  error.status = 401;
  requests[1].reject(error);
  await assert.rejects(currentFailure, /expired/);
  requests[0].resolve(localAccess);
  await staleSuccess;

  assert.equal(state.remoteAccessFailClosed, true);
  assert.equal(state.remoteAccess.session.authenticated, false);
  assert.equal(state.remoteAccess.capabilities.terminalAllowed, false);
  assert.equal(state.remoteAccessLoading, false);
});

test("external authorization invalidation makes an in-flight success stale", async () => {
  const state = { remoteAccess: baseAccess };
  let resolveRequest;
  const controller = createRemoteAccessSettingsController({
    state,
    request: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });
  const pending = controller.load();
  controller.invalidatePendingLoads();
  state.remoteAccessFailClosed = true;
  resolveRequest(localAccess);
  await pending;
  assert.equal(state.remoteAccessFailClosed, true);
  assert.equal(state.remoteAccess.session.remote, true);
});

test("incomplete remote capability responses remain restricted", async () => {
  const state = { remoteAccess: baseAccess };
  const controller = createRemoteAccessSettingsController({
    state,
    request: async () => ({
      credential: baseAccess.credential,
      policy: baseAccess.policy,
      session: { remote: true, authenticated: true, mode: "full" },
    }),
  });

  await controller.load();
  assert.equal(state.remoteAccessFailClosed, true);
  assert.equal(state.remoteAccess.session.mode, "restricted");
  assert.equal(state.remoteAccess.capabilities.terminalAllowed, false);
});

test("authoritative refresh clears a previous fail-closed state", async () => {
  const state = { remoteAccess: baseAccess, remoteAccessFailClosed: true };
  const controller = createRemoteAccessSettingsController({ state, request: async () => localAccess });

  await controller.load();
  assert.equal(state.remoteAccessFailClosed, false);
  assert.equal(state.remoteAccess.session.remote, false);
  assert.equal(state.remoteAccess.capabilities.terminalAllowed, true);
});
