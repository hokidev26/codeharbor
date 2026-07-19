import { escapeAttr, escapeHtml } from "./dom.mjs";
import { t } from "./i18n.mjs";

const ct = (key, params) => t(`modelProvider.console.${key}`, params);

export const providerTypeTemplates = [
  {
    key: "codex",
    templateKey: "codexOAuth",
    type: "codex",
    name: "codex",
    model: "gpt-5.5",
    apiKeyOptional: true,
    category: "official",
  },
  {
    key: "openai",
    templateKey: "openaiOfficial",
    type: "openai",
    name: "openai",
    model: "gpt-4.1-mini",
    category: "official",
  },
  {
    key: "anthropic",
    templateKey: "anthropicOfficial",
    type: "anthropic",
    name: "anthropic",
    model: "claude-sonnet-4-5",
    maxTokens: 4096,
    category: "official",
  },
  {
    key: "openai-compatible",
    templateKey: "openaiCompatible",
    type: "openai-compatible",
    name: "custom-openai",
    baseUrl: "https://api.example.com/v1",
    model: "your-model",
    category: "custom",
  },
  {
    key: "anthropic-compatible",
    templateKey: "anthropicCompatible",
    type: "anthropic",
    name: "custom-anthropic",
    baseUrl: "https://api.example.com",
    model: "your-model",
    maxTokens: 4096,
    category: "custom",
  },
  {
    key: "ollama",
    templateKey: "ollama",
    type: "openai-compatible",
    name: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    apiKeyOptional: true,
    category: "official",
  },
];

const builtinProviderNames = new Set([
  "codex",
  "openai",
  "anthropic",
  "openai-compatible",
  "cliproxyapi",
  "ollama",
]);
const categoryMeta = {
  all: { labelKey: "categories.all", titleKey: "categories.all" },
  official: { labelKey: "categories.officialPlatforms", titleKey: "officialPlatforms" },
  custom: { labelKey: "categories.custom", titleKey: "customProviders" },
  compatible: { labelKey: "categories.compatibleAdvanced", titleKey: "compatibleAdvanced" },
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function providerKey(provider) {
  return stringValue(provider?.name || provider?.type).toLowerCase();
}

function providerIdentityKeys(provider = {}) {
  return [provider.name, provider.type, provider.profile]
    .map((value) => stringValue(value).toLowerCase())
    .filter(Boolean);
}

const apiKeySources = new Set(["stored", "environment", "runtime", "optional", "none", "stored_unavailable"]);

function safeApiKeyMetadata(provider = {}) {
  const source = stringValue(provider.apiKeySource).toLowerCase();
  const lastFive = stringValue(provider.apiKeyLastFive);
  return {
    apiKeyConfigured: Boolean(provider.apiKeyConfigured),
    apiKeyPersisted: Boolean(provider.apiKeyPersisted),
    apiKeyLastFive: lastFive.slice(-5),
    apiKeySource: apiKeySources.has(source) ? source : "none",
  };
}

function settingsRecord(provider = {}) {
  const { apiKey: _apiKey, ...safeProvider } = provider || {};
  return {
    ...safeProvider,
    ...safeApiKeyMetadata(provider),
    name: stringValue(provider.name || provider.type),
    type: stringValue(provider.type || provider.name || "openai-compatible"),
    defaultModel: stringValue(provider.defaultModel || provider.model),
    models: asArray(provider.models),
  };
}

export function isBuiltinProvider(provider = {}) {
  const origin = stringValue(provider.origin).toLowerCase();
  if (origin === "custom") return false;
  if (origin === "builtin") return true;
  // Unknown lifecycle metadata must never unlock deletion. The named set preserves
  // built-in handling for older server responses without an origin field.
  return !origin || providerIdentityKeys(provider).some((key) => builtinProviderNames.has(key));
}

export function isProviderDeletable(provider = {}) {
  return stringValue(provider.origin).toLowerCase() === "custom";
}

export function isAnthropicAccountProvider(provider = {}) {
  const normalized = normalizeConsoleProvider(provider);
  return normalized.name === "anthropic" && normalized.type === "anthropic" && isBuiltinProvider(normalized);
}

export function providerCategory(provider = {}) {
  const type = stringValue(provider.type).toLowerCase();
  const name = providerKey(provider);
  if (stringValue(provider.origin).toLowerCase() === "custom") return "custom";
  if (type === "openai-compatible" || type === "anthropic-compatible" || provider.profile === "cliproxyapi") return "compatible";
  if (isBuiltinProvider(provider) || ["codex", "openai", "anthropic", "ollama"].includes(type) || name === "ollama") return "official";
  return "custom";
}

export function normalizeConsoleProvider(provider = {}) {
  const { apiKey: _apiKey, ...safeProvider } = provider || {};
  const type = stringValue(provider.type || provider.name || "openai-compatible");
  const name = stringValue(provider.name || type || "provider");
  const models = asArray(provider.models).map(stringValue).filter(Boolean);
  const defaultModel = stringValue(provider.defaultModel || provider.model);
  const apiKeyMetadata = safeApiKeyMetadata(provider);
  const configured = Boolean(provider.configured);
  const enabled = provider.enabled === undefined || provider.enabled === null
    ? configured
    : Boolean(provider.enabled);
  const suppliedOrigin = stringValue(provider.origin).toLowerCase();
  const origin = suppliedOrigin || (providerIdentityKeys({ ...provider, name, type }).some((key) => builtinProviderNames.has(key)) ? "builtin" : "unknown");
  return {
    ...safeProvider,
    ...apiKeyMetadata,
    name,
    type,
    profile: stringValue(provider.profile),
    baseUrl: stringValue(provider.baseUrl),
    defaultModel,
    model: defaultModel,
    models: models.length ? models : (defaultModel ? [defaultModel] : []),
    modelsSource: stringValue(provider.modelsSource),
    discovered: Boolean(provider.discovered),
    available: Boolean(provider.available),
    runtimeAvailable: provider.runtimeAvailable === undefined || provider.runtimeAvailable === null ? undefined : Boolean(provider.runtimeAvailable),
    registered: provider.registered === undefined || provider.registered === null ? undefined : Boolean(provider.registered),
    maxTokens: Number(provider.maxTokens) > 0 ? Number(provider.maxTokens) : 0,
    configured,
    enabled,
    origin,
    apiKeyOptional: Boolean(provider.apiKeyOptional),
    error: stringValue(provider.error),
    capabilities: provider.capabilities && typeof provider.capabilities === "object" ? provider.capabilities : {},
  };
}

// Settings is authoritative for lifecycle fields while the catalog is authoritative
// for the currently discovered model list. Keeping the settings-first seed retains
// disabled providers that the model catalog deliberately excludes.
export function modelProvidersForUIUnion(settingsProviders, catalogProviders) {
  const records = new Map();
  for (const setting of asArray(settingsProviders)) {
    const normalized = settingsRecord(setting);
    if (normalized.name) records.set(normalized.name, normalized);
  }
  for (const catalog of asArray(catalogProviders)) {
    const catalogName = stringValue(catalog?.name || catalog?.type);
    if (!catalogName) continue;
    const { apiKey: _apiKey, ...safeCatalog } = catalog || {};
    const setting = records.get(catalogName) || {};
    records.set(catalogName, {
      ...setting,
      ...safeCatalog,
      name: catalogName,
      type: firstDefined(catalog.type, setting.type, catalogName),
      profile: firstDefined(setting.profile, catalog.profile, ""),
      baseUrl: firstDefined(setting.baseUrl, catalog.baseUrl, ""),
      defaultModel: firstDefined(catalog.defaultModel, setting.defaultModel, setting.model, catalog.model, ""),
      model: firstDefined(setting.model, catalog.defaultModel, catalog.model, ""),
      models: asArray(catalog.models).length ? catalog.models : (asArray(setting.models).length ? setting.models : []),
      modelsSource: firstDefined(catalog.modelsSource, setting.modelsSource, ""),
      discovered: firstDefined(catalog.discovered, setting.discovered, false),
      available: firstDefined(catalog.available, setting.available, false),
      runtimeAvailable: firstDefined(catalog.runtimeAvailable, setting.runtimeAvailable),
      registered: firstDefined(catalog.registered, setting.registered),
      maxTokens: firstDefined(setting.maxTokens, catalog.maxTokens, 0),
      configured: firstDefined(catalog.configured, setting.configured, false),
      enabled: firstDefined(setting.enabled, catalog.enabled, setting.configured, catalog.configured, false),
      origin: firstDefined(setting.origin, catalog.origin, ""),
      apiKeyOptional: firstDefined(setting.apiKeyOptional, catalog.apiKeyOptional, false),
      apiKeyConfigured: firstDefined(catalog.apiKeyConfigured, setting.apiKeyConfigured, false),
      apiKeyPersisted: firstDefined(catalog.apiKeyPersisted, setting.apiKeyPersisted, false),
      apiKeyLastFive: firstDefined(catalog.apiKeyLastFive, setting.apiKeyLastFive, ""),
      apiKeySource: firstDefined(catalog.apiKeySource, setting.apiKeySource, "none"),
    });
  }
  return [...records.values()].map(normalizeConsoleProvider);
}

export function providerConsoleStats(providers) {
  const list = asArray(providers);
  return {
    total: list.length,
    enabled: list.filter((provider) => provider.enabled).length,
    models: list.reduce((total, provider) => total + provider.models.length, 0),
    attention: list.filter((provider) => provider.error || (provider.enabled && !provider.configured)).length,
  };
}

export function filterConsoleProviders(providers, { search = "", category = "all" } = {}) {
  const needle = stringValue(search).toLocaleLowerCase();
  return asArray(providers).filter((provider) => {
    if (category !== "all" && providerCategory(provider) !== category) return false;
    if (!needle) return true;
    return [provider.name, provider.type, provider.baseUrl, provider.defaultModel, provider.origin]
      .some((value) => stringValue(value).toLocaleLowerCase().includes(needle));
  });
}

export function providerDisplayName(provider = {}) {
  if (provider.type === "codex" || provider.name === "codex") return "Codex OAuth";
  if (provider.name === "anthropic" && provider.type === "anthropic") return "Anthropic";
  if (provider.name === "ollama") return "Ollama";
  return provider.name || provider.type || ct("labels.provider");
}

export function providerStatus(provider = {}) {
  if (provider.error) return { tone: "attention", label: ct("statusLabels.needsAttention") };
  if (!provider.enabled) return { tone: "muted", label: ct("statusLabels.disabled") };
  if (provider.configured) return { tone: "ready", label: ct("statusLabels.ready") };
  return { tone: "attention", label: ct("statusLabels.unconfigured") };
}

export function compactBaseUrl(value) {
  const raw = stringValue(value);
  if (!raw) return ct("labels.defaultEndpoint");
  try {
    const parsed = new URL(raw);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
  }
}

export function createProviderDraft(typeKey, provider = null) {
  const template = providerTypeTemplates.find((item) => item.key === typeKey)
    || providerTypeTemplates.find((item) => item.type === typeKey)
    || providerTypeTemplates[3];
  const source = provider ? normalizeConsoleProvider(provider) : null;
  const hasProviderName = Boolean(provider && Object.hasOwn(provider, "name"));
  const hasProviderBaseUrl = Boolean(provider && Object.hasOwn(provider, "baseUrl"));
  const localApiKey = provider?.apiKeyDraft === true ? stringValue(provider.apiKey) : "";
  return {
    name: hasProviderName ? stringValue(provider.name) : (source?.name || template.name),
    type: source?.type || template.type,
    profile: source?.profile || "",
    baseUrl: hasProviderBaseUrl ? stringValue(provider.baseUrl) : (source?.baseUrl || template.baseUrl || ""),
    // Saved provider responses never contribute a secret; only an explicitly marked
    // in-progress draft may retain its local key between redraws.
    apiKey: localApiKey,
    apiKeyDraft: provider?.apiKeyDraft === true,
    apiKeyConfigured: source?.apiKeyConfigured ?? false,
    apiKeyPersisted: source?.apiKeyPersisted ?? false,
    apiKeyLastFive: source?.apiKeyLastFive || "",
    apiKeySource: source?.apiKeySource || "none",
    clearApiKey: Boolean(provider?.clearApiKey),
    model: source?.defaultModel || template.model || "",
    models: source?.models || [],
    maxTokens: source?.maxTokens || template.maxTokens || 0,
    apiKeyOptional: source?.apiKeyOptional ?? Boolean(template.apiKeyOptional),
    enabled: source?.enabled ?? false,
    origin: source?.origin || (template.category === "official" ? "builtin" : "custom"),
  };
}

export function providerConfigPayload(draft = {}) {
  const maxTokens = Number(draft.maxTokens || 0);
  return {
    name: stringValue(draft.name),
    type: stringValue(draft.type || "openai-compatible"),
    profile: stringValue(draft.profile),
    baseUrl: stringValue(draft.baseUrl),
    // Empty keeps the existing key; clearApiKey is the only explicit removal path.
    apiKey: draft.clearApiKey ? "" : stringValue(draft.apiKey),
    ...(draft.clearApiKey ? { clearApiKey: true } : {}),
    model: stringValue(draft.model),
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 0,
    apiKeyOptional: Boolean(draft.apiKeyOptional),
  };
}

export function providerTestPayload(draft = {}, provider = {}) {
  // Only the draft fields accepted by preflight are sent. In particular, lifecycle,
  // catalog, origin, and error fields are never client-controlled. An explicit empty
  // API key preserves the existing-key semantics for an already saved provider.
  return providerConfigPayload({ ...provider, ...draft });
}

export function providerMessageTestPayload(draft = {}, provider = {}, prompt = "") {
  return {
    ...providerTestPayload(draft, provider),
    prompt: stringValue(prompt),
  };
}

export function providerConsoleRequest(action, provider, values = {}) {
  const name = stringValue(values.pathName || values.name || provider?.name);
  const path = `/api/providers/${encodeURIComponent(name)}`;
  switch (action) {
    case "toggle": {
      const model = stringValue(values.model || provider?.defaultModel || provider?.model);
      const body = { enabled: Boolean(values.enabled) };
      if (model) body.model = model;
      return {
        path,
        options: { method: "PATCH", body: JSON.stringify(body) },
      };
    }
    case "test":
      return {
        path: "/api/providers/test",
        options: { method: "POST", body: JSON.stringify(providerTestPayload(values, provider)) },
      };
    case "message-test":
      return {
        path: "/api/providers/test-message",
        options: { method: "POST", body: JSON.stringify(providerMessageTestPayload(values, provider, values.prompt)) },
      };
    case "delete":
      return { path, options: { method: "DELETE" } };
    case "config":
      return {
        path: `${path}/config`,
        options: { method: "PUT", body: JSON.stringify(providerConfigPayload(values)) },
      };
    default:
      throw new Error(`unsupported provider console action: ${action}`);
  }
}

function normalizedDiscoveredModels(models) {
  return [...new Set(asArray(models).map(stringValue).filter(Boolean))];
}

function renderModelChoiceSelect(models, selectedModel, id) {
  const choices = normalizedDiscoveredModels(models);
  if (!choices.length) return "";
  const selected = stringValue(selectedModel);
  return `<div class="mp-discovered-models" data-mp-discovered-models>
    <label class="settings-form-field" for="${escapeAttr(id)}"><span>${escapeHtml(ct("fields.model"))} · ${escapeHtml(ct("fields.modelCount", { count: choices.length }))}</span><select id="${escapeAttr(id)}" data-mp-model-choice aria-label="${escapeAttr(ct("fields.defaultModel"))}"><option value="">${escapeHtml(ct("fields.defaultModel"))}</option>${choices.map((model) => `<option value="${escapeAttr(model)}" ${model === selected ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}</select></label>
  </div>`;
}

function renderProviderMessageTestDialog(state = {}, draft = {}) {
  if (!state.testOpen) return "";
  const test = state.test && typeof state.test === "object" ? state.test : {};
  const busy = Boolean(state.busy?.[`message-test:${draft.name}`]);
  const result = test.result && typeof test.result === "object" ? test.result : null;
  const resultHTML = result
    ? `<div class="mp-provider-test-result settings-alert ${escapeAttr(result.tone || (result.success ? "success" : "attention"))}" role="status" aria-live="polite"><strong>${escapeHtml(result.success ? ct("test.successTitle") : ct("test.failureTitle"))}</strong>${result.output ? `<pre>${escapeHtml(result.output)}</pre>` : `<span>${escapeHtml(result.message || ct("messages.requestFailed"))}</span>`}</div>`
    : "";
  return `<div class="mp-provider-test-backdrop" data-mp-backdrop="test" role="presentation"><section class="mp-provider-test-dialog settings-card" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="mp-provider-test-title" aria-describedby="mp-provider-test-description" aria-busy="${busy ? "true" : "false"}">
    <header class="mp-provider-test-head settings-card-header"><div><p class="mp-provider-kicker">${escapeHtml(ct("test.kicker"))}</p><h2 id="mp-provider-test-title" class="settings-card-title">${escapeHtml(ct("test.title"))}</h2><p id="mp-provider-test-description" class="settings-card-description" data-settings-help-copy>${escapeHtml(ct("test.description", { provider: draft.name || ct("labels.provider"), model: draft.model || ct("labels.notSet") }))}</p></div><button class="mp-icon-button" type="button" data-mp-close-test aria-label="${escapeAttr(ct("actions.closeModal"))}">×</button></header>
    <form class="mp-provider-test-form settings-card-content" data-mp-provider-test-form>
      <label class="settings-form-field"><span>${escapeHtml(ct("test.promptLabel"))}</span><textarea name="prompt" data-mp-test-prompt rows="4" maxlength="8192" required placeholder="${escapeAttr(ct("test.promptPlaceholder"))}">${escapeHtml(test.prompt || ct("test.defaultPrompt"))}</textarea><small data-settings-help-copy>${escapeHtml(ct("test.promptHelp"))}</small></label>
      ${resultHTML}
      <footer class="mp-provider-test-foot settings-card-footer settings-inline-actions"><button class="mp-action" type="button" data-mp-close-test>${escapeHtml(ct("actions.cancel"))}</button><button class="mp-action primary" type="submit" data-mp-send-test ${busy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(busy ? ct("test.sending") : ct("test.send"))}</button></footer>
    </form>
  </section></div>`;
}

function renderModelChips(models) {
  const choices = normalizedDiscoveredModels(models);
  if (!choices.length) return "";
  const visible = choices.slice(0, 12);
  const remainder = choices.length - visible.length;
  return `<div class="mp-provider-models" aria-label="${escapeAttr(ct("fields.modelCount", { count: choices.length }))}">${visible.map((model) => `<span class="mp-model-chip" title="${escapeAttr(model)}">${escapeHtml(model)}</span>`).join("")}${remainder > 0 ? `<span class="mp-model-chip" title="${escapeAttr(ct("fields.modelCount", { count: choices.length }))}">+${remainder}</span>` : ""}</div>`;
}

export function renderProviderCreatePage(consoleState = {}) {
  const state = {
    mode: "create",
    type: "openai-compatible",
    draft: null,
    busy: {},
    result: null,
    ...consoleState,
  };
  const draft = createProviderDraft(state.type, state.draft || null);
  const editing = state.mode === "edit";
  const createDraftPlaceholder = !editing && !state.dirty;
  const nameEditable = !editing || isProviderDeletable(draft);
  const deleteName = editing ? stringValue(state.providerName || draft.name) : draft.name;
  const messageTestBusy = Boolean(state.busy?.[`message-test:${draft.name}`]);
  const modelBusy = Boolean(state.busy?.[`models:${draft.name}`]);
  const saveBusy = Boolean(state.busy?.[`save:${draft.name}`]);
  const deleteBusy = Boolean(state.busy?.[`delete:${draft.name}`]);
  const busy = messageTestBusy || modelBusy || saveBusy || deleteBusy;
  const discoveredModels = normalizedDiscoveredModels(draft.models);
  const modelList = discoveredModels.length
    ? `<datalist id="mp-provider-create-model-options">${discoveredModels.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}</datalist>`
    : "";
  const modelChoices = renderModelChoiceSelect(discoveredModels, draft.model, "mp-provider-create-model-choice");
  const modelReference = `${draft.name || "provider"}:${draft.model || "your-model"}`;
  const apiKeyHelp = editing && draft.apiKeyPersisted
    ? ct("fields.apiKeyPersisted", { lastFive: draft.apiKeyLastFive })
    : editing
      ? ct("fields.apiKeyBlankKeepsCurrent")
      : ct("createPage.apiKeyHelp");
  const apiKeyPlaceholder = editing ? ct("fields.apiKeyEditingPlaceholder") : ct("createPage.apiKeyPlaceholder");
  const result = state.result && typeof state.result === "object"
    ? `<div class="mp-provider-result settings-alert ${escapeAttr(state.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(state.result.message || "")}</div>`
    : "";
  return `<form class="mp-provider-page mp-provider-create-page mp-provider-create-form settings-page-section${editing ? " mp-provider-edit-page" : ""}" data-mp-provider-form aria-labelledby="mp-provider-create-title" aria-describedby="mp-provider-create-description" aria-busy="${busy ? "true" : "false"}">
    <header class="mp-provider-create-header">
      <p class="mp-provider-kicker">${escapeHtml(ct(editing ? "drawer.editProvider" : "createPage.kicker"))}</p>
      <div class="mp-provider-create-heading">
        <button class="mp-provider-create-back" type="button" data-mp-close-drawer><span aria-hidden="true">←</span><span>${escapeHtml(ct("createPage.back"))}</span></button>
        <div><h1 id="mp-provider-create-title">${escapeHtml(providerDisplayName(draft))}</h1><p id="mp-provider-create-description" data-settings-help-copy>${escapeHtml(ct(editing ? "drawer.configurationDescription" : "createPage.description"))}</p></div>
      </div>
    </header>
    <div class="mp-provider-create-body">
      <section class="mp-provider-create-section" aria-labelledby="mp-provider-create-connection-title">
        <div class="mp-provider-create-section-heading"><h2 id="mp-provider-create-connection-title">${escapeHtml(ct("createPage.connectionTitle"))}</h2><p data-settings-help-copy>${escapeHtml(ct("createPage.connectionDescription"))}</p></div>
        <div class="mp-provider-create-fields">
          <div class="mp-provider-create-field"><label for="mp-provider-create-name">${escapeHtml(ct("fields.name"))}</label><small data-settings-help-copy>${escapeHtml(ct("createPage.nameHelp", { example: modelReference }))}</small><input id="mp-provider-create-name" name="name" value="${escapeAttr(createDraftPlaceholder ? "" : draft.name)}" autocomplete="off" placeholder="${escapeAttr(createDraftPlaceholder ? draft.name : "")}" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" spellcheck="false" ${nameEditable ? "required" : "readonly"}></div>
          <div class="mp-provider-create-field"><label for="mp-provider-create-api-key">${escapeHtml(ct("fields.apiKey"))}</label><small data-settings-help-copy>${escapeHtml(apiKeyHelp)}</small><input id="mp-provider-create-api-key" name="apiKey" type="password" value="" autocomplete="new-password" placeholder="${escapeAttr(apiKeyPlaceholder)}" spellcheck="false">${editing && draft.apiKeyPersisted ? `<label class="mp-provider-create-clear-key"><input name="clearApiKey" type="checkbox" ${draft.clearApiKey ? "checked" : ""} data-mp-clear-api-key><span>${escapeHtml(ct("fields.clearApiKey"))}</span></label>` : ""}</div>
          <div class="mp-provider-create-field"><label for="mp-provider-create-base-url">${escapeHtml(ct("fields.baseUrl"))}</label><small data-settings-help-copy>${escapeHtml(ct("createPage.baseUrlHelp"))}</small><input id="mp-provider-create-base-url" name="baseUrl" type="url" value="${escapeAttr(createDraftPlaceholder ? "" : draft.baseUrl)}" autocomplete="url" placeholder="${escapeAttr(createDraftPlaceholder ? (draft.baseUrl || "https://api.example.com/v1") : "https://api.example.com/v1")}" spellcheck="false"></div>
        </div>
        <div class="mp-provider-create-inline-actions"><button class="mp-action" type="button" data-mp-test-provider ${messageTestBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(messageTestBusy ? ct("test.sending") : ct("actions.sendTest"))}</button></div>
      </section>
      <section class="mp-provider-create-section" aria-labelledby="mp-provider-create-protocol-title">
        <div class="mp-provider-create-section-heading"><h2 id="mp-provider-create-protocol-title">${escapeHtml(ct("fields.protocol"))}</h2><p data-settings-help-copy>${escapeHtml(ct("createPage.protocolHelp"))}</p></div>
        <fieldset class="mp-provider-create-protocol"><legend class="mp-visually-hidden">${escapeHtml(ct("fields.protocol"))}</legend>${renderCreateProtocolChoices(draft.type)}</fieldset>
        <label class="mp-provider-create-switch"><span><strong>${escapeHtml(ct("fields.apiKeyOptional"))}</strong><small data-settings-help-copy>${escapeHtml(ct("createPage.apiKeyOptionalHelp"))}</small></span><input name="apiKeyOptional" type="checkbox" ${draft.apiKeyOptional ? "checked" : ""}></label>
      </section>
      <section class="mp-provider-create-section" aria-labelledby="mp-provider-create-model-title">
        <div class="mp-provider-create-section-heading"><h2 id="mp-provider-create-model-title">${escapeHtml(ct("createPage.modelTitle"))}</h2><p data-settings-help-copy>${escapeHtml(ct("createPage.modelDescription"))}</p></div>
        <div class="mp-provider-create-fields">
          <div class="mp-provider-create-field"><label for="mp-provider-create-model">${escapeHtml(ct("fields.defaultModel"))}</label><small data-settings-help-copy>${escapeHtml(ct("createPage.defaultModelHelp"))}</small><div class="mp-provider-create-input-action"><input id="mp-provider-create-model" name="model" data-select-on-focus="true" value="${escapeAttr(draft.model)}" autocomplete="off" placeholder="${escapeAttr(ct("fields.defaultModelPlaceholder"))}" spellcheck="false" required ${discoveredModels.length ? "list=\"mp-provider-create-model-options\"" : ""}>${modelList}<button class="mp-action" type="button" data-mp-fetch-models ${modelBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(modelBusy ? ct("actions.fetchingModels") : ct("actions.fetchModels"))}</button></div>${modelChoices}</div>
          <div class="mp-provider-create-field"><label for="mp-provider-create-max-tokens">${escapeHtml(ct("fields.maxTokens"))}</label><small data-settings-help-copy>${escapeHtml(ct("createPage.maxTokensHelp"))}</small><input id="mp-provider-create-max-tokens" name="maxTokens" data-select-on-focus="true" type="number" min="0" step="1" value="${escapeAttr(draft.maxTokens || "")}"></div>
          <div class="mp-provider-create-field"><label for="mp-provider-create-reference">${escapeHtml(ct("createPage.modelReference"))}</label><small data-settings-help-copy>${escapeHtml(ct("createPage.modelReferenceHelp"))}</small><input id="mp-provider-create-reference" value="${escapeAttr(modelReference)}" readonly data-mp-model-example></div>
        </div>
      </section>
      ${result}
    </div>
    <footer class="mp-provider-create-footer"><span>${escapeHtml(ct("createPage.footerHint"))}</span><div class="mp-provider-create-footer-actions settings-inline-actions">${isProviderDeletable(draft) && editing ? `<button class="mp-action danger" type="button" data-mp-delete-provider="${escapeAttr(deleteName)}" ${deleteBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(ct("actions.delete"))}</button>` : ""}<button class="mp-action" type="button" data-mp-close-drawer>${escapeHtml(ct("actions.discardChanges"))}</button><button class="mp-action primary" type="submit" data-mp-save-provider ${saveBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(saveBusy ? ct("actions.saving") : ct("actions.saveAndEnable"))}</button></div></footer>
  </form>${renderProviderMessageTestDialog(state, draft)}`;
}

function renderCreateProtocolChoices(selected) {
  const types = [
    ["openai", "typeLabels.openai"],
    ["anthropic", "typeLabels.anthropic"],
    ["openai-compatible", "typeLabels.openaiCompatible"],
  ];
  return `<div class="mp-provider-create-protocol-options">${types.map(([value, labelKey]) => `<label><input type="radio" name="type" value="${escapeAttr(value)}" ${value === selected ? "checked" : ""}><span>${escapeHtml(ct(labelKey))}</span></label>`).join("")}</div>`;
}

export function renderProviderConsolePage({ providers = [], consoleState = {}, relayDrawer = "" } = {}) {
  const state = {
    search: "",
    category: "all",
    modal: "",
    drawer: "",
    mode: "",
    type: "",
    draft: null,
    busy: {},
    result: null,
    ...consoleState,
  };
  if (state.drawer === "provider" && (state.mode === "create" || state.mode === "edit")) return renderProviderCreatePage(state);
  const stats = providerConsoleStats(providers);
  const filtered = filterConsoleProviders(providers, state);
  const categories = ["official", "custom", "compatible"];
  const sectionHTML = categories
    .filter((category) => state.category === "all" || state.category === category)
    .map((category) => {
      const cards = filtered.filter((provider) => providerCategory(provider) === category);
      const relayCard = category === "compatible" && !state.search ? renderRelayEntryCard() : "";
      if (!cards.length && !relayCard) return "";
      const panelId = `mp-provider-panel-${category}`;
      const headingId = `mp-provider-section-title-${category}`;
      return `<section class="mp-provider-section settings-card" id="${panelId}" data-mp-category-section="${escapeAttr(category)}" aria-labelledby="${headingId}">
        <header class="mp-provider-section-head settings-card-header"><h2 id="${headingId}">${escapeHtml(ct(categoryMeta[category].titleKey))}</h2><span class="settings-badge">${escapeHtml(String(cards.length + (relayCard ? 1 : 0)))}</span></header>
        <div class="mp-provider-grid settings-card-content">${cards.map((provider) => renderProviderCard(provider, state)).join("")}${relayCard}</div>
      </section>`;
    }).join("");
  const result = state.result && typeof state.result === "object"
    ? `<div class="mp-provider-result settings-alert ${escapeAttr(state.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(state.result.message || "")}</div>`
    : "";
  return `<div class="mp-provider-page settings-page-section" aria-labelledby="mp-provider-page-title">
    <header class="mp-provider-head settings-card settings-card-header">
      <div><p class="mp-provider-kicker">${escapeHtml(ct("kicker"))}</p><h1 id="mp-provider-page-title" class="settings-card-title">${escapeHtml(ct("title"))}</h1><p class="settings-card-description" data-settings-help-copy>${escapeHtml(ct("description"))}</p></div>
      <div class="mp-provider-head-actions settings-inline-actions"><button class="mp-action" type="button" data-mp-refresh-models>${escapeHtml(ct("actions.refreshModels"))}</button><button class="mp-action primary" type="button" data-mp-open-types>+ ${escapeHtml(ct("addProvider"))}</button></div>
    </header>
    <div class="mp-stat-grid settings-stat-grid" aria-label="${escapeAttr(ct("statistics"))}">
      ${renderStat(ct("stats.total"), stats.total)}${renderStat(ct("stats.enabled"), stats.enabled)}${renderStat(ct("stats.models"), stats.models)}${renderStat(ct("stats.attention"), stats.attention)}
    </div>
    <section class="mp-provider-toolbar settings-card settings-toolbar" aria-label="${escapeAttr(ct("category"))}">
      <label class="mp-provider-search settings-form-field"><span class="mp-visually-hidden">${escapeHtml(ct("searchProviders"))}</span><input type="search" value="${escapeAttr(state.search)}" placeholder="${escapeAttr(ct("searchPlaceholder"))}" data-mp-provider-search></label>
      <div class="mp-category-tabs" role="group" aria-label="${escapeAttr(ct("category"))}">
        ${Object.entries(categoryMeta).map(([key, item]) => `<button class="mp-category-tab ${state.category === key ? "active" : ""}" type="button" aria-pressed="${state.category === key ? "true" : "false"}" data-mp-category="${escapeAttr(key)}">${escapeHtml(ct(item.labelKey))}</button>`).join("")}
      </div>
    </section>
    ${result}
    <div class="mp-provider-sections">${sectionHTML || `<div class="mp-empty settings-card settings-alert" role="status">${escapeHtml(ct("messages.noResults"))}</div>`}</div>
    ${state.drawer ? renderProviderDrawer(state, relayDrawer) : ""}
  </div>`;
}

function renderStat(label, value) {
  return `<div class="mp-stat settings-stat-card"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderProviderCard(provider, state = {}) {
  const status = providerStatus(provider);
  const models = provider.models.length;
  const baseURL = compactBaseUrl(provider.baseUrl);
  const disabled = !provider.enabled;
  const deletable = isProviderDeletable(provider);
  const toggleBusy = Boolean(state.busy?.[`toggle:${provider.name}`]);
  const deleteBusy = Boolean(state.busy?.[`delete:${provider.name}`]);
  const busy = toggleBusy || deleteBusy;
  const displayName = providerDisplayName(provider);
  const toggleLabel = ct(provider.enabled ? "actions.disableProvider" : "actions.enableProvider");
  const originLabel = provider.origin === "custom"
    ? ct("origins.custom")
    : provider.origin === "builtin"
      ? ct("origins.builtin")
      : ct("origins.unknown");
  return `<article class="mp-provider-card settings-card${disabled ? " is-disabled" : ""}${deletable ? " is-custom" : ""}" data-mp-provider-card="${escapeAttr(provider.name)}" data-disabled="${disabled ? "true" : "false"}" data-origin="${escapeAttr(provider.origin || "unknown")}" aria-busy="${busy ? "true" : "false"}">
    <header class="mp-provider-card-head settings-card-header"><div class="mp-provider-card-identity"><div><h3 class="settings-card-title">${escapeHtml(displayName)}</h3><span class="mp-provider-badge settings-badge">${escapeHtml(provider.type)}</span></div></div><div class="mp-provider-card-controls"><button class="mp-provider-switch ${provider.enabled ? "is-on" : "is-off"}" type="button" role="switch" aria-checked="${provider.enabled ? "true" : "false"}" aria-label="${escapeAttr(`${toggleLabel}: ${displayName}`)}" title="${escapeAttr(toggleLabel)}" data-mp-provider-toggle="${escapeAttr(provider.name)}" ${busy ? "disabled" : ""}><span class="mp-provider-switch-thumb" aria-hidden="true"></span></button></div></header>
    <div class="settings-card-content"><div class="mp-provider-card-meta"><span class="mp-status settings-badge ${escapeAttr(status.tone)}">${escapeHtml(status.label)}</span><span>${escapeHtml(originLabel)}</span></div>
    <dl class="mp-provider-facts"><div><dt>${escapeHtml(ct("fields.defaultModel"))}</dt><dd>${escapeHtml(provider.defaultModel || ct("labels.notSet"))}</dd></div><div><dt>${escapeHtml(ct("fields.modelCount"))}</dt><dd>${escapeHtml(String(models))}</dd></div><div><dt>${escapeHtml(ct("fields.baseUrl"))}</dt><dd title="${escapeAttr(provider.baseUrl || "")}">${escapeHtml(baseURL)}</dd></div></dl>
    ${renderModelChips(provider.models)}
    ${provider.error ? `<p class="mp-provider-error settings-alert" role="alert">${escapeHtml(provider.error)}</p>` : ""}</div>
    <footer class="mp-provider-card-actions"><button class="mp-provider-card-open" type="button" data-mp-provider-open="${escapeAttr(provider.name)}" aria-label="${escapeAttr(ct("aria.configureProvider", { provider: displayName }))}">${escapeHtml(ct("drawer.editProvider"))}</button>${deletable ? `<button class="mp-provider-delete" type="button" data-mp-delete-provider="${escapeAttr(provider.name)}" aria-label="${escapeAttr(`${ct("actions.delete")}: ${displayName}`)}" title="${escapeAttr(ct("actions.delete"))}" ${busy ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg><span>${escapeHtml(ct("actions.delete"))}</span></button>` : ""}</footer>
  </article>`;
}

function renderRelayEntryCard() {
  return `<article class="mp-provider-card mp-relay-card settings-card" data-mp-open-relay role="button" tabindex="0" aria-label="${escapeAttr(ct("aria.openRelay"))}">
    <header class="mp-provider-card-head settings-card-header"><div><h3 class="settings-card-title">${escapeHtml(ct("relay.title"))}</h3><span class="mp-provider-badge settings-badge">${escapeHtml(ct("compatibleAdvanced"))}</span></div></header>
    <div class="settings-card-content"><div class="mp-provider-card-meta"><span class="mp-status settings-badge muted">${escapeHtml(ct("relay.optional"))}</span><span>${escapeHtml(ct("relay.legacyEntry"))}</span></div>
    <dl class="mp-provider-facts"><div><dt>${escapeHtml(ct("relay.purpose"))}</dt><dd>${escapeHtml(ct("relay.purposeValue"))}</dd></div><div><dt>${escapeHtml(ct("fields.model"))}</dt><dd>${escapeHtml(ct("relay.modelsRefreshable"))}</dd></div><div><dt>${escapeHtml(ct("fields.baseUrl"))}</dt><dd>${escapeHtml(ct("relay.savedByProtocol"))}</dd></div></dl></div>
  </article>`;
}

function renderProviderTypeModal() {
  return `<div class="mp-provider-type-modal" data-mp-backdrop="modal" role="presentation"><section class="mp-modal-panel settings-card" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="mp-provider-type-title" aria-describedby="mp-provider-type-description">
    <header class="mp-modal-head settings-card-header"><div><p class="mp-provider-kicker">${escapeHtml(ct("addProvider"))}</p><h2 id="mp-provider-type-title" class="settings-card-title">${escapeHtml(ct("typeModalTitle"))}</h2><p id="mp-provider-type-description" class="settings-card-description" data-settings-help-copy>${escapeHtml(ct("typeSelectDescription"))}</p></div></header>
    <div class="mp-provider-type-grid settings-card-content">${providerTypeTemplates.map((template) => `<button class="mp-provider-type-option" type="button" data-mp-select-type="${escapeAttr(template.key)}"><strong>${escapeHtml(ct(`templates.${template.templateKey}.title`))}</strong><span data-settings-help-copy>${escapeHtml(ct(`templates.${template.templateKey}.description`))}</span></button>`).join("")}</div>
    <footer class="mp-modal-foot settings-card-footer"><button class="mp-icon-button" type="button" data-mp-close-modal aria-label="${escapeAttr(ct("actions.closeModal"))}">×</button></footer>
  </section></div>`;
}

function renderProviderDrawer(state, relayDrawer) {
  let content = "";
  if (state.mode === "relay") content = relayDrawer;
  else if (state.mode === "create" || state.mode === "edit") content = renderProviderCreatePage(state);
  else content = renderConfigDrawerForm(state);
  const busy = Object.values(state.busy || {}).some(Boolean);
  return `<div class="mp-provider-drawer-backdrop" data-mp-backdrop="drawer" role="presentation"><aside class="mp-provider-drawer settings-card" role="dialog" aria-modal="true" tabindex="-1" aria-busy="${busy ? "true" : "false"}" aria-labelledby="mp-drawer-title" aria-describedby="mp-drawer-description">${content}</aside></div>`;
}

function renderConfigDrawerForm(state) {
  const draft = createProviderDraft(state.type, state.draft || null);
  const editing = state.mode === "edit";
  const createDraftPlaceholder = !editing && !state.dirty;
  const nameEditable = !editing || isProviderDeletable(draft);
  const deleteName = editing ? stringValue(state.providerName || draft.name) : draft.name;
  const messageTestBusy = Boolean(state.busy?.[`message-test:${draft.name}`]);
  const modelBusy = Boolean(state.busy?.[`models:${draft.name}`]);
  const saveBusy = Boolean(state.busy?.[`save:${draft.name}`]);
  const deleteBusy = Boolean(state.busy?.[`delete:${draft.name}`]);
  const discoveredModels = normalizedDiscoveredModels(draft.models);
  const modelList = discoveredModels.length
    ? `<datalist id="mp-provider-model-options">${discoveredModels.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}</datalist>`
    : "";
  const modelChoices = renderModelChoiceSelect(discoveredModels, draft.model, "mp-provider-model-choice");
  return `<form data-mp-provider-form>
    <header class="mp-drawer-head settings-card-header"><div><p class="mp-provider-kicker">${escapeHtml(editing ? ct("drawer.editProvider") : ct("drawer.createProvider"))}</p><h2 id="mp-drawer-title" class="settings-card-title">${escapeHtml(providerDisplayName(draft))}</h2><p id="mp-drawer-description" class="settings-card-description" data-settings-help-copy>${escapeHtml(ct("drawer.configurationDescription"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-drawer aria-label="${escapeAttr(ct("actions.closeDrawer"))}">×</button></header>
    <div class="mp-drawer-body settings-card-content">
      <section class="mp-config-section settings-page-section"><h3>${escapeHtml(ct("steps.basic"))}</h3>
        <label class="settings-form-field">${escapeHtml(ct("fields.name"))}<input name="name" value="${escapeAttr(createDraftPlaceholder ? "" : draft.name)}" autocomplete="off" placeholder="${escapeAttr(createDraftPlaceholder ? draft.name : "")}" ${nameEditable ? "required" : "readonly"}></label>
        <label class="settings-form-field">${escapeHtml(ct("fields.protocol"))}<select name="type">${renderTypeOptions(draft.type)}</select></label>
        <label class="settings-form-field">${escapeHtml(ct("fields.finalModelExample", { provider: draft.name || "provider", model: draft.model || "your-model" }))}<input value="${escapeAttr(`${draft.name || "provider"}:${draft.model || "your-model"}`)}" readonly data-mp-model-example></label>
        <label class="settings-form-field">${escapeHtml(ct("fields.apiKey"))}<input name="apiKey" type="password" value="" autocomplete="off" placeholder="${escapeAttr(ct(editing ? "fields.apiKeyEditingPlaceholder" : "createPage.apiKeyPlaceholder"))}"></label><small data-settings-help-copy>${escapeHtml(editing && draft.apiKeyPersisted ? ct("fields.apiKeyPersisted", { lastFive: draft.apiKeyLastFive }) : ct("fields.apiKeyBlankKeepsCurrent"))}</small>
        ${editing && draft.apiKeyPersisted ? `<label class="mp-check settings-form-field"><input name="clearApiKey" type="checkbox" ${draft.clearApiKey ? "checked" : ""} data-mp-clear-api-key> ${escapeHtml(ct("fields.clearApiKey"))}</label>` : ""}
        <label class="settings-form-field">${escapeHtml(ct("fields.baseUrl"))}<input name="baseUrl" type="url" value="${escapeAttr(createDraftPlaceholder ? "" : draft.baseUrl)}" autocomplete="url" placeholder="${escapeAttr(createDraftPlaceholder ? (draft.baseUrl || "https://api.example.com/v1") : "https://api.example.com/v1")}"></label>
        <label class="settings-form-field">${escapeHtml(ct("fields.defaultModel"))}<input name="model" data-select-on-focus="true" value="${escapeAttr(draft.model)}" autocomplete="off" placeholder="${escapeAttr(ct("fields.defaultModelPlaceholder"))}" ${discoveredModels.length ? "list=\"mp-provider-model-options\"" : ""}>${modelList}</label>${modelChoices}
      </section>
      <details class="mp-config-section settings-page-section"><summary>${escapeHtml(ct("steps.advanced"))}</summary>
        <label class="settings-form-field">${escapeHtml(ct("fields.maxTokens"))}<input name="maxTokens" data-select-on-focus="true" type="number" min="0" step="1" value="${escapeAttr(draft.maxTokens || "")}"></label>
        <label class="mp-check settings-form-field"><input name="apiKeyOptional" type="checkbox" ${draft.apiKeyOptional ? "checked" : ""}> ${escapeHtml(ct("fields.apiKeyOptional"))}</label>
      </details>
      ${state.result && typeof state.result === "object" ? `<div class="mp-provider-result settings-alert ${escapeAttr(state.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(state.result.message || "")}</div>` : ""}
    </div>
    <footer class="mp-drawer-foot settings-card-footer settings-inline-actions"><div class="settings-inline-actions"><button class="mp-action" type="button" data-mp-fetch-models ${modelBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(modelBusy ? ct("actions.fetchingModels") : ct("actions.fetchModels"))}</button><button class="mp-action" type="button" data-mp-test-provider ${messageTestBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(messageTestBusy ? ct("test.sending") : ct("actions.sendTest"))}</button></div><div class="settings-inline-actions">${isProviderDeletable(draft) && editing ? `<button class="mp-action danger" type="button" data-mp-delete-provider="${escapeAttr(deleteName)}" ${deleteBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(ct("actions.delete"))}</button>` : ""}<button class="mp-action primary" type="submit" data-mp-save-provider ${saveBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(saveBusy ? ct("actions.saving") : ct("actions.saveAndEnable"))}</button></div></footer>
  </form>`;
}

function renderTypeOptions(selected) {
  const types = [
    ["openai", "typeLabels.openai"],
    ["anthropic", "typeLabels.anthropic"],
    ["openai-compatible", "typeLabels.openaiCompatible"],
  ];
  return types.map(([value, labelKey]) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(ct(labelKey))}</option>`).join("");
}
