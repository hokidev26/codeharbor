import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { modelVisibilityPrefsKey, preferredModelKey, relayProtocolPrefsKey } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";
import { formatTimestamp } from "./formatters.mjs";
import { t } from "./i18n.mjs";
import {
  createProviderDraft,
  isBuiltinProvider,
  isProviderDeletable,
  modelProvidersForUIUnion,
  normalizeConsoleProvider,
  providerConfigPayload,
  providerConsoleRequest,
  renderProviderConsolePage,
} from "./model-provider-components.mjs";

const providerConsoleInteractiveSelector = "button, input, select, textarea, a, details, summary, [role=\"switch\"], [contenteditable=\"true\"]";
const providerConsoleFocusableSelector = "a[href], button, input, select, textarea, [tabindex]";

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

export function normalizeCodexAccountList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["accounts", "files", "authFiles", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export function codexAccountActionRequest(action, id, values = {}) {
  const path = `/api/providers/oauth/codex/accounts/${encodeURIComponent(String(id || ""))}`;
  switch (action) {
    case "save": return { path, options: { method: "PATCH", body: JSON.stringify({ alias: String(values.alias || ""), priority: Number(values.priority) }) } };
    case "toggle": return { path, options: { method: "PATCH", body: JSON.stringify({ disabled: !Boolean(values.disabled) }) } };
    case "sync": return { path: `${path}/refresh`, options: { method: "POST" } };
    case "delete": return { path, options: { method: "DELETE" } };
    default: throw new Error(`unsupported Codex account action: ${action}`);
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

export function renderCodexAccountManagementTable(accounts, { translate = (key, params) => t(`modelProvider.${key}`, params), now = Date.now() } = {}) {
  const mt = translate;
  if (!accounts.length) return `<div class="settings-empty-card compact">${escapeHtml(mt("noCodexCredentials"))}</div>`;
  return `
    <div class="codex-account-table-wrap">
      <table class="codex-account-table">
        <thead><tr>
          <th>${escapeHtml(mt("accountName"))}</th><th>${escapeHtml(mt("accountId"))}</th><th>${escapeHtml(mt("priority"))}</th><th>${escapeHtml(mt("status"))}</th>
          <th>${escapeHtml(mt("successFailure"))}</th><th>${escapeHtml(mt("usage"))}</th><th>${escapeHtml(mt("lastUsed"))}</th><th>${escapeHtml(mt("actions"))}</th>
        </tr></thead>
        <tbody>${accounts.map((account) => renderCodexAccountRow(account, mt, now)).join("")}</tbody>
      </table>
    </div>`;
}

function renderCodexAccountRow(account, mt, now) {
  const id = String(account?.id || account?.auth_index || account?.authIndex || account?.name || "");
  const alias = String(account?.alias || account?.email || "");
  const priority = finiteNumber(account?.priority, 100);
  const disabled = Boolean(account?.disabled);
  const stats = account?.stats && typeof account.stats === "object" ? account.stats : {};
  const quota = account?.quota && typeof account.quota === "object" ? account.quota : null;
  const plan = String(quota?.plan_type || quota?.planType || account?.plan_type || account?.planType || "").trim();
  const limited = codexQuotaIsLimited(quota);
  const statusClass = disabled ? "muted" : limited ? "warn" : "ok";
  const statusText = disabled ? mt("disabled") : limited ? mt("rateLimited") : mt("available");
  const accountLabel = String(account?.account_id || account?.accountID || id || mt("unknown"));
  const fallbackName = String(account?.email || account?.name || mt("unknown"));
  const success = Math.max(0, finiteNumber(stats.success_count ?? stats.successCount, 0));
  const failure = Math.max(0, finiteNumber(stats.failure_count ?? stats.failureCount, 0));
  const lastUsed = String(stats.last_use_at || stats.lastUseAt || stats.last_attempt_at || stats.lastAttemptAt || "");
  const statusDetail = String(stats.last_error_code || stats.lastErrorCode || stats.last_status_code || stats.lastStatusCode || stats.last_http_status || stats.lastHTTPStatus || "");
  return `<tr data-codex-account-row="${escapeAttr(id)}">
    <td data-label="${escapeAttr(mt("accountName"))}">
      <input class="codex-account-alias settings-text-input" value="${escapeAttr(alias)}" placeholder="${escapeAttr(fallbackName)}" maxlength="200" data-codex-alias="${escapeAttr(id)}">
      <div class="codex-account-secondary">${escapeHtml(fallbackName)}${plan ? ` <span class="codex-plan-badge">${escapeHtml(plan)}</span>` : ""}</div>
    </td>
    <td data-label="${escapeAttr(mt("accountId"))}"><code class="codex-account-id">${escapeHtml(accountLabel)}</code></td>
    <td data-label="${escapeAttr(mt("priority"))}"><input class="codex-priority-input settings-text-input" type="number" min="1" max="1000000" step="1" value="${escapeAttr(priority)}" data-codex-priority="${escapeAttr(id)}"></td>
    <td data-label="${escapeAttr(mt("status"))}"><span class="settings-status-pill ${statusClass}">${escapeHtml(statusText)}</span>${statusDetail ? `<div class="codex-account-secondary">${escapeHtml(statusDetail)}</div>` : ""}</td>
    <td data-label="${escapeAttr(mt("successFailure"))}"><span class="codex-success-count">${escapeHtml(String(success))}</span> / <span class="codex-failure-count">${escapeHtml(String(failure))}</span></td>
    <td data-label="${escapeAttr(mt("usage"))}">${renderCodexQuota(quota, mt, now)}</td>
    <td data-label="${escapeAttr(mt("lastUsed"))}">${escapeHtml(lastUsed ? formatCodexTimestamp(lastUsed) : mt("never"))}</td>
    <td data-label="${escapeAttr(mt("actions"))}"><div class="codex-account-actions">
      <button class="settings-action-btn subtle" type="button" data-codex-save="${escapeAttr(id)}">${escapeHtml(mt("save"))}</button>
      <button class="settings-action-btn subtle" type="button" data-codex-sync="${escapeAttr(id)}">${escapeHtml(mt("sync"))}</button>
      <button class="settings-action-btn subtle" type="button" data-codex-toggle="${escapeAttr(id)}" data-disabled="${disabled ? "true" : "false"}">${escapeHtml(disabled ? mt("enable") : mt("disable"))}</button>
      <button class="settings-action-btn danger" type="button" data-codex-delete="${escapeAttr(id)}">${escapeHtml(mt("delete"))}</button>
    </div></td>
  </tr>`;
}

function renderCodexQuota(quota, mt, now) {
  if (!quota) return `<span class="codex-no-quota">${escapeHtml(mt("noQuota"))}</span>`;
  const windows = [
    [mt("primaryQuota"), quota.primary_window || quota.primaryWindow],
    [mt("secondaryQuota"), quota.secondary_window || quota.secondaryWindow],
  ].filter(([, window]) => window && typeof window === "object");
  const credits = renderCodexCredits(quota.credits || quota.credit_balance || quota.creditBalance, mt);
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

function renderCodexCredits(credits, mt) {
  if (!credits || typeof credits !== "object") return "";
  const unlimited = Boolean(credits.unlimited ?? credits.is_unlimited ?? credits.isUnlimited);
  const hasCredits = Boolean(credits.has_credits ?? credits.hasCredits ?? credits.available);
  const balance = finiteNumber(credits.balance ?? credits.amount ?? credits.remaining, 0);
  const summary = unlimited
    ? mt("creditsUnlimited")
    : hasCredits
      ? mt("creditsBalance", { balance: formatCreditBalance(balance) })
      : mt("creditsUnavailable");
  return `<div class="codex-credits-summary"><span>${escapeHtml(mt("credits"))}</span><strong>${escapeHtml(summary)}</strong></div>`;
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

function formatCreditBalance(value) {
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
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
  loadModelCatalog,
  loadSettings,
  notifyTerminal,
  openSettingsModal,
  refreshActiveSettingsPanel,
  showError,
  updateWorkspaceMetaPills,
} = {}) {
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

  async function loadProviderAuthFiles({ silent = false } = {}) {
    const seq = ++state.providerAuthSeq;
    const button = silent ? null : $("codexRefreshAuthBtn");
    let loaded = false;
    setButtonBusy(button, true, mt("refreshing"));
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
      if (seq === state.providerAuthSeq) setButtonBusy(button, false, mt("refreshing"));
    }
    if (seq === state.providerAuthSeq) refreshActiveSettingsPanel?.();
    return loaded && seq === state.providerAuthSeq;
  }

  async function importCodexAuthFile() {
    const button = $("codexImportAuthBtn");
    if (button?.disabled) return;
    const textarea = $("codexAuthImportText");
    const content = textarea?.value.trim() || "";
    if (!content) throw new Error(mt("importContentRequired"));
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
      if (!failed && textarea) textarea.value = "";
      notifyTerminal?.(`[info] ${mt("importedCredentialsCount", { count: imported, skipped })}\n`);
      await loadProviderAuthFiles({ silent: true });
      await loadModelCatalog();
      if (failed) throw new Error(mt("importedCredentialsPartial", { count: imported, failed }));
    } finally {
      setButtonBusy(button, false, mt("importing"));
      if (textarea) textarea.disabled = false;
    }
  }

  async function runCodexAccountAction(id, button, busyLabel, action) {
    state.codexAccountBusy ||= {};
    if (!id || state.codexAccountBusy[id]) return;
    state.codexAccountBusy[id] = true;
    state.providerAuthMutationWarning = "";
    const row = button?.closest?.("[data-codex-account-row]");
    row?.querySelectorAll?.("button, input").forEach((node) => { node.disabled = true; });
    setButtonBusy(button, true, busyLabel);
    try {
      const actionResult = await action(row);
      const refreshed = await loadProviderAuthFiles({ silent: true });
      const warnings = [
        actionResult?.warning || "",
        codexMutationRefreshWarning(refreshed, state.providerAuthError, mt),
      ].filter(Boolean);
      state.providerAuthMutationWarning = warnings.join(" ");
      warnings.forEach((warning) => notifyTerminal?.(`[warn] ${warning}\n`));
      if (warnings.length) refreshActiveSettingsPanel?.();
    } finally {
      delete state.codexAccountBusy[id];
      row?.querySelectorAll?.("button, input").forEach((node) => { node.disabled = false; });
      setButtonBusy(button, false, busyLabel);
    }
  }

  async function saveCodexAccount(id, button) {
    return runCodexAccountAction(id, button, mt("saving"), async (row) => {
      const alias = row?.querySelector?.("[data-codex-alias]")?.value?.trim?.() || "";
      const priority = Number(row?.querySelector?.("[data-codex-priority]")?.value || 0);
      if (!Number.isInteger(priority) || priority < 1 || priority > 1000000) throw new Error(mt("invalidPriority"));
      const request = codexAccountActionRequest("save", id, { alias, priority });
      await api(request.path, request.options);
      notifyTerminal?.(`[info] ${mt("accountSaved")}\n`);
    });
  }

  async function syncCodexAccount(id, button) {
    return runCodexAccountAction(id, button, mt("syncing"), async () => {
      const request = codexAccountActionRequest("sync", id);
      await api(request.path, request.options);
      notifyTerminal?.(`[info] ${mt("accountSynced")}\n`);
    });
  }

  async function toggleCodexAccount(id, disabled, button) {
    return runCodexAccountAction(id, button, mt("saving"), async () => {
      const request = codexAccountActionRequest("toggle", id, { disabled });
      await api(request.path, request.options);
      notifyTerminal?.(`[info] ${mt(disabled ? "accountEnabled" : "accountDisabled")}\n`);
    });
  }

  async function deleteCodexAccount(id, button) {
    if (state.codexAccountBusy?.[id] || !globalThis.confirm?.(mt("deleteAccountConfirm"))) return;
    return runCodexAccountAction(id, button, mt("deleting"), async () => {
      const request = codexAccountActionRequest("delete", id);
      const result = await api(request.path, request.options);
      const warning = codexDeleteResultWarning(result, mt);
      if (!warning) notifyTerminal?.(`[info] ${mt("accountDeleted")}\n`);
      return { warning };
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

  function renderModelSettingsContent() {
    const providers = modelProvidersForUI();
    const options = allModelOptions();
    const current = currentModelValue();
    const preferred = getPreferredModel();
    const codex = codexProvider();
    return `
    <div class="settings-live-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(mt("currentModel"))}</div>
          <div class="settings-hero-title">${escapeHtml(current || mt("noneSelected"))}</div>
          <p>${escapeHtml(preferred ? mt("preferredModel", { model: preferred }) : mt("noPreferred"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="settingsRefreshModelsBtn" class="settings-action-btn primary" type="button">${escapeHtml(mt("refreshModels"))}</button>
          <button id="settingsOpenLoginBtn" class="settings-action-btn" type="button">${escapeHtml(mt("credentialsRelay"))}</button>
          <button id="settingsShowConfiguredModelsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("showConfiguredModels"))}</button>
          <button id="settingsClearPreferredModelBtn" class="settings-action-btn subtle" type="button">${escapeHtml(mt("clearPreferred"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(String(options.length))}</strong><span>${escapeHtml(mt("availableModels"))}</span></div>
        <div><strong>${escapeHtml(codex?.error ? mt("needsAttention") : (codex?.configured ? mt("ready") : mt("unconfigured")))}</strong><span>Codex OAuth</span></div>
        <div><strong>${escapeHtml(codex?.baseUrl || "https://chatgpt.com/backend-api/codex")}</strong><span>${escapeHtml(mt("modelSource"))}</span></div>
      </div>
      <div class="settings-model-list">
        ${providers.map(renderModelProviderSection).join("") || `<div class="settings-empty-card">${escapeHtml(mt("noModelsLoaded"))}</div>`}
      </div>
    </div>
  `;
  }

  function renderModelProviderSection(provider) {
    const models = providerModelList(provider);
    return `
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(providerLabel(provider))}</div>
          <div class="settings-provider-meta">${escapeHtml(provider.baseUrl || provider.type || "provider")}</div>
        </div>
        <span class="settings-status-pill ${provider.error ? "warn" : (provider.configured ? "ok" : "muted")}">${escapeHtml(providerStatusText(provider))}</span>
      </div>
      ${provider.error ? `<div class="settings-inline-alert">${escapeHtml(provider.error)}</div>` : ""}
      <div class="settings-model-grid">
        ${models.map((model) => renderModelChoice(provider, model)).join("")}
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
    const icon = hidden || disabled ? "⊘" : "◉";
    const title = hidden ? mt("showModel") : mt("hideModel");
    const modelMeta = `${model}${preferred ? ` · ${mt("preferred")}` : ""}${disabled ? ` · ${mt("unconfigured")}` : hidden ? ` · ${mt("hidden")}` : ""}`;
    return `
    <div class="settings-model-row ${active ? "active" : ""} ${hidden || disabled ? "muted" : ""}">
      <button class="settings-model-choice ${active ? "active" : ""}" type="button" data-apply-model="${escapeAttr(value)}" ${selectable ? "" : "disabled"}>
        <span class="settings-model-name">${escapeHtml(value)}</span>
        <span class="settings-model-provider">${escapeHtml(modelMeta)}</span>
      </button>
      <button class="settings-model-icon-btn" type="button" data-toggle-model-visibility="${escapeAttr(value)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" ${disabled ? "disabled" : ""}>${escapeHtml(icon)}</button>
    </div>
  `;
  }

  function providerConsoleState() {
    const fallback = {
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
    };
    if (!state.providerConsole || typeof state.providerConsole !== "object") {
      state.providerConsole = fallback;
    } else {
      state.providerConsole = { ...fallback, ...state.providerConsole, busy: state.providerConsole.busy || {} };
    }
    return state.providerConsole;
  }

  function setProviderConsoleResult(message, tone = "info") {
    providerConsoleState().result = message ? { message: String(message), tone } : null;
  }

  function renderProviderSettingsContent() {
    const consoleState = providerConsoleState();
    return renderProviderConsolePage({
      providers: modelProvidersForUI(),
      consoleState,
      codexDrawer: renderCodexConsoleDrawer(),
      relayDrawer: renderRelayConsoleDrawer(),
    });
  }

  function renderCodexConsoleDrawer() {
    const consoleState = providerConsoleState();
    if (consoleState.mode !== "codex") return "";
    const authFiles = extractAuthFiles(state.providerAuthFiles);
    return `<header class="mp-drawer-head"><div><p class="mp-provider-kicker">Codex OAuth</p><h2 id="mp-drawer-title">${escapeHtml(ct("codex.title"))}</h2><p id="mp-drawer-description">${escapeHtml(ct("codex.description"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-drawer aria-label="${escapeAttr(ct("actions.closeDrawer"))}">×</button></header>
      <div class="mp-drawer-body">
        <section class="mp-config-section" id="codexCredentialImportSection"><h3>${escapeHtml(mt("codexImportTitle"))}</h3><p>${escapeHtml(mt("codexImportDescription"))}</p>
          <textarea id="codexAuthImportText" class="mp-textarea" placeholder="${escapeAttr(mt("codexImportPlaceholder"))}"></textarea>
          <div class="mp-inline-actions"><button id="codexImportAuthBtn" class="mp-action primary" type="button" data-mp-codex-import>${escapeHtml(mt("import"))}</button></div>
        </section>
        <section class="mp-config-section"><div class="mp-section-title"><div><h3>${escapeHtml(mt("importedCredentials"))}</h3><p>${escapeHtml(mt("importedCredentialsDescription"))}</p></div><button id="codexRefreshAuthBtn" class="mp-action" type="button" data-mp-codex-refresh>${escapeHtml(mt("refreshAccounts"))}</button></div>
          ${state.providerAuthMutationWarning ? `<div class="mp-provider-result attention">${escapeHtml(state.providerAuthMutationWarning)}</div>` : state.providerAuthError ? `<div class="mp-provider-result attention">${escapeHtml(state.providerAuthError)}</div>` : ""}
          ${renderCodexAccountManagementTable(authFiles, { translate: mt })}
        </section>
      </div>
      <footer class="mp-drawer-foot"><span>${escapeHtml(ct("codex.footer"))}</span><button class="mp-action" type="button" data-mp-refresh-models>${escapeHtml(ct("actions.refreshModels"))}</button></footer>`;
  }

  function renderRelayConsoleDrawer() {
    const consoleState = providerConsoleState();
    if (consoleState.mode !== "relay") return "";
    const spec = relayProtocolSpec(getRelayProtocol());
    const provider = providerByName(spec.providerName) || { name: spec.providerName, type: spec.providerType, defaultModel: defaultModelForProtocol(spec.key), baseUrl: "" };
    const modelValue = provider.defaultModel || provider.model || defaultModelForProtocol(spec.key);
    return `<header class="mp-drawer-head"><div><p class="mp-provider-kicker">${escapeHtml(ct("compatibleAdvanced"))}</p><h2 id="mp-drawer-title">${escapeHtml(ct("relay.title"))}</h2><p id="mp-drawer-description">${escapeHtml(ct("relay.description"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-drawer aria-label="${escapeAttr(ct("actions.closeDrawer"))}">×</button></header>
      <div class="mp-drawer-body">
        <section class="mp-config-section"><h3>${escapeHtml(ct("fields.protocol"))}</h3><div class="mp-relay-protocols">${relayProtocolSpecs().map((item) => `<button class="mp-action ${item.key === spec.key ? "primary" : ""}" type="button" data-relay-protocol="${escapeAttr(item.key)}">${escapeHtml(item.label)}</button>`).join("")}</div><p>${escapeHtml(spec.help)}</p></section>
        <section class="mp-config-section"><h3>${escapeHtml(ct("drawer.connection"))}</h3>
          <label>${escapeHtml(ct("fields.providerName"))}<input id="relayProviderName" value="${escapeAttr(provider.name || spec.providerName)}" readonly></label>
          <label>${escapeHtml(ct("fields.apiKey"))}<input id="relayApiKey" type="password" value="" autocomplete="off" placeholder="${escapeAttr(ct("fields.apiKeyBlankKeepsCurrent"))}"></label>
          <label>${escapeHtml(ct("fields.baseUrl"))}<input id="relayBaseUrl" value="${escapeAttr(provider.baseUrl || "")}" autocomplete="url" placeholder="https://api.example.com/v1"></label>
          <label>${escapeHtml(ct("fields.defaultModel"))}<input id="relayCustomModel" value="${escapeAttr(modelValue)}" autocomplete="off"></label>
        </section>
      </div>
      <footer class="mp-drawer-foot"><button id="relayFetchModelsBtn" class="mp-action" type="button" data-mp-fetch-models>${escapeHtml(ct("actions.fetchModels"))}</button><div><button class="mp-action" type="button" data-mp-close-drawer>${escapeHtml(ct("actions.cancel"))}</button><button id="relaySaveConfigBtn" class="mp-action primary" type="button" data-mp-relay-save>${escapeHtml(ct("relay.save"))}</button></div></footer>`;
  }

  function renderCodexImportCard() {
    return `
    <section class="settings-provider-section" id="codexCredentialImportSection">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("codexImportTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(mt("codexImportDescription"))}</div>
        </div>
        <button id="codexImportAuthBtn" class="settings-action-btn primary" type="button">${escapeHtml(mt("import"))}</button>
      </div>
      <textarea id="codexAuthImportText" class="settings-token-input" placeholder="${escapeAttr(mt("codexImportPlaceholder"))}"></textarea>
      <div class="settings-inline-success">${escapeHtml(mt("codexImportSuccess"))}</div>
    </section>
  `;
  }

  function renderCodexAccountCard(authFiles) {
    return `
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(mt("importedCredentials"))}</div>
          <div class="settings-provider-meta">${escapeHtml(mt("importedCredentialsDescription"))}</div>
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
              <small>${escapeHtml(mt("relayProviderNameHelp", { provider: spec.providerName }))}</small>
            </label>
            <label class="relay-field wide">
              <span>${escapeHtml(mt("providerPrefix"))}</span>
              <input class="settings-text-input" value="${escapeAttr((provider.name || spec.providerName) + ":")}" disabled>
              <small>${escapeHtml(mt("relayProviderPrefixHelp", { provider: spec.providerName, model: modelValue }))}</small>
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
            <small>${escapeHtml(spec.help)}</small>
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
            <small>${escapeHtml(mt("customModelDescription"))}</small>
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
          <div class="settings-provider-meta">${escapeHtml(mt("customProviderDescription"))}</div>
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
              <input id="customProviderModel" class="settings-field" name="model" value="" placeholder="openai/gpt-oss-20b" autocomplete="off" />
            </label>
            <label>${escapeHtml(mt("maxTokens"))}
              <input class="settings-field" name="maxTokens" type="number" min="0" step="1" value="" placeholder="${escapeAttr(mt("maxTokensOptional"))}" />
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
              <input class="settings-field" name="model" value="${escapeAttr(model)}" placeholder="${escapeAttr(mt("defaultModelPlaceholder"))}" />
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("baseUrl"))}
              <input class="settings-field" name="baseUrl" value="${escapeAttr(baseUrl)}" placeholder="${escapeAttr(providerBaseURLPlaceholder(type, provider.profile))}" />
            </label>
            <label class="settings-form-span-2">${escapeHtml(mt("apiKey"))}
              <input class="settings-field" name="apiKey" type="password" autocomplete="off" placeholder="${escapeAttr(provider.configured ? mt("apiKeyPreservePlaceholder") : mt("apiKeyPastePlaceholder"))}" />
            </label>
            <label>${escapeHtml(mt("maxTokens"))}
              <input class="settings-field" name="maxTokens" type="number" min="0" step="1" value="${escapeAttr(maxTokens || "")}" placeholder="${escapeAttr(mt("maxTokensAnthropic"))}" />
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
      apiKey: form.elements.apiKey?.value.trim() || "",
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

  function bindModelSettingsActions() {
    $("settingsRefreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
    $("settingsOpenLoginBtn")?.addEventListener("click", () => openSettingsModal?.("providers"));
    $("settingsClearPreferredModelBtn")?.addEventListener("click", () => applyPreferredModel("").catch(showError));
    $("settingsShowConfiguredModelsBtn")?.addEventListener("click", clearVisibleConfiguredModelHides);
    $("settingsContentBody").querySelectorAll("[data-toggle-model-visibility]").forEach((node) => {
      node.addEventListener("click", () => setModelHidden(node.dataset.toggleModelVisibility, !isModelHidden(node.dataset.toggleModelVisibility)));
    });
    $("settingsContentBody").querySelectorAll("[data-apply-model]").forEach((node) => {
      node.addEventListener("click", () => applyPreferredModel(node.dataset.applyModel).catch(showError));
    });
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

  function refreshProviderConsole({ focusLayer = false, restoreFocus = false } = {}) {
    refreshActiveSettingsPanel?.();
    if (focusLayer) scheduleProviderConsoleFocus(focusProviderConsoleLayer);
    if (restoreFocus) restoreProviderConsoleLayerFocus();
  }

  function closeProviderConsoleLayer() {
    const consoleState = providerConsoleState();
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
    return false;
  }

  function openProviderConsoleDrawer(provider) {
    const consoleState = providerConsoleState();
    const normalized = normalizeConsoleProvider(provider || {});
    consoleState.modal = "";
    consoleState.drawer = "provider";
    consoleState.mode = normalized.type === "codex" || normalized.name === "codex" ? "codex" : "edit";
    consoleState.type = normalized.type;
    consoleState.providerName = normalized.name;
    consoleState.draft = createProviderDraft(normalized.type, normalized);
    consoleState.dirty = false;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusLayer: true });
  }

  function openProviderConsoleType(type) {
    const consoleState = providerConsoleState();
    const draft = createProviderDraft(type);
    consoleState.modal = "";
    consoleState.drawer = "provider";
    consoleState.mode = type === "codex" ? "codex" : "create";
    consoleState.type = type;
    consoleState.providerName = draft.name;
    consoleState.draft = draft;
    consoleState.dirty = false;
    setProviderConsoleResult("");
    refreshProviderConsole({ focusLayer: true });
  }

  function openRelayConsoleDrawer() {
    const consoleState = providerConsoleState();
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

  function validateConsoleDraft(draft) {
    if (!draft.name) throw new Error(mt("selectProviderName"));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(draft.name)) throw new Error(mt("invalidProviderName"));
    if (!draft.model) throw new Error(mt("selectDefaultModel"));
    if (draft.type === "openai-compatible" && !draft.baseUrl) throw new Error(mt("missingBaseUrl"));
  }

  async function toggleConsoleProvider(provider) {
    if (!provider || providerConsoleBusy(`toggle:${provider.name}`)) return;
    await runProviderConsoleBusy(`toggle:${provider.name}`, async () => {
      const enabled = !provider.enabled;
      const request = providerConsoleRequest("toggle", provider, { enabled, model: provider.defaultModel || provider.model });
      await api(request.path, request.options);
      await refreshProviderDataAfterMutation(ct(enabled ? "messages.providerStarted" : "messages.providerStopped", { provider: providerDisplayName(provider) }));
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
        const result = providerPreflightResult(response, ct);
        setProviderConsoleResult(result.message, result.tone);
        notifyTerminal?.(`[${result.terminalLevel}] ${result.message}\n`);
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
        const configRequest = providerConsoleRequest("config", { name: draft.name }, providerConfigPayload(draft));
        await api(configRequest.path, configRequest.options);
        saved = true;
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

  async function deleteConsoleProvider(name) {
    const provider = providerByName(name);
    if (!provider || !isProviderDeletable(provider) || providerConsoleBusy(`delete:${name}`)) return;
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
    if (!form || !target?.name) return false;
    const draft = syncProviderConsoleDraft(providerConsoleState(), form);
    if (!draft) return false;
    const example = form.querySelector?.("[data-mp-model-example]");
    if (example) example.value = `${draft.name || "provider"}:${draft.model || "your-model"}`;
    return true;
  }

  function handleProviderConsoleInput(event) {
    if (updateProviderConsoleDraftFromEvent(event)) return;
    const target = event.target?.closest?.("[data-mp-provider-search]");
    if (!target) return;
    providerConsoleState().search = target.value || "";
    refreshProviderConsole();
  }

  function handleProviderConsoleChange(event) {
    updateProviderConsoleDraftFromEvent(event);
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
    if (target.dataset.mpCloseModal !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.mpCloseDrawer !== undefined) {
      closeProviderConsoleLayer();
      return;
    }
    if (target.dataset.mpOpenTypes !== undefined) {
      rememberProviderConsoleFocus(target);
      consoleState.modal = "types";
      consoleState.result = null;
      refreshProviderConsole({ focusLayer: true });
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
      event.preventDefault();
      event.stopPropagation();
      toggleConsoleProvider(providerByName(target.dataset.mpProviderToggle)).catch(showError);
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
    if (target.dataset.mpRefreshModels !== undefined || target.dataset.mpFetchModels !== undefined) {
      runProviderConsoleBusy("refresh", async () => {
        await refreshModelCatalog();
        setProviderConsoleResult(ct("messages.modelsRefreshed"), "success");
      }).catch(showError);
      return;
    }
    if (target.dataset.mpTestProvider !== undefined) {
      const form = target.closest("form");
      if (form) testConsoleProvider(form).catch(showError);
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
        providerConsoleEventRoot.removeEventListener("input", handleProviderConsoleInput);
        providerConsoleEventRoot.removeEventListener("change", handleProviderConsoleChange);
        providerConsoleEventRoot.removeEventListener("keydown", handleProviderConsoleKeydown);
        providerConsoleEventRoot.removeEventListener("submit", handleProviderConsoleSubmit);
      }
      providerConsoleEventRoot = root;
      root.addEventListener("click", handleProviderConsoleClick);
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
    let agentId = "";
    state.modelApplying = true;
    setModelApplyButtonsBusy(true);
    try {
      setPreferredModel(value);
      if ($("modelSelect")) {
        if (value) $("modelSelect").value = value;
        renderModelOptions();
      }
      agentId = state.agent?.id || "";
      if (agentId && value && value !== state.agent.model) {
        const updated = await api(`/api/agents/${agentId}/model`, { method: "PATCH", body: JSON.stringify({ model: value }) });
        if (seq !== state.modelApplySeq || state.agent?.id !== agentId) return;
        state.agent = updated;
      }
      if (seq !== state.modelApplySeq) return;
      refreshActiveSettingsPanel?.();
      notifyTerminal?.(value ? `[info] ${mt("usingModel", { model: value })}\n` : `[info] ${mt("clearedPreferredModel")}\n`);
    } catch (err) {
      if (!agentId || state.agent?.id === agentId) throw err;
    } finally {
      if (seq === state.modelApplySeq) state.modelApplying = false;
      setModelApplyButtonsBusy(false);
    }
  }

  function getPreferredModel() {
    try {
      return localStorage.getItem(preferredModelKey) || "";
    } catch {
      return "";
    }
  }

  function setPreferredModel(model) {
    const value = String(model || "").trim();
    try {
      if (value) localStorage.setItem(preferredModelKey, value);
      else localStorage.removeItem(preferredModelKey);
    } catch {}
  }

  function loadModelVisibilityPreferences() {
    try {
      const raw = JSON.parse(localStorage.getItem(modelVisibilityPrefsKey) || "{}");
      return {
        hiddenModels: raw.hiddenModels && typeof raw.hiddenModels === "object" ? raw.hiddenModels : {},
        showUnconfiguredProviders: Boolean(raw.showUnconfiguredProviders),
      };
    } catch {
      return { hiddenModels: {}, showUnconfiguredProviders: false };
    }
  }

  function saveModelVisibilityPreferences(prefs) {
    try {
      localStorage.setItem(modelVisibilityPrefsKey, JSON.stringify({
        hiddenModels: prefs.hiddenModels || {},
        showUnconfiguredProviders: Boolean(prefs.showUnconfiguredProviders),
      }));
    } catch {}
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

  function isModelSelectable(provider, model) {
    const prefs = modelVisibilityPreferences();
    if (!provider.enabled) return false;
    if (!provider.configured && !prefs.showUnconfiguredProviders) return false;
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

  function selectedModelValue() {
    return $("modelSelect")?.value || state.agent?.model || getPreferredModel() || state.settings?.agent?.defaultModel || "";
  }

  function currentModelValue() {
    return state.agent?.model || getPreferredModel() || state.settings?.agent?.defaultModel || "";
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
      ? `<option value="${escapeAttr(currentModel)}" data-configured="false">${escapeHtml(currentModel + mt("currentHidden"))}</option>`
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
      .map(([model, value]) => [String(model || "").trim(), { fastMode: Boolean(value?.fastMode) }])
      .filter(([model]) => Boolean(model)));
    return {
      name: provider.name || provider.type || "provider",
      type: provider.type || provider.name || "provider",
      profile: provider.profile || "",
      baseUrl: provider.baseUrl || "",
      defaultModel: provider.defaultModel || provider.model || "",
      maxTokens: Number(provider.maxTokens || 0),
      models: Array.isArray(provider.models) ? provider.models.filter(Boolean) : [],
      configured: Boolean(provider.configured),
      enabled: provider.enabled === undefined ? Boolean(provider.configured) : Boolean(provider.enabled),
      origin: String(provider.origin || (isBuiltinProvider(provider) ? "builtin" : "custom")),
      apiKeyOptional: Boolean(provider.apiKeyOptional),
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
    return Boolean(currentProviderConfig(modelValue)?.configured);
  }

  function updateModelConfiguredState() {
    const select = $("modelSelect");
    if (!select) return;
    const provider = currentProviderConfig(select.value);
    const configured = Boolean(provider?.configured);
    select.classList.toggle("model-unconfigured", !configured);
    select.title = provider?.error || (configured ? mt("modelConfigured") : modelSetupMessage(select.value));
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
      ? `<option value="${escapeAttr(currentModel)}">${escapeHtml(currentModel + mt("currentHidden"))}</option>`
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
