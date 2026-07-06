const state = {
  projects: [],
  project: null,
  chapter: null,
  narrator: null,
  settings: null,
  backends: [],
  backendHealth: null,
  directoryPath: "",
  directoryParent: "",
  directoryShortcuts: [],
  projectQuery: "",
  ws: null,
  terminalWS: null,
};

const recentDirectoriesKey = "codeharbor.recentDirectories";

const settingsSections = [
  {
    title: "个人设置",
    items: [
      { key: "profile", icon: "♙", label: "个人资料", subtitle: "管理当前用户的显示信息、头像与身份。" },
      { key: "models", icon: "⚙", label: "模型", subtitle: "配置默认模型、模型列表与推理偏好。" },
      { key: "agents", icon: "♧", label: "AI 代理", subtitle: "设置代理默认行为、权限模式与运行策略。" },
      { key: "skills", icon: "✦", label: "技能", subtitle: "管理技能、命令和 MCP 工具，增强你的 AI 工作流。" },
      { key: "notifications", icon: "♢", label: "通知", subtitle: "管理任务完成、错误与后台运行提醒。" },
      { key: "appearance", icon: "◉", label: "外观与界面", subtitle: "调整主题、布局密度和界面显示。" },
      { key: "im-gateway", icon: "◌", label: "IM 网关", subtitle: "连接 IM、Webhook 与外部消息入口。" },
    ],
  },
  {
    title: "实例管理",
    items: [
      { key: "providers", icon: "☁", label: "提供商", subtitle: "管理 OpenAI、Anthropic 与 OpenAI-compatible 提供商。" },
      { key: "network-search", icon: "⌕", label: "网络搜索", subtitle: "配置搜索提供商、权限与结果策略。" },
      { key: "agent-admin", icon: "⬡", label: "代理管理", subtitle: "查看、切换和治理本地 Agent Server 后端。" },
      { key: "chapters-containers", icon: "◇", label: "章节与容器", subtitle: "管理章节、工作线、容器和隔离策略。" },
      { key: "servers-system", icon: "▤", label: "服务器与系统", subtitle: "查看服务状态、端口、版本与系统资源。" },
      { key: "users", icon: "♟", label: "用户管理", subtitle: "管理本地用户、角色和访问策略。" },
      { key: "terminals", icon: "▻", label: "终端管理", subtitle: "管理 PTY 终端、会话和默认 shell。" },
      { key: "storage", icon: "▭", label: "储存空间", subtitle: "查看数据库、项目目录和缓存占用。" },
      { key: "runtime", icon: "▷", label: "运行资源", subtitle: "管理后台任务、运行时和资源限制。" },
      { key: "usage", icon: "▧", label: "使用历史", subtitle: "查看消息、工具调用和模型请求历史。" },
      { key: "about", icon: "ⓘ", label: "关于", subtitle: "查看版本、许可证和第三方依赖。" },
    ],
  },
];

const settingsItems = settingsSections.flatMap((section) => section.items);

const skillTabs = [
  { key: "commands", label: "命令", description: "用户级斜杠命令，展开为提示词模板。在聊天输入框中输入 /命令名 即可使用。", empty: "暂无命令，添加一个以开始使用。", action: "添加命令" },
  { key: "optional-tools", label: "可选工具", description: "控制代理可按需启用的辅助工具集合。", empty: "暂无可选工具配置。", action: "添加工具" },
  { key: "tool-permissions", label: "工具权限", description: "定义 Read、Write、Edit、Bash 等工具在不同权限模式下的行为。", empty: "尚未配置自定义工具权限。", action: "添加规则" },
  { key: "global-skills", label: "全局技能", description: "对所有项目生效的技能包和工作流。", empty: "暂无全局技能。", action: "添加技能" },
  { key: "project-skills", label: "项目技能", description: "只在当前项目或目录中生效的技能。", empty: "暂无项目技能。", action: "添加项目技能" },
  { key: "subagents", label: "自定义子代理", description: "定义专用子代理类型、提示词和工具权限。", empty: "暂无自定义子代理。", action: "添加子代理" },
  { key: "global-prompts", label: "全局提示词", description: "对所有会话追加的用户级提示词。", empty: "暂无全局提示词。", action: "添加提示词" },
  { key: "system-prompts", label: "系统提示词", description: "管理系统级提示词模板与安全边界。", empty: "暂无自定义系统提示词。", action: "添加系统提示词" },
  { key: "mcp-tools", label: "MCP 工具", description: "连接和管理 MCP server 暴露的工具。", empty: "暂无 MCP 工具。", action: "添加 MCP" },
  { key: "hooks", label: "钩子", description: "配置运行前后、工具调用前后等自动化钩子。", empty: "暂无钩子。", action: "添加钩子" },
];

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

function setHealth(ok, text) {
  const badge = $("healthBadge");
  badge.textContent = text;
  badge.classList.toggle("ok", ok);
  badge.classList.toggle("err", !ok);
}

async function loadHealth() {
  try {
    const health = await api("/api/health");
    setHealth(true, `healthy ${health.version}`);
  } catch {
    setHealth(false, "offline");
  }
}

async function loadBackends({ checkHealth = true } = {}) {
  state.backends = await api("/api/backends");
  renderBackendPanel();
  renderBackendsList();
  if (checkHealth) await refreshActiveBackendHealth();
}

function activeBackend() {
  return state.backends.find((backend) => backend.active) || state.backends[0] || null;
}

function renderBackendPanel() {
  const backend = activeBackend();
  $("activeBackendName").textContent = backend ? `${backend.name} · ${backend.baseUrl}` : "未配置后端";
  if (!backend) setBackendHealthBadge(false, "未配置");
}

function setBackendHealthBadge(ok, text) {
  const badge = $("backendHealthBadge");
  badge.textContent = text;
  badge.classList.toggle("ok", ok);
  badge.classList.toggle("err", !ok);
}

async function refreshActiveBackendHealth() {
  const backend = activeBackend();
  if (!backend) return;
  setBackendHealthBadge(false, "checking");
  try {
    const health = await api(`/api/backends/${backend.id}/health`);
    state.backendHealth = health;
    setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
    renderBackendsList();
  } catch (err) {
    state.backendHealth = { backendId: backend.id, ok: false, status: "error", error: err.message };
    setBackendHealthBadge(false, "error");
    renderBackendsList();
  }
}

function openBackendsModal() {
  $("backendsModal").classList.remove("hidden");
  renderBackendsList();
}

function closeBackendsModal() {
  $("backendsModal").classList.add("hidden");
}

function resetBackendForm() {
  $("backendName").value = "";
  $("backendKind").value = "local";
  $("backendBaseUrl").value = "";
  $("backendApiKey").value = "";
}

function renderBackendsList() {
  const el = $("backendsList");
  if (!el) return;
  if (!state.backends.length) {
    el.innerHTML = `<div class="empty-list">还没有后端。添加一个 OpenHands Agent Server URL 后即可检测连通性。</div>`;
    return;
  }
  el.innerHTML = state.backends.map((backend) => {
    const health = state.backendHealth?.backendId === backend.id ? state.backendHealth : null;
    const healthText = health ? (health.status || (health.ok ? "online" : "offline")) : "未检测";
    return `
      <div class="backend-card ${backend.active ? "active" : ""}">
        <div class="backend-card-main">
          <div class="backend-card-title">${escapeHtml(backend.name)} ${backend.active ? "<span class='mini-tag'>active</span>" : ""}</div>
          <div class="backend-card-url">${escapeHtml(backend.baseUrl)}</div>
          <div class="backend-card-meta">${escapeHtml(backend.kind)} · ${backend.apiKeyConfigured ? "API key 已配置" : "无 API key"} · ${escapeHtml(healthText)}</div>
        </div>
        <div class="backend-card-actions">
          <button class="ghost-btn mini" type="button" data-backend-test="${escapeAttr(backend.id)}">检测</button>
          ${backend.active ? "" : `<button class="ghost-btn mini" type="button" data-backend-activate="${escapeAttr(backend.id)}">设为当前</button>`}
          <button class="ghost-btn mini danger" type="button" data-backend-delete="${escapeAttr(backend.id)}">删除</button>
        </div>
      </div>
    `;
  }).join("");
  el.querySelectorAll("[data-backend-test]").forEach((node) => {
    node.addEventListener("click", () => testBackend(node.dataset.backendTest).catch(showError));
  });
  el.querySelectorAll("[data-backend-activate]").forEach((node) => {
    node.addEventListener("click", () => activateBackend(node.dataset.backendActivate).catch(showError));
  });
  el.querySelectorAll("[data-backend-delete]").forEach((node) => {
    node.addEventListener("click", () => deleteBackend(node.dataset.backendDelete).catch(showError));
  });
}

async function saveBackend(event) {
  event.preventDefault();
  const payload = {
    name: $("backendName").value.trim(),
    kind: $("backendKind").value,
    baseUrl: $("backendBaseUrl").value.trim(),
    apiKey: $("backendApiKey").value.trim(),
    active: state.backends.length === 0,
  };
  if (!payload.baseUrl) throw new Error("请填写后端 URL");
  await api("/api/backends", { method: "POST", body: JSON.stringify(payload) });
  resetBackendForm();
  await loadBackends();
}

async function activateBackend(id) {
  await api(`/api/backends/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
  await loadBackends();
}

async function deleteBackend(id) {
  if (!confirm("删除这个后端？")) return;
  await api(`/api/backends/${id}`, { method: "DELETE" });
  await loadBackends();
}

async function testBackend(id) {
  const health = await api(`/api/backends/${id}/health`);
  state.backendHealth = health;
  if (activeBackend()?.id === id) setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
  renderBackendsList();
}

async function loadSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;
  renderModelOptions();
}

function openSettingsModal(key = "profile") {
  $("settingsModal").classList.remove("hidden");
  renderSettingsNav(key);
  selectSettingsPanel(key);
}

function closeSettingsModal() {
  $("settingsModal").classList.add("hidden");
}

function renderSettingsNav(activeKey = "profile") {
  const nav = $("settingsNav");
  nav.innerHTML = settingsSections.map((section) => `
    <div class="settings-nav-section">
      <div class="settings-nav-heading">${escapeHtml(section.title)}</div>
      ${section.items.map((item) => `
        <button class="settings-nav-item ${item.key === activeKey ? "active" : ""}" type="button" data-settings-key="${escapeAttr(item.key)}">
          <span class="settings-nav-icon">${escapeHtml(item.icon)}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `).join("")}
    </div>
  `).join("");
  nav.querySelectorAll("[data-settings-key]").forEach((node) => {
    node.addEventListener("click", () => selectSettingsPanel(node.dataset.settingsKey));
  });
}

function selectSettingsPanel(key) {
  const item = settingsItems.find((entry) => entry.key === key) || settingsItems[0];
  $("settingsContentTitle").textContent = item.key === "skills" ? "套路" : item.label;
  $("settingsContentSubtitle").textContent = item.subtitle;
  $("settingsContentBody").innerHTML = renderSettingsContent(item);
  $("settingsNav").querySelectorAll(".settings-nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.settingsKey === item.key);
  });
  if (item.key === "skills") bindSkillTabs("commands");
}

function renderSettingsContent(item) {
  if (item.key === "skills") return renderSkillSettingsContent("commands");
  const details = settingsPanelDetails(item.key);
  return `
    <div class="settings-panel-card">
      <div class="settings-panel-icon">${escapeHtml(item.icon)}</div>
      <div>
        <div class="settings-panel-title">${escapeHtml(item.label)}</div>
        <p>${escapeHtml(item.subtitle)}</p>
      </div>
    </div>
    <div class="settings-panel-grid">
      ${details.map((detail) => `
        <div class="settings-info-card">
          <div class="settings-info-title">${escapeHtml(detail.title)}</div>
          <div class="settings-info-text">${escapeHtml(detail.text)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSkillSettingsContent(activeKey = "commands") {
  const active = skillTabs.find((tab) => tab.key === activeKey) || skillTabs[0];
  return `
    <div class="skills-page">
      <div class="skills-tabs" role="tablist" aria-label="技能设置分类">
        ${skillTabs.map((tab) => `
          <button class="skills-tab ${tab.key === active.key ? "active" : ""}" type="button" data-skill-tab="${escapeAttr(tab.key)}" role="tab" aria-selected="${tab.key === active.key ? "true" : "false"}">
            ${escapeHtml(tab.label)}
          </button>
        `).join("")}
      </div>
      <section class="skills-tab-panel" role="tabpanel">
        <p class="skills-description">${escapeHtml(active.description)}</p>
        <p class="skills-empty-text">${escapeHtml(active.empty)}</p>
        <button class="skills-add-btn" type="button" data-skill-action="${escapeAttr(active.key)}">
          <span>＋</span>
          <span>${escapeHtml(active.action)}</span>
        </button>
      </section>
    </div>
  `;
}

function bindSkillTabs(activeKey = "commands") {
  const body = $("settingsContentBody");
  body.querySelectorAll("[data-skill-tab]").forEach((node) => {
    node.addEventListener("click", () => {
      body.innerHTML = renderSkillSettingsContent(node.dataset.skillTab);
      bindSkillTabs(node.dataset.skillTab);
    });
  });
  body.querySelectorAll("[data-skill-action]").forEach((node) => {
    node.addEventListener("click", () => appendTerminal(`[info] ${skillTabLabel(node.dataset.skillAction)} 配置入口已预留。\n`));
  });
}

function skillTabLabel(key) {
  return skillTabs.find((tab) => tab.key === key)?.label || key;
}

function settingsPanelDetails(key) {
  const base = {
    profile: [
      { title: "当前状态", text: "本地 MVP 暂未启用完整账户系统，后续会在这里管理头像、昵称和资料。" },
      { title: "快捷动作", text: "可扩展为导入头像、设置显示名称和绑定 Git 身份。" },
    ],
    models: [
      { title: "默认模型", text: state.settings?.agent?.defaultModel || "尚未加载默认模型" },
      { title: "已配置提供商", text: `${state.settings?.providers?.length || 0} 个 provider profile` },
    ],
    agents: [
      { title: "默认权限", text: state.settings?.agent?.defaultPermissionMode || "acceptEdits" },
      { title: "运行策略", text: "后续会管理自动工具调用、计划模式和代理行为。" },
    ],
    providers: [
      { title: "CLIProxyAPI", text: "已内置 cliproxyapi provider，默认连接 http://127.0.0.1:8317/v1，模型菜单可直接选择 cliproxyapi:gpt-5.5。" },
      { title: "Secret", text: "默认 config 写盘会脱敏；如 CLIProxyAPI 配置了 api-keys，请通过 CLIPROXYAPI_API_KEY 注入。" },
    ],
    "agent-admin": [
      { title: "后端数量", text: `${state.backends.length} 个 Agent Server backend` },
      { title: "当前后端", text: activeBackend()?.name || "未配置后端" },
    ],
    "servers-system": [
      { title: "服务端口", text: `${state.settings?.server?.host || "localhost"}:${state.settings?.server?.port || "7788"}` },
      { title: "版本", text: state.settings?.version || "0.1.0-dev" },
    ],
    about: [
      { title: "CodeHarbor", text: "Local-first Go AI coding agent server MVP." },
      { title: "License", text: "MIT License；第三方依赖请查看 THIRD_PARTY_NOTICES.md。" },
    ],
  };
  return base[key] || [
    { title: "页面已预留", text: "该设置项已加入导航，具体配置表单将在后续版本补齐。" },
    { title: "下一步", text: "可根据实际后端能力继续接入 API、验证和保存逻辑。" },
  ];
}

function renderModelOptions() {
  const select = $("modelSelect");
  const providers = state.settings?.providers || [];
  const options = providers.map((provider) => {
    const value = `${provider.name}:${provider.model}`;
    return {
      value,
      configured: Boolean(provider.configured),
      label: `${value}${provider.configured ? "" : "（未配置）"}`,
    };
  });
  if (state.narrator?.model && !options.some((option) => option.value === state.narrator.model)) {
    options.unshift({ value: state.narrator.model, configured: false, label: `${state.narrator.model}（未配置）` });
  }
  select.innerHTML = options.map((option) => `<option value="${escapeAttr(option.value)}" data-configured="${option.configured ? "true" : "false"}">${escapeHtml(option.label)}</option>`).join("");
  if (state.narrator?.model) {
    select.value = state.narrator.model;
  }
  updateModelConfiguredState();
}

function currentProviderConfig(modelValue = $("modelSelect")?.value || state.narrator?.model || "") {
  const [providerName] = String(modelValue || "").split(":");
  return (state.settings?.providers || []).find((provider) => provider.name === providerName) || null;
}

function isCurrentModelConfigured(modelValue = $("modelSelect")?.value || state.narrator?.model || "") {
  return Boolean(currentProviderConfig(modelValue)?.configured);
}

function updateModelConfiguredState() {
  const select = $("modelSelect");
  if (!select) return;
  const configured = isCurrentModelConfigured(select.value);
  select.classList.toggle("model-unconfigured", !configured);
  select.title = configured ? "模型已配置，可以对话" : modelSetupMessage(select.value);
}

function modelSetupMessage(modelValue = $("modelSelect")?.value || state.narrator?.model || "") {
  const provider = currentProviderConfig(modelValue);
  const providerName = provider?.name || String(modelValue || "openai").split(":")[0] || "openai";
  const envByProvider = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    cliproxyapi: "CLIPROXYAPI_API_KEY（仅当 CLIProxyAPI 配置了 api-keys 时需要）",
    "openai-compatible": "OPENAI_COMPATIBLE_API_KEY 或 OPENAI_API_KEY",
  };
  const envName = envByProvider[providerName] || "对应 provider 的 API key 环境变量";
  return `当前模型 ${modelValue || "未选择"} 尚未配置 API Key。请在启动 CodeHarbor 前设置 ${envName}，然后重启服务。`;
}

async function loadProjects() {
  const projects = await api("/api/projects");
  state.projects = Array.isArray(projects) ? projects : [];
  renderProjects();
}

function renderProjects() {
  const el = $("projects");
  const query = state.projectQuery.trim().toLowerCase();
  const projects = state.projects.filter((project) => {
    if (!query) return true;
    return `${project.name} ${project.gitPath || ""}`.toLowerCase().includes(query);
  });
  renderRecentSidebarDirectories();
  if (!state.projects.length) {
    el.innerHTML = `<button class="project-card" type="button" id="emptyProjectHint"><div class="project-name">选择一个目录开始</div><div class="project-path">点击上方 +</div></button>`;
    $("emptyProjectHint").addEventListener("click", () => openDirectoryModal().catch(showError));
    return;
  }
  if (!projects.length) {
    el.innerHTML = `<div class="empty-list">没有符合搜索的项目。</div>`;
    return;
  }
  el.innerHTML = projects.map((project) => `
    <button class="project-card ${state.project?.id === project.id ? "active" : ""}" type="button" data-project-id="${escapeAttr(project.id)}">
      <div class="project-name">${escapeHtml(project.name)}</div>
      <div class="project-path">${escapeHtml(project.gitPath || project.id)}</div>
    </button>
  `).join("");
  el.querySelectorAll("[data-project-id]").forEach((node) => {
    node.addEventListener("click", () => selectProject(node.dataset.projectId).catch(showError));
  });
}

async function createProjectFromDirectory(path) {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const existing = projects.find((project) => project.gitPath === path);
  rememberDirectory(path);
  if (existing) {
    closeDirectoryModal();
    await selectProject(existing.id);
    return;
  }
  const name = basename(path) || "Project";
  const created = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, gitPath: path }),
  });
  closeDirectoryModal();
  await loadProjects();
  state.project = created.project;
  state.chapter = created.chapter;
  state.narrator = created.narrator;
  renderProjects();
  await enterNarrator();
  appendTerminal(`Created project: ${created.project.name}\nPath: ${created.project.gitPath}\n`);
}

async function selectProject(id) {
  closeMobileSidebar();
  state.project = state.projects.find((project) => project.id === id) || null;
  renderProjects();
  if (!state.project) return;
  const chapters = await api(`/api/projects/${id}/chapters`);
  state.chapter = chapters[0] || null;
  if (!state.chapter) return;
  const narrators = await api(`/api/chapters/${state.chapter.id}/narrators`);
  state.narrator = narrators.find((narrator) => narrator.type === "primary") || narrators[0] || null;
  await enterNarrator();
}

async function enterNarrator() {
  if (!state.narrator) return;
  $("currentTitle").textContent = state.project?.name || state.narrator.title;
  $("currentMeta").textContent = `${state.narrator.cwd || state.project?.gitPath || "No directory"} · ${state.narrator.permissionMode}`;
  $("permissionMode").value = state.narrator.permissionMode || "acceptEdits";
  renderModelOptions();
  connectWS();
  connectTerminal();
  await loadMessages();
}

async function loadMessages() {
  if (!state.narrator) return;
  const messages = await api(`/api/narrators/${state.narrator.id}/messages`);
  const el = $("messages");
  if (!messages.length) {
    el.classList.add("empty");
    el.textContent = "还没有消息。输入你的需求开始对话。";
    return;
  }
  el.classList.remove("empty");
  el.innerHTML = messages.map((message) => `
    <div class="message ${escapeAttr(message.role)}">
      <div class="message-role">${escapeHtml(message.role)}</div>
      <div class="message-content">${renderMarkdown(friendlyMessageText(message.contentText || ""))}</div>
    </div>
  `).join("");
  bindCopyCodeButtons(el);
  el.scrollTop = el.scrollHeight;
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.narrator) {
    await openDirectoryModal();
    return;
  }
  const text = $("messageText").value.trim();
  if (!text) return;
  if (!isCurrentModelConfigured()) {
    showModelSetupNotice();
    return;
  }
  $("messageText").value = "";
  autoResizeMessageInput();
  await api(`/api/narrators/${state.narrator.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  await loadMessages();
  setTimeout(() => loadMessages().catch(console.error), 1200);
}

function showModelSetupNotice() {
  const el = $("messages");
  el.classList.remove("empty");
  el.innerHTML = `
    <div class="setup-notice-card">
      <div class="setup-notice-title">当前模型尚未配置 API Key</div>
      <p>${escapeHtml(modelSetupMessage())}</p>
      <div class="setup-notice-actions">
        <button class="ghost-btn mini" type="button" id="openModelSettingsNoticeBtn">打开模型设置</button>
        <button class="ghost-btn mini" type="button" id="openProviderSettingsNoticeBtn">打开提供商设置</button>
      </div>
    </div>
  `;
  $("openModelSettingsNoticeBtn").addEventListener("click", () => openSettingsModal("models"));
  $("openProviderSettingsNoticeBtn").addEventListener("click", () => openSettingsModal("providers"));
}

function connectWS() {
  if (!state.narrator) return;
  if (state.ws) state.ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${proto}://${location.host}/ws/narrator?id=${state.narrator.id}`);
  state.ws.onopen = () => {
    $("wsBadge").textContent = "ws connected";
    $("wsBadge").classList.add("ok");
  };
  state.ws.onclose = () => {
    $("wsBadge").textContent = "ws closed";
    $("wsBadge").classList.remove("ok");
  };
  state.ws.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
      if (event.type === "message.created" || event.type === "agent.done") {
        loadMessages().catch(console.error);
      }
    } catch {
      appendTerminal(`[event] ${message.data}\n`);
    }
  };
}

async function saveNarratorSettings() {
  if (!state.narrator) return;
  const id = state.narrator.id;
  const model = $("modelSelect").value.trim();
  const permissionMode = $("permissionMode").value;
  if (model && model !== state.narrator.model) {
    state.narrator = await api(`/api/narrators/${id}/model`, { method: "PATCH", body: JSON.stringify({ model }) });
  }
  if (permissionMode && permissionMode !== state.narrator.permissionMode) {
    state.narrator = await api(`/api/narrators/${id}/permission-mode`, { method: "PATCH", body: JSON.stringify({ permissionMode }) });
  }
  await enterNarrator();
  appendTerminal(`Saved settings: ${state.narrator.model}, ${state.narrator.permissionMode}\n`);
}

function connectTerminal() {
  if (!state.narrator) return;
  if (state.terminalWS) state.terminalWS.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const output = $("terminalOutput");
  output.textContent = "Connecting terminal...\n";
  setTerminalStatus("connecting");
  state.terminalWS = new WebSocket(`${proto}://${location.host}/ws/terminal?narratorId=${state.narrator.id}`);
  state.terminalWS.onopen = () => {
    setTerminalStatus("connected");
    resizeTerminal();
    output.focus();
  };
  state.terminalWS.onclose = () => setTerminalStatus("closed");
  state.terminalWS.onerror = () => setTerminalStatus("error");
  state.terminalWS.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "output") appendTerminal(cleanTerminalOutput(event.data || ""));
      if (event.type === "error") appendTerminal(`\n[terminal error] ${event.data || "unknown error"}\n`);
    } catch {
      appendTerminal(message.data);
    }
  };
}

function setTerminalStatus(text) {
  $("terminalStatus").textContent = `terminal ${text}`;
}

function sendTerminalInput(data) {
  if (!state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
  state.terminalWS.send(JSON.stringify({ type: "input", data }));
}

function resizeTerminal() {
  if (!state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
  const output = $("terminalOutput");
  const cols = Math.max(40, Math.floor(output.clientWidth / 8));
  const rows = Math.max(10, Math.floor(output.clientHeight / 18));
  state.terminalWS.send(JSON.stringify({ type: "resize", cols, rows }));
}

function handleTerminalKeydown(event) {
  if (!state.narrator) return;
  const keyMap = {
    Enter: "\r",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Delete: "\x1b[3~",
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
  };
  if (event.ctrlKey && event.key.length === 1) {
    event.preventDefault();
    sendTerminalInput(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
    return;
  }
  if (keyMap[event.key]) {
    event.preventDefault();
    sendTerminalInput(keyMap[event.key]);
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
    event.preventDefault();
    sendTerminalInput(event.key);
  }
}

function appendTerminal(text) {
  const output = $("terminalOutput");
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

function cleanTerminalOutput(text) {
  return String(text || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

function toggleTerminal(collapsed) {
  const shouldCollapse = collapsed ?? !$("appShell").classList.contains("terminal-collapsed");
  $("appShell").classList.toggle("terminal-collapsed", shouldCollapse);
  $("expandTerminalBtn").classList.toggle("hidden", !shouldCollapse);
  if (shouldCollapse) document.body.classList.remove("mobile-terminal-open");
}

async function openDirectoryModal(path = "") {
  $("folderModal").classList.remove("hidden");
  renderRecentModalDirectories();
  await browseDirectories(path);
}

function closeDirectoryModal() {
  $("folderModal").classList.add("hidden");
}

async function browseDirectories(path = "") {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const data = await api(`/api/fs/directories${query}`);
  state.directoryPath = data.path;
  state.directoryParent = data.parent || "";
  state.directoryShortcuts = data.shortcuts || [];
  $("directoryPath").textContent = data.path;
  $("manualDirectoryPath").value = data.path;
  renderDirectoryShortcuts(state.directoryShortcuts);
  renderDirectoryList(data);
}

function renderDirectoryShortcuts(shortcuts) {
  const iconByName = {
    Home: "⌂",
    Desktop: "▣",
    Downloads: "▾",
    Documents: "□",
    Projects: "▱",
    Root: "⌜",
  };
  $("directoryShortcuts").innerHTML = shortcuts.map((shortcut) => {
    const active = normalizePath(shortcut.path) === normalizePath(state.directoryPath);
    const label = shortcutLabel(shortcut.name);
    return `
      <button class="folder-shortcut ${active ? "active" : ""}" type="button" data-path="${escapeAttr(shortcut.path)}">
        <span class="folder-shortcut-icon">${escapeHtml(iconByName[shortcut.name] || "▱")}</span>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }).join("");
  $("directoryShortcuts").querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
}

function shortcutLabel(name) {
  return {
    Home: "主目录",
    Desktop: "桌面",
    Downloads: "下载",
    Documents: "文档",
    Projects: "项目",
    Root: "根目录",
  }[name] || name;
}

function getRecentDirectories() {
  try {
    return JSON.parse(localStorage.getItem(recentDirectoriesKey) || "[]").filter(Boolean);
  } catch {
    return [];
  }
}

function rememberDirectory(path) {
  const normalized = String(path || "").trim();
  if (!normalized) return;
  const next = [normalized, ...getRecentDirectories().filter((item) => item !== normalized)].slice(0, 8);
  localStorage.setItem(recentDirectoriesKey, JSON.stringify(next));
  renderRecentSidebarDirectories();
  renderRecentModalDirectories();
}

function renderRecentSidebarDirectories() {
  const el = $("recentSidebarDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((path) => `
    <button class="recent-item" type="button" data-path="${escapeAttr(path)}">
      <span>${escapeHtml(basename(path) || path)}</span>
      <small>${escapeHtml(path)}</small>
    </button>
  `).join("") : `<div class="empty-list">暂无最近目录</div>`;
  el.querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => createProjectFromDirectory(node.dataset.path).catch(showError));
  });
}

function renderRecentModalDirectories() {
  const el = $("recentModalDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((path) => `
    <button class="folder-shortcut" type="button" data-path="${escapeAttr(path)}">
      <span class="folder-shortcut-icon">☆</span>
      <span>${escapeHtml(basename(path) || path)}</span>
    </button>
  `).join("") : `<div class="folder-empty-note">暂无收藏</div>`;
  el.querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
}

function renderDirectoryList(data) {
  const rows = [];
  if (data.parent) {
    rows.push(`
      <button class="directory-row parent-row" type="button" data-path="${escapeAttr(data.parent)}">
        <span class="directory-row-main"><span class="directory-icon">↰</span><span>上一级</span></span>
        <span class="directory-meta">..</span>
      </button>
    `);
  }
  rows.push(...(data.entries || []).map((entry) => `
    <button class="directory-row" type="button" data-path="${escapeAttr(entry.path)}">
      <span class="directory-row-main"><span class="directory-icon">▱</span><span>${escapeHtml(entry.name)}</span></span>
      <span class="directory-meta">文件夹</span>
    </button>
  `));
  $("directoryList").innerHTML = rows.join("") || `<div class="folder-empty-state">此目录下没有可进入的文件夹。</div>`;
  $("directoryList").querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
}

function friendlyMessageText(text) {
  const value = String(text || "");
  if (value.includes("OpenAI official provider is not configured")) {
    return "当前 OpenAI 模型尚未配置 API Key。请在启动 CodeHarbor 前设置 `OPENAI_API_KEY`，然后重启服务；或在下方模型菜单选择已配置的模型。";
  }
  if (value.includes("Anthropic provider is not configured")) {
    return "当前 Anthropic 模型尚未配置 API Key。请在启动 CodeHarbor 前设置 `ANTHROPIC_API_KEY`，然后重启服务；或在下方模型菜单选择已配置的模型。";
  }
  if (value.includes("OpenAI-compatible provider is not configured")) {
    return "当前 OpenAI-compatible 模型尚未配置 API Key。请设置 `OPENAI_COMPATIBLE_API_KEY` 或 `OPENAI_API_KEY`，并确认 Base URL 后重启服务。";
  }
  if (value.includes("cliproxyapi provider request failed") && value.includes("127.0.0.1:8317")) {
    return "无法连接本地 CLIProxyAPI。请先启动 CLIProxyAPI，并确认它监听 `http://127.0.0.1:8317/v1`；如果你改过端口，请设置 `CLIPROXYAPI_BASE_URL` 后重启 CodeHarbor。";
  }
  if (value.includes("cliproxyapi model request failed: 401")) {
    return "CLIProxyAPI 返回 401。请确认 CLIProxyAPI 的 `api-keys` 配置；如启用了客户端鉴权，请在启动 CodeHarbor 前设置 `CLIPROXYAPI_API_KEY`。";
  }
  return value;
}

function renderMarkdown(text) {
  const blocks = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) blocks.push(renderMarkdownText(text.slice(lastIndex, match.index)));
    const lang = (match[1] || "text").trim() || "text";
    const code = match[2] || "";
    blocks.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span><button class="copy-code" type="button" data-code="${escapeAttr(code)}">复制</button></div><pre><code>${highlightCode(code, lang)}</code></pre></div>`);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) blocks.push(renderMarkdownText(text.slice(lastIndex)));
  return blocks.join("");
}

function renderMarkdownText(text) {
  const lines = String(text || "").split(/\n+/).filter((line) => line.trim() !== "");
  if (!lines.length) return "";
  const html = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      html.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
    } else {
      flushList();
      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }
  }
  flushList();
  return html.join("");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code class=\"inline-code\">$1</code>");
}

function highlightCode(code, lang) {
  const tokens = [];
  const hold = (html) => {
    const key = `__TOK_${tokens.length}__`;
    tokens.push(html);
    return key;
  };
  let html = escapeHtml(code);
  html = html.replace(/("[^"\n]*"|'[^'\n]*')/g, (value) => hold(`<span class="tok-string">${value}</span>`));
  html = html.replace(/(\/\/.*|#.*)$/gm, (value) => hold(`<span class="tok-comment">${value}</span>`));
  const keywordSet = "const|let|var|function|return|if|else|for|while|switch|case|break|class|type|struct|func|package|import|from|export|async|await|try|catch|defer|go|select|range";
  html = html.replace(new RegExp(`\\b(${keywordSet})\\b`, "g"), '<span class="tok-keyword">$1</span>');
  return html.replace(/__TOK_(\d+)__/g, (_, index) => tokens[Number(index)] || "");
}

function bindCopyCodeButtons(root) {
  root.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.code || "");
      const original = button.textContent;
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = original; }, 1000);
    });
  });
}

function autoResizeMessageInput() {
  const input = $("messageText");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function handleMessageKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  $("messageForm").requestSubmit();
}

function openMobileSidebar() {
  document.body.classList.add("mobile-sidebar-open");
}

function closeMobileSidebar() {
  document.body.classList.remove("mobile-sidebar-open");
}

function toggleMobileTerminal() {
  document.body.classList.toggle("mobile-terminal-open");
  if (document.body.classList.contains("mobile-terminal-open")) {
    $("terminalOutput").focus();
    resizeTerminal();
  }
}

function focusMobileSearch() {
  openMobileSidebar();
  setTimeout(() => $("projectSearch").focus(), 160);
}

function normalizePath(path) {
  return String(path || "").replace(/\/+$/, "") || "/";
}

function homeShortcutPath() {
  const home = state.directoryShortcuts.find((shortcut) => shortcut.name === "Home");
  return home?.path || "";
}

async function browseHomeDirectory() {
  await browseDirectories(homeShortcutPath());
}

async function browseParentDirectory() {
  if (!state.directoryParent) return;
  await browseDirectories(state.directoryParent);
}

async function refreshDirectory() {
  await browseDirectories(state.directoryPath);
}

async function createFolderInCurrentDirectory() {
  const name = prompt("新建文件夹名称");
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (trimmed.includes("/")) {
    throw new Error("文件夹名称不能包含 /");
  }
  const base = normalizePath(state.directoryPath);
  const path = base === "/" ? `/${trimmed}` : `${base}/${trimmed}`;
  await api("/api/fs/mkdir", { method: "POST", body: JSON.stringify({ path }) });
  await browseDirectories(path);
}

function favoriteCurrentDirectory() {
  if (!state.directoryPath) return;
  rememberDirectory(state.directoryPath);
}

function basename(path) {
  return String(path || "").replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
}

function showError(err) {
  alert(err.message || String(err));
  appendTerminal(`[error] ${err.message || String(err)}\n`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }

$("refreshBtn").addEventListener("click", () => init().catch(showError));
$("settingsBtn").addEventListener("click", () => openSettingsModal("profile"));
$("closeSettingsModalBtn").addEventListener("click", closeSettingsModal);
$("settingsModal").addEventListener("click", (event) => { if (event.target.id === "settingsModal") closeSettingsModal(); });
$("settingsWizardBtn").addEventListener("click", () => {
  closeSettingsModal();
  openDirectoryModal().catch(showError);
});
$("manageBackendsBtn").addEventListener("click", openBackendsModal);
$("closeBackendsModalBtn").addEventListener("click", closeBackendsModal);
$("backendsModal").addEventListener("click", (event) => { if (event.target.id === "backendsModal") closeBackendsModal(); });
$("backendForm").addEventListener("submit", (event) => saveBackend(event).catch(showError));
$("resetBackendFormBtn").addEventListener("click", resetBackendForm);
$("mobileMenuBtn").addEventListener("click", openMobileSidebar);
$("mobileSidebarBackdrop").addEventListener("click", closeMobileSidebar);
$("mobileTerminalBtn").addEventListener("click", toggleMobileTerminal);
$("mobileSearchBtn").addEventListener("click", focusMobileSearch);
$("newProjectBtn").addEventListener("click", () => openDirectoryModal().catch(showError));
$("projectSearch").addEventListener("input", (event) => { state.projectQuery = event.target.value; renderProjects(); });
$("openFolderBtn").addEventListener("click", () => openDirectoryModal(state.narrator?.cwd || state.project?.gitPath || "").catch(showError));
$("closeFolderModalBtn").addEventListener("click", closeDirectoryModal);
$("cancelDirectoryBtn").addEventListener("click", closeDirectoryModal);
$("folderModal").addEventListener("click", (event) => { if (event.target.id === "folderModal") closeDirectoryModal(); });
$("folderHomeBtn").addEventListener("click", () => browseHomeDirectory().catch(showError));
$("folderParentBtn").addEventListener("click", () => browseParentDirectory().catch(showError));
$("folderRefreshBtn").addEventListener("click", () => refreshDirectory().catch(showError));
$("newFolderBtn").addEventListener("click", () => createFolderInCurrentDirectory().catch(showError));
$("favoriteDirectoryBtn").addEventListener("click", favoriteCurrentDirectory);
$("toggleHiddenFoldersBtn").addEventListener("click", () => appendTerminal("[info] 隐藏文件夹当前不显示。\n"));
$("goDirectoryBtn").addEventListener("click", () => browseDirectories($("manualDirectoryPath").value.trim()).catch(showError));
$("manualDirectoryPath").addEventListener("keydown", (event) => {
  if (event.key === "Enter") browseDirectories($("manualDirectoryPath").value.trim()).catch(showError);
});
$("chooseDirectoryBtn").addEventListener("click", () => createProjectFromDirectory(state.directoryPath).catch(showError));
$("messageForm").addEventListener("submit", (event) => sendMessage(event).catch(showError));
$("messageText").addEventListener("input", autoResizeMessageInput);
$("messageText").addEventListener("keydown", handleMessageKeydown);
$("terminalOutput").addEventListener("keydown", handleTerminalKeydown);
$("terminalOutput").addEventListener("click", () => $("terminalOutput").focus());
$("terminalOutput").addEventListener("paste", (event) => {
  event.preventDefault();
  sendTerminalInput(event.clipboardData?.getData("text") || "");
});
$("reconnectTerminalBtn").addEventListener("click", connectTerminal);
window.addEventListener("resize", resizeTerminal);
$("saveNarratorBtn").addEventListener("click", () => saveNarratorSettings().catch(showError));
$("modelSelect").addEventListener("change", () => {
  updateModelConfiguredState();
  saveNarratorSettings().catch(showError);
});
$("permissionMode").addEventListener("change", () => saveNarratorSettings().catch(showError));
$("toggleTerminalBtn").addEventListener("click", () => toggleTerminal());
$("collapseTerminalBtn").addEventListener("click", () => toggleTerminal(true));
$("expandTerminalBtn").addEventListener("click", () => toggleTerminal(false));

async function init() {
  autoResizeMessageInput();
  renderRecentSidebarDirectories();
  await loadHealth();
  await Promise.all([loadSettings(), loadProjects(), loadBackends()]);
  if (!state.narrator && state.projects.length) {
    await selectProject(state.projects[0].id);
  }
}

init().catch(showError);
