import test from "node:test";
import assert from "node:assert/strict";

import {
  automationLimits,
  buildConnectionPayload,
  buildDeviceActionPayload,
  buildPairingCodePayload,
  buildSchedulePayload,
  createAutomationControlController,
  normalizeConnection,
  readLegacyIMDraft,
  renderAutomationControl,
  requireLocalDoubleConfirmation,
} from "./automation-control.mjs";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
}

function emptyAPI(path) {
  if (path === "/api/monitoring/snapshot") return {};
  return [];
}

test("automation rendering escapes all dynamic content and bounds rendered collections", () => {
  const malicious = '\"><img src=x onerror="boom">';
  const html = renderAutomationControl({
    loaded: true,
    schedules: Array.from({ length: automationLimits.schedules + 5 }, (_, index) => ({
      id: `${malicious}-${index}`,
      name: `<script>alert(${index})</script>`,
      expression: malicious,
      agentId: malicious,
      prompt: malicious,
      enabled: true,
    })),
    deliveries: [{ id: malicious, event: malicious, channel: malicious, error: `<svg onload=boom>` }],
    connections: [{ id: malicious, kind: "telegram", name: malicious, secretConfigured: { botToken: true } }],
    pairings: [{ id: malicious, agentId: malicious, channelUser: malicious }],
    devices: [{ entityId: malicious, name: malicious, state: malicious }],
    deviceActions: [{ id: malicious, entityId: malicious, domain: malicious, service: malicious, status: "pending" }],
    auditEvents: [{ id: malicious, type: malicious, actor: malicious, summary: malicious }],
    errors: { global: `<script>error</script>` },
  });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.match(html, /&lt;script&gt;alert\(0\)&lt;\/script&gt;/);
  assert.equal((html.match(/data-schedule-card=/g) || []).length, automationLimits.schedules);
});

test("legacy localStorage IM draft is an explicitly disabled migration hint, never runtime authority", async () => {
  const storage = new MemoryStorage([["autoto.imGateway", JSON.stringify({ enabled: true, channel: "telegram" })]]);
  const legacy = readLegacyIMDraft(storage);
  assert.deepEqual(legacy, {
    present: true,
    key: "autoto.imGateway",
    channel: "telegram",
    authoritative: false,
    status: "disabled",
  });

  const controller = createAutomationControlController({
    storage,
    request: async (path) => emptyAPI(path),
  });
  assert.equal(await controller.load(), true);
  const state = controller.getState();
  assert.equal(state.legacyDraft.present, true);
  assert.equal(state.legacyDraft.authoritative, false);
  assert.equal(state.monitoring.channelCount, 0);
  assert.equal(state.connections.length, 0);

  const html = controller.render();
  assert.match(html, /旧草稿已停用/);
  assert.match(html, /绝不计入运行状态/);
  assert.match(html, /data-authority="server-api"/);
});

test("payload helpers send only supported normalized fields and require env references", () => {
  assert.deepEqual(buildSchedulePayload({
    name: "  nightly  ",
    cron: " 0 2 * * * ",
    agentId: " agent-1 ",
    timezone: " Asia/Shanghai ",
    prompt: " run tests ",
    permissionMode: "bypassPermissions",
    enabled: 1,
    ignored: "nope",
  }), {
    name: "nightly",
    agentId: "agent-1",
    expression: "0 2 * * *",
    timezone: "Asia/Shanghai",
    prompt: "run tests",
    permissionMode: "readOnly",
    enabled: true,
  });

  assert.deepEqual(buildConnectionPayload({
    kind: "telegram",
    name: " Ops ",
    credentialRef: "env:AUTOTO_TELEGRAM_BOT_TOKEN",
    token: "must-not-send",
  }), {
    kind: "telegram",
    name: "Ops",
    enabled: true,
    endpoint: "",
    settings: {},
    secretRefs: { botToken: "env:AUTOTO_TELEGRAM_BOT_TOKEN" },
  });
  assert.deepEqual(buildConnectionPayload({
    kind: "home-assistant",
    name: " Home ",
    endpoint: "http://homeassistant.local:8123/",
    credentialRef: "env:AUTOTO_HOME_ASSISTANT_TOKEN",
  }), {
    kind: "home-assistant",
    name: "Home",
    enabled: true,
    endpoint: "http://homeassistant.local:8123",
    settings: {},
    secretRefs: { accessToken: "env:AUTOTO_HOME_ASSISTANT_TOKEN" },
  });
  assert.throws(() => buildConnectionPayload({ kind: "telegram", credentialRef: "123456:plaintext-token" }), /禁止输入 token/);
  assert.deepEqual(buildPairingCodePayload({ connectionId: " conn ", agentId: " agent " }), { connectionId: "conn", agentId: "agent" });
  assert.deepEqual(buildDeviceActionPayload({
    connectionId: "ha-1",
    entityId: "light.office",
    service: "turn_on",
    input: '{"brightness":2}',
    source: "im",
  }), {
    connectionId: "ha-1",
    domain: "light",
    service: "turn_on",
    input: { brightness: 2, entity_id: "light.office" },
  });
});

test("dangerous device action requires two local confirmations before POST", async () => {
  const calls = [];
  const confirmations = [];
  const controller = createAutomationControlController({
    request: async (path, options = {}) => {
      calls.push({ path, options });
      return { id: "action-1", status: "pending", risk: "high", expiresAt: "2099-01-01T00:00:00Z" };
    },
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    },
  });

  assert.equal(await controller.requestDeviceAction({
    connectionId: "ha-1",
    entityId: "switch.heater",
    service: "turn_on",
    input: {},
  }), true);
  assert.equal(confirmations.length, 2);
  assert.match(confirmations[0], /本地 Web UI/);
  assert.match(confirmations[0], /IM 无法触发/);
  assert.match(confirmations[1], /真实设备状态/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/device-actions");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    connectionId: "ha-1",
    domain: "switch",
    service: "turn_on",
    input: { entity_id: "switch.heater" },
  });
});

test("double confirmation cancellation prevents the dangerous request", async () => {
  let confirmations = 0;
  let requests = 0;
  const controller = createAutomationControlController({
    request: async () => { requests += 1; return {}; },
    confirmAction: () => {
      confirmations += 1;
      return confirmations < 2;
    },
  });

  assert.equal(await controller.requestDeviceAction({
    connectionId: "ha-1",
    entityId: "lock.front_door",
    service: "unlock",
  }), false);
  assert.equal(confirmations, 2);
  assert.equal(requests, 0);
  assert.equal(await requireLocalDoubleConfirmation(() => false), false);
});

test("controller sequence drops stale refresh responses", async () => {
  const scheduleResolvers = [];
  const request = (path) => {
    if (path === "/api/schedules") return new Promise((resolve) => scheduleResolvers.push(resolve));
    return Promise.resolve(emptyAPI(path));
  };
  const controller = createAutomationControlController({ request });

  const older = controller.load();
  const newer = controller.load();
  scheduleResolvers[1]([{ id: "new", name: "new response", expression: "* * * * *", timezone: "UTC", agentId: "a", prompt: "new" }]);
  assert.equal(await newer, true);
  scheduleResolvers[0]([{ id: "old", name: "stale response", expression: "* * * * *", timezone: "UTC", agentId: "a", prompt: "old" }]);
  assert.equal(await older, false);

  assert.deepEqual(controller.getState().schedules.map((item) => item.id), ["new"]);
  assert.equal(controller.getState().loading, false);
});

test("connection normalization and rendering never echo returned secret fields", () => {
  const normalized = normalizeConnection({
    id: "tg-1",
    kind: "telegram",
    name: "Telegram",
    secretConfigured: { botToken: true },
    credentialRef: "env:PRIVATE_RUNTIME_TOKEN",
    token: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
    secret: "server-secret-value",
    config: { botToken: "nested-secret-value" },
  });
  assert.equal(Object.hasOwn(normalized, "token"), false);
  assert.equal(Object.hasOwn(normalized, "secret"), false);
  assert.equal(Object.hasOwn(normalized, "credentialRef"), false);
  assert.equal(normalized.credentialConfigured, true);

  const html = renderAutomationControl({
    loaded: true,
    connections: [{
      ...normalized,
      token: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
      secret: "server-secret-value",
    }],
    auditEvents: [{ type: "connection.test", summary: "token=123456:abcdefghijklmnopqrstuvwxyzABCDE" }],
    errors: { global: "Bearer top-secret-bearer-value" },
  });
  assert.doesNotMatch(html, /abcdefghijklmnopqrstuvwxyzABCDE/);
  assert.doesNotMatch(html, /server-secret-value/);
  assert.doesNotMatch(html, /top-secret-bearer-value/);
  assert.doesNotMatch(html, /env:PRIVATE_RUNTIME_TOKEN/);
  assert.match(html, /引用目标与 secret 均不回显/);
  assert.match(html, /\[REDACTED\]/);
  assert.doesNotMatch(html, /telegramCredentialInput[^>]+value=/);
  assert.doesNotMatch(html, /homeAssistantCredentialInput[^>]+value=/);
});
