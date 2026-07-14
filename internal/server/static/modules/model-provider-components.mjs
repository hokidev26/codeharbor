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

function settingsRecord(provider = {}) {
  return {
    ...provider,
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

export function providerCategory(provider = {}) {
  const type = stringValue(provider.type).toLowerCase();
  const name = providerKey(provider);
  if (type === "openai-compatible" || type === "anthropic-compatible" || provider.profile === "cliproxyapi") return "compatible";
  if (stringValue(provider.origin).toLowerCase() === "custom") return "custom";
  if (isBuiltinProvider(provider) || ["codex", "openai", "anthropic", "ollama"].includes(type) || name === "ollama") return "official";
  return "custom";
}

export function normalizeConsoleProvider(provider = {}) {
  const type = stringValue(provider.type || provider.name || "openai-compatible");
  const name = stringValue(provider.name || type || "provider");
  const models = asArray(provider.models).map(stringValue).filter(Boolean);
  const defaultModel = stringValue(provider.defaultModel || provider.model);
  const configured = Boolean(provider.configured);
  const enabled = provider.enabled === undefined || provider.enabled === null
    ? configured
    : Boolean(provider.enabled);
  const suppliedOrigin = stringValue(provider.origin).toLowerCase();
  const origin = suppliedOrigin || (providerIdentityKeys({ ...provider, name, type }).some((key) => builtinProviderNames.has(key)) ? "builtin" : "unknown");
  return {
    ...provider,
    name,
    type,
    profile: stringValue(provider.profile),
    baseUrl: stringValue(provider.baseUrl),
    defaultModel,
    model: defaultModel,
    models: models.length ? models : (defaultModel ? [defaultModel] : []),
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
    const setting = records.get(catalogName) || {};
    records.set(catalogName, {
      ...setting,
      ...catalog,
      name: catalogName,
      type: firstDefined(catalog.type, setting.type, catalogName),
      profile: firstDefined(setting.profile, catalog.profile, ""),
      baseUrl: firstDefined(setting.baseUrl, catalog.baseUrl, ""),
      defaultModel: firstDefined(catalog.defaultModel, setting.defaultModel, setting.model, catalog.model, ""),
      model: firstDefined(setting.model, catalog.defaultModel, catalog.model, ""),
      models: asArray(catalog.models).length ? catalog.models : (asArray(setting.models).length ? setting.models : []),
      maxTokens: firstDefined(setting.maxTokens, catalog.maxTokens, 0),
      configured: firstDefined(catalog.configured, setting.configured, false),
      enabled: firstDefined(setting.enabled, catalog.enabled, setting.configured, catalog.configured, false),
      origin: firstDefined(setting.origin, catalog.origin, ""),
      apiKeyOptional: firstDefined(setting.apiKeyOptional, catalog.apiKeyOptional, false),
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
  return {
    name: source?.name || template.name,
    type: source?.type || template.type,
    profile: source?.profile || "",
    baseUrl: source?.baseUrl || template.baseUrl || "",
    apiKey: "",
    model: source?.defaultModel || template.model || "",
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
    // The empty value is intentional: PUT keeps the existing runtime API key.
    apiKey: stringValue(draft.apiKey),
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

export function providerConsoleRequest(action, provider, values = {}) {
  const name = stringValue(values.name || provider?.name);
  const path = `/api/providers/${encodeURIComponent(name)}`;
  switch (action) {
    case "toggle":
      return {
        path,
        options: {
          method: "PATCH",
          body: JSON.stringify({
            enabled: Boolean(values.enabled),
            model: stringValue(values.model || provider?.defaultModel || provider?.model),
          }),
        },
      };
    case "test":
      return {
        path: "/api/providers/test",
        options: { method: "POST", body: JSON.stringify(providerTestPayload(values, provider)) },
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

export function renderProviderConsolePage({ providers = [], consoleState = {}, codexDrawer = "", relayDrawer = "" } = {}) {
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
  const stats = providerConsoleStats(providers);
  const filtered = filterConsoleProviders(providers, state);
  const categories = ["official", "custom", "compatible"];
  const sectionHTML = categories
    .filter((category) => state.category === "all" || state.category === category)
    .map((category) => {
      const cards = filtered.filter((provider) => providerCategory(provider) === category);
      const relayCard = category === "compatible" && !state.search ? renderRelayEntryCard() : "";
      if (!cards.length && !relayCard) return "";
      return `<section class="mp-provider-section" data-mp-category-section="${escapeAttr(category)}">
        <div class="mp-provider-section-head"><h2>${escapeHtml(ct(categoryMeta[category].titleKey))}</h2><span>${escapeHtml(String(cards.length + (relayCard ? 1 : 0)))}</span></div>
        <div class="mp-provider-grid">${cards.map((provider) => renderProviderCard(provider, state)).join("")}${relayCard}</div>
      </section>`;
    }).join("");
  const result = state.result && typeof state.result === "object"
    ? `<div class="mp-provider-result ${escapeAttr(state.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(state.result.message || "")}</div>`
    : "";
  return `<div class="mp-provider-page">
    <header class="mp-provider-head">
      <div><p class="mp-provider-kicker">${escapeHtml(ct("kicker"))}</p><h1>${escapeHtml(ct("title"))}</h1><p>${escapeHtml(ct("description"))}</p></div>
      <div class="mp-provider-head-actions"><button class="mp-action" type="button" data-mp-refresh-models>${escapeHtml(ct("actions.refreshModels"))}</button><button class="mp-action primary" type="button" data-mp-open-types>+ ${escapeHtml(ct("addProvider"))}</button></div>
    </header>
    <div class="mp-stat-grid" aria-label="${escapeAttr(ct("statistics"))}">
      ${renderStat(ct("stats.total"), stats.total)}${renderStat(ct("stats.enabled"), stats.enabled)}${renderStat(ct("stats.models"), stats.models)}${renderStat(ct("stats.attention"), stats.attention)}
    </div>
    <div class="mp-provider-toolbar">
      <label class="mp-provider-search"><span class="mp-visually-hidden">${escapeHtml(ct("searchProviders"))}</span><input type="search" value="${escapeAttr(state.search)}" placeholder="${escapeAttr(ct("searchPlaceholder"))}" data-mp-provider-search></label>
      <div class="mp-category-tabs" role="tablist" aria-label="${escapeAttr(ct("category"))}">
        ${Object.entries(categoryMeta).map(([key, item]) => `<button class="mp-category-tab ${state.category === key ? "active" : ""}" type="button" role="tab" aria-selected="${state.category === key ? "true" : "false"}" data-mp-category="${escapeAttr(key)}">${escapeHtml(ct(item.labelKey))}</button>`).join("")}
      </div>
    </div>
    ${result}
    <div class="mp-provider-sections">${sectionHTML || `<div class="mp-empty">${escapeHtml(ct("messages.noResults"))}</div>`}</div>
    ${state.modal === "types" ? renderProviderTypeModal() : ""}
    ${state.drawer ? renderProviderDrawer(state, codexDrawer, relayDrawer) : ""}
  </div>`;
}

function renderStat(label, value) {
  return `<div class="mp-stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderProviderCard(provider, state) {
  const status = providerStatus(provider);
  const models = provider.models.length;
  const baseURL = compactBaseUrl(provider.baseUrl);
  const toggleBusy = Boolean(state.busy?.[`toggle:${provider.name}`]);
  const nextToggleLabel = ct(provider.enabled ? "actions.disableProvider" : "actions.enableProvider");
  const originLabel = provider.origin === "custom"
    ? ct("origins.custom")
    : provider.origin === "builtin"
      ? ct("origins.builtin")
      : ct("origins.unknown");
  return `<article class="mp-provider-card" data-mp-provider-card="${escapeAttr(provider.name)}" role="button" tabindex="0" aria-label="${escapeAttr(ct("aria.configureProvider", { provider: providerDisplayName(provider) }))}">
    <div class="mp-provider-card-head"><div><h3>${escapeHtml(providerDisplayName(provider))}</h3><span class="mp-provider-badge">${escapeHtml(provider.type)}</span></div><button class="mp-provider-switch" type="button" role="switch" aria-checked="${provider.enabled ? "true" : "false"}" aria-label="${escapeAttr(nextToggleLabel)}" data-mp-provider-toggle="${escapeAttr(provider.name)}" title="${escapeAttr(nextToggleLabel)}" ${toggleBusy ? "disabled aria-busy=\"true\"" : ""}><span aria-hidden="true"></span></button></div>
    <div class="mp-provider-card-meta"><span class="mp-status ${escapeAttr(status.tone)}">${escapeHtml(status.label)}</span><span>${escapeHtml(originLabel)}</span></div>
    <dl class="mp-provider-facts"><div><dt>${escapeHtml(ct("fields.defaultModel"))}</dt><dd>${escapeHtml(provider.defaultModel || ct("labels.notSet"))}</dd></div><div><dt>${escapeHtml(ct("fields.modelCount"))}</dt><dd>${escapeHtml(String(models))}</dd></div><div><dt>${escapeHtml(ct("fields.baseUrl"))}</dt><dd title="${escapeAttr(provider.baseUrl || "")}">${escapeHtml(baseURL)}</dd></div></dl>
    ${provider.error ? `<p class="mp-provider-error">${escapeHtml(provider.error)}</p>` : ""}
  </article>`;
}

function renderRelayEntryCard() {
  return `<article class="mp-provider-card mp-relay-card" data-mp-open-relay role="button" tabindex="0" aria-label="${escapeAttr(ct("aria.openRelay"))}">
    <div class="mp-provider-card-head"><div><h3>${escapeHtml(ct("relay.title"))}</h3><span class="mp-provider-badge">${escapeHtml(ct("compatibleAdvanced"))}</span></div></div>
    <div class="mp-provider-card-meta"><span class="mp-status muted">${escapeHtml(ct("relay.optional"))}</span><span>${escapeHtml(ct("relay.legacyEntry"))}</span></div>
    <dl class="mp-provider-facts"><div><dt>${escapeHtml(ct("relay.purpose"))}</dt><dd>${escapeHtml(ct("relay.purposeValue"))}</dd></div><div><dt>${escapeHtml(ct("fields.model"))}</dt><dd>${escapeHtml(ct("relay.modelsRefreshable"))}</dd></div><div><dt>${escapeHtml(ct("fields.baseUrl"))}</dt><dd>${escapeHtml(ct("relay.savedByProtocol"))}</dd></div></dl>
  </article>`;
}

function renderProviderTypeModal() {
  return `<div class="mp-provider-type-modal" data-mp-backdrop="modal" role="presentation"><section class="mp-modal-panel" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="mp-provider-type-title" aria-describedby="mp-provider-type-description">
    <header class="mp-modal-head"><div><p class="mp-provider-kicker">${escapeHtml(ct("addProvider"))}</p><h2 id="mp-provider-type-title">${escapeHtml(ct("typeModalTitle"))}</h2><p id="mp-provider-type-description">${escapeHtml(ct("typeSelectDescription"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-modal aria-label="${escapeAttr(ct("actions.closeModal"))}">×</button></header>
    <div class="mp-provider-type-grid">${providerTypeTemplates.map((template) => `<button class="mp-provider-type-option" type="button" data-mp-select-type="${escapeAttr(template.key)}"><strong>${escapeHtml(ct(`templates.${template.templateKey}.title`))}</strong><span>${escapeHtml(ct(`templates.${template.templateKey}.description`))}</span></button>`).join("")}</div>
  </section></div>`;
}

function renderProviderDrawer(state, codexDrawer, relayDrawer) {
  let content = "";
  if (state.mode === "codex") content = codexDrawer;
  else if (state.mode === "relay") content = relayDrawer;
  else content = renderConfigDrawerForm(state);
  return `<div class="mp-provider-drawer-backdrop" data-mp-backdrop="drawer" role="presentation"><aside class="mp-provider-drawer" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="mp-drawer-title" aria-describedby="mp-drawer-description">${content}</aside></div>`;
}

function renderConfigDrawerForm(state) {
  const draft = createProviderDraft(state.type, state.draft || null);
  const editing = state.mode === "edit";
  const testBusy = Boolean(state.busy?.[`test:${draft.name}`]);
  const saveBusy = Boolean(state.busy?.[`save:${draft.name}`]);
  const deleteBusy = Boolean(state.busy?.[`delete:${draft.name}`]);
  return `<form data-mp-provider-form>
    <header class="mp-drawer-head"><div><p class="mp-provider-kicker">${escapeHtml(editing ? ct("drawer.editProvider") : ct("drawer.createProvider"))}</p><h2 id="mp-drawer-title">${escapeHtml(providerDisplayName(draft))}</h2><p id="mp-drawer-description">${escapeHtml(ct("drawer.configurationDescription"))}</p></div><button class="mp-icon-button" type="button" data-mp-close-drawer aria-label="${escapeAttr(ct("actions.closeDrawer"))}">×</button></header>
    <div class="mp-drawer-body">
      <section class="mp-config-section"><h3>${escapeHtml(ct("steps.basic"))}</h3>
        <label>${escapeHtml(ct("fields.name"))}<input name="name" value="${escapeAttr(draft.name)}" autocomplete="off" ${editing ? "readonly" : ""}></label>
        <label>${escapeHtml(ct("fields.protocol"))}<select name="type">${renderTypeOptions(draft.type)}</select></label>
        <label>${escapeHtml(ct("fields.finalModelExample", { provider: draft.name || "provider", model: draft.model || "your-model" }))}<input value="${escapeAttr(`${draft.name || "provider"}:${draft.model || "your-model"}`)}" readonly data-mp-model-example></label>
        <label>${escapeHtml(ct("fields.apiKey"))}<input name="apiKey" type="password" value="${escapeAttr(draft.apiKey || "")}" autocomplete="off" placeholder="${escapeAttr(ct("fields.apiKeyEditingPlaceholder"))}"></label><small>${escapeHtml(ct("fields.apiKeyBlankKeepsCurrent"))}</small>
        <label>${escapeHtml(ct("fields.baseUrl"))}<input name="baseUrl" value="${escapeAttr(draft.baseUrl)}" autocomplete="url" placeholder="https://api.example.com/v1"></label>
        <label>${escapeHtml(ct("fields.defaultModel"))}<input name="model" value="${escapeAttr(draft.model)}" autocomplete="off" placeholder="${escapeAttr(ct("fields.defaultModelPlaceholder"))}"></label>
      </section>
      <details class="mp-config-section"><summary>${escapeHtml(ct("steps.advanced"))}</summary>
        <label>${escapeHtml(ct("fields.maxTokens"))}<input name="maxTokens" type="number" min="0" step="1" value="${escapeAttr(draft.maxTokens || "")}"></label>
        <label class="mp-check"><input name="apiKeyOptional" type="checkbox" ${draft.apiKeyOptional ? "checked" : ""}> ${escapeHtml(ct("fields.apiKeyOptional"))}</label>
      </details>
      ${state.result && typeof state.result === "object" ? `<div class="mp-provider-result ${escapeAttr(state.result.tone || "info")}" role="status" aria-live="polite">${escapeHtml(state.result.message || "")}</div>` : ""}
    </div>
    <footer class="mp-drawer-foot"><div><button class="mp-action" type="button" data-mp-fetch-models>${escapeHtml(ct("actions.fetchModels"))}</button><button class="mp-action" type="button" data-mp-test-provider ${testBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(testBusy ? ct("actions.testingConnection") : ct("actions.testConnection"))}</button></div><div>${isProviderDeletable(draft) && editing ? `<button class="mp-action danger" type="button" data-mp-delete-provider="${escapeAttr(draft.name)}" ${deleteBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(ct("actions.delete"))}</button>` : ""}<button class="mp-action primary" type="submit" data-mp-save-provider ${saveBusy ? "disabled aria-busy=\"true\"" : ""}>${escapeHtml(saveBusy ? ct("actions.saving") : ct("actions.saveAndEnable"))}</button></div></footer>
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
