import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { relayProtocolPrefsKey } from "./preferences-data.mjs";
import { api, apiDownload } from "./runtime.mjs";
import { formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";
import { t } from "./i18n.mjs";
import { remoteAccessContext } from "./remote-access-capabilities.mjs";
import {
  createProviderDraft,
  isAnthropicAccountProvider,
  isBuiltinProvider,
  isProviderDeletable,
  modelProvidersForUIUnion,
  normalizeConsoleProvider,
  providerConfigPayload,
  providerConsoleRequest,
  renderProviderConsolePage,
} from "./model-provider-components.mjs?v=provider-card-clean-3-provider-create-page-2-provider-secrets-1-model-picker-1-provider-full-page-2-provider-placeholders-1";

const providerConsoleInteractiveSelector = "button, input, select, textarea, a, details, summary, [role=\"switch\"], [contenteditable=\"true\"]";
const providerConsoleFocusableSelector = "a[href], button, input, select, textarea, [tabindex]";
const codexBrowserLoginBasePath = "/api/providers/oauth/codex/login";
const codexBrowserLoginActiveStatuses = new Set(["starting", "pending", "exchanging"]);

export function codexBrowserLoginRequest(action, loginId = "") {
  const id = encodeURIComponent(String(loginId || "").trim());
  if (action === "start") return { path: `${codexBrowserLoginBasePath}/start`, options: { method: "POST" } };
  if (!id) throw new Error("Codex browser login ID is required");
  if (action === "status") return { path: `${codexBrowserLoginBasePath}/${id}`, options: {} };
  if (action === "cancel") return { path: `${codexBrowserLoginBasePath}/${id}`, options: { method: "DELETE" } };
  throw new Error(`unsupported Codex browser login action: ${action}`);
}

export function trustedCodexBrowserAuthURL(value) {
  try {
    const target = new URL(String(value || ""));
    return target.protocol === "https:"
      && target.hostname === "auth.openai.com"
      && target.port === ""
      && target.username === ""
      && target.password === ""
      && target.pathname === "/oauth/authorize";
  } catch {
    return false;
  }
}

export function normalizeCodexBrowserLoginStatus(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const account = source.account && typeof source.account === "object" && !Array.isArray(source.account) ? source.account : null;
  const rawStatus = String(source.status || "idle").trim().toLowerCase();
  return {
    loginId: String(source.loginId || source.login_id || "").trim(),
    status: rawStatus === "canceled" ? "cancelled" : rawStatus,
    authUrl: String(source.authUrl || source.auth_url || "").trim(),
    expiresAt: String(source.expiresAt || source.expires_at || "").trim(),
    message: String(source.message || source.error || "").trim(),
    account,
  };
}

export function providerConsoleDraftFromForm(currentDraft = {}, form, fallbackType = "openai-compatible") {
  const fields = form?.elements || {};
  const value = (name, fallback = "") => String(fields[name]?.value ?? fallback ?? "");
  return {
    ...currentDraft,
    name: value("name", currentDraft.name),
    type: value("type", currentDraft.type || fallbackType),
    profile: String(currentDraft.profile || ""),
    baseUrl: value("baseUrl", currentDraft.baseUrl),
    apiKey: value("apiKey", currentDraft.apiKey),
    apiKeyDraft: true,
    clearApiKey: Boolean(fields.clearApiKey?.checked),
    model: value("model", currentDraft.model),
    maxTokens: Number(fields.maxTokens?.value || 0),
    apiKeyOptional: Boolean(fields.apiKeyOptional?.checked),
  };
}

export function syncProviderConsoleDraft(consoleState, form) {
  if (!consoleState || !form) return null;
  const draft = providerConsoleDraftFromForm(consoleState.draft || {}, form, consoleState.type);
  consoleState.draft = draft;
  consoleState.dirty = true;
  return draft;
}

export function isProviderConsoleInteractiveTarget(target, card = null) {
  const interactive = target?.closest?.(providerConsoleInteractiveSelector);
  return Boolean(interactive && (!card || card.contains?.(interactive)));
}

export function selectProviderConsoleFieldOnFocus(target) {
  const marker = target?.getAttribute?.("data-select-on-focus") || target?.dataset?.selectOnFocus;
  if (marker !== "true") return false;
  target.removeAttribute?.("data-select-on-focus");
  if (target.dataset) delete target.dataset.selectOnFocus;
  if (target.disabled || target.readOnly || target.type === "password") return false;
  if (!String(target.value ?? "")) return false;
  target.select?.();
  return true;
}

export function shouldOpenProviderCardFromKeyboard(event, card) {
  if (!card || !["Enter", " ", "Spacebar"].includes(event?.key)) return false;
  return !isProviderConsoleInteractiveTarget(event.target, card);
}

export function providerConsoleFocusableElements(layer) {
  return [...(layer?.querySelectorAll?.(providerConsoleFocusableSelector) || [])]
    .filter((node) => !node.disabled && node.getAttribute?.("aria-hidden") !== "true" && node.tabIndex !== -1);
}

export function trapProviderConsoleFocus(event, layer) {
  if (event?.key !== "Tab" || !layer) return false;
  const focusable = providerConsoleFocusableElements(layer);
  if (!focusable.length) {
    event.preventDefault?.();
    layer.focus?.();
    return true;
  }
  const current = event.target;
  const index = focusable.indexOf(current);
  if (event.shiftKey ? index <= 0 : index === -1 || index === focusable.length - 1) {
    event.preventDefault?.();
    focusable[event.shiftKey ? focusable.length - 1 : 0].focus?.();
    return true;
  }
  return false;
}

export function restoreProviderConsoleFocus(target) {
  target?.focus?.();
}

export function providerPreflightResult(response, translate) {
  if (response?.errorCode === "not_configured") {
    return {
      message: translate("messages.currentDraftTestNeedsApiKey"),
      tone: "warning",
      terminalLevel: "warn",
    };
  }
  if (response?.reachable === true && response?.configured !== false) {
    return {
      message: translate("messages.currentDraftTestSucceeded"),
      tone: "success",
      terminalLevel: "info",
    };
  }
  return {
    message: translate("messages.currentDraftTestFailed", { message: response?.errorCode || translate("messages.requestFailed") }),
    tone: "attention",
    terminalLevel: "warn",
  };
}

export function providerModelDiscovery(response, currentModel = "") {
  const models = [...new Set((Array.isArray(response?.models) ? response.models : [])
    .map((model) => String(model || "").trim())
    .filter(Boolean))];
  const current = String(currentModel || "").trim();
  return {
    models,
    selectedModel: models.includes(current) ? current : (models[0] || current),
  };
}

export function normalizeCodexAccountList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["accounts", "files", "authFiles", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export function codexAccountExportFilename(account = {}, id = "") {
  const raw = String(account?.name || account?.alias || `codex-${id || "account"}`).trim();
  const safe = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  const base = safe || "codex-auth";
  return /\.json$/i.test(base) ? base : `${base}.json`;
}

export function normalizeAnthropicAccountList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["accounts", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export const agentModelRoles = Object.freeze(["explore", "plan", "general", "search"]);
export const defaultReasoningEffortValues = Object.freeze(["auto", "low", "medium", "high"]);

export function normalizeDefaultReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return defaultReasoningEffortValues.includes(normalized) ? normalized : "auto";
}

export function isAgentModelReference(value) {
  const normalized = String(value || "").trim();
  const separator = normalized.indexOf(":");
  return separator > 0 && separator < normalized.length - 1 && !/[\0\r\n]/.test(normalized);
}

export function normalizeAgentModelSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const defaultModel = String(source.defaultModel || "").trim();
  const summaryModel = String(source.summaryModel || defaultModel).trim();
  const defaultReasoningEffort = normalizeDefaultReasoningEffort(source.defaultReasoningEffort);
  const rawModels = source.subagentModels && typeof source.subagentModels === "object" ? source.subagentModels : {};
  const rawPools = source.subagentModelPools && typeof source.subagentModelPools === "object" ? source.subagentModelPools : {};
  const subagentModels = {};
  const subagentModelPools = {};
  for (const role of agentModelRoles) {
    const preferred = String(rawModels[role] || "").trim();
    if (preferred) subagentModels[role] = preferred;
    const pool = [...new Set((Array.isArray(rawPools[role]) ? rawPools[role] : [])
      .map((model) => String(model || "").trim())
      .filter(Boolean))];
    if (pool.length) subagentModelPools[role] = pool;
  }
  return { defaultModel, summaryModel, defaultReasoningEffort, subagentModels, subagentModelPools };
}

export function agentModelSettingsPayload(value = {}) {
  const normalized = normalizeAgentModelSettings(value);
  const subagentModels = {};
  const subagentModelPools = {};
  for (const role of agentModelRoles) {
    const preferred = normalized.subagentModels[role] || "";
    const pool = [...(normalized.subagentModelPools[role] || [])];
    if (preferred) subagentModels[role] = preferred;
    if (pool.length) {
      if (preferred && !pool.includes(preferred)) pool.unshift(preferred);
      subagentModelPools[role] = pool;
    }
  }
  return {
    defaultModel: normalized.defaultModel,
    summaryModel: normalized.summaryModel,
    subagentModels,
    subagentModelPools,
  };
}

export function normalizeModelAggregateList(value) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.aggregates) ? value.aggregates : [];
  return items.map((item) => ({
    id: String(item?.id || ""),
    name: String(item?.name || "").trim(),
    mode: String(item?.mode || "priority").trim() || "priority",
    members: (Array.isArray(item?.members) ? item.members : []).map((member) => String(member || "").trim()).filter(Boolean),
    revision: Math.max(0, Math.trunc(Number(item?.revision) || 0)),
    updatedAt: String(item?.updatedAt || item?.updated_at || ""),
  })).filter((item) => item.name);
}

export function modelAggregateMembers(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return source.map((member) => String(member || "").trim()).filter(Boolean);
}

export function modelAggregateActionRequest(action, aggregate = {}, values = {}) {
  const name = String(values.name ?? aggregate?.name ?? "").trim();
  const path = `/api/model-aggregates/${encodeURIComponent(name)}`;
  const revision = Math.max(0, Math.trunc(Number(values.revision ?? aggregate?.revision) || 0));
  if (action === "save") {
    return {
      path,
      options: {
        method: "PUT",
        body: JSON.stringify({ mode: "priority", members: modelAggregateMembers(values.members), revision }),
      },
    };
  }
  if (action === "delete") return { path, options: { method: "DELETE", body: JSON.stringify({ revision }) } };
  throw new Error(`unsupported model aggregate action: ${action}`);
}

export function runtimeReasoningSettingsRequest(value, runtimeSettings = {}) {
  return {
    path: "/api/runtime/model-settings",
    options: {
      method: "PATCH",
      body: JSON.stringify({
        defaultReasoningEffort: normalizeDefaultReasoningEffort(value),
        revision: Math.max(0, Math.trunc(Number(runtimeSettings?.revision) || 0)),
      }),
    },
  };
}

export function codexAccountActionRequest(action, id, values = {}) {
  const path = `/api/providers/oauth/codex/accounts/${encodeURIComponent(String(id || ""))}`;
  switch (action) {
    case "save": return { path, options: { method: "PATCH", body: JSON.stringify({ alias: String(values.alias || ""), priority: Number(values.priority) }) } };
    case "toggle": return { path, options: { method: "PATCH", body: JSON.stringify({ disabled: !Boolean(values.disabled) }) } };
    case "sync": return { path: `${path}/refresh`, options: { method: "POST" } };
    case "export": return { path: `${path}/export`, options: { method: "GET", headers: { "X-Autoto-Confirm": "export-codex-account" } } };
    case "delete": return { path, options: { method: "DELETE" } };
    default: throw new Error(`unsupported Codex account action: ${action}`);
  }
}

export function anthropicProfileLoginCommand(profile) {
  const value = String(profile || "").trim();
  if (!value) return "ant auth login --profile <name>";
  if (/^[A-Za-z0-9._-]+$/.test(value)) return `ant auth login --profile ${value}`;
  return `ant auth login --profile '${value.replace(/'/g, `'"'"'`)}'`;
}

export function anthropicAccountsListRequest() {
  return { path: "/api/providers/auth/anthropic/accounts", options: {} };
}

export function anthropicAccountCreateRequest(values = {}) {
  const authType = values.authType === "api_key" ? "api_key" : "profile";
  const priority = Number(values.priority);
  const body = {
    authType,
    ...(authType === "api_key"
      ? { apiKey: String(values.apiKey || "").trim() }
      : { profile: String(values.profile || "").trim() }),
  };
  const alias = String(values.alias || "").trim();
  if (alias) body.alias = alias;
  if (Number.isInteger(priority)) body.priority = priority;
  return { path: "/api/providers/auth/anthropic/accounts", options: { method: "POST", body: JSON.stringify(body) } };
}

export function consumeAnthropicAccountCreateRequest(form) {
  const request = anthropicAccountCreateRequest({
    authType: form?.elements?.authType?.value,
    profile: form?.elements?.profile?.value,
    apiKey: form?.elements?.apiKey?.value,
    alias: form?.elements?.alias?.value,
    priority: form?.elements?.priority?.value,
  });
  if (form?.elements?.apiKey) form.elements.apiKey.value = "";
  return request;
}

export function anthropicAccountActionRequest(action, id, values = {}) {
  const path = `/api/providers/auth/anthropic/accounts/${encodeURIComponent(String(id || ""))}`;
  switch (action) {
    case "save": return { path, options: { method: "PATCH", body: JSON.stringify({ alias: String(values.alias || ""), priority: Number(values.priority) }) } };
    case "toggle": return { path, options: { method: "PATCH", body: JSON.stringify({ disabled: !Boolean(values.disabled) }) } };
    case "sync": return { path: `${path}/sync`, options: { method: "POST" } };
    case "delete": return { path, options: { method: "DELETE" } };
    default: throw new Error(`unsupported Anthropic account action: ${action}`);
  }
}

export function codexMutationRefreshWarning(refreshed, message, translate = (key, params) => t(`modelProvider.${key}`, params)) {
  return refreshed ? "" : translate("accountMutationRefreshFailed", { message: message || translate("unknown") });
}

export function codexDeleteResultWarning(result, translate = (key, params) => t(`modelProvider.${key}`, params)) {
  return result?.status === "partial" || result?.stats_deleted === false
    ? translate("accountDeletePartial")
    : "";
}

export function codexAccountStatus(account = {}, { now = Date.now() } = {}) {
  const quota = account?.quota && typeof account.quota === "object" ? account.quota : null;
  const expiresAt = String(account?.expires_at || account?.expiresAt || "").trim();
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= now && !Boolean(account?.refreshable);
  if (Boolean(account?.disabled)) return { key: "disabled", tone: "muted", expiresAt };
  if (expired) return { key: "expired", tone: "danger", expiresAt };
  if (codexQuotaIsLimited(quota)) return { key: "rateLimited", tone: "warn", expiresAt };
  return { key: "available", tone: "ok", expiresAt };
}

export function codexAccountOverview(accounts, { now = Date.now() } = {}) {
  const overview = { total: 0, available: 0, rateLimited: 0, disabled: 0, expired: 0 };
  for (const account of Array.isArray(accounts) ? accounts : []) {
    overview.total += 1;
    const status = codexAccountStatus(account, { now });
    if (Object.hasOwn(overview, status.key)) overview[status.key] += 1;
  }
  return overview;
}

export function anthropicAccountStatus(account = {}) {
  if (Boolean(account?.disabled)) return { key: "disabled", tone: "muted" };
  const limit = account?.rate_limit ?? account?.rateLimit ?? account?.quota;
  if (anthropicRateLimitReached(limit)) return { key: "rateLimited", tone: "warn" };
  if (account?.configured === false) return { key: "unconfigured", tone: "warn" };
  return { key: "available", tone: "ok" };
}

export function anthropicAccountOverview(accounts) {
  const overview = { total: 0, available: 0, rateLimited: 0, disabled: 0 };
  for (const account of Array.isArray(accounts) ? accounts : []) {
    overview.total += 1;
    const status = anthropicAccountStatus(account);
    if (Object.hasOwn(overview, status.key)) overview[status.key] += 1;
  }
  return overview;
}

export function renderCodexAccountManagementTable(accounts, {
  translate = (key, params) => t(`modelProvider.${key}`, params),
  now = Date.now(),
  editing = null,
  busy = {},
} = {}) {
  const mt = translate;
  const items = Array.isArray(accounts) ? accounts : [];
  if (!items.length) return `<div class="settings-empty-card settings-card settings-alert compact" role="status">${escapeHtml(mt("noCodexCredentials"))}</div>`;
  return `
    <div class="codex-account-table-wrap settings-card-content">
      <table class="codex-account-table" aria-label="${escapeAttr(mt("importedCredentials"))}">
        <thead><tr>
          <th scope="col">${escapeHtml(mt("accountName"))}</th><th scope="col">${escapeHtml(mt("accountId"))}</th><th scope="col">${escapeHtml(mt("priority"))}</th><th scope="col">${escapeHtml(mt("status"))}</th>
          <th scope="col">${escapeHtml(mt("successFailure"))}</th><th scope="col">${escapeHtml(mt("usage"))}</th><th scope="col">${escapeHtml(mt("lastUsed"))}</th><th scope="col">${escapeHtml(mt("actions"))}</th>
        </tr></thead>
        <tbody>${items.map((account) => renderCodexAccountRow(account, mt, now, editing, busy)).join("")}</tbody>
      </table>
    </div>`;
}

export function renderAnthropicAccountManagementTable(accounts, {
  translate = (key, params) => t(`modelProvider.${key}`, params),
  editing = null,
  busy = {},
} = {}) {
  const mt = translate;
  const items = Array.isArray(accounts) ? accounts : [];
  if (!items.length) return `<div class="settings-empty-card settings-card settings-alert compact" role="status">${escapeHtml(mt("anthropic.noAccounts"))}</div>`;
  return `<div class="codex-account-table-wrap anthropic-account-table-wrap settings-card-content">
    <table class="codex-account-table anthropic-account-table" aria-label="${escapeAttr(mt("anthropic.accountsTitle"))}">
      <thead><tr>
        <th scope="col">${escapeHtml(mt("accountName"))}</th><th scope="col">${escapeHtml(mt("anthropic.authType"))}</th><th scope="col">${escapeHtml(mt("priority"))}</th><th scope="col">${escapeHtml(mt("status"))}</th>
        <th scope="col">${escapeHtml(mt("successFailure"))}</th><th scope="col">${escapeHtml(mt("usage"))}</th><th scope="col">${escapeHtml(mt("lastUsed"))}</th><th scope="col">${escapeHtml(mt("actions"))}</th>
      </tr></thead>
      <tbody>${items.map((account) => renderAnthropicAccountRow(account, mt, editing, busy)).join("")}</tbody>
    </table>
  </div>`;
}

function renderAnthropicAccountRow(account, mt, editing, busy) {
  const id = String(account?.id || "");
  const alias = String(account?.alias || "");
  const priority = finiteNumber(account?.priority, 100);
  const disabled = Boolean(account?.disabled);
  const managed = account?.managed !== false;
  const isEditing = managed && editing?.id === id;
  const isBusy = managed && Boolean(busy?.[id]);
  const authType = String(account?.auth_type || account?.authType || "profile").toLowerCase();
  const profile = String(account?.profile || "");
  const source = managed ? String(account?.source || "") : mt("anthropic.existingConfigSource");
  const fallbackName = profile || source || id || mt("unknown");
  const displayName = alias || fallbackName;
  const secondaryName = [alias && fallbackName !== alias ? fallbackName : "", source && source !== fallbackName ? source : ""].filter(Boolean).join(" · ");
  const stats = account?.stats && typeof account.stats === "object" ? account.stats : {};
  const success = Math.max(0, finiteNumber(stats.success_count ?? stats.successCount, 0));
  const failure = Math.max(0, finiteNumber(stats.failure_count ?? stats.failureCount, 0));
  const lastUsed = String(stats.last_use_at || stats.lastUseAt || stats.last_used_at || stats.lastUsedAt || stats.last_attempt_at || stats.lastAttemptAt || "");
  const status = anthropicAccountStatus(account);
  const disabledAttributes = isBusy ? ` disabled aria-busy="true"` : "";
  const editAlias = String(isEditing ? editing.alias ?? alias : alias);
  const editPriority = finiteNumber(isEditing ? editing.priority : priority, priority);
  const modelCount = Array.isArray(account?.models) ? account.models.filter(Boolean).length : 0;
  return `<tr data-anthropic-account-row="${escapeAttr(id)}" class="${isEditing ? "is-editing" : ""}" aria-busy="${isBusy ? "true" : "false"}">
    <td data-label="${escapeAttr(mt("accountName"))}">${isEditing
      ? `<label class="codex-inline-edit-field"><span class="mp-visually-hidden">${escapeHtml(mt("accountName"))}</span><input class="codex-account-alias settings-text-input settings-form-field" value="${escapeAttr(editAlias)}" placeholder="${escapeAttr(fallbackName)}" maxlength="200" data-anthropic-edit-alias="${escapeAttr(id)}" data-select-on-focus="true"${disabledAttributes}></label>`
      : `<strong class="codex-account-name">${escapeHtml(displayName)}</strong>`}${secondaryName ? `<div class="codex-account-secondary">${escapeHtml(secondaryName)}</div>` : ""}${modelCount ? `<div class="codex-account-secondary">${escapeHtml(mt("anthropic.modelCount", { count: modelCount }))}</div>` : ""}</td>
    <td data-label="${escapeAttr(mt("anthropic.authType"))}"><span class="settings-badge">${escapeHtml(mt(authType === "api_key" ? "anthropic.apiKeyAuth" : "anthropic.profileAuth"))}</span></td>
    <td data-label="${escapeAttr(mt("priority"))}">${isEditing
      ? `<label class="codex-inline-edit-field"><span class="mp-visually-hidden">${escapeHtml(mt("priority"))}</span><input class="codex-priority-input settings-text-input settings-form-field" type="number" min="1" max="1000000" step="1" value="${escapeAttr(editPriority)}" data-anthropic-edit-priority="${escapeAttr(id)}" data-select-on-focus="true"${disabledAttributes}></label>`
      : `<span class="codex-priority-value">${escapeHtml(String(priority))}</span>`}</td>
    <td data-label="${escapeAttr(mt("status"))}"><span class="settings-status-pill settings-badge ${escapeAttr(status.tone)}">${escapeHtml(mt(status.key))}</span></td>
    <td data-label="${escapeAttr(mt("successFailure"))}"><span class="codex-success-count">${escapeHtml(String(success))}</span> / <span class="codex-failure-count">${escapeHtml(String(failure))}</span></td>
    <td data-label="${escapeAttr(mt("usage"))}">${renderAnthropicQuota(account?.quota ?? account?.rate_limit ?? account?.rateLimit, mt)}</td>
    <td data-label="${escapeAttr(mt("lastUsed"))}">${escapeHtml(lastUsed ? formatCodexTimestamp(lastUsed) : mt("never"))}</td>
    <td data-label="${escapeAttr(mt("actions"))}"><div class="codex-account-actions settings-inline-actions" role="group" aria-label="${escapeAttr(mt("accountActions", { account: displayName }))}">
      ${!managed ? `<span class="settings-badge muted anthropic-readonly-badge">${escapeHtml(mt("anthropic.readOnly"))}</span>` : isEditing ? `<button class="codex-icon-action save" type="button" data-anthropic-save="${escapeAttr(id)}" aria-label="${escapeAttr(mt("saveAccount"))}" title="${escapeAttr(mt("saveAccount"))}"${disabledAttributes}>${codexActionIcon("save")}<span>${escapeHtml(mt("save"))}</span></button><button class="codex-icon-action cancel" type="button" data-anthropic-edit-cancel="${escapeAttr(id)}" aria-label="${escapeAttr(mt("cancelEdit"))}" title="${escapeAttr(mt("cancelEdit"))}"${disabledAttributes}>${codexActionIcon("cancel")}<span>${escapeHtml(mt("cancel"))}</span></button>` : `<button class="codex-icon-action edit" type="button" data-anthropic-edit="${escapeAttr(id)}" aria-label="${escapeAttr(mt("editAccount"))}" title="${escapeAttr(mt("editAccount"))}"${disabledAttributes}>${codexActionIcon("edit")}<span>${escapeHtml(mt("edit"))}</span></button><button class="codex-icon-action sync" type="button" data-anthropic-sync="${escapeAttr(id)}" aria-label="${escapeAttr(mt("syncAccount"))}" title="${escapeAttr(mt("syncAccount"))}"${disabledAttributes}>${codexActionIcon("sync")}<span>${escapeHtml(mt("sync"))}</span></button><button class="codex-icon-action toggle" type="button" data-anthropic-toggle="${escapeAttr(id)}" data-disabled="${disabled ? "true" : "false"}" aria-label="${escapeAttr(disabled ? mt("enableAccount") : mt("disableAccount"))}" title="${escapeAttr(disabled ? mt("enableAccount") : mt("disableAccount"))}"${disabledAttributes}>${codexActionIcon(disabled ? "enable" : "disable")}<span>${escapeHtml(disabled ? mt("enable") : mt("disable"))}</span></button><button class="codex-icon-action delete" type="button" data-anthropic-delete="${escapeAttr(id)}" aria-label="${escapeAttr(mt("deleteAccount"))}" title="${escapeAttr(mt("deleteAccount"))}"${disabledAttributes}>${codexActionIcon("delete")}<span>${escapeHtml(mt("delete"))}</span></button>`}
    </div></td>
  </tr>`;
}

function renderCodexAccountRow(account, mt, now, editing, busy) {
  const id = String(account?.id || account?.auth_index || account?.authIndex || account?.name || "");
  const alias = String(account?.alias || "");
  const priority = finiteNumber(account?.priority, 100);
  const disabled = Boolean(account?.disabled);
  const isEditing = editing?.id === id;
  const isBusy = Boolean(busy?.[id]);
  const stats = account?.stats && typeof account.stats === "object" ? account.stats : {};
  const quota = account?.quota && typeof account.quota === "object" ? account.quota : null;
  const plan = String(quota?.plan_type || quota?.planType || account?.plan_type || account?.planType || "").trim();
  const status = codexAccountStatus(account, { now });
  const accountLabel = String(account?.account_id || account?.accountID || id || mt("unknown"));
  const fallbackName = String(account?.email || account?.name || mt("unknown"));
  const displayName = alias || fallbackName;
  const success = Math.max(0, finiteNumber(stats.success_count ?? stats.successCount, 0));
  const failure = Math.max(0, finiteNumber(stats.failure_count ?? stats.failureCount, 0));
  const lastUsed = String(stats.last_use_at || stats.lastUseAt || stats.last_attempt_at || stats.lastAttemptAt || "");
  const disabledAttributes = isBusy ? ` disabled aria-busy="true"` : "";
  const secondaryName = alias && fallbackName !== alias ? fallbackName : "";
  const editAlias = String(isEditing ? editing.alias ?? alias : alias);
  const editPriority = finiteNumber(isEditing ? editing.priority : priority, priority);
  return `<tr data-codex-account-row="${escapeAttr(id)}" class="${isEditing ? "is-editing" : ""}" aria-busy="${isBusy ? "true" : "false"}">
    <td data-label="${escapeAttr(mt("accountName"))}">
      ${isEditing
        ? `<label class="codex-inline-edit-field"><span class="mp-visually-hidden">${escapeHtml(mt("accountName"))}</span><input class="codex-account-alias settings-text-input settings-form-field" value="${escapeAttr(editAlias)}" placeholder="${escapeAttr(fallbackName)}" maxlength="200" data-codex-edit-alias="${escapeAttr(id)}" data-select-on-focus="true"${disabledAttributes}></label>`
        : `<strong class="codex-account-name">${escapeHtml(displayName)}</strong>`}
      ${(secondaryName || plan) ? `<div class="codex-account-secondary">${secondaryName ? escapeHtml(secondaryName) : ""}${plan ? `<span class="codex-plan-badge settings-badge">${escapeHtml(plan)}</span>` : ""}</div>` : ""}
    </td>
    <td data-label="${escapeAttr(mt("accountId"))}"><code class="codex-account-id">${escapeHtml(accountLabel)}</code></td>
    <td data-label="${escapeAttr(mt("priority"))}">${isEditing
      ? `<label class="codex-inline-edit-field"><span class="mp-visually-hidden">${escapeHtml(mt("priority"))}</span><input class="codex-priority-input settings-text-input settings-form-field" type="number" min="1" max="1000000" step="1" value="${escapeAttr(editPriority)}" data-codex-edit-priority="${escapeAttr(id)}" data-select-on-focus="true"${disabledAttributes}></label>`
      : `<span class="codex-priority-value">${escapeHtml(String(priority))}</span>`}</td>
    <td data-label="${escapeAttr(mt("status"))}"><span class="settings-status-pill settings-badge ${escapeAttr(status.tone)}">${escapeHtml(mt(status.key))}</span></td>
    <td data-label="${escapeAttr(mt("successFailure"))}"><span class="codex-success-count">${escapeHtml(String(success))}</span> / <span class="codex-failure-count">${escapeHtml(String(failure))}</span></td>
    <td data-label="${escapeAttr(mt("usage"))}">${renderCodexLocalUsage(account?.usage, mt)}${renderCodexQuota(quota, mt, now)}</td>
    <td data-label="${escapeAttr(mt("lastUsed"))}">${escapeHtml(lastUsed ? formatCodexTimestamp(lastUsed) : mt("never"))}</td>
    <td data-label="${escapeAttr(mt("actions"))}"><div class="codex-account-actions settings-inline-actions" role="group" aria-label="${escapeAttr(mt("accountActions", { account: displayName }))}">
      ${isEditing ? `
        <button class="codex-icon-action save" type="button" data-codex-save="${escapeAttr(id)}" aria-label="${escapeAttr(mt("saveAccount"))}" title="${escapeAttr(mt("saveAccount"))}"${disabledAttributes}>${codexActionIcon("save")}<span>${escapeHtml(mt("save"))}</span></button>
        <button class="codex-icon-action cancel" type="button" data-codex-edit-cancel="${escapeAttr(id)}" aria-label="${escapeAttr(mt("cancelEdit"))}" title="${escapeAttr(mt("cancelEdit"))}"${disabledAttributes}>${codexActionIcon("cancel")}<span>${escapeHtml(mt("cancel"))}</span></button>` : `
        <button class="codex-icon-action edit" type="button" data-codex-edit="${escapeAttr(id)}" aria-label="${escapeAttr(mt("editAccount"))}" title="${escapeAttr(mt("editAccount"))}"${disabledAttributes}>${codexActionIcon("edit")}<span>${escapeHtml(mt("edit"))}</span></button>
        <button class="codex-icon-action sync" type="button" data-codex-sync="${escapeAttr(id)}" aria-label="${escapeAttr(mt("syncAccount"))}" title="${escapeAttr(mt("syncAccount"))}"${disabledAttributes}>${codexActionIcon("sync")}<span>${escapeHtml(mt("sync"))}</span></button>
        <button class="codex-icon-action export" type="button" data-codex-export="${escapeAttr(id)}" aria-label="${escapeAttr(mt("exportAccountJSON"))}" title="${escapeAttr(mt("exportAccountJSON"))}"${disabledAttributes}>${codexActionIcon("export")}<span>${escapeHtml(mt("exportAccount"))}</span></button>
        <span class="codex-account-action-divider" aria-hidden="true"></span>
        <button class="codex-icon-action toggle" type="button" data-codex-toggle="${escapeAttr(id)}" data-disabled="${disabled ? "true" : "false"}" aria-label="${escapeAttr(disabled ? mt("enableAccount") : mt("disableAccount"))}" title="${escapeAttr(disabled ? mt("enableAccount") : mt("disableAccount"))}"${disabledAttributes}>${codexActionIcon(disabled ? "enable" : "disable")}<span>${escapeHtml(disabled ? mt("enable") : mt("disable"))}</span></button>
        <button class="codex-icon-action delete" type="button" data-codex-delete="${escapeAttr(id)}" aria-label="${escapeAttr(mt("deleteAccount"))}" title="${escapeAttr(mt("deleteAccount"))}"${disabledAttributes}>${codexActionIcon("delete")}<span>${escapeHtml(mt("delete"))}</span></button>`}
    </div></td>
  </tr>`;
}

function renderAnthropicQuota(value, mt) {
  if (!value || typeof value !== "object") return `<span class="codex-no-quota">${escapeHtml(mt("anthropic.noQuotaData"))}</span>`;
  const requests = value.requests && typeof value.requests === "object" ? value.requests : value;
  const buckets = [
    [mt("anthropic.quotaRequests"), requests],
    [mt("anthropic.quotaInputTokens"), value.input_tokens || value.inputTokens],
    [mt("anthropic.quotaOutputTokens"), value.output_tokens || value.outputTokens],
  ].map(([label, bucket]) => renderAnthropicQuotaBucket(label, bucket, mt)).filter(Boolean);
  const meta = [];
  const retryAfter = value.retry_after ?? value.retryAfter;
  const fetchedAt = value.fetched_at || value.fetchedAt;
  if (retryAfter !== undefined && retryAfter !== null && retryAfter !== "") meta.push(mt("anthropic.quotaRetryAfter", { time: formatAnthropicLimitTime(retryAfter, { duration: true }) }));
  if (fetchedAt) meta.push(mt("anthropic.quotaFetchedAt", { time: formatAnthropicLimitTime(fetchedAt) }));
  if (!buckets.length && !meta.length) return `<span class="codex-no-quota">${escapeHtml(mt("anthropic.noQuotaData"))}</span>`;
  return `<div class="codex-quota-stack anthropic-quota-stack">${buckets.join("")}${meta.map((row) => `<div class="codex-quota-meta">${escapeHtml(row)}</div>`).join("")}</div>`;
}

function renderAnthropicQuotaBucket(label, bucket, mt) {
  if (!bucket || typeof bucket !== "object") return "";
  const remainingValue = bucket.remaining ?? bucket.remaining_requests ?? bucket.remainingRequests ?? bucket.requests_remaining ?? bucket.requestsRemaining;
  const limitValue = bucket.limit ?? bucket.request_limit ?? bucket.requestLimit ?? bucket.total;
  const usedPercentValue = bucket.used_percent ?? bucket.usedPercent;
  const resetValue = bucket.reset ?? bucket.reset_at ?? bucket.resetAt ?? bucket.resets_at ?? bucket.resetsAt;
  const hasRemaining = remainingValue !== null && remainingValue !== "" && Number.isFinite(Number(remainingValue));
  const hasLimit = limitValue !== null && limitValue !== "" && Number.isFinite(Number(limitValue));
  const hasUsedPercent = usedPercentValue !== null && usedPercentValue !== "" && Number.isFinite(Number(usedPercentValue));
  if (!hasRemaining && !hasLimit && !hasUsedPercent && (resetValue === undefined || resetValue === null || resetValue === "")) return "";
  const rows = [];
  if (hasRemaining) rows.push(mt("anthropic.quotaRemaining", { count: Math.max(0, Number(remainingValue)) }));
  if (hasLimit) rows.push(mt("anthropic.quotaLimit", { count: Math.max(0, Number(limitValue)) }));
  if (hasUsedPercent) rows.push(mt("anthropic.quotaUsed", { percent: formatPercent(Math.max(0, Math.min(100, Number(usedPercentValue)))) }));
  if (resetValue !== undefined && resetValue !== null && resetValue !== "") rows.push(mt("anthropic.quotaResetAt", { time: formatAnthropicLimitTime(resetValue) }));
  return `<div class="anthropic-quota-bucket"><strong>${escapeHtml(label)}</strong>${rows.map((row) => `<div class="codex-quota-meta">${escapeHtml(row)}</div>`).join("")}</div>`;
}

function formatAnthropicLimitTime(value, { duration = false } = {}) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    if (duration || number < 1000000000) return `${Math.max(0, number)}s`;
    return formatCodexTimestamp(new Date(number > 1000000000000 ? number : number * 1000).toISOString());
  }
  const raw = String(value || "").trim();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? formatCodexTimestamp(raw) : raw;
}

function anthropicRateLimitReached(value) {
  if (!value || typeof value !== "object") return Boolean(value);
  const hasRequestsBucket = Boolean(value.requests && typeof value.requests === "object");
  const requests = hasRequestsBucket ? value.requests : value;
  if (requests.limited === true || requests.rate_limited === true || requests.rateLimited === true || requests.reached === true) return true;
  const remaining = requests.remaining ?? requests.remaining_requests ?? requests.remainingRequests ?? requests.requests_remaining ?? requests.requestsRemaining;
  if (remaining !== undefined && remaining !== null && remaining !== "" && Number.isFinite(Number(remaining))) return Number(remaining) <= 0;
  if (hasRequestsBucket) return false;
  return value.limited === true || value.rate_limited === true || value.rateLimited === true || value.reached === true;
}

function renderCodexLocalUsage(usage, mt) {
  const source = usage && typeof usage === "object" ? usage : {};
  const windows = [
    [mt("usageTotal"), source.total],
    [mt("usageLast5Hours"), source.last5Hours],
    [mt("usageLast7Days"), source.last7Days],
  ];
  const hasRequests = windows.some(([, value]) => Math.max(0, finiteNumber(value?.requestCount, 0)) > 0);
  if (!hasRequests) return `<div class="codex-local-usage codex-quota-meta" title="${escapeAttr(mt("recordedCostHint"))}">${escapeHtml(mt("usageNoLocalData"))}</div>`;
  return `<div class="codex-local-usage" title="${escapeAttr(mt("recordedCostHint"))}">${windows.map(([label, value]) => {
    const requestCount = Math.max(0, finiteNumber(value?.requestCount, 0));
    if (!requestCount) return `<div class="codex-local-usage-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(mt("usageNoLocalData"))}</span></div>`;
    const inputTokens = Math.max(0, finiteNumber(value?.inputTokens, 0));
    const outputTokens = Math.max(0, finiteNumber(value?.outputTokens, 0));
    const totalTokens = Math.max(0, finiteNumber(value?.totalTokens, inputTokens + outputTokens));
    const cost = Math.max(0, finiteNumber(value?.costUsd, 0));
    return `<div class="codex-local-usage-row"><div class="codex-local-usage-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(formatNumber(requestCount))} ${escapeHtml(mt("usageRequests"))} · ${escapeHtml(formatNumber(totalTokens, { notation: "compact", maximumFractionDigits: 1 }))} ${escapeHtml(mt("usageTokens"))}</span></div><div class="codex-local-usage-cost">${escapeHtml(mt("recordedCost"))} ${escapeHtml(formatMoney(cost))}</div></div>`;
  }).join("")}</div>`;
}

function renderCodexCredits(quota, mt) {
  const credits = quota?.credits && typeof quota.credits === "object" ? quota.credits : null;
  if (!credits) return "";
  if (credits.unlimited === true) return `<div class="codex-credits-summary"><span>${escapeHtml(mt("credits"))}</span><strong>${escapeHtml(mt("creditsUnlimited"))}</strong></div>`;
  const balance = credits.balance ?? credits.amount ?? credits.remaining;
  if (credits.has_credits === true || credits.hasCredits === true || (balance !== undefined && balance !== null && balance !== "")) {
    return `<div class="codex-credits-summary"><span>${escapeHtml(mt("credits"))}</span><strong>${escapeHtml(mt("creditsBalance", { balance: formatMoney(Math.max(0, finiteNumber(balance, 0))) }))}</strong></div>`;
  }
  return `<div class="codex-credits-summary"><span>${escapeHtml(mt("credits"))}</span><strong>${escapeHtml(mt("creditsUnavailable"))}</strong></div>`;
}

function renderCodexQuota(quota, mt, now) {
  if (!quota) return `<span class="codex-no-quota">${escapeHtml(mt("noQuota"))}</span>`;
  const windows = [
    [mt("primaryQuota"), quota.primary_window || quota.primaryWindow],
    [mt("secondaryQuota"), quota.secondary_window || quota.secondaryWindow],
  ].filter(([, window]) => window && typeof window === "object");
  const credits = renderCodexCredits(quota, mt);
  if (!windows.length && !credits) return `<span class="codex-no-quota">${escapeHtml(mt("noQuota"))}</span>`;
  return `<div class="codex-quota-stack">${windows.map(([label, window]) => renderCodexQuotaWindow(label, window, mt, now)).join("")}${credits}</div>`;
}

function renderCodexQuotaWindow(label, window, mt, now) {
  const used = Math.max(0, Math.min(100, finiteNumber(window.used_percent ?? window.usedPercent, 0)));
  const remaining = Math.max(0, 100 - used);
  const reset = quotaResetText(window, mt, now);
  const duration = formatWindowSeconds(finiteNumber(window.limit_window_seconds ?? window.limitWindowSeconds ?? window.windowSeconds, 0));
  return `<div class="codex-quota-window">
    <div class="codex-quota-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(mt("remainingPercent", { percent: formatPercent(remaining) }))}</strong></div>
    <div class="codex-quota-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeAttr(remaining)}"><span style="width:${escapeAttr(remaining)}%"></span></div>
    <div class="codex-quota-meta">${escapeHtml([duration, reset].filter(Boolean).join(" · "))}</div>
  </div>`;
}

function codexActionIcon(name) {
  const paths = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    sync: '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 0 0-14.9-2"/><path d="M4 17h5v5"/><path d="M4 17a8 8 0 0 0 14.9 2"/>',
    enable: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    disable: '<path d="M5 5l14 14"/><path d="M18.4 6.6A9 9 0 0 1 6.6 18.4"/><path d="M5.6 5.6A9 9 0 0 1 18.4 18.4"/>',
    delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
    save: '<path d="m5 12 4 4L19 6"/>',
    cancel: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
    export: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.edit}</svg>`;
}

function codexQuotaIsLimited(quota) {
  if (!quota || typeof quota !== "object") return false;
  if (quota.rate_limit_reached_type || quota.rateLimitReachedType) return true;
  return [quota.primary_window, quota.primaryWindow, quota.secondary_window, quota.secondaryWindow]
    .some((window) => window && finiteNumber(window.used_percent ?? window.usedPercent, 0) >= 100);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatWindowSeconds(seconds) {
  if (!(seconds > 0)) return "";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round(seconds)}s`;
}

function quotaResetText(window, mt, now) {
  let seconds = finiteNumber(window.reset_after_seconds ?? window.resetAfterSeconds, 0);
  const resetAtValue = window.reset_at || window.resetAt;
  if (!(seconds > 0) && resetAtValue) {
    const resetAt = Date.parse(resetAtValue);
    if (Number.isFinite(resetAt)) seconds = Math.max(0, Math.ceil((resetAt - now) / 1000));
  }
  if (!(seconds > 0)) return "";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const compact = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
  return mt("resetsIn", { time: compact });
}

function formatCodexTimestamp(value) {
  return formatTimestamp(value, { fallback: value });
}

export function createModelProviderSettingsController({
  state,
  copyText,
  getModelVisibilityPreference,
  getPreferredModelPreference,
  loadModelCatalog,
  loadSettings,
  notifyTerminal,
  openSettingsModal,
  refreshActiveSettingsPanel,
  setModelVisibilityPreference,
  setPreferredModelPreference,
  showError,
  updateWorkspaceMetaPills,
} = {}) {
  let preferredModelFallback = "";
  let modelVisibilityFallback = { hiddenModels: {}, showUnconfiguredProviders: false };
  const mt = (key, params) => t(`modelProvider.${key}`, params);
  const ct = (key, params) => t(`modelProvider.console.${key}`, params);

  function setModelRefreshButtonsBusy(busy) {
    ["refreshModelsBtn", "settingsRefreshModelsBtn", "providerRefreshModelsBtn", "relayFetchModelsBtn"].forEach((id) => {
      setButtonBusy($(id), busy, mt("refreshing"));
    });
  }

  function setModelApplyButtonsBusy(busy) {
    setButtonBusy($("settingsClearPreferredModelBtn"), busy, mt("processing"));
    document.querySelectorAll("[data-apply-model]").forEach((button) => {
      button.disabled = busy;
      if (busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
  }

  async function refreshModelCatalog() {
    if (state.modelRefreshing) return;
    state.modelRefreshing = true;
    setModelRefreshButtonsBusy(true);
    try {
      await loadModelCatalog();
      notifyTerminal?.(`[info] ${mt("modelListRefreshed")}\n`);
    } finally {
      state.modelRefreshing = false;
      setModelRefreshButtonsBusy(false);
    }
  }

  async function loadModelAggregates({ force = false } = {}) {
    if (state.modelAggregatesLoading) return false;
    if (!force && state.modelAggregatesLoaded === true) return true;
    const seq = (state.modelAggregateSeq || 0) + 1;
    state.modelAggregateSeq = seq;
    state.modelAggregatesLoading = true;
    state.modelAggregatesError = "";
    if (state.activeSettingsPanel === "models") refreshActiveSettingsPanel?.();
    try {
      const response = await api("/api/model-aggregates");
      if (seq !== state.modelAggregateSeq) return false;
      state.modelAggregates = normalizeModelAggregateList(response);
      state.modelAggregatesLoaded = true;
      return true;
    } catch (error) {
      if (seq !== state.modelAggregateSeq) return false;
      state.modelAggregatesError = error?.message || mt("unknown");
      state.modelAggregatesLoaded = true;
      return false;
    } finally {
      if (seq === state.modelAggregateSeq) {
        state.modelAggregatesLoading = false;
        if (state.activeSettingsPanel === "models") refreshActiveSettingsPanel?.();
      }
    }
  }

  async function loadProviderAuthFiles({ silent = false } = {}) {
    const seq = ++state.providerAuthSeq;
    const button = silent ? null : $("codexRefreshAuthBtn");
    let loaded = false;
    state.providerAuthLoading = true;
    setButtonBusy(button, true, mt("refreshing"));
    if (silent && providerConsoleState().view === "codex" && !extractAuthFiles(state.providerAuthFiles).length) refreshActiveSettingsPanel?.();
    try {
      const files = await api("/api/providers/oauth/codex/accounts");
      if (seq !== state.providerAuthSeq) return;
      state.providerAuthFiles = files;
      state.providerAuthError = "";
      state.providerAuthMutationWarning = "";
      loaded = true;
    } catch (err) {
      if (seq !== state.providerAuthSeq) return;
      state.providerAuthError = err.message;
      if (!silent) notifyTerminal?.(`[warn] ${mt("authAccountsLoadFailed", { message: err.message })}\n`);
    } finally {
      if (seq === state.providerAuthSeq) {
        state.providerAuthLoading = false;
        setButtonBusy(button, false, mt("refreshing"));
      }
    }
    if (seq === state.providerAuthSeq) refreshActiveSettingsPanel?.();
    return loaded && seq === state.providerAuthSeq;
  }

  async function loadAnthropicAccounts({ silent = false } = {}) {
    const seq = (state.anthropicAccountSeq || 0) + 1;
    state.anthropicAccountSeq = seq;
    let loaded = false;
    state.anthropicAccountsLoading = true;
    if (providerConsoleState().view === "anthropic") refreshActiveSettingsPanel?.();
    try {
      const request = anthropicAccountsListRequest();
      const response = await api(request.path, request.options);
      if (seq !== state.anthropicAccountSeq) return false;
      state.anthropicAccounts = normalizeAnthropicAccountList(response);
      state.anthropicAccountsError = "";
      loaded = true;
    } catch (error) {
      if (seq !== state.anthropicAccountSeq) return false;
      state.anthropicAccountsError = error?.message || mt("unknown");
      if (!silent) notifyTerminal?.(`[warn] ${mt("anthropic.accountsLoadFailed", { message: state.anthropicAccountsError })}\n`);
    } finally {
      if (seq === state.anthropicAccountSeq) {
        state.anthropicAccountsLoading = false;
        refreshActiveSettingsPanel?.();
      }
    }
    return loaded && seq === state.anthropicAccountSeq;
  }

  async function importCodexAuthFile() {
    const button = $("codexImportAuthBtn");
    if (button?.disabled) return;
    const textarea = $("codexAuthImportText");
    const consoleState = providerConsoleState();
    const content = (textarea?.value || consoleState.codexImportDraft || "").trim();
    if (!content) throw new Error(mt("importContentRequired"));
    consoleState.codexImportDraft = content;
    setProviderConsoleResult("");
    setButtonBusy(button, true, mt("importing"));
    if (textarea) textarea.disabled = true;
    try {
      const result = await api("/api/providers/oauth/codex/import", {
        method: "POST",
        body: JSON.stringify({ filename: "autoto-codex-auth.json", content }),
      });
      const imported = Math.max(0, Number(result?.imported || 0));
      const skipped = Math.max(0, Number(result?.skipped || 0));
      const failed = Array.isArray(result?.errors) ? result.errors.length : 0;
      const successMessage = mt("importedCredentialsCount", { count: imported, skipped });
      notifyTerminal?.(`[info] ${successMessage}\n`);
      if (!failed) {
        consoleState.codexImportDraft = "";
        setProviderConsoleResult(successMessage, "success");
      } else {
        setProviderConsoleResult(mt("importedCredentialsPartial", { count: imported, failed }), "attention");
      }
      await loadProviderAuthFiles({ silent: true });
      await loadModelCatalog();
      if (failed) throw new Error(mt("importedCredentialsPartial", { count: imported, failed }));
    } finally {
      setButtonBusy(button, false, mt("importing"));
      if (textarea?.isConnected) textarea.disabled = false;
    }
  }

  function codexBrowserLoginState() {
    return providerConsoleState().codexBrowserLogin;
  }

  function codexBrowserLoginActive(status = codexBrowserLoginState().status) {
    return codexBrowserLoginActiveStatuses.has(String(status || "").toLowerCase());
  }

  function codexBrowserLoginAccountLabel(account) {
    if (!account || typeof account !== "object") return "";
    return String(account.alias || account.email || account.name || account.account_id || account.accountId || "").trim();
  }

  function preopenCodexBrowserLoginWindow() {
    try {
      const popup = globalThis.open?.("about:blank", "autoto-codex-login", "popup,width=720,height=820");
      if (popup) popup.opener = null;
      return popup || null;
    } catch {
      return null;
    }
  }

  function openCodexBrowserAuthURL(authUrl, popup = null) {
    if (!trustedCodexBrowserAuthURL(authUrl)) throw new Error(mt("browserLoginInvalidURL"));
    try {
      if (popup && !popup.closed) {
        popup.location.replace(authUrl);
        return true;
      }
      const opened = globalThis.open?.(authUrl, "_blank", "noopener,noreferrer");
      return Boolean(opened);
    } catch {
      return false;
    }
  }

  async function finishCodexBrowserLogin(status, seq) {
    const login = codexBrowserLoginState();
    if (seq !== login.seq) return;
    const terminal = normalizeCodexBrowserLoginStatus(status);
    Object.assign(login, terminal, { seq, popupBlocked: false });
    const account = codexBrowserLoginAccountLabel(terminal.account) || mt("browserLoginAccountFallback");
    if (terminal.status === "completed") {
      const message = mt("browserLoginSuccess", { account });
      const refreshFailures = [];
      setProviderConsoleResult(message, "success");
      notifyTerminal?.(`[info] ${message}\n`);
      const accountID = String(terminal.account?.id || "").trim();
      if (accountID) {
        try {
          const request = codexAccountActionRequest("sync", accountID);
          await api(request.path, request.options);
        } catch (error) {
          refreshFailures.push(error?.message || mt("unknown"));
        }
      }
      const accountsLoaded = await loadProviderAuthFiles({ silent: true });
      if (!accountsLoaded && state.providerAuthError) refreshFailures.push(state.providerAuthError);
      try {
        await loadModelCatalog();
      } catch (error) {
        refreshFailures.push(error?.message || mt("unknown"));
      }
      if (refreshFailures.length) {
        const warning = mt("browserLoginRefreshWarning", { message: [...new Set(refreshFailures)].join("; ") });
        state.providerAuthMutationWarning = warning;
        notifyTerminal?.(`[warn] ${warning}\n`);
      }
    } else if (terminal.status === "cancelled") {
      setProviderConsoleResult(mt("browserLoginCancelled"), "info");
    } else if (terminal.status === "expired") {
      setProviderConsoleResult(mt("browserLoginExpired"), "attention");
    } else {
      setProviderConsoleResult(mt("browserLoginFailed", { message: terminal.message || mt("unknown") }), "attention");
    }
    refreshProviderConsole();
  }

  async function pollCodexBrowserLogin(loginId, seq) {
    for (;;) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
      const login = codexBrowserLoginState();
      if (seq !== login.seq || login.loginId !== loginId) return;
      const request = codexBrowserLoginRequest("status", loginId);
      let status;
      try {
        status = normalizeCodexBrowserLoginStatus(await api(request.path, request.options));
      } catch (error) {
        if (seq !== codexBrowserLoginState().seq) return;
        await finishCodexBrowserLogin({ loginId, status: "failed", message: error?.message || mt("unknown") }, seq);
        return;
      }
      if (status.loginId && status.loginId !== loginId) return;
      Object.assign(login, status, { loginId, seq, authUrl: status.authUrl || login.authUrl });
      refreshProviderConsole();
      if (codexBrowserLoginActive(status.status)) continue;
      await finishCodexBrowserLogin(status, seq);
      return;
    }
  }

  async function startCodexBrowserLogin() {
    const login = codexBrowserLoginState();
    if (remoteAccessContext(state)) {
      setProviderConsoleResult(mt("browserLoginLocalOnly"), "attention");
      refreshProviderConsole();
      return;
    }
    if (codexBrowserLoginActive(login.status) && login.authUrl) {
      openCodexBrowserAuthURL(login.authUrl);
      return;
    }
    const popup = preopenCodexBrowserLoginWindow();
    const seq = Number(login.seq || 0) + 1;
    Object.assign(login, {
      seq,
      loginId: "",
      status: "starting",
      authUrl: "",
      expiresAt: "",
      message: "",
      account: null,
      popupBlocked: !popup,
    });
    setProviderConsoleResult("");
    refreshProviderConsole();
    try {
      const request = codexBrowserLoginRequest("start");
      const status = normalizeCodexBrowserLoginStatus(await api(request.path, request.options));
      if (seq !== codexBrowserLoginState().seq) {
        popup?.close?.();
        return;
      }
      if (!status.loginId) throw new Error(mt("browserLoginStartFailed"));
      const active = codexBrowserLoginActive(status.status);
      if (active && !trustedCodexBrowserAuthURL(status.authUrl)) throw new Error(mt("browserLoginInvalidURL"));
      const opened = active ? openCodexBrowserAuthURL(status.authUrl, popup) : true;
      if (!active) popup?.close?.();
      Object.assign(login, status, {
        seq,
        loginId: status.loginId,
        status: status.status || "pending",
        popupBlocked: active && !opened,
      });
      refreshProviderConsole();
      if (!codexBrowserLoginActive(login.status)) {
        await finishCodexBrowserLogin(login, seq);
        return;
      }
      await pollCodexBrowserLogin(login.loginId, seq);
    } catch (error) {
      popup?.close?.();
      if (seq !== codexBrowserLoginState().seq) return;
      Object.assign(login, { status: "failed", message: error?.message || mt("unknown"), popupBlocked: false });
      setProviderConsoleResult(error?.status === 403 ? mt("browserLoginLocalOnly") : mt("browserLoginFailed", { message: login.message }), "attention");
      refreshProviderConsole();
    }
  }

  async function cancelCodexBrowserLogin() {
    const login = codexBrowserLoginState();
    if (!login.loginId || !codexBrowserLoginActive(login.status)) return;
    const seq = Number(login.seq || 0) + 1;
    login.seq = seq;
    try {
      const request = codexBrowserLoginRequest("cancel", login.loginId);
      const status = normalizeCodexBrowserLoginStatus(await api(request.path, request.options));
      Object.assign(login, status, { seq, status: status.status || "cancelled", popupBlocked: false });
      setProviderConsoleResult(mt("browserLoginCancelled"), "info");
    } catch (error) {
      Object.assign(login, { seq, status: "failed", message: error?.message || mt("unknown"), popupBlocked: false });
      setProviderConsoleResult(mt("browserLoginFailed", { message: login.message }), "attention");
    }
    refreshProviderConsole();
  }

  function reopenCodexBrowserLogin() {
    const login = codexBrowserLoginState();
    if (!login.authUrl || !codexBrowserLoginActive(login.status)) return;
    if (!openCodexBrowserAuthURL(login.authUrl)) {
      login.popupBlocked = true;
      setProviderConsoleResult(mt("browserLoginPopupBlocked"), "attention");
      refreshProviderConsole();
    }
  }

  async function runCodexAccountAction(id, button, busyLabel, action) {
    state.codexAccountBusy ||= {};
    if (!id || state.codexAccountBusy[id]) return;
    state.codexAccountBusy[id] = true;
    state.providerAuthMutationWarning = "";
    setProviderConsoleResult("");
    setButtonBusy(button, true, busyLabel);
    refreshProviderConsole();
    try {
      const actionResult = await action();
      const refreshed = await loadProviderAuthFiles({ silent: true });
      const warnings = [
        actionResult?.warning || "",
        codexMutationRefreshWarning(refreshed, state.providerAuthError, mt),
      ].filter(Boolean);
      state.providerAuthMutationWarning = warnings.join(" ");
      warnings.forEach((warning) => notifyTerminal?.(`[warn] ${warning}\n`));
    } finally {
      delete state.codexAccountBusy[id];
      setButtonBusy(button, false, busyLabel);
      refreshProviderConsole();
    }
  }

  async function saveCodexAccount(id, button) {
    const consoleState = providerConsoleState();
    const edit = consoleState.codexEdit;
    if (!edit || edit.id !== id) return;
    const alias = String(edit.alias || "").trim();
    const priority = Number(edit.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000000) throw new Error(mt("invalidPriority"));
    return runCodexAccountAction(id, button, mt("saving"), async () => {
      const request = codexAccountActionRequest("save", id, { alias, priority });
      await api(request.path, request.options);
      consoleState.codexEdit = null;
      setProviderConsoleResult(mt("accountSaved"), "success");
      notifyTerminal?.(`[info] ${mt("accountSaved")}\n`);
    });
  }

  async function syncCodexAccount(id, button) {
    return runCodexAccountAction(id, button, mt("syncing"), async () => {
      const request = codexAccountActionRequest("sync", id);
      await api(request.path, request.options);
      setProviderConsoleResult(mt("accountSynced"), "success");
      notifyTerminal?.(`[info] ${mt("accountSynced")}\n`);
    });
  }

  async function toggleCodexAccount(id, disabled, button) {
    return runCodexAccountAction(id, button, mt("saving"), async () => {
      const request = codexAccountActionRequest("toggle", id, { disabled });
      await api(request.path, request.options);
      const message = mt(disabled ? "accountEnabled" : "accountDisabled");
      setProviderConsoleResult(message, "success");
      notifyTerminal?.(`[info] ${message}\n`);
    });
  }

  function codexAccountById(id) {
    const target = String(id || "");
    return normalizeCodexAccountList(state.providerAuthFiles).find((account) => {
      const accountId = String(account?.id || account?.auth_index || account?.authIndex || account?.name || "");
      return accountId === target;
    }) || null;
  }

  async function exportCodexAccount(id, button) {
    state.codexAccountBusy ||= {};
    if (!id || state.codexAccountBusy[id] || !globalThis.confirm?.(mt("exportAccountConfirm"))) return;
    state.codexAccountBusy[id] = true;
    state.providerAuthMutationWarning = "";
    setProviderConsoleResult("");
    setButtonBusy(button, true, mt("exporting"));
    refreshProviderConsole();
    try {
      const request = codexAccountActionRequest("export", id);
      const response = await apiDownload(request.path, request.options);
      const blob = await response.blob();
      const objectURL = globalThis.URL?.createObjectURL?.(blob);
      if (!objectURL || !globalThis.document?.createElement) throw new Error(mt("accountExportFailed"));
      const link = globalThis.document.createElement("a");
      link.href = objectURL;
      link.download = codexAccountExportFilename(codexAccountById(id), id);
      link.hidden = true;
      try {
        globalThis.document.body?.appendChild(link);
        link.click();
      } finally {
        link.remove();
        const revoke = () => globalThis.URL?.revokeObjectURL?.(objectURL);
        if (typeof globalThis.setTimeout === "function") globalThis.setTimeout(revoke, 0);
        else revoke();
      }
      setProviderConsoleResult(mt("accountExported"), "success");
    } finally {
      delete state.codexAccountBusy[id];
      setButtonBusy(button, false, mt("exporting"));
      refreshProviderConsole();
    }
  }

  async function deleteCodexAccount(id, button) {
    if (state.codexAccountBusy?.[id] || !globalThis.confirm?.(mt("deleteAccountConfirm"))) return;
    return runCodexAccountAction(id, button, mt("deleting"), async () => {
      const request = codexAccountActionRequest("delete", id);
      const result = await api(request.path, request.options);
      const warning = codexDeleteResultWarning(result, mt);
      if (!warning) {
        setProviderConsoleResult(mt("accountDeleted"), "success");
        notifyTerminal?.(`[info] ${mt("accountDeleted")}\n`);
      }
      return { warning };
    });
  }

  function anthropicAccountById(id) {
    return normalizeAnthropicAccountList(state.anthropicAccounts).find((account) => String(account?.id || "") === String(id || "")) || null;
  }

  function anthropicAccountIsManaged(id) {
    const account = anthropicAccountById(id);
    return Boolean(account && account.managed !== false);
  }

  async function runAnthropicAccountAction(id, button, busyLabel, action) {
    if (!anthropicAccountIsManaged(id)) return;
    state.anthropicAccountBusy ||= {};
    if (!id || state.anthropicAccountBusy[id]) return;
    state.anthropicAccountBusy[id] = true;
    setProviderConsoleResult("");
    setButtonBusy(button, true, busyLabel);
    refreshProviderConsole();
    try {
      await action();
      const refreshed = await loadAnthropicAccounts({ silent: true });
      if (!refreshed) setProviderConsoleResult(mt("anthropic.mutationRefreshFailed", { message: state.anthropicAccountsError || mt("unknown") }), "attention");
    } finally {
      delete state.anthropicAccountBusy[id];
      setButtonBusy(button, false, busyLabel);
      refreshProviderConsole();
    }
  }

  async function createAnthropicAccount(form) {
    if (!form || state.anthropicAccountCreating) return;
    const authType = form.elements?.authType?.value === "api_key" ? "api_key" : "profile";
    const profile = String(form.elements?.profile?.value || "").trim();
    const apiKey = String(form.elements?.apiKey?.value || "").trim();
    const alias = String(form.elements?.alias?.value || "").trim();
    const priority = Number(form.elements?.priority?.value || 100);
    if (authType === "profile" && !profile) throw new Error(mt("anthropic.profileRequired"));
    if (authType === "api_key" && !apiKey) throw new Error(mt("anthropic.apiKeyRequired"));
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000000) throw new Error(mt("invalidPriority"));
    const request = consumeAnthropicAccountCreateRequest(form);
    state.anthropicAccountCreating = true;
    refreshProviderConsole();
    try {
      await api(request.path, request.options);
      const consoleState = providerConsoleState();
      consoleState.anthropicProfile = "";
      consoleState.anthropicAlias = "";
      consoleState.anthropicPriority = 100;
      setProviderConsoleResult(mt("anthropic.accountAdded"), "success");
      notifyTerminal?.(`[info] ${mt("anthropic.accountAdded")}\n`);
      await loadAnthropicAccounts({ silent: true });
      await loadModelCatalog();
    } finally {
      state.anthropicAccountCreating = false;
      refreshProviderConsole();
    }
  }

  async function saveAnthropicAccount(id, button) {
    const edit = providerConsoleState().anthropicEdit;
    if (!edit || edit.id !== id) return;
    const priority = Number(edit.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000000) throw new Error(mt("invalidPriority"));
    return runAnthropicAccountAction(id, button, mt("saving"), async () => {
      const request = anthropicAccountActionRequest("save", id, { alias: String(edit.alias || "").trim(), priority });
      await api(request.path, request.options);
      providerConsoleState().anthropicEdit = null;
      setProviderConsoleResult(mt("anthropic.accountSaved"), "success");
    });
  }

  async function syncAnthropicAccount(id, button) {
    return runAnthropicAccountAction(id, button, mt("syncing"), async () => {
      const request = anthropicAccountActionRequest("sync", id);
      await api(request.path, request.options);
      setProviderConsoleResult(mt("anthropic.accountSynced"), "success");
    });
  }

  async function toggleAnthropicAccount(id, disabled, button) {
    return runAnthropicAccountAction(id, button, mt("saving"), async () => {
      const request = anthropicAccountActionRequest("toggle", id, { disabled });
      await api(request.path, request.options);
      setProviderConsoleResult(mt(disabled ? "anthropic.accountEnabled" : "anthropic.accountDisabled"), "success");
    });
  }

  async function deleteAnthropicAccount(id, button) {
    if (state.anthropicAccountBusy?.[id] || !globalThis.confirm?.(mt("anthropic.deleteConfirm"))) return;
    return runAnthropicAccountAction(id, button, mt("deleting"), async () => {
      const request = anthropicAccountActionRequest("delete", id);
      await api(request.path, request.options);
      setProviderConsoleResult(mt("anthropic.accountDeleted"), "success");
    });
  }

  async function saveRelayProviderConfig() {
    const button = $("relaySaveConfigBtn");
    if (button?.disabled) return;
    const spec = relayProtocolSpec(getRelayProtocol());
    const baseUrl = $("relayBaseUrl")?.value.trim() || "";
    const apiKey = $("relayApiKey")?.value.trim() || "";
    const customModel = $("relayCustomModel")?.value.trim() || "";
    const existing = providerByName(spec.providerName);
    const model = customModel || existing?.defaultModel || existing?.model || defaultModelForProtocol(spec.key);
    const payload = {
      name: spec.providerName,
      type: spec.providerType,
      baseUrl,
      apiKey,
      model,
      maxTokens: spec.providerType === "anthropic" ? 4096 : 0,
      profile: spec.providerProfile || existing?.profile || "",
      apiKeyOptional: Boolean(existing?.apiKeyOptional),
    };
    setButtonBusy(button, true, mt("saving"));
    try {
      const result = await api(`/api/providers/${encodeURIComponent(spec.providerName)}/config`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.providerConfigStatus = result.message || mt("relayConfigSaved");
      notifyTerminal?.(`[info] ${mt("relayConfigSavedRefreshing", { provider: spec.label })}\n`);
      await loadSettings();
      await loadModelCatalog();
      refreshActiveSettingsPanel?.();
    } finally {
      setButtonBusy(button, false, mt("saving"));
    }
  }

  function selectRelayProtocol(protocol) {
    globalThis.localStorage?.setItem?.(relayProtocolPrefsKey, protocol);
    state.providerConfigStatus = "";
    refreshActiveSettingsPanel?.();
  }

  function getRelayProtocol() {
    const saved = globalThis.localStorage?.getItem?.(relayProtocolPrefsKey) || "completions";
    return relayProtocolSpec(saved).key;
  }

  function relayProtocolSpec(key) {
    return relayProtocolSpecs().find((item) => item.key === key) || relayProtocolSpecs().find((item) => item.key === "completions");
  }

  function relayProtocolSpecs() {
    return [
      { key: "anthropic", label: mt("relayProtocols.anthropic.label"), providerName: "anthropic", providerType: "anthropic", help: mt("relayProtocols.anthropic.help") },
      { key: "codex", label: "Codex Relay", providerName: "cliproxyapi", providerType: "openai-compatible", providerProfile: "cliproxyapi", help: mt("relayProtocols.responses.help") },
      { key: "responses", label: mt("relayProtocols.responses.label"), providerName: "openai", providerType: "openai", help: mt("relayProtocols.responses.help") },
      { key: "gemini-interactions", label: "Gemini Interactions", providerName: "gemini", providerType: "gemini-interactions", help: "Gemini Interactions API" },
      { key: "claude-code", label: mt("relayProtocols.claudeCode.label"), providerName: "anthropic", providerType: "anthropic", help: mt("relayProtocols.claudeCode.help") },
      { key: "completions", label: mt("relayProtocols.completions.label"), providerName: "openai-compatible", providerType: "openai-compatible", help: mt("relayProtocols.completions.help") },
    ];
  }

  function defaultModelForProtocol(protocol) {
    if (protocol === "anthropic" || protocol === "claude-code") return "claude-sonnet-4-5";
    if (protocol === "codex") return "gpt-5.5";
    if (protocol === "gemini-interactions") return "gemini-2.5-pro";
    return "gpt-4.1-mini";
  }

  function providerConfigExpanded(key) {
    return Boolean(state.providerConfigExpanded?.[key]);
  }

  function renderProviderConfigToggle(key, expanded, label = mt("config")) {
    const buttonLabel = expanded ? mt("collapse") : mt("expand", { label });
    return `<button class="settings-action-btn subtle" type="button" data-toggle-provider-config="${escapeAttr(key)}" aria-expanded="${expanded ? "true" : "false"}">${escapeHtml(buttonLabel)}</button>`;
  }

  function toggleProviderConfig(key) {
    state.providerConfigExpanded = { ...(state.providerConfigExpanded || {}), [key]: !providerConfigExpanded(key) };
    refreshActiveSettingsPanel?.();
  }

  function expandProviderConfig(key) {
    if (providerConfigExpanded(key)) return;
    state.providerConfigExpanded = { ...(state.providerConfigExpanded || {}), [key]: true };
    refreshActiveSettingsPanel?.();
  }

  function providerByName(name) {
    return modelProvidersForUI().find((provider) => provider.name === name)
      || (state.settings?.providers || []).find((provider) => provider.name === name)
      || null;
  }

  function agentModelSettingsSource() {
    return normalizeAgentModelSettings({
      ...(state.settings?.agent || {}),
      defaultReasoningEffort: state.settings?.runtimeSettings?.defaultReasoningEffort || "auto",
    });
  }

  function agentModelSettingsState() {
    const source = agentModelSettingsSource();
    const sourceSignature = JSON.stringify(source);
    const current = state.agentModelSettings;
    if (!current || (!current.dirty && current.sourceSignature !== sourceSignature)) {
      state.agentModelSettings = {
        draft: source,
        sourceSignature,
        dirty: false,
        saving: false,
        result: null,
      };
    } else {
      current.draft = normalizeAgentModelSettings(current.draft || source);
      current.saving = Boolean(current.saving);
    }
    return state.agentModelSettings;
  }

  function agentSettingsAvailableModels(draft = {}) {
    const referenced = new Set([
      draft.defaultModel,
      draft.summaryModel,
      ...Object.values(draft.subagentModels || {}),
      ...Object.values(draft.subagentModelPools || {}).flat(),
    ].map((value) => String(value || "").trim()).filter(Boolean));
    const records = [];
    const seen = new Set();
    for (const provider of modelProvidersForUI()) {
      for (const model of providerModelList(provider)) {
        const value = modelOptionValue(provider, model);
        if (seen.has(value)) continue;
        const available = Boolean(provider.enabled && providerRuntimeSelectable(provider));
        if (!available && !referenced.has(value)) continue;
        seen.add(value);
        records.push({ value, provider: providerLabel(provider), model, available });
      }
    }
    for (const aggregate of normalizeModelAggregateList(state.modelAggregates)) {
      const value = `aggregate:${aggregate.name}`;
      if (seen.has(value)) continue;
      seen.add(value);
      records.push({ value, provider: mt("routing.aggregateProvider"), model: aggregate.name, available: true, aggregate: true });
    }
    for (const value of referenced) {
      if (seen.has(value)) continue;
      seen.add(value);
      const [provider, ...modelParts] = value.split(":");
      records.push({ value, provider, model: modelParts.join(":"), available: false });
    }
    return records;
  }

  function renderAgentModelSelectOptions(current, options, { allowInherited = false } = {}) {
    const selected = String(current || "").trim();
    const inherited = allowInherited
      ? `<option value="" ${selected ? "" : "selected"}>${escapeHtml(mt("routing.inheritDefault"))}</option>`
      : "";
    return inherited + options.map((item) => {
      const suffix = item.available ? "" : ` · ${mt("routing.currentlyUnavailable")}`;
      return `<option value="${escapeAttr(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.value + suffix)}</option>`;
    }).join("");
  }

  function agentModelPoolSummary(unrestricted, count) {
    return unrestricted ? mt("routing.unrestricted") : mt("modelCount", { count });
  }

  function renderAgentRolePreferenceField(role, draft, options) {
    const preferred = draft.subagentModels?.[role] || "";
    return `<label class="settings-form-field compact-settings-field"><span>${escapeHtml(mt(`routing.roles.${role}.label`))}</span><select name="subagentModel_${escapeAttr(role)}" data-agent-role-model="${escapeAttr(role)}">${renderAgentModelSelectOptions(preferred, options, { allowInherited: true })}</select><small data-settings-help-copy>${escapeHtml(mt(`routing.roles.${role}.description`))}</small></label>`;
  }

  function renderAgentModelPoolControl(role, draft, options) {
    const pool = draft.subagentModelPools?.[role] || [];
    const unrestricted = pool.length === 0;
    return `<details class="compact-multi-select agent-model-pool-details" data-agent-model-pool-details="${escapeAttr(role)}">
      <summary class="compact-multi-select-summary"><span>${escapeHtml(mt(`routing.roles.${role}.label`))}</span><strong class="agent-model-pool-state ${unrestricted ? "muted" : "ok"}" data-agent-model-pool-summary="${escapeAttr(role)}">${escapeHtml(agentModelPoolSummary(unrestricted, pool.length))}</strong></summary>
      <fieldset class="compact-multi-select-panel agent-model-pool-fieldset">
        <legend class="sr-only">${escapeHtml(mt("routing.allowedModels"))}</legend>
        <label class="compact-multi-select-all agent-model-pool-all"><input type="checkbox" data-agent-model-pool-all="${escapeAttr(role)}" ${unrestricted ? "checked" : ""}><span><strong>${escapeHtml(mt("routing.allowAllModels"))}</strong><small data-settings-help-copy>${escapeHtml(mt("routing.allowAllModelsHelp"))}</small></span></label>
        <div class="compact-multi-select-options agent-model-pool-options" data-agent-model-pool-options="${escapeAttr(role)}">
          ${options.map((item) => `<label class="compact-multi-select-option agent-model-pool-option"><input type="checkbox" value="${escapeAttr(item.value)}" data-agent-model-pool-option="${escapeAttr(role)}" ${pool.includes(item.value) ? "checked" : ""} ${unrestricted ? "disabled" : ""}><span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.available ? item.provider : mt("routing.currentlyUnavailable"))}</small></span></label>`).join("") || `<div class="settings-empty-card compact">${escapeHtml(mt("routing.noModelsForPool"))}</div>`}
        </div>
      </fieldset>
    </details>`;
  }

  function renderDefaultReasoningOptions(current) {
    const selected = normalizeDefaultReasoningEffort(current);
    return defaultReasoningEffortValues.map((value) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(mt(value === "auto" ? "automatic" : value))}</option>`).join("");
  }

  function renderModelAggregateEditor(editor = {}) {
    const editing = editor.mode === "edit";
    const name = String(editor.name || "");
    const members = modelAggregateMembers(editor.members).join("\n");
    return `<form id="modelAggregateForm" class="model-aggregate-editor compact-settings-editor" data-model-aggregate-mode="${editing ? "edit" : "create"}">
      <div class="compact-settings-grid two-column">
        <label class="settings-form-field compact-settings-field"><span>${escapeHtml(mt("routing.aggregateName"))}</span><input name="aggregateName" value="${escapeAttr(name)}" maxlength="120" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,119}" ${editing ? "readonly" : "required"}><small data-settings-help-copy>${escapeHtml(mt("routing.aggregateNameHelp"))}</small></label>
        <label class="settings-form-field compact-settings-field"><span>${escapeHtml(mt("routing.aggregateStrategy"))}</span><select name="aggregateMode" disabled><option value="priority" selected>${escapeHtml(mt("routing.aggregatePriority"))}</option></select><small data-settings-help-copy>${escapeHtml(mt("routing.aggregateStrategyHelp"))}</small></label>
        <label class="settings-form-field compact-settings-field full-width"><span>${escapeHtml(mt("routing.aggregateMembers"))}</span><textarea name="aggregateMembers" rows="5" required placeholder="openai:gpt-5\ncodex:gpt-5.5">${escapeHtml(members)}</textarea><small data-settings-help-copy>${escapeHtml(mt("routing.aggregateMembersHelp"))}</small></label>
      </div>
      <div class="compact-settings-editor-actions settings-inline-actions"><button class="settings-action-btn subtle" type="button" data-model-aggregate-cancel>${escapeHtml(mt("cancel"))}</button><button class="settings-action-btn primary" type="submit" data-model-aggregate-save>${escapeHtml(editing ? mt("routing.updateAggregate") : mt("routing.createAggregate"))}</button></div>
    </form>`;
  }

  function renderModelAggregateSection() {
    const aggregates = normalizeModelAggregateList(state.modelAggregates);
    const editor = state.modelAggregateEditor && typeof state.modelAggregateEditor === "object" ? state.modelAggregateEditor : null;
    const busy = Boolean(state.modelAggregateBusy);
    let content = "";
    if (state.modelAggregatesLoading || state.modelAggregatesLoaded !== true) content = `<div class="settings-empty-card compact" role="status">${escapeHtml(mt("routing.loadingAggregates"))}</div>`;
    else if (state.modelAggregatesError) content = `<div class="settings-alert" role="alert">${escapeHtml(state.modelAggregatesError)}</div>`;
    else if (!aggregates.length) content = `<div class="settings-empty-card compact" role="status">${escapeHtml(mt("routing.noAggregates"))}</div>`;
    else content = `<div class="model-aggregate-list">${aggregates.map((aggregate) => `<article class="model-aggregate-row" data-model-aggregate-row="${escapeAttr(aggregate.name)}"><div class="model-aggregate-main"><strong>aggregate:${escapeHtml(aggregate.name)}</strong><ol>${aggregate.members.map((member) => `<li><code>${escapeHtml(member)}</code></li>`).join("")}</ol></div><div class="model-aggregate-actions settings-inline-actions"><button class="settings-action-btn subtle" type="button" data-model-aggregate-edit="${escapeAttr(aggregate.name)}" ${busy ? "disabled" : ""}>${escapeHtml(mt("edit"))}</button><button class="settings-action-btn danger" type="button" data-model-aggregate-delete="${escapeAttr(aggregate.name)}" ${busy ? "disabled" : ""}>${escapeHtml(mt("delete"))}</button></div></article>`).join("")}</div>`;
    return `<section class="compact-settings-section model-aggregate-section" aria-labelledby="model-aggregate-title"><div class="compact-settings-section-copy"><h2 id="model-aggregate-title">${escapeHtml(mt("routing.aggregatesTitle"))}</h2><p data-settings-help-copy>${escapeHtml(mt("routing.aggregatesDescription"))}</p></div><div class="compact-settings-section-controls"><div class="compact-settings-section-toolbar"><span>${escapeHtml(mt("routing.aggregateCount", { count: aggregates.length }))}</span><button class="settings-action-btn subtle" type="button" data-model-aggregate-add ${busy || editor ? "disabled" : ""}>＋ ${escapeHtml(mt("routing.addAggregate"))}</button></div>${content}${editor ? renderModelAggregateEditor(editor) : ""}</div></section>`;
  }

  function renderModelSettingsContent() {
    const providers = modelProvidersForUI();
    const settingsState = agentModelSettingsState();
    const draft = settingsState.draft;
    const options = agentSettingsAvailableModels(draft);
    const preferred = getPreferredModel();
    const catalogModelCount = providers.reduce((total, provider) => total + providerModelList(provider).length, 0);
    const catalogHasModels = catalogModelCount > 0;
    const runtimeRevision = Math.max(0, Math.trunc(Number(state.settings?.runtimeSettings?.revision) || 0));
    const result = settingsState.result && typeof settingsState.result === "object"
      ? `<div class="agent-model-settings-result settings-alert ${escapeAttr(settingsState.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(settingsState.result.message || "")}</div>`
      : "";
    return `<div class="settings-live-page compact-settings-page agent-model-settings-page" aria-labelledby="settings-model-page-title">
      <header class="compact-settings-header"><div class="compact-settings-heading"><div class="settings-hero-kicker">${escapeHtml(mt("routing.kicker"))}</div><h1 id="settings-model-page-title">${escapeHtml(mt("routing.title"))}</h1><p data-settings-help-copy>${escapeHtml(mt("routing.description"))}</p></div><div class="compact-settings-header-actions settings-inline-actions"><button id="settingsRefreshModelsBtn" class="settings-action-btn" type="button">${escapeHtml(mt("refreshModels"))}</button><button id="settingsOpenLoginBtn" class="settings-action-btn" type="button">${escapeHtml(mt("credentialsRelay"))}</button></div></header>
      ${result}
      <form id="agentModelSettingsForm" class="compact-settings-form agent-model-settings-form" aria-busy="${settingsState.saving ? "true" : "false"}">
        <section class="compact-settings-section" aria-labelledby="agent-model-defaults-title"><div class="compact-settings-section-copy"><h2 id="agent-model-defaults-title">${escapeHtml(mt("routing.globalDefaults"))}</h2><p data-settings-help-copy>${escapeHtml(mt("routing.globalDefaultsDescription"))}</p></div><div class="compact-settings-section-controls"><div class="compact-settings-grid two-column"><label class="settings-form-field compact-settings-field"><span>${escapeHtml(mt("routing.defaultModel"))}</span><select name="defaultModel" required>${renderAgentModelSelectOptions(draft.defaultModel, options)}</select><small data-settings-help-copy>${escapeHtml(mt("routing.defaultModelHelp"))}</small></label><label class="settings-form-field compact-settings-field"><span>${escapeHtml(mt("routing.summaryModel"))}</span><select name="summaryModel" required>${renderAgentModelSelectOptions(draft.summaryModel, options)}</select><small data-settings-help-copy>${escapeHtml(mt("routing.summaryModelHelp"))}</small></label><label class="settings-form-field compact-settings-field full-width"><span>${escapeHtml(mt("defaultReasoningEffort"))}</span><select name="defaultReasoningEffort" ${runtimeRevision > 0 ? "" : "disabled"}>${renderDefaultReasoningOptions(draft.defaultReasoningEffort)}</select><small${runtimeRevision > 0 ? " data-settings-help-copy" : ""}>${escapeHtml(runtimeRevision > 0 ? mt("routing.defaultReasoningHelp") : mt("routing.runtimeSettingsUnavailable"))}</small></label></div></div></section>
        <section class="compact-settings-section" aria-labelledby="agent-model-preferences-title"><div class="compact-settings-section-copy"><h2 id="agent-model-preferences-title">${escapeHtml(mt("routing.subagentPreferences"))}</h2><p data-settings-help-copy>${escapeHtml(mt("routing.subagentPreferencesDescription"))}</p></div><div class="compact-settings-section-controls"><div class="compact-settings-grid two-column">${agentModelRoles.map((role) => renderAgentRolePreferenceField(role, draft, options)).join("")}</div></div></section>
        <section class="compact-settings-section" aria-labelledby="agent-model-pools-title"><div class="compact-settings-section-copy"><h2 id="agent-model-pools-title">${escapeHtml(mt("routing.subagentPools"))}</h2><p data-settings-help-copy>${escapeHtml(mt("routing.subagentPoolsDescription"))}</p></div><div class="compact-settings-section-controls"><div class="compact-settings-grid two-column">${agentModelRoles.map((role) => renderAgentModelPoolControl(role, draft, options)).join("")}</div></div></section>
        <footer class="compact-settings-footer agent-model-settings-footer"><div><span id="agentModelSettingsDirtyBadge" class="settings-badge ${settingsState.dirty ? "warn" : "ok"}">${escapeHtml(settingsState.dirty ? mt("routing.unsaved") : mt("routing.saved"))}</span><small data-settings-help-copy>${escapeHtml(mt("routing.persistenceDescription"))}</small></div><div class="settings-inline-actions"><button id="resetAgentModelSettingsBtn" class="settings-action-btn subtle" type="button" ${settingsState.saving ? "disabled" : ""}>${escapeHtml(mt("routing.reset"))}</button><button id="saveAgentModelSettingsBtn" class="settings-action-btn primary" type="submit" ${settingsState.saving ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(settingsState.saving ? mt("saving") : mt("routing.save"))}</button></div></footer>
      </form>
      ${renderModelAggregateSection()}
      <details class="compact-settings-disclosure agent-model-catalog-details"${catalogHasModels ? " open" : ""}><summary><span>${escapeHtml(mt("routing.modelListToggle"))}</span><small data-settings-help-copy>${escapeHtml(mt("routing.catalogDescription"))}</small></summary><section class="agent-model-catalog compact-settings-disclosure-panel" aria-labelledby="agent-model-catalog-title"><header class="compact-settings-section-toolbar"><div><h2 id="agent-model-catalog-title">${escapeHtml(mt("routing.catalogTitle"))}</h2><p${preferred ? "" : " data-settings-help-copy"}>${escapeHtml(preferred ? mt("preferredModel", { model: preferred }) : mt("routing.catalogDescription"))}</p><small class="settings-model-catalog-count" data-settings-help-copy>${escapeHtml(mt("routing.catalogModelCount", { count: catalogModelCount }))}</small></div><div class="settings-inline-actions"><button id="settingsShowConfiguredModelsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("showConfiguredModels"))}</button><button id="settingsClearPreferredModelBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("clearPreferred"))}</button></div></header><div class="settings-model-list">${providers.map(renderModelProviderSection).join("") || `<div class="settings-empty-card settings-card settings-alert" role="status">${escapeHtml(mt("noModelsLoaded"))}</div>`}</div></section></details>
    </div>`;
  }

  function renderModelProviderSection(provider) {
    const models = providerModelList(provider);
    return `
    <section class="agent-model-catalog-provider settings-provider-section settings-card">
      <header class="settings-provider-section-head settings-card-header">
        <div>
          <h2 class="settings-provider-title settings-card-title">${escapeHtml(providerLabel(provider))}</h2>
          <div class="settings-provider-meta settings-card-description">${escapeHtml(provider.baseUrl || provider.type || "provider")}</div>
        </div>
        <span class="settings-status-pill settings-badge ${provider.error ? "warn" : (provider.configured ? "ok" : "muted")}">${escapeHtml(providerStatusText(provider))}</span>
      </header>
      <div class="settings-card-content">
      ${provider.error ? `<div class="settings-inline-alert settings-alert" role="alert">${escapeHtml(provider.error)}</div>` : ""}
      <div class="agent-model-catalog-grid settings-model-grid">
        ${models.map((model) => renderModelChoice(provider, model)).join("")}
      </div>
      </div>
    </section>
  `;
  }

  function renderModelChoice(provider, model) {
    const value = modelOptionValue(provider, model);
    const active = value === currentModelValue();
    const preferred = value === getPreferredModel();
    const hidden = isModelHidden(value);
    const selectable = isModelSelectable(provider, model);
    const disabled = !provider.configured;
    const title = hidden ? mt("showModel") : mt("hideModel");
    const icon = hidden
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 9.2 4 10.5 8a11.7 11.7 0 0 1-3.1 4.8M6.2 6.2A11.8 11.8 0 0 0 1.5 12c1.3 4 5.3 8 10.5 8 1.3 0 2.5-.2 3.6-.7"/></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
    const status = disabled ? mt("unconfigured") : hidden ? mt("hidden") : preferred ? mt("preferred") : active ? mt("currentModel") : "";
    return `
    <div class="agent-model-catalog-item settings-model-row settings-card ${active ? "active" : ""} ${hidden || disabled ? "muted" : ""}">
      <button class="settings-model-choice ${active ? "active" : ""}" type="button" data-apply-model="${escapeAttr(value)}" title="${escapeAttr(value)}" ${selectable ? "" : "disabled"}>
        <span class="settings-model-name">${escapeHtml(value)}</span>
      </button>
      <div class="settings-inline-actions">${status ? `<span class="settings-badge ${disabled ? "muted" : hidden ? "warn" : "ok"}">${escapeHtml(status)}</span>` : ""}<button class="settings-model-icon-btn ${hidden ? "is-hidden" : "is-visible"}" type="button" data-toggle-model-visibility="${escapeAttr(value)}" data-model-visibility-state="${hidden ? "hidden" : "visible"}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" aria-pressed="${hidden ? "false" : "true"}" ${disabled ? "disabled" : ""}>${icon}</button></div>
    </div>
  `;
  }

  function providerConsoleState() {
    const fallback = {
      view: "providers",
      search: "",
      category: "all",
      modal: "",
      drawer: "",
      mode: "",
      type: "",
      providerName: "",
      draft: null,
      dirty: false,
      busy: {},
      result: null,
      testOpen: false,
      test: { prompt: "", result: null },
      codexImportDraft: "",
      codexEdit: null,
      codexBrowserLogin: {
        seq: 0,
        loginId: "",
        status: "idle",
        authUrl: "",
        expiresAt: "",
        message: "",
        account: null,
        popupBlocked: false,
      },
      anthropicAddMode: "profile",
      anthropicProfile: "",
      anthropicAlias: "",
      anthropicPriority: 100,
      anthropicEdit: null,
    };
    if (!state.providerConsole || typeof state.providerConsole !== "object") {
      state.providerConsole = fallback;
    } else {
      // Preserve object identity so async work that retained this state keeps writing
      // to the live console state after a render-triggered normalization.
      const consoleState = state.providerConsole;
      const previous = { ...consoleState };
      const testState = previous.test && typeof previous.test === "object" ? previous.test : {};
      const previousTest = { ...testState };
      const browserLoginState = previous.codexBrowserLogin && typeof previous.codexBrowserLogin === "object"
        ? previous.codexBrowserLogin
        : {};
      const previousBrowserLogin = { ...browserLoginState };
      Object.assign(testState, fallback.test, previousTest);
      Object.assign(browserLoginState, fallback.codexBrowserLogin, previousBrowserLogin);
      Object.assign(consoleState, fallback, previous, {
        busy: previous.busy || {},
        test: testState,
        codexBrowserLogin: browserLoginState,
      });
    }
    return state.providerConsole;
  }

  function setProviderConsoleResult(message, tone = "info") {
    providerConsoleState().result = message ? { message: String(message), tone } : null;
  }

  function renderProviderSettingsContent() {
    const consoleState = providerConsoleState();
    if (consoleState.view === "codex") return renderCodexConsolePage();
    if (consoleState.view === "anthropic") return renderAnthropicConsolePage();
    return renderProviderConsolePage({
      providers: modelProvidersForUI(),
      consoleState,
      relayDrawer: renderRelayConsoleDrawer(),
    });
  }

  function renderCodexConsolePage() {
    const consoleState = providerConsoleState();
    const authFiles = extractAuthFiles(state.providerAuthFiles);
    const overview = codexAccountOverview(authFiles);
    const provider = codexProvider();
    const modelRefreshBusy = Boolean(consoleState.busy?.refresh);
    const providerTone = provider?.error || !provider?.configured ? "warn" : provider?.enabled === false ? "muted" : "ok";
    const providerState = provider?.error
      ? mt("needsAttention")
      : provider?.enabled === false
        ? mt("disabled")
        : provider?.configured
          ? mt("ready")
          : mt("unconfigured");
    const result = consoleState.result && typeof consoleState.result === "object"
      ? `<div class="codex-console-result settings-alert ${escapeAttr(consoleState.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(consoleState.result.message || "")}</div>`
      : "";
    const accountAlert = state.providerAuthMutationWarning
      ? `<div class="settings-alert attention" role="status" aria-live="polite">${escapeHtml(state.providerAuthMutationWarning)}</div>`
      : state.providerAuthError
        ? `<div class="settings-alert attention" role="alert">${escapeHtml(state.providerAuthError)}</div>`
        : "";
    const browserLogin = consoleState.codexBrowserLogin;
    const browserLoginActive = codexBrowserLoginActive(browserLogin.status);
    const browserLoginLocalOnly = remoteAccessContext(state);
    const browserLoginStatusKey = {
      starting: "browserLoginStatusStarting",
      pending: "browserLoginStatusWaiting",
      exchanging: "browserLoginStatusExchanging",
      completed: "browserLoginStatusCompleted",
      failed: "browserLoginStatusFailed",
      cancelled: "browserLoginStatusCancelled",
      expired: "browserLoginStatusExpired",
    }[browserLogin.status] || "";
    const browserLoginPanel = `
      <section class="codex-browser-login-panel settings-card" aria-labelledby="codex-browser-login-title" aria-busy="${browserLoginActive ? "true" : "false"}">
        <div class="codex-console-section-head settings-card-header">
          <div><h2 id="codex-browser-login-title" class="settings-card-title">${escapeHtml(mt("browserLoginTitle"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("browserLoginDescription"))}</p></div>
          <span class="settings-badge codex-browser-login-recommended">${escapeHtml(mt("browserLoginRecommended"))}</span>
        </div>
        <div class="codex-browser-login-body settings-card-content">
          <div class="codex-browser-login-copy"><strong>${escapeHtml(mt("browserLoginAccountOnly"))}</strong><p>${escapeHtml(browserLoginLocalOnly ? mt("browserLoginLocalOnly") : mt("browserLoginSafety"))}</p></div>
          <div class="codex-browser-login-actions settings-inline-actions">
            ${browserLoginStatusKey ? `<span class="settings-status-pill ${browserLogin.status === "completed" ? "ok" : browserLogin.status === "failed" || browserLogin.status === "expired" ? "warn" : "muted"}" role="status" aria-live="polite">${escapeHtml(mt(browserLoginStatusKey))}</span>` : ""}
            ${browserLoginActive && browserLogin.authUrl ? `<button class="settings-action-btn" type="button" data-mp-codex-browser-open>${escapeHtml(mt("browserLoginOpen"))}</button>` : ""}
            ${browserLoginActive ? `<button class="settings-action-btn subtle" type="button" data-mp-codex-browser-cancel>${escapeHtml(mt("browserLoginCancel"))}</button>` : `<button class="settings-action-btn primary" type="button" data-mp-codex-browser-login ${browserLoginLocalOnly ? "disabled" : ""}>${escapeHtml(mt(browserLogin.status === "completed" ? "browserLoginAddAnother" : "browserLoginAction"))}</button>`}
          </div>
          ${browserLogin.popupBlocked ? `<div class="settings-alert attention codex-browser-login-alert" role="alert">${escapeHtml(mt("browserLoginPopupBlocked"))}</div>` : ""}
        </div>
      </section>`;
    const importPanel = `
      <section class="codex-import-panel settings-card" id="codexCredentialImportSection" aria-labelledby="codex-import-title">
        <div class="codex-console-section-head settings-card-header">
          <div><h2 id="codex-import-title" class="settings-card-title">${escapeHtml(mt("codexImportTitle"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("codexImportDescription"))}</p></div>
        </div>
        <div class="codex-import-body settings-card-content">
          <label class="settings-form-field"><span class="mp-visually-hidden">${escapeHtml(mt("codexImportTitle"))}</span><textarea id="codexAuthImportText" class="codex-import-textarea settings-text-input" data-codex-import-draft placeholder="${escapeAttr(mt("codexImportPlaceholder"))}">${escapeHtml(consoleState.codexImportDraft || "")}</textarea></label>
          <div class="codex-import-footer"><p data-settings-help-copy>${escapeHtml(mt("codexImportSuccess"))}</p><button id="codexImportAuthBtn" class="settings-action-btn primary" type="button" data-mp-codex-import>${escapeHtml(mt("import"))}</button></div>
        </div>
      </section>`;
    const accountContent = state.providerAuthLoading && !authFiles.length
      ? `<div class="codex-console-loading settings-empty-card compact" role="status">${escapeHtml(mt("loadingAccounts"))}</div>`
      : renderCodexAccountManagementTable(authFiles, {
        translate: mt,
        editing: consoleState.codexEdit,
        busy: state.codexAccountBusy || {},
      });
    return `<div class="codex-account-console settings-page" tabindex="-1" aria-labelledby="codex-console-title">
      <button class="codex-console-back" type="button" data-mp-close-codex-page>← ${escapeHtml(mt("backToProviders"))}</button>
      <header class="codex-console-hero settings-card">
        <div class="codex-console-heading"><div><p class="mp-provider-kicker">Codex OAuth</p><h1 id="codex-console-title" class="settings-card-title">${escapeHtml(mt("accountConsoleTitle"))}</h1><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("accountConsoleDescription"))}</p></div><span class="settings-status-pill ${escapeAttr(providerTone)}">${escapeHtml(providerState)}</span></div>
        <div class="codex-console-actions settings-inline-actions">
          <button id="codexRefreshAuthBtn" class="settings-action-btn" type="button" data-mp-codex-refresh ${state.providerAuthLoading ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(state.providerAuthLoading ? mt("refreshing") : mt("refreshAccounts"))}</button>
          <button class="settings-action-btn" type="button" data-mp-refresh-models ${modelRefreshBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(modelRefreshBusy ? mt("refreshing") : mt("refreshModels"))}</button>
        </div>
      </header>
      <section class="codex-console-stats settings-stat-grid" aria-label="${escapeAttr(mt("accountSummary"))}">
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.total))}</strong><span>${escapeHtml(mt("totalAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.available))}</strong><span>${escapeHtml(mt("availableAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.rateLimited))}</strong><span>${escapeHtml(mt("limitedAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.disabled))}</strong><span>${escapeHtml(mt("disabledAccounts"))}</span></div>
      </section>
      ${result}${browserLoginPanel}${importPanel}
      <section class="codex-accounts-panel settings-card" aria-labelledby="codex-accounts-title" aria-busy="${state.providerAuthLoading ? "true" : "false"}">
        <div class="codex-console-section-head settings-card-header"><div><h2 id="codex-accounts-title" class="settings-card-title">${escapeHtml(mt("importedCredentials"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("importedCredentialsDescription"))}</p></div><span class="settings-badge">${escapeHtml(mt("accountCount", { count: authFiles.length }))}</span></div>
        ${accountAlert}
        ${accountContent}
      </section>
    </div>`;
  }

  function renderAnthropicConsolePage() {
    const consoleState = providerConsoleState();
    const accounts = normalizeAnthropicAccountList(state.anthropicAccounts);
    const overview = anthropicAccountOverview(accounts);
    const provider = providerByName(consoleState.providerName || "anthropic") || modelProvidersForUI().find(isAnthropicAccountProvider) || normalizeConsoleProvider(consoleState.draft || createProviderDraft("anthropic"));
    const draft = createProviderDraft("anthropic", consoleState.draft || provider);
    const models = [...new Set((draft.models || provider.models || []).map((model) => String(model || "").trim()).filter(Boolean))];
    const modelOptions = models.length ? `<datalist id="anthropic-model-options">${models.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}</datalist>` : "";
    const providerTone = provider?.error || !provider?.configured ? "warn" : provider?.enabled === false ? "muted" : "ok";
    const providerState = provider?.error ? mt("needsAttention") : provider?.enabled === false ? mt("disabled") : provider?.configured ? mt("ready") : mt("unconfigured");
    const mode = consoleState.anthropicAddMode === "api_key" ? "api_key" : "profile";
    const loginCommand = anthropicProfileLoginCommand(consoleState.anthropicProfile);
    const result = consoleState.result && typeof consoleState.result === "object"
      ? `<div class="codex-console-result settings-alert ${escapeAttr(consoleState.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(consoleState.result.message || "")}</div>`
      : "";
    const accountAlert = state.anthropicAccountsError ? `<div class="settings-alert attention" role="alert">${escapeHtml(mt("anthropic.accountsLoadFailed", { message: state.anthropicAccountsError }))}</div>` : "";
    const accountContent = state.anthropicAccountsLoading && !accounts.length
      ? `<div class="codex-console-loading settings-empty-card compact" role="status">${escapeHtml(mt("anthropic.loadingAccounts"))}</div>`
      : renderAnthropicAccountManagementTable(accounts, { translate: mt, editing: consoleState.anthropicEdit, busy: state.anthropicAccountBusy || {} });
    const creating = Boolean(state.anthropicAccountCreating);
    const modelBusy = Boolean(consoleState.busy?.["models:anthropic"]);
    const saveBusy = Boolean(consoleState.busy?.["save:anthropic"]);
    const refreshBusy = Boolean(consoleState.busy?.refresh);
    return `<div class="anthropic-account-console codex-account-console settings-page" tabindex="-1" aria-labelledby="anthropic-console-title">
      <button class="codex-console-back" type="button" data-mp-close-anthropic-page>← ${escapeHtml(mt("backToProviders"))}</button>
      <header class="codex-console-hero anthropic-console-hero settings-card">
        <div class="codex-console-heading"><div><p class="mp-provider-kicker">Anthropic</p><h1 id="anthropic-console-title" class="settings-card-title">${escapeHtml(mt("anthropic.title"))}</h1><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("anthropic.description"))}</p></div><span class="settings-status-pill ${escapeAttr(providerTone)}">${escapeHtml(providerState)}</span></div>
        <div class="codex-console-actions settings-inline-actions"><button class="settings-action-btn primary" type="button" data-anthropic-focus-add>${escapeHtml(mt("anthropic.addAccount"))}</button><button class="settings-action-btn" type="button" data-anthropic-refresh ${state.anthropicAccountsLoading ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(state.anthropicAccountsLoading ? mt("refreshing") : mt("refreshAccounts"))}</button></div>
      </header>
      <section class="codex-console-stats settings-stat-grid" aria-label="${escapeAttr(mt("anthropic.summary"))}">
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.total))}</strong><span>${escapeHtml(mt("totalAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.available))}</strong><span>${escapeHtml(mt("availableAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.rateLimited))}</strong><span>${escapeHtml(mt("limitedAccounts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(String(overview.disabled))}</strong><span>${escapeHtml(mt("disabledAccounts"))}</span></div>
      </section>
      ${result}
      <section class="anthropic-add-panel settings-card" id="anthropic-add-account" aria-labelledby="anthropic-add-title">
        <div class="codex-console-section-head settings-card-header"><div><h2 id="anthropic-add-title" class="settings-card-title">${escapeHtml(mt("anthropic.addAccount"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("anthropic.addDescription"))}</p></div></div>
        <div class="anthropic-add-body settings-card-content">
          <div class="anthropic-auth-tabs settings-inline-actions" role="group" aria-label="${escapeAttr(mt("anthropic.authType"))}"><button class="settings-action-btn ${mode === "profile" ? "primary" : "subtle"}" type="button" data-anthropic-add-mode="profile" aria-pressed="${mode === "profile" ? "true" : "false"}">${escapeHtml(mt("anthropic.profileAuth"))}</button><button class="settings-action-btn ${mode === "api_key" ? "primary" : "subtle"}" type="button" data-anthropic-add-mode="api_key" aria-pressed="${mode === "api_key" ? "true" : "false"}">${escapeHtml(mt("anthropic.apiKeyAuth"))}</button></div>
          <form class="anthropic-account-form" data-anthropic-account-form aria-busy="${creating ? "true" : "false"}">
            <input type="hidden" name="authType" value="${escapeAttr(mode)}">
            <div class="anthropic-add-grid">
              ${mode === "profile" ? `<label class="settings-form-field"><span>${escapeHtml(mt("anthropic.profileName"))}</span><input name="profile" value="${escapeAttr(consoleState.anthropicProfile || "")}" autocomplete="off" placeholder="${escapeAttr(mt("anthropic.profilePlaceholder"))}" required data-anthropic-profile data-select-on-focus="true"></label>` : `<label class="settings-form-field"><span>${escapeHtml(mt("apiKey"))}</span><input name="apiKey" type="password" value="" autocomplete="new-password" placeholder="${escapeAttr(mt("anthropic.apiKeyPlaceholder"))}" required></label>`}
              <label class="settings-form-field"><span>${escapeHtml(mt("anthropic.alias"))}</span><input name="alias" value="${escapeAttr(consoleState.anthropicAlias || "")}" autocomplete="off" placeholder="${escapeAttr(mt("anthropic.aliasPlaceholder"))}" data-anthropic-alias data-select-on-focus="true"></label>
              <label class="settings-form-field"><span>${escapeHtml(mt("priority"))}</span><input name="priority" type="number" min="1" max="1000000" step="1" value="${escapeAttr(consoleState.anthropicPriority || 100)}" data-anthropic-priority data-select-on-focus="true"></label>
            </div>
            ${mode === "profile" ? `<div class="anthropic-profile-command"><div><span>${escapeHtml(mt("anthropic.loginCommand"))}</span><code data-anthropic-command>${escapeHtml(loginCommand)}</code></div><button class="settings-action-btn subtle" type="button" data-anthropic-copy-command="${escapeAttr(loginCommand)}">${escapeHtml(mt("anthropic.copyCommand"))}</button></div>` : `<p class="anthropic-secret-note">${escapeHtml(mt("anthropic.apiKeySafety"))}</p>`}
            <div class="settings-inline-actions"><button class="settings-action-btn primary" type="submit" ${creating ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(creating ? mt("saving") : mt("anthropic.addAccount"))}</button></div>
          </form>
        </div>
      </section>
      <section class="codex-accounts-panel settings-card" aria-labelledby="anthropic-accounts-title" aria-busy="${state.anthropicAccountsLoading ? "true" : "false"}">
        <div class="codex-console-section-head settings-card-header"><div><h2 id="anthropic-accounts-title" class="settings-card-title">${escapeHtml(mt("anthropic.accountsTitle"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("anthropic.accountsDescription"))}</p></div><span class="settings-badge">${escapeHtml(mt("accountCount", { count: accounts.length }))}</span></div>
        ${accountAlert}${accountContent}
      </section>
      <section class="anthropic-config-panel settings-card" aria-labelledby="anthropic-config-title">
        <div class="codex-console-section-head settings-card-header"><div><h2 id="anthropic-config-title" class="settings-card-title">${escapeHtml(mt("anthropic.configTitle"))}</h2><p class="settings-card-description" data-settings-help-copy>${escapeHtml(mt("anthropic.configDescription"))}</p></div><span class="settings-status-pill ${escapeAttr(providerTone)}">${escapeHtml(providerState)}</span></div>
        <form class="anthropic-config-form settings-card-content" data-mp-provider-form data-anthropic-provider-config>
          <input type="hidden" name="name" value="anthropic"><input type="hidden" name="type" value="anthropic"><input type="hidden" name="apiKey" value=""><input type="checkbox" name="apiKeyOptional" hidden>
          <div class="anthropic-config-grid">
            <label class="settings-form-field"><span>${escapeHtml(mt("defaultModel"))}</span><input name="model" data-select-on-focus="true" value="${escapeAttr(draft.model || "")}" autocomplete="off" ${models.length ? "list=\"anthropic-model-options\"" : ""} required>${modelOptions}</label>
            <label class="settings-form-field"><span>${escapeHtml(mt("baseUrl"))}</span><input name="baseUrl" value="${escapeAttr(draft.baseUrl || "")}" autocomplete="url" placeholder="${escapeAttr(mt("anthropicOfficialEndpointPlaceholder"))}"></label>
            <label class="settings-form-field"><span>${escapeHtml(mt("maxTokens"))}</span><input name="maxTokens" data-select-on-focus="true" type="number" min="1" step="1" value="${escapeAttr(draft.maxTokens || 4096)}"></label>
          </div>
          <p class="anthropic-secret-note">${escapeHtml(mt("anthropic.configNote"))}</p>
          <div class="anthropic-config-actions settings-inline-actions"><button class="settings-action-btn" type="button" data-mp-fetch-models ${modelBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(modelBusy ? ct("actions.fetchingModels") : mt("fetchModels"))}</button><button class="settings-action-btn" type="button" data-mp-refresh-models ${refreshBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(refreshBusy ? mt("refreshing") : mt("refreshModels"))}</button><button class="settings-action-btn primary" type="submit" ${saveBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(saveBusy ? mt("saving") : ct("actions.saveAndEnable"))}</button></div>
        </form>
      </section>
    </div>`;
  }

  function renderRelayConsoleDrawer() {
    const consoleState = providerConsoleState();
    if (consoleState.mode !== "relay") return "";
    const spec = relayProtocolSpec(getRelayProtocol());
    const provider = providerByName(spec.providerName) || { name: spec.providerName, type: spec.providerType, defaultModel: defaultModelForProtocol(spec.key), baseUrl: "" };
    const modelValue = provider.defaultModel || provider.model || defaultModelForProtocol(spec.key);
    const busy = Object.values(consoleState.busy || {}).some(Boolean);
    return `<header class="mp-drawer-head settings-card-header"><div><p class="mp-provider-kicker">${escapeHtml(ct("compatibleAdvanced"))}</p><h2 id="mp-drawer-title" class="settings-card-title">${escapeHtml(ct("relay.title"))}</h2><p id="mp-drawer-description" class="settings-card-description" data-settings-help-copy>${escapeHtml(ct("relay.description"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-drawer aria-label="${escapeAttr(ct("actions.closeDrawer"))}">×</button></header>
      <div class="mp-drawer-body settings-card-content" aria-busy="${busy ? "true" : "false"}">
        <section class="mp-config-section settings-page-section"><h3>${escapeHtml(ct("fields.protocol"))}</h3><div class="mp-relay-protocols settings-inline-actions">${relayProtocolSpecs().map((item) => `<button class="mp-action ${item.key === spec.key ? "primary" : ""}" type="button" data-relay-protocol="${escapeAttr(item.key)}">${escapeHtml(item.label)}</button>`).join("")}</div><p data-settings-help-copy>${escapeHtml(spec.help)}</p></section>
        <section class="mp-config-section settings-page-section"><h3>${escapeHtml(ct("drawer.connection"))}</h3>
          <label class="settings-form-field">${escapeHtml(ct("fields.providerName"))}<input id="relayProviderName" value="${escapeAttr(provider.name || spec.providerName)}" readonly></label>
          <label class="settings-form-field">${escapeHtml(ct("fields.apiKey"))}<input id="relayApiKey" type="password" value="" autocomplete="off" placeholder="${escapeAttr(ct("fields.apiKeyBlankKeepsCurrent"))}"></label>
          <label class="settings-form-field">${escapeHtml(ct("fields.baseUrl"))}<input id="relayBaseUrl" value="${escapeAttr(provider.baseUrl || "")}" autocomplete="url" placeholder="https://api.example.com/v1"></label>
          <label class="settings-form-field">${escapeHtml(ct("fields.defaultModel"))}<input id="relayCustomModel" data-select-on-focus="true" value="${escapeAttr(modelValue)}" autocomplete="off"></label>
        </section>
      </div>
      <footer class="mp-drawer-foot settings-card-footer settings-inline-actions"><button id="relayFetchModelsBtn" class="mp-action" type="button" data-mp-fetch-models>${escapeHtml(ct("actions.fetchModels"))}</button><div class="settings-inline-actions"><button class="mp-action" type="button" data-mp-close-drawer>${escapeHtml(ct("actions.cancel"))}</button><button id="relaySaveConfigBtn" class="mp-action primary" type="button" data-mp-relay-save>${escapeHtml(ct("relay.save"))}</button></div></footer>`;
  }

  function renderCodexImportCard() {
    return `
    <section class="settings-provider-section" id="codexCredentialImportSection">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("codexImportTitle"))}</div>
          <div class="settings-provider-meta" data-settings-help-copy>${escapeHtml(mt("codexImportDescription"))}</div>
        </div>
        <button id="codexImportAuthBtn" class="settings-action-btn primary" type="button">${escapeHtml(mt("import"))}</button>
      </div>
      <textarea id="codexAuthImportText" class="settings-token-input" placeholder="${escapeAttr(mt("codexImportPlaceholder"))}"></textarea>
      <div class="settings-inline-success" data-settings-help-copy>${escapeHtml(mt("codexImportSuccess"))}</div>
    </section>
  `;
  }

  function renderCodexAccountCard(authFiles) {
    return `
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("importedCredentials"))}</div>
          <div class="settings-provider-meta" data-settings-help-copy>${escapeHtml(mt("importedCredentialsDescription"))}</div>
        </div>
        <button id="codexRefreshAuthBtn" class="settings-action-btn" type="button">${escapeHtml(mt("refreshAccounts"))}</button>
      </div>
      ${state.providerAuthMutationWarning ? `<div class="settings-inline-alert">${escapeHtml(state.providerAuthMutationWarning)}</div>` : state.providerAuthError ? `<div class="settings-inline-alert">${escapeHtml(state.providerAuthError)}</div>` : ""}
      <div class="settings-auth-list">
        ${renderCodexAccountManagementTable(authFiles, { translate: mt })}
      </div>
    </section>
  `;
  }

  function renderRelayProviderConfigCard() {
    const spec = relayProtocolSpec(getRelayProtocol());
    const provider = providerByName(spec.providerName) || { name: spec.providerName, type: spec.providerType, defaultModel: defaultModelForProtocol(spec.key), model: defaultModelForProtocol(spec.key), baseUrl: spec.key === "codex" ? "http://127.0.0.1:8317/v1" : "" };
    const modelValue = provider.defaultModel || provider.model || defaultModelForProtocol(spec.key);
    const expanded = providerConfigExpanded("relay");
    return `
    <section class="settings-provider-section relay-config-section ${expanded ? "expanded" : "collapsed"}">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("relayConfigTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(mt("relayCurrentProtocol", { help: spec.help, provider: spec.providerName, model: modelValue }))}</div>
        </div>
        <div class="settings-action-row compact-actions">
          ${renderProviderConfigToggle("relay", expanded, mt("relayConfig"))}
        </div>
      </div>
      ${state.providerConfigStatus ? `<div class="settings-inline-success">${escapeHtml(state.providerConfigStatus)}</div>` : ""}
      ${expanded ? `
        <div class="settings-collapsible-body">
          <div class="settings-provider-actions compact-actions">
            <button id="relayFetchModelsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("fetchModels"))}</button>
            <button id="relaySaveConfigBtn" class="settings-action-btn primary" type="button">${escapeHtml(mt("saveChanges"))}</button>
          </div>
          <div class="relay-form-grid">
            <label class="relay-field wide">
              <span>${escapeHtml(mt("providerName"))}</span>
              <input id="relayProviderName" class="settings-text-input" value="${escapeAttr(provider.name || spec.providerName)}" disabled>
              <small data-settings-help-copy>${escapeHtml(mt("relayProviderNameHelp", { provider: spec.providerName }))}</small>
            </label>
            <label class="relay-field wide">
              <span>${escapeHtml(mt("providerPrefix"))}</span>
              <input class="settings-text-input" value="${escapeAttr((provider.name || spec.providerName) + ":")}" disabled>
              <small data-settings-help-copy>${escapeHtml(mt("relayProviderPrefixHelp", { provider: spec.providerName, model: modelValue }))}</small>
            </label>
            <label class="relay-field wide">
              <span>${escapeHtml(mt("apiKey"))}</span>
              <input id="relayApiKey" class="settings-text-input" type="password" autocomplete="off" placeholder="${escapeAttr(mt("apiKeyPlaceholder"))}">
            </label>
            <label class="relay-field wide">
              <span>${escapeHtml(mt("baseUrl"))}</span>
              <input id="relayBaseUrl" class="settings-text-input" value="${escapeAttr(provider.baseUrl || "")}" placeholder="${escapeAttr(mt("baseUrlPlaceholder"))}">
            </label>
          </div>
          <div class="relay-field">
            <span>${escapeHtml(mt("apiProtocol"))}</span>
            <div class="relay-protocol-tabs">
              ${relayProtocolSpecs().map((item) => `
                <button class="relay-protocol-tab ${item.key === spec.key ? "active" : ""}" type="button" data-relay-protocol="${escapeAttr(item.key)}">
                  ${escapeHtml(item.label)}
                </button>
              `).join("")}
            </div>
            <small data-settings-help-copy>${escapeHtml(spec.help)}</small>
          </div>
          <div class="relay-form-grid">
            <label class="relay-field wide">
              <span>${escapeHtml(mt("httpsProxy"))}</span>
              <input class="settings-text-input" value="" placeholder="${escapeAttr(mt("httpsProxyPlaceholder"))}" disabled>
            </label>
            <label class="relay-field wide">
              <span>${escapeHtml(mt("defaultReasoningEffort"))}</span>
              <select class="settings-text-input" disabled>
                <option>${escapeHtml(mt("automatic"))}</option>
                <option>${escapeHtml(mt("low"))}</option>
                <option>${escapeHtml(mt("medium"))}</option>
                <option>${escapeHtml(mt("high"))}</option>
              </select>
            </label>
          </div>
          <div class="relay-field">
            <span>${escapeHtml(mt("customModel"))}</span>
            <div class="relay-model-row">
              <input id="relayCustomModel" class="settings-text-input" value="${escapeAttr(modelValue)}" placeholder="${escapeAttr(mt("modelId"))}">
              <input class="settings-text-input" value="${escapeAttr(modelValue)}" placeholder="${escapeAttr(mt("displayName"))}" disabled>
            </div>
            <small data-settings-help-copy>${escapeHtml(mt("customModelDescription"))}</small>
          </div>
        </div>
      ` : ""}
    </section>
  `;
  }

  function renderCustomProviderConfigCard() {
    const expanded = providerConfigExpanded("custom-provider");
    return `
    <section class="settings-provider-section custom-provider-section ${expanded ? "expanded" : "collapsed"}">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("customProviderTitle"))}</div>
          <div class="settings-provider-meta" data-settings-help-copy>${escapeHtml(mt("customProviderDescription"))}</div>
        </div>
        <div class="settings-action-row compact-actions">
          <button id="fillGroqProviderExampleBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("fillGroqExample"))}</button>
          ${renderProviderConfigToggle("custom-provider", expanded, mt("customConfig"))}
        </div>
      </div>
      ${expanded ? `
        <form id="customProviderConfigForm" class="settings-provider-config-form custom-provider-config-form settings-collapsible-body">
          <div class="settings-provider-form-grid">
            <label>${escapeHtml(mt("providerNamePrefix"))}
              <input id="customProviderName" class="settings-field" name="name" value="" placeholder="groq" autocomplete="off" />
            </label>
            <label>${escapeHtml(mt("protocol"))}
              <select id="customProviderType" class="settings-field" name="type">
                ${renderProviderTypeOptions("openai-compatible")}
              </select>
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("baseUrl"))}
              <input id="customProviderBaseUrl" class="settings-field" name="baseUrl" value="" placeholder="https://api.groq.com/openai/v1" autocomplete="off" />
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("apiKey"))}
              <input id="customProviderApiKey" class="settings-field" name="apiKey" type="password" autocomplete="off" placeholder="${escapeAttr(mt("apiKeyUserPlaceholder"))}" />
            </label>
            <label>${escapeHtml(mt("defaultModel"))}
              <input id="customProviderModel" class="settings-field" name="model" data-select-on-focus="true" value="" placeholder="openai/gpt-oss-20b" autocomplete="off" />
            </label>
            <label>${escapeHtml(mt("maxTokens"))}
              <input class="settings-field" name="maxTokens" data-select-on-focus="true" type="number" min="0" step="1" value="" placeholder="${escapeAttr(mt("maxTokensOptional"))}" />
            </label>
            <label class="settings-checkbox-field settings-form-span-2">
              <input name="apiKeyOptional" type="checkbox" />
              <span>${escapeHtml(mt("apiKeyOptional"))}</span>
            </label>
          </div>
          <div class="settings-provider-actions">
            <button class="settings-action-btn primary" type="submit" data-provider-save>${escapeHtml(mt("saveCustomProvider"))}</button>
          </div>
          <div class="settings-provider-note">${escapeHtml(mt("groqNote"))}</div>
        </form>
      ` : ""}
    </section>
  `;
  }

  function renderCodexAuthItem(item) {
    const name = authFileName(item);
    const provider = authFileProvider(item);
    const alias = typeof item === "object" && item ? (item.alias || item.email || item.account || item.account_id || item.accountID || "") : "";
    const disabled = Boolean(typeof item === "object" && item && item.disabled);
    return `
    <div class="settings-auth-item">
      <div>
        <div class="settings-auth-title">${escapeHtml(name)}</div>
        <div class="settings-auth-meta">${escapeHtml(provider)}${alias ? ` · ${escapeHtml(alias)}` : ""}</div>
      </div>
      <span class="settings-status-pill ${disabled ? "muted" : "ok"}">${escapeHtml(disabled ? mt("disabled") : mt("available"))}</span>
    </div>
  `;
  }

  function extractAuthFiles(value) {
    return normalizeCodexAccountList(value);
  }

  function authFileName(item) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return mt("unknown");
    return item.name || item.filename || item.file || item.path || item.auth_index || item.authIndex || mt("unknown");
  }

  function authFileProvider(item) {
    if (!item || typeof item !== "object") return "Codex";
    return item.provider || item.type || item.channel || "Codex";
  }

  function renderCodexStatusCard(provider) {
    const models = providerModelList(provider);
    const endpoint = provider.baseUrl || "https://chatgpt.com/backend-api/codex";
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(providerLabel(provider))}</div>
          <div class="settings-provider-meta">${escapeHtml(endpoint)}</div>
        </div>
        <span class="settings-status-pill ${provider.error ? "warn" : (provider.configured ? "ok" : "muted")}">${escapeHtml(providerStatusText(provider))}</span>
      </div>
      ${provider.error ? `<div class="settings-inline-alert">${escapeHtml(provider.error)}</div>` : provider.configured ? `<div class="settings-inline-success">${escapeHtml(mt("nativeCodexReady", { count: models.length }))}</div>` : `<div class="settings-inline-alert">${escapeHtml(mt("nativeCodexNeedsCredentials"))}</div>`}
      <div class="settings-copy-row">
        <button class="settings-action-btn subtle" type="button" data-copy-text="${escapeAttr(endpoint)}">${escapeHtml(mt("copyBaseUrl"))}</button>
      </div>
    </section>
  `;
  }

  function renderProviderCard(provider) {
    const setting = settingProviderByName(provider.name) || {};
    const type = provider.type || setting.type || "openai-compatible";
    const baseUrl = provider.baseUrl || setting.baseUrl || "";
    const model = provider.defaultModel || setting.model || "";
    const maxTokens = provider.maxTokens || setting.maxTokens || 0;
    const models = providerModelList(provider);
    const apiKeyOptional = Boolean(provider.apiKeyOptional || setting.apiKeyOptional);
    const envExample = providerEnvExample({ ...provider, type, baseUrl, defaultModel: model });
    const expanded = providerConfigExpanded(`provider:${provider.name}`);
    return `
    <section class="settings-provider-card ${expanded ? "expanded" : "collapsed"}">
      <div class="settings-provider-card-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(providerLabel(provider))}</div>
          <div class="settings-provider-meta">${escapeHtml(type)} · ${escapeHtml(providerCapabilitiesLabel(provider))} · ${escapeHtml(mt("modelCount", { count: models.length }))}</div>
        </div>
        <div class="settings-action-row compact-actions">
          <span class="settings-status-pill ${provider.error ? "warn" : (provider.configured ? "ok" : "muted")}">${escapeHtml(providerStatusText(provider))}</span>
          ${renderProviderConfigToggle(`provider:${provider.name}`, expanded, mt("config"))}
        </div>
      </div>
      <div class="settings-provider-meta path">${escapeHtml(baseUrl || mt("defaultOfficialEndpoint"))}</div>
      ${provider.configured ? `<div class="settings-inline-success compact">${escapeHtml(mt("configuredVisible"))}</div>` : `<div class="settings-inline-alert compact">${escapeHtml(mt("unconfiguredHidden"))}</div>`}
      ${provider.error ? `<div class="settings-inline-alert compact">${escapeHtml(provider.error)}</div>` : ""}
      ${expanded ? `
        <form class="settings-provider-config-form settings-collapsible-body" data-provider-name="${escapeAttr(provider.name)}">
          <div class="settings-provider-form-grid">
            <label>${escapeHtml(mt("protocol"))}
              <select class="settings-field" name="type">
                ${renderProviderTypeOptions(type)}
              </select>
            </label>
            <label>${escapeHtml(mt("defaultModel"))}
              <input class="settings-field" name="model" data-select-on-focus="true" value="${escapeAttr(model)}" placeholder="${escapeAttr(mt("defaultModelPlaceholder"))}" />
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("baseUrl"))}
              <input class="settings-field" name="baseUrl" value="${escapeAttr(baseUrl)}" placeholder="${escapeAttr(providerBaseURLPlaceholder(type, provider.profile))}" />
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("apiKey"))}
              <input class="settings-field" name="apiKey" type="password" value="" autocomplete="off" placeholder="${escapeAttr(provider.configured ? mt("apiKeyPreservePlaceholder") : mt("apiKeyPastePlaceholder"))}" />
              ${provider.apiKeyPersisted ? `<small data-settings-help-copy>${escapeHtml(mt("apiKeyPersisted", { lastFive: provider.apiKeyLastFive }))}</small>` : ""}
            </label>
            ${provider.apiKeyPersisted ? `<label class="settings-checkbox-field"><input name="clearApiKey" type="checkbox" data-provider-clear-api-key /> <span>${escapeHtml(mt("clearApiKey"))}</span></label>` : ""}
            <label>${escapeHtml(mt("maxTokens"))}
              <input class="settings-field" name="maxTokens" data-select-on-focus="true" type="number" min="0" step="1" value="${escapeAttr(maxTokens || "")}" placeholder="${escapeAttr(mt("maxTokensAnthropic"))}" />
            </label>
            <label class="settings-checkbox-field">
              <input name="apiKeyOptional" type="checkbox" ${apiKeyOptional ? "checked" : ""} />
              <span>${escapeHtml(mt("apiKeyOptional"))}</span>
            </label>
          </div>
          <div class="settings-provider-actions">
            <button class="settings-action-btn primary" type="submit" data-provider-save>${escapeHtml(mt("saveConfig"))}</button>
            <button class="settings-action-btn subtle" type="button" data-copy-text="${escapeAttr(envExample)}">${escapeHtml(mt("copyEnvExample"))}</button>
          </div>
          <div class="settings-provider-note">${escapeHtml(mt("providerConfigNote"))}</div>
        </form>
      ` : ""}
    </section>
  `;
  }

  function renderProviderTypeOptions(selected) {
    return [
      { value: "codex", label: mt("typeCodexOAuth") },
      { value: "openai-compatible", label: mt("typeOpenAICompatible") },
      { value: "openai", label: mt("typeOpenAIOfficial") },
      { value: "anthropic", label: mt("typeAnthropicOfficial") },
      { value: "gemini-interactions", label: "Gemini Interactions" },
    ].map((item) => `<option value="${escapeAttr(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  }

  function providerBaseURLPlaceholder(type, profile) {
    if (type === "codex") return "https://chatgpt.com/backend-api/codex";
    if (profile === "cliproxyapi") return "http://127.0.0.1:8317/v1";
    if (type === "openai-compatible") return "https://api.example.com/v1";
    if (type === "anthropic") return mt("anthropicOfficialEndpointPlaceholder");
    if (type === "gemini-interactions") return "https://generativelanguage.googleapis.com/v1beta/interactions";
    return mt("openaiOfficialEndpointPlaceholder");
  }

  function providerEnvExample(provider) {
    const model = provider.defaultModel || provider.model || "your-model";
    const baseURL = provider.baseUrl || providerBaseURLPlaceholder(provider.type, provider.profile);
    const rowsByProvider = {
      openai: [`export OPENAI_API_KEY="sk-..."`, `export OPENAI_MODEL="${model}"`],
      anthropic: [`export ANTHROPIC_API_KEY="sk-ant-..."`, `export ANTHROPIC_MODEL="${model}"`],
      "gemini-interactions": [`export GEMINI_API_KEY="..."`, `export GEMINI_MODEL="${model}"`, `export GEMINI_BASE_URL="${baseURL}"`],
      gemini: [`export GEMINI_API_KEY="..."`, `export GEMINI_MODEL="${model}"`, `export GEMINI_BASE_URL="${baseURL}"`],
      groq: [`export GROQ_API_KEY="gsk_..."`, `export GROQ_MODEL="${model}"`],
      cliproxyapi: [`export CLIPROXYAPI_BASE_URL="${baseURL}"`, `export CLIPROXYAPI_MODEL="${model}"`, `# ${mt("cliproxyEnvComment")}`, `export CLIPROXYAPI_API_KEY="..."`],
      "openai-compatible": [`export OPENAI_COMPATIBLE_BASE_URL="${baseURL}"`, `export OPENAI_COMPATIBLE_API_KEY="sk-..."`, `export OPENAI_COMPATIBLE_MODEL="${model}"`],
    };
    return (rowsByProvider[provider.profile] || rowsByProvider[provider.name] || rowsByProvider[provider.type] || rowsByProvider["openai-compatible"]).join("\n");
  }

  function fillGroqProviderExample() {
    if (!providerConfigExpanded("custom-provider")) {
      expandProviderConfig("custom-provider");
    }
    const form = $("customProviderConfigForm");
    if (!form) return;
    form.elements.name.value = "groq";
    form.elements.type.value = "openai-compatible";
    form.elements.baseUrl.value = "https://api.groq.com/openai/v1";
    form.elements.model.value = "openai/gpt-oss-20b";
    for (const name of ["name", "baseUrl", "model"]) {
      form.elements[name]?.setAttribute?.("data-select-on-focus", "true");
    }
    form.elements.maxTokens.value = "";
    form.elements.apiKeyOptional.checked = false;
    form.elements.apiKey.value = "";
    form.elements.apiKey.focus();
  }

  async function saveProviderConfig(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    const providerName = String(form.dataset.providerName || form.elements.name?.value || "").trim();
    const saveButton = form.querySelector("[data-provider-save]");
    const maxTokens = Number(form.elements.maxTokens?.value || 0);
    if (!providerName) throw new Error(mt("selectProviderName"));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(providerName)) throw new Error(mt("invalidProviderName"));
    const payload = {
      name: providerName,
      type: form.elements.type?.value || "openai-compatible",
      baseUrl: form.elements.baseUrl?.value.trim() || "",
      apiKey: form.elements.clearApiKey?.checked ? "" : (form.elements.apiKey?.value.trim() || ""),
      ...(form.elements.clearApiKey?.checked ? { clearApiKey: true } : {}),
      model: form.elements.model?.value.trim() || "",
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
      apiKeyOptional: Boolean(form.elements.apiKeyOptional?.checked),
    };
    if (!payload.model) throw new Error(mt("selectDefaultModel"));
    if (payload.type === "openai-compatible" && !payload.baseUrl) throw new Error(mt("missingBaseUrl"));
    form.dataset.submitting = "true";
    setButtonBusy(saveButton, true, mt("saving"));
    try {
      const response = await api(`/api/providers/${encodeURIComponent(providerName)}/config`, { method: "PUT", body: JSON.stringify(payload) });
      if (form.elements.apiKey) form.elements.apiKey.value = "";
      if (form.elements.clearApiKey) form.elements.clearApiKey.checked = false;
      state.providerConfigStatus = response.message || mt("providerConfigSaved");
      await loadSettings();
      await loadModelCatalog();
      renderModelOptions();
      refreshActiveSettingsPanel?.();
      notifyTerminal?.(`[info] ${mt("providerConfigSavedTerminal", { provider: providerLabel({ name: providerName }), message: response.message || mt("effective") })}\n`);
    } finally {
      delete form.dataset.submitting;
      setButtonBusy(saveButton, false, mt("saving"));
    }
  }

  function readAgentModelSettingsForm(form) {
    const current = agentModelSettingsState().draft;
    const subagentModels = {};
    const subagentModelPools = {};
    for (const role of agentModelRoles) {
      const preferred = String(form?.elements?.[`subagentModel_${role}`]?.value || "").trim();
      if (preferred) subagentModels[role] = preferred;
      const unrestricted = Boolean(form?.querySelector?.(`[data-agent-model-pool-all="${role}"]`)?.checked);
      if (unrestricted) continue;
      const pool = [...(form?.querySelectorAll?.(`[data-agent-model-pool-option="${role}"]:checked`) || [])]
        .map((node) => String(node.value || "").trim())
        .filter(Boolean);
      if (pool.length) subagentModelPools[role] = pool;
    }
    return normalizeAgentModelSettings({
      ...current,
      defaultModel: form?.elements?.defaultModel?.value || "",
      summaryModel: form?.elements?.summaryModel?.value || "",
      defaultReasoningEffort: form?.elements?.defaultReasoningEffort?.value || current.defaultReasoningEffort || "auto",
      subagentModels,
      subagentModelPools,
    });
  }

  function validateAgentModelSettings(draft) {
    const checks = [
      [mt("routing.defaultModel"), draft.defaultModel],
      [mt("routing.summaryModel"), draft.summaryModel],
    ];
    for (const role of agentModelRoles) {
      if (draft.subagentModels?.[role]) checks.push([mt(`routing.roles.${role}.label`), draft.subagentModels[role]]);
      for (const model of draft.subagentModelPools?.[role] || []) checks.push([mt(`routing.roles.${role}.label`), model]);
    }
    const invalid = checks.find(([, model]) => !isAgentModelReference(model));
    if (invalid) throw new Error(mt("routing.invalidModelReference", { field: invalid[0] }));
  }

  function updateAgentModelDirtyUI(dirty) {
    const badge = $("agentModelSettingsDirtyBadge");
    if (!badge) return;
    badge.classList.toggle("warn", dirty);
    badge.classList.toggle("ok", !dirty);
    badge.textContent = mt(dirty ? "routing.unsaved" : "routing.saved");
  }

  function syncAgentModelSettingsForm(form) {
    const settingsState = agentModelSettingsState();
    settingsState.draft = readAgentModelSettingsForm(form);
    settingsState.dirty = true;
    settingsState.result = null;
    updateAgentModelDirtyUI(true);
    return settingsState.draft;
  }

  function updateAgentModelPoolSummary(form, role) {
    if (!role) return;
    const unrestricted = Boolean(form.querySelector(`[data-agent-model-pool-all="${role}"]`)?.checked);
    const selectedCount = form.querySelectorAll(`[data-agent-model-pool-option="${role}"]:checked`).length;
    const summary = form.querySelector(`[data-agent-model-pool-summary="${role}"]`);
    if (!summary) return;
    summary.textContent = agentModelPoolSummary(unrestricted, selectedCount);
    summary.classList.toggle("muted", unrestricted);
    summary.classList.toggle("ok", !unrestricted);
  }

  function handleAgentModelSettingsChange(event, form) {
    const target = event.target;
    const role = target?.dataset?.agentModelPoolAll || target?.dataset?.agentRoleModel || target?.dataset?.agentModelPoolOption || "";
    if (target?.dataset?.agentModelPoolAll) {
      const unrestricted = Boolean(target.checked);
      const details = form.querySelector(`[data-agent-model-pool-details="${role}"]`);
      if (details) details.open = !unrestricted;
      form.querySelectorAll(`[data-agent-model-pool-option="${role}"]`).forEach((node) => { node.disabled = unrestricted; });
      if (!unrestricted && !form.querySelector(`[data-agent-model-pool-option="${role}"]:checked`)) {
        const preferred = String(form.elements?.[`subagentModel_${role}`]?.value || form.elements?.defaultModel?.value || "").trim();
        const preferredOption = [...form.querySelectorAll(`[data-agent-model-pool-option="${role}"]`)].find((node) => node.value === preferred);
        if (preferredOption) preferredOption.checked = true;
      }
    } else if (target?.dataset?.agentRoleModel) {
      const unrestricted = form.querySelector(`[data-agent-model-pool-all="${role}"]`)?.checked;
      if (!unrestricted && target.value) {
        const preferredOption = [...form.querySelectorAll(`[data-agent-model-pool-option="${role}"]`)].find((node) => node.value === target.value);
        if (preferredOption) preferredOption.checked = true;
      }
    }
    updateAgentModelPoolSummary(form, role);
    syncAgentModelSettingsForm(form);
  }

  async function persistDefaultReasoningEffort(value) {
    const desired = normalizeDefaultReasoningEffort(value);
    let runtimeSettings = state.settings?.runtimeSettings || {};
    if (Math.max(0, Math.trunc(Number(runtimeSettings?.revision) || 0)) < 1) return runtimeSettings;
    if (normalizeDefaultReasoningEffort(runtimeSettings.defaultReasoningEffort) === desired) return runtimeSettings;
    let request = runtimeReasoningSettingsRequest(desired, runtimeSettings);
    try {
      return await api(request.path, request.options);
    } catch (error) {
      if (error?.status !== 409) throw error;
      const latestSettings = await api("/api/settings");
      runtimeSettings = latestSettings?.runtimeSettings || {};
      state.settings = { ...(state.settings || {}), runtimeSettings };
      if (normalizeDefaultReasoningEffort(runtimeSettings.defaultReasoningEffort) === desired) return runtimeSettings;
      if (Math.max(0, Math.trunc(Number(runtimeSettings?.revision) || 0)) < 1) throw error;
      request = runtimeReasoningSettingsRequest(desired, runtimeSettings);
      return api(request.path, request.options);
    }
  }

  async function saveAgentModelSettings(form) {
    const settingsState = agentModelSettingsState();
    if (settingsState.saving) return;
    const draft = readAgentModelSettingsForm(form);
    validateAgentModelSettings(draft);
    const payload = agentModelSettingsPayload(draft);
    settingsState.draft = draft;
    settingsState.dirty = true;
    settingsState.saving = true;
    settingsState.result = null;
    refreshActiveSettingsPanel?.();
    try {
      const response = await api(state.settings?.agentModelSettingsEndpoint || "/api/runtime/agent-model-settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const savedAgent = response?.agent || payload;
      state.settings = { ...(state.settings || {}), agent: { ...(state.settings?.agent || {}), ...savedAgent } };
      const savedRuntime = await persistDefaultReasoningEffort(draft.defaultReasoningEffort);
      state.settings = { ...(state.settings || {}), runtimeSettings: savedRuntime };
      const saved = normalizeAgentModelSettings({ ...savedAgent, defaultReasoningEffort: savedRuntime?.defaultReasoningEffort || draft.defaultReasoningEffort });
      state.agentModelSettings = {
        draft: saved,
        sourceSignature: JSON.stringify(saved),
        dirty: false,
        saving: false,
        result: { tone: "success", message: mt("routing.savedMessage") },
      };
      renderModelOptions();
      notifyTerminal?.(`[info] ${mt("routing.savedMessage")}\n`);
    } catch (error) {
      const latest = agentModelSettingsState();
      latest.saving = false;
      latest.result = { tone: "attention", message: mt("routing.saveFailed", { message: error?.message || mt("unknown") }) };
      throw error;
    } finally {
      if (state.agentModelSettings) state.agentModelSettings.saving = false;
      refreshActiveSettingsPanel?.();
    }
  }

  function resetAgentModelSettings() {
    const draft = agentModelSettingsSource();
    state.agentModelSettings = {
      draft,
      sourceSignature: JSON.stringify(draft),
      dirty: false,
      saving: false,
      result: null,
    };
    refreshActiveSettingsPanel?.();
  }

  function modelAggregateByName(name) {
    return normalizeModelAggregateList(state.modelAggregates).find((aggregate) => aggregate.name === String(name || "")) || null;
  }

  function openModelAggregateEditor(name = "") {
    const aggregate = modelAggregateByName(name);
    state.modelAggregateEditor = aggregate
      ? { mode: "edit", name: aggregate.name, members: [...aggregate.members], revision: aggregate.revision }
      : { mode: "create", name: "", members: [], revision: 0 };
    refreshActiveSettingsPanel?.();
  }

  function cancelModelAggregateEditor() {
    state.modelAggregateEditor = null;
    refreshActiveSettingsPanel?.();
  }

  function readModelAggregateForm(form) {
    const name = String(form?.elements?.aggregateName?.value || "").trim();
    const members = modelAggregateMembers(form?.elements?.aggregateMembers?.value || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)) throw new Error(mt("routing.aggregateNameInvalid"));
    if (!members.length) throw new Error(mt("routing.aggregateMembersRequired"));
    if (new Set(members).size !== members.length) throw new Error(mt("routing.aggregateMembersUnique"));
    if (members.some((member) => !/^[^:\s]+:.+$/.test(member) || member.toLowerCase().startsWith("aggregate:"))) throw new Error(mt("routing.aggregateMembersInvalid"));
    return { name, members };
  }

  async function saveModelAggregate(form) {
    if (state.modelAggregateBusy) return;
    const values = readModelAggregateForm(form);
    const current = state.modelAggregateEditor || {};
    const editing = current.mode === "edit";
    const aggregate = editing ? modelAggregateByName(current.name) || current : { revision: 0 };
    state.modelAggregateEditor = { mode: editing ? "edit" : "create", name: values.name, members: values.members, revision: Math.max(0, Math.trunc(Number(aggregate.revision) || 0)) };
    state.modelAggregateBusy = true;
    refreshActiveSettingsPanel?.();
    try {
      const request = modelAggregateActionRequest("save", aggregate, { ...values, revision: aggregate.revision || 0 });
      const response = await api(request.path, request.options);
      const saved = normalizeModelAggregateList([response])[0];
      const remaining = normalizeModelAggregateList(state.modelAggregates).filter((item) => item.name !== saved.name);
      state.modelAggregates = [...remaining, saved].sort((left, right) => left.name.localeCompare(right.name));
      state.modelAggregatesLoaded = true;
      state.modelAggregatesError = "";
      state.modelAggregateEditor = null;
      notifyTerminal?.(`[info] ${mt("routing.aggregateSavedMessage", { name: saved.name })}\n`);
    } catch (error) {
      if (error?.status === 409) {
        await loadModelAggregates({ force: true });
        const latest = modelAggregateByName(values.name);
        state.modelAggregateEditor = { mode: latest ? "edit" : "create", name: values.name, members: values.members, revision: latest?.revision || 0 };
        throw new Error(mt("routing.aggregateConflict"));
      }
      throw error;
    } finally {
      state.modelAggregateBusy = false;
      refreshActiveSettingsPanel?.();
    }
  }

  async function deleteModelAggregate(name) {
    if (state.modelAggregateBusy) return;
    const aggregate = modelAggregateByName(name);
    if (!aggregate) return;
    if (typeof globalThis.confirm === "function" && !globalThis.confirm(mt("routing.deleteAggregateConfirm", { name: aggregate.name }))) return;
    state.modelAggregateBusy = true;
    refreshActiveSettingsPanel?.();
    try {
      const request = modelAggregateActionRequest("delete", aggregate, { revision: aggregate.revision });
      await api(request.path, request.options);
      state.modelAggregates = normalizeModelAggregateList(state.modelAggregates).filter((item) => item.name !== aggregate.name);
      state.modelAggregatesLoaded = true;
      if (state.modelAggregateEditor?.name === aggregate.name) state.modelAggregateEditor = null;
      notifyTerminal?.(`[info] ${mt("routing.aggregateDeletedMessage", { name: aggregate.name })}\n`);
    } catch (error) {
      if (error?.status === 409) {
        await loadModelAggregates({ force: true });
        throw new Error(mt("routing.aggregateConflict"));
      }
      throw error;
    } finally {
      state.modelAggregateBusy = false;
      refreshActiveSettingsPanel?.();
    }
  }

  function bindModelSettingsActions() {
    $("settingsRefreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
    $("settingsOpenLoginBtn")?.addEventListener("click", () => openSettingsModal?.("providers"));
    $("settingsClearPreferredModelBtn")?.addEventListener("click", () => applyPreferredModel("").catch(showError));
    $("settingsShowConfiguredModelsBtn")?.addEventListener("click", clearVisibleConfiguredModelHides);
    $("resetAgentModelSettingsBtn")?.addEventListener("click", resetAgentModelSettings);
    const root = $("settingsContentBody");
    const form = $("agentModelSettingsForm");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveAgentModelSettings(form).catch(showError);
    });
    form?.addEventListener("change", (event) => handleAgentModelSettingsChange(event, form));
    root?.querySelectorAll("[data-toggle-model-visibility]").forEach((node) => {
      node.addEventListener("click", () => setModelHidden(node.dataset.toggleModelVisibility, !isModelHidden(node.dataset.toggleModelVisibility)));
    });
    root?.querySelectorAll("[data-apply-model]").forEach((node) => {
      node.addEventListener("click", () => applyPreferredModel(node.dataset.applyModel).catch(showError));
    });
    root?.querySelector("[data-model-aggregate-add]")?.addEventListener("click", () => openModelAggregateEditor());
    root?.querySelectorAll("[data-model-aggregate-edit]").forEach((node) => node.addEventListener("click", () => openModelAggregateEditor(node.dataset.modelAggregateEdit)));
    root?.querySelectorAll("[data-model-aggregate-delete]").forEach((node) => node.addEventListener("click", () => deleteModelAggregate(node.dataset.modelAggregateDelete).catch(showError)));
    root?.querySelector("[data-model-aggregate-cancel]")?.addEventListener("click", cancelModelAggregateEditor);
    const aggregateForm = $("modelAggregateForm");
    aggregateForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveModelAggregate(aggregateForm).catch(showError);
    });
    loadModelAggregates().catch(showError);
  }

  let providerConsoleEventRoot = null;
  let providerConsoleFocusReturn = null;

  function scheduleProviderConsoleFocus(callback) {
    const schedule = globalThis.queueMicrotask || ((work) => Promise.resolve().then(work));
    schedule(callback);
  }

  function providerConsoleLayer() {
    return providerConsoleEventRoot?.querySelector?.('[role="dialog"][aria-modal="true"]') || null;
  }

  function focusProviderConsoleLayer() {
    const layer = providerConsoleLayer();
    if (!layer) return;
    const [first] = providerConsoleFocusableElements(layer);
    (first || layer).focus?.();
  }

  function rememberProviderConsoleFocus(trigger) {
    const card = trigger?.closest?.("[data-mp-provider-card]");
    providerConsoleFocusReturn = {
      node: trigger || null,
      cardName: card?.dataset?.mpProviderCard || "",
      opensTypes: Boolean(trigger?.closest?.("[data-mp-open-types]")),
      opensRelay: Boolean(trigger?.closest?.("[data-mp-open-relay]")),
    };
  }

  function resolveProviderConsoleFocusReturn() {
    const saved = providerConsoleFocusReturn;
    if (!saved) return null;
    if (saved.node?.isConnected !== false) return saved.node;
    if (!providerConsoleEventRoot) return null;
    if (saved.cardName) {
      return [...providerConsoleEventRoot.querySelectorAll("[data-mp-provider-card]")]
        .find((node) => node.dataset?.mpProviderCard === saved.cardName) || null;
    }
    if (saved.opensTypes) return providerConsoleEventRoot.querySelector("[data-mp-open-types]");
    if (saved.opensRelay) return providerConsoleEventRoot.querySelector("[data-mp-open-relay]");
    return null;
  }

  function restoreProviderConsoleLayerFocus() {
    const target = resolveProviderConsoleFocusReturn();
    providerConsoleFocusReturn = null;
    if (target) scheduleProviderConsoleFocus(() => restoreProviderConsoleFocus(target));
  }

  function focusCodexConsolePage() {
    const page = providerConsoleEventRoot?.querySelector?.(".codex-account-console");
    const backButton = page?.querySelector?.("[data-mp-close-codex-page]");
    (backButton || page)?.focus?.();
  }

  function focusAnthropicConsolePage() {
    const page = providerConsoleEventRoot?.querySelector?.(".anthropic-account-console");
    const backButton = page?.querySelector?.("[data-mp-close-anthropic-page]");
    (backButton || page)?.focus?.();
  }

  function focusProviderCreatePage() {
    const page = providerConsoleEventRoot?.querySelector?.(".mp-provider-create-page");
    const backButton = page?.querySelector?.("[data-mp-close-drawer]");
    (backButton || page)?.focus?.();
  }

  function focusProviderTestDialog() {
    const dialog = providerConsoleEventRoot?.querySelector?.('[role="dialog"][aria-modal="true"].mp-provider-test-dialog');
    const prompt = dialog?.querySelector?.("[data-mp-test-prompt]");
    (prompt || dialog)?.focus?.();
  }

  function refreshProviderConsole({ focusLayer = false, focusCodex = false, focusAnthropic = false, focusCreate = false, focusTest = false, restoreFocus = false } = {}) {
    refreshActiveSettingsPanel?.();
    if (focusLayer) scheduleProviderConsoleFocus(focusProviderConsoleLayer);
    if (focusCodex) scheduleProviderConsoleFocus(focusCodexConsolePage);
    if (focusAnthropic) scheduleProviderConsoleFocus(focusAnthropicConsolePage);
    if (focusCreate) scheduleProviderConsoleFocus(focusProviderCreatePage);
    if (focusTest) scheduleProviderConsoleFocus(focusProviderTestDialog);
    if (restoreFocus) restoreProviderConsoleLayerFocus();
  }

  function closeProviderConsoleLayer() {
    const consoleState = providerConsoleState();
    if (consoleState.testOpen) {
      consoleState.testOpen = false;
      consoleState.test = { prompt: "", result: null };
      refreshProviderConsole({ restoreFocus: true });
      return true;
    }
    if (consoleState.modal) {
      consoleState.modal = "";
      refreshProviderConsole({ restoreFocus: true });
      return true;
    }
    if (consoleState.drawer) {
      consoleState.drawer = "";
      consoleState.mode = "";
      consoleState.type = "";
      consoleState.providerName = "";
      consoleState.draft = null;
      consoleState.dirty = false;
      refreshProviderConsole({ restoreFocus: true });
      return true;
    }
    if (consoleState.view === "codex" || consoleState.view === "anthropic") {
      consoleState.view = "providers";
      consoleState.mode = "";
      consoleState.type = "";
      consoleState.providerName = "";
      consoleState.codexEdit = null;
      consoleState.anthropicEdit = null;
      setProviderConsoleResult("");
      refreshProviderConsole({ restoreFocus: true });
      return true;
    }
    return false;
  }

  function openCodexConsolePage(provider = {}) {
    const consoleState = providerConsoleState();
    const normalized = normalizeConsoleProvider(provider || createProviderDraft("codex"));
    consoleState.view = "codex";
    consoleState.modal = "";
    consoleState.drawer = "";
    consoleState.mode = "codex";
    consoleState.type = "codex";
    consoleState.providerName = normalized.name || "codex";
    consoleState.draft = createProviderDraft("codex", normalized);
    consoleState.dirty = false;
    consoleState.codexEdit = null;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusCodex: true });
    if (!state.providerAuthLoading) loadProviderAuthFiles({ silent: true }).catch(showError);
  }

  function openAnthropicConsolePage(provider = {}) {
    const consoleState = providerConsoleState();
    const normalized = normalizeConsoleProvider(provider || createProviderDraft("anthropic"));
    consoleState.view = "anthropic";
    consoleState.modal = "";
    consoleState.drawer = "";
    consoleState.mode = "anthropic";
    consoleState.type = "anthropic";
    consoleState.providerName = normalized.name || "anthropic";
    consoleState.draft = createProviderDraft("anthropic", normalized);
    consoleState.dirty = false;
    consoleState.anthropicEdit = null;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusAnthropic: true });
    if (!state.anthropicAccountsLoading) loadAnthropicAccounts({ silent: true }).catch(showError);
  }

  function openProviderConsoleDrawer(provider) {
    const normalized = normalizeConsoleProvider(provider || {});
    if (normalized.type === "codex" || normalized.name === "codex") {
      openCodexConsolePage(normalized);
      return;
    }
    if (isAnthropicAccountProvider(normalized)) {
      openAnthropicConsolePage(normalized);
      return;
    }
    const consoleState = providerConsoleState();
    consoleState.view = "providers";
    consoleState.modal = "";
    consoleState.drawer = "provider";
    consoleState.mode = "edit";
    consoleState.type = normalized.type;
    consoleState.providerName = normalized.name;
    consoleState.draft = createProviderDraft(normalized.type, normalized);
    consoleState.dirty = false;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusCreate: true });
  }

  function openProviderConsoleType(type = "openai-compatible") {
    const draft = createProviderDraft(type);
    if (type === "codex") {
      openCodexConsolePage(draft);
      return;
    }
    if (type === "anthropic") {
      openAnthropicConsolePage(draft);
      return;
    }
    const consoleState = providerConsoleState();
    consoleState.view = "providers";
    consoleState.modal = "";
    consoleState.drawer = "provider";
    consoleState.mode = "create";
    consoleState.type = type;
    consoleState.providerName = draft.name;
    consoleState.draft = draft;
    consoleState.dirty = false;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusCreate: true });
  }

  function openRelayConsoleDrawer() {
    const consoleState = providerConsoleState();
    consoleState.view = "providers";
    consoleState.modal = "";
    consoleState.drawer = "relay";
    consoleState.mode = "relay";
    consoleState.type = "relay";
    consoleState.providerName = "";
    consoleState.draft = null;
    consoleState.dirty = false;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusLayer: true });
  }

  function providerConsoleBusy(key) {
    return Boolean(providerConsoleState().busy?.[key]);
  }

  async function runProviderConsoleBusy(key, work) {
    const consoleState = providerConsoleState();
    if (consoleState.busy?.[key]) return;
    consoleState.busy = { ...(consoleState.busy || {}), [key]: true };
    refreshProviderConsole();
    try {
      return await work();
    } finally {
      const nextBusy = { ...(providerConsoleState().busy || {}) };
      delete nextBusy[key];
      providerConsoleState().busy = nextBusy;
      refreshProviderConsole();
    }
  }

  async function refreshProviderDataAfterMutation(successMessage) {
    let refreshFailed = false;
    try {
      await loadSettings();
    } catch {
      refreshFailed = true;
    }
    try {
      await loadModelCatalog();
    } catch {
      refreshFailed = true;
    }
    if (state.modelCatalog?.error) refreshFailed = true;
    renderModelOptions();
    if (refreshFailed) {
      const warning = ct("messages.mutationRefreshWarning", { message: ct("messages.requestFailed") });
      setProviderConsoleResult(warning, "attention");
      notifyTerminal?.(`[warn] ${warning}\n`);
    } else {
      setProviderConsoleResult(successMessage, "success");
      notifyTerminal?.(`[info] ${successMessage}\n`);
    }
    refreshProviderConsole();
  }

  function consoleDraftFromForm(form) {
    const current = providerConsoleState();
    return providerConsoleDraftFromForm(current.draft || {}, form, current.type);
  }

  function validateConsoleDraft(draft, { requireModel = true } = {}) {
    if (!draft.name) throw new Error(mt("selectProviderName"));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(draft.name)) throw new Error(mt("invalidProviderName"));
    if (requireModel && !draft.model) throw new Error(mt("selectDefaultModel"));
    if (draft.type === "openai-compatible" && !draft.baseUrl) throw new Error(mt("missingBaseUrl"));
  }

  function consoleDraftCanDiscoverModels(draft) {
    if (!draft || draft.type === "codex") return false;
    if (draft.type === "openai-compatible" && !draft.baseUrl) return false;
    const current = providerConsoleState();
    const existing = providerByName(current.providerName || draft.name);
    return Boolean(draft.apiKey || draft.apiKeyOptional || existing?.configured);
  }

  async function discoverConsoleProviderModels(form, { automatic = false } = {}) {
    const consoleState = providerConsoleState();
    const rawDraft = consoleDraftFromForm(form);
    const draft = { ...rawDraft, ...providerConfigPayload(rawDraft) };
    validateConsoleDraft(draft, { requireModel: false });
    if (!consoleDraftCanDiscoverModels(draft) || providerConsoleBusy(`models:${draft.name}`)) return false;
    consoleState.draft = draft;
    consoleState.dirty = true;
    await runProviderConsoleBusy(`models:${draft.name}`, async () => {
      try {
        const request = providerConsoleRequest("test", null, draft);
        const response = await api(request.path, request.options);
        const preflight = providerPreflightResult(response, ct);
        if (preflight.tone !== "success") {
          setProviderConsoleResult(preflight.message, preflight.tone);
          notifyTerminal?.(`[${preflight.terminalLevel}] ${preflight.message}\n`);
          return;
        }
        const discovery = providerModelDiscovery(response, draft.model);
        if (!discovery.models.length) {
          const message = ct("messages.noModelsDiscovered");
          setProviderConsoleResult(message, "attention");
          notifyTerminal?.(`[warn] ${message}\n`);
          return;
        }
        consoleState.draft = {
          ...draft,
          models: discovery.models,
          model: discovery.selectedModel,
        };
        const message = ct(automatic ? "messages.modelsDiscoveredAutomatically" : "messages.modelsDiscovered", {
          count: discovery.models.length,
          model: discovery.selectedModel,
        });
        setProviderConsoleResult(message, "success");
        notifyTerminal?.(`[info] ${message}\n`);
      } catch {
        const message = ct("messages.currentDraftTestFailed", { message: ct("messages.requestFailed") });
        setProviderConsoleResult(message, "attention");
        notifyTerminal?.(`[warn] ${message}\n`);
      }
    });
    return true;
  }

  function openProviderMessageTest(form) {
    const consoleState = providerConsoleState();
    const rawDraft = consoleDraftFromForm(form);
    const draft = { ...rawDraft, ...providerConfigPayload(rawDraft) };
    validateConsoleDraft(draft);
    consoleState.draft = draft;
    consoleState.testOpen = true;
    consoleState.test = {
      prompt: consoleState.test?.prompt || ct("test.defaultPrompt"),
      result: null,
    };
    refreshProviderConsole({ focusTest: true });
  }

  async function sendProviderMessageTest(form) {
    const consoleState = providerConsoleState();
    const providerForm = providerConsoleEventRoot?.querySelector?.("[data-mp-provider-form]");
    const rawDraft = providerForm ? consoleDraftFromForm(providerForm) : (consoleState.draft || {});
    const draft = { ...rawDraft, ...providerConfigPayload(rawDraft) };
    const prompt = String(form?.elements?.prompt?.value || "").trim();
    validateConsoleDraft(draft);
    if (!prompt) throw new Error(ct("test.promptRequired"));
    if (!draft.name || providerConsoleBusy(`message-test:${draft.name}`)) return;
    consoleState.draft = draft;
    consoleState.test = { ...(consoleState.test || {}), prompt, result: null };
    await runProviderConsoleBusy(`message-test:${draft.name}`, async () => {
      try {
        const request = providerConsoleRequest("message-test", null, { ...draft, prompt });
        const response = await api(request.path, request.options);
        const success = response?.success === true;
        const result = {
          success,
          tone: success ? "success" : "attention",
          output: success ? String(response?.output || "") : "",
          message: success
            ? ct("test.successMessage", { model: response?.model || draft.model })
            : String(response?.message || ct("test.failureMessage")),
        };
        consoleState.test = { ...(consoleState.test || {}), prompt, result };
        notifyTerminal?.(`[${success ? "info" : "warn"}] ${result.message}\n`);
      } catch (error) {
        const message = error?.message || ct("test.failureMessage");
        consoleState.test = {
          ...(consoleState.test || {}),
          prompt,
          result: { success: false, tone: "attention", message },
        };
        notifyTerminal?.(`[warn] ${message}\n`);
      }
    });
  }

  async function testConsoleProvider(form) {
    const consoleState = providerConsoleState();
    const rawDraft = consoleDraftFromForm(form);
    const draft = { ...rawDraft, ...providerConfigPayload(rawDraft) };
    validateConsoleDraft(draft);
    if (!draft.name || providerConsoleBusy(`test:${draft.name}`)) return;
    consoleState.draft = draft;
    await runProviderConsoleBusy(`test:${draft.name}`, async () => {
      try {
        const request = providerConsoleRequest("test", null, draft);
        const response = await api(request.path, request.options);
        const preflight = providerPreflightResult(response, ct);
        setProviderConsoleResult(preflight.message, preflight.tone);
        notifyTerminal?.(`[${preflight.terminalLevel}] ${preflight.message}\n`);
      } catch {
        const message = ct("messages.currentDraftTestFailed", { message: ct("messages.requestFailed") });
        setProviderConsoleResult(message, "attention");
        notifyTerminal?.(`[warn] ${message}\n`);
      }
    });
  }

  async function saveConsoleProvider(form) {
    const consoleState = providerConsoleState();
    const rawDraft = consoleDraftFromForm(form);
    const draft = { ...rawDraft, ...providerConfigPayload(rawDraft) };
    validateConsoleDraft(draft);
    if (providerConsoleBusy(`save:${draft.name}`)) return;
    consoleState.draft = draft;
    await runProviderConsoleBusy(`save:${draft.name}`, async () => {
      let saved = false;
      try {
        const originalName = consoleState.mode === "edit"
          ? String(consoleState.providerName || draft.name).trim()
          : String(draft.name).trim();
        const configRequest = providerConsoleRequest("config", { name: originalName }, { ...providerConfigPayload(draft), pathName: originalName });
        await api(configRequest.path, configRequest.options);
        saved = true;
        consoleState.providerName = draft.name;
        consoleState.draft = { ...draft, apiKey: "" };
        consoleState.dirty = false;
        const enableRequest = providerConsoleRequest("toggle", { name: draft.name, defaultModel: draft.model }, { enabled: true, model: draft.model });
        await api(enableRequest.path, enableRequest.options);
        await refreshProviderDataAfterMutation(ct("messages.providerSavedAndEnabled", { provider: providerDisplayName(draft) }));
      } catch {
        const message = saved
          ? ct("messages.providerSavedEnableFailed")
          : ct("messages.providerSaveFailed");
        setProviderConsoleResult(message, "attention");
        notifyTerminal?.(`[warn] ${message}\n`);
        refreshProviderConsole();
      }
    });
  }

  async function toggleConsoleProvider(name) {
    const provider = providerByName(name);
    if (!provider || providerConsoleBusy(`toggle:${name}`) || providerConsoleBusy(`delete:${name}`)) return;
    const enabled = !Boolean(provider.enabled);
    const model = String(provider.defaultModel || provider.model || "").trim();
    const displayName = providerDisplayName(provider);
    await runProviderConsoleBusy(`toggle:${name}`, async () => {
      const request = providerConsoleRequest("toggle", provider, { enabled, model });
      await api(request.path, request.options);
      await refreshProviderDataAfterMutation(ct(enabled ? "messages.providerStarted" : "messages.providerStopped", { provider: displayName }));
    });
  }

  async function deleteConsoleProvider(name) {
    const provider = providerByName(name);
    if (!provider || !isProviderDeletable(provider) || providerConsoleBusy(`delete:${name}`) || providerConsoleBusy(`toggle:${name}`)) return;
    if (!globalThis.confirm?.(ct("messages.deleteProviderConfirm", { provider: providerDisplayName(provider) }))) return;
    await runProviderConsoleBusy(`delete:${name}`, async () => {
      const request = providerConsoleRequest("delete", provider);
      await api(request.path, request.options);
      const consoleState = providerConsoleState();
      consoleState.drawer = "";
      consoleState.mode = "";
      consoleState.type = "";
      consoleState.providerName = "";
      consoleState.draft = null;
      consoleState.dirty = false;
      await refreshProviderDataAfterMutation(ct("messages.providerDeleted", { provider: providerDisplayName(provider) }));
      restoreProviderConsoleLayerFocus();
    });
  }

  function providerDisplayName(provider) {
    if (provider?.type === "codex" || provider?.name === "codex") return "Codex OAuth";
    if (provider?.name === "ollama") return "Ollama";
    return provider?.name || provider?.type || ct("labels.provider");
  }

  function updateProviderConsoleDraftFromEvent(event) {
    const target = event.target;
    const form = target?.closest?.("[data-mp-provider-form]");
    if (!form || (!target?.name && !target?.matches?.("[data-mp-model-choice]"))) return false;
    const draft = syncProviderConsoleDraft(providerConsoleState(), form);
    if (!draft) return false;
    const example = form.querySelector?.("[data-mp-model-example]");
    if (example) {
      const value = `${draft.name || "provider"}:${draft.model || "your-model"}`;
      if ("value" in example) example.value = value;
      else example.textContent = value;
    }
    return true;
  }

  function handleProviderConsoleFocus(event) {
    selectProviderConsoleFieldOnFocus(event.target);
  }

  function handleProviderConsoleInput(event) {
    const rawTarget = event.target;
    if (rawTarget?.matches?.("[data-mp-test-prompt]")) {
      providerConsoleState().test = {
        ...(providerConsoleState().test || {}),
        prompt: rawTarget.value || "",
      };
      return;
    }
    if (rawTarget?.matches?.("[data-anthropic-profile]")) {
      const consoleState = providerConsoleState();
      consoleState.anthropicProfile = rawTarget.value || "";
      const form = rawTarget.closest?.("[data-anthropic-account-form]");
      const command = anthropicProfileLoginCommand(consoleState.anthropicProfile);
      const commandNode = form?.querySelector?.("[data-anthropic-command]");
      const copyButton = form?.querySelector?.("[data-anthropic-copy-command]");
      if (commandNode) commandNode.textContent = command;
      if (copyButton) copyButton.dataset.anthropicCopyCommand = command;
      return;
    }
    if (rawTarget?.matches?.("[data-anthropic-alias]")) {
      providerConsoleState().anthropicAlias = rawTarget.value || "";
      return;
    }
    if (rawTarget?.matches?.("[data-anthropic-priority]")) {
      providerConsoleState().anthropicPriority = rawTarget.value || "";
      return;
    }
    if (rawTarget?.dataset?.anthropicEditAlias) {
      const edit = providerConsoleState().anthropicEdit;
      if (edit?.id === rawTarget.dataset.anthropicEditAlias) edit.alias = rawTarget.value || "";
      return;
    }
    if (rawTarget?.dataset?.anthropicEditPriority) {
      const edit = providerConsoleState().anthropicEdit;
      if (edit?.id === rawTarget.dataset.anthropicEditPriority) edit.priority = rawTarget.value || "";
      return;
    }
    if (rawTarget?.matches?.("[data-codex-import-draft]")) {
      providerConsoleState().codexImportDraft = rawTarget.value || "";
      return;
    }
    if (rawTarget?.dataset?.codexEditAlias) {
      const edit = providerConsoleState().codexEdit;
      if (edit?.id === rawTarget.dataset.codexEditAlias) edit.alias = rawTarget.value || "";
      return;
    }
    if (rawTarget?.dataset?.codexEditPriority) {
      const edit = providerConsoleState().codexEdit;
      if (edit?.id === rawTarget.dataset.codexEditPriority) edit.priority = rawTarget.value || "";
      return;
    }
    if (updateProviderConsoleDraftFromEvent(event)) return;
    const target = rawTarget?.closest?.("[data-mp-provider-search]");
    if (!target) return;
    providerConsoleState().search = target.value || "";
    refreshProviderConsole();
  }

  function handleProviderConsoleChange(event) {
    const target = event.target;
    const form = target?.closest?.("[data-mp-provider-form]");
    if (target?.matches?.("[data-mp-model-choice]") && form?.elements?.model) {
      form.elements.model.value = target.value || "";
    } else if (target?.name === "model" && form) {
      const choice = form.querySelector?.("[data-mp-model-choice]");
      if (choice && choice.value !== target.value) choice.value = "";
    }
    if (target?.matches?.("[data-mp-clear-api-key]") && target.checked) {
      if (!globalThis.confirm?.(ct("messages.clearApiKeyConfirm"))) {
        target.checked = false;
      }
    }
    const updated = updateProviderConsoleDraftFromEvent(event);
    if (!updated || !["baseUrl", "apiKey", "clearApiKey"].includes(target?.name)) return;
    if (!form) return;
    const draft = providerConsoleState().draft;
    if (consoleDraftCanDiscoverModels(draft)) {
      discoverConsoleProviderModels(form, { automatic: true }).catch(showError);
    }
  }

  function handleProviderConsoleKeydown(event) {
    const layer = event.target?.closest?.('[role="dialog"][aria-modal="true"]');
    if (layer && trapProviderConsoleFocus(event, layer)) return;
    if (event.key === "Escape" && closeProviderConsoleLayer()) {
      event.preventDefault();
      return;
    }
    const card = event.target?.closest?.("[data-mp-provider-card], [data-mp-open-relay]");
    if (shouldOpenProviderCardFromKeyboard(event, card)) {
      event.preventDefault();
      rememberProviderConsoleFocus(card);
      if (card.dataset.mpOpenRelay !== undefined) openRelayConsoleDrawer();
      else openProviderConsoleDrawer(providerByName(card.dataset.mpProviderCard));
    }
  }

  function handleProviderConsoleSubmit(event) {
    const testForm = event.target?.closest?.("[data-mp-provider-test-form]");
    if (testForm) {
      event.preventDefault();
      sendProviderMessageTest(testForm).catch(showError);
      return;
    }
    const anthropicAccountForm = event.target?.closest?.("[data-anthropic-account-form]");
    if (anthropicAccountForm) {
      event.preventDefault();
      createAnthropicAccount(anthropicAccountForm).catch(showError);
      return;
    }
    const form = event.target?.closest?.("[data-mp-provider-form]");
    if (!form) return;
    event.preventDefault();
    saveConsoleProvider(form).catch(showError);
  }

  function handleProviderConsoleClick(event) {
    const target = event.target?.closest?.("button, [data-mp-provider-card], [data-mp-open-relay], [data-mp-backdrop]");
    if (!target) return;
    const consoleState = providerConsoleState();
    if (target.dataset.mpBackdrop && event.target === target) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.mpCloseCodexPage !== undefined || target.dataset.mpCloseAnthropicPage !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.anthropicAddMode) {
      consoleState.anthropicAddMode = target.dataset.anthropicAddMode === "api_key" ? "api_key" : "profile";
      refreshProviderConsole();
      scheduleProviderConsoleFocus(() => providerConsoleEventRoot?.querySelector?.("[data-anthropic-account-form] input:not([type=hidden])")?.focus?.());
      return;
    }
    if (target.dataset.anthropicFocusAdd !== undefined) {
      providerConsoleEventRoot?.querySelector?.("#anthropic-add-account")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      scheduleProviderConsoleFocus(() => providerConsoleEventRoot?.querySelector?.("[data-anthropic-account-form] input:not([type=hidden])")?.focus?.());
      return;
    }
    if (target.dataset.anthropicCopyCommand !== undefined) {
      copyText?.(target.dataset.anthropicCopyCommand || "");
      setProviderConsoleResult(mt("anthropic.commandCopied"), "success");
      refreshProviderConsole();
      return;
    }
    if (target.dataset.anthropicRefresh !== undefined) {
      loadAnthropicAccounts().catch(showError);
      return;
    }
    if (target.dataset.anthropicEdit) {
      const id = target.dataset.anthropicEdit;
      const account = anthropicAccountById(id);
      if (!account || account.managed === false) return;
      consoleState.anthropicEdit = { id, alias: String(account.alias || ""), priority: finiteNumber(account.priority, 100) };
      refreshProviderConsole();
      scheduleProviderConsoleFocus(() => [...(providerConsoleEventRoot?.querySelectorAll?.("[data-anthropic-edit-alias]") || [])].find((node) => node.dataset?.anthropicEditAlias === id)?.focus?.());
      return;
    }
    if (target.dataset.anthropicEditCancel) {
      if (consoleState.anthropicEdit?.id === target.dataset.anthropicEditCancel) consoleState.anthropicEdit = null;
      refreshProviderConsole();
      return;
    }
    if (target.dataset.anthropicSave) {
      saveAnthropicAccount(target.dataset.anthropicSave, target).catch(showError);
      return;
    }
    if (target.dataset.anthropicSync) {
      syncAnthropicAccount(target.dataset.anthropicSync, target).catch(showError);
      return;
    }
    if (target.dataset.anthropicToggle) {
      toggleAnthropicAccount(target.dataset.anthropicToggle, target.dataset.disabled === "true", target).catch(showError);
      return;
    }
    if (target.dataset.anthropicDelete) {
      deleteAnthropicAccount(target.dataset.anthropicDelete, target).catch(showError);
      return;
    }
    if (target.dataset.mpCloseTest !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.mpCloseModal !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.mpCloseDrawer !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.codexEdit) {
      const id = target.dataset.codexEdit;
      const account = extractAuthFiles(state.providerAuthFiles).find((item) => String(item?.id || item?.auth_index || item?.authIndex || item?.name || "") === id);
      if (!account) return;
      consoleState.codexEdit = {
        id,
        alias: String(account.alias || ""),
        priority: finiteNumber(account.priority, 100),
      };
      refreshProviderConsole();
      scheduleProviderConsoleFocus(() => {
        const field = [...(providerConsoleEventRoot?.querySelectorAll?.("[data-codex-edit-alias]") || [])]
          .find((node) => node.dataset?.codexEditAlias === id);
        field?.focus?.();
        field?.select?.();
      });
      return;
    }
    if (target.dataset.codexEditCancel) {
      if (consoleState.codexEdit?.id === target.dataset.codexEditCancel) consoleState.codexEdit = null;
      refreshProviderConsole();
      return;
    }
    if (target.dataset.mpOpenTypes !== undefined) {
      rememberProviderConsoleFocus(target);
      openProviderConsoleType();
      return;
    }
    if (target.dataset.mpSelectType) {
      openProviderConsoleType(target.dataset.mpSelectType);
      return;
    }
    if (target.dataset.mpCategory) {
      consoleState.category = target.dataset.mpCategory;
      refreshProviderConsole();
      return;
    }
    if (target.dataset.mpProviderToggle) {
      toggleConsoleProvider(target.dataset.mpProviderToggle).catch(showError);
      return;
    }
    if (target.dataset.mpProviderOpen) {
      rememberProviderConsoleFocus(target);
      openProviderConsoleDrawer(providerByName(target.dataset.mpProviderOpen));
      return;
    }
    if (target.dataset.mpProviderCard) {
      rememberProviderConsoleFocus(target);
      openProviderConsoleDrawer(providerByName(target.dataset.mpProviderCard));
      return;
    }
    if (target.dataset.mpOpenRelay !== undefined) {
      rememberProviderConsoleFocus(target);
      openRelayConsoleDrawer();
      return;
    }
    if (target.dataset.mpFetchModels !== undefined) {
      const form = target.closest?.("[data-mp-provider-form]");
      if (form) discoverConsoleProviderModels(form).catch(showError);
      else {
        runProviderConsoleBusy("refresh", async () => {
          await refreshModelCatalog();
          setProviderConsoleResult(ct("messages.modelsRefreshed"), "success");
        }).catch(showError);
      }
      return;
    }
    if (target.dataset.mpRefreshModels !== undefined) {
      runProviderConsoleBusy("refresh", async () => {
        await refreshModelCatalog();
        setProviderConsoleResult(ct("messages.modelsRefreshed"), "success");
      }).catch(showError);
      return;
    }
    if (target.dataset.mpTestProvider !== undefined) {
      const form = target.closest("[data-mp-provider-form]");
      if (form) {
        rememberProviderConsoleFocus(target);
        openProviderMessageTest(form);
      }
      return;
    }
    if (target.dataset.mpDeleteProvider) {
      deleteConsoleProvider(target.dataset.mpDeleteProvider).catch(showError);
      return;
    }
    if (target.dataset.mpRelaySave !== undefined) {
      saveRelayProviderConfig().catch(showError);
      return;
    }
    if (target.dataset.mpCodexBrowserLogin !== undefined) {
      startCodexBrowserLogin().catch(showError);
      return;
    }
    if (target.dataset.mpCodexBrowserOpen !== undefined) {
      reopenCodexBrowserLogin();
      return;
    }
    if (target.dataset.mpCodexBrowserCancel !== undefined) {
      cancelCodexBrowserLogin().catch(showError);
      return;
    }
    if (target.dataset.mpCodexImport !== undefined) {
      importCodexAuthFile().catch(showError);
      return;
    }
    if (target.dataset.mpCodexRefresh !== undefined) {
      loadProviderAuthFiles().catch(showError);
      return;
    }
    if (target.dataset.codexSave) {
      saveCodexAccount(target.dataset.codexSave, target).catch(showError);
      return;
    }
    if (target.dataset.codexSync) {
      syncCodexAccount(target.dataset.codexSync, target).catch(showError);
      return;
    }
    if (target.dataset.codexExport) {
      exportCodexAccount(target.dataset.codexExport, target).catch(showError);
      return;
    }
    if (target.dataset.codexToggle) {
      toggleCodexAccount(target.dataset.codexToggle, target.dataset.disabled === "true", target).catch(showError);
      return;
    }
    if (target.dataset.codexDelete) {
      deleteCodexAccount(target.dataset.codexDelete, target).catch(showError);
      return;
    }
    if (target.dataset.relayProtocol) {
      selectRelayProtocol(target.dataset.relayProtocol);
    }
  }

  function bindProviderSettingsActions() {
    const root = $("settingsContentBody");
    if (!root) return;
    if (providerConsoleEventRoot !== root) {
      if (providerConsoleEventRoot) {
        providerConsoleEventRoot.removeEventListener("click", handleProviderConsoleClick);
        providerConsoleEventRoot.removeEventListener("focusin", handleProviderConsoleFocus);
        providerConsoleEventRoot.removeEventListener("input", handleProviderConsoleInput);
        providerConsoleEventRoot.removeEventListener("change", handleProviderConsoleChange);
        providerConsoleEventRoot.removeEventListener("keydown", handleProviderConsoleKeydown);
        providerConsoleEventRoot.removeEventListener("submit", handleProviderConsoleSubmit);
      }
      providerConsoleEventRoot = root;
      root.addEventListener("click", handleProviderConsoleClick);
      root.addEventListener("focusin", handleProviderConsoleFocus);
      root.addEventListener("input", handleProviderConsoleInput);
      root.addEventListener("change", handleProviderConsoleChange);
      root.addEventListener("keydown", handleProviderConsoleKeydown);
      root.addEventListener("submit", handleProviderConsoleSubmit);
    }
    if (!state.providerAuthFiles && !state.providerAuthError) {
      loadProviderAuthFiles({ silent: true }).catch(showError);
    }
  }

  function allModelOptions() {
    return selectableModelProviders().flatMap((provider) => providerModelList(provider).map((model) => ({ provider, model, value: modelOptionValue(provider, model) })));
  }

  function providerLabel(provider) {
    if (provider.type === "codex" || provider.name === "codex") return "Codex OAuth";
    if (provider.profile === "cliproxyapi") return "CLIProxyAPI";
    if (provider.type === "openai-compatible" && provider.profile === "") return mt("relay");
    return provider.name;
  }

  function providerStatusText(provider) {
    if (provider.error) return mt("needsConfiguration");
    if (provider.configured) return mt("ready");
    return mt("unconfigured");
  }

  function providerCapabilitiesLabel(provider) {
    const capabilities = provider.capabilities || {};
    const labels = [];
    if (capabilities.streaming) labels.push(mt("streaming"));
    if (capabilities.tools) labels.push(mt("tools"));
    if (capabilities.imageInput) labels.push(mt("image"));
    return labels.length ? labels.join(" / ") : mt("basic");
  }

  async function applyPreferredModel(model) {
    if (state.modelApplying) return;
    const seq = ++state.modelApplySeq;
    const value = String(model || "").trim();
    const previousAgent = state.agent;
    let agentId = "";
    state.modelApplying = true;
    setModelApplyButtonsBusy(true);
    try {
      agentId = state.agent?.id || "";
      if (agentId && value && value !== state.agent.model) {
        const updated = await api(`/api/agents/${agentId}/model`, { method: "PATCH", body: JSON.stringify({ model: value }) });
        if (seq !== state.modelApplySeq || state.agent?.id !== agentId) return;
        state.agent = updated;
      }
      if (seq !== state.modelApplySeq) return;
      setPreferredModel(value);
      renderModelOptions();
      refreshActiveSettingsPanel?.();
      notifyTerminal?.(value ? `[info] ${mt("usingModel", { model: value })}\n` : `[info] ${mt("clearedPreferredModel")}\n`);
    } catch (err) {
      if (agentId && state.agent?.id === agentId && previousAgent?.id === agentId) state.agent = previousAgent;
      renderModelOptions();
      if (!agentId || state.agent?.id === agentId) throw err;
    } finally {
      if (seq === state.modelApplySeq) state.modelApplying = false;
      setModelApplyButtonsBusy(false);
    }
  }

  function getPreferredModel() {
    const value = getPreferredModelPreference?.();
    return String(value ?? preferredModelFallback ?? "").trim();
  }

  function setPreferredModel(model) {
    const value = String(model || "").trim();
    preferredModelFallback = value;
    setPreferredModelPreference?.(value);
    return value;
  }

  function loadModelVisibilityPreferences() {
    const raw = getModelVisibilityPreference?.() || modelVisibilityFallback;
    return {
      hiddenModels: raw?.hiddenModels && typeof raw.hiddenModels === "object" ? { ...raw.hiddenModels } : {},
      showUnconfiguredProviders: Boolean(raw?.showUnconfiguredProviders),
    };
  }

  function saveModelVisibilityPreferences(prefs) {
    modelVisibilityFallback = {
      hiddenModels: { ...(prefs?.hiddenModels || {}) },
      showUnconfiguredProviders: Boolean(prefs?.showUnconfiguredProviders),
    };
    setModelVisibilityPreference?.(modelVisibilityFallback);
    return modelVisibilityFallback;
  }

  function modelVisibilityPreferences() {
    return loadModelVisibilityPreferences();
  }

  function modelOptionValue(provider, model) {
    return `${provider.name}:${model}`;
  }

  function isModelHidden(value) {
    return Boolean(modelVisibilityPreferences().hiddenModels?.[value]);
  }

  function providerRuntimeSelectable(provider = {}) {
    const signals = [provider.runtimeAvailable, provider.registered]
      .filter((value) => value !== undefined && value !== null)
      .map(Boolean);
    if (signals.length) return signals.every(Boolean);
    return Boolean(provider.enabled && provider.configured);
  }

  function isModelSelectable(provider, model) {
    const prefs = modelVisibilityPreferences();
    if (!provider.enabled || !providerRuntimeSelectable(provider)) return false;
    return !prefs.hiddenModels?.[modelOptionValue(provider, model)];
  }

  function setModelHidden(value, hidden) {
    const prefs = modelVisibilityPreferences();
    const hiddenModels = { ...(prefs.hiddenModels || {}) };
    if (hidden) hiddenModels[value] = true;
    else delete hiddenModels[value];
    saveModelVisibilityPreferences({ ...prefs, hiddenModels });
    renderModelOptions();
    refreshActiveSettingsPanel?.();
  }

  function clearVisibleConfiguredModelHides() {
    const prefs = modelVisibilityPreferences();
    const hiddenModels = { ...(prefs.hiddenModels || {}) };
    modelProvidersForUI().forEach((provider) => {
      if (!provider.configured) return;
      providerModelList(provider).forEach((model) => delete hiddenModels[modelOptionValue(provider, model)]);
    });
    saveModelVisibilityPreferences({ ...prefs, hiddenModels });
    renderModelOptions();
    refreshActiveSettingsPanel?.();
  }

  function selectableModelValues() {
    return allModelOptions().map((item) => item.value);
  }

  function selectedModelValue() {
    const values = selectableModelValues();
    const candidates = [
      $("modelSelect")?.value,
      state.agent?.model,
      getPreferredModel(),
      state.settings?.agent?.defaultModel,
      values[0],
    ].map((value) => String(value || "").trim()).filter(Boolean);
    return candidates.find((value) => values.includes(value)) || "";
  }

  function currentModelValue() {
    return state.agent?.model || selectedModelValue();
  }

  function renderModelOptions() {
    const select = $("modelSelect");
    if (!select) return;
    const providers = selectableModelProviders();
    const optionValues = [];
    const groups = providers.map((provider) => {
      const models = providerModelList(provider);
      const groupLabel = `${provider.name}${provider.error ? mt("groupNeedsRefresh") : ""}`;
      const options = models.map((model) => {
        const value = `${provider.name}:${model}`;
        optionValues.push(value);
        const suffix = provider.configured ? "" : mt("optionUnconfigured");
        return `<option value="${escapeAttr(value)}" data-provider="${escapeAttr(provider.name)}" data-configured="${provider.configured ? "true" : "false"}">${escapeHtml(model + suffix)}</option>`;
      }).join("");
      return `<optgroup label="${escapeAttr(groupLabel)}">${options}</optgroup>`;
    }).join("");
    const currentModel = currentModelValue();
    const currentOption = currentModel && !optionValues.includes(currentModel)
      ? `<option value="${escapeAttr(currentModel)}" data-configured="false" data-runtime-available="false" disabled>${escapeHtml(currentModel + mt("currentHidden"))}</option>`
      : "";
    select.innerHTML = currentOption + (groups || `<option value="" data-configured="false">${escapeHtml(mt("modelsNotLoaded"))}</option>`);
    if (currentModel) {
      select.value = currentModel;
    }
    updateModelConfiguredState();
    updateWorkspaceMetaPills?.();
  }

  function settingProviderByName(name) {
    return (state.settings?.providers || []).find((provider) => provider.name === name) || null;
  }

  function modelProvidersForUI() {
    return modelProvidersForUIUnion(
      state.settings?.providers || [],
      state.modelCatalog?.providers || [],
    ).map(normalizeModelProvider);
  }

  function selectableModelProviders() {
    return modelProvidersForUI()
      .map((provider) => ({
        ...provider,
        models: providerModelList(provider).filter((model) => isModelSelectable(provider, model)),
      }))
      .filter((provider) => provider.models.length);
  }

  function normalizeModelProvider(provider) {
    const capabilities = provider.capabilities && typeof provider.capabilities === "object" ? provider.capabilities : {};
    const reasoningEfforts = [
      capabilities.reasoningEfforts,
      capabilities.reasoningEffortValues,
      capabilities.effortValues,
      Array.isArray(capabilities.reasoningEffort) ? capabilities.reasoningEffort : undefined,
      capabilities.reasoningEffort?.values,
      capabilities.reasoningEffort?.supportedValues,
    ].find(Array.isArray);
    const management = provider.management && typeof provider.management === "object" ? provider.management : {};
    const rawModelCapabilities = provider.modelCapabilities && typeof provider.modelCapabilities === "object" && !Array.isArray(provider.modelCapabilities)
      ? provider.modelCapabilities
      : {};
    const modelCapabilities = Object.fromEntries(Object.entries(rawModelCapabilities)
      .map(([model, value]) => [String(model || "").trim(), {
        ...(value && typeof value === "object" ? value : {}),
        fastMode: Boolean(value?.fastMode),
      }])
      .filter(([model]) => Boolean(model)));
    return {
      name: provider.name || provider.type || "provider",
      type: provider.type || provider.name || "provider",
      profile: provider.profile || "",
      baseUrl: provider.baseUrl || "",
      defaultModel: provider.defaultModel || provider.model || "",
      maxTokens: Number(provider.maxTokens || 0),
      models: Array.isArray(provider.models) ? provider.models.filter(Boolean) : [],
      modelsSource: String(provider.modelsSource || ""),
      discovered: Boolean(provider.discovered),
      available: Boolean(provider.available),
      runtimeAvailable: provider.runtimeAvailable === undefined || provider.runtimeAvailable === null ? undefined : Boolean(provider.runtimeAvailable),
      registered: provider.registered === undefined || provider.registered === null ? undefined : Boolean(provider.registered),
      configured: Boolean(provider.configured),
      enabled: provider.enabled === undefined ? Boolean(provider.configured) : Boolean(provider.enabled),
      origin: String(provider.origin || (isBuiltinProvider(provider) ? "builtin" : "custom")),
      apiKeyOptional: Boolean(provider.apiKeyOptional),
      apiKeyConfigured: Boolean(provider.apiKeyConfigured),
      apiKeyPersisted: Boolean(provider.apiKeyPersisted),
      apiKeyLastFive: String(provider.apiKeyLastFive || "").slice(-5),
      apiKeySource: ["stored", "environment", "runtime", "optional", "none", "stored_unavailable"].includes(String(provider.apiKeySource || "").toLowerCase())
        ? String(provider.apiKeySource).toLowerCase()
        : "none",
      capabilities: {
        tools: Boolean(capabilities.tools),
        streaming: Boolean(capabilities.streaming),
        imageInput: Boolean(capabilities.imageInput),
        reasoningEffort: capabilities.reasoningEffort === true || Array.isArray(reasoningEfforts),
        reasoningEfforts: Array.isArray(reasoningEfforts)
          ? reasoningEfforts.filter(Boolean)
          : undefined,
      },
      modelCapabilities,
      management: {
        url: management.url || provider.managementUrl || "",
        authFiles: Boolean(management.authFiles),
      },
      managementUrl: provider.managementUrl || management.url || "",
      error: provider.error || "",
    };
  }

  function providerModelList(provider) {
    if (provider.models.length) return provider.models;
    return provider.defaultModel ? [provider.defaultModel] : [];
  }

  function currentProviderConfig(modelValue = selectedModelValue()) {
    const [providerName] = String(modelValue || "").split(":");
    return modelProvidersForUI().find((provider) => provider.name === providerName)
      || (state.settings?.providers || []).find((provider) => provider.name === providerName)
      || null;
  }

  function isCurrentModelConfigured(modelValue = $("modelSelect")?.value || state.agent?.model || "") {
    const provider = currentProviderConfig(modelValue);
    return Boolean(provider?.configured && providerRuntimeSelectable(provider));
  }

  function updateModelConfiguredState() {
    const select = $("modelSelect");
    if (!select) return;
    const provider = currentProviderConfig(select.value);
    const configured = Boolean(provider?.configured && providerRuntimeSelectable(provider));
    select.classList.toggle("model-unconfigured", !configured);
    select.title = provider?.error || (configured ? mt("modelConfigured") : !providerRuntimeSelectable(provider) ? mt("runtimeUnavailable") : modelSetupMessage(select.value));
  }

  function modelSetupMessage(modelValue = $("modelSelect")?.value || state.agent?.model || "") {
    const provider = currentProviderConfig(modelValue);
    const providerName = provider?.name || String(modelValue || "openai").split(":")[0] || "openai";
    if (providerName === "codex") {
      return mt("codexModelSetupMessage", { model: modelValue || mt("noneSelected") });
    }
    if (provider?.error) {
      return `${provider.error} ${mt("configurationRefresh")}`;
    }
    const envByProvider = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      groq: "GROQ_API_KEY",
      cliproxyapi: mt("envCliproxyApiKey"),
      "openai-compatible": mt("envOpenAICompatibleApiKey"),
    };
    const envName = envByProvider[providerName] || mt("envFallback");
    return mt("modelSetupMessage", {
      model: modelValue || mt("noneSelected"),
      provider: providerName,
      envName,
    });
  }

  function codexProvider() {
    return modelProvidersForUI().find((provider) => provider.type === "codex" || provider.name === "codex")
      || null;
  }

  function codexProviderSummary() {
    const provider = codexProvider();
    if (!provider) return mt("codexProviderMissing");
    const count = providerModelList(normalizeModelProvider(provider)).length;
    if (provider.error) return mt("codexProviderError", { error: provider.error, count });
    if (!provider.configured) return mt("codexProviderNeedsCredentials", { count });
    return mt("codexProviderConnected", { count });
  }

  function renderAgentModelOptions(currentModel) {
    const options = allModelOptions();
    const values = new Set(options.map((item) => item.value));
    const currentOption = currentModel && !values.has(currentModel)
      ? `<option value="${escapeAttr(currentModel)}" disabled>${escapeHtml(currentModel + mt("currentHidden"))}</option>`
      : "";
    const grouped = selectableModelProviders().map((provider) => {
      const models = providerModelList(provider);
      if (!models.length) return "";
      return `<optgroup label="${escapeAttr(providerLabel(provider))}">${models.map((model) => {
        const value = `${provider.name}:${model}`;
        const suffix = provider.configured ? "" : mt("optionUnconfigured");
        return `<option value="${escapeAttr(value)}" ${value === currentModel ? "selected" : ""}>${escapeHtml(model + suffix)}</option>`;
      }).join("")}</optgroup>`;
    }).join("");
    return currentOption + (grouped || `<option value="${escapeAttr(currentModel || "")}">${escapeHtml(currentModel || mt("modelsNotLoaded"))}</option>`);
  }

  return {
    bindModelSettingsActions,
    bindProviderSettingsActions,
    codexProviderSummary,
    currentModelValue,
    currentProviderConfig,
    getPreferredModel,
    isCurrentModelConfigured,
    loadProviderAuthFiles,
    modelSetupMessage,
    openProviderConsoleType,
    providerLabel,
    providerStatusText,
    refreshModelCatalog,
    relayProtocolSpec,
    renderAgentModelOptions,
    renderModelOptions,
    renderModelSettingsContent,
    renderProviderSettingsContent,
    selectedModelValue,
    setPreferredModel,
  };
}
