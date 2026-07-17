import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { currentUILocale, t } from "./i18n.mjs?v=shared-api-1";

const endpoints = Object.freeze({
  keys: "/api/gateway/keys",
  models: "/api/gateway/models",
  usage: "/api/gateway/usage",
});

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  return String(value ?? "").trim();
}

function integerValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function listValue(value) {
  const list = Array.isArray(value) ? value : textValue(value).split(/[\n,]/);
  return [...new Set(list.map(textValue).filter(Boolean))];
}

function encoded(value) {
  return encodeURIComponent(textValue(value));
}

function normalizedDateTime(value) {
  const text = textValue(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function dateTimeInputValue(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function normalizeGatewaySettings(settings = {}) {
  const gateway = objectValue(objectValue(settings).gateway);
  return {
    enabled: Boolean(gateway.enabled),
    host: textValue(gateway.host),
    port: integerValue(gateway.port),
    maxGlobalConcurrency: integerValue(gateway.maxGlobalConcurrency),
    maxRequestBytes: integerValue(gateway.maxRequestBytes),
  };
}

export function normalizeGatewayKey(value = {}) {
  const key = objectValue(value);
  return {
    id: textValue(key.id),
    name: textValue(key.name),
    keyPrefix: textValue(key.keyPrefix),
    enabled: key.enabled !== false,
    allowedModels: listValue(key.allowedModels),
    requestsPerMinute: integerValue(key.requestsPerMinute),
    monthlyTokenLimit: integerValue(key.monthlyTokenLimit),
    maxConcurrency: integerValue(key.maxConcurrency),
    expiresAt: textValue(key.expiresAt),
    lastUsedAt: textValue(key.lastUsedAt),
    revokedAt: textValue(key.revokedAt),
    createdAt: textValue(key.createdAt),
    updatedAt: textValue(key.updatedAt),
    usage: objectValue(key.usage),
  };
}

export function normalizeGatewayKeys(payload = {}) {
  const keys = Array.isArray(payload) ? payload : objectValue(payload).keys;
  return (Array.isArray(keys) ? keys : []).map(normalizeGatewayKey).filter((key) => key.id);
}

export function normalizeGatewayModel(value = {}) {
  const model = objectValue(value);
  return {
    alias: textValue(model.alias),
    targetModel: textValue(model.targetModel),
    enabled: model.enabled !== false,
    createdAt: textValue(model.createdAt),
    updatedAt: textValue(model.updatedAt),
  };
}

export function normalizeGatewayModels(payload = {}) {
  const models = Array.isArray(payload) ? payload : objectValue(payload).models;
  return (Array.isArray(models) ? models : []).map(normalizeGatewayModel).filter((model) => model.alias);
}

export function gatewayProviderRestriction(provider = {}) {
  const name = textValue(provider.name).toLowerCase();
  const type = textValue(provider.type).toLowerCase();
  const profile = textValue(provider.profile).toLowerCase();
  if (name === "codex" || type === "codex") return "codex";
  if (profile === "cliproxyapi") return "oauthProxy";
  return "";
}

export function isCodexGatewayProvider(provider = {}) {
  return gatewayProviderRestriction(provider) === "codex";
}

export function gatewayProviderRequest(name, gatewayEnabled) {
  const providerName = textValue(name);
  if (!providerName) throw new TypeError("Provider name is required");
  return {
    path: `/api/providers/${encoded(providerName)}`,
    options: { method: "PATCH", body: JSON.stringify({ gatewayEnabled: Boolean(gatewayEnabled) }) },
  };
}

export function gatewayKeyPolicyPayload(draft = {}) {
  const source = objectValue(draft);
  const payload = {
    name: textValue(source.name),
    enabled: source.enabled !== false,
    allowedModels: listValue(source.allowedModels),
    requestsPerMinute: integerValue(source.requestsPerMinute),
    monthlyTokenLimit: integerValue(source.monthlyTokenLimit),
    maxConcurrency: integerValue(source.maxConcurrency),
    expiresAt: normalizedDateTime(source.expiresAt),
  };
  if (!payload.name) delete payload.name;
  if (!payload.expiresAt) payload.expiresAt = "";
  return payload;
}

export function gatewayKeyRequest(action, keyOrID = {}, draft = {}) {
  const key = typeof keyOrID === "string" ? { id: keyOrID } : objectValue(keyOrID);
  const id = textValue(key.id);
  if (action === "create") return { path: endpoints.keys, options: { method: "POST", cache: "no-store", body: JSON.stringify(gatewayKeyPolicyPayload(draft)) } };
  if (!id) throw new TypeError("Gateway key id is required");
  const base = `${endpoints.keys}/${encoded(id)}`;
  const expectedUpdatedAt = textValue(draft.expectedUpdatedAt ?? key.updatedAt);
  if (action === "update") return { path: base, options: { method: "PATCH", body: JSON.stringify({ ...gatewayKeyPolicyPayload(draft), expectedUpdatedAt }) } };
  if (action === "toggle") return { path: base, options: { method: "PATCH", body: JSON.stringify({ enabled: !Boolean(key.enabled), expectedUpdatedAt }) } };
  if (action === "rotate") return { path: `${base}/rotate`, options: { method: "POST", cache: "no-store" } };
  if (action === "revoke") return { path: `${base}/revoke`, options: { method: "POST" } };
  throw new TypeError(`Unknown gateway key action: ${action}`);
}

export function gatewayModelRequest(action, modelOrAlias = {}, draft = {}) {
  const model = typeof modelOrAlias === "string" ? { alias: modelOrAlias } : objectValue(modelOrAlias);
  const alias = textValue(model.alias);
  const payload = {
    alias: textValue(draft.alias ?? model.alias),
    targetModel: textValue(draft.targetModel ?? model.targetModel),
    enabled: (draft.enabled ?? model.enabled) !== false,
  };
  if (action === "create") return { path: endpoints.models, options: { method: "POST", body: JSON.stringify(payload) } };
  if (!alias) throw new TypeError("Gateway model alias is required");
  const path = `${endpoints.models}?alias=${encoded(alias)}`;
  if (action === "update") return { path, options: { method: "PATCH", body: JSON.stringify({ ...payload, expectedUpdatedAt: textValue(draft.expectedUpdatedAt ?? model.updatedAt) }) } };
  if (action === "delete") return { path, options: { method: "DELETE" } };
  throw new TypeError(`Unknown gateway model action: ${action}`);
}

function replaceBy(items, item, field) {
  const index = items.findIndex((candidate) => candidate[field] === item[field]);
  if (index < 0) return [item, ...items];
  return items.map((candidate, candidateIndex) => candidateIndex === index ? item : candidate);
}

function formatDate(value) {
  if (!value) return t("sharedAPI.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(currentUILocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat(currentUILocale()).format(integerValue(value));
}

function keyStatus(key) {
  if (key.revokedAt) return { key: "revoked", tone: "danger" };
  if (!key.enabled) return { key: "paused", tone: "warn" };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return { key: "expired", tone: "warn" };
  return { key: "active", tone: "ok" };
}

function providerLabel(provider) {
  return textValue(provider.name) || textValue(provider.type) || t("sharedAPI.unknownProvider");
}

function gatewayAddress(gateway) {
  if (!gateway.host && !gateway.port) return t("sharedAPI.notConfigured");
  const host = gateway.host || "127.0.0.1";
  return gateway.port ? `${host}:${gateway.port}` : host;
}

function keyUsageValue(key) {
  return integerValue(key.usage.monthlyTokens ?? key.usage.tokens ?? key.usage.tokenCount);
}

function keyEditorValues(key = {}) {
  const normalized = normalizeGatewayKey(key);
  return {
    name: normalized.name,
    enabled: normalized.enabled,
    allowedModels: normalized.allowedModels.join("\n"),
    requestsPerMinute: normalized.requestsPerMinute,
    monthlyTokenLimit: normalized.monthlyTokenLimit,
    maxConcurrency: normalized.maxConcurrency,
    expiresAt: dateTimeInputValue(normalized.expiresAt),
  };
}

export function createSharedAPISettingsController({
  state,
  request,
  reloadSettings,
  copyText,
  onChange,
  showError,
  showToast,
  confirmAction = (message) => globalThis.confirm?.(message) !== false,
} = {}) {
  let oneTimeToken = "";
  let oneTimeTokenContext = "";
  let editingKeyID = "";
  let keyEditorOpen = false;
  let editingModelAlias = "";
  let modelEditorOpen = false;
  let loadSequence = 0;

  function ensureState() {
    if (!Array.isArray(state.gatewayKeys)) state.gatewayKeys = [];
    if (!Array.isArray(state.gatewayModels)) state.gatewayModels = [];
    if (!state.gatewayUsage || typeof state.gatewayUsage !== "object") state.gatewayUsage = { items: [], summary: {} };
    if (typeof state.gatewayDataLoaded !== "boolean") state.gatewayDataLoaded = false;
    if (typeof state.gatewayDataLoading !== "boolean") state.gatewayDataLoading = false;
    if (typeof state.gatewayAPIError !== "string") state.gatewayAPIError = "";
  }

  function gateway() {
    return normalizeGatewaySettings(state.settings || {});
  }

  function changed() {
    onChange?.();
  }

  function setError(error) {
    state.gatewayAPIError = error?.message || String(error || t("sharedAPI.requestFailed"));
    changed();
  }

  async function perform(path, options) {
    try {
      const result = await request(path, options);
      state.gatewayAPIError = "";
      return result;
    } catch (error) {
      setError(error);
      throw error;
    }
  }

  async function load({ refreshSettings = false } = {}) {
    ensureState();
    const sequence = ++loadSequence;
    state.gatewayDataLoading = true;
    state.gatewayAPIError = "";
    try {
      if (refreshSettings) await reloadSettings?.();
      if (sequence !== loadSequence) return false;
      if (!gateway().enabled) {
        state.gatewayKeys = [];
        state.gatewayModels = [];
        state.gatewayUsage = { items: [], summary: {} };
        state.gatewayDataLoaded = true;
        return true;
      }
      const results = await Promise.allSettled([
        request(endpoints.keys),
        request(endpoints.models),
        request(endpoints.usage),
      ]);
      if (sequence !== loadSequence) return false;
      if (results[0].status === "fulfilled") state.gatewayKeys = normalizeGatewayKeys(results[0].value);
      if (results[1].status === "fulfilled") state.gatewayModels = normalizeGatewayModels(results[1].value);
      if (results[2].status === "fulfilled") {
        const usage = objectValue(results[2].value);
        state.gatewayUsage = { items: Array.isArray(usage.items) ? usage.items : [], summary: objectValue(usage.summary) };
      }
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      state.gatewayDataLoaded = true;
      return true;
    } catch (error) {
      if (sequence !== loadSequence) return false;
      state.gatewayAPIError = error?.message || String(error || t("sharedAPI.requestFailed"));
      throw error;
    } finally {
      if (sequence === loadSequence) {
        state.gatewayDataLoaded = true;
        state.gatewayDataLoading = false;
        changed();
      }
    }
  }

  async function refreshAfterConflict(error) {
    if (error?.status !== 409) throw error;
    let refreshed = false;
    try {
      refreshed = await load({ refreshSettings: true });
    } catch {}
    const message = t(refreshed ? "sharedAPI.conflict" : "sharedAPI.conflictRefreshFailed");
    state.gatewayAPIError = message;
    changed();
    throw new Error(message);
  }

  function revealToken(result, context) {
    oneTimeToken = textValue(result?.token);
    oneTimeTokenContext = textValue(context);
  }

  function dismissToken() {
    oneTimeToken = "";
    oneTimeTokenContext = "";
    changed();
  }

  async function copyOneTimeToken() {
    if (!oneTimeToken) return false;
    try {
      if (await copyText?.(oneTimeToken) === true) {
        showToast?.(t("sharedAPI.tokenCopied"));
        return true;
      }
    } catch {}
    showToast?.(t("sharedAPI.tokenCopyFailed"), "warn");
    return false;
  }

  async function createKey(draft) {
    const call = gatewayKeyRequest("create", {}, draft);
    const result = await perform(call.path, call.options);
    if (result?.key) state.gatewayKeys = replaceBy(state.gatewayKeys, normalizeGatewayKey(result.key), "id");
    revealToken(result, result?.key?.name || draft?.name || t("sharedAPI.newKey"));
    keyEditorOpen = false;
    editingKeyID = "";
    showToast?.(t("sharedAPI.keyCreated"));
    changed();
    return result;
  }

  async function updateKey(id, draft) {
    const key = state.gatewayKeys.find((item) => item.id === id) || { id };
    const call = gatewayKeyRequest("update", key, draft);
    let result;
    try {
      result = await perform(call.path, call.options);
    } catch (error) {
      return refreshAfterConflict(error);
    }
    if (result?.key) state.gatewayKeys = replaceBy(state.gatewayKeys, normalizeGatewayKey(result.key), "id");
    editingKeyID = "";
    showToast?.(t("sharedAPI.keyUpdated"));
    changed();
    return result;
  }

  async function toggleKey(id) {
    const key = state.gatewayKeys.find((item) => item.id === id);
    if (!key || key.revokedAt) return null;
    const call = gatewayKeyRequest("toggle", key);
    let result;
    try {
      result = await perform(call.path, call.options);
    } catch (error) {
      return refreshAfterConflict(error);
    }
    state.gatewayKeys = replaceBy(state.gatewayKeys, normalizeGatewayKey(result?.key || { ...key, enabled: !key.enabled }), "id");
    showToast?.(t(key.enabled ? "sharedAPI.keyPaused" : "sharedAPI.keyResumed"));
    changed();
    return result;
  }

  async function rotateKey(id) {
    const key = state.gatewayKeys.find((item) => item.id === id);
    if (!key || key.revokedAt || !confirmAction(t("sharedAPI.rotateConfirm", { name: key.name || key.keyPrefix }))) return null;
    const call = gatewayKeyRequest("rotate", key);
    const result = await perform(call.path, call.options);
    if (result?.key) state.gatewayKeys = replaceBy(state.gatewayKeys, normalizeGatewayKey(result.key), "id");
    revealToken(result, result?.key?.name || key.name || key.keyPrefix);
    showToast?.(t("sharedAPI.keyRotated"));
    changed();
    return result;
  }

  async function revokeKey(id) {
    const key = state.gatewayKeys.find((item) => item.id === id);
    if (!key || key.revokedAt || !confirmAction(t("sharedAPI.revokeConfirm", { name: key.name || key.keyPrefix }))) return null;
    const call = gatewayKeyRequest("revoke", key);
    const result = await perform(call.path, call.options);
    state.gatewayKeys = replaceBy(state.gatewayKeys, normalizeGatewayKey(result?.key || { ...key, enabled: false, revokedAt: new Date().toISOString() }), "id");
    if (editingKeyID === id) editingKeyID = "";
    showToast?.(t("sharedAPI.keyRevoked"));
    changed();
    return result;
  }

  async function toggleProvider(name, enabled) {
    const provider = (state.settings?.providers || []).find((item) => item.name === name);
    if (!provider || gatewayProviderRestriction(provider)) return null;
    const call = gatewayProviderRequest(name, enabled);
    const result = await perform(call.path, call.options);
    provider.gatewayEnabled = Boolean(enabled);
    showToast?.(t(enabled ? "sharedAPI.providerShared" : "sharedAPI.providerUnshared", { name: providerLabel(provider) }));
    changed();
    return result;
  }

  async function createModel(draft) {
    const call = gatewayModelRequest("create", {}, draft);
    const result = await perform(call.path, call.options);
    if (result?.model) state.gatewayModels = replaceBy(state.gatewayModels, normalizeGatewayModel(result.model), "alias");
    modelEditorOpen = false;
    editingModelAlias = "";
    showToast?.(t("sharedAPI.modelCreated"));
    changed();
    return result;
  }

  async function updateModel(alias, draft) {
    const model = state.gatewayModels.find((item) => item.alias === alias) || { alias };
    const call = gatewayModelRequest("update", model, draft);
    let result;
    try {
      result = await perform(call.path, call.options);
    } catch (error) {
      return refreshAfterConflict(error);
    }
    if (result?.model) {
      state.gatewayModels = state.gatewayModels.filter((item) => item.alias !== alias);
      state.gatewayModels = replaceBy(state.gatewayModels, normalizeGatewayModel(result.model), "alias");
    }
    editingModelAlias = "";
    showToast?.(t("sharedAPI.modelUpdated"));
    changed();
    return result;
  }

  async function deleteModel(alias) {
    if (!confirmAction(t("sharedAPI.deleteModelConfirm", { alias }))) return null;
    const call = gatewayModelRequest("delete", alias);
    const result = await perform(call.path, call.options);
    state.gatewayModels = state.gatewayModels.filter((item) => item.alias !== alias);
    if (editingModelAlias === alias) editingModelAlias = "";
    showToast?.(t("sharedAPI.modelDeleted"));
    changed();
    return result;
  }

  function renderGateway() {
    const value = gateway();
    return `
      <section class="compact-settings-section shared-api-gateway-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("sharedAPI.gatewayTitle"))}</h2><p data-settings-help-copy>${escapeHtml(t("sharedAPI.gatewayDescription"))}</p></div>
        <div class="compact-settings-section-controls">
          <div class="shared-api-status-row"><span class="settings-badge ${value.enabled ? "ok" : "warn"}">${escapeHtml(t(value.enabled ? "sharedAPI.enabled" : "sharedAPI.disabled"))}</span><code>${escapeHtml(gatewayAddress(value))}</code></div>
          <dl class="shared-api-gateway-meta">
            <div><dt>${escapeHtml(t("sharedAPI.listenAddress"))}</dt><dd>${escapeHtml(gatewayAddress(value))}</dd></div>
            <div><dt>${escapeHtml(t("sharedAPI.globalConcurrency"))}</dt><dd>${escapeHtml(value.maxGlobalConcurrency ? formatNumber(value.maxGlobalConcurrency) : t("sharedAPI.unlimited"))}</dd></div>
            <div><dt>${escapeHtml(t("sharedAPI.maxRequestBytes"))}</dt><dd>${escapeHtml(value.maxRequestBytes ? formatNumber(value.maxRequestBytes) : t("sharedAPI.notConfigured"))}</dd></div>
          </dl>
          <div class="settings-inline-alert shared-api-security-note" role="note"><strong>${escapeHtml(t("sharedAPI.securityTitle"))}</strong><span>${escapeHtml(t("sharedAPI.securityNotice"))}</span></div>
          ${value.enabled ? "" : `<div class="settings-inline-alert settings-alert" role="status">${escapeHtml(t("sharedAPI.disabledNotice"))}</div>`}
        </div>
      </section>`;
  }

  function renderProviders() {
    const providers = Array.isArray(state.settings?.providers) ? state.settings.providers : [];
    return `
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("sharedAPI.providersTitle"))}</h2><p data-settings-help-copy>${escapeHtml(t("sharedAPI.providersDescription"))}</p></div>
        <div class="compact-settings-section-controls shared-api-list">
          ${providers.length ? providers.map((provider) => {
            const restriction = gatewayProviderRestriction(provider);
            const restrictionMessage = restriction === "codex" ? "sharedAPI.codexUnavailable" : "sharedAPI.oauthProxyUnavailable";
            return `<div class="shared-api-row ${restriction ? "is-disabled" : ""}"><span><strong>${escapeHtml(providerLabel(provider))}</strong><small>${escapeHtml(restriction ? t(restrictionMessage) : t(provider.gatewayEnabled ? "sharedAPI.providerEligible" : "sharedAPI.providerPrivate"))}</small></span>${restriction ? `<span class="settings-badge">${escapeHtml(t("sharedAPI.notShareable"))}</span>` : `<label class="shared-api-switch"><input type="checkbox" data-gateway-provider="${escapeAttr(provider.name)}" ${provider.gatewayEnabled ? "checked" : ""} /><span>${escapeHtml(t("sharedAPI.shareProvider"))}</span></label>`}</div>`;
          }).join("") : `<div class="settings-empty-state">${escapeHtml(t("sharedAPI.noProviders"))}</div>`}
        </div>
      </section>`;
  }

  function renderModelForm(model = {}) {
    const value = normalizeGatewayModel(model);
    const editing = Boolean(value.alias);
    return `<form class="compact-settings-editor shared-api-model-form" data-gateway-model-form="${escapeAttr(editing ? value.alias : "new")}">
      <div class="compact-settings-grid two-column">
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.alias"))}<input class="settings-field" name="alias" value="${escapeAttr(value.alias)}" required autocomplete="off" /></label>
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.targetModel"))}<input class="settings-field" name="targetModel" value="${escapeAttr(value.targetModel)}" required placeholder="provider:model" autocomplete="off" /></label>
      </div>
      <label class="compact-settings-switch-row"><span><strong>${escapeHtml(t("sharedAPI.aliasEnabled"))}</strong><small data-settings-help-copy>${escapeHtml(t("sharedAPI.aliasEnabledHint"))}</small></span><input name="enabled" type="checkbox" ${value.enabled ? "checked" : ""} /></label>
      <div class="settings-inline-actions compact-settings-editor-actions"><button class="settings-action-btn subtle" type="button" data-gateway-model-cancel>${escapeHtml(t("sharedAPI.cancel"))}</button><button class="settings-action-btn primary" type="submit">${escapeHtml(t(editing ? "sharedAPI.save" : "sharedAPI.createAlias"))}</button></div>
    </form>`;
  }

  function renderModels() {
    return `
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("sharedAPI.modelsTitle"))}</h2><p data-settings-help-copy>${escapeHtml(t("sharedAPI.modelsDescription"))}</p></div>
        <div class="compact-settings-section-controls">
          <div class="compact-settings-section-toolbar"><span class="settings-badge">${escapeHtml(t("sharedAPI.modelCount", { count: state.gatewayModels.length }))}</span><button class="settings-action-btn subtle" type="button" data-gateway-model-add ${gateway().enabled ? "" : "disabled"}>${escapeHtml(t("sharedAPI.addAlias"))}</button></div>
          ${modelEditorOpen && !editingModelAlias ? renderModelForm() : ""}
          <div class="shared-api-list">${state.gatewayModels.length ? state.gatewayModels.map((model) => editingModelAlias === model.alias ? renderModelForm(model) : `<div class="shared-api-row shared-api-model-row"><span><strong><code>${escapeHtml(model.alias)}</code> → <code>${escapeHtml(model.targetModel)}</code></strong><small>${escapeHtml(t(model.enabled ? "sharedAPI.aliasActive" : "sharedAPI.aliasDisabled"))}</small></span><div class="settings-inline-actions"><span class="settings-badge ${model.enabled ? "ok" : "warn"}">${escapeHtml(t(model.enabled ? "sharedAPI.enabled" : "sharedAPI.disabled"))}</span><button class="settings-action-btn subtle" type="button" data-gateway-model-edit="${escapeAttr(model.alias)}">${escapeHtml(t("sharedAPI.edit"))}</button><button class="settings-action-btn danger" type="button" data-gateway-model-delete="${escapeAttr(model.alias)}">${escapeHtml(t("sharedAPI.delete"))}</button></div></div>`).join("") : `<div class="settings-empty-state">${escapeHtml(t("sharedAPI.noModels"))}</div>`}</div>
        </div>
      </section>`;
  }

  function renderKeyForm(key = {}) {
    const value = keyEditorValues(key);
    const editing = Boolean(key.id);
    return `<form class="compact-settings-editor shared-api-key-form" data-gateway-key-form="${escapeAttr(editing ? key.id : "new")}">
      <div class="compact-settings-grid two-column">
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.keyName"))}<input class="settings-field" name="name" value="${escapeAttr(value.name)}" required autocomplete="off" /></label>
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.expiresAt"))}<input class="settings-field" name="expiresAt" type="datetime-local" value="${escapeAttr(value.expiresAt)}" /></label>
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.requestsPerMinute"))}<input class="settings-field" name="requestsPerMinute" type="number" min="0" step="1" value="${escapeAttr(value.requestsPerMinute)}" /><small data-settings-help-copy>${escapeHtml(t("sharedAPI.zeroUnlimited"))}</small></label>
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.monthlyTokenLimit"))}<input class="settings-field" name="monthlyTokenLimit" type="number" min="0" step="1" value="${escapeAttr(value.monthlyTokenLimit)}" /><small data-settings-help-copy>${escapeHtml(t("sharedAPI.zeroUnlimited"))}</small></label>
        <label class="settings-form-field">${escapeHtml(t("sharedAPI.maxConcurrency"))}<input class="settings-field" name="maxConcurrency" type="number" min="0" step="1" value="${escapeAttr(value.maxConcurrency)}" /><small data-settings-help-copy>${escapeHtml(t("sharedAPI.zeroUnlimited"))}</small></label>
        <label class="settings-form-field full-width">${escapeHtml(t("sharedAPI.allowedModels"))}<textarea class="settings-field" name="allowedModels" placeholder="public-chat\npublic-code">${escapeHtml(value.allowedModels)}</textarea><small data-settings-help-copy>${escapeHtml(t("sharedAPI.allowedModelsHint"))}</small></label>
      </div>
      <label class="compact-settings-switch-row"><span><strong>${escapeHtml(t("sharedAPI.keyEnabled"))}</strong><small data-settings-help-copy>${escapeHtml(t("sharedAPI.keyEnabledHint"))}</small></span><input name="enabled" type="checkbox" ${value.enabled ? "checked" : ""} /></label>
      <div class="settings-inline-actions compact-settings-editor-actions"><button class="settings-action-btn subtle" type="button" data-gateway-key-cancel>${escapeHtml(t("sharedAPI.cancel"))}</button><button class="settings-action-btn primary" type="submit">${escapeHtml(t(editing ? "sharedAPI.save" : "sharedAPI.createKey"))}</button></div>
    </form>`;
  }

  function renderOneTimeToken() {
    if (!oneTimeToken) return "";
    return `<div class="shared-api-token settings-inline-alert" role="status"><div><strong>${escapeHtml(t("sharedAPI.tokenTitle", { name: oneTimeTokenContext }))}</strong><span>${escapeHtml(t("sharedAPI.tokenNotice"))}</span></div><code>${escapeHtml(oneTimeToken)}</code><div class="settings-inline-actions"><button class="settings-action-btn primary" type="button" data-gateway-token-copy>${escapeHtml(t("sharedAPI.copyToken"))}</button><button class="settings-action-btn subtle" type="button" data-gateway-token-dismiss>${escapeHtml(t("sharedAPI.closeToken"))}</button></div></div>`;
  }

  function renderKey(key) {
    const status = keyStatus(key);
    const usage = keyUsageValue(key);
    const modelText = key.allowedModels.length ? key.allowedModels.join(", ") : t("sharedAPI.allModels");
    const quota = key.monthlyTokenLimit ? `${formatNumber(usage)} / ${formatNumber(key.monthlyTokenLimit)}` : t("sharedAPI.unlimited");
    return `<article class="shared-api-key-card ${key.revokedAt ? "is-revoked" : ""}">
      <div class="shared-api-key-head"><span><strong>${escapeHtml(key.name || t("sharedAPI.unnamedKey"))}</strong><code>${escapeHtml(key.keyPrefix || "—")}</code></span><span class="settings-badge ${status.tone}">${escapeHtml(t(`sharedAPI.status.${status.key}`))}</span></div>
      <dl class="shared-api-key-meta"><div><dt>${escapeHtml(t("sharedAPI.lastUsed"))}</dt><dd>${escapeHtml(formatDate(key.lastUsedAt))}</dd></div><div><dt>${escapeHtml(t("sharedAPI.monthlyQuota"))}</dt><dd>${escapeHtml(quota)}</dd></div><div><dt>${escapeHtml(t("sharedAPI.allowedModels"))}</dt><dd title="${escapeAttr(modelText)}">${escapeHtml(modelText)}</dd></div><div><dt>${escapeHtml(t("sharedAPI.expiresAt"))}</dt><dd>${escapeHtml(formatDate(key.expiresAt))}</dd></div></dl>
      <div class="settings-inline-actions shared-api-key-actions">${key.revokedAt ? "" : `<button class="settings-action-btn subtle" type="button" data-gateway-key-edit="${escapeAttr(key.id)}">${escapeHtml(t("sharedAPI.edit"))}</button><button class="settings-action-btn subtle" type="button" data-gateway-key-toggle="${escapeAttr(key.id)}">${escapeHtml(t(key.enabled ? "sharedAPI.pause" : "sharedAPI.resume"))}</button><button class="settings-action-btn subtle" type="button" data-gateway-key-rotate="${escapeAttr(key.id)}">${escapeHtml(t("sharedAPI.rotate"))}</button><button class="settings-action-btn danger" type="button" data-gateway-key-revoke="${escapeAttr(key.id)}">${escapeHtml(t("sharedAPI.revoke"))}</button>`}</div>
    </article>`;
  }

  function renderKeys() {
    return `
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("sharedAPI.keysTitle"))}</h2><p data-settings-help-copy>${escapeHtml(t("sharedAPI.keysDescription"))}</p></div>
        <div class="compact-settings-section-controls">
          <div class="compact-settings-section-toolbar"><span class="settings-badge">${escapeHtml(t("sharedAPI.keyCount", { count: state.gatewayKeys.length }))}</span><button class="settings-action-btn primary" type="button" data-gateway-key-add ${gateway().enabled ? "" : "disabled"}>${escapeHtml(t("sharedAPI.addKey"))}</button></div>
          ${renderOneTimeToken()}
          ${keyEditorOpen && !editingKeyID ? renderKeyForm() : ""}
          <div class="shared-api-key-list">${state.gatewayKeys.length ? state.gatewayKeys.map((key) => editingKeyID === key.id ? renderKeyForm(key) : renderKey(key)).join("") : `<div class="settings-empty-state">${escapeHtml(t("sharedAPI.noKeys"))}</div>`}</div>
        </div>
      </section>`;
  }

  function renderUsage() {
    const summary = objectValue(state.gatewayUsage.summary);
    const values = [
      ["requests", summary.requests ?? summary.totalRequests],
      ["tokens", summary.tokens ?? summary.totalTokens],
      ["activeKeys", summary.activeKeys],
      ["errors", summary.errors ?? summary.errorCount],
    ].filter(([, value]) => value !== undefined && value !== null);
    return `<section class="compact-settings-section"><div class="compact-settings-section-copy"><h2>${escapeHtml(t("sharedAPI.usageTitle"))}</h2><p data-settings-help-copy>${escapeHtml(t("sharedAPI.usageDescription"))}</p></div><div class="compact-settings-section-controls">${values.length ? `<div class="shared-api-usage-grid">${values.map(([key, value]) => `<div><strong>${escapeHtml(formatNumber(value))}</strong><span>${escapeHtml(t(`sharedAPI.usage.${key}`))}</span></div>`).join("")}</div>` : `<div class="settings-empty-state">${escapeHtml(t("sharedAPI.noUsage"))}</div>`}</div></section>`;
  }

  function render() {
    ensureState();
    return `<div class="compact-settings-page shared-api-page">
      <header class="compact-settings-header"><div class="compact-settings-heading"><h1>${escapeHtml(t("sharedAPI.title"))}</h1><p data-settings-help-copy>${escapeHtml(t("sharedAPI.description"))}</p></div><div class="compact-settings-header-actions"><span class="settings-badge ${gateway().enabled ? "ok" : "warn"}">${escapeHtml(t(gateway().enabled ? "sharedAPI.gatewayOn" : "sharedAPI.gatewayOff"))}</span><button class="settings-action-btn subtle" type="button" data-gateway-refresh ${state.gatewayDataLoading ? "disabled" : ""}>${escapeHtml(state.gatewayDataLoading ? t("sharedAPI.loading") : t("sharedAPI.refresh"))}</button></div></header>
      ${state.gatewayAPIError ? `<div class="settings-inline-alert settings-alert shared-api-error" role="alert">${escapeHtml(t("sharedAPI.error", { message: state.gatewayAPIError }))}</div>` : ""}
      ${renderGateway()}${renderProviders()}${renderModels()}${renderKeys()}${renderUsage()}
    </div>`;
  }

  function keyDraftFromForm(form) {
    return {
      name: form.elements.name?.value,
      enabled: Boolean(form.elements.enabled?.checked),
      allowedModels: form.elements.allowedModels?.value,
      requestsPerMinute: form.elements.requestsPerMinute?.value,
      monthlyTokenLimit: form.elements.monthlyTokenLimit?.value,
      maxConcurrency: form.elements.maxConcurrency?.value,
      expiresAt: form.elements.expiresAt?.value,
    };
  }

  function modelDraftFromForm(form) {
    return { alias: form.elements.alias?.value, targetModel: form.elements.targetModel?.value, enabled: Boolean(form.elements.enabled?.checked) };
  }

  function runButton(button, work) {
    setButtonBusy(button, true);
    Promise.resolve().then(work).catch(showError).finally(() => setButtonBusy(button, false));
  }

  function bind() {
    ensureState();
    if (!state.gatewayDataLoaded && !state.gatewayDataLoading) load().catch(() => {});
    $("settingsContentBody")?.querySelector?.("[data-gateway-refresh]")?.addEventListener("click", (event) => runButton(event.currentTarget, () => load({ refreshSettings: true })));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-provider]").forEach((input) => input.addEventListener("change", (event) => runButton(event.currentTarget, () => toggleProvider(event.currentTarget.dataset.gatewayProvider, event.currentTarget.checked))));
    $("settingsContentBody")?.querySelector?.("[data-gateway-model-add]")?.addEventListener("click", () => { modelEditorOpen = true; editingModelAlias = ""; changed(); });
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-model-edit]").forEach((button) => button.addEventListener("click", () => { editingModelAlias = button.dataset.gatewayModelEdit; modelEditorOpen = false; changed(); }));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-model-delete]").forEach((button) => button.addEventListener("click", () => runButton(button, () => deleteModel(button.dataset.gatewayModelDelete))));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-model-cancel]").forEach((button) => button.addEventListener("click", () => { modelEditorOpen = false; editingModelAlias = ""; changed(); }));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-model-form]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const alias = form.dataset.gatewayModelForm; runButton(form.querySelector("[type=submit]"), () => alias === "new" ? createModel(modelDraftFromForm(form)) : updateModel(alias, modelDraftFromForm(form))); }));
    $("settingsContentBody")?.querySelector?.("[data-gateway-key-add]")?.addEventListener("click", () => { keyEditorOpen = true; editingKeyID = ""; changed(); });
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-edit]").forEach((button) => button.addEventListener("click", () => { editingKeyID = button.dataset.gatewayKeyEdit; keyEditorOpen = false; changed(); }));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-toggle]").forEach((button) => button.addEventListener("click", () => runButton(button, () => toggleKey(button.dataset.gatewayKeyToggle))));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-rotate]").forEach((button) => button.addEventListener("click", () => runButton(button, () => rotateKey(button.dataset.gatewayKeyRotate))));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-revoke]").forEach((button) => button.addEventListener("click", () => runButton(button, () => revokeKey(button.dataset.gatewayKeyRevoke))));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-cancel]").forEach((button) => button.addEventListener("click", () => { keyEditorOpen = false; editingKeyID = ""; changed(); }));
    $("settingsContentBody")?.querySelectorAll?.("[data-gateway-key-form]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const id = form.dataset.gatewayKeyForm; runButton(form.querySelector("[type=submit]"), () => id === "new" ? createKey(keyDraftFromForm(form)) : updateKey(id, keyDraftFromForm(form))); }));
    $("settingsContentBody")?.querySelector?.("[data-gateway-token-copy]")?.addEventListener("click", (event) => runButton(event.currentTarget, copyOneTimeToken));
    $("settingsContentBody")?.querySelector?.("[data-gateway-token-dismiss]")?.addEventListener("click", dismissToken);
  }

  function consumeOneTimeToken() {
    const token = oneTimeToken;
    oneTimeToken = "";
    oneTimeTokenContext = "";
    return token;
  }

  ensureState();
  return {
    bind,
    consumeOneTimeToken,
    copyOneTimeToken,
    createKey,
    createModel,
    deleteModel,
    dismissToken,
    load,
    oneTimeTokenValue: () => oneTimeToken,
    render,
    revokeKey,
    rotateKey,
    toggleKey,
    toggleProvider,
    updateKey,
    updateModel,
  };
}
