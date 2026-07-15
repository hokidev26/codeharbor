import test from "node:test";
import assert from "node:assert/strict";

import messagesEN from "./messages-en.mjs";
import messagesZhCN from "./messages-zh-CN.mjs";
import messagesZhTW from "./messages-zh-TW.mjs";
import {
  codexAccountActionRequest,
  codexDeleteResultWarning,
  codexMutationRefreshWarning,
  createModelProviderSettingsController,
  isProviderConsoleInteractiveTarget,
  normalizeCodexAccountList,
  providerConsoleDraftFromForm,
  providerPreflightResult,
  restoreProviderConsoleFocus,
  shouldOpenProviderCardFromKeyboard,
  syncProviderConsoleDraft,
  trapProviderConsoleFocus,
  renderCodexAccountManagementTable,
} from "./model-provider-settings.mjs";
import {
  createProviderDraft,
  filterConsoleProviders,
  isBuiltinProvider,
  isProviderDeletable,
  modelProvidersForUIUnion,
  providerConfigPayload,
  providerConsoleRequest,
  providerConsoleStats,
  providerTestPayload,
  renderProviderConsolePage,
} from "./model-provider-components.mjs";
import { setUILocale } from "./i18n.mjs";

const labels = {
  noCodexCredentials: "No accounts",
  accountName: "Name",
  accountId: "Account ID",
  priority: "Priority",
  status: "Status",
  successFailure: "Success / failure",
  usage: "Usage",
  lastUsed: "Last used",
  actions: "Actions",
  primaryQuota: "Primary",
  secondaryQuota: "Secondary",
  remainingPercent: "{percent}% remaining",
  resetsIn: "Resets in {time}",
  noQuota: "No quota",
  credits: "Credits",
  creditsBalance: "Balance {balance}",
  creditsUnlimited: "Unlimited",
  creditsUnavailable: "Unavailable",
  never: "Never",
  rateLimited: "Rate limited",
  disabled: "Disabled",
  available: "Available",
  save: "Save",
  sync: "Sync",
  enable: "Enable",
  disable: "Disable",
  delete: "Delete",
  unknown: "unknown",
  accountMutationRefreshFailed: "Mutation succeeded; refresh failed: {message}",
  accountDeletePartial: "Credential deleted; statistics cleanup incomplete.",
};
const translate = (key, params = {}) => String(labels[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));

function render(accounts, now = Date.parse("2026-01-01T00:00:00Z")) {
  return renderCodexAccountManagementTable(accounts, { translate, now });
}

test("Codex account table renders complete account data and escapes HTML", () => {
  const html = render([{
    id: "codex_fixture",
    alias: `Primary <script>alert(1)</script>`,
    email: "user@example.test",
    account_id: "workspace-1",
    priority: 7,
    plan_type: "team<unsafe>",
    disabled: false,
    stats: { success_count: 12, failure_count: 3, last_use_at: "2025-12-31T23:00:00Z", last_error_code: `bad<script>` },
    quota: { plan_type: "team", primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 3600 } },
  }]);
  assert.match(html, /codex-account-table/);
  assert.match(html, /workspace-1/);
  assert.match(html, />12<\/span> \/ <span[^>]*>3</);
  assert.match(html, /75% remaining/);
  assert.match(html, /5h · Resets in 1h 0m/);
  assert.match(html, /data-codex-save="codex_fixture"/);
  assert.match(html, /data-codex-sync="codex_fixture"/);
  assert.match(html, /data-codex-toggle="codex_fixture"/);
  assert.match(html, /data-codex-delete="codex_fixture"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("Codex account normalization supports legacy response shapes", () => {
  const legacy = [{ name: "legacy.json", account_id: "legacy" }];
  assert.deepEqual(normalizeCodexAccountList(legacy), legacy);
  assert.deepEqual(normalizeCodexAccountList({ files: legacy }), legacy);
  assert.deepEqual(normalizeCodexAccountList({ accounts: legacy }), legacy);
  assert.deepEqual(normalizeCodexAccountList(null), []);
  const html = render(legacy);
  assert.match(html, /legacy\.json/);
  assert.match(html, /value="100"/);
  assert.match(html, /data-codex-save="legacy\.json"/);
  assert.match(html, /No quota/);
});

test("Codex quota rendering supports no quota and dual windows", () => {
  assert.match(render([{ id: "none", priority: 100 }]), /No quota/);
  const html = render([{
    id: "dual",
    priority: 100,
    quota: {
      primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: "2026-01-01T02:30:00Z" },
      secondary_window: { used_percent: 65.5, limit_window_seconds: 604800, reset_after_seconds: 90061 },
    },
  }]);
  assert.match(html, /80% remaining/);
  assert.match(html, /34\.5% remaining/);
  assert.match(html, /5h · Resets in 2h 30m/);
  assert.match(html, /7d · Resets in 1d 1h/);
});

test("Codex quota rendering supports camelCase data, credits, and invalid numeric values", () => {
  const html = render([{
    id: "credits",
    accountID: "workspace<&>",
    priority: "invalid",
    stats: { successCount: "invalid", failureCount: 2, lastStatusCode: "status<script>" },
    quota: {
      planType: "pro<&>",
      primaryWindow: { usedPercent: 100, windowSeconds: 3600, resetAfterSeconds: 60 },
      credits: { hasCredits: true, balance: "12.50" },
    },
  }]);
  assert.match(html, /Rate limited/);
  assert.match(html, /0% remaining/);
  assert.match(html, /1h · Resets in 1m/);
  assert.match(html, /Credits/);
  assert.match(html, /Balance 12.5/);
  assert.match(html, /value="100"/);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /workspace&lt;&amp;&gt;/);
  assert.match(html, /pro&lt;&amp;&gt;/);
});

test("Codex credits can render without quota windows", () => {
  const html = render([{ id: "unlimited", quota: { credits: { unlimited: true } } }]);
  assert.match(html, /Credits/);
  assert.match(html, /Unlimited/);
  assert.doesNotMatch(html, /No quota/);
});

test("Codex account status distinguishes disabled, limited, and available", () => {
  assert.match(render([{ id: "disabled", disabled: true }]), />Disabled<\/span>/);
  assert.match(render([{ id: "limited", quota: { rate_limit_reached_type: "primary" } }]), />Rate limited<\/span>/);
  assert.match(render([{ id: "ready" }]), />Available<\/span>/);
});

test("Codex mutation success is reported separately from a refresh failure", () => {
  assert.equal(codexMutationRefreshWarning(true, "ignored", translate), "");
  assert.equal(codexMutationRefreshWarning(false, "offline", translate), "Mutation succeeded; refresh failed: offline");
});

test("Codex partial delete results produce a dedicated warning", () => {
  assert.equal(codexDeleteResultWarning({ status: "ok", stats_deleted: true }, translate), "");
  assert.equal(codexDeleteResultWarning({ status: "partial" }, translate), "Credential deleted; statistics cleanup incomplete.");
  assert.equal(codexDeleteResultWarning({ status: "ok", stats_deleted: false }, translate), "Credential deleted; statistics cleanup incomplete.");
});

test("Codex account action requests cover save, sync, toggle, and delete", () => {
  const save = codexAccountActionRequest("save", "id/with space", { alias: "Main", priority: 9 });
  assert.equal(save.path, "/api/providers/oauth/codex/accounts/id%2Fwith%20space");
  assert.equal(save.options.method, "PATCH");
  assert.deepEqual(JSON.parse(save.options.body), { alias: "Main", priority: 9 });

  const sync = codexAccountActionRequest("sync", "codex_1");
  assert.deepEqual(sync, { path: "/api/providers/oauth/codex/accounts/codex_1/refresh", options: { method: "POST" } });
  const toggle = codexAccountActionRequest("toggle", "codex_1", { disabled: true });
  assert.deepEqual(JSON.parse(toggle.options.body), { disabled: false });
  const remove = codexAccountActionRequest("delete", "codex_1");
  assert.equal(remove.options.method, "DELETE");
});

test("modelProvider translation keys stay aligned across all three locales", () => {
  const keys = Object.keys(messagesZhCN.modelProvider).sort();
  assert.deepEqual(Object.keys(messagesZhTW.modelProvider).sort(), keys);
  assert.deepEqual(Object.keys(messagesEN.modelProvider).sort(), keys);
});

test("缺少必填 API Key 的预检使用三语言警告，不显示成功", () => {
  const expected = {
    "zh-CN": "需要 API Key，尚未执行连接预检。",
    "zh-TW": "需要 API Key，尚未執行連線預檢。",
    en: "An API Key is required; connection preflight was not run.",
  };
  const catalogs = { "zh-CN": messagesZhCN, "zh-TW": messagesZhTW, en: messagesEN };
  for (const [locale, message] of Object.entries(expected)) {
    const result = providerPreflightResult(
      { configured: false, reachable: false, errorCode: "not_configured" },
      (key, params) => {
        const [scope, name] = key.split(".");
        const template = catalogs[locale].modelProvider.console[scope]?.[name] || key;
        return template.replace(/\{(\w+)\}/g, (_, field) => String(params?.[field] ?? ""));
      },
    );
    assert.deepEqual(result, { message, tone: "warning", terminalLevel: "warn" }, locale);
    assert.notEqual(result.tone, "success", locale);
  }

  const success = providerPreflightResult(
    { configured: true, reachable: true },
    (key) => key,
  );
  assert.equal(success.tone, "success");
});

test("model catalog preserves reasoning effort capabilities for composer controls", () => {
  const controller = createModelProviderSettingsController({
    state: {
      modelCatalog: {
        providers: [{
          name: "openai",
          type: "openai",
          models: ["gpt-5"],
          configured: true,
          capabilities: { reasoningEffortValues: ["low", "medium", "high", "xhigh"] },
          modelCapabilities: { "gpt-5": { fastMode: true } },
        }],
      },
      settings: { providers: [] },
      agent: { model: "openai:gpt-5" },
    },
  });

  assert.deepEqual(controller.currentProviderConfig("openai:gpt-5").capabilities, {
    tools: false,
    streaming: false,
    imageInput: false,
    reasoningEffort: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  });
  assert.deepEqual(controller.currentProviderConfig("openai:gpt-5").modelCapabilities, {
    "gpt-5": { fastMode: true },
  });
});

test("model catalog passes through object-shaped Provider reasoning capabilities", () => {
  const controller = createModelProviderSettingsController({
    state: {
      modelCatalog: {
        providers: [{
          name: "provider",
          type: "openai-compatible",
          models: ["reasoning-model"],
          configured: true,
          capabilities: { reasoningEffort: { supportedValues: ["medium", "xhigh"] } },
        }],
      },
      settings: { providers: [] },
    },
  });

  assert.deepEqual(controller.currentProviderConfig("provider:reasoning-model").capabilities, {
    tools: false,
    streaming: false,
    imageInput: false,
    reasoningEffort: true,
    reasoningEfforts: ["medium", "xhigh"],
  });
});

test("供应商控制台总览将 settings 与 catalog 合并，并保留已禁用供应商", () => {
  const providers = modelProvidersForUIUnion(
    [
      { name: "openai", type: "openai", enabled: true, origin: "builtin", model: "gpt-4.1-mini", configured: true },
      { name: "offline-gateway", type: "openai-compatible", enabled: false, origin: "custom", baseUrl: "https://gateway.example/v1", model: "offline-1", configured: true },
    ],
    [{ name: "openai", type: "openai", configured: true, models: ["gpt-4.1-mini", "gpt-5"] }],
  );
  assert.equal(providers.length, 2);
  assert.equal(providers.find((provider) => provider.name === "offline-gateway").enabled, false);
  assert.deepEqual(providerConsoleStats(providers), { total: 2, enabled: 1, models: 3, attention: 0 });
  const controller = createModelProviderSettingsController({
    state: {
      settings: { providers: [{ name: "offline-gateway", type: "openai-compatible", enabled: false, origin: "custom", model: "offline-1" }] },
      modelCatalog: { providers: [{ name: "openai", type: "openai", configured: true, models: ["gpt-5"] }] },
    },
  });
  assert.equal(controller.currentProviderConfig("offline-gateway:offline-1").enabled, false);

  const html = renderProviderConsolePage({ providers, consoleState: {} });
  assert.match(html, /mp-provider-page/);
  assert.match(html, /总数/);
  assert.match(html, /已启用/);
  assert.match(html, /可用模型/);
  assert.match(html, /需处理/);
  assert.match(html, /data-mp-provider-card="offline-gateway"/);
  assert.match(html, /aria-checked="false"/);
});

test("供应商控制台按分类和搜索过滤，并保留兼容 relay 入口", () => {
  const providers = modelProvidersForUIUnion([
    { name: "codex", type: "codex", enabled: true, origin: "builtin", model: "gpt-5.5" },
    { name: "groq", type: "openai-compatible", enabled: true, origin: "custom", baseUrl: "https://api.groq.example/v1", model: "llama" },
    { name: "acme", type: "anthropic", enabled: false, origin: "custom", baseUrl: "https://acme.example", model: "claude" },
  ], []);
  assert.deepEqual(filterConsoleProviders(providers, { category: "official" }).map((provider) => provider.name), ["codex"]);
  assert.deepEqual(filterConsoleProviders(providers, { category: "compatible" }).map((provider) => provider.name), ["groq"]);
  assert.deepEqual(filterConsoleProviders(providers, { search: "acme" }).map((provider) => provider.name), ["acme"]);
  assert.deepEqual(filterConsoleProviders(providers, { search: "groq.example" }).map((provider) => provider.name), ["groq"]);

  const html = renderProviderConsolePage({ providers, consoleState: { category: "compatible" } });
  assert.match(html, /mp-category-tabs/);
  assert.match(html, /mp-provider-section/);
  assert.match(html, /data-mp-open-relay/);
});

test("供应商控制台渲染添加类型 modal 和配置 drawer", () => {
  const providers = modelProvidersForUIUnion([{ name: "groq", type: "openai-compatible", origin: "custom", enabled: true, model: "llama", baseUrl: "https://api.groq.example/v1" }], []);
  const modal = renderProviderConsolePage({ providers, consoleState: { modal: "types" } });
  assert.match(modal, /mp-provider-type-modal/);
  assert.match(modal, /mp-provider-type-grid/);
  assert.match(modal, /data-mp-select-type="codex"/);
  assert.match(modal, /data-mp-select-type="ollama"/);

  const drawer = renderProviderConsolePage({
    providers,
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: providers[0] },
  });
  for (const className of ["mp-provider-drawer-backdrop", "mp-provider-drawer", "mp-drawer-head", "mp-drawer-body", "mp-drawer-foot", "mp-config-section"]) {
    assert.match(drawer, new RegExp(className));
  }
  assert.match(drawer, /data-mp-test-provider/);
  assert.match(drawer, /data-mp-save-provider/);
  assert.match(drawer, /data-mp-delete-provider="groq"/);
  assert.match(drawer, /aria-describedby="mp-drawer-description"/);
  assert.match(modal, /aria-describedby="mp-provider-type-description"/);
  assert.match(drawer, /留空会保留当前运行时密钥/);
});

test("供应商控制台配置 payload 保留空 API Key 并规范高级字段", () => {
  const draft = createProviderDraft("openai-compatible");
  const payload = providerConfigPayload({
    ...draft,
    name: "acme-gateway",
    baseUrl: " https://api.acme.example/v1 ",
    apiKey: "",
    model: " model-a ",
    maxTokens: "4096.8",
    apiKeyOptional: true,
  });
  assert.deepEqual(payload, {
    name: "acme-gateway",
    type: "openai-compatible",
    profile: "",
    baseUrl: "https://api.acme.example/v1",
    apiKey: "",
    model: "model-a",
    maxTokens: 4096,
    apiKeyOptional: true,
  });
});

test("供应商控制台 toggle、草稿预检、delete 与 config 请求遵守后端契约", () => {
  const provider = { name: "custom/name space", defaultModel: "model-a", enabled: true, configured: true, origin: "custom" };
  const toggle = providerConsoleRequest("toggle", provider, { enabled: true });
  assert.equal(toggle.path, "/api/providers/custom%2Fname%20space");
  assert.equal(toggle.options.method, "PATCH");
  assert.deepEqual(JSON.parse(toggle.options.body), { enabled: true, model: "model-a" });

  const draft = {
    name: provider.name,
    type: "openai-compatible",
    profile: "cliproxyapi",
    baseUrl: " https://example.test/v1 ",
    apiKey: "",
    model: " model-a ",
    maxTokens: "4096.2",
    apiKeyOptional: true,
    enabled: false,
    origin: "builtin",
    configured: false,
    error: "never send this",
  };
  assert.deepEqual(providerTestPayload(draft), {
    name: provider.name,
    type: "openai-compatible",
    profile: "cliproxyapi",
    baseUrl: "https://example.test/v1",
    apiKey: "",
    model: "model-a",
    maxTokens: 4096,
    apiKeyOptional: true,
  });
  const testConnection = providerConsoleRequest("test", provider, draft);
  assert.equal(testConnection.path, "/api/providers/test");
  assert.equal(testConnection.options.method, "POST");
  assert.deepEqual(JSON.parse(testConnection.options.body), providerTestPayload(draft));
  assert.equal(JSON.parse(testConnection.options.body).apiKey, "", "empty key keeps existing-key semantics");
  assert.equal(Object.hasOwn(JSON.parse(testConnection.options.body), "origin"), false);
  assert.equal(Object.hasOwn(JSON.parse(testConnection.options.body), "enabled"), false);

  const remove = providerConsoleRequest("delete", provider);
  assert.deepEqual(remove, { path: "/api/providers/custom%2Fname%20space", options: { method: "DELETE" } });

  const config = providerConsoleRequest("config", provider, { name: provider.name, type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "", model: "model-a" });
  assert.equal(config.path, "/api/providers/custom%2Fname%20space/config");
  assert.equal(config.options.method, "PUT");
  assert.equal(JSON.parse(config.options.body).apiKey, "");
});

test("供应商表单草稿实时同步并在后台重绘时保持 dirty 内容", () => {
  const form = {
    elements: {
      name: { value: "acme" },
      type: { value: "openai-compatible" },
      baseUrl: { value: "https://api.acme.example/v1" },
      apiKey: { value: "draft-key" },
      model: { value: "acme-model" },
      maxTokens: { value: "8192" },
      apiKeyOptional: { checked: true },
    },
  };
  const consoleState = { type: "openai", draft: { origin: "custom", enabled: false }, dirty: false };
  assert.deepEqual(providerConsoleDraftFromForm(consoleState.draft, form, consoleState.type), {
    origin: "custom",
    enabled: false,
    name: "acme",
    type: "openai-compatible",
    profile: "",
    baseUrl: "https://api.acme.example/v1",
    apiKey: "draft-key",
    model: "acme-model",
    maxTokens: 8192,
    apiKeyOptional: true,
  });
  syncProviderConsoleDraft(consoleState, form);
  assert.equal(consoleState.dirty, true);
  assert.equal(consoleState.draft.apiKey, "draft-key");
  assert.equal(consoleState.draft.apiKeyOptional, true);

  const state = {
    settings: { providers: [{ name: "acme", type: "openai-compatible", origin: "custom", model: "saved-model", baseUrl: "https://old.example/v1" }] },
    modelCatalog: { providers: [{ name: "acme", type: "openai-compatible", models: ["saved-model"] }] },
    providerConsole: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: { ...consoleState.draft }, dirty: true },
  };
  const controller = createModelProviderSettingsController({ state });
  const firstRender = controller.renderProviderSettingsContent();
  state.settings.providers[0].model = "refreshed-model";
  state.modelCatalog.providers[0].models = ["refreshed-model"];
  const refreshedRender = controller.renderProviderSettingsContent();
  assert.match(firstRender, /value="acme-model"/);
  assert.match(refreshedRender, /value="acme-model"/);
  assert.equal(state.providerConsole.dirty, true);
  assert.equal(state.providerConsole.draft.apiKey, "draft-key");
});

test("供应商卡片键盘操作排除交互元素", () => {
  const card = { contains: (node) => node === button || node === input || node === select || node === switchControl };
  const button = { closest: () => button };
  const input = { closest: () => input };
  const select = { closest: () => select };
  const switchControl = { closest: () => switchControl };
  const plain = { closest: () => null };
  assert.equal(isProviderConsoleInteractiveTarget(button, card), true);
  assert.equal(isProviderConsoleInteractiveTarget(input, card), true);
  assert.equal(isProviderConsoleInteractiveTarget(select, card), true);
  assert.equal(isProviderConsoleInteractiveTarget(switchControl, card), true);
  assert.equal(shouldOpenProviderCardFromKeyboard({ key: "Enter", target: button }, card), false);
  assert.equal(shouldOpenProviderCardFromKeyboard({ key: " ", target: input }, card), false);
  assert.equal(shouldOpenProviderCardFromKeyboard({ key: "Enter", target: plain }, card), true);
  assert.equal(shouldOpenProviderCardFromKeyboard({ key: "Escape", target: plain }, card), false);
});

test("供应商弹层焦点环与触发元素恢复", () => {
  const first = { disabled: false, tabIndex: 0, getAttribute: () => null, focused: 0, focus() { this.focused += 1; } };
  const last = { disabled: false, tabIndex: 0, getAttribute: () => null, focused: 0, focus() { this.focused += 1; } };
  const layer = { querySelectorAll: () => [first, last], focused: 0, focus() { this.focused += 1; } };
  const forward = { key: "Tab", target: last, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(trapProviderConsoleFocus(forward, layer), true);
  assert.equal(forward.prevented, true);
  assert.equal(first.focused, 1);
  const backward = { key: "Tab", target: first, shiftKey: true, prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(trapProviderConsoleFocus(backward, layer), true);
  assert.equal(backward.prevented, true);
  assert.equal(last.focused, 1);
  const emptyLayer = { querySelectorAll: () => [], focused: 0, focus() { this.focused += 1; } };
  assert.equal(trapProviderConsoleFocus({ key: "Tab", target: emptyLayer, preventDefault() {} }, emptyLayer), true);
  assert.equal(emptyLayer.focused, 1);
  const trigger = { focused: 0, focus() { this.focused += 1; } };
  restoreProviderConsoleFocus(trigger);
  assert.equal(trigger.focused, 1);
});

test("英文与繁中控制台不会回退为简中硬编码", () => {
  const providers = modelProvidersForUIUnion([{ name: "gateway", type: "openai-compatible", origin: "custom", enabled: true, model: "model-a", baseUrl: "https://gateway.example/v1" }], []);
  const root = { title: "", documentElement: { lang: "", dataset: {} }, querySelectorAll() { return []; } };
  setUILocale("en", root);
  const english = renderProviderConsolePage({ providers, consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: providers[0] } });
  assert.match(english, /Current draft|Model provider|Provider/);
  assert.doesNotMatch(english, /供应商|连接|配置|当前|保存|删除/);
  setUILocale("zh-TW", root);
  const traditional = renderProviderConsolePage({ providers, consoleState: { modal: "types" } });
  assert.match(traditional, /模型供應商|選擇連線類型/);
  assert.doesNotMatch(traditional, /供应商|连接|配置|当前|保存|删除/);
  setUILocale("zh-CN", root);
});

test("缺失 origin 时保守保护删除，明确 custom 才可删除", () => {
  for (const name of ["openai-compatible", "cliproxyapi", "ollama"]) {
    assert.equal(isBuiltinProvider({ name }), true, name);
  }
  assert.equal(isBuiltinProvider({ name: "unlabeled-provider" }), true);
  assert.equal(isProviderDeletable({ name: "unlabeled-provider" }), false);
  assert.equal(isProviderDeletable({ name: "openai-compatible", origin: "custom" }), true);
  const protectedHtml = renderProviderConsolePage({
    providers: modelProvidersForUIUnion([{ name: "unlabeled-provider", type: "openai-compatible", enabled: false, model: "model-a" }], []),
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: { name: "unlabeled-provider", type: "openai-compatible", model: "model-a", origin: "unknown" } },
  });
  assert.doesNotMatch(protectedHtml, /data-mp-delete-provider/);
});

test("Codex 控制台抽屉继续使用导入和账号额度表", () => {
  const state = {
    settings: { providers: [{ name: "codex", type: "codex", origin: "builtin", enabled: true, model: "gpt-5.5" }] },
    modelCatalog: { providers: [{ name: "codex", type: "codex", configured: true, models: ["gpt-5.5"] }] },
    providerAuthFiles: [{ id: "account-1", alias: "Main", quota: { credits: { unlimited: true } } }],
    providerConsole: { drawer: "provider", mode: "codex", type: "codex", draft: createProviderDraft("codex") },
  };
  const controller = createModelProviderSettingsController({ state });
  const html = controller.renderProviderSettingsContent();
  assert.match(html, /codexAuthImportText/);
  assert.match(html, /data-mp-codex-import/);
  assert.match(html, /codex-account-table/);
  assert.match(html, /codex-credits-summary/);
});

test("relay 控制台抽屉保留协议、模型刷新和保存入口", () => {
  const state = {
    settings: { providers: [{ name: "openai-compatible", type: "openai-compatible", origin: "builtin", enabled: true, model: "relay-model", baseUrl: "https://relay.example/v1" }] },
    modelCatalog: { providers: [] },
    providerConsole: { drawer: "relay", mode: "relay", type: "relay", draft: null },
  };
  const controller = createModelProviderSettingsController({ state });
  const html = controller.renderProviderSettingsContent();
  assert.match(html, /relayBaseUrl/);
  assert.match(html, /relayCustomModel/);
  assert.match(html, /data-relay-protocol/);
  assert.match(html, /data-mp-fetch-models/);
  assert.match(html, /data-mp-relay-save/);
  assert.match(html, /aria-describedby="mp-drawer-description"/);
});

test("供应商控制台转义服务端 Provider 文本和错误", () => {
  const html = renderProviderConsolePage({
    providers: modelProvidersForUIUnion([{
      name: `bad"><script>alert(1)</script>`,
      type: "openai-compatible",
      origin: "custom",
      enabled: true,
      baseUrl: `https://x.example/<script>`,
      model: `<img src=x onerror=alert(1)>`,
      error: `<script>server error</script>`,
    }], []),
    consoleState: {},
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});
