import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { modelVisibilityPrefsKey, preferredModelKey, relayProtocolPrefsKey } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";

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
  function setModelRefreshButtonsBusy(busy) {
    ["refreshModelsBtn", "settingsRefreshModelsBtn", "providerRefreshModelsBtn", "relayFetchModelsBtn"].forEach((id) => {
      setButtonBusy($(id), busy, "刷新中");
    });
  }

  function setModelApplyButtonsBusy(busy) {
    setButtonBusy($("settingsClearPreferredModelBtn"), busy, "处理中");
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
      notifyTerminal?.("[info] 模型列表已刷新。\n");
    } finally {
      state.modelRefreshing = false;
      setModelRefreshButtonsBusy(false);
    }
  }

  async function loadProviderAuthFiles({ silent = false } = {}) {
    const provider = providerAuthProvider();
    if (!provider) {
      state.providerAuthFiles = null;
      state.providerAuthError = "当前没有支持凭证文件管理的 Provider。";
      if (!silent) throw new Error(state.providerAuthError);
      return;
    }
    const seq = ++state.providerAuthSeq;
    const button = silent ? null : $("codexRefreshAuthBtn");
    setButtonBusy(button, true, "刷新中");
    try {
      const files = await api(`/api/providers/${encodeURIComponent(provider.name)}/auth-files`);
      if (seq !== state.providerAuthSeq) return;
      state.providerAuthFiles = files;
      state.providerAuthError = "";
    } catch (err) {
      if (seq !== state.providerAuthSeq) return;
      state.providerAuthFiles = null;
      state.providerAuthError = err.message;
      if (!silent) notifyTerminal?.(`[warn] 读取 CLIProxyAPI 账号失败：${err.message}\n`);
    } finally {
      if (seq === state.providerAuthSeq) setButtonBusy(button, false, "刷新中");
    }
    if (seq === state.providerAuthSeq) refreshActiveSettingsPanel?.();
  }

  async function importCodexAuthFile() {
    const provider = providerAuthProvider();
    if (!provider) throw new Error("当前没有支持凭证文件管理的 Provider。");
    const button = $("codexImportAuthBtn");
    if (button?.disabled) return;
    const textarea = $("codexAuthImportText");
    const content = textarea?.value.trim() || "";
    if (!content) throw new Error("请先粘贴 JSON 或 token 内容");
    setButtonBusy(button, true, "导入中");
    if (textarea) textarea.disabled = true;
    try {
      await api(`/api/providers/${encodeURIComponent(provider.name)}/auth-files/import`, {
        method: "POST",
        body: JSON.stringify({ filename: "autoto-codex-auth.json", content }),
      });
      if (textarea) textarea.value = "";
      notifyTerminal?.("[info] 已导入 Codex 凭据，正在刷新账号和模型。\n");
      await loadProviderAuthFiles({ silent: true });
      await loadModelCatalog();
    } finally {
      setButtonBusy(button, false, "导入中");
      if (textarea) textarea.disabled = false;
    }
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
    setButtonBusy(button, true, "保存中");
    try {
      const result = await api(`/api/providers/${encodeURIComponent(spec.providerName)}/config`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.providerConfigStatus = result.message || "中转站配置已保存。";
      notifyTerminal?.(`[info] 已保存 ${spec.label} 配置，正在刷新模型。\n`);
      await loadSettings();
      await loadModelCatalog();
      refreshActiveSettingsPanel?.();
    } finally {
      setButtonBusy(button, false, "保存中");
    }
  }

  function selectRelayProtocol(protocol) {
    localStorage.setItem(relayProtocolPrefsKey, protocol);
    state.providerConfigStatus = "";
    refreshActiveSettingsPanel?.();
  }

  function getRelayProtocol() {
    const saved = localStorage.getItem(relayProtocolPrefsKey) || "completions";
    return relayProtocolSpec(saved).key;
  }

  function relayProtocolSpec(key) {
    return relayProtocolSpecs().find((item) => item.key === key) || relayProtocolSpecs().find((item) => item.key === "completions");
  }

  function relayProtocolSpecs() {
    return [
      { key: "anthropic", label: "Anthropic兼容", providerName: "anthropic", providerType: "anthropic", help: "连接第三方 Anthropic Messages API 兼容网关。" },
      { key: "codex", label: "Codex中转", providerName: "cliproxyapi", providerType: "openai-compatible", providerProfile: "cliproxyapi", help: "连接本机 CLIProxyAPI；Codex 账号统一使用下方凭据导入。" },
      { key: "responses", label: "Responses兼容", providerName: "openai", providerType: "openai", help: "连接 OpenAI Responses API 兼容端点。" },
      { key: "gemini-interactions", label: "Gemini Interactions", providerName: "gemini", providerType: "gemini-interactions", help: "连接 Gemini Interactions API，支持流式、函数调用、思考强度与图片输入。" },
      { key: "claude-code", label: "ClaudeCode中转", providerName: "anthropic", providerType: "anthropic", help: "按 Anthropic Messages API 兼容方式接入 Claude Code 中转。" },
      { key: "completions", label: "Completions老旧兼容", providerName: "openai-compatible", providerType: "openai-compatible", help: "连接 OpenAI Chat Completions 兼容中转站。" },
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

  function renderProviderConfigToggle(key, expanded, label = "配置") {
    return `<button class="settings-action-btn subtle" type="button" data-toggle-provider-config="${escapeAttr(key)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "收起" : `展开${label}`}</button>`;
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
    const clip = cliProxyProvider();
    return `
    <div class="settings-live-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">当前模型</div>
          <div class="settings-hero-title">${escapeHtml(current || "尚未选择")}</div>
          <p>${escapeHtml(preferred ? `首选模型：${preferred}` : "还没有保存首选模型；可先选模型，再创建项目。")}</p>
        </div>
        <div class="settings-action-row">
          <button id="settingsRefreshModelsBtn" class="settings-action-btn primary" type="button">刷新模型</button>
          <button id="settingsOpenLoginBtn" class="settings-action-btn" type="button">凭证 / 中转站</button>
          <button id="settingsShowConfiguredModelsBtn" class="settings-action-btn subtle" type="button">显示已配置模型</button>
          <button id="settingsClearPreferredModelBtn" class="settings-action-btn subtle" type="button">清除首选</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(String(options.length))}</strong><span>可选模型</span></div>
        <div><strong>${escapeHtml(clip?.error ? "需处理" : (clip ? "已就绪" : "未发现"))}</strong><span>CLIProxyAPI</span></div>
        <div><strong>${escapeHtml(clip?.baseUrl || "默认")}</strong><span>模型来源</span></div>
      </div>
      <div class="settings-model-list">
        ${providers.map(renderModelProviderSection).join("") || `<div class="settings-empty-card">尚未加载模型。请先刷新模型。</div>`}
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
    const title = hidden ? "显示这个模型" : "隐藏这个模型";
    return `
    <div class="settings-model-row ${active ? "active" : ""} ${hidden || disabled ? "muted" : ""}">
      <button class="settings-model-choice ${active ? "active" : ""}" type="button" data-apply-model="${escapeAttr(value)}" ${selectable ? "" : "disabled"}>
        <span class="settings-model-name">${escapeHtml(value)}</span>
        <span class="settings-model-provider">${escapeHtml(model)}${preferred ? " · 首选" : ""}${disabled ? " · 未配置" : hidden ? " · 已隐藏" : ""}</span>
      </button>
      <button class="settings-model-icon-btn" type="button" data-toggle-model-visibility="${escapeAttr(value)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" ${disabled ? "disabled" : ""}>${escapeHtml(icon)}</button>
    </div>
  `;
  }

  function renderProviderSettingsContent() {
    const providers = modelProvidersForUI();
    const clip = cliProxyProvider();
    const models = clip ? providerModelList(clip) : [];
    const authFiles = extractAuthFiles(state.providerAuthFiles);
    return `
    <div class="settings-live-page codex-provider-page">
      <section class="settings-hero-card codex-hero-card">
        <div>
          <div class="settings-hero-kicker">AI 供应商</div>
          <div class="settings-hero-title">Codex 凭证 + 中转站</div>
          <p>Codex 统一走凭证导入；中转站在 Autoto 内填写 API Key、Base URL、协议和默认模型，保存后立即刷新模型列表。</p>
        </div>
        <div class="settings-action-row">
          <button id="codexFocusImportBtn" class="settings-action-btn primary" type="button">导入 Codex 凭证</button>
          <button id="providerRefreshModelsBtn" class="settings-action-btn subtle" type="button">刷新模型</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(String(authFiles.length))}</strong><span>Codex 凭证</span></div>
        <div><strong>${escapeHtml(String(models.length))}</strong><span>Codex 模型</span></div>
        <div><strong>${escapeHtml(String(providers.length))}</strong><span>Provider</span></div>
      </div>
      ${renderCodexImportCard()}
      ${renderCodexAccountCard(authFiles)}
      ${renderRelayProviderConfigCard()}
      ${renderCustomProviderConfigCard()}
      ${clip ? renderCLIProxyStatusCard(clip) : `<div class="settings-empty-card">未找到 cliproxyapi provider。</div>`}
      <div class="settings-provider-cards">
        ${providers.map(renderProviderCard).join("")}
      </div>
    </div>
  `;
  }

  function renderCodexImportCard() {
    return `
    <section class="settings-provider-section" id="codexCredentialImportSection">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">Codex 凭证导入</div>
          <div class="settings-provider-meta">粘贴包含 refresh_token/access_token 的 JSON、sub2api 风格导出、逗号/换行分隔 refresh_token，或 rt_xxxxx / email----pass----at----access_token 账号行。</div>
        </div>
        <button id="codexImportAuthBtn" class="settings-action-btn primary" type="button">导入</button>
      </div>
      <textarea id="codexAuthImportText" class="settings-token-input" placeholder="user@example.com----password----note----rt_xxxxx----note\nuser@example.com----password----at----access_token_here"></textarea>
      <div class="settings-inline-success">Codex 仅保留凭证导入方式；导入后会自动刷新账号和模型。</div>
    </section>
  `;
  }

  function renderCodexAccountCard(authFiles) {
    return `
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">已导入凭证</div>
          <div class="settings-provider-meta">来自 CLIProxyAPI auth-dir。导入后会自动刷新；也可手动刷新凭证列表。</div>
        </div>
        <button id="codexRefreshAuthBtn" class="settings-action-btn" type="button">刷新账号</button>
      </div>
      ${state.providerAuthError ? `<div class="settings-inline-alert">${escapeHtml(state.providerAuthError)}</div>` : ""}
      <div class="settings-auth-list">
        ${authFiles.length ? authFiles.map(renderCodexAuthItem).join("") : `<div class="settings-empty-card compact">暂无 Codex 凭证。请在上方粘贴 JSON 或 token 后导入。</div>`}
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
          <div class="settings-provider-title">中转站配置</div>
          <div class="settings-provider-meta">当前协议：${escapeHtml(spec.help)} · 当前前缀：${escapeHtml(spec.providerName)}:${escapeHtml(modelValue)}</div>
        </div>
        <div class="settings-action-row compact-actions">
          ${renderProviderConfigToggle("relay", expanded, "中转配置")}
        </div>
      </div>
      ${state.providerConfigStatus ? `<div class="settings-inline-success">${escapeHtml(state.providerConfigStatus)}</div>` : ""}
      ${expanded ? `
        <div class="settings-collapsible-body">
          <div class="settings-provider-actions compact-actions">
            <button id="relayFetchModelsBtn" class="settings-action-btn subtle" type="button">获取模型列表</button>
            <button id="relaySaveConfigBtn" class="settings-action-btn primary" type="button">保存更改</button>
          </div>
          <div class="relay-form-grid">
            <label class="relay-field wide">
              <span>供应商名称</span>
              <input id="relayProviderName" class="settings-text-input" value="${escapeAttr(provider.name || spec.providerName)}" disabled>
              <small>当前保存到 Autoto provider：${escapeHtml(spec.providerName)}</small>
            </label>
            <label class="relay-field wide">
              <span>供应商前缀</span>
              <input class="settings-text-input" value="${escapeAttr((provider.name || spec.providerName) + ":")}" disabled>
              <small>模型会以这个前缀出现在下拉框里，例如 ${escapeHtml(spec.providerName)}:${escapeHtml(modelValue)}</small>
            </label>
            <label class="relay-field wide">
              <span>API Key</span>
              <input id="relayApiKey" class="settings-text-input" type="password" autocomplete="off" placeholder="sk-... / sk-ant-...；留空沿用当前运行时或环境变量">
            </label>
            <label class="relay-field wide">
              <span>Base URL</span>
              <input id="relayBaseUrl" class="settings-text-input" value="${escapeAttr(provider.baseUrl || "")}" placeholder="例如 https://api.example.com/v1 或 http://127.0.0.1:8317/v1">
            </label>
          </div>
          <div class="relay-field">
            <span>API 协议</span>
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
              <span>HTTPS 代理</span>
              <input class="settings-text-input" value="" placeholder="例如 http://127.0.0.1:7890、socks5://proxy:1080（当前仅作记录提示）" disabled>
            </label>
            <label class="relay-field wide">
              <span>默认思考强度</span>
              <select class="settings-text-input" disabled>
                <option>自动</option>
                <option>低</option>
                <option>中</option>
                <option>高</option>
              </select>
            </label>
          </div>
          <div class="relay-field">
            <span>自定义模型</span>
            <div class="relay-model-row">
              <input id="relayCustomModel" class="settings-text-input" value="${escapeAttr(modelValue)}" placeholder="模型 ID">
              <input class="settings-text-input" value="${escapeAttr(modelValue)}" placeholder="显示名称" disabled>
            </div>
            <small>保存后会作为该 provider 的默认模型；点击“获取模型列表”可从 Base URL 动态拉取可用模型。</small>
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
          <div class="settings-provider-title">新增 / 更新自定义 Provider</div>
          <div class="settings-provider-meta">默认收起；点开后可自行填写 Provider、协议、Base URL、API Key 和默认模型。Groq 示例：groq:openai/gpt-oss-20b。</div>
        </div>
        <div class="settings-action-row compact-actions">
          <button id="fillGroqProviderExampleBtn" class="settings-action-btn subtle" type="button">填入 Groq 示例</button>
          ${renderProviderConfigToggle("custom-provider", expanded, "自定义配置")}
        </div>
      </div>
      ${expanded ? `
        <form id="customProviderConfigForm" class="settings-provider-config-form custom-provider-config-form settings-collapsible-body">
          <div class="settings-provider-form-grid">
            <label>Provider 名称 / 前缀
              <input id="customProviderName" class="settings-field" name="name" value="" placeholder="groq" autocomplete="off" />
            </label>
            <label>协议
              <select id="customProviderType" class="settings-field" name="type">
                ${renderProviderTypeOptions("openai-compatible")}
              </select>
            </label>
            <label class="settings-form-span-2">Base URL
              <input id="customProviderBaseUrl" class="settings-field" name="baseUrl" value="" placeholder="https://api.groq.com/openai/v1" autocomplete="off" />
            </label>
            <label class="settings-form-span-2">API Key
              <input id="customProviderApiKey" class="settings-field" name="apiKey" type="password" autocomplete="off" placeholder="粘贴用户自己的 API Key（不会写入磁盘）" />
            </label>
            <label>默认模型
              <input id="customProviderModel" class="settings-field" name="model" value="" placeholder="openai/gpt-oss-20b" autocomplete="off" />
            </label>
            <label>Max tokens
              <input class="settings-field" name="maxTokens" type="number" min="0" step="1" value="" placeholder="可留空" />
            </label>
            <label class="settings-checkbox-field settings-form-span-2">
              <input name="apiKeyOptional" type="checkbox" />
              <span>API Key 可选（本地代理或免鉴权端点）</span>
            </label>
          </div>
          <div class="settings-provider-actions">
            <button class="settings-action-btn primary" type="submit" data-provider-save>保存自定义 Provider</button>
          </div>
          <div class="settings-provider-note">例如 Groq：Provider 填 groq、协议选 OpenAI-compatible、Base URL 填 https://api.groq.com/openai/v1、API Key 填 Groq 控制台生成的免费额度 Key、默认模型填 openai/gpt-oss-20b。保存后模型前缀会是 groq:。</div>
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
      <span class="settings-status-pill ${disabled ? "muted" : "ok"}">${disabled ? "已停用" : "可用"}</span>
    </div>
  `;
  }

  function extractAuthFiles(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    for (const key of ["files", "authFiles", "data", "items"]) {
      if (Array.isArray(value[key])) return value[key];
    }
    return [];
  }

  function authFileName(item) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "unknown";
    return item.name || item.filename || item.file || item.path || item.auth_index || item.authIndex || "unknown";
  }

  function authFileProvider(item) {
    if (!item || typeof item !== "object") return "Codex";
    return item.provider || item.type || item.channel || "Codex";
  }

  function renderCLIProxyStatusCard(provider) {
    const models = providerModelList(provider);
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(providerLabel(provider))}</div>
          <div class="settings-provider-meta">${escapeHtml(provider.baseUrl || "http://127.0.0.1:8317/v1")}</div>
        </div>
        <span class="settings-status-pill ${provider.error ? "warn" : "ok"}">${escapeHtml(providerStatusText(provider))}</span>
      </div>
      ${provider.error ? `<div class="settings-inline-alert">${escapeHtml(provider.error)}</div>` : `<div class="settings-inline-success">已加载 ${escapeHtml(String(models.length))} 个模型。导入/切换凭证后点“刷新模型”即可更新。</div>`}
      <div class="settings-copy-row">
        <button class="settings-action-btn subtle" type="button" data-copy-text="${escapeAttr(provider.baseUrl || "http://127.0.0.1:8317/v1")}">复制 Base URL</button>
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
          <div class="settings-provider-meta">${escapeHtml(type)} · ${escapeHtml(providerCapabilitiesLabel(provider))} · ${escapeHtml(models.length + " 个模型")}</div>
        </div>
        <div class="settings-action-row compact-actions">
          <span class="settings-status-pill ${provider.error ? "warn" : (provider.configured ? "ok" : "muted")}">${escapeHtml(providerStatusText(provider))}</span>
          ${renderProviderConfigToggle(`provider:${provider.name}`, expanded, "配置")}
        </div>
      </div>
      <div class="settings-provider-meta path">${escapeHtml(baseUrl || "默认官方端点 / 无 Base URL")}</div>
      ${provider.configured ? `<div class="settings-inline-success compact">已配置：该 provider 的可见模型会出现在模型选择器。</div>` : `<div class="settings-inline-alert compact">未配置：该 provider 不会出现在模型选择器；填入 API Key 后保存即可启用。</div>`}
      ${provider.error ? `<div class="settings-inline-alert compact">${escapeHtml(provider.error)}</div>` : ""}
      ${expanded ? `
        <form class="settings-provider-config-form settings-collapsible-body" data-provider-name="${escapeAttr(provider.name)}">
          <div class="settings-provider-form-grid">
            <label>协议
              <select class="settings-field" name="type">
                ${renderProviderTypeOptions(type)}
              </select>
            </label>
            <label>默认模型
              <input class="settings-field" name="model" value="${escapeAttr(model)}" placeholder="例如 gpt-4.1-mini" />
            </label>
            <label class="settings-form-span-2">Base URL
              <input class="settings-field" name="baseUrl" value="${escapeAttr(baseUrl)}" placeholder="${escapeAttr(providerBaseURLPlaceholder(type, provider.profile))}" />
            </label>
            <label class="settings-form-span-2">API Key
              <input class="settings-field" name="apiKey" type="password" autocomplete="off" placeholder="${provider.configured ? "留空保留当前运行时密钥" : "粘贴 API Key（不会写入磁盘）"}" />
            </label>
            <label>Max tokens
              <input class="settings-field" name="maxTokens" type="number" min="0" step="1" value="${escapeAttr(maxTokens || "")}" placeholder="Anthropic 默认 4096" />
            </label>
            <label class="settings-checkbox-field">
              <input name="apiKeyOptional" type="checkbox" ${apiKeyOptional ? "checked" : ""} />
              <span>API Key 可选（本地代理或免鉴权端点）</span>
            </label>
          </div>
          <div class="settings-provider-actions">
            <button class="settings-action-btn primary" type="submit" data-provider-save>保存配置</button>
            <button class="settings-action-btn subtle" type="button" data-copy-text="${escapeAttr(envExample)}">复制 env 示例</button>
          </div>
          <div class="settings-provider-note">保存后立即更新当前运行时和模型列表；API Key 只保存在内存，不写入 config.json。</div>
        </form>
      ` : ""}
    </section>
  `;
  }

  function renderProviderTypeOptions(selected) {
    return [
      { value: "openai-compatible", label: "OpenAI-compatible" },
      { value: "openai", label: "OpenAI 官方" },
      { value: "anthropic", label: "Anthropic 官方" },
      { value: "gemini-interactions", label: "Gemini Interactions" },
    ].map((item) => `<option value="${escapeAttr(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  }

  function providerBaseURLPlaceholder(type, profile) {
    if (profile === "cliproxyapi") return "http://127.0.0.1:8317/v1";
    if (type === "openai-compatible") return "https://api.example.com/v1";
    if (type === "anthropic") return "留空使用 Anthropic 官方端点";
    if (type === "gemini-interactions") return "https://generativelanguage.googleapis.com/v1beta/interactions";
    return "留空使用 OpenAI 官方端点";
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
      cliproxyapi: [`export CLIPROXYAPI_BASE_URL="${baseURL}"`, `export CLIPROXYAPI_MODEL="${model}"`, `# 如果 CLIProxyAPI 启用了客户端 api-keys，再设置：`, `export CLIPROXYAPI_API_KEY="..."`],
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
    if (!providerName) throw new Error("请填写 Provider 名称");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(providerName)) throw new Error("Provider 名称必须以英文字母或数字开头，且只能包含英文字母、数字、点、下划线和中横线");
    const payload = {
      name: providerName,
      type: form.elements.type?.value || "openai-compatible",
      baseUrl: form.elements.baseUrl?.value.trim() || "",
      apiKey: form.elements.apiKey?.value.trim() || "",
      model: form.elements.model?.value.trim() || "",
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
      apiKeyOptional: Boolean(form.elements.apiKeyOptional?.checked),
    };
    if (!payload.model) throw new Error("请填写默认模型");
    if (payload.type === "openai-compatible" && !payload.baseUrl) throw new Error("OpenAI-compatible provider 需要 Base URL");
    form.dataset.submitting = "true";
    setButtonBusy(saveButton, true, "保存中");
    try {
      const response = await api(`/api/providers/${encodeURIComponent(providerName)}/config`, { method: "PUT", body: JSON.stringify(payload) });
      state.providerConfigStatus = response.message || "Provider 配置已保存。";
      await loadSettings();
      await loadModelCatalog();
      renderModelOptions();
      refreshActiveSettingsPanel?.();
      notifyTerminal?.(`[info] ${providerLabel({ name: providerName })} 配置已保存：${response.message || "已生效"}\n`);
    } finally {
      delete form.dataset.submitting;
      setButtonBusy(saveButton, false, "保存中");
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

  function bindProviderSettingsActions() {
    $("codexFocusImportBtn")?.addEventListener("click", () => $("codexCredentialImportSection")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    $("codexImportAuthBtn")?.addEventListener("click", () => importCodexAuthFile().catch(showError));
    $("codexRefreshAuthBtn")?.addEventListener("click", () => loadProviderAuthFiles().catch(showError));
    $("providerRefreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
    $("relaySaveConfigBtn")?.addEventListener("click", () => saveRelayProviderConfig().catch(showError));
    $("relayFetchModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
    $("fillGroqProviderExampleBtn")?.addEventListener("click", fillGroqProviderExample);
    $("settingsContentBody").querySelectorAll("[data-toggle-provider-config]").forEach((node) => {
      node.addEventListener("click", () => toggleProviderConfig(node.dataset.toggleProviderConfig));
    });
    $("settingsContentBody").querySelectorAll("[data-relay-protocol]").forEach((node) => {
      node.addEventListener("click", () => selectRelayProtocol(node.dataset.relayProtocol));
    });
    $("settingsContentBody").querySelectorAll(".settings-provider-config-form").forEach((form) => {
      form.addEventListener("submit", (event) => saveProviderConfig(event).catch(showError));
    });
    $("settingsContentBody").querySelectorAll("[data-copy-text]").forEach((node) => {
      node.addEventListener("click", () => copyText?.(node.dataset.copyText || ""));
    });
    if (!state.providerAuthFiles && !state.providerAuthError) {
      loadProviderAuthFiles({ silent: true }).catch(showError);
    }
  }

  function allModelOptions() {
    return selectableModelProviders().flatMap((provider) => providerModelList(provider).map((model) => ({ provider, model, value: modelOptionValue(provider, model) })));
  }

  function providerLabel(provider) {
    if (provider.profile === "cliproxyapi") return "CLIProxyAPI";
    if (provider.type === "openai-compatible" && provider.profile === "") return "中转站";
    return provider.name;
  }

  function providerStatusText(provider) {
    if (provider.error) return "需配置/处理";
    if (provider.configured) return "已就绪";
    return "未配置";
  }

  function providerCapabilitiesLabel(provider) {
    const capabilities = provider.capabilities || {};
    const labels = [];
    if (capabilities.streaming) labels.push("流式");
    if (capabilities.tools) labels.push("工具");
    if (capabilities.imageInput) labels.push("图像");
    return labels.length ? labels.join(" / ") : "基础";
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
      notifyTerminal?.(value ? `[info] 已使用模型：${value}\n` : "[info] 已清除首选模型。\n");
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
      const groupLabel = `${provider.name}${provider.error ? "（需配置/刷新）" : ""}`;
      const options = models.map((model) => {
        const value = `${provider.name}:${model}`;
        optionValues.push(value);
        const suffix = provider.configured ? "" : "（未配置）";
        return `<option value="${escapeAttr(value)}" data-provider="${escapeAttr(provider.name)}" data-configured="${provider.configured ? "true" : "false"}">${escapeHtml(model + suffix)}</option>`;
      }).join("");
      return `<optgroup label="${escapeAttr(groupLabel)}">${options}</optgroup>`;
    }).join("");
    const currentModel = currentModelValue();
    const currentOption = currentModel && !optionValues.includes(currentModel)
      ? `<option value="${escapeAttr(currentModel)}" data-configured="false">${escapeHtml(currentModel)}（当前 / 已隐藏）</option>`
      : "";
    select.innerHTML = currentOption + (groups || `<option value="" data-configured="false">尚未加载模型</option>`);
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
    const catalogProviders = Array.isArray(state.modelCatalog?.providers) ? state.modelCatalog.providers : [];
    if (catalogProviders.length) {
      return catalogProviders.map((provider) => {
        const setting = settingProviderByName(provider.name || provider.type || "") || {};
        return normalizeModelProvider({
          name: setting.name,
          type: setting.type,
          profile: setting.profile,
          baseUrl: setting.baseUrl,
          defaultModel: setting.model,
          maxTokens: setting.maxTokens,
          configured: setting.configured,
          apiKeyOptional: setting.apiKeyOptional,
          ...provider,
        });
      });
    }
    return (state.settings?.providers || []).map((provider) => normalizeModelProvider({
      name: provider.name,
      type: provider.type,
      profile: provider.profile,
      baseUrl: provider.baseUrl,
      defaultModel: provider.model,
      maxTokens: provider.maxTokens,
      models: provider.model ? [provider.model] : [],
      configured: provider.configured,
      apiKeyOptional: provider.apiKeyOptional,
    }));
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
    const management = provider.management && typeof provider.management === "object" ? provider.management : {};
    return {
      name: provider.name || provider.type || "provider",
      type: provider.type || provider.name || "provider",
      profile: provider.profile || "",
      baseUrl: provider.baseUrl || "",
      defaultModel: provider.defaultModel || provider.model || "",
      maxTokens: Number(provider.maxTokens || 0),
      models: Array.isArray(provider.models) ? provider.models.filter(Boolean) : [],
      configured: Boolean(provider.configured),
      apiKeyOptional: Boolean(provider.apiKeyOptional),
      capabilities: {
        tools: Boolean(capabilities.tools),
        streaming: Boolean(capabilities.streaming),
        imageInput: Boolean(capabilities.imageInput),
      },
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
    select.title = provider?.error || (configured ? "模型已配置，可以对话" : modelSetupMessage(select.value));
  }

  function modelSetupMessage(modelValue = $("modelSelect")?.value || state.agent?.model || "") {
    const provider = currentProviderConfig(modelValue);
    const providerName = provider?.name || String(modelValue || "openai").split(":")[0] || "openai";
    if (provider?.error) {
      return `${provider.error} 配置或导入凭证后点击“刷新模型”。`;
    }
    const envByProvider = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      groq: "GROQ_API_KEY",
      cliproxyapi: "CLIPROXYAPI_API_KEY（仅当 CLIProxyAPI 配置了 api-keys 时需要）",
      "openai-compatible": "OPENAI_COMPATIBLE_API_KEY 或 OPENAI_API_KEY",
    };
    const envName = envByProvider[providerName] || "对应 provider 的 API key 环境变量";
    return `已选择模型 ${modelValue || "未选择"}，但它所属的 provider（${providerName}）尚未配置 API Key。请在“设置 → 提供商”粘贴该 provider 的 API Key 立即生效；或在启动 Autoto 前设置 ${envName} 后重启。注意：为避免把密钥写进磁盘，页面里粘贴的 API Key 只保存在当前运行时，服务重启后需要重新提供。`;
  }

  function providerAuthProvider() {
    return modelProvidersForUI().find((provider) => provider.management?.authFiles)
      || null;
  }

  function cliProxyProvider() {
    return modelProvidersForUI().find((provider) => provider.profile === "cliproxyapi")
      || null;
  }

  function cliProxyProviderSummary() {
    const provider = cliProxyProvider();
    if (!provider) return "已内置 cliproxyapi provider；启动 CLIProxyAPI 后点击刷新模型。";
    const count = providerModelList(normalizeModelProvider(provider)).length;
    if (provider.error) return `${provider.error} 当前保留 ${count} 个回退模型。`;
    return `已连接 ${provider.baseUrl || "http://127.0.0.1:8317/v1"}，当前可选 ${count} 个模型；导入/切换凭证后点击刷新模型即可更新。`;
  }

  function renderAgentModelOptions(currentModel) {
    const options = allModelOptions();
    const values = new Set(options.map((item) => item.value));
    const currentOption = currentModel && !values.has(currentModel)
      ? `<option value="${escapeAttr(currentModel)}">${escapeHtml(currentModel)}（当前 / 已隐藏）</option>`
      : "";
    const grouped = selectableModelProviders().map((provider) => {
      const models = providerModelList(provider);
      if (!models.length) return "";
      return `<optgroup label="${escapeAttr(providerLabel(provider))}">${models.map((model) => {
        const value = `${provider.name}:${model}`;
        const suffix = provider.configured ? "" : "（未配置）";
        return `<option value="${escapeAttr(value)}" ${value === currentModel ? "selected" : ""}>${escapeHtml(model + suffix)}</option>`;
      }).join("")}</optgroup>`;
    }).join("");
    return currentOption + (grouped || `<option value="${escapeAttr(currentModel || "")}">${escapeHtml(currentModel || "尚未加载模型")}</option>`);
  }

  return {
    bindModelSettingsActions,
    bindProviderSettingsActions,
    cliProxyProviderSummary,
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
