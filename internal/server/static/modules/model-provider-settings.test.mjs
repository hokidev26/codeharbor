import test from "node:test";
import assert from "node:assert/strict";

import messagesEN from "./messages-en.mjs";
import messagesZhCN from "./messages-zh-CN.mjs";
import messagesZhTW from "./messages-zh-TW.mjs";
import {
  agentModelSettingsPayload,
  agentModelRoles,
  anthropicAccountActionRequest,
  anthropicAccountCreateRequest,
  anthropicAccountOverview,
  anthropicAccountStatus,
  anthropicAccountsListRequest,
  anthropicProfileLoginCommand,
  codexAccountActionRequest,
  codexAccountExportFilename,
  codexAccountOverview,
  codexBrowserLoginRequest,
  codexAccountStatus,
  codexDeleteResultWarning,
  codexMutationRefreshWarning,
  consumeAnthropicAccountCreateRequest,
  createModelProviderSettingsController,
  isAgentModelReference,
  isProviderConsoleInteractiveTarget,
  modelAggregateActionRequest,
  modelAggregateMembers,
  normalizeAgentModelSettings,
  normalizeAnthropicAccountList,
  normalizeCodexBrowserLoginStatus,
  normalizeModelAggregateList,
  normalizeCodexAccountList,
  providerConsoleDraftFromForm,
  providerModelDiscovery,
  providerPreflightResult,
  restoreProviderConsoleFocus,
  selectProviderConsoleFieldOnFocus,
  shouldOpenProviderCardFromKeyboard,
  syncProviderConsoleDraft,
  trapProviderConsoleFocus,
  trustedCodexBrowserAuthURL,
  renderAnthropicAccountManagementTable,
  renderCodexAccountManagementTable,
  runtimeReasoningSettingsRequest,
} from "./model-provider-settings.mjs";
import {
  createProviderDraft,
  filterConsoleProviders,
  isAnthropicAccountProvider,
  isBuiltinProvider,
  isProviderDeletable,
  modelProvidersForUIUnion,
  normalizeConsoleProvider,
  providerConfigPayload,
  providerConsoleRequest,
  providerConsoleStats,
  providerTestPayload,
  providerMessageTestPayload,
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
  usageTotal: "All time",
  usageLast5Hours: "Last 5 hours",
  usageLast7Days: "Last 7 days",
  usageRequests: "requests",
  usageTokens: "tokens",
  usageNoLocalData: "No local records",
  recordedCost: "Recorded local cost",
  recordedCostHint: "Based on local request records; not a provider billing statement.",
  never: "Never",
  rateLimited: "Rate limited",
  disabled: "Disabled",
  available: "Available",
  expired: "Expired",
  expiresAt: "Expires {time}",
  expiredAt: "Expired {time}",
  quotaUpdatedAt: "Quota synced {time}",
  accountActions: "Actions for {account}",
  save: "Save",
  edit: "Edit",
  cancel: "Cancel",
  sync: "Sync",
  enable: "Enable",
  disable: "Disable",
  delete: "Delete",
  editAccount: "Edit account",
  saveAccount: "Save account",
  cancelEdit: "Cancel edit",
  syncAccount: "Sync account",
  enableAccount: "Enable account",
  disableAccount: "Disable account",
  deleteAccount: "Delete account",
  exportAccountJSON: "Export account JSON",
  exportAccount: "Export JSON",
  exportAccountConfirm: "Download the full Codex credential?",
  exporting: "Exporting",
  accountExported: "The Codex account JSON was downloaded.",
  accountExportFailed: "Unable to create the account JSON download.",
  unknown: "unknown",
  accountMutationRefreshFailed: "Mutation succeeded; refresh failed: {message}",
  accountDeletePartial: "Credential deleted; statistics cleanup incomplete.",
  unconfigured: "Not configured",
  "anthropic.noAccounts": "No Anthropic accounts",
  "anthropic.accountsTitle": "Anthropic accounts",
  "anthropic.authType": "Authentication",
  "anthropic.apiKeyAuth": "API Key",
  "anthropic.profileAuth": "Official profile",
  "anthropic.modelCount": "{count} models",
  "anthropic.noQuotaData": "No quota data available",
  "anthropic.existingConfigSource": "Existing configuration / environment variable",
  "anthropic.readOnly": "Read only",
  "anthropic.quotaRequests": "Requests",
  "anthropic.quotaInputTokens": "Input tokens",
  "anthropic.quotaOutputTokens": "Output tokens",
  "anthropic.quotaRetryAfter": "Retry after {time}",
  "anthropic.quotaFetchedAt": "Fetched {time}",
  "anthropic.quotaRemaining": "Remaining: {count}",
  "anthropic.quotaLimit": "Limit: {count}",
  "anthropic.quotaUsed": "Used: {percent}%",
  "anthropic.quotaResetAt": "Resets {time}",
};
const translate = (key, params = {}) => String(labels[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));

function render(accounts, now = Date.parse("2026-01-01T00:00:00Z"), options = {}) {
  return renderCodexAccountManagementTable(accounts, { translate, now, ...options });
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
    usage: {
      total: { requestCount: 828, inputTokens: 90000000, outputTokens: 27000000, totalTokens: 117000000, costUsd: 145.19 },
      last5Hours: { requestCount: 3, inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costUsd: 0.12 },
      last7Days: { requestCount: 20, inputTokens: 5000, outputTokens: 1000, totalTokens: 6000, costUsd: 1.5 },
    },
    quota: { plan_type: "team", primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 3600 } },
  }]);
  assert.match(html, /codex-account-table/);
  assert.match(html, /settings-card-content/);
  assert.match(html, /scope="col"/);
  assert.match(html, /settings-inline-actions/);
  assert.match(html, /settings-badge/);
  assert.match(html, /workspace-1/);
  assert.match(html, />12<\/span> \/ <span[^>]*>3</);
  assert.match(html, /75% remaining/);
  assert.match(html, /828 requests/);
  assert.match(html, /(?:117M|1\.2億|1\.2亿) tokens/);
  assert.match(html, /Recorded local cost \$145\.19/);
  assert.match(html, /Last 5 hours/);
  assert.match(html, /Last 7 days/);
  assert.match(html, /5h · Resets in 1h 0m/);
  assert.match(html, /data-codex-edit="codex_fixture"/);
  assert.match(html, /data-codex-sync="codex_fixture"/);
  assert.match(html, /data-codex-export="codex_fixture"/);
  assert.match(html, /data-codex-toggle="codex_fixture"/);
  assert.match(html, /data-codex-delete="codex_fixture"/);
  assert.match(html, /codex-account-action-divider/);
  assert.doesNotMatch(html, /data-codex-save="codex_fixture"/);
  assert.doesNotMatch(html, /bad&lt;script&gt;|Expires |Expired 2025/);
  assert.doesNotMatch(html, /Credits|Balance |Quota synced/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);

  const editHtml = render([{ id: "codex_fixture", alias: "Primary", priority: 7 }], undefined, {
    editing: { id: "codex_fixture", alias: "Edited", priority: 9 },
  });
  assert.match(editHtml, /data-codex-edit-alias="codex_fixture"/);
  assert.match(editHtml, /value="Edited"/);
  assert.match(editHtml, /data-codex-edit-priority="codex_fixture"/);
  assert.match(editHtml, /value="9"/);
  assert.match(editHtml, /data-codex-save="codex_fixture"/);
  assert.match(editHtml, /data-codex-edit-cancel="codex_fixture"/);
});

test("Codex account export filenames stay safe and end in JSON", () => {
  assert.equal(codexAccountExportFilename({ name: "primary.json" }, "codex_1"), "primary.json");
  assert.equal(codexAccountExportFilename({ name: `../secret\\backup` }, "codex_1"), "-secret-backup.json");
  assert.equal(codexAccountExportFilename({}, "codex_1"), "codex-codex_1.json");
});

test("Codex account normalization supports legacy response shapes", () => {
  const legacy = [{ name: "legacy.json", account_id: "legacy" }];
  assert.deepEqual(normalizeCodexAccountList(legacy), legacy);
  assert.deepEqual(normalizeCodexAccountList({ files: legacy }), legacy);
  assert.deepEqual(normalizeCodexAccountList({ accounts: legacy }), legacy);
  assert.deepEqual(normalizeCodexAccountList(null), []);
  const html = render(legacy);
  assert.match(html, /legacy\.json/);
  assert.match(html, /codex-priority-value">100/);
  assert.match(html, /data-codex-edit="legacy\.json"/);
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

test("Codex quota rendering supports camelCase windows and invalid numeric values", () => {
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
  assert.match(html, /Balance \$12\.50/);
  assert.match(html, /codex-priority-value">100/);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /workspace&lt;&amp;&gt;/);
  assert.match(html, /pro&lt;&amp;&gt;/);
});

test("Codex quota without windows still renders upstream credit state", () => {
  const html = render([{ id: "unlimited", quota: { credits: { unlimited: true } } }]);
  assert.match(html, /Credits/);
  assert.match(html, /Unlimited/);
  assert.doesNotMatch(html, /No quota/);
});

test("Codex account status distinguishes disabled, limited, expired, and available", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.match(render([{ id: "disabled", disabled: true }], now), />Disabled<\/span>/);
  assert.match(render([{ id: "limited", quota: { rate_limit_reached_type: "primary" } }], now), />Rate limited<\/span>/);
  assert.match(render([{ id: "expired", expires_at: "2025-12-01T00:00:00Z", refreshable: false }], now), />Expired<\/span>/);
  assert.match(render([{ id: "ready" }], now), />Available<\/span>/);
  assert.equal(codexAccountStatus({ expires_at: "2025-12-01T00:00:00Z", refreshable: true }, { now }).key, "available");
  assert.deepEqual(codexAccountOverview([
    { id: "ready" },
    { id: "limited", quota: { rate_limit_reached_type: "primary" } },
    { id: "disabled", disabled: true },
    { id: "expired", expires_at: "2025-12-01T00:00:00Z" },
  ], { now }), { total: 4, available: 1, rateLimited: 1, disabled: 1, expired: 1 });
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

test("Codex account action requests cover save, sync, export, toggle, and delete", () => {
  const save = codexAccountActionRequest("save", "id/with space", { alias: "Main", priority: 9 });
  assert.equal(save.path, "/api/providers/oauth/codex/accounts/id%2Fwith%20space");
  assert.equal(save.options.method, "PATCH");
  assert.deepEqual(JSON.parse(save.options.body), { alias: "Main", priority: 9 });

  const sync = codexAccountActionRequest("sync", "codex_1");
  assert.deepEqual(sync, { path: "/api/providers/oauth/codex/accounts/codex_1/refresh", options: { method: "POST" } });
  const exported = codexAccountActionRequest("export", "id/with space");
  assert.equal(exported.path, "/api/providers/oauth/codex/accounts/id%2Fwith%20space/export");
  assert.deepEqual(exported.options, { method: "GET", headers: { "X-Autoto-Confirm": "export-codex-account" } });
  const toggle = codexAccountActionRequest("toggle", "codex_1", { disabled: true });
  assert.deepEqual(JSON.parse(toggle.options.body), { disabled: false });
  const remove = codexAccountActionRequest("delete", "codex_1");
  assert.equal(remove.options.method, "DELETE");
});

test("Codex browser login requests and authorization URLs stay fail-closed", () => {
  assert.deepEqual(codexBrowserLoginRequest("start"), { path: "/api/providers/oauth/codex/login/start", options: { method: "POST" } });
  assert.deepEqual(codexBrowserLoginRequest("status", "id/with space"), { path: "/api/providers/oauth/codex/login/id%2Fwith%20space", options: {} });
  assert.deepEqual(codexBrowserLoginRequest("cancel", "codex-login-1"), { path: "/api/providers/oauth/codex/login/codex-login-1", options: { method: "DELETE" } });
  assert.throws(() => codexBrowserLoginRequest("status", ""));
  assert.throws(() => codexBrowserLoginRequest("unknown", "id"));

  const official = "https://auth.openai.com/oauth/authorize?client_id=fixture&state=opaque";
  assert.equal(trustedCodexBrowserAuthURL(official), true);
  for (const unsafe of [
    "http://auth.openai.com/oauth/authorize",
    "https://auth.openai.com.evil.test/oauth/authorize",
    "https://user:pass@auth.openai.com/oauth/authorize",
    "https://auth.openai.com/oauth/token",
    "javascript:alert(1)",
  ]) assert.equal(trustedCodexBrowserAuthURL(unsafe), false, unsafe);

  assert.deepEqual(normalizeCodexBrowserLoginStatus({ login_id: " login-1 ", status: "CANCELED", auth_url: official, expires_at: "2026-07-17T12:00:00Z", error: "authorization denied", account: { email: "a@example.test" } }), {
    loginId: "login-1",
    status: "cancelled",
    authUrl: official,
    expiresAt: "2026-07-17T12:00:00Z",
    message: "authorization denied",
    account: { email: "a@example.test" },
  });
});

test("Anthropic account requests follow the independent account API contract", () => {
  assert.deepEqual(anthropicAccountsListRequest(), { path: "/api/providers/auth/anthropic/accounts", options: {} });
  assert.equal(anthropicProfileLoginCommand(" work "), "ant auth login --profile work");
  assert.equal(anthropicProfileLoginCommand(""), "ant auth login --profile <name>");
  assert.equal(anthropicProfileLoginCommand("team'; rm -rf /"), `ant auth login --profile 'team'"'"'; rm -rf /'`);

  const profile = anthropicAccountCreateRequest({ authType: "profile", profile: " work ", alias: " Team ", priority: "7" });
  assert.equal(profile.path, "/api/providers/auth/anthropic/accounts");
  assert.equal(profile.options.method, "POST");
  assert.deepEqual(JSON.parse(profile.options.body), { authType: "profile", profile: "work", alias: "Team", priority: 7 });

  const key = anthropicAccountCreateRequest({ authType: "api_key", apiKey: " sk-ant-secret ", priority: 11 });
  assert.deepEqual(JSON.parse(key.options.body), { authType: "api_key", apiKey: "sk-ant-secret", priority: 11 });
  const form = { elements: { authType: { value: "api_key" }, apiKey: { value: "sk-ant-once" }, alias: { value: "Main" }, priority: { value: "9" } } };
  const consumed = consumeAnthropicAccountCreateRequest(form);
  assert.equal(form.elements.apiKey.value, "", "submitted secrets are removed from the live form immediately");
  assert.deepEqual(JSON.parse(consumed.options.body), { authType: "api_key", apiKey: "sk-ant-once", alias: "Main", priority: 9 });

  const save = anthropicAccountActionRequest("save", "id/with space", { alias: "Primary", priority: 3 });
  assert.equal(save.path, "/api/providers/auth/anthropic/accounts/id%2Fwith%20space");
  assert.equal(save.options.method, "PATCH");
  assert.deepEqual(JSON.parse(save.options.body), { alias: "Primary", priority: 3 });
  assert.deepEqual(anthropicAccountActionRequest("sync", "anthropic_1"), { path: "/api/providers/auth/anthropic/accounts/anthropic_1/sync", options: { method: "POST" } });
  assert.deepEqual(JSON.parse(anthropicAccountActionRequest("toggle", "anthropic_1", { disabled: false }).options.body), { disabled: true });
  assert.equal(anthropicAccountActionRequest("delete", "anthropic_1").options.method, "DELETE");
});

test("Anthropic account table normalizes responses, escapes HTML, and exposes account interactions", () => {
  const accounts = [{
    id: `anthropic"><script>alert(1)</script>`,
    alias: `Main <img src=x onerror=alert(1)>`,
    priority: 4,
    auth_type: "profile",
    profile: `work<&>`,
    source: `cli<script>`,
    configured: true,
    models: ["claude-sonnet", "claude-opus"],
    stats: { success_count: 8, failure_count: 2, last_use_at: "2026-07-15T12:00:00Z" },
  }];
  assert.deepEqual(normalizeAnthropicAccountList({ accounts }), accounts);
  assert.deepEqual(normalizeAnthropicAccountList({ items: accounts }), accounts);
  assert.deepEqual(normalizeAnthropicAccountList(null), []);
  const html = renderAnthropicAccountManagementTable(accounts, { translate });
  assert.match(html, /anthropic-account-table/);
  assert.match(html, /Official profile/);
  assert.match(html, />8<\/span> \/ <span[^>]*>2</);
  assert.match(html, /2 models/);
  assert.match(html, /No quota data available/);
  assert.match(html, /data-anthropic-edit=/);
  assert.match(html, /data-anthropic-sync=/);
  assert.match(html, /data-anthropic-toggle=/);
  assert.match(html, /data-anthropic-delete=/);
  assert.doesNotMatch(html, /<script>|<img /);
  assert.match(html, /&lt;img/);

  const edit = renderAnthropicAccountManagementTable([{ id: "a1", alias: "Main", priority: 4 }], { translate, editing: { id: "a1", alias: "Edited", priority: 6 } });
  assert.match(edit, /data-anthropic-edit-alias="a1"/);
  assert.match(edit, /value="Edited"/);
  assert.match(edit, /data-anthropic-edit-priority="a1"/);
  assert.match(edit, /data-anthropic-save="a1"/);
  assert.match(edit, /data-anthropic-edit-cancel="a1"/);

  const fallback = renderAnthropicAccountManagementTable([{
    id: "configured-fallback",
    alias: "Configured fallback",
    configured: true,
    managed: false,
    auth_type: "api_key",
    source: "server-env",
  }], { translate, editing: { id: "configured-fallback", alias: "Must not edit", priority: 1 } });
  assert.match(fallback, /Existing configuration \/ environment variable/);
  assert.match(fallback, /Read only/);
  assert.doesNotMatch(fallback, /server-env|Must not edit/);
  assert.doesNotMatch(fallback, /data-anthropic-(?:edit|save|sync|toggle|delete)/);
});

test("Anthropic nested rate limits render requests first with token and retry metadata", () => {
  const html = renderAnthropicAccountManagementTable([{
    id: "limited",
    configured: true,
    rate_limit: {
      requests: { limit: 100, remaining: 0, reset: "2026-07-16T13:00:00Z" },
      input_tokens: { limit: 10000, remaining: 7500 },
      output_tokens: { limit: 5000, remaining: 4000 },
      retry_after: 30,
      fetched_at: "2026-07-16T12:00:00Z",
    },
  }], { translate });
  assert.match(html, />Rate limited<\/span>/);
  assert.match(html, />Requests<\/strong>/);
  assert.match(html, /Remaining: 0/);
  assert.match(html, /Limit: 100/);
  assert.match(html, />Input tokens<\/strong>/);
  assert.match(html, />Output tokens<\/strong>/);
  assert.match(html, /Retry after 30s/);
  assert.match(html, /Fetched/);
  assert.doesNotMatch(html, /No quota data available/);
});

test("Anthropic status and overview distinguish disabled, limited, unconfigured, and available accounts", () => {
  assert.equal(anthropicAccountStatus({ disabled: true }).key, "disabled");
  assert.equal(anthropicAccountStatus({ rate_limit: { remaining: 50, requests: { remaining: 0 } } }).key, "rateLimited");
  assert.equal(anthropicAccountStatus({ rate_limit: { limited: true, requests: { remaining: 2 } } }).key, "available");
  assert.equal(anthropicAccountStatus({ configured: false }).key, "unconfigured");
  assert.equal(anthropicAccountStatus({ configured: true }).key, "available");
  assert.deepEqual(anthropicAccountOverview([
    { configured: true },
    { rate_limit: { limited: true } },
    { disabled: true },
  ]), { total: 3, available: 1, rateLimited: 1, disabled: 1 });
});

test("modelProvider translation keys stay aligned across all three locales", () => {
  const keys = (value, prefix = "") => Object.entries(value || {}).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === "object" && !Array.isArray(item) ? keys(item, path) : [path];
  }).sort();
  const expected = keys(messagesZhCN.modelProvider);
  assert.deepEqual(keys(messagesZhTW.modelProvider), expected);
  assert.deepEqual(keys(messagesEN.modelProvider), expected);
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

test("模型发现去重并自动选择首个可用模型", () => {
  assert.deepEqual(providerModelDiscovery({ models: [" model-b ", "model-a", "model-b", ""] }, "missing"), {
    models: ["model-b", "model-a"],
    selectedModel: "model-b",
  });
  assert.deepEqual(providerModelDiscovery({ models: ["model-b", "model-a"] }, "model-a"), {
    models: ["model-b", "model-a"],
    selectedModel: "model-a",
  });
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

test("供应商控制台总览合并数据，并在卡片上提供启停与自建供应商删除入口", () => {
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
  assert.match(html, /mp-provider-card settings-card is-disabled is-custom/);
  assert.match(html, /data-disabled="true"/);
  assert.match(html, /data-mp-category-section="custom"[\s\S]*data-mp-provider-card="offline-gateway"/);
  const builtinCard = html.match(/<article[^>]*data-mp-provider-card="openai"[\s\S]*?<\/article>/)?.[0] || "";
  const customCard = html.match(/<article[^>]*data-mp-provider-card="offline-gateway"[\s\S]*?<\/article>/)?.[0] || "";
  assert.match(builtinCard, /data-mp-provider-toggle="openai"/);
  assert.match(builtinCard, /role="switch" aria-checked="true"/);
  assert.doesNotMatch(builtinCard, /data-mp-delete-provider/);
  assert.match(customCard, /data-mp-provider-toggle="offline-gateway"/);
  assert.match(customCard, /role="switch" aria-checked="false"/);
  assert.match(customCard, /data-mp-provider-open="offline-gateway"/);
  assert.match(customCard, /data-mp-delete-provider="offline-gateway"/);
  assert.match(customCard, /编辑供应商/);
  for (const className of ["settings-page-section", "settings-card", "settings-card-header", "settings-card-content", "settings-toolbar", "settings-stat-grid", "settings-stat-card", "settings-form-field", "settings-inline-actions", "settings-badge"]) {
    assert.match(html, new RegExp(className));
  }
});

test("已获取模型在 Provider 页面可见并进入全局模型选择器", () => {
  const providers = modelProvidersForUIUnion(
    [],
    [{
      name: "relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example/v1",
      defaultModel: "terra-a",
      models: ["terra-a", "terra-b"],
      modelsSource: "remote",
      discovered: true,
      available: false,
      configured: false,
      enabled: true,
      origin: "custom",
    }],
  );
  const html = renderProviderConsolePage({
    providers,
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: providers[0] },
  });
  assert.match(html, /mp-provider-create-page mp-provider-create-form/);
  assert.match(html, /mp-provider-edit-page/);
  assert.match(html, /list="mp-provider-create-model-options"/);
  assert.match(html, /<option value="terra-a"><\/option>/);
  assert.match(html, /<option value="terra-b"><\/option>/);
  assert.match(html, /data-mp-model-choice/);
  assert.match(html, /value="terra-a"/);
  assert.doesNotMatch(html, /data-mp-provider-card="relay"|mp-provider-drawer-backdrop/);

  const controller = createModelProviderSettingsController({
    state: {
      settings: { providers: [] },
      modelCatalog: { providers },
      agent: { model: "" },
    },
  });
  const options = controller.renderAgentModelOptions("");
  assert.match(options, /relay:terra-a/);
  assert.match(options, /relay:terra-b/);
  assert.match(options, /未配置|unconfigured/i);
});

test("未发现的未配置默认模型不会进入全局模型选择器", () => {
  const controller = createModelProviderSettingsController({
    state: {
      settings: { providers: [] },
      modelCatalog: {
        providers: [{
          name: "relay",
          type: "openai-compatible",
          defaultModel: "fallback-model",
          models: ["fallback-model"],
          modelsSource: "configured-default",
          discovered: false,
          configured: false,
          enabled: true,
        }],
      },
      agent: { model: "" },
    },
  });
  const options = controller.renderAgentModelOptions("");
  assert.doesNotMatch(options, /relay:fallback-model/);
});

test("供应商控制台按分类和搜索过滤，并保留兼容 relay 入口", () => {
  const providers = modelProvidersForUIUnion([
    { name: "codex", type: "codex", enabled: true, origin: "builtin", model: "gpt-5.5" },
    { name: "groq", type: "openai-compatible", enabled: true, origin: "custom", baseUrl: "https://api.groq.example/v1", model: "llama" },
    { name: "acme", type: "anthropic", enabled: false, origin: "custom", baseUrl: "https://acme.example", model: "claude" },
  ], []);
  assert.deepEqual(filterConsoleProviders(providers, { category: "official" }).map((provider) => provider.name), ["codex"]);
  assert.deepEqual(filterConsoleProviders(providers, { category: "custom" }).map((provider) => provider.name), ["groq", "acme"]);
  assert.deepEqual(filterConsoleProviders(providers, { category: "compatible" }).map((provider) => provider.name), []);
  assert.deepEqual(filterConsoleProviders(providers, { search: "acme" }).map((provider) => provider.name), ["acme"]);
  assert.deepEqual(filterConsoleProviders(providers, { search: "groq.example" }).map((provider) => provider.name), ["groq"]);

  const html = renderProviderConsolePage({ providers, consoleState: { category: "compatible" } });
  assert.match(html, /mp-category-tabs/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /role="tab"|aria-controls="mp-provider-panel-/);
  assert.match(html, /mp-provider-section/);
  assert.match(html, /data-mp-open-relay/);
});

test("供应商控制台移除类型选择弹窗并让普通编辑使用全页配置", () => {
  const providers = modelProvidersForUIUnion([{ name: "groq", type: "openai-compatible", origin: "custom", enabled: true, model: "llama", models: ["llama"], baseUrl: "https://api.groq.example/v1" }], []);
  const list = renderProviderConsolePage({ providers, consoleState: { modal: "types" } });
  assert.match(list, /data-mp-open-types/);
  assert.doesNotMatch(list, /mp-provider-type-modal|mp-provider-type-grid|data-mp-select-type/);

  const editPage = renderProviderConsolePage({
    providers,
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: providers[0] },
  });
  assert.match(editPage, /mp-provider-page mp-provider-create-page mp-provider-create-form/);
  assert.match(editPage, /mp-provider-edit-page/);
  assert.match(editPage, /编辑供应商/);
  assert.match(editPage, /name="name"[^>]*value="groq"[^>]*required/);
  assert.doesNotMatch(editPage, /name="name"[^>]*readonly/);
  assert.match(editPage, /name="baseUrl"[^>]*type="url"/);
  assert.doesNotMatch(editPage, /name="baseUrl"[^>]*readonly/);
  assert.match(editPage, /data-mp-fetch-models/);
  assert.match(editPage, /list="mp-provider-create-model-options"/);
  assert.match(editPage, /<option value="llama"><\/option>/);
  assert.match(editPage, /data-mp-test-provider/);
  assert.match(editPage, /发送测试/);
  assert.match(editPage, /data-mp-save-provider/);
  assert.match(editPage, /data-mp-delete-provider="groq"/);
  assert.match(editPage, /aria-describedby="mp-provider-create-description"/);
  assert.match(editPage, /aria-busy="false"/);
  assert.match(editPage, /留空会保留已保存的 Key/);
  assert.doesNotMatch(editPage, /mp-provider-drawer-backdrop|mp-provider-type-modal|data-mp-provider-card="groq"/);

  const testPage = renderProviderConsolePage({
    providers,
    consoleState: {
      drawer: "provider",
      mode: "edit",
      type: "openai-compatible",
      draft: providers[0],
      testOpen: true,
      test: { prompt: "reply", result: { success: true, tone: "success", output: "ok", message: "测试成功" } },
    },
  });
  assert.match(testPage, /mp-provider-test-dialog/);
  assert.match(testPage, /data-mp-test-prompt/);
  assert.match(testPage, /data-mp-send-test/);
  assert.match(testPage, /<pre>ok<\/pre>/);
});

test("新增供应商入口默认直接建立 custom-openai 全页草稿", () => {
  const state = { settings: { providers: [] }, modelCatalog: { providers: [] } };
  let refreshes = 0;
  const controller = createModelProviderSettingsController({
    state,
    refreshActiveSettingsPanel() { refreshes += 1; },
  });
  controller.openProviderConsoleType();
  assert.equal(state.providerConsole.modal, "");
  assert.equal(state.providerConsole.drawer, "provider");
  assert.equal(state.providerConsole.mode, "create");
  assert.equal(state.providerConsole.type, "openai-compatible");
  assert.equal(state.providerConsole.providerName, "custom-openai");
  assert.equal(state.providerConsole.draft.name, "custom-openai");
  assert.equal(state.providerConsole.draft.baseUrl, "https://api.example.com/v1");
  assert.equal(refreshes, 1);
  const html = controller.renderProviderSettingsContent();
  assert.match(html, /mp-provider-create-page/);
  assert.match(html, /name="name" value=""[^>]*placeholder="custom-openai"/);
  assert.match(html, /name="baseUrl"[^>]*value=""[^>]*placeholder="https:\/\/api\.example\.com\/v1"/);
  assert.doesNotMatch(html, /mp-provider-type-modal|data-mp-select-type/);
});

test("供应商控制台重绘保持状态对象身份，异步模型发现结果不会丢失", () => {
  const retainedTestState = { prompt: "", result: null };
  const state = {
    settings: { providers: [] },
    modelCatalog: { providers: [] },
    providerConsole: {
      drawer: "provider",
      mode: "create",
      type: "openai-compatible",
      providerName: "zzz",
      dirty: true,
      busy: {},
      test: retainedTestState,
      draft: {
        ...createProviderDraft("openai-compatible"),
        name: "zzz",
        baseUrl: "https://relay.example/v1",
        model: "your-model",
        apiKeyOptional: true,
      },
    },
  };
  const retainedConsoleState = state.providerConsole;
  const controller = createModelProviderSettingsController({ state });

  controller.renderProviderSettingsContent();
  assert.equal(state.providerConsole, retainedConsoleState);
  assert.equal(state.providerConsole.test, retainedTestState);

  const discoveredModels = ["codex-auto-review", "model-b", "model-c", "model-d", "model-e", "model-f", "model-g"];
  retainedConsoleState.draft = {
    ...retainedConsoleState.draft,
    models: discoveredModels,
    model: discoveredModels[0],
  };
  const html = controller.renderProviderSettingsContent();

  assert.equal(state.providerConsole, retainedConsoleState);
  assert.match(html, /name="model"[^>]*value="codex-auto-review"/);
  assert.match(html, /<option value="codex-auto-review" selected>/);
  assert.match(html, /<option value="model-g"><\/option>/);
  assert.match(html, /value="zzz:codex-auto-review"/);
});

test("新增普通供应商使用独立全宽扁平配置页", () => {
  const providers = modelProvidersForUIUnion([{ name: "existing", type: "openai-compatible", origin: "custom", enabled: true, model: "old-model", baseUrl: "https://old.example/v1" }], []);
  const html = renderProviderConsolePage({
    providers,
    consoleState: {
      drawer: "provider",
      mode: "create",
      type: "openai-compatible",
      draft: {
        name: "new-gateway",
        type: "openai-compatible",
        apiKey: "sk-local-draft",
        baseUrl: "https://new.example/v1",
        model: "model-a",
        models: ["model-a", "model-b"],
        maxTokens: 4096,
        apiKeyOptional: false,
      },
    },
  });
  assert.match(html, /mp-provider-page mp-provider-create-page mp-provider-create-form/);
  assert.match(html, /data-mp-provider-form/);
  assert.match(html, /data-mp-close-drawer/);
  assert.match(html, /返回供应商列表/);
  assert.match(html, /连接与凭据/);
  assert.match(html, /mp-provider-create-protocol-options/);
  assert.match(html, /type="radio" name="type" value="openai-compatible" checked/);
  assert.match(html, /name="apiKeyOptional" type="checkbox"/);
  assert.match(html, /data-mp-test-provider/);
  assert.match(html, /data-mp-fetch-models/);
  assert.match(html, /data-mp-save-provider/);
  assert.match(html, /放弃更改/);
  assert.match(html, /list="mp-provider-create-model-options"/);
  assert.match(html, /<option value="model-b"><\/option>/);
  assert.match(html, /value="new-gateway:model-a" readonly data-mp-model-example/);
  assert.doesNotMatch(html, /data-mp-provider-card="existing"/);
  assert.doesNotMatch(html, /mp-provider-drawer-backdrop|mp-provider-type-modal/);
});

test("Provider API Key 元数据安全规范化、掩码渲染和草稿隔离", () => {
  const input = {
    name: "safe-provider",
    type: "openai-compatible",
    apiKey: "sk-full-secret-must-not-escape",
    apiKeyConfigured: true,
    apiKeyPersisted: true,
    apiKeyLastFive: `abc<&\"`,
    apiKeySource: "stored",
    model: "model-a",
  };
  const normalized = normalizeConsoleProvider(input);
  assert.equal(Object.hasOwn(normalized, "apiKey"), false);
  assert.deepEqual({
    apiKeyConfigured: normalized.apiKeyConfigured,
    apiKeyPersisted: normalized.apiKeyPersisted,
    apiKeyLastFive: normalized.apiKeyLastFive,
    apiKeySource: normalized.apiKeySource,
  }, { apiKeyConfigured: true, apiKeyPersisted: true, apiKeyLastFive: "bc<&\"", apiKeySource: "stored" });
  const union = modelProvidersForUIUnion([input], [{ ...input, models: ["model-a"] }]);
  assert.equal(Object.hasOwn(union[0], "apiKey"), false);
  assert.deepEqual({ apiKeyConfigured: union[0].apiKeyConfigured, apiKeyPersisted: union[0].apiKeyPersisted, apiKeyLastFive: union[0].apiKeyLastFive, apiKeySource: union[0].apiKeySource }, { apiKeyConfigured: true, apiKeyPersisted: true, apiKeyLastFive: "bc<&\"", apiKeySource: "stored" });
  const draft = createProviderDraft("openai-compatible", { ...union[0], apiKey: input.apiKey });
  assert.equal(draft.apiKey, "", "saved provider metadata never seeds a complete API key");
  assert.deepEqual({ apiKeyConfigured: draft.apiKeyConfigured, apiKeyPersisted: draft.apiKeyPersisted, apiKeyLastFive: draft.apiKeyLastFive, apiKeySource: draft.apiKeySource }, { apiKeyConfigured: true, apiKeyPersisted: true, apiKeyLastFive: "bc<&\"", apiKeySource: "stored" });

  const html = renderProviderConsolePage({
    providers: union,
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: { ...union[0], apiKeyDraft: true, apiKey: input.apiKey } },
  });
  assert.match(html, /已加密保存，末 5 位：bc&lt;&amp;&quot;/);
  assert.doesNotMatch(html, /sk-full-secret-must-not-escape/);
  assert.match(html, /name="apiKey" type="password" value=""/);
  assert.match(html, /name="clearApiKey" type="checkbox"/);

  const payload = providerConfigPayload({ ...union[0], apiKey: "", model: "model-a" });
  assert.equal(payload.apiKey, "");
  assert.equal(Object.hasOwn(payload, "clearApiKey"), false);
  const clearPayload = providerConfigPayload({ ...union[0], apiKey: "sk-should-never-coexist", clearApiKey: true });
  assert.deepEqual({ apiKey: clearPayload.apiKey, clearApiKey: clearPayload.clearApiKey }, { apiKey: "", clearApiKey: true });
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
  const toggleWithoutModel = providerConsoleRequest("toggle", { name: "empty-provider" }, { enabled: false });
  assert.deepEqual(JSON.parse(toggleWithoutModel.options.body), { enabled: false });

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

  const messagePayload = providerMessageTestPayload(draft, provider, "reply with ok");
  assert.equal(messagePayload.prompt, "reply with ok");
  assert.equal(Object.hasOwn(messagePayload, "origin"), false);
  const messageTest = providerConsoleRequest("message-test", provider, { ...draft, prompt: "reply with ok" });
  assert.equal(messageTest.path, "/api/providers/test-message");
  assert.equal(messageTest.options.method, "POST");
  assert.deepEqual(JSON.parse(messageTest.options.body), messagePayload);

  const remove = providerConsoleRequest("delete", provider);
  assert.deepEqual(remove, { path: "/api/providers/custom%2Fname%20space", options: { method: "DELETE" } });

  const config = providerConsoleRequest("config", provider, { name: provider.name, type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "", model: "model-a" });
  assert.equal(config.path, "/api/providers/custom%2Fname%20space/config");
  assert.equal(config.options.method, "PUT");
  assert.equal(JSON.parse(config.options.body).apiKey, "");

  const renameConfig = providerConsoleRequest("config", { name: "old-name" }, { name: "new-name", pathName: "old-name", type: "openai-compatible", baseUrl: "https://example.test/v1", model: "model-a" });
  assert.equal(renameConfig.path, "/api/providers/old-name/config");
  assert.equal(JSON.parse(renameConfig.options.body).name, "new-name");
  const renameToggle = providerConsoleRequest("toggle", { name: "new-name" }, { name: "new-name", enabled: true, model: "model-a" });
  assert.equal(renameToggle.path, "/api/providers/new-name");
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
    apiKeyDraft: true,
    clearApiKey: false,
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
  assert.match(refreshedRender, /name="apiKey" type="password" value=""/);
  assert.doesNotMatch(refreshedRender, /draft-key/);
  assert.equal(state.providerConsole.dirty, true);
  assert.equal(state.providerConsole.draft.apiKey, "draft-key");
});

test("模型选择器更新 draft 后会在重绘中保持选中模型和引用", () => {
  const form = {
    elements: {
      name: { value: "relay" },
      type: { value: "openai-compatible" },
      baseUrl: { value: "https://relay.example/v1" },
      apiKey: { value: "" },
      model: { value: "model-b" },
      maxTokens: { value: "0" },
      apiKeyOptional: { checked: true },
    },
  };
  const consoleState = { type: "openai-compatible", draft: { name: "relay", models: ["model-a", "model-b"], model: "model-a" } };
  syncProviderConsoleDraft(consoleState, form);
  assert.equal(consoleState.draft.model, "model-b");
  const html = renderProviderConsolePage({
    providers: [{ name: "relay", type: "openai-compatible", model: "model-b", models: ["model-a", "model-b"], baseUrl: "https://relay.example/v1", configured: true, enabled: true, origin: "custom" }],
    consoleState: { drawer: "provider", mode: "edit", type: "openai-compatible", draft: consoleState.draft },
  });
  assert.match(html, /<option value="model-b" selected>/);
  assert.match(html, /value="relay:model-b"/);
});

test("模型可见性偏好通过注入 getter 隐藏模型且不依赖全局 localStorage", () => {
  const previousStorage = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    const controller = createModelProviderSettingsController({
      state: {
        settings: { providers: [{ name: "openai", type: "openai", model: "gpt-5", configured: true, enabled: true }] },
        modelCatalog: { providers: [{ name: "openai", type: "openai", configured: true, enabled: true, models: ["gpt-5", "gpt-4.1-mini"] }] },
        agent: { model: "openai:gpt-5" },
      },
      getModelVisibilityPreference: () => ({ hiddenModels: { "openai:gpt-4.1-mini": true }, showUnconfiguredProviders: false }),
    });
    const html = controller.renderModelSettingsContent();
    assert.match(html, /data-toggle-model-visibility="openai:gpt-4\.1-mini"/);
    assert.match(html, /data-model-visibility-state="hidden"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /显示这个模型/);
    assert.doesNotMatch(controller.renderAgentModelOptions(""), /openai:gpt-4\.1-mini/);
    assert.match(controller.renderAgentModelOptions(""), /openai:gpt-5/);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test("首选模型通过注入 getter 和乐观 setter 且不依赖全局 localStorage", () => {
  const previousStorage = globalThis.localStorage;
  delete globalThis.localStorage;
  const saved = [];
  try {
    const controller = createModelProviderSettingsController({
      state: {},
      getPreferredModelPreference: () => saved.at(-1) || "openai:gpt-server",
      setPreferredModelPreference: (value) => saved.push(value),
    });
    assert.equal(controller.getPreferredModel(), "openai:gpt-server");
    assert.equal(controller.setPreferredModel("anthropic:claude"), "anthropic:claude");
    assert.equal(saved.at(-1), "anthropic:claude");
    assert.equal(controller.getPreferredModel(), "anthropic:claude");
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test("Agent 模型设置规范化角色路由并生成后端 payload", () => {
  assert.deepEqual(agentModelRoles, ["explore", "plan", "general", "search"]);
  assert.equal(isAgentModelReference("codex:gpt-5.5"), true);
  assert.equal(isAgentModelReference("missing-colon"), false);
  assert.equal(isAgentModelReference("openai:"), false);
  const normalized = normalizeAgentModelSettings({
    defaultModel: " codex:gpt-5.5 ",
    summaryModel: "",
    defaultReasoningEffort: "HIGH",
    subagentModels: { explore: " openai:gpt-4.1-mini ", unknown: "ignored:model" },
    subagentModelPools: { explore: ["codex:gpt-5.5", "codex:gpt-5.5", " openai:gpt-4.1-mini "], unknown: ["ignored:model"] },
  });
  assert.deepEqual(normalized, {
    defaultModel: "codex:gpt-5.5",
    summaryModel: "codex:gpt-5.5",
    defaultReasoningEffort: "high",
    subagentModels: { explore: "openai:gpt-4.1-mini" },
    subagentModelPools: { explore: ["codex:gpt-5.5", "openai:gpt-4.1-mini"] },
  });
  assert.deepEqual(agentModelSettingsPayload({
    ...normalized,
    subagentModels: { ...normalized.subagentModels, plan: "anthropic:claude-sonnet" },
    subagentModelPools: { ...normalized.subagentModelPools, plan: ["codex:gpt-5.5"] },
  }), {
    defaultModel: "codex:gpt-5.5",
    summaryModel: "codex:gpt-5.5",
    subagentModels: { explore: "openai:gpt-4.1-mini", plan: "anthropic:claude-sonnet" },
    subagentModelPools: {
      explore: ["codex:gpt-5.5", "openai:gpt-4.1-mini"],
      plan: ["anthropic:claude-sonnet", "codex:gpt-5.5"],
    },
  });
});

test("模型聚合与默认推理强度请求遵循后端契约", () => {
  assert.deepEqual(modelAggregateMembers(" openai:gpt-5\n\ncodex:gpt-5.5 \n"), ["openai:gpt-5", "codex:gpt-5.5"]);
  assert.deepEqual(normalizeModelAggregateList({ aggregates: [{ name: "primary", mode: "priority", members: ["openai:gpt-5"], revision: 3 }] }), [{
    id: "",
    name: "primary",
    mode: "priority",
    members: ["openai:gpt-5"],
    revision: 3,
    updatedAt: "",
  }]);
  const save = modelAggregateActionRequest("save", {}, { name: "primary/fallback", members: "openai:gpt-5\ncodex:gpt-5.5", revision: 0 });
  assert.equal(save.path, "/api/model-aggregates/primary%2Ffallback");
  assert.equal(save.options.method, "PUT");
  assert.deepEqual(JSON.parse(save.options.body), { mode: "priority", members: ["openai:gpt-5", "codex:gpt-5.5"], revision: 0 });
  const remove = modelAggregateActionRequest("delete", { name: "primary", revision: 4 });
  assert.deepEqual(JSON.parse(remove.options.body), { revision: 4 });
  const reasoning = runtimeReasoningSettingsRequest("HIGH", { revision: 7 });
  assert.equal(reasoning.path, "/api/runtime/model-settings");
  assert.equal(reasoning.options.method, "PATCH");
  assert.deepEqual(JSON.parse(reasoning.options.body), { defaultReasoningEffort: "high", revision: 7 });
});

test("模型设置页面使用一屏扁平路由表单、聚合管理与已展开模型目录", () => {
  const controller = createModelProviderSettingsController({
    state: {
      settings: {
        agent: {
          defaultModel: "openai:gpt-5",
          summaryModel: "openai:gpt-4.1-mini",
          subagentModels: { explore: "openai:gpt-4.1-mini" },
          subagentModelPools: { explore: ["openai:gpt-4.1-mini", "openai:gpt-5"] },
        },
        runtimeSettings: { defaultReasoningEffort: "high", revision: 3 },
        providers: [{ name: "openai", type: "openai", origin: "builtin", enabled: true, configured: true, model: "gpt-5" }],
      },
      modelCatalog: { providers: [{ name: "openai", type: "openai", configured: true, models: ["gpt-5", "gpt-4.1-mini"] }] },
      modelAggregatesLoaded: true,
      modelAggregates: [{ name: "primary", mode: "priority", members: ["openai:gpt-5", "openai:gpt-4.1-mini"], revision: 2 }],
      agent: { model: "openai:gpt-5" },
    },
  });
  const html = controller.renderModelSettingsContent();
  for (const className of ["compact-settings-page", "compact-settings-header", "compact-settings-section", "compact-settings-form", "compact-settings-grid", "compact-settings-footer", "compact-settings-disclosure", "settings-inline-actions", "settings-badge"]) {
    assert.match(html, new RegExp(className));
  }
  assert.doesNotMatch(html, /settings-stat-grid|settings-stat-card/);
  assert.match(html, /id="settingsRefreshModelsBtn"/);
  assert.match(html, /id="agentModelSettingsForm"/);
  assert.match(html, /name="defaultModel" required/);
  assert.match(html, /name="summaryModel" required/);
  assert.match(html, /name="defaultReasoningEffort"[^>]*>[\s\S]*?<option value="high" selected>/);
  assert.match(html, /name="subagentModel_explore"/);
  assert.match(html, /<details class="compact-multi-select agent-model-pool-details" data-agent-model-pool-details="explore">/);
  assert.match(html, /data-agent-model-pool-summary="explore"/);
  assert.match(html, /data-agent-model-pool-option="explore"/);
  assert.match(html, /data-model-aggregate-add/);
  assert.match(html, /<option value="aggregate:primary"/);
  assert.match(html, /aggregate:primary/);
  assert.match(html, /<details class="compact-settings-disclosure agent-model-catalog-details" open>/);
  assert.match(html, /已加载 2 个模型/);
  assert.match(html, /agent-model-catalog-provider/);
  assert.match(html, /agent-model-catalog-item settings-model-row/);
  assert.match(html, /id="saveAgentModelSettingsBtn"/);
  assert.match(html, /data-apply-model="openai:gpt-5"/);
  assert.match(html, /data-toggle-model-visibility="openai:gpt-5"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /<svg viewBox="0 0 24 24"/);
  assert.match(html, /settings-model-row settings-card active/);
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

test("供应商配置的通用聚焦辅助仅对显式标记字段生效", () => {
  const field = {
    value: "https://api.example.com/v1",
    type: "url",
    disabled: false,
    readOnly: false,
    dataset: { selectOnFocus: "true" },
    selected: 0,
    removeAttribute(name) {
      if (name === "data-select-on-focus") delete this.dataset.selectOnFocus;
    },
    select() { this.selected += 1; },
  };
  assert.equal(selectProviderConsoleFieldOnFocus(field), true);
  assert.equal(field.selected, 1);
  assert.equal(field.dataset.selectOnFocus, undefined);
  assert.equal(selectProviderConsoleFieldOnFocus(field), false);
  assert.equal(field.selected, 1);

  const empty = {
    value: "",
    type: "text",
    disabled: false,
    readOnly: false,
    dataset: { selectOnFocus: "true" },
    removeAttribute(name) {
      if (name === "data-select-on-focus") delete this.dataset.selectOnFocus;
    },
    select() { throw new Error("empty fields should not be selected"); },
  };
  assert.equal(selectProviderConsoleFieldOnFocus(empty), false);
  assert.equal(empty.dataset.selectOnFocus, undefined);

  const password = {
    value: "secret",
    type: "password",
    disabled: false,
    readOnly: false,
    dataset: { selectOnFocus: "true" },
    removeAttribute(name) {
      if (name === "data-select-on-focus") delete this.dataset.selectOnFocus;
    },
    select() { throw new Error("password fields should keep normal editing"); },
  };
  assert.equal(selectProviderConsoleFieldOnFocus(password), false);
});

test("供应商新增表单使用 placeholder 示例且名称和 Base URL 不自动全选", () => {
  const html = renderProviderConsolePage({
    providers: [],
    consoleState: { drawer: "provider", mode: "create", type: "openai-compatible", draft: createProviderDraft("openai-compatible") },
  });
  assert.match(html, /name="name" value=""[^>]*placeholder="custom-openai"/);
  assert.match(html, /name="baseUrl"[^>]*value=""[^>]*placeholder="https:\/\/api\.example\.com\/v1"/);
  assert.doesNotMatch(html, /name="name"[^>]*data-select-on-focus="true"/);
  assert.doesNotMatch(html, /name="baseUrl"[^>]*data-select-on-focus="true"/);
  for (const field of ["model", "maxTokens"]) {
    assert.match(html, new RegExp(`name="${field}"[^>]*data-select-on-focus="true"`));
  }
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
  const englishCreate = renderProviderConsolePage({ providers, consoleState: { drawer: "provider", mode: "create", type: "openai-compatible", draft: createProviderDraft("openai-compatible") } });
  assert.match(english, /Edit provider|Back to providers|Connection and credential/);
  assert.match(englishCreate, /Back to providers|Connection and credential|Discard changes/);
  assert.doesNotMatch(`${english}${englishCreate}`, /供应商|连接|配置|当前|保存|删除/);
  setUILocale("zh-TW", root);
  const traditional = renderProviderConsolePage({ providers, consoleState: { modal: "types" } });
  const traditionalCreate = renderProviderConsolePage({ providers, consoleState: { drawer: "provider", mode: "create", type: "openai-compatible", draft: createProviderDraft("openai-compatible") } });
  assert.match(traditional, /模型供應商|新增供應商/);
  assert.doesNotMatch(traditional, /選擇連線類型|mp-provider-type-modal/);
  assert.match(traditionalCreate, /返回供應商清單|連線與憑據|放棄變更/);
  assert.doesNotMatch(`${traditional}${traditionalCreate}`, /供应商|连接|配置|当前|保存|删除/);
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

test("Codex 控制台使用独立账号页并让凭证导入区常开", () => {
  const state = {
    settings: { providers: [{ name: "codex", type: "codex", origin: "builtin", enabled: true, model: "gpt-5.5" }] },
    modelCatalog: { providers: [{ name: "codex", type: "codex", configured: true, models: ["gpt-5.5"] }] },
    providerAuthFiles: [{ id: "account-1", alias: "Main", quota: { primary_window: { used_percent: 10, limit_window_seconds: 3600 } } }],
    providerAuthLoading: false,
    codexAccountBusy: {},
    providerConsole: {
      view: "codex",
      mode: "codex",
      type: "codex",
      draft: createProviderDraft("codex"),
      codexImportOpen: false,
      codexImportDraft: `</textarea><script>alert(1)</script>`,
    },
  };
  const controller = createModelProviderSettingsController({ state });
  const html = controller.renderProviderSettingsContent();
  assert.match(html, /codex-account-console/);
  assert.match(html, /data-mp-close-codex-page/);
  assert.match(html, /codex-browser-login-panel/);
  assert.match(html, /data-mp-codex-browser-login/);
  assert.match(html, /浏览器登录/);
  assert.match(html, /手动导入 JSON \/ Token/);
  assert.match(html, /codexAuthImportText/);
  assert.match(html, /data-mp-codex-import/);
  assert.match(html, /codex-account-table/);
  assert.match(html, /data-codex-export="account-1"/);
  assert.doesNotMatch(html, /codex-credits-summary|Credits|Unlimited/);
  assert.equal((html.match(/id="codexCredentialImportSection"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-mp-codex-toggle-import/);
  assert.doesNotMatch(html, /mp-provider-drawer/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);

  state.providerConsole.codexBrowserLogin = {
    seq: 1,
    loginId: "login-1",
    status: "pending",
    authUrl: "https://auth.openai.com/oauth/authorize?state=opaque",
    expiresAt: "2026-07-17T21:00:00Z",
    popupBlocked: true,
  };
  const pending = controller.renderProviderSettingsContent();
  assert.match(pending, /等待浏览器授权/);
  assert.match(pending, /data-mp-codex-browser-open/);
  assert.match(pending, /data-mp-codex-browser-cancel/);
  assert.match(pending, /登录窗口可能被浏览器拦截/);
  assert.doesNotMatch(pending, /data-mp-codex-browser-login/);

  state.runtimeSummary = { security: { currentRequestRemote: true, remoteAccessRequired: true } };
  state.providerConsole.codexBrowserLogin = { seq: 2, status: "idle" };
  const remote = controller.renderProviderSettingsContent();
  assert.match(remote, /浏览器登录只能在运行 Autoto 的本机完成/);
  assert.match(remote, /data-mp-codex-browser-login disabled/);
});

test("Anthropic 内置卡片使用独立账号页并保留模型配置", () => {
  assert.equal(isAnthropicAccountProvider({ name: "anthropic", type: "anthropic", origin: "builtin" }), true);
  assert.equal(isAnthropicAccountProvider({ name: "custom-anthropic", type: "anthropic", origin: "custom" }), false);
  assert.equal(isAnthropicAccountProvider({ name: "legacy-custom", type: "anthropic", origin: "unknown" }), false);
  const state = {
    settings: { providers: [{ name: "anthropic", type: "anthropic", origin: "builtin", enabled: true, configured: true, model: "claude-sonnet-4-5", baseUrl: "", maxTokens: 4096 }] },
    modelCatalog: { providers: [{ name: "anthropic", type: "anthropic", configured: true, models: ["claude-sonnet-4-5", "claude-opus-4"] }] },
    anthropicAccounts: { accounts: [{
      id: "anthropic-1",
      alias: `Team <script>alert(1)</script>`,
      authType: "api_key",
      priority: 5,
      configured: true,
      stats: { successCount: 3, failureCount: 1 },
    }] },
    anthropicAccountsLoading: false,
    anthropicAccountBusy: { "anthropic-1": true },
    providerConsole: {
      view: "anthropic",
      mode: "anthropic",
      type: "anthropic",
      providerName: "anthropic",
      anthropicAddMode: "profile",
      anthropicProfile: `work</code><script>alert(2)</script>`,
      anthropicAlias: `Alias"><img src=x>`,
      anthropicPriority: 8,
      anthropicApiKey: "sk-ant-must-not-render",
      draft: createProviderDraft("anthropic", { name: "anthropic", type: "anthropic", model: "claude-sonnet-4-5", models: ["claude-sonnet-4-5"], configured: true }),
    },
  };
  const controller = createModelProviderSettingsController({ state });
  const html = controller.renderProviderSettingsContent();
  assert.match(html, /anthropic-account-console/);
  assert.match(html, /data-mp-close-anthropic-page/);
  assert.match(html, /data-anthropic-account-form/);
  assert.match(html, /ant auth login --profile 'work&lt;\/code&gt;&lt;script&gt;/);
  assert.match(html, /data-anthropic-copy-command=/);
  assert.match(html, /anthropic-account-table/);
  assert.match(html, /data-anthropic-provider-config/);
  assert.match(html, /name="model"/);
  assert.match(html, /name="baseUrl"/);
  assert.match(html, /name="maxTokens"/);
  assert.doesNotMatch(html, /name="apiKeyOptional" checked/);
  assert.match(html, /data-mp-fetch-models/);
  assert.match(html, /data-mp-refresh-models/);
  assert.doesNotMatch(html, /mp-provider-drawer/);
  assert.doesNotMatch(html, /<script>|<img /);
  assert.doesNotMatch(html, /sk-ant-must-not-render/);

  state.providerConsole.anthropicAddMode = "api_key";
  const apiKeyMode = controller.renderProviderSettingsContent();
  assert.match(apiKeyMode, /name="apiKey" type="password" value=""/);
  assert.doesNotMatch(apiKeyMode, /sk-ant-must-not-render/);
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
