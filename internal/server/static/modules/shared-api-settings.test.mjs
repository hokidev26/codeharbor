import test from "node:test";
import assert from "node:assert/strict";

import messagesEN from "./messages-en.mjs";
import messagesZhCN from "./messages-zh-CN.mjs";
import messagesZhTW from "./messages-zh-TW.mjs";
import {
  createSharedAPISettingsController,
  gatewayKeyPolicyPayload,
  gatewayKeyRequest,
  gatewayModelRequest,
  gatewayProviderRequest,
  gatewayProviderRestriction,
  isCodexGatewayProvider,
  normalizeGatewayKeys,
  normalizeGatewayModels,
  normalizeGatewaySettings,
} from "./shared-api-settings.mjs";

function enabledState(overrides = {}) {
  return {
    settings: {
      gateway: { enabled: true, host: "127.0.0.1", port: 7788, maxGlobalConcurrency: 8, maxRequestBytes: 1048576 },
      providers: [
        { name: "openai", type: "openai", gatewayEnabled: false },
        { name: "codex", type: "codex", gatewayEnabled: false },
        { name: "cliproxyapi", type: "openai-compatible", profile: "cliproxyapi", gatewayEnabled: false },
      ],
    },
    ...overrides,
  };
}

function responseFor(path, options = {}) {
  if (path === "/api/gateway/keys" && !options.method) return { keys: [] };
  if (path === "/api/gateway/models" && !options.method) return { models: [] };
  if (path === "/api/gateway/usage") return { items: [], summary: {} };
  return {};
}

test("normalizes absent Gateway data and empty list responses", () => {
  assert.deepEqual(normalizeGatewaySettings({}), {
    enabled: false,
    host: "",
    port: 0,
    maxGlobalConcurrency: 0,
    maxRequestBytes: 0,
  });
  assert.deepEqual(normalizeGatewayKeys({ keys: [] }), []);
  assert.deepEqual(normalizeGatewayKeys(null), []);
  assert.deepEqual(normalizeGatewayModels({ models: [] }), []);
  assert.deepEqual(normalizeGatewayModels(null), []);
});

test("request builders follow the Shared API backend contract", () => {
  assert.deepEqual(gatewayProviderRequest("custom/name", true), {
    path: "/api/providers/custom%2Fname",
    options: { method: "PATCH", body: JSON.stringify({ gatewayEnabled: true }) },
  });

  const payload = gatewayKeyPolicyPayload({
    name: " Laptop ",
    enabled: false,
    allowedModels: " chat\ncode,chat ",
    requestsPerMinute: "60.9",
    monthlyTokenLimit: "100000",
    maxConcurrency: "3",
    expiresAt: "2026-08-01T12:00:00Z",
  });
  assert.deepEqual(payload, {
    name: "Laptop",
    enabled: false,
    allowedModels: ["chat", "code"],
    requestsPerMinute: 60,
    monthlyTokenLimit: 100000,
    maxConcurrency: 3,
    expiresAt: "2026-08-01T12:00:00.000Z",
  });
  assert.deepEqual(gatewayKeyRequest("create", {}, payload), {
    path: "/api/gateway/keys",
    options: { method: "POST", cache: "no-store", body: JSON.stringify(payload) },
  });
  assert.deepEqual(gatewayKeyRequest("update", { id: "key/id", updatedAt: "key-v1" }, payload), {
    path: "/api/gateway/keys/key%2Fid",
    options: { method: "PATCH", body: JSON.stringify({ ...payload, expectedUpdatedAt: "key-v1" }) },
  });
  assert.deepEqual(gatewayKeyRequest("rotate", "key-1"), { path: "/api/gateway/keys/key-1/rotate", options: { method: "POST", cache: "no-store" } });
  assert.deepEqual(gatewayKeyRequest("revoke", "key-1"), { path: "/api/gateway/keys/key-1/revoke", options: { method: "POST" } });

  assert.equal(gatewayModelRequest("create", {}, { alias: "chat", targetModel: "openai:gpt-5", enabled: true }).path, "/api/gateway/models");
  assert.deepEqual(gatewayModelRequest("update", { alias: "public/chat", updatedAt: "model-v1" }, { alias: "public/chat", targetModel: "openai:gpt-5", enabled: false }), {
    path: "/api/gateway/models?alias=public%2Fchat",
    options: { method: "PATCH", body: JSON.stringify({ alias: "public/chat", targetModel: "openai:gpt-5", enabled: false, expectedUpdatedAt: "model-v1" }) },
  });
  assert.deepEqual(gatewayModelRequest("delete", "public/chat"), { path: "/api/gateway/models?alias=public%2Fchat", options: { method: "DELETE" } });
});

test("disabled Gateway renders status and security guidance without calling Gateway endpoints", async () => {
  const requests = [];
  const state = { settings: { gateway: { enabled: false, host: "127.0.0.1", port: 7788 }, providers: [] } };
  const controller = createSharedAPISettingsController({ state, request: async (path) => { requests.push(path); return {}; } });

  await controller.load();
  const html = controller.render();

  assert.deepEqual(requests, []);
  assert.match(html, /Gateway 未启用/);
  assert.match(html, /127\.0\.0\.1:7788/);
  assert.match(html, /HTTPS 反向代理/);
  assert.match(html, /data-gateway-key-add disabled/);
  assert.match(html, /尚未创建访问密钥/);
  assert.match(html, /暂无用量数据/);
  assert.match(html, /shared-api-keys-section/);
  assert.match(html, /shared-api-usage-section/);
  assert.match(html, /shared-api-compact-empty/);
  assert.doesNotMatch(html, /模型别名|data-gateway-model/);
});

test("empty enabled Gateway loads all resources and renders empty states", async () => {
  const requests = [];
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    request: async (path, options = {}) => {
      requests.push({ path, options });
      return responseFor(path, options);
    },
  });

  await controller.load();
  const html = controller.render();

  assert.deepEqual(requests.map((item) => item.path), ["/api/gateway/keys", "/api/gateway/models", "/api/gateway/usage"]);
  assert.match(html, /尚未创建访问密钥/);
  assert.match(html, /0 把密钥/);
  assert.match(html, /暂无用量数据/);
  assert.doesNotMatch(html, /模型别名|data-gateway-model/);
});

test("OAuth-backed providers are non-shareable while API providers expose a Gateway toggle", async () => {
  const requests = [];
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    request: async (path, options = {}) => {
      requests.push({ path, options });
      return responseFor(path, options);
    },
  });
  const html = controller.render();
  const codexRow = html.match(/<div class="shared-api-row is-disabled">[\s\S]*?<\/div>/)?.[0] || "";

  assert.equal(isCodexGatewayProvider({ name: "codex" }), true);
  assert.equal(isCodexGatewayProvider({ type: "codex" }), true);
  assert.equal(gatewayProviderRestriction({ profile: "cliproxyapi" }), "oauthProxy");
  assert.match(codexRow, /不可分享/);
  assert.doesNotMatch(html, /data-gateway-provider="codex"/);
  assert.doesNotMatch(html, /data-gateway-provider="cliproxyapi"/);
  assert.match(html, /订阅\/OAuth 代理 Provider 不可进入共享池/);
  assert.match(html, /data-gateway-provider="openai"/);

  await controller.toggleProvider("openai", true);
  assert.equal(state.settings.providers[0].gatewayEnabled, true);
  assert.deepEqual(requests.at(-1), {
    path: "/api/providers/openai",
    options: { method: "PATCH", body: JSON.stringify({ gatewayEnabled: true }) },
  });
  const count = requests.length;
  assert.equal(await controller.toggleProvider("codex", true), null);
  assert.equal(await controller.toggleProvider("cliproxyapi", true), null);
  assert.equal(requests.length, count);
});

test("create and rotate expose plaintext tokens only in the controller one-time area", async () => {
  const requests = [];
  const copied = [];
  const state = enabledState();
  let sequence = 0;
  const controller = createSharedAPISettingsController({
    state,
    copyText: async (value) => copied.push(value),
    confirmAction: () => true,
    request: async (path, options = {}) => {
      requests.push({ path, options });
      if (path === "/api/gateway/keys" && options.method === "POST") {
        return { key: { id: "key-1", name: "Laptop", keyPrefix: "sk_live_abc", enabled: true, allowedModels: ["chat"] }, token: "secret-create-once" };
      }
      if (path.endsWith("/rotate")) {
        sequence += 1;
        return { key: { id: "key-1", name: "Laptop", keyPrefix: `sk_live_rot${sequence}`, enabled: true, allowedModels: ["chat"] }, token: "secret-rotate-once" };
      }
      return responseFor(path, options);
    },
  });

  await controller.createKey({ name: "Laptop", enabled: true, allowedModels: ["chat"] });
  assert.equal(controller.oneTimeTokenValue(), "secret-create-once");
  assert.equal(state.token, undefined);
  assert.equal(state.gatewayToken, undefined);
  assert.equal(JSON.stringify(state).includes("secret-create-once"), false);
  const createdHTML = controller.render();
  assert.match(createdHTML, />secret-create-once<\/code>/);
  assert.doesNotMatch(createdHTML, /data-[^=]+="[^"]*secret-create-once/);
  await controller.copyOneTimeToken();
  assert.deepEqual(copied, ["secret-create-once"]);

  controller.dismissToken();
  assert.equal(controller.oneTimeTokenValue(), "");
  assert.doesNotMatch(controller.render(), /secret-create-once/);

  await controller.rotateKey("key-1");
  assert.equal(controller.oneTimeTokenValue(), "secret-rotate-once");
  assert.match(controller.render(), /secret-rotate-once/);
  assert.equal(controller.consumeOneTimeToken(), "secret-rotate-once");
  assert.equal(controller.oneTimeTokenValue(), "");
  assert.doesNotMatch(controller.render(), /secret-rotate-once/);
});

test("key lifecycle covers edit, pause, rotate, and revoke", async () => {
  const requests = [];
  const state = enabledState({ gatewayKeys: [{ id: "key-1", name: "Laptop", keyPrefix: "sk_lap", enabled: true, allowedModels: ["chat"], updatedAt: "key-v1" }] });
  const controller = createSharedAPISettingsController({
    state,
    confirmAction: () => true,
    request: async (path, options = {}) => {
      requests.push({ path, options });
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body);
        return { key: { ...state.gatewayKeys[0], ...body } };
      }
      if (path.endsWith("/rotate")) return { key: { ...state.gatewayKeys[0], keyPrefix: "sk_new" }, token: "rotated-once" };
      if (path.endsWith("/revoke")) return { key: { ...state.gatewayKeys[0], enabled: false, revokedAt: "2026-07-17T12:00:00Z" } };
      return {};
    },
  });

  await controller.updateKey("key-1", { name: "Team", enabled: true, allowedModels: "chat,code", requestsPerMinute: 20, monthlyTokenLimit: 5000, maxConcurrency: 2 });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    name: "Team", enabled: true, allowedModels: ["chat", "code"], requestsPerMinute: 20, monthlyTokenLimit: 5000, maxConcurrency: 2, expiresAt: "", expectedUpdatedAt: "key-v1",
  });
  await controller.toggleKey("key-1");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { enabled: false, expectedUpdatedAt: "key-v1" });
  await controller.rotateKey("key-1");
  assert.equal(requests.at(-1).path, "/api/gateway/keys/key-1/rotate");
  await controller.revokeKey("key-1");
  assert.equal(requests.at(-1).path, "/api/gateway/keys/key-1/revoke");
  assert.match(controller.render(), /已撤销/);
  assert.doesNotMatch(controller.render(), /data-gateway-key-rotate="key-1"/);
});

test("model aliases support create, update, and delete", async () => {
  const requests = [];
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    confirmAction: () => true,
    request: async (path, options = {}) => {
      requests.push({ path, options });
      const body = options.body ? JSON.parse(options.body) : {};
      if (path === "/api/gateway/models" && options.method === "POST") return { model: { ...body, updatedAt: "model-v1" } };
      if (options.method === "PATCH") return { model: { ...body, updatedAt: "model-v2" } };
      if (options.method === "DELETE") return { ok: true };
      return responseFor(path, options);
    },
  });

  await controller.createModel({ alias: "chat", targetModel: "openai:gpt-5", enabled: true });
  assert.equal(state.gatewayModels[0].alias, "chat");
  await controller.updateModel("chat", { alias: "assistant", targetModel: "anthropic:claude-sonnet", enabled: false });
  assert.deepEqual(state.gatewayModels.map((model) => model.alias), ["assistant"]);
  await controller.deleteModel("assistant");
  assert.deepEqual(state.gatewayModels, []);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    alias: "assistant", targetModel: "anthropic:claude-sonnet", enabled: false, expectedUpdatedAt: "model-v1",
  });
  assert.deepEqual(requests.map((item) => [item.path, item.options.method]), [
    ["/api/gateway/models", "POST"],
    ["/api/gateway/models?alias=chat", "PATCH"],
    ["/api/gateway/models?alias=assistant", "DELETE"],
  ]);
});

test("one-time token copy only succeeds when the clipboard reports true", async () => {
  const toasts = [];
  let rejectCopy = false;
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    copyText: async () => {
      if (rejectCopy) throw new Error("clipboard unavailable");
      return false;
    },
    showToast: (message) => toasts.push(message),
    request: async (path, options = {}) => {
      if (path === "/api/gateway/keys" && options.method === "POST") {
        return { key: { id: "key-1", name: "Laptop", enabled: true }, token: "secret-copy-once" };
      }
      return responseFor(path, options);
    },
  });

  await controller.createKey({ name: "Laptop" });
  toasts.length = 0;
  assert.equal(await controller.copyOneTimeToken(), false);
  assert.equal(controller.oneTimeTokenValue(), "secret-copy-once");
  assert.deepEqual(toasts, ["复制 Token 失败，请在关闭前手动复制。"]);

  rejectCopy = true;
  assert.equal(await controller.copyOneTimeToken(), false);
  assert.equal(controller.oneTimeTokenValue(), "secret-copy-once");
  assert.deepEqual(toasts, [
    "复制 Token 失败，请在关闭前手动复制。",
    "复制 Token 失败，请在关闭前手动复制。",
  ]);
});

test("PATCH conflicts refresh latest Shared API data without applying stale edits", async () => {
  const requests = [];
  const toasts = [];
  const state = enabledState({
    gatewayKeys: [{ id: "key-1", name: "Laptop", enabled: true, allowedModels: ["public/chat"], updatedAt: "key-v1" }],
    gatewayModels: [{ alias: "public/chat", targetModel: "openai:gpt-5", enabled: true, updatedAt: "model-v1" }],
  });
  const conflict = () => Object.assign(new Error("conflict"), { status: 409 });
  const controller = createSharedAPISettingsController({
    state,
    showToast: (message) => toasts.push(message),
    request: async (path, options = {}) => {
      requests.push({ path, options });
      if (options.method === "PATCH") throw conflict();
      if (path === "/api/gateway/keys") return { keys: [{ id: "key-1", name: "Server key", enabled: false, allowedModels: ["public/chat"], updatedAt: "key-v2" }] };
      if (path === "/api/gateway/models") return { models: [{ alias: "public/chat", targetModel: "anthropic:latest", enabled: true, updatedAt: "model-v2" }] };
      if (path === "/api/gateway/usage") return { items: [], summary: {} };
      return {};
    },
  });

  await assert.rejects(controller.updateKey("key-1", { name: "Stale key", enabled: true }), /服务器/);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: "Stale key", enabled: true, allowedModels: [], requestsPerMinute: 0, monthlyTokenLimit: 0, maxConcurrency: 0, expiresAt: "", expectedUpdatedAt: "key-v1",
  });
  assert.equal(state.gatewayKeys[0].name, "Server key");
  assert.match(state.gatewayAPIError, /服务器/);

  const patchCount = requests.length;
  await assert.rejects(controller.updateModel("public/chat", { alias: "public/chat", targetModel: "stale:target", enabled: false }), /服务器/);
  assert.deepEqual(JSON.parse(requests[patchCount].options.body), {
    alias: "public/chat", targetModel: "stale:target", enabled: false, expectedUpdatedAt: "model-v2",
  });
  assert.equal(state.gatewayModels[0].targetModel, "anthropic:latest");
  assert.deepEqual(toasts, []);
});

test("newer Shared API loads prevent older responses from overwriting state", async () => {
  const pending = [];
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    request: (path) => new Promise((resolve) => pending.push({ path, resolve })),
  });

  const stale = controller.load();
  const fresh = controller.load();
  assert.equal(pending.length, 6);
  pending.slice(0, 3).forEach(({ path, resolve }) => resolve(responseFor(path)));
  assert.equal(await stale, false);
  pending.slice(3).forEach(({ path, resolve }) => {
    if (path === "/api/gateway/keys") resolve({ keys: [{ id: "new", name: "Latest", enabled: true }] });
    else if (path === "/api/gateway/models") resolve({ models: [{ alias: "latest", targetModel: "openai:gpt-5", enabled: true }] });
    else resolve({ items: [], summary: { requests: 2 } });
  });
  assert.equal(await fresh, true);
  assert.equal(state.gatewayKeys[0].id, "new");
  assert.equal(state.gatewayModels[0].alias, "latest");
  assert.equal(state.gatewayUsage.summary.requests, 2);
});

test("API failures are retained as an escaped panel alert", async () => {
  const state = enabledState();
  const controller = createSharedAPISettingsController({
    state,
    request: async () => { throw new Error('<script>alert("gateway")</script>'); },
  });

  await assert.rejects(controller.load(), /gateway/);
  assert.equal(state.gatewayDataLoaded, true, "a failed initial load must not trigger an automatic retry loop");
  const html = controller.render();
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("Shared API translation keys stay aligned across all three locales", () => {
  const keys = (value, prefix = "") => Object.entries(value || {}).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === "object" && !Array.isArray(item) ? keys(item, path) : [path];
  }).sort();
  assert.deepEqual(keys(messagesZhTW.sharedAPI), keys(messagesZhCN.sharedAPI));
  assert.deepEqual(keys(messagesEN.sharedAPI), keys(messagesZhCN.sharedAPI));
});
