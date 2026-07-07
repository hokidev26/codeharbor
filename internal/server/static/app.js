const state = {
  projects: [],
  projectsLoadSeq: 0,
  project: null,
  chapter: null,
  narrator: null,
  healthSeq: 0,
  settings: null,
  settingsLoadSeq: 0,
  modelCatalog: null,
  modelCatalogSeq: 0,
  providerAuthFiles: null,
  providerAuthError: "",
  providerAuthSeq: 0,
  providerConfigStatus: "",
  providerConfigExpanded: {},
  storageSummary: null,
  storageError: "",
  storageSeq: 0,
  licenseSummary: null,
  licenseError: "",
  licenseSeq: 0,
  usageSummary: null,
  usageError: "",
  usageSeq: 0,
  runtimeSummary: null,
  runtimeError: "",
  runtimeSeq: 0,
  authStatus: null,
  authError: "",
  authSeq: 0,
  profile: null,
  searchPrefs: null,
  imGatewayPrefs: null,
  skillsPrefs: null,
  activeSkillTab: "commands",
  notifications: null,
  appearance: null,
  terminalPrefs: null,
  chatDrafts: null,
  pendingAttachments: [],
  promptHistory: null,
  promptHistoryIndex: -1,
  promptHistoryDraft: "",
  slashCommandOpen: false,
  slashCommandIndex: 0,
  slashCommandQuery: "",
  terminalStatus: "idle",
  agentRefreshing: false,
  narratorSaving: false,
  narratorSavePending: false,
  messageSendingByNarrator: {},
  messageRefreshTimersByNarrator: {},
  currentMessages: [],
  messageCopyTexts: [],
  pendingToolApprovals: {},
  modelRefreshing: false,
  modelApplying: false,
  modelApplySeq: 0,
  projectCreating: false,
  projectCreateSeq: 0,
  projectSelectSeq: 0,
  initializing: false,
  initSeq: 0,
  settingsWarmupStarted: false,
  activeSettingsPanel: "profile",
  settingsSearchQuery: "",
  backendDeleteConfirmId: "",
  backends: [],
  backendHealth: null,
  backendLoadSeq: 0,
  backendHealthSeq: 0,
  backendActionBusy: {},
  projectChapters: [],
  chapterNarrators: [],
  chaptersError: "",
  chaptersSeq: 0,
  directoryPath: "",
  directoryParent: "",
  directoryShortcuts: [],
  directoryBrowseSeq: 0,
  nativeDirectorySelecting: false,
  projectQuery: "",
  ws: null,
  terminalWS: null,
};

const recentDirectoriesKey = "codeharbor.recentDirectories";
const preferredModelKey = "codeharbor.preferredModel";
const modelVisibilityPrefsKey = "codeharbor.modelVisibility";
const profilePrefsKey = "codeharbor.profile";
const searchPrefsKey = "codeharbor.search";
const imGatewayPrefsKey = "codeharbor.imGateway";
const skillsPrefsKey = "codeharbor.skills";
const notificationPrefsKey = "codeharbor.notifications";
const appearancePrefsKey = "codeharbor.appearance";
const terminalPrefsKey = "codeharbor.terminal";
const chatDraftsKey = "codeharbor.chatDrafts";
const promptHistoryKey = "codeharbor.promptHistory";
const relayProtocolPrefsKey = "codeharbor.relayProtocol";
const localPreferenceBackupKind = "codeharbor.local-preferences";
const localPreferenceBackupVersion = 1;
const localPreferenceBackupKeys = [
  { key: profilePrefsKey, label: "个人资料", type: "json" },
  { key: searchPrefsKey, label: "网络搜索", type: "json" },
  { key: imGatewayPrefsKey, label: "IM 网关", type: "json" },
  { key: skillsPrefsKey, label: "技能工作台", type: "json" },
  { key: notificationPrefsKey, label: "通知", type: "json" },
  { key: appearancePrefsKey, label: "外观", type: "json" },
  { key: terminalPrefsKey, label: "终端", type: "json" },
  { key: chatDraftsKey, label: "聊天草稿", type: "json" },
  { key: promptHistoryKey, label: "提示词历史", type: "json" },
  { key: recentDirectoriesKey, label: "最近目录", type: "json" },
  { key: preferredModelKey, label: "首选模型", type: "string" },
  { key: relayProtocolPrefsKey, label: "中转协议", type: "string" },
];
const defaultProfilePrefs = {
  displayName: "",
  roleLabel: "Local developer",
  avatarInitials: "CH",
  gitName: "",
  gitEmail: "",
  workspaceLabel: "CodeHarbor Local",
};
const defaultSearchPrefs = {
  enabled: false,
  provider: "duckduckgo",
  maxResults: 5,
  safeSearch: true,
  confirmBeforeSearch: true,
  preferGitHub: true,
  allowedDomains: "",
  blockedDomains: "",
  customEndpoint: "",
};
const defaultIMGatewayPrefs = {
  enabled: false,
  channel: "webhook",
  inboundConfirm: true,
  requireSignature: true,
  redactSecrets: true,
  allowInboundMessages: true,
  notifyOnTaskDone: true,
  notifyOnErrors: true,
  notifyOnToolCalls: false,
  maxPayloadKB: 64,
  endpointUrl: "",
  allowedOrigins: "",
  blockedSenders: "",
};
const defaultSkillsPrefs = {
  commands: [
    {
      id: "review-diff",
      name: "/review-diff",
      description: "审查当前工作区改动并给出风险提示。",
      prompt: "请审查当前工作区变更，重点关注正确性、测试覆盖、安全风险和用户可见行为。",
      enabled: true,
    },
    {
      id: "write-tests",
      name: "/write-tests",
      description: "为当前改动补充必要测试。",
      prompt: "请根据当前改动补充最小必要测试，并说明测试覆盖的行为。",
      enabled: true,
    },
  ],
  mcpServers: [],
  toolPolicy: {
    requireConfirmationForExec: true,
    requireConfirmationForWrites: false,
    allowReadOnlyByDefault: true,
    preferPlanForLargeTasks: true,
  },
};
const defaultNotificationPrefs = {
  toastEnabled: true,
  infoToasts: true,
  successToasts: true,
  warningToasts: true,
  errorToasts: true,
  terminalNotices: true,
  duration: "normal",
};
const defaultAppearancePrefs = {
  theme: "dark",
  density: "comfortable",
  terminalDefaultOpen: false,
  showEventLog: true,
};
const defaultTerminalPrefs = {
  clearOnReconnect: true,
  focusOnConnect: true,
  maxLines: 5000,
};

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
  const headers = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(path, {
    ...options,
    headers,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const fallback = `${res.status} ${res.statusText}`;
    const message = typeof body === "string" ? body : (body?.error || body?.message || fallback);
    throw new Error(message);
  }
  return body ?? {};
}

function loadProfilePreferences() {
  try {
    return normalizeProfilePreferences(JSON.parse(localStorage.getItem(profilePrefsKey) || "{}"));
  } catch {
    return normalizeProfilePreferences({});
  }
}

function normalizeProfilePreferences(value = {}) {
  const displayName = String(value.displayName || "").trim().slice(0, 80);
  const roleLabel = String(value.roleLabel || defaultProfilePrefs.roleLabel).trim().slice(0, 80) || defaultProfilePrefs.roleLabel;
  const avatarInitials = String(value.avatarInitials || defaultProfilePrefs.avatarInitials).trim().slice(0, 4).toUpperCase() || defaultProfilePrefs.avatarInitials;
  const gitName = String(value.gitName || "").trim().slice(0, 120);
  const gitEmail = String(value.gitEmail || "").trim().slice(0, 160);
  const workspaceLabel = String(value.workspaceLabel || defaultProfilePrefs.workspaceLabel).trim().slice(0, 80) || defaultProfilePrefs.workspaceLabel;
  return { displayName, roleLabel, avatarInitials, gitName, gitEmail, workspaceLabel };
}

function currentProfilePreferences() {
  if (!state.profile) state.profile = loadProfilePreferences();
  return state.profile;
}

function saveProfilePreferences(next, { notify = false } = {}) {
  state.profile = normalizeProfilePreferences(next);
  try {
    localStorage.setItem(profilePrefsKey, JSON.stringify(state.profile));
  } catch {}
  applyProfilePreferences();
  if (state.activeSettingsPanel === "profile") refreshActiveSettingsPanel();
  if (notify) showToast("个人资料已保存。", "success", { force: true });
}

function resetProfilePreferences() {
  saveProfilePreferences({ ...defaultProfilePrefs }, { notify: true });
}

function applyProfilePreferences() {
  const profile = currentProfilePreferences();
  document.title = profile.workspaceLabel && profile.workspaceLabel !== "CodeHarbor Local"
    ? `${profile.workspaceLabel} · CodeHarbor`
    : "CodeHarbor";
  const displayName = profileDisplayName();
  const avatar = $("sidebarAvatar");
  const accountName = $("sidebarAccountName");
  const menuName = $("sidebarMenuProfileName");
  const menuMeta = $("sidebarMenuProfileMeta");
  if (avatar) avatar.textContent = profile.avatarInitials;
  if (accountName) accountName.textContent = displayName;
  if (menuName) menuName.textContent = displayName;
  if (menuMeta) menuMeta.textContent = profile.roleLabel || "本地工作台";
  updateSidebarAccountSummary();
}

function profileDisplayName() {
  const profile = currentProfilePreferences();
  return profile.displayName || profile.workspaceLabel || "CodeHarbor User";
}

function updateSidebarAccountSummary() {
  const version = String(state.settings?.version || "0.1.0-dev").replace(/^v/i, "");
  const backend = activeBackend();
  const meta = $("sidebarAccountMeta");
  if (meta) meta.textContent = `v${version} · ${backend?.name || "本地"}`;
  const mobileVersionChip = $("mobileVersionChip");
  if (mobileVersionChip) mobileVersionChip.textContent = `更新: v${version} → …`;
}

function profileGitEnvExample(profile = currentProfilePreferences()) {
  const rows = [];
  if (profile.gitName) rows.push(`git config --global user.name "${profile.gitName.replace(/"/g, "\\\"")}"`);
  if (profile.gitEmail) rows.push(`git config --global user.email "${profile.gitEmail.replace(/"/g, "\\\"")}"`);
  return rows.join("\n") || "# 尚未填写 Git 姓名或邮箱";
}

function loadSearchPreferences() {
  try {
    return normalizeSearchPreferences(JSON.parse(localStorage.getItem(searchPrefsKey) || "{}"));
  } catch {
    return normalizeSearchPreferences({});
  }
}

function normalizeSearchPreferences(value = {}) {
  const provider = ["duckduckgo", "brave", "tavily", "searxng", "custom"].includes(value.provider)
    ? value.provider
    : defaultSearchPrefs.provider;
  const maxResults = Number(value.maxResults || defaultSearchPrefs.maxResults);
  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : defaultSearchPrefs.enabled,
    provider,
    maxResults: [3, 5, 10, 20].includes(maxResults) ? maxResults : defaultSearchPrefs.maxResults,
    safeSearch: value.safeSearch !== undefined ? Boolean(value.safeSearch) : defaultSearchPrefs.safeSearch,
    confirmBeforeSearch: value.confirmBeforeSearch !== undefined ? Boolean(value.confirmBeforeSearch) : defaultSearchPrefs.confirmBeforeSearch,
    preferGitHub: value.preferGitHub !== undefined ? Boolean(value.preferGitHub) : defaultSearchPrefs.preferGitHub,
    allowedDomains: normalizeDomainList(value.allowedDomains || ""),
    blockedDomains: normalizeDomainList(value.blockedDomains || ""),
    customEndpoint: String(value.customEndpoint || "").trim().slice(0, 300),
  };
}

function normalizeDomainList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean)
    .slice(0, 30)
    .join("\n");
}

function currentSearchPreferences() {
  if (!state.searchPrefs) state.searchPrefs = loadSearchPreferences();
  return state.searchPrefs;
}

function saveSearchPreferences(next, { notify = false } = {}) {
  state.searchPrefs = normalizeSearchPreferences(next);
  try {
    localStorage.setItem(searchPrefsKey, JSON.stringify(state.searchPrefs));
  } catch {}
  if (state.activeSettingsPanel === "network-search") refreshActiveSettingsPanel();
  if (notify) showToast("网络搜索策略已保存。", "success", { force: true });
}

function resetSearchPreferences() {
  saveSearchPreferences({ ...defaultSearchPrefs }, { notify: true });
}

function searchProviderLabel(provider) {
  return {
    duckduckgo: "DuckDuckGo",
    brave: "Brave Search",
    tavily: "Tavily",
    searxng: "SearXNG",
    custom: "自定义端点",
  }[provider] || provider || "未选择";
}

function searchPrefsExport() {
  return JSON.stringify(currentSearchPreferences(), null, 2);
}

function localSkillID(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadSkillsPreferences() {
  try {
    return normalizeSkillsPreferences(JSON.parse(localStorage.getItem(skillsPrefsKey) || "{}"));
  } catch {
    return normalizeSkillsPreferences({});
  }
}

function normalizeSkillsPreferences(value = {}) {
  const commands = Array.isArray(value.commands) ? value.commands : defaultSkillsPrefs.commands;
  const mcpServers = Array.isArray(value.mcpServers) ? value.mcpServers : defaultSkillsPrefs.mcpServers;
  const policy = value.toolPolicy || {};
  return {
    commands: commands.map(normalizeSkillCommand).filter((item) => item.name && item.prompt).slice(0, 50),
    mcpServers: mcpServers.map(normalizeMCPServer).filter((item) => item.name || item.command).slice(0, 30),
    toolPolicy: {
      requireConfirmationForExec: policy.requireConfirmationForExec !== undefined ? Boolean(policy.requireConfirmationForExec) : defaultSkillsPrefs.toolPolicy.requireConfirmationForExec,
      requireConfirmationForWrites: policy.requireConfirmationForWrites !== undefined ? Boolean(policy.requireConfirmationForWrites) : defaultSkillsPrefs.toolPolicy.requireConfirmationForWrites,
      allowReadOnlyByDefault: policy.allowReadOnlyByDefault !== undefined ? Boolean(policy.allowReadOnlyByDefault) : defaultSkillsPrefs.toolPolicy.allowReadOnlyByDefault,
      preferPlanForLargeTasks: policy.preferPlanForLargeTasks !== undefined ? Boolean(policy.preferPlanForLargeTasks) : defaultSkillsPrefs.toolPolicy.preferPlanForLargeTasks,
    },
  };
}

function normalizeSkillCommand(command = {}) {
  const rawName = String(command.name || "").trim();
  const name = rawName ? (rawName.startsWith("/") ? rawName : `/${rawName}`) : "";
  return {
    id: String(command.id || localSkillID("cmd")),
    name: name.slice(0, 40),
    description: String(command.description || "").trim().slice(0, 160),
    prompt: String(command.prompt || "").trim().slice(0, 4000),
    enabled: command.enabled !== undefined ? Boolean(command.enabled) : true,
  };
}

function normalizeMCPServer(server = {}) {
  return {
    id: String(server.id || localSkillID("mcp")),
    name: String(server.name || "").trim().slice(0, 80),
    command: String(server.command || "").trim().slice(0, 500),
    transport: ["stdio", "sse", "http"].includes(server.transport) ? server.transport : "stdio",
    enabled: server.enabled !== undefined ? Boolean(server.enabled) : false,
  };
}

function currentSkillsPreferences() {
  if (!state.skillsPrefs) state.skillsPrefs = loadSkillsPreferences();
  return state.skillsPrefs;
}

function saveSkillsPreferences(next, { notify = false } = {}) {
  state.skillsPrefs = normalizeSkillsPreferences(next);
  try {
    localStorage.setItem(skillsPrefsKey, JSON.stringify(state.skillsPrefs));
  } catch {}
  if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  updatePromptHistoryHint();
  updateSlashCommandPalette();
  if (notify) showToast("技能工作台已保存。", "success", { force: true });
}

function resetSkillsPreferences() {
  saveSkillsPreferences({ ...defaultSkillsPrefs }, { notify: true });
}

function skillsPrefsExport() {
  return JSON.stringify(currentSkillsPreferences(), null, 2);
}

function loadIMGatewayPreferences() {
  try {
    return normalizeIMGatewayPreferences(JSON.parse(localStorage.getItem(imGatewayPrefsKey) || "{}"));
  } catch {
    return normalizeIMGatewayPreferences({});
  }
}

function normalizeIMGatewayPreferences(value = {}) {
  const channel = ["webhook", "discord", "slack", "telegram", "lark", "wecom", "custom"].includes(value.channel)
    ? value.channel
    : defaultIMGatewayPrefs.channel;
  const maxPayloadKB = Number(value.maxPayloadKB || defaultIMGatewayPrefs.maxPayloadKB);
  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : defaultIMGatewayPrefs.enabled,
    channel,
    inboundConfirm: value.inboundConfirm !== undefined ? Boolean(value.inboundConfirm) : defaultIMGatewayPrefs.inboundConfirm,
    requireSignature: value.requireSignature !== undefined ? Boolean(value.requireSignature) : defaultIMGatewayPrefs.requireSignature,
    redactSecrets: value.redactSecrets !== undefined ? Boolean(value.redactSecrets) : defaultIMGatewayPrefs.redactSecrets,
    allowInboundMessages: value.allowInboundMessages !== undefined ? Boolean(value.allowInboundMessages) : defaultIMGatewayPrefs.allowInboundMessages,
    notifyOnTaskDone: value.notifyOnTaskDone !== undefined ? Boolean(value.notifyOnTaskDone) : defaultIMGatewayPrefs.notifyOnTaskDone,
    notifyOnErrors: value.notifyOnErrors !== undefined ? Boolean(value.notifyOnErrors) : defaultIMGatewayPrefs.notifyOnErrors,
    notifyOnToolCalls: value.notifyOnToolCalls !== undefined ? Boolean(value.notifyOnToolCalls) : defaultIMGatewayPrefs.notifyOnToolCalls,
    maxPayloadKB: [32, 64, 128, 256].includes(maxPayloadKB) ? maxPayloadKB : defaultIMGatewayPrefs.maxPayloadKB,
    endpointUrl: String(value.endpointUrl || "").trim().slice(0, 400),
    allowedOrigins: normalizeLineList(value.allowedOrigins || "", 30),
    blockedSenders: normalizeLineList(value.blockedSenders || "", 50),
  };
}

function normalizeLineList(value, limit = 30) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("\n");
}

function currentIMGatewayPreferences() {
  if (!state.imGatewayPrefs) state.imGatewayPrefs = loadIMGatewayPreferences();
  return state.imGatewayPrefs;
}

function saveIMGatewayPreferences(next, { notify = false } = {}) {
  state.imGatewayPrefs = normalizeIMGatewayPreferences(next);
  try {
    localStorage.setItem(imGatewayPrefsKey, JSON.stringify(state.imGatewayPrefs));
  } catch {}
  if (state.activeSettingsPanel === "im-gateway") refreshActiveSettingsPanel();
  if (notify) showToast("IM 网关策略已保存。", "success", { force: true });
}

function resetIMGatewayPreferences() {
  saveIMGatewayPreferences({ ...defaultIMGatewayPrefs }, { notify: true });
}

function imGatewayChannelLabel(channel) {
  return {
    webhook: "通用 Webhook",
    discord: "Discord",
    slack: "Slack",
    telegram: "Telegram",
    lark: "飞书/Lark",
    wecom: "企业微信",
    custom: "自定义网关",
  }[channel] || channel || "未选择";
}

function imGatewayPrefsExport() {
  return JSON.stringify(currentIMGatewayPreferences(), null, 2);
}

function loadNotificationPreferences() {
  try {
    return normalizeNotificationPreferences(JSON.parse(localStorage.getItem(notificationPrefsKey) || "{}"));
  } catch {
    return normalizeNotificationPreferences({});
  }
}

function normalizeNotificationPreferences(value = {}) {
  const duration = ["short", "normal", "long"].includes(value.duration) ? value.duration : defaultNotificationPrefs.duration;
  return {
    toastEnabled: value.toastEnabled !== undefined ? Boolean(value.toastEnabled) : defaultNotificationPrefs.toastEnabled,
    infoToasts: value.infoToasts !== undefined ? Boolean(value.infoToasts) : defaultNotificationPrefs.infoToasts,
    successToasts: value.successToasts !== undefined ? Boolean(value.successToasts) : defaultNotificationPrefs.successToasts,
    warningToasts: value.warningToasts !== undefined ? Boolean(value.warningToasts) : defaultNotificationPrefs.warningToasts,
    errorToasts: value.errorToasts !== undefined ? Boolean(value.errorToasts) : defaultNotificationPrefs.errorToasts,
    terminalNotices: value.terminalNotices !== undefined ? Boolean(value.terminalNotices) : defaultNotificationPrefs.terminalNotices,
    duration,
  };
}

function currentNotificationPreferences() {
  if (!state.notifications) state.notifications = loadNotificationPreferences();
  return state.notifications;
}

function saveNotificationPreferences(next, { notify = false } = {}) {
  state.notifications = normalizeNotificationPreferences(next);
  try {
    localStorage.setItem(notificationPrefsKey, JSON.stringify(state.notifications));
  } catch {}
  if (state.activeSettingsPanel === "notifications") refreshActiveSettingsPanel();
  if (notify) showToast("通知偏好已保存。", "success", { force: true });
}

function setNotificationPreference(field, value) {
  const prefs = { ...currentNotificationPreferences() };
  if (field === "duration") {
    prefs.duration = value;
  } else {
    prefs[field] = value === true || value === "true";
  }
  saveNotificationPreferences(prefs, { notify: true });
}

function resetNotificationPreferences() {
  saveNotificationPreferences({ ...defaultNotificationPrefs }, { notify: true });
}

function notificationVariantEnabled(variant) {
  const prefs = currentNotificationPreferences();
  if (!prefs.toastEnabled) return false;
  if (variant === "success") return prefs.successToasts;
  if (variant === "warn" || variant === "warning") return prefs.warningToasts;
  if (variant === "error") return prefs.errorToasts;
  return prefs.infoToasts;
}

function notificationToastDuration(variant) {
  const prefs = currentNotificationPreferences();
  const base = variant === "error" ? 7000 : 3800;
  if (prefs.duration === "short") return variant === "error" ? 4500 : 2400;
  if (prefs.duration === "long") return variant === "error" ? 11000 : 7000;
  return base;
}

function notifyTerminal(message) {
  if (currentNotificationPreferences().terminalNotices) appendTerminal(message);
}

function loadTerminalPreferences() {
  try {
    return normalizeTerminalPreferences(JSON.parse(localStorage.getItem(terminalPrefsKey) || "{}"));
  } catch {
    return normalizeTerminalPreferences({});
  }
}

function normalizeTerminalPreferences(value = {}) {
  const maxLines = Number(value.maxLines || defaultTerminalPrefs.maxLines);
  return {
    clearOnReconnect: value.clearOnReconnect !== undefined ? Boolean(value.clearOnReconnect) : defaultTerminalPrefs.clearOnReconnect,
    focusOnConnect: value.focusOnConnect !== undefined ? Boolean(value.focusOnConnect) : defaultTerminalPrefs.focusOnConnect,
    maxLines: [1000, 3000, 5000, 10000].includes(maxLines) ? maxLines : defaultTerminalPrefs.maxLines,
  };
}

function currentTerminalPreferences() {
  if (!state.terminalPrefs) state.terminalPrefs = loadTerminalPreferences();
  return state.terminalPrefs;
}

function saveTerminalPreferences(next, { notify = false } = {}) {
  state.terminalPrefs = normalizeTerminalPreferences(next);
  try {
    localStorage.setItem(terminalPrefsKey, JSON.stringify(state.terminalPrefs));
  } catch {}
  trimTerminalOutput();
  if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
  if (notify) showToast("终端偏好已保存。", "success", { force: true });
}

function setTerminalPreference(field, value) {
  const prefs = { ...currentTerminalPreferences() };
  if (field === "maxLines") prefs.maxLines = Number(value || defaultTerminalPrefs.maxLines);
  else prefs[field] = value === true || value === "true";
  saveTerminalPreferences(prefs, { notify: true });
}

function terminalOutputText() {
  return $("terminalOutput")?.textContent || "";
}

function terminalOutputStats() {
  const text = terminalOutputText();
  return {
    chars: text.length,
    lines: text ? text.split("\n").length : 0,
  };
}

function clearTerminalOutput({ notify = true } = {}) {
  const output = $("terminalOutput");
  if (!output) return;
  output.textContent = "Terminal cleared.\n";
  if (notify) showToast("终端输出已清空。", "success");
  if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
}

async function copyTerminalOutput() {
  const text = terminalOutputText();
  if (!text.trim()) throw new Error("当前终端没有可复制内容");
  if (await copyToClipboard(text)) {
    showToast("终端输出已复制。", "success");
    notifyTerminal("[info] 已复制终端输出。\n");
    return;
  }
  showToast("复制终端输出失败，请手动选择文本复制。", "warn");
  notifyTerminal("[warn] 复制终端输出失败。\n");
}

function focusTerminalPanel() {
  toggleTerminal(false);
  $("terminalOutput")?.focus();
  resizeTerminal();
}

function reconnectTerminalFromSettings() {
  if (!state.narrator) {
    showToast("请先选择一个 AI 代理再连接终端。", "warn");
    return;
  }
  connectTerminal();
}

function trimTerminalOutput() {
  const output = $("terminalOutput");
  if (!output) return;
  const maxLines = currentTerminalPreferences().maxLines;
  if (!maxLines || maxLines <= 0) return;
  const lines = output.textContent.split("\n");
  if (lines.length <= maxLines) return;
  output.textContent = lines.slice(lines.length - maxLines).join("\n");
}

function loadAppearancePreferences() {
  try {
    return normalizeAppearancePreferences(JSON.parse(localStorage.getItem(appearancePrefsKey) || "{}"));
  } catch {
    return normalizeAppearancePreferences({});
  }
}

function normalizeAppearancePreferences(value = {}) {
  const theme = ["dark", "light"].includes(value.theme) ? value.theme : defaultAppearancePrefs.theme;
  const density = ["comfortable", "compact"].includes(value.density) ? value.density : defaultAppearancePrefs.density;
  return {
    theme,
    density,
    terminalDefaultOpen: value.terminalDefaultOpen !== undefined ? Boolean(value.terminalDefaultOpen) : defaultAppearancePrefs.terminalDefaultOpen,
    showEventLog: value.showEventLog !== undefined ? Boolean(value.showEventLog) : defaultAppearancePrefs.showEventLog,
  };
}

function currentAppearancePreferences() {
  if (!state.appearance) state.appearance = loadAppearancePreferences();
  return state.appearance;
}

function saveAppearancePreferences(next, { applyTerminalDefault = false, notify = false } = {}) {
  state.appearance = normalizeAppearancePreferences(next);
  try {
    localStorage.setItem(appearancePrefsKey, JSON.stringify(state.appearance));
  } catch {}
  applyAppearancePreferences({ applyTerminalDefault });
  if (state.activeSettingsPanel === "appearance") refreshActiveSettingsPanel();
  if (notify) showToast("外观偏好已保存。", "success");
}

function applyAppearancePreferences({ applyTerminalDefault = false } = {}) {
  const prefs = currentAppearancePreferences();
  document.body.classList.toggle("theme-light", prefs.theme === "light");
  document.body.classList.toggle("theme-dark", prefs.theme === "dark");
  document.body.classList.toggle("ui-density-compact", prefs.density === "compact");
  document.body.classList.toggle("ui-density-comfortable", prefs.density !== "compact");
  if (applyTerminalDefault && $("appShell")) {
    toggleTerminal(!prefs.terminalDefaultOpen);
  }
}

function setAppearancePreference(field, value) {
  const prefs = { ...currentAppearancePreferences() };
  if (field === "terminalDefaultOpen" || field === "showEventLog") {
    prefs[field] = value === true || value === "true";
  } else {
    prefs[field] = value;
  }
  saveAppearancePreferences(prefs, { notify: true });
}

function shouldLogAgentEvents() {
  return currentAppearancePreferences().showEventLog;
}

function normalizeRecentDirectories(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeChatDrafts(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source).reduce((acc, [key, draft]) => {
    const id = String(key || "").trim().slice(0, 120);
    const text = String(draft || "").slice(0, 8000);
    if (id && text.trim()) acc[id] = text;
    return acc;
  }, {});
}

function loadChatDrafts() {
  try {
    return normalizeChatDrafts(JSON.parse(localStorage.getItem(chatDraftsKey) || "{}"));
  } catch {
    return {};
  }
}

function currentChatDrafts() {
  if (!state.chatDrafts || typeof state.chatDrafts !== "object") state.chatDrafts = loadChatDrafts();
  return state.chatDrafts;
}

function currentChatDraftKey() {
  return state.narrator?.id || state.chapter?.id || state.project?.id || "global";
}

function writeChatDrafts(drafts) {
  state.chatDrafts = normalizeChatDrafts(drafts);
  try {
    localStorage.setItem(chatDraftsKey, JSON.stringify(state.chatDrafts));
  } catch {}
}

function saveChatDraftForKey(key, value) {
  const id = String(key || "").trim();
  if (!id) return;
  const drafts = { ...currentChatDrafts() };
  const text = String(value || "").slice(0, 8000);
  if (text.trim()) drafts[id] = text;
  else delete drafts[id];
  writeChatDrafts(drafts);
}

function saveCurrentChatDraft() {
  const input = $("messageText");
  if (!input) return;
  saveChatDraftForKey(currentChatDraftKey(), input.value);
}

function restoreCurrentChatDraft() {
  const draft = currentChatDrafts()[currentChatDraftKey()] || "";
  setMessageInputValue(draft, { saveDraft: false });
}

function clearChatDraftForKey(key) {
  saveChatDraftForKey(key, "");
}

function normalizePromptHistory(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => item.slice(0, 4000))
    .slice(0, 30);
}

function loadPromptHistory() {
  try {
    return normalizePromptHistory(JSON.parse(localStorage.getItem(promptHistoryKey) || "[]"));
  } catch {
    return [];
  }
}

function currentPromptHistory() {
  if (!Array.isArray(state.promptHistory)) state.promptHistory = loadPromptHistory();
  return state.promptHistory;
}

function savePromptHistory(history) {
  state.promptHistory = normalizePromptHistory(history);
  state.promptHistoryIndex = -1;
  state.promptHistoryDraft = "";
  try {
    localStorage.setItem(promptHistoryKey, JSON.stringify(state.promptHistory));
  } catch {}
  updatePromptHistoryHint();
}

function rememberPromptHistory(text) {
  const prompt = String(text || "").trim();
  if (!prompt) return;
  const next = [prompt, ...currentPromptHistory().filter((item) => item.toLowerCase() !== prompt.toLowerCase())];
  savePromptHistory(next);
}

function resetPromptHistoryNavigation() {
  state.promptHistoryIndex = -1;
  state.promptHistoryDraft = "";
}

function safeReadLocalPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localPreferenceValueForBackup(entry, raw) {
  if (entry.type !== "json") return raw;
  try {
    return normalizeImportedJSONPreference(entry.key, JSON.parse(raw || "null"));
  } catch {
    return normalizeImportedJSONPreference(entry.key, {});
  }
}

function localPreferencesBackupSummary() {
  return localPreferenceBackupKeys.reduce((acc, entry) => {
    const raw = safeReadLocalPreference(entry.key);
    if (raw === null) return acc;
    acc.count += 1;
    acc.bytes += raw.length;
    acc.labels.push(entry.label);
    return acc;
  }, { count: 0, bytes: 0, labels: [] });
}

function createLocalPreferencesBackup() {
  const preferences = {};
  localPreferenceBackupKeys.forEach((entry) => {
    const raw = safeReadLocalPreference(entry.key);
    if (raw !== null) preferences[entry.key] = localPreferenceValueForBackup(entry, raw);
  });
  return {
    kind: localPreferenceBackupKind,
    version: localPreferenceBackupVersion,
    app: "CodeHarbor",
    appVersion: state.settings?.version || "0.1.0-dev",
    exportedAt: new Date().toISOString(),
    preferences,
  };
}

function localPreferencesBackupText() {
  return JSON.stringify(createLocalPreferencesBackup(), null, 2);
}

function normalizeImportedJSONPreference(key, value) {
  if (key === profilePrefsKey) return normalizeProfilePreferences(value || {});
  if (key === searchPrefsKey) return normalizeSearchPreferences(value || {});
  if (key === imGatewayPrefsKey) return normalizeIMGatewayPreferences(value || {});
  if (key === skillsPrefsKey) return normalizeSkillsPreferences(value || {});
  if (key === notificationPrefsKey) return normalizeNotificationPreferences(value || {});
  if (key === appearancePrefsKey) return normalizeAppearancePreferences(value || {});
  if (key === terminalPrefsKey) return normalizeTerminalPreferences(value || {});
  if (key === chatDraftsKey) return normalizeChatDrafts(value || {});
  if (key === promptHistoryKey) return normalizePromptHistory(value);
  if (key === recentDirectoriesKey) return normalizeRecentDirectories(value);
  return value || {};
}

function normalizeImportedLocalPreference(entry, value) {
  if (entry.type === "json") {
    let parsed = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed || "null");
      } catch {
        throw new Error(`${entry.label} 不是有效 JSON`);
      }
    }
    return JSON.stringify(normalizeImportedJSONPreference(entry.key, parsed));
  }
  const text = String(value ?? "").trim();
  if (entry.key === relayProtocolPrefsKey) return relayProtocolSpec(text).key;
  if (entry.key === preferredModelKey) return text.slice(0, 240);
  return text.slice(0, 1000);
}

function restoreLocalPreferencesBackup(text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("备份 JSON 格式无效");
  }
  const preferences = payload?.preferences || payload?.settings || payload?.values;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    throw new Error("备份中未找到 preferences 配置");
  }
  const updates = localPreferenceBackupKeys
    .filter((entry) => Object.prototype.hasOwnProperty.call(preferences, entry.key))
    .map((entry) => ({ entry, raw: normalizeImportedLocalPreference(entry, preferences[entry.key]) }));
  if (!updates.length) throw new Error("备份中没有可导入的 CodeHarbor 本地偏好");
  try {
    updates.forEach(({ entry, raw }) => {
      if (!raw && entry.key !== relayProtocolPrefsKey) localStorage.removeItem(entry.key);
      else localStorage.setItem(entry.key, raw);
    });
  } catch {
    throw new Error("浏览器无法写入本地偏好，可能是隐私模式或存储空间不足");
  }
  reloadLocalPreferencesFromStorage();
  return updates.length;
}

function reloadLocalPreferencesFromStorage() {
  state.profile = loadProfilePreferences();
  state.searchPrefs = loadSearchPreferences();
  state.imGatewayPrefs = loadIMGatewayPreferences();
  state.skillsPrefs = loadSkillsPreferences();
  state.notifications = loadNotificationPreferences();
  state.terminalPrefs = loadTerminalPreferences();
  state.chatDrafts = loadChatDrafts();
  state.promptHistory = loadPromptHistory();
  state.appearance = loadAppearancePreferences();
  applyProfilePreferences();
  applyAppearancePreferences();
  trimTerminalOutput();
  updatePromptHistoryHint();
  renderRecentSidebarDirectories();
  renderRecentModalDirectories();
  renderModelOptions();
}

function setHealth(ok, text) {
  const badge = $("healthBadge");
  badge.textContent = text;
  badge.classList.toggle("ok", ok);
  badge.classList.toggle("err", !ok);
}

async function loadHealth() {
  const seq = ++state.healthSeq;
  try {
    const health = await api("/api/health");
    if (seq !== state.healthSeq) return;
    setHealth(true, `healthy ${health.version}`);
  } catch {
    if (seq !== state.healthSeq) return;
    setHealth(false, "offline");
  }
}

async function loadBackends({ checkHealth = true } = {}) {
  const seq = ++state.backendLoadSeq;
  const button = $("refreshAgentBackendsBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const backends = await api("/api/backends");
    if (seq !== state.backendLoadSeq) return;
    state.backends = Array.isArray(backends) ? backends : [];
    if (!state.backends.some((backend) => backend.id === state.backendHealth?.backendId)) state.backendHealth = null;
    renderBackendsList();
    if (checkHealth) await refreshActiveBackendHealth();
    if (seq !== state.backendLoadSeq) return;
    if (state.activeSettingsPanel === "agent-admin") refreshActiveSettingsPanel();
  } catch (err) {
    if (seq === state.backendLoadSeq) throw err;
  } finally {
    if (seq === state.backendLoadSeq) setButtonBusy(button, false, "刷新中");
  }
}


function activeBackend() {
  return state.backends.find((backend) => backend.active) || state.backends[0] || null;
}

function renderBackendPanel() {
  const backend = activeBackend();
  const name = $("activeBackendName");
  if (name) name.textContent = backend ? `${backend.name} · ${backend.baseUrl}` : "未配置后端";
  updateSidebarAccountSummary();
  if (!backend) setBackendHealthBadge(false, "未配置");
}

function setBackendHealthBadge(ok, text) {
  const badge = $("backendHealthBadge");
  if (badge) {
    badge.textContent = text;
    badge.classList.toggle("ok", ok);
    badge.classList.toggle("err", !ok);
  }
  const dot = $("sidebarBackendDot");
  if (dot) {
    dot.classList.toggle("ok", ok);
    dot.classList.toggle("err", !ok);
    dot.title = text;
  }
}

async function refreshActiveBackendHealth() {
  const backend = activeBackend();
  if (!backend) return;
  const seq = ++state.backendHealthSeq;
  setBackendHealthBadge(false, "checking");
  try {
    const health = await api(`/api/backends/${backend.id}/health`);
    if (seq !== state.backendHealthSeq || activeBackend()?.id !== backend.id) return;
    state.backendHealth = health;
    setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
    renderBackendsList();
  } catch (err) {
    if (seq !== state.backendHealthSeq || activeBackend()?.id !== backend.id) return;
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

function elementVisible(id) {
  const node = $(id);
  return Boolean(node && !node.classList.contains("hidden"));
}

function isComposingInput(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

function sidebarSettingsMenuOpen() {
  const menu = $("sidebarSettingsMenu");
  return Boolean(menu && !menu.classList.contains("hidden"));
}

function setSidebarSettingsMenuOpen(open) {
  const menu = $("sidebarSettingsMenu");
  const button = $("sidebarAccountBtn");
  if (!menu) return;
  menu.classList.toggle("hidden", !open);
  button?.setAttribute("aria-expanded", open ? "true" : "false");
  button?.classList.toggle("open", open);
}

function toggleSidebarSettingsMenu() {
  setSidebarSettingsMenuOpen(!sidebarSettingsMenuOpen());
}

function closeSidebarSettingsMenu() {
  setSidebarSettingsMenuOpen(false);
}

function handleSidebarSettingsMenuDocumentClick(event) {
  if (!sidebarSettingsMenuOpen()) return;
  if (event.target.closest?.(".sidebar-footer")) return;
  closeSidebarSettingsMenu();
}

function handleDirectoryShortcutClick(event) {
  const trigger = event.target.closest?.("[data-open-directory-shortcut]");
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  const path = trigger.dataset.openDirectoryShortcut === "current"
    ? (state.narrator?.cwd || state.project?.gitPath || "")
    : "";
  openDirectoryChooser(path, { trigger }).catch(showError);
}

function handleGlobalEscape(event) {
  if (event.key !== "Escape" || isComposingInput(event)) return;
  if (sidebarSettingsMenuOpen()) {
    closeSidebarSettingsMenu();
    event.preventDefault();
    return;
  }
  if (elementVisible("folderModal")) {
    closeDirectoryModal();
    event.preventDefault();
    return;
  }
  if (elementVisible("backendsModal")) {
    closeBackendsModal();
    event.preventDefault();
    return;
  }
  if (elementVisible("settingsModal")) {
    if (normalizedSettingsSearchQuery()) {
      clearSettingsSearchQuery({ focus: document.activeElement?.id === "settingsSearchInput" });
      event.preventDefault();
      return;
    }
    closeSettingsModal();
    event.preventDefault();
  }
}

function handleSettingsSearchShortcut(event) {
  if (!elementVisible("settingsModal") || isComposingInput(event)) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    focusSettingsSearchInput({ select: true });
    event.preventDefault();
  }
}

function backendActionKey(id, action) {
  return `${action}:${id}`;
}

function isBackendActionBusy(id, action = "") {
  const busy = state.backendActionBusy || {};
  if (action) return Boolean(busy[backendActionKey(id, action)]);
  return ["test", "activate", "delete"].some((item) => busy[backendActionKey(id, item)]);
}

function setBackendActionBusy(id, action, busy) {
  if (!id || !action) return;
  const key = backendActionKey(id, action);
  if (busy) state.backendActionBusy = { ...(state.backendActionBusy || {}), [key]: true };
  else {
    const next = { ...(state.backendActionBusy || {}) };
    delete next[key];
    state.backendActionBusy = next;
  }
  renderBackendsList();
  if (state.activeSettingsPanel === "agent-admin") refreshActiveSettingsPanel();
}

function renderBackendActionButton({ backendId, action, dataAttr, label, busyLabel, className = "" }) {
  const ownBusy = isBackendActionBusy(backendId, action);
  const disabled = isBackendActionBusy(backendId);
  return `<button class="${className}" type="button" data-${dataAttr}="${escapeAttr(backendId)}" ${disabled ? "disabled" : ""} ${ownBusy ? 'aria-busy="true"' : ""}>${escapeHtml(ownBusy ? busyLabel : label)}</button>`;
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
    const pendingDelete = state.backendDeleteConfirmId === backend.id;
    return `
      <div class="backend-card ${backend.active ? "active" : ""} ${pendingDelete ? "confirm-delete" : ""}">
        <div class="backend-card-main">
          <div class="backend-card-title">${escapeHtml(backend.name)} ${backend.active ? "<span class='mini-tag'>active</span>" : ""}</div>
          <div class="backend-card-url">${escapeHtml(backend.baseUrl)}</div>
          <div class="backend-card-meta">${escapeHtml(backend.kind)} · ${backend.apiKeyConfigured ? "API key 已配置" : "无 API key"} · ${escapeHtml(healthText)}</div>
        </div>
        <div class="backend-card-actions">
          ${renderBackendActionButton({ backendId: backend.id, action: "test", dataAttr: "backend-test", label: "检测", busyLabel: "检测中", className: "ghost-btn mini" })}
          ${backend.active ? "" : renderBackendActionButton({ backendId: backend.id, action: "activate", dataAttr: "backend-activate", label: "设为当前", busyLabel: "切换中", className: "ghost-btn mini" })}
          ${renderBackendActionButton({ backendId: backend.id, action: "delete", dataAttr: "backend-delete", label: pendingDelete ? "确认删除" : "删除", busyLabel: "删除中", className: `ghost-btn mini danger ${pendingDelete ? "confirm" : ""}` })}
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
    node.addEventListener("click", () => requestDeleteBackend(node.dataset.backendDelete).catch(showError));
  });
}

function setBackendFormSubmitting(form, submitting) {
  const button = form?.querySelector("[data-backend-submit]");
  if (!button) return;
  if (submitting) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.textContent = "添加中";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.textContent = button.dataset.originalLabel || "添加后端";
  button.disabled = false;
  button.removeAttribute("aria-busy");
  delete button.dataset.originalLabel;
}

async function saveBackend(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form?.querySelector("[data-backend-submit]");
  if (submitButton?.disabled) return;
  const payload = {
    name: $("backendName").value.trim(),
    kind: $("backendKind").value,
    baseUrl: $("backendBaseUrl").value.trim(),
    apiKey: $("backendApiKey").value.trim(),
    active: state.backends.length === 0,
  };
  if (!payload.baseUrl) throw new Error("请填写后端 URL");
  setBackendFormSubmitting(form, true);
  try {
    await api("/api/backends", { method: "POST", body: JSON.stringify(payload) });
    state.backendDeleteConfirmId = "";
    resetBackendForm();
    showToast("后端已添加。", "success");
    await loadBackends();
  } finally {
    setBackendFormSubmitting(form, false);
  }
}

async function activateBackend(id) {
  if (!id || isBackendActionBusy(id)) return;
  setBackendActionBusy(id, "activate", true);
  try {
    state.backendHealthSeq++;
    await api(`/api/backends/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
    state.backendDeleteConfirmId = "";
    showToast("当前后端已切换。", "success");
    await loadBackends();
  } finally {
    setBackendActionBusy(id, "activate", false);
  }
}

async function requestDeleteBackend(id) {
  if (!id || isBackendActionBusy(id)) return;
  if (state.backendDeleteConfirmId !== id) {
    state.backendDeleteConfirmId = id;
    renderBackendsList();
    if (state.activeSettingsPanel === "agent-admin") refreshActiveSettingsPanel();
    showToast("再点击一次“确认删除”即可移除此后端。", "warn");
    return;
  }
  await deleteBackend(id);
}

async function deleteBackend(id) {
  if (!id || isBackendActionBusy(id)) return;
  setBackendActionBusy(id, "delete", true);
  try {
    state.backendHealthSeq++;
    await api(`/api/backends/${id}`, { method: "DELETE" });
    state.backendDeleteConfirmId = "";
    if (state.backendHealth?.backendId === id) state.backendHealth = null;
    showToast("后端已删除。", "success");
    await loadBackends();
  } finally {
    setBackendActionBusy(id, "delete", false);
  }
}

async function testBackend(id) {
  if (!id || isBackendActionBusy(id)) return;
  setBackendActionBusy(id, "test", true);
  try {
    const seq = ++state.backendHealthSeq;
    const health = await api(`/api/backends/${id}/health`);
    if (seq !== state.backendHealthSeq) return;
    state.backendHealth = health;
    if (activeBackend()?.id === id) setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
    renderBackendsList();
    if (state.activeSettingsPanel === "agent-admin") refreshActiveSettingsPanel();
  } finally {
    setBackendActionBusy(id, "test", false);
  }
}

async function loadSettings() {
  const seq = ++state.settingsLoadSeq;
  try {
    const settings = await api("/api/settings");
    if (seq !== state.settingsLoadSeq) return;
    state.settings = settings;
    updateSidebarAccountSummary();
    renderModelOptions();
  } catch (err) {
    if (seq === state.settingsLoadSeq) throw err;
  }
}

async function loadModelCatalog() {
  const seq = ++state.modelCatalogSeq;
  try {
    const catalog = await api("/api/models");
    if (seq !== state.modelCatalogSeq) return;
    state.modelCatalog = catalog;
  } catch (err) {
    if (seq !== state.modelCatalogSeq) return;
    state.modelCatalog = { providers: [], error: err.message };
  }
  renderModelOptions();
  refreshActiveSettingsPanel();
}

async function loadStorageSummary({ notify = false } = {}) {
  const seq = ++state.storageSeq;
  const button = $("refreshStorageSummaryBtn");
  setButtonBusy(button, true, "扫描中");
  try {
    const summary = await api("/api/storage/summary");
    if (seq !== state.storageSeq) return;
    state.storageSummary = summary;
    state.storageError = "";
    if (notify) notifyTerminal("[info] 储存空间统计已刷新。\n");
  } catch (err) {
    if (seq !== state.storageSeq) return;
    state.storageSummary = null;
    state.storageError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 储存空间统计失败：${state.storageError}\n`);
  } finally {
    if (seq === state.storageSeq) setButtonBusy(button, false, "扫描中");
  }
  if (seq === state.storageSeq && state.activeSettingsPanel === "storage") refreshActiveSettingsPanel();
}

async function loadLicenseSummary({ notify = false } = {}) {
  const seq = ++state.licenseSeq;
  const button = $("refreshLicensesBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const summary = await api("/api/licenses");
    if (seq !== state.licenseSeq) return;
    state.licenseSummary = summary;
    state.licenseError = "";
    if (notify) notifyTerminal("[info] 第三方依赖许可证已刷新。\n");
  } catch (err) {
    if (seq !== state.licenseSeq) return;
    state.licenseSummary = null;
    state.licenseError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 第三方依赖许可证刷新失败：${state.licenseError}\n`);
  } finally {
    if (seq === state.licenseSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.licenseSeq && state.activeSettingsPanel === "about") refreshActiveSettingsPanel();
}

async function loadUsageSummary({ notify = false } = {}) {
  const seq = ++state.usageSeq;
  const button = $("refreshUsageSummaryBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const summary = await api("/api/usage/summary");
    if (seq !== state.usageSeq) return;
    state.usageSummary = summary;
    state.usageError = "";
    if (notify) notifyTerminal("[info] 使用统计已刷新。\n");
  } catch (err) {
    if (seq !== state.usageSeq) return;
    state.usageSummary = null;
    state.usageError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 使用统计刷新失败：${state.usageError}\n`);
  } finally {
    if (seq === state.usageSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.usageSeq && state.activeSettingsPanel === "usage") refreshActiveSettingsPanel();
}

async function loadChapterContainerData({ notify = false } = {}) {
  const seq = ++state.chaptersSeq;
  const button = $("refreshChaptersBtn");
  setButtonBusy(button, true, "刷新中");
  const projectId = state.project?.id || "";
  try {
    if (!projectId) {
      state.projectChapters = [];
      state.chapterNarrators = [];
      state.chaptersError = "";
      return;
    }
    const chapters = await api(`/api/projects/${projectId}/chapters`);
    if (seq !== state.chaptersSeq || state.project?.id !== projectId) return;
    state.projectChapters = Array.isArray(chapters) ? chapters : [];
    if (!state.chapter && state.projectChapters.length) state.chapter = state.projectChapters[0];
    const currentChapter = state.projectChapters.find((chapter) => chapter.id === state.chapter?.id) || state.projectChapters[0] || null;
    if (currentChapter) state.chapter = currentChapter;
    if (currentChapter?.id) {
      const chapterId = currentChapter.id;
      const narrators = await api(`/api/chapters/${chapterId}/narrators`);
      if (seq !== state.chaptersSeq || state.project?.id !== projectId || state.chapter?.id !== chapterId) return;
      state.chapterNarrators = Array.isArray(narrators) ? narrators : [];
    } else {
      state.chapterNarrators = [];
    }
    state.chaptersError = "";
    if (notify) notifyTerminal("[info] 章节与叙述者状态已刷新。\n");
  } catch (err) {
    if (seq !== state.chaptersSeq || state.project?.id !== projectId) return;
    state.projectChapters = [];
    state.chapterNarrators = [];
    state.chaptersError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 章节与叙述者刷新失败：${state.chaptersError}\n`);
  } finally {
    if (seq === state.chaptersSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.chaptersSeq && state.activeSettingsPanel === "chapters-containers") refreshActiveSettingsPanel();
}

async function loadAuthStatus({ notify = false } = {}) {
  const seq = ++state.authSeq;
  const button = $("refreshAuthStatusBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const status = await api("/api/auth/status");
    if (seq !== state.authSeq) return;
    state.authStatus = status;
    state.authError = "";
    if (notify) notifyTerminal("[info] 用户与注册状态已刷新。\n");
  } catch (err) {
    if (seq !== state.authSeq) return;
    state.authStatus = null;
    state.authError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 用户与注册状态刷新失败：${state.authError}\n`);
  } finally {
    if (seq === state.authSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.authSeq && state.activeSettingsPanel === "users") refreshActiveSettingsPanel();
}

async function loadRuntimeSummary({ notify = false } = {}) {
  const seq = ++state.runtimeSeq;
  const button = $("refreshRuntimeSummaryBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const summary = await api("/api/runtime/summary");
    if (seq !== state.runtimeSeq) return;
    state.runtimeSummary = summary;
    state.runtimeError = "";
    if (notify) notifyTerminal("[info] 运行时状态已刷新。\n");
  } catch (err) {
    if (seq !== state.runtimeSeq) return;
    state.runtimeSummary = null;
    state.runtimeError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 运行时状态刷新失败：${state.runtimeError}\n`);
  } finally {
    if (seq === state.runtimeSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.runtimeSeq && ["servers-system", "runtime"].includes(state.activeSettingsPanel)) refreshActiveSettingsPanel();
}

function warmSettingsData() {
  if (state.settingsWarmupStarted) return;
  state.settingsWarmupStarted = true;
  const tasks = [];
  if (!state.runtimeSummary && !state.runtimeError) tasks.push(loadRuntimeSummary());
  if (!state.storageSummary && !state.storageError) tasks.push(loadStorageSummary());
  if (!state.usageSummary && !state.usageError) tasks.push(loadUsageSummary());
  if (!state.authStatus && !state.authError) tasks.push(loadAuthStatus());
  if (!state.licenseSummary && !state.licenseError) tasks.push(loadLicenseSummary());
  if (!state.providerAuthFiles && !state.providerAuthError) tasks.push(loadProviderAuthFiles({ silent: true }));
  Promise.allSettled(tasks).catch(() => {});
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  delete button.dataset.originalLabel;
}

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
    notifyTerminal("[info] 模型列表已刷新。\n");
  } finally {
    state.modelRefreshing = false;
    setModelRefreshButtonsBusy(false);
  }
}

async function loadProviderAuthFiles({ silent = false } = {}) {
  const seq = ++state.providerAuthSeq;
  const button = silent ? null : $("codexRefreshAuthBtn");
  setButtonBusy(button, true, "刷新中");
  try {
    const files = await api("/api/providers/cliproxyapi/auth-files");
    if (seq !== state.providerAuthSeq) return;
    state.providerAuthFiles = files;
    state.providerAuthError = "";
  } catch (err) {
    if (seq !== state.providerAuthSeq) return;
    state.providerAuthFiles = null;
    state.providerAuthError = err.message;
    if (!silent) notifyTerminal(`[warn] 读取 CLIProxyAPI 账号失败：${err.message}\n`);
  } finally {
    if (seq === state.providerAuthSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.providerAuthSeq) refreshActiveSettingsPanel();
}

async function importCodexAuthFile() {
  const button = $("codexImportAuthBtn");
  if (button?.disabled) return;
  const textarea = $("codexAuthImportText");
  const content = textarea?.value.trim() || "";
  if (!content) throw new Error("请先粘贴 JSON 或 token 内容");
  setButtonBusy(button, true, "导入中");
  if (textarea) textarea.disabled = true;
  try {
    await api("/api/providers/cliproxyapi/auth-files/import", {
      method: "POST",
      body: JSON.stringify({ filename: "codeharbor-codex-auth.json", content }),
    });
    if (textarea) textarea.value = "";
    notifyTerminal("[info] 已导入 Codex 凭据，正在刷新账号和模型。\n");
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
    apiKeyOptional: spec.providerName === "cliproxyapi",
  };
  setButtonBusy(button, true, "保存中");
  try {
    const result = await api(`/api/providers/${encodeURIComponent(spec.providerName)}/config`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.providerConfigStatus = result.message || "中转站配置已保存。";
    notifyTerminal(`[info] 已保存 ${spec.label} 配置，正在刷新模型。\n`);
    await loadSettings();
    await loadModelCatalog();
    refreshActiveSettingsPanel();
  } finally {
    setButtonBusy(button, false, "保存中");
  }
}

function selectRelayProtocol(protocol) {
  localStorage.setItem(relayProtocolPrefsKey, protocol);
  state.providerConfigStatus = "";
  refreshActiveSettingsPanel();
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
    { key: "codex", label: "Codex中转", providerName: "cliproxyapi", providerType: "openai-compatible", help: "连接本机 CLIProxyAPI；Codex 账号统一使用下方凭据导入。" },
    { key: "responses", label: "Responses兼容", providerName: "openai", providerType: "openai", help: "连接 OpenAI Responses API 兼容端点。" },
    { key: "claude-code", label: "ClaudeCode中转", providerName: "anthropic", providerType: "anthropic", help: "按 Anthropic Messages API 兼容方式接入 Claude Code 中转。" },
    { key: "completions", label: "Completions老旧兼容", providerName: "openai-compatible", providerType: "openai-compatible", help: "连接 OpenAI Chat Completions 兼容中转站。" },
  ];
}

function defaultModelForProtocol(protocol) {
  if (protocol === "anthropic" || protocol === "claude-code") return "claude-sonnet-4-5";
  if (protocol === "codex") return "gpt-5.5";
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
  refreshActiveSettingsPanel();
}

function expandProviderConfig(key) {
  if (providerConfigExpanded(key)) return;
  state.providerConfigExpanded = { ...(state.providerConfigExpanded || {}), [key]: true };
  refreshActiveSettingsPanel();
}

function providerByName(name) {
  return modelProvidersForUI().find((provider) => provider.name === name)
    || (state.settings?.providers || []).find((provider) => provider.name === name)
    || null;
}

function openSettingsModal(key = "profile") {
  state.settingsSearchQuery = "";
  $("settingsModal").classList.remove("hidden");
  syncSettingsSearchInput();
  warmSettingsData();
  renderSettingsNav(key);
  selectSettingsPanel(key);
}

function closeSettingsModal() {
  $("settingsModal").classList.add("hidden");
}

function normalizedSettingsSearchQuery() {
  return String(state.settingsSearchQuery || "").trim().toLowerCase();
}

function settingsSearchText(section, item) {
  return [section.title, item.key, item.label, item.subtitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filteredSettingsSections() {
  const query = normalizedSettingsSearchQuery();
  return settingsSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !query || settingsSearchText(section, item).includes(query)),
  })).filter((section) => section.items.length);
}

function firstFilteredSettingsItem(sections = filteredSettingsSections()) {
  return sections[0]?.items?.[0] || null;
}

function filteredSettingsIncludesKey(key, sections = filteredSettingsSections()) {
  return sections.some((section) => section.items.some((item) => item.key === key));
}

function syncSettingsSearchInput() {
  const input = $("settingsSearchInput");
  if (input && input.value !== state.settingsSearchQuery) input.value = state.settingsSearchQuery;
  $("clearSettingsSearchBtn")?.classList.toggle("visible", Boolean(normalizedSettingsSearchQuery()));
}

function renderSettingsNav(activeKey = "profile") {
  const nav = $("settingsNav");
  syncSettingsSearchInput();
  const sections = filteredSettingsSections();
  if (!sections.length) {
    nav.innerHTML = `
      <div class="settings-nav-empty">
        <strong>没有匹配的设置</strong>
        <span>换个关键词试试，例如“模型”“终端”“备份”或“技能”。</span>
      </div>
    `;
    return;
  }
  nav.innerHTML = sections.map((section) => `
    <div class="settings-nav-section">
      <div class="settings-nav-heading">${escapeHtml(section.title)}</div>
      ${section.items.map((item) => `
        <button class="settings-nav-item ${item.key === activeKey ? "active" : ""}" type="button" data-settings-key="${escapeAttr(item.key)}" title="${escapeAttr(item.subtitle)}">
          <span class="settings-nav-icon">${escapeHtml(item.icon)}</span>
          <span class="settings-nav-label"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.subtitle)}</small></span>
        </button>
      `).join("")}
    </div>
  `).join("");
  nav.querySelectorAll("[data-settings-key]").forEach((node) => {
    node.addEventListener("click", () => selectSettingsPanel(node.dataset.settingsKey));
  });
}

function updateSettingsSearchQuery(value) {
  state.settingsSearchQuery = String(value || "").slice(0, 80);
  const sections = filteredSettingsSections();
  const activeKey = state.activeSettingsPanel || "profile";
  const nextKey = filteredSettingsIncludesKey(activeKey, sections) ? activeKey : firstFilteredSettingsItem(sections)?.key || activeKey;
  renderSettingsNav(nextKey);
  if (nextKey !== activeKey) selectSettingsPanel(nextKey);
}

function clearSettingsSearchQuery({ focus = false } = {}) {
  state.settingsSearchQuery = "";
  renderSettingsNav(state.activeSettingsPanel || "profile");
  if (focus) focusSettingsSearchInput();
}

function focusSettingsSearchInput({ select = false } = {}) {
  const input = $("settingsSearchInput");
  if (!input) return;
  input.focus();
  if (select) input.select();
}

function selectSettingsPanel(key) {
  const item = settingsItems.find((entry) => entry.key === key) || settingsItems[0];
  state.activeSettingsPanel = item.key;
  $("settingsContentTitle").textContent = item.key === "skills" ? "套路" : item.label;
  $("settingsContentSubtitle").textContent = item.subtitle;
  $("settingsContentBody").innerHTML = renderSettingsContent(item);
  $("settingsNav").querySelectorAll(".settings-nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.settingsKey === item.key);
  });
  bindSettingsContent(item.key);
}

function refreshActiveSettingsPanel() {
  const modal = $("settingsModal");
  if (!modal || modal.classList.contains("hidden")) return;
  selectSettingsPanel(state.activeSettingsPanel || "profile");
}

function renderSettingsContent(item) {
  if (item.key === "profile") return renderProfileSettingsContent();
  if (item.key === "skills") return renderSkillSettingsContent(state.activeSkillTab || "commands");
  if (item.key === "models") return renderModelSettingsContent();
  if (item.key === "agents") return renderAgentSettingsContent();
  if (item.key === "providers") return renderProviderSettingsContent();
  if (item.key === "network-search") return renderNetworkSearchSettingsContent();
  if (item.key === "im-gateway") return renderIMGatewaySettingsContent();
  if (item.key === "notifications") return renderNotificationSettingsContent();
  if (item.key === "appearance") return renderAppearanceSettingsContent();
  if (item.key === "agent-admin") return renderAgentAdminSettingsContent();
  if (item.key === "chapters-containers") return renderChaptersSettingsContent();
  if (item.key === "storage") return renderStorageSettingsContent();
  if (item.key === "usage") return renderUsageSettingsContent();
  if (item.key === "servers-system") return renderServerSystemSettingsContent();
  if (item.key === "runtime") return renderRuntimeSettingsContent();
  if (item.key === "users") return renderUserSettingsContent();
  if (item.key === "terminals") return renderTerminalSettingsContent();
  if (item.key === "about") return renderAboutSettingsContent();
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

function bindSettingsContent(key) {
  if (key === "profile") bindProfileSettingsActions();
  if (key === "skills") bindSkillTabs("commands");
  if (key === "models") bindModelSettingsActions();
  if (key === "agents") bindAgentSettingsActions();
  if (key === "providers") bindProviderSettingsActions();
  if (key === "network-search") bindNetworkSearchSettingsActions();
  if (key === "im-gateway") bindIMGatewaySettingsActions();
  if (key === "notifications") bindNotificationSettingsActions();
  if (key === "appearance") bindAppearanceSettingsActions();
  if (key === "agent-admin") bindAgentAdminSettingsActions();
  if (key === "chapters-containers") bindChaptersSettingsActions();
  if (key === "storage") bindStorageSettingsActions();
  if (key === "usage") bindUsageSettingsActions();
  if (key === "servers-system" || key === "runtime") bindRuntimeSettingsActions();
  if (key === "users") bindUserSettingsActions();
  if (key === "terminals") bindTerminalSettingsActions();
  if (key === "about") bindAboutSettingsActions();
}

function renderProfileSettingsContent() {
  const profile = currentProfilePreferences();
  const gitConfigured = Boolean(profile.gitName && profile.gitEmail);
  return `
    <div class="settings-live-page profile-page">
      <section class="settings-hero-card profile-hero-card">
        <div class="profile-hero-main">
          <div class="profile-avatar-preview">${escapeHtml(profile.avatarInitials)}</div>
          <div>
            <div class="settings-hero-kicker">个人资料</div>
            <div class="settings-hero-title">${escapeHtml(profileDisplayName())}</div>
            <p>${escapeHtml(profile.roleLabel)} · ${escapeHtml(profile.workspaceLabel)}</p>
          </div>
        </div>
        <div class="settings-action-row">
          <button id="resetProfilePrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(profile.avatarInitials)}</strong><span>头像缩写</span></div>
        <div><strong>${escapeHtml(gitConfigured ? "已填写" : "未填写")}</strong><span>Git 身份</span></div>
        <div><strong>${escapeHtml("本地浏览器")}</strong><span>保存位置</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">显示资料</div>
            <div class="settings-provider-meta">这些资料只影响当前浏览器的工作台展示和复制辅助，不写入服务端用户表。</div>
          </div>
        </div>
        <form id="profileSettingsForm" class="settings-profile-form">
          <div class="settings-provider-form-grid">
            <label>显示名称
              <input id="profileDisplayName" class="settings-field" value="${escapeAttr(profile.displayName)}" placeholder="例如 Ada" />
            </label>
            <label>头像缩写
              <input id="profileAvatarInitials" class="settings-field" value="${escapeAttr(profile.avatarInitials)}" placeholder="CH" maxlength="4" />
            </label>
            <label>身份标签
              <input id="profileRoleLabel" class="settings-field" value="${escapeAttr(profile.roleLabel)}" placeholder="Local developer" />
            </label>
            <label>工作台标签
              <input id="profileWorkspaceLabel" class="settings-field" value="${escapeAttr(profile.workspaceLabel)}" placeholder="CodeHarbor Local" />
            </label>
            <label>Git user.name
              <input id="profileGitName" class="settings-field" value="${escapeAttr(profile.gitName)}" placeholder="用于复制 git config 示例" />
            </label>
            <label>Git user.email
              <input id="profileGitEmail" class="settings-field" value="${escapeAttr(profile.gitEmail)}" placeholder="you@example.com" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button id="copyProfileGitEnvBtn" class="settings-action-btn subtle" type="button">复制 Git 设置</button>
            <button class="settings-action-btn primary" type="submit">保存个人资料</button>
          </div>
        </form>
      </section>
      <div class="profile-info-grid">
        ${renderProfileInfoCard("本地优先", "个人资料保存在 localStorage，不会上传或写入 SQLite。")}
        ${renderProfileInfoCard("Git 辅助", gitConfigured ? "可以复制 git config 命令，方便统一提交身份。" : "填写 Git 姓名和邮箱后可生成 git config 命令。")}
        ${renderProfileInfoCard("账号系统", "完整头像上传、登录用户资料和角色绑定仍由后续用户系统承接。")}
      </div>
    </div>
  `;
}

function renderProfileInfoCard(title, description) {
  return `
    <section class="profile-info-card">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </section>
  `;
}

function bindProfileSettingsActions() {
  $("profileSettingsForm")?.addEventListener("submit", (event) => saveProfileSettingsFromPanel(event).catch(showError));
  $("resetProfilePrefsBtn")?.addEventListener("click", resetProfilePreferences);
  $("copyProfileGitEnvBtn")?.addEventListener("click", () => copyText(profileGitEnvExample()));
}

async function saveProfileSettingsFromPanel(event) {
  event.preventDefault();
  saveProfilePreferences({
    displayName: $("profileDisplayName")?.value || "",
    avatarInitials: $("profileAvatarInitials")?.value || "",
    roleLabel: $("profileRoleLabel")?.value || "",
    workspaceLabel: $("profileWorkspaceLabel")?.value || "",
    gitName: $("profileGitName")?.value || "",
    gitEmail: $("profileGitEmail")?.value || "",
  }, { notify: true });
  notifyTerminal("[info] 个人资料偏好已保存。\n");
}

function renderAgentSettingsContent() {
  const agent = state.settings?.agent || {};
  const narrator = state.narrator;
  const currentModel = narrator?.model || getPreferredModel() || agent.defaultModel || "";
  const provider = currentProviderConfig(currentModel);
  const cwd = narrator?.cwd || state.project?.gitPath || "";
  return `
    <div class="settings-live-page agent-settings-page">
      <section class="settings-hero-card agents-hero-card">
        <div>
          <div class="settings-hero-kicker">AI 代理</div>
          <div class="settings-hero-title">${escapeHtml(narrator?.title || "未选择代理")}</div>
          <p>查看默认 Agent 策略，并快速调整当前 CodeHarbor 代理的模型、权限模式和工作目录。这里复用现有代理 API，不改全局配置文件。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAgentSettingsBtn" class="settings-action-btn primary" type="button" ${narrator ? "" : "disabled"}>刷新代理</button>
          <button id="copyAgentIdBtn" class="settings-action-btn subtle" type="button" ${narrator ? "" : "disabled"}>复制 ID</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(narrator?.status || "未选择")}</strong><span>运行状态</span></div>
        <div><strong>${escapeHtml(narrator?.permissionMode || agent.defaultPermissionMode || "acceptEdits")}</strong><span>权限模式</span></div>
        <div><strong>${escapeHtml(providerStatusText(provider || {}))}</strong><span>模型提供商</span></div>
      </div>
      <div class="usage-summary-grid">
        ${renderUsageMetricCard("默认模型", agent.defaultModel || "未配置", "新建代理默认使用")}
        ${renderUsageMetricCard("摘要模型", agent.summaryModel || "未配置", "长上下文摘要预留")}
        ${renderUsageMetricCard("最大轮次", agent.maxTurns || 0, "Agent loop 单次上限")}
        ${renderUsageMetricCard("首 token 超时", formatDuration(agent.firstTokenTimeoutMs || 0), "Provider 响应等待时间")}
        ${renderUsageMetricCard("瞬时重试", agent.maxTransientRetries || 0, "临时错误重试次数")}
        ${renderUsageMetricCard("默认计划模式", agent.defaultStartInPlanMode ? "开启" : "关闭", "新建代理初始行为")}
      </div>
      ${narrator ? renderCurrentAgentEditor(narrator, currentModel, cwd) : renderNoAgentSelectedCard()}
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">运行策略说明</div>
            <div class="settings-provider-meta">这些值来自 `/api/settings`，当前页面只调整选中的 CodeHarbor 代理；默认策略仍由服务端 config 管理。</div>
          </div>
        </div>
        <div class="agent-policy-grid">
          ${renderAgentPolicyCard("权限边界", agent.defaultPermissionMode || "acceptEdits", "新建代理默认权限；当前代理可在上方面板即时切换。")}
          ${renderAgentPolicyCard("计划模式", agent.defaultStartInPlanMode ? "默认开启" : "默认关闭", "保留给后续更完整的计划/执行流。")}
          ${renderAgentPolicyCard("模型路由", currentModel || "未选择", provider ? `${providerLabel(provider)} · ${providerStatusText(provider)}` : "等待模型列表加载")}
          ${renderAgentPolicyCard("工作目录", cwd || "未设置", "工具执行和终端默认围绕该目录工作。")}
        </div>
      </section>
    </div>
  `;
}

function renderCurrentAgentEditor(narrator, currentModel, cwd) {
  return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前代理</div>
          <div class="settings-provider-meta">${escapeHtml(narrator.type || "primary")} · ${escapeHtml(narrator.id)}</div>
        </div>
        <span class="settings-status-pill ${narrator.status === "running" ? "warn" : "ok"}">${escapeHtml(narrator.status || "idle")}</span>
      </div>
      <form id="agentSettingsForm" class="settings-agent-form">
        <div class="settings-provider-form-grid">
          <label class="settings-form-span-2">模型
            <select id="agentSettingsModel" class="settings-field">
              ${renderAgentModelOptions(currentModel)}
            </select>
          </label>
          <label>权限模式
            <select id="agentSettingsPermissionMode" class="settings-field">
              ${renderPermissionModeOptions(narrator.permissionMode || "acceptEdits")}
            </select>
          </label>
          <label>消息数
            <input class="settings-field" value="${escapeAttr(formatNumber(narrator.messageCount || 0))}" readonly />
          </label>
          <label class="settings-form-span-2">工作目录
            <input id="agentSettingsCWD" class="settings-field" value="${escapeAttr(cwd)}" placeholder="例如 /Users/me/project" />
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          <button id="useProjectPathForAgentBtn" class="settings-action-btn subtle" type="button" ${state.project?.gitPath ? "" : "disabled"}>使用项目目录</button>
          <button id="openAgentProviderBtn" class="settings-action-btn subtle" type="button">配置提供商</button>
          <button class="settings-action-btn primary" type="submit" data-agent-submit>保存当前代理</button>
        </div>
      </form>
    </section>
  `;
}

function renderNoAgentSelectedCard() {
  return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">尚未选择代理</div>
          <div class="settings-provider-meta">从左侧选择项目，或点击“选择目录”创建项目后，会在这里显示当前 CodeHarbor 主代理。</div>
        </div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn primary" type="button" data-agent-open-directory>选择目录</button>
      </div>
    </section>
  `;
}

function setSettingsSubmitButtonState(form, selector, submitting, busyLabel) {
  const button = form?.querySelector(selector);
  if (!button) return;
  if (submitting) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  delete button.dataset.originalLabel;
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

function renderPermissionModeOptions(selected) {
  return ["readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk"]
    .map((mode) => `<option value="${escapeAttr(mode)}" ${mode === selected ? "selected" : ""}>${escapeHtml(mode)}</option>`)
    .join("");
}

function renderAgentPolicyCard(title, value, description) {
  return `
    <div class="agent-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
}

function bindAgentSettingsActions() {
  $("agentSettingsForm")?.addEventListener("submit", (event) => saveAgentSettingsFromPanel(event).catch(showError));
  $("refreshAgentSettingsBtn")?.addEventListener("click", () => refreshCurrentAgent().catch(showError));
  $("copyAgentIdBtn")?.addEventListener("click", () => copyText(state.narrator?.id || ""));
  $("useProjectPathForAgentBtn")?.addEventListener("click", () => {
    if ($("agentSettingsCWD") && state.project?.gitPath) $("agentSettingsCWD").value = state.project.gitPath;
  });
  $("openAgentProviderBtn")?.addEventListener("click", () => selectSettingsPanel("providers"));
  document.querySelector("[data-agent-open-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
}

async function refreshCurrentAgent() {
  if (state.agentRefreshing) return;
  if (!state.narrator?.id) throw new Error("请先选择一个代理");
  const id = state.narrator.id;
  const button = $("refreshAgentSettingsBtn");
  state.agentRefreshing = true;
  setButtonBusy(button, true, "刷新中");
  try {
    const updated = await api(`/api/narrators/${id}`);
    if (state.narrator?.id !== id) return;
    state.narrator = updated;
    await enterNarrator();
    if (state.narrator?.id !== id) return;
    showToast("当前代理状态已刷新。", "success");
    refreshActiveSettingsPanel();
  } catch (err) {
    if (state.narrator?.id === id) throw err;
  } finally {
    state.agentRefreshing = false;
    setButtonBusy(button, false, "刷新中");
  }
}

async function saveAgentSettingsFromPanel(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form?.querySelector("[data-agent-submit]");
  if (submitButton?.disabled) return;
  if (!state.narrator?.id) throw new Error("请先选择一个代理");
  const id = state.narrator.id;
  const model = $("agentSettingsModel")?.value.trim() || "";
  const permissionMode = $("agentSettingsPermissionMode")?.value || "acceptEdits";
  const cwd = $("agentSettingsCWD")?.value.trim() || "";
  if (!cwd) throw new Error("请填写工作目录");
  setSettingsSubmitButtonState(form, "[data-agent-submit]", true, "保存中");
  const applyPatch = async (path, payload) => {
    const updated = await api(`/api/narrators/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (state.narrator?.id !== id) return false;
    state.narrator = updated;
    return true;
  };
  try {
    if (model && model !== state.narrator.model) {
      setPreferredModel(model);
      if (!await applyPatch("model", { model })) return;
    }
    if (permissionMode && permissionMode !== state.narrator.permissionMode) {
      if (!await applyPatch("permission-mode", { permissionMode })) return;
    }
    if (cwd && cwd !== state.narrator.cwd) {
      if (!await applyPatch("cwd", { cwd })) return;
    }
    if (state.narrator?.id !== id) return;
    await enterNarrator();
    if (state.narrator?.id !== id) return;
    showToast("当前代理设置已保存。", "success");
    notifyTerminal(`[info] 已保存当前代理：${state.narrator.model}, ${state.narrator.permissionMode}\n`);
    refreshActiveSettingsPanel();
  } catch (err) {
    if (state.narrator?.id === id) throw err;
  } finally {
    setSettingsSubmitButtonState(form, "[data-agent-submit]", false, "保存中");
  }
}

function renderNetworkSearchSettingsContent() {
  const prefs = currentSearchPreferences();
  const allowedCount = prefs.allowedDomains ? prefs.allowedDomains.split("\n").filter(Boolean).length : 0;
  const blockedCount = prefs.blockedDomains ? prefs.blockedDomains.split("\n").filter(Boolean).length : 0;
  return `
    <div class="settings-live-page network-search-page">
      <section class="settings-hero-card network-search-hero-card">
        <div>
          <div class="settings-hero-kicker">网络搜索</div>
          <div class="settings-hero-title">${escapeHtml(prefs.enabled ? searchProviderLabel(prefs.provider) : "搜索未启用")}</div>
          <p>配置未来接入搜索/检索服务时的默认策略。当前仅保存本地偏好，不会主动联网，也不会把查询发送到后端。</p>
        </div>
        <div class="settings-action-row">
          <button id="copySearchPrefsBtn" class="settings-action-btn subtle" type="button">复制配置</button>
          <button id="resetSearchPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.enabled ? "开启" : "关闭")}</strong><span>搜索权限</span></div>
        <div><strong>${escapeHtml(searchProviderLabel(prefs.provider))}</strong><span>提供商</span></div>
        <div><strong>${escapeHtml(formatNumber(prefs.maxResults))}</strong><span>默认结果数</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">搜索策略</div>
            <div class="settings-provider-meta">为后续接入 DuckDuckGo、Brave、Tavily、SearXNG 或自定义搜索网关预留一致配置。</div>
          </div>
          <span class="settings-status-pill ${prefs.enabled ? "ok" : "muted"}">${escapeHtml(prefs.enabled ? "允许搜索" : "仅本地")}</span>
        </div>
        <form id="searchSettingsForm" class="settings-search-form">
          <div class="appearance-toggle-list">
            ${renderSearchToggle("enabled", "允许网络搜索", "总开关；关闭时 Agent/Search UI 应保持本地优先，不主动联网。", prefs.enabled)}
            ${renderSearchToggle("confirmBeforeSearch", "搜索前确认", "建议保持开启，尤其是在查询可能包含项目路径、错误日志或业务信息时。", prefs.confirmBeforeSearch)}
            ${renderSearchToggle("safeSearch", "安全搜索", "让兼容提供商优先返回过滤后的网页结果。", prefs.safeSearch)}
            ${renderSearchToggle("preferGitHub", "优先 GitHub / 开源结果", "适合查找开源库、issue、README 和示例实现。", prefs.preferGitHub)}
          </div>
          <div class="settings-provider-form-grid search-form-grid">
            <label>默认结果数
              <select id="searchMaxResults" class="settings-field">
                ${[3, 5, 10, 20].map((value) => `<option value="${value}" ${prefs.maxResults === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>自定义端点
              <input id="searchCustomEndpoint" class="settings-field" value="${escapeAttr(prefs.customEndpoint)}" placeholder="例如 https://search.example.com/api" />
            </label>
            <label class="settings-form-span-2">允许域名（一行一个，可选）
              <textarea id="searchAllowedDomains" class="settings-field settings-textarea" rows="4" placeholder="github.com\nsourcegraph.com">${escapeHtml(prefs.allowedDomains)}</textarea>
            </label>
            <label class="settings-form-span-2">屏蔽域名（一行一个，可选）
              <textarea id="searchBlockedDomains" class="settings-field settings-textarea" rows="4" placeholder="example-spam.com">${escapeHtml(prefs.blockedDomains)}</textarea>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit">保存搜索策略</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">搜索提供商</div>
            <div class="settings-provider-meta">这里只保存策略，不安装依赖；后续可把开源搜索服务接入后端或 MCP。</div>
          </div>
        </div>
        <div class="search-provider-grid">
          ${renderSearchProviderChoice("duckduckgo", "DuckDuckGo", "无需账号的通用网页搜索预设。", prefs.provider)}
          ${renderSearchProviderChoice("brave", "Brave Search", "适合正式 API key 网关接入。", prefs.provider)}
          ${renderSearchProviderChoice("tavily", "Tavily", "偏 Agent/RAG 工作流的搜索 API。", prefs.provider)}
          ${renderSearchProviderChoice("searxng", "SearXNG", "适合自托管开源 metasearch。", prefs.provider)}
          ${renderSearchProviderChoice("custom", "自定义端点", "连接内部搜索、企业网关或 MCP adapter。", prefs.provider)}
        </div>
      </section>
      <div class="search-policy-grid">
        ${renderSearchPolicyCard("允许域", formatNumber(allowedCount), allowedCount ? "只优先/允许这些域名。" : "未限制允许域。")}
        ${renderSearchPolicyCard("屏蔽域", formatNumber(blockedCount), blockedCount ? "搜索结果应排除这些域名。" : "未配置屏蔽域。")}
        ${renderSearchPolicyCard("隐私", prefs.confirmBeforeSearch ? "先确认" : "直接搜索", "建议搜索前确认敏感查询。")}
      </div>
    </div>
  `;
}

function renderSearchToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row search-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-search-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderSearchProviderChoice(value, title, description, current) {
  return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-search-provider="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
}

function renderSearchPolicyCard(title, value, description) {
  return `
    <section class="search-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </section>
  `;
}

function bindNetworkSearchSettingsActions() {
  $("searchSettingsForm")?.addEventListener("submit", (event) => saveSearchSettingsFromPanel(event).catch(showError));
  $("copySearchPrefsBtn")?.addEventListener("click", () => copyText(searchPrefsExport()));
  $("resetSearchPrefsBtn")?.addEventListener("click", resetSearchPreferences);
  document.querySelectorAll("[data-search-provider]").forEach((node) => {
    node.addEventListener("click", () => {
      saveSearchPreferences({ ...currentSearchPreferences(), provider: node.dataset.searchProvider }, { notify: true });
    });
  });
  document.querySelectorAll("[data-search-toggle]").forEach((node) => {
    node.addEventListener("change", () => {
      saveSearchPreferences({ ...currentSearchPreferences(), [node.dataset.searchToggle]: node.checked }, { notify: true });
    });
  });
}

async function saveSearchSettingsFromPanel(event) {
  event.preventDefault();
  saveSearchPreferences({
    ...currentSearchPreferences(),
    maxResults: Number($("searchMaxResults")?.value || defaultSearchPrefs.maxResults),
    customEndpoint: $("searchCustomEndpoint")?.value || "",
    allowedDomains: $("searchAllowedDomains")?.value || "",
    blockedDomains: $("searchBlockedDomains")?.value || "",
  }, { notify: true });
  notifyTerminal("[info] 网络搜索策略已保存。\n");
}

function renderIMGatewaySettingsContent() {
  const prefs = currentIMGatewayPreferences();
  const allowedCount = prefs.allowedOrigins ? prefs.allowedOrigins.split("\n").filter(Boolean).length : 0;
  const blockedCount = prefs.blockedSenders ? prefs.blockedSenders.split("\n").filter(Boolean).length : 0;
  const enabledEvents = [prefs.allowInboundMessages, prefs.notifyOnTaskDone, prefs.notifyOnErrors, prefs.notifyOnToolCalls].filter(Boolean).length;
  return `
    <div class="settings-live-page im-gateway-page">
      <section class="settings-hero-card im-gateway-hero-card">
        <div>
          <div class="settings-hero-kicker">IM 网关</div>
          <div class="settings-hero-title">${escapeHtml(prefs.enabled ? imGatewayChannelLabel(prefs.channel) : "网关未启用")}</div>
          <p>配置未来连接 IM、Webhook、Bot 或企业消息网关的本地策略。当前只保存浏览器偏好，不启动服务、不暴露公网端点。</p>
        </div>
        <div class="settings-action-row">
          <button id="copyIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">复制配置</button>
          <button id="resetIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.enabled ? "开启" : "关闭")}</strong><span>网关权限</span></div>
        <div><strong>${escapeHtml(imGatewayChannelLabel(prefs.channel))}</strong><span>通道</span></div>
        <div><strong>${escapeHtml(formatNumber(enabledEvents))}</strong><span>启用事件</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">安全策略</div>
            <div class="settings-provider-meta">默认要求确认和签名，避免 IM 消息直接触发本地 Agent 操作。</div>
          </div>
          <span class="settings-status-pill ${prefs.enabled ? "warn" : "muted"}">${escapeHtml(prefs.enabled ? "需要安全网关" : "仅本地预案")}</span>
        </div>
        <form id="imGatewaySettingsForm" class="settings-im-form">
          <div class="appearance-toggle-list">
            ${renderIMGatewayToggle("enabled", "启用 IM 网关策略", "只是打开本地策略开关；当前不会启动监听端口。", prefs.enabled)}
            ${renderIMGatewayToggle("inboundConfirm", "入站消息执行前确认", "建议保持开启，防止聊天消息直接触发写文件或命令。", prefs.inboundConfirm)}
            ${renderIMGatewayToggle("requireSignature", "要求签名校验", "后续 webhook endpoint 应验证签名或 token。", prefs.requireSignature)}
            ${renderIMGatewayToggle("redactSecrets", "发送前脱敏", "对 API key、token、路径等敏感内容进行脱敏。", prefs.redactSecrets)}
          </div>
          <div class="settings-provider-form-grid im-form-grid">
            <label>最大 payload
              <select id="imGatewayMaxPayload" class="settings-field">
                ${[32, 64, 128, 256].map((value) => `<option value="${value}" ${prefs.maxPayloadKB === value ? "selected" : ""}>${value} KB</option>`).join("")}
              </select>
            </label>
            <label>回调 / 网关端点
              <input id="imGatewayEndpoint" class="settings-field" value="${escapeAttr(prefs.endpointUrl)}" placeholder="https://bot.example.com/webhook" />
            </label>
            <label class="settings-form-span-2">允许来源（一行一个，可选）
              <textarea id="imGatewayAllowedOrigins" class="settings-field settings-textarea" rows="4" placeholder="slack-team-id\ndiscord-guild-id">${escapeHtml(prefs.allowedOrigins)}</textarea>
            </label>
            <label class="settings-form-span-2">屏蔽发送者（一行一个，可选）
              <textarea id="imGatewayBlockedSenders" class="settings-field settings-textarea" rows="4" placeholder="user-id@example\nspam-bot">${escapeHtml(prefs.blockedSenders)}</textarea>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit">保存网关策略</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">通道预设</div>
            <div class="settings-provider-meta">后续可接入开源 bot framework、n8n、SearXNG webhook、Mattermost/Matrix adapter 或自托管网关。</div>
          </div>
        </div>
        <div class="im-channel-grid">
          ${renderIMGatewayChannelChoice("webhook", "通用 Webhook", "适合自托管 HTTP webhook 或 n8n。", prefs.channel)}
          ${renderIMGatewayChannelChoice("discord", "Discord", "适合社区 bot 或项目频道。", prefs.channel)}
          ${renderIMGatewayChannelChoice("slack", "Slack", "适合团队工作区 slash command/event。", prefs.channel)}
          ${renderIMGatewayChannelChoice("telegram", "Telegram", "适合个人 bot 或轻量通知。", prefs.channel)}
          ${renderIMGatewayChannelChoice("lark", "飞书 / Lark", "适合企业 IM 和审批流。", prefs.channel)}
          ${renderIMGatewayChannelChoice("wecom", "企业微信", "适合国内企业机器人。", prefs.channel)}
          ${renderIMGatewayChannelChoice("custom", "自定义网关", "连接内部网关或 MCP adapter。", prefs.channel)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">事件路由</div>
            <div class="settings-provider-meta">控制哪些事件可以进入或发出 IM 网关。真实发送逻辑后续由后端/webhook adapter 接入。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderIMGatewayToggle("allowInboundMessages", "允许入站消息", "允许 IM 消息进入待确认队列。", prefs.allowInboundMessages)}
          ${renderIMGatewayToggle("notifyOnTaskDone", "任务完成通知", "Agent 完成后可发送摘要通知。", prefs.notifyOnTaskDone)}
          ${renderIMGatewayToggle("notifyOnErrors", "错误通知", "模型、工具或终端错误可发送提醒。", prefs.notifyOnErrors)}
          ${renderIMGatewayToggle("notifyOnToolCalls", "工具调用通知", "高频事件，默认关闭，适合审计环境。", prefs.notifyOnToolCalls)}
        </div>
      </section>
      <div class="im-policy-grid">
        ${renderIMGatewayPolicyCard("允许来源", formatNumber(allowedCount), allowedCount ? "只接受这些来源。" : "未限制来源。")}
        ${renderIMGatewayPolicyCard("屏蔽发送者", formatNumber(blockedCount), blockedCount ? "会拒绝这些 sender。" : "未配置屏蔽发送者。")}
        ${renderIMGatewayPolicyCard("Payload", `${formatNumber(prefs.maxPayloadKB)} KB`, "建议对长日志做摘要后再发送。")}
      </div>
    </div>
  `;
}

function renderIMGatewayToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row im-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-im-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderIMGatewayChannelChoice(value, title, description, current) {
  return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-im-channel="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
}

function renderIMGatewayPolicyCard(title, value, description) {
  return `
    <section class="im-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </section>
  `;
}

function bindIMGatewaySettingsActions() {
  $("imGatewaySettingsForm")?.addEventListener("submit", (event) => saveIMGatewaySettingsFromPanel(event).catch(showError));
  $("copyIMGatewayPrefsBtn")?.addEventListener("click", () => copyText(imGatewayPrefsExport()));
  $("resetIMGatewayPrefsBtn")?.addEventListener("click", resetIMGatewayPreferences);
  document.querySelectorAll("[data-im-channel]").forEach((node) => {
    node.addEventListener("click", () => saveIMGatewayPreferences({ ...currentIMGatewayPreferences(), channel: node.dataset.imChannel }, { notify: true }));
  });
  document.querySelectorAll("[data-im-toggle]").forEach((node) => {
    node.addEventListener("change", () => saveIMGatewayPreferences({ ...currentIMGatewayPreferences(), [node.dataset.imToggle]: node.checked }, { notify: true }));
  });
}

async function saveIMGatewaySettingsFromPanel(event) {
  event.preventDefault();
  saveIMGatewayPreferences({
    ...currentIMGatewayPreferences(),
    maxPayloadKB: Number($("imGatewayMaxPayload")?.value || defaultIMGatewayPrefs.maxPayloadKB),
    endpointUrl: $("imGatewayEndpoint")?.value || "",
    allowedOrigins: $("imGatewayAllowedOrigins")?.value || "",
    blockedSenders: $("imGatewayBlockedSenders")?.value || "",
  }, { notify: true });
  notifyTerminal("[info] IM 网关策略已保存。\n");
}

function renderNotificationSettingsContent() {
  const prefs = currentNotificationPreferences();
  const enabledCount = [prefs.infoToasts, prefs.successToasts, prefs.warningToasts, prefs.errorToasts].filter(Boolean).length;
  return `
    <div class="settings-live-page notification-page">
      <section class="settings-hero-card notification-hero-card">
        <div>
          <div class="settings-hero-kicker">通知</div>
          <div class="settings-hero-title">${escapeHtml(prefs.toastEnabled ? "Toast 已启用" : "Toast 已关闭")}</div>
          <p>控制本地工作台的弹窗提醒和 UI 操作日志。偏好只保存在当前浏览器，不影响 Agent、PTY 终端和后端运行。</p>
        </div>
        <div class="settings-action-row">
          <button id="testNotificationBtn" class="settings-action-btn primary" type="button">测试通知</button>
          <button id="resetNotificationPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.toastEnabled ? "开启" : "关闭")}</strong><span>弹窗</span></div>
        <div><strong>${escapeHtml(formatNumber(enabledCount))}</strong><span>启用类型</span></div>
        <div><strong>${escapeHtml(notificationDurationLabel(prefs.duration))}</strong><span>显示时长</span></div>
      </div>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">弹窗类型</div>
            <div class="settings-provider-meta">关闭某类 toast 后，相关操作仍会执行，只是不再弹出右上角提示。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("toastEnabled", "启用右上角 Toast", "总开关；关闭后除强制系统反馈外不再弹 toast。", prefs.toastEnabled)}
          ${renderNotificationToggle("infoToasts", "信息提示", "普通说明、复制成功和轻量操作反馈。", prefs.infoToasts)}
          ${renderNotificationToggle("successToasts", "成功提示", "保存、添加、切换等成功反馈。", prefs.successToasts)}
          ${renderNotificationToggle("warningToasts", "警告提示", "删除确认、刷新失败和需要注意的状态。", prefs.warningToasts)}
          ${renderNotificationToggle("errorToasts", "错误提示", "API 错误、校验失败和运行异常。建议保持开启。", prefs.errorToasts)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">通知时长</div>
            <div class="settings-provider-meta">影响自动消失时间；错误提示会比普通提示更久。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderNotificationDurationChoice("short", "短", "适合熟悉流程时减少干扰。", prefs.duration)}
          ${renderNotificationDurationChoice("normal", "标准", "默认节奏，兼顾可见性和不打断。", prefs.duration)}
          ${renderNotificationDurationChoice("long", "长", "适合演示或需要更久阅读提示。", prefs.duration)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">终端提示</div>
            <div class="settings-provider-meta">控制 UI 操作提示是否写入右侧终端日志；真实 PTY 输出和命令回显不受影响。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("terminalNotices", "写入 UI 操作提示", "例如刷新统计、复制、导入凭据等 [info]/[warn]/[error] 日志。", prefs.terminalNotices)}
        </div>
      </section>
    </div>
  `;
}

function renderNotificationToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row notification-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-notification-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderNotificationDurationChoice(value, title, description, current) {
  return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-notification-duration="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
}

function notificationDurationLabel(value) {
  if (value === "short") return "短";
  if (value === "long") return "长";
  return "标准";
}

function bindNotificationSettingsActions() {
  document.querySelectorAll("[data-notification-toggle]").forEach((node) => {
    node.addEventListener("change", () => setNotificationPreference(node.dataset.notificationToggle, node.checked));
  });
  document.querySelectorAll("[data-notification-duration]").forEach((node) => {
    node.addEventListener("click", () => setNotificationPreference("duration", node.dataset.notificationDuration));
  });
  $("testNotificationBtn")?.addEventListener("click", () => {
    showToast("这是一条测试通知。", "info", { force: true });
    notifyTerminal("[info] 测试通知已触发。\n");
  });
  $("resetNotificationPrefsBtn")?.addEventListener("click", resetNotificationPreferences);
}

function renderAppearanceSettingsContent() {
  const prefs = currentAppearancePreferences();
  return `
    <div class="settings-live-page appearance-page">
      <section class="settings-hero-card appearance-hero-card">
        <div>
          <div class="settings-hero-kicker">外观与界面</div>
          <div class="settings-hero-title">${escapeHtml(appearanceThemeLabel(prefs.theme))} · ${escapeHtml(appearanceDensityLabel(prefs.density))}</div>
          <p>这些偏好只保存在当前浏览器，不改服务端配置，适合本地工作台快速调整阅读密度和终端呈现方式。</p>
        </div>
        <div class="appearance-preview-card" aria-hidden="true">
          <div class="appearance-preview-bar"></div>
          <div class="appearance-preview-line wide"></div>
          <div class="appearance-preview-line"></div>
          <div class="appearance-preview-pill"></div>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(appearanceThemeLabel(prefs.theme))}</strong><span>主题</span></div>
        <div><strong>${escapeHtml(appearanceDensityLabel(prefs.density))}</strong><span>布局密度</span></div>
        <div><strong>${escapeHtml(prefs.terminalDefaultOpen ? "默认展开" : "默认收起")}</strong><span>终端</span></div>
      </div>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">视觉主题</div>
            <div class="settings-provider-meta">切换主工作台的深色 / 浅色变量；设置页仍保持高可读白底。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderAppearanceChoice("theme", "dark", "深色工作台", "适合长时间 coding，会保留当前默认质感。", prefs.theme === "dark")}
          ${renderAppearanceChoice("theme", "light", "浅色工作台", "适合白天演示和截图，主界面切到浅色变量。", prefs.theme === "light")}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">布局密度</div>
            <div class="settings-provider-meta">紧凑模式会压缩侧边栏、消息区和输入区间距，适合小屏或并排窗口。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderAppearanceChoice("density", "comfortable", "舒适", "保持更宽松的行距和点击区域。", prefs.density === "comfortable")}
          ${renderAppearanceChoice("density", "compact", "紧凑", "减少留白，在同屏显示更多项目和消息。", prefs.density === "compact")}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">界面行为</div>
            <div class="settings-provider-meta">控制启动时终端是否默认展开，以及 Agent WebSocket 事件是否写入终端日志。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderAppearanceToggle("terminalDefaultOpen", "启动后展开终端", "关闭后，下次刷新页面会默认收起右侧终端面板。", prefs.terminalDefaultOpen)}
          ${renderAppearanceToggle("showEventLog", "显示 Agent 事件日志", "关闭后会隐藏 [event] 类型日志，但不会影响真实终端输出。", prefs.showEventLog)}
        </div>
      </section>
    </div>
  `;
}

function renderAppearanceChoice(field, value, title, description, active) {
  return `
    <button class="appearance-choice ${active ? "active" : ""}" type="button" data-appearance-field="${escapeAttr(field)}" data-appearance-value="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
}

function renderAppearanceToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-appearance-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function appearanceThemeLabel(value) {
  return value === "light" ? "浅色" : "深色";
}

function appearanceDensityLabel(value) {
  return value === "compact" ? "紧凑" : "舒适";
}

function bindAppearanceSettingsActions() {
  document.querySelectorAll("[data-appearance-field]").forEach((node) => {
    node.addEventListener("click", () => setAppearancePreference(node.dataset.appearanceField, node.dataset.appearanceValue));
  });
  document.querySelectorAll("[data-appearance-toggle]").forEach((node) => {
    node.addEventListener("change", () => setAppearancePreference(node.dataset.appearanceToggle, node.checked));
  });
}

function renderAgentAdminSettingsContent() {
  const backends = Array.isArray(state.backends) ? state.backends : [];
  const active = activeBackend();
  const keyedCount = backends.filter((backend) => backend.apiKeyConfigured).length;
  const activeHealth = active && state.backendHealth?.backendId === active.id ? state.backendHealth : null;
  const activeHealthText = activeHealth ? (activeHealth.status || (activeHealth.ok ? "online" : "offline")) : "未检测";
  return `
    <div class="settings-live-page agent-admin-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">代理管理</div>
          <div class="settings-hero-title">${escapeHtml(active?.name || "未配置 Agent Server")}</div>
          <p>集中管理兼容 OpenHands Agent Server 的后端，支持检测 /alive、/ready、/server_info，切换当前后端或新增备用端点。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAgentBackendsBtn" class="settings-action-btn primary" type="button">刷新后端</button>
          <button id="openBackendModalFromSettingsBtn" class="settings-action-btn subtle" type="button">弹窗管理</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(backends.length))}</strong><span>后端数量</span></div>
        <div><strong>${escapeHtml(activeHealthText)}</strong><span>当前健康</span></div>
        <div><strong>${escapeHtml(formatNumber(keyedCount))}</strong><span>已配置密钥</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">Agent Server 后端</div>
            <div class="settings-provider-meta">API key 只显示是否配置；不会从 API 回显明文。</div>
          </div>
        </div>
        <div class="settings-backend-list">
          ${backends.length ? backends.map(renderSettingsBackendCard).join("") : `<div class="settings-empty-card compact">还没有后端。添加本地 OpenHands Agent Server URL 后即可检测连通性。</div>`}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">新增后端</div>
            <div class="settings-provider-meta">本地后端常用 http://127.0.0.1:8000；cloud 类型使用 Bearer token。</div>
          </div>
        </div>
        <form id="settingsBackendForm" class="settings-backend-form">
          <div class="settings-provider-form-grid">
            <label>名称<input id="settingsBackendName" class="settings-field" placeholder="Local Agent Server" /></label>
            <label>类型<select id="settingsBackendKind" class="settings-field"><option value="local">local</option><option value="cloud">cloud</option></select></label>
            <label class="settings-form-span-2">URL<input id="settingsBackendBaseUrl" class="settings-field" placeholder="http://127.0.0.1:8000" /></label>
            <label class="settings-form-span-2">API Key<input id="settingsBackendApiKey" class="settings-field" type="password" placeholder="可选；本地使用 X-Session-API-Key" /></label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button id="resetSettingsBackendFormBtn" class="settings-action-btn subtle" type="button">清空</button>
            <button class="settings-action-btn primary" type="submit" data-backend-submit>添加后端</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderSettingsBackendCard(backend) {
  const health = state.backendHealth?.backendId === backend.id ? state.backendHealth : null;
  const healthText = health ? (health.status || (health.ok ? "online" : "offline")) : "未检测";
  const pendingDelete = state.backendDeleteConfirmId === backend.id;
  return `
    <div class="settings-backend-card ${backend.active ? "active" : ""} ${pendingDelete ? "confirm-delete" : ""}">
      <div class="settings-backend-main">
        <div class="settings-backend-title">
          ${escapeHtml(backend.name || "Agent Server")}
          ${backend.active ? "<span class='settings-status-pill ok'>active</span>" : ""}
          <span class="settings-status-pill ${backendHealthPillClass(health)}">${escapeHtml(healthText)}</span>
        </div>
        <div class="settings-provider-meta path">${escapeHtml(backend.baseUrl || "未配置 URL")}</div>
        <div class="settings-backend-meta">${escapeHtml(backend.kind || "local")} · ${backend.apiKeyConfigured ? "API key 已配置" : "无 API key"} · 更新于 ${escapeHtml(formatTimestamp(backend.updatedAt))}</div>
        ${health?.error ? `<div class="settings-inline-alert compact">${escapeHtml(health.error)}</div>` : ""}
        ${health?.checks?.length ? renderBackendHealthChecks(health.checks) : ""}
      </div>
      <div class="settings-backend-actions">
        ${renderBackendActionButton({ backendId: backend.id, action: "test", dataAttr: "settings-backend-test", label: "检测", busyLabel: "检测中", className: "settings-action-btn subtle" })}
        ${backend.active ? "" : renderBackendActionButton({ backendId: backend.id, action: "activate", dataAttr: "settings-backend-activate", label: "设为当前", busyLabel: "切换中", className: "settings-action-btn subtle" })}
        ${renderBackendActionButton({ backendId: backend.id, action: "delete", dataAttr: "settings-backend-delete", label: pendingDelete ? "确认删除" : "删除", busyLabel: "删除中", className: `settings-action-btn danger ${pendingDelete ? "confirm" : ""}` })}
      </div>
    </div>
  `;
}

function backendHealthPillClass(health) {
  if (!health) return "";
  if (health.ok) return "ok";
  if (health.status === "initializing") return "warn";
  return "warn";
}

function renderBackendHealthChecks(checks) {
  return `
    <div class="settings-backend-checks">
      ${checks.map((check) => `
        <div class="settings-backend-check ${check.ok ? "ok" : "warn"}">
          <span>${escapeHtml(check.name || "check")}</span>
          <strong>${escapeHtml(check.statusCode ? String(check.statusCode) : (check.error || "—"))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function bindAgentAdminSettingsActions() {
  $("refreshAgentBackendsBtn")?.addEventListener("click", () => loadBackends().catch(showError));
  $("openBackendModalFromSettingsBtn")?.addEventListener("click", openBackendsModal);
  $("settingsBackendForm")?.addEventListener("submit", (event) => saveSettingsBackend(event).catch(showError));
  $("resetSettingsBackendFormBtn")?.addEventListener("click", resetSettingsBackendForm);
  document.querySelectorAll("[data-settings-backend-test]").forEach((node) => {
    node.addEventListener("click", () => testBackend(node.dataset.settingsBackendTest).catch(showError));
  });
  document.querySelectorAll("[data-settings-backend-activate]").forEach((node) => {
    node.addEventListener("click", () => activateBackend(node.dataset.settingsBackendActivate).catch(showError));
  });
  document.querySelectorAll("[data-settings-backend-delete]").forEach((node) => {
    node.addEventListener("click", () => requestDeleteBackend(node.dataset.settingsBackendDelete).catch(showError));
  });
}

async function saveSettingsBackend(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form?.querySelector("[data-backend-submit]");
  if (submitButton?.disabled) return;
  const payload = {
    name: $("settingsBackendName").value.trim(),
    kind: $("settingsBackendKind").value,
    baseUrl: $("settingsBackendBaseUrl").value.trim(),
    apiKey: $("settingsBackendApiKey").value.trim(),
    active: state.backends.length === 0,
  };
  if (!payload.baseUrl) throw new Error("请填写后端 URL");
  setBackendFormSubmitting(form, true);
  try {
    await api("/api/backends", { method: "POST", body: JSON.stringify(payload) });
    state.backendDeleteConfirmId = "";
    resetSettingsBackendForm();
    showToast("后端已添加。", "success");
    await loadBackends();
  } finally {
    setBackendFormSubmitting(form, false);
  }
}

function resetSettingsBackendForm() {
  if ($("settingsBackendName")) $("settingsBackendName").value = "";
  if ($("settingsBackendKind")) $("settingsBackendKind").value = "local";
  if ($("settingsBackendBaseUrl")) $("settingsBackendBaseUrl").value = "";
  if ($("settingsBackendApiKey")) $("settingsBackendApiKey").value = "";
}

function renderChaptersSettingsContent() {
  const chapters = Array.isArray(state.projectChapters) ? state.projectChapters : [];
  const narrators = Array.isArray(state.chapterNarrators) ? state.chapterNarrators : [];
  const rootChapter = chapters.find((chapter) => chapter.isRoot) || chapters[0] || null;
  return `
    <div class="settings-live-page chapters-page">
      <section class="settings-hero-card chapters-hero-card">
        <div>
          <div class="settings-hero-kicker">章节与容器</div>
          <div class="settings-hero-title">${escapeHtml(state.project?.name || "未选择项目")}</div>
          <p>查看当前项目的章节/workline、root chapter、叙述者和隔离状态。当前版本不创建容器，只展示本地工作目录和后续扩展边界。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshChaptersBtn" class="settings-action-btn primary" type="button" ${state.project?.id ? "" : "disabled"}>刷新章节</button>
          <button id="openChaptersDirectoryBtn" class="settings-action-btn subtle" type="button">选择目录</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(chapters.length))}</strong><span>章节</span></div>
        <div><strong>${escapeHtml(formatNumber(narrators.length))}</strong><span>当前章节 CodeHarbor</span></div>
        <div><strong>${escapeHtml(rootChapter?.title || "暂无")}</strong><span>Root chapter</span></div>
      </div>
      ${state.chaptersError ? `<div class="settings-inline-alert">${escapeHtml(state.chaptersError)}</div>` : ""}
      ${state.project ? renderProjectChapterSummary(chapters, narrators) : renderNoProjectForChapters()}
    </div>
  `;
}

function renderNoProjectForChapters() {
  return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">尚未选择项目</div>
          <div class="settings-provider-meta">请先从左侧选择项目，或选择一个本地目录创建项目。</div>
        </div>
      </div>
      <button class="settings-action-btn primary" type="button" data-open-project-directory>选择目录</button>
    </section>
  `;
}

function renderProjectChapterSummary(chapters, narrators) {
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("项目状态", state.project?.status || "active", state.project?.gitPath || "未配置路径")}
      ${renderUsageMetricCard("当前章节", state.chapter?.title || "暂无", state.chapter?.role || "root")}
      ${renderUsageMetricCard("当前代理", state.narrator?.title || "暂无", state.narrator?.permissionMode || "未选择")}
      ${renderUsageMetricCard("Flow mode", state.project?.flowMode || "default", "项目工作流模式")}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">章节 / 工作线</div>
          <div class="settings-provider-meta path">${escapeHtml(state.project?.gitPath || "未配置项目路径")}</div>
        </div>
      </div>
      <div class="chapter-list">
        ${chapters.length ? chapters.map(renderChapterCard).join("") : `<div class="settings-empty-card compact">当前项目还没有章节记录。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前章节 CodeHarbor</div>
          <div class="settings-provider-meta">来自 `/api/chapters/{id}/narrators`；用于确认主代理、子代理和工作目录。</div>
        </div>
      </div>
      <div class="chapter-narrator-list">
        ${narrators.length ? narrators.map(renderChapterNarratorCard).join("") : `<div class="settings-empty-card compact">当前章节暂无 CodeHarbor 代理。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">容器与隔离边界</div>
          <div class="settings-provider-meta">当前 MVP 以本地目录/工作树为主，容器运行、远程 sandbox 和 worktree merge 会在后续阶段接入。</div>
        </div>
        <span class="settings-status-pill muted">本地目录模式</span>
      </div>
      <div class="chapter-boundary-grid">
        ${renderChapterBoundaryCard("工作目录", state.narrator?.cwd || state.project?.gitPath || "未设置", "工具和终端围绕该路径运行。")}
        ${renderChapterBoundaryCard("Branch", state.chapter?.branch || "未绑定", "后续 Git worktree/branch 管理预留。")}
        ${renderChapterBoundaryCard("Worktree", state.chapter?.worktreePath || "未启用", "当前未自动创建隔离 worktree。")}
        ${renderChapterBoundaryCard("Base", state.chapter?.baseBranch || "未设置", "后续 merge/review 可使用。")}
      </div>
    </section>
  `;
}

function renderChapterCard(chapter) {
  const active = chapter.id === state.chapter?.id;
  return `
    <div class="chapter-card ${active ? "active" : ""}">
      <div>
        <div class="chapter-title">${escapeHtml(chapter.title || "Untitled chapter")} ${chapter.isRoot ? "<span class='settings-status-pill ok'>root</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(chapter.role || "chapter")} · ${escapeHtml(chapter.status || "active")} · ${escapeHtml(formatTimestamp(chapter.updatedAt))}</div>
        <div class="settings-provider-meta path">${escapeHtml(chapter.worktreePath || chapter.branch || state.project?.gitPath || "未绑定路径")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-chapter="${escapeAttr(chapter.id)}">查看</button>
      </div>
    </div>
  `;
}

function renderChapterNarratorCard(narrator) {
  const active = narrator.id === state.narrator?.id;
  return `
    <div class="chapter-narrator-card ${active ? "active" : ""}">
      <div>
        <div class="chapter-title">${escapeHtml(narrator.title || state.project?.name || "CodeHarbor")} ${active ? "<span class='settings-status-pill ok'>current</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(narrator.type || "primary")} · ${escapeHtml(narrator.status || "idle")} · ${escapeHtml(narrator.permissionMode || "acceptEdits")}</div>
        <div class="settings-provider-meta path">${escapeHtml(narrator.cwd || state.project?.gitPath || "未设置工作目录")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-narrator="${escapeAttr(narrator.id)}">设为当前</button>
      </div>
    </div>
  `;
}

function renderChapterBoundaryCard(title, value, description) {
  return `
    <div class="chapter-boundary-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
}

function bindChaptersSettingsActions() {
  $("refreshChaptersBtn")?.addEventListener("click", () => loadChapterContainerData({ notify: true }).catch(showError));
  $("openChaptersDirectoryBtn")?.addEventListener("click", (event) => openDirectoryChooser(state.project?.gitPath || "", { trigger: event.currentTarget }).catch(showError));
  document.querySelector("[data-open-project-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
  document.querySelectorAll("[data-select-chapter]").forEach((node) => {
    node.addEventListener("click", () => selectChapterFromSettings(node.dataset.selectChapter).catch(showError));
  });
  document.querySelectorAll("[data-select-narrator]").forEach((node) => {
    node.addEventListener("click", () => selectNarratorFromSettings(node.dataset.selectNarrator).catch(showError));
  });
  if (state.project?.id && !state.projectChapters.length && !state.chaptersError) {
    loadChapterContainerData().catch(showError);
  }
}

async function selectChapterFromSettings(chapterID) {
  saveCurrentChatDraft();
  hideSlashCommandPalette();
  const chapter = state.projectChapters.find((item) => item.id === chapterID);
  if (!chapter) return;
  const projectId = state.project?.id || "";
  disconnectNarratorTransports();
  state.chapter = chapter;
  state.narrator = null;
  syncMessageComposerBusy();
  try {
    const narrators = await api(`/api/chapters/${chapter.id}/narrators`);
    if (state.project?.id !== projectId || state.chapter?.id !== chapterID) return;
    state.chapterNarrators = Array.isArray(narrators) ? narrators : [];
    state.narrator = state.chapterNarrators.find((narrator) => narrator.type === "primary") || state.chapterNarrators[0] || state.narrator;
    if (state.narrator) await enterNarrator();
    if (state.project?.id !== projectId || state.chapter?.id !== chapterID) return;
    refreshActiveSettingsPanel();
  } catch (err) {
    if (state.project?.id === projectId && state.chapter?.id === chapterID) throw err;
  }
}

async function selectNarratorFromSettings(narratorID) {
  saveCurrentChatDraft();
  hideSlashCommandPalette();
  const narrator = state.chapterNarrators.find((item) => item.id === narratorID);
  if (!narrator) return;
  const chapterId = state.chapter?.id || "";
  state.narrator = narrator;
  await enterNarrator();
  if (state.chapter?.id !== chapterId || state.narrator?.id !== narratorID) return;
  refreshActiveSettingsPanel();
}

function renderServerSystemSettingsContent() {
  const summary = state.runtimeSummary;
  const server = summary?.server || {};
  const process = summary?.process || {};
  const go = summary?.go || {};
  const address = server.address || `${state.settings?.server?.host || "localhost"}:${state.settings?.server?.port || "7788"}`;
  return `
    <div class="settings-live-page runtime-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">服务器与系统</div>
          <div class="settings-hero-title">${escapeHtml(address)}</div>
          <p>查看本地服务监听地址、版本、配置路径和 Go 运行环境。该面板只读取当前进程状态，不写入配置。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(summary?.version || state.settings?.version || "0.1.0-dev")}</strong><span>版本</span></div>
        <div><strong>${escapeHtml(process.pid ? `#${process.pid}` : "暂无")}</strong><span>进程 ID</span></div>
        <div><strong>${escapeHtml(go.version || "未加载")}</strong><span>Go 版本</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderServerSystemSummary(summary) : `<div class="settings-empty-card">正在加载服务器与系统状态。如果长时间没有变化，请点击“刷新状态”。</div>`}
    </div>
  `;
}

function renderServerSystemSummary(summary) {
  const server = summary.server || {};
  const process = summary.process || {};
  const go = summary.go || {};
  const providers = summary.providers || {};
  const backends = summary.backends || {};
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("监听地址", server.address || "未配置", "当前 Web UI 与 API 服务地址")}
      ${renderUsageMetricCard("运行时长", formatUptime(process.uptimeSeconds || 0), `启动：${formatTimestamp(process.startedAt)}`)}
      ${renderUsageMetricCard("CPU", go.cpus || 0, `${go.os || "unknown"}/${go.arch || "unknown"}`)}
      ${renderUsageMetricCard("Provider", providers.total || 0, `${formatNumber(providers.configured || 0)} 个已配置`)}
      ${renderUsageMetricCard("后端种子", backends.configured || 0, `${formatNumber(backends.active || 0)} 个默认启用`)}
      ${renderUsageMetricCard("生成时间", formatTimestamp(summary.generatedAt), "点击刷新可重新采样")}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">服务配置</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("Host", server.host || "localhost")}
          ${renderRuntimeKeyValue("Port", server.port || 7788)}
          ${renderRuntimeKeyValue("Config", server.configPath || "未配置")}
          ${renderRuntimeKeyValue("Executable", process.executable || "未知")}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">本地路径</div>
        <div class="runtime-kv-list">
          ${(summary.paths || []).map((entry) => renderRuntimeKeyValue(entry.label || entry.key, entry.path || "未配置")).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderRuntimeSettingsContent() {
  const summary = state.runtimeSummary;
  const memory = summary?.memory || {};
  const go = summary?.go || {};
  const agent = summary?.agent || {};
  return `
    <div class="settings-live-page runtime-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">运行资源</div>
          <div class="settings-hero-title">${escapeHtml(formatBytes(memory.allocBytes || 0))} · ${escapeHtml(formatNumber(go.goroutines || 0))} goroutines</div>
          <p>查看 Go runtime 内存、goroutine、GC 与代理默认限制，适合定位本地服务是否异常膨胀。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(memory.sysBytes || 0))}</strong><span>系统内存</span></div>
        <div><strong>${escapeHtml(formatNumber(go.goroutines || 0))}</strong><span>Goroutines</span></div>
        <div><strong>${escapeHtml(formatNumber(memory.gcCycles || 0))}</strong><span>GC 次数</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderRuntimeResourceSummary(summary) : `<div class="settings-empty-card">正在加载运行资源。如果长时间没有变化，请点击“刷新状态”。</div>`}
    </div>
  `;
}

function renderRuntimeResourceSummary(summary) {
  const memory = summary.memory || {};
  const go = summary.go || {};
  const agent = summary.agent || {};
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("当前分配", formatBytes(memory.allocBytes || 0), "仍在使用的 Go 堆对象")}
      ${renderUsageMetricCard("堆占用", formatBytes(memory.heapInuseBytes || 0), `HeapAlloc ${formatBytes(memory.heapAllocBytes || 0)}`)}
      ${renderUsageMetricCard("栈占用", formatBytes(memory.stackInuseBytes || 0), "当前 goroutine 栈空间")}
      ${renderUsageMetricCard("下次 GC", formatBytes(memory.nextGcBytes || 0), `${formatNumber(memory.gcCycles || 0)} 次 GC`)}
      ${renderUsageMetricCard("Goroutines", go.goroutines || 0, `${formatNumber(go.cpus || 0)} CPU 可用`)}
      ${renderUsageMetricCard("累计分配", formatBytes(memory.totalAllocBytes || 0), "进程启动以来累计")}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">代理默认值</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("默认模型", agent.defaultModel || "未配置")}
          ${renderRuntimeKeyValue("摘要模型", agent.summaryModel || "未配置")}
          ${renderRuntimeKeyValue("默认权限", agent.defaultPermissionMode || "acceptEdits")}
          ${renderRuntimeKeyValue("默认计划模式", agent.defaultStartInPlanMode ? "开启" : "关闭")}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">运行限制</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("最大轮次", formatNumber(agent.maxTurns || 0))}
          ${renderRuntimeKeyValue("首 token 超时", formatDuration(agent.firstTokenTimeoutMs || 0))}
          ${renderRuntimeKeyValue("瞬时重试", formatNumber(agent.maxTransientRetries || 0))}
          ${renderRuntimeKeyValue("采样时间", formatTimestamp(summary.generatedAt))}
        </div>
      </section>
    </div>
  `;
}

function renderRuntimeKeyValue(label, value) {
  return `
    <div class="runtime-kv-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? ""))}</strong>
    </div>
  `;
}

function bindRuntimeSettingsActions() {
  $("refreshRuntimeSummaryBtn")?.addEventListener("click", () => loadRuntimeSummary({ notify: true }).catch(showError));
  if (!state.runtimeSummary && !state.runtimeError) {
    loadRuntimeSummary().catch(showError);
  }
}

function formatUptime(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 s";
  if (value < 60) return `${Math.round(value)} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours} h ${minutes} min`;
}

function renderAboutSettingsContent() {
  const summary = state.licenseSummary;
  const modules = Array.isArray(summary?.modules) ? summary.modules : [];
  const directCount = modules.filter((module) => module.relation === "direct").length;
  const unknownCount = modules.filter((module) => !module.license || module.license === "unknown").length;
  return `
    <div class="settings-live-page about-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">关于 CodeHarbor</div>
          <div class="settings-hero-title">${escapeHtml(state.settings?.version || "0.1.0-dev")}</div>
          <p>本地优先的 Go AI coding agent server。这里展示构建时依赖和许可证，方便发布前做开源合规检查。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshLicensesBtn" class="settings-action-btn primary" type="button">刷新依赖</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(modules.length))}</strong><span>依赖模块</span></div>
        <div><strong>${escapeHtml(formatNumber(directCount))}</strong><span>直接依赖</span></div>
        <div><strong>${escapeHtml(formatNumber(unknownCount))}</strong><span>未知许可证</span></div>
      </div>
      ${renderLocalPreferencesBackupSection()}
      ${state.licenseError ? `<div class="settings-inline-alert">${escapeHtml(state.licenseError)}</div>` : ""}
      ${summary ? renderLicenseSummary(summary) : `<div class="settings-empty-card">正在加载第三方依赖列表。如果长时间没有变化，请点击“刷新依赖”。</div>`}
    </div>
  `;
}

function renderLocalPreferencesBackupSection() {
  const summary = localPreferencesBackupSummary();
  const labels = summary.labels.length ? summary.labels : ["尚无本地偏好"];
  return `
    <section class="settings-provider-section settings-backup-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">本地设置备份</div>
          <div class="settings-provider-meta">导出/导入浏览器 localStorage 中的 CodeHarbor 白名单偏好，用于迁移主题、技能草案、聊天草稿、提示词历史、通知、搜索策略和最近目录。</div>
        </div>
        <div class="settings-action-row compact-actions">
          <button id="copyLocalPrefsBackupBtn" class="settings-action-btn subtle" type="button">复制备份</button>
          <button id="downloadLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">下载备份</button>
        </div>
      </div>
      <div class="settings-backup-stats">
        <div><strong>${escapeHtml(formatNumber(summary.count))}</strong><span>已保存偏好</span></div>
        <div><strong>${escapeHtml(formatBytes(summary.bytes))}</strong><span>估算大小</span></div>
        <div><strong>${escapeHtml(String(localPreferenceBackupVersion))}</strong><span>备份格式</span></div>
      </div>
      <div class="settings-backup-key-list">
        ${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="settings-inline-success">备份不包含 API Key、数据库、项目文件、CLIProxyAPI 凭证文件或后端 registry；导入只会覆盖上述白名单 localStorage 偏好。</div>
      <textarea id="localPrefsImportText" class="settings-token-input settings-backup-import" placeholder='粘贴 codeharbor.local-preferences JSON 后点击“导入备份”'></textarea>
      <div class="settings-action-row settings-form-actions">
        <button id="clearLocalPrefsImportBtn" class="settings-action-btn subtle" type="button">清空输入</button>
        <button id="importLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">导入备份</button>
      </div>
    </section>
  `;
}

function renderLicenseSummary(summary) {
  const modules = Array.isArray(summary.modules) ? summary.modules : [];
  const grouped = groupLicenseModules(modules);
  return `
    <section class="settings-info-card">
      <div class="settings-info-title">合规提示</div>
      <div class="settings-info-text">${escapeHtml(summary.notice || "该列表仅作开发辅助，正式发布前请重新运行完整许可证扫描。")}</div>
    </section>
    <div class="license-group-grid">
      ${Object.entries(grouped).map(([license, items]) => `
        <section class="license-group-card">
          <div class="license-group-head">
            <span>${escapeHtml(license || "unknown")}</span>
            <strong>${escapeHtml(formatNumber(items.length))}</strong>
          </div>
        </section>
      `).join("")}
    </div>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">第三方依赖</div>
          <div class="settings-provider-meta">来自 Go build info；unknown 代表需要发布前人工确认。</div>
        </div>
      </div>
      <div class="license-module-list">
        ${modules.length ? modules.map(renderLicenseModule).join("") : `<div class="settings-empty-card compact">暂无依赖数据。开发运行时可能缺少 build info。</div>`}
      </div>
    </section>
  `;
}

function groupLicenseModules(modules) {
  return modules.reduce((acc, module) => {
    const license = module.license || "unknown";
    acc[license] = acc[license] || [];
    acc[license].push(module);
    return acc;
  }, {});
}

function renderLicenseModule(module) {
  const license = module.license || "unknown";
  return `
    <div class="license-module-row">
      <div>
        <div class="license-module-name">${escapeHtml(module.path || "unknown")}</div>
        <div class="license-module-meta">${escapeHtml(module.version || "版本未知")} · ${escapeHtml(module.relation || "indirect")}</div>
      </div>
      <span class="settings-status-pill ${license === "unknown" ? "warn" : "ok"}">${escapeHtml(license)}</span>
    </div>
  `;
}

function downloadLocalPreferencesBackup() {
  const text = localPreferencesBackupText();
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `codeharbor-local-preferences-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("本地设置备份已下载。", "success", { force: true });
  notifyTerminal("[info] 本地设置备份已下载。\n");
}

async function importLocalPreferencesBackupFromPanel() {
  const textarea = $("localPrefsImportText");
  const button = $("importLocalPrefsBackupBtn");
  const text = textarea?.value.trim() || "";
  if (!text) throw new Error("请先粘贴本地设置备份 JSON");
  setButtonBusy(button, true, "导入中");
  if (textarea) textarea.disabled = true;
  try {
    const imported = restoreLocalPreferencesBackup(text);
    if (textarea) textarea.value = "";
    refreshActiveSettingsPanel();
    showToast(`已导入 ${imported} 项本地设置。`, "success", { force: true });
    notifyTerminal(`[info] 已导入 ${imported} 项本地设置。\n`);
  } finally {
    setButtonBusy(button, false, "导入中");
    if (textarea) textarea.disabled = false;
  }
}

function bindAboutSettingsActions() {
  $("refreshLicensesBtn")?.addEventListener("click", () => loadLicenseSummary({ notify: true }).catch(showError));
  $("copyLocalPrefsBackupBtn")?.addEventListener("click", () => copyText(localPreferencesBackupText()));
  $("downloadLocalPrefsBackupBtn")?.addEventListener("click", downloadLocalPreferencesBackup);
  $("importLocalPrefsBackupBtn")?.addEventListener("click", () => importLocalPreferencesBackupFromPanel().catch(showError));
  $("clearLocalPrefsImportBtn")?.addEventListener("click", () => {
    const textarea = $("localPrefsImportText");
    if (textarea) textarea.value = "";
  });
  if (!state.licenseSummary && !state.licenseError) {
    loadLicenseSummary().catch(showError);
  }
}

function renderUserSettingsContent() {
  const status = state.authStatus;
  const hasUsers = Boolean(status?.hasUsers);
  const registrationOpen = Boolean(status?.registrationOpen);
  return `
    <div class="settings-live-page users-page">
      <section class="settings-hero-card users-hero-card">
        <div>
          <div class="settings-hero-kicker">用户管理</div>
          <div class="settings-hero-title">${escapeHtml(hasUsers ? "已有本地用户" : "尚未创建用户")}</div>
          <p>当前版本保持本地开发 MVP 边界：这里先展示账户初始化和注册状态，后续可扩展为用户列表、角色和访问策略。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAuthStatusBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(status ? (hasUsers ? "已初始化" : "未初始化") : "加载中")}</strong><span>用户状态</span></div>
        <div><strong>${escapeHtml(status ? (registrationOpen ? "开放" : "关闭") : "加载中")}</strong><span>注册入口</span></div>
        <div><strong>${escapeHtml(state.settings?.version || "0.1.0-dev")}</strong><span>实例版本</span></div>
      </div>
      ${state.authError ? `<div class="settings-inline-alert">${escapeHtml(state.authError)}</div>` : ""}
      ${status ? renderAuthStatusSummary(status) : `<div class="settings-empty-card">正在加载本地账户状态。如果长时间没有变化，请点击“刷新状态”。</div>`}
    </div>
  `;
}

function renderAuthStatusSummary(status) {
  const hasUsers = Boolean(status.hasUsers);
  const registrationOpen = Boolean(status.registrationOpen);
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("本地用户", hasUsers ? "已存在" : "暂无", hasUsers ? "数据库中已检测到用户记录" : "适合首次启动或纯本地使用")}
      ${renderUsageMetricCard("注册状态", registrationOpen ? "开放" : "关闭", registrationOpen ? "允许初始化/注册流程继续" : "注册入口当前关闭")}
      ${renderUsageMetricCard("认证模式", "本地 MVP", "当前 API 仅暴露状态，不回显敏感信息")}
      ${renderUsageMetricCard("数据来源", "/api/auth/status", "只读状态接口")}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前能力</div>
          <div class="settings-provider-meta">CodeHarbor 仍面向可信本地使用；用户管理页先提供清晰状态与安全边界。</div>
        </div>
        <span class="settings-status-pill ${registrationOpen ? "warn" : "ok"}">${escapeHtml(registrationOpen ? "注册开放" : "注册关闭")}</span>
      </div>
      <div class="user-policy-grid">
        ${renderUserPolicyCard("账号初始化", hasUsers ? "已完成" : "未初始化", hasUsers ? "已存在至少一个本地用户记录。" : "尚未检测到用户，可作为首次初始化提示。")}
        ${renderUserPolicyCard("角色管理", "预留", "后续可接入角色、访问策略和审计日志。")}
        ${renderUserPolicyCard("Secret 安全", "不回显", "该接口不会返回 JWT secret、API key 或用户凭据。")}
        ${renderUserPolicyCard("部署边界", "本地可信", "公开网络部署前应补充完整认证、CSRF 和权限策略。")}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">建议下一步</div>
          <div class="settings-provider-meta">这里记录产品化路线，避免把 MVP 误认为多用户生产环境。</div>
        </div>
      </div>
      <div class="settings-info-text">
        当前页面是只读治理视图。后续如果需要正式多用户，可继续增加用户列表 API、登录会话、角色策略、访问审计和管理员操作确认。
      </div>
    </section>
  `;
}

function renderUserPolicyCard(title, value, description) {
  return `
    <div class="user-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
}

function bindUserSettingsActions() {
  $("refreshAuthStatusBtn")?.addEventListener("click", () => loadAuthStatus({ notify: true }).catch(showError));
  if (!state.authStatus && !state.authError) {
    loadAuthStatus().catch(showError);
  }
}

function renderTerminalSettingsContent() {
  const prefs = currentTerminalPreferences();
  const stats = terminalOutputStats();
  const collapsed = $("appShell")?.classList.contains("terminal-collapsed") || false;
  const wsLabel = terminalConnectionLabel();
  const cwd = state.narrator?.cwd || state.project?.gitPath || "未选择代理";
  return `
    <div class="settings-live-page terminal-settings-page">
      <section class="settings-hero-card terminal-hero-card">
        <div>
          <div class="settings-hero-kicker">终端管理</div>
          <div class="settings-hero-title">${escapeHtml(wsLabel)} · ${escapeHtml(collapsed ? "面板已收起" : "面板已展开")}</div>
          <p>管理当前 AI 代理的交互式 PTY 终端，支持重连、清空、复制输出和控制本地输出保留策略。</p>
        </div>
        <div class="settings-action-row">
          <button id="terminalReconnectSettingsBtn" class="settings-action-btn primary" type="button">重连终端</button>
          <button id="terminalFocusSettingsBtn" class="settings-action-btn subtle" type="button">聚焦终端</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(wsLabel)}</strong><span>连接状态</span></div>
        <div><strong>${escapeHtml(formatNumber(stats.lines))}</strong><span>输出行数</span></div>
        <div><strong>${escapeHtml(formatNumber(stats.chars))}</strong><span>字符数</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">当前会话</div>
            <div class="settings-provider-meta path">${escapeHtml(cwd)}</div>
          </div>
          <span class="settings-status-pill ${state.narrator ? "ok" : "warn"}">${escapeHtml(state.narrator ? "已选择代理" : "未选择代理")}</span>
        </div>
        <div class="terminal-control-grid">
          <button class="terminal-control-card" type="button" data-terminal-action="reconnect">
            <span>重连</span><small>重新建立 `/ws/terminal` 连接。</small>
          </button>
          <button class="terminal-control-card" type="button" data-terminal-action="toggle">
            <span>${escapeHtml(collapsed ? "展开" : "收起")}</span><small>切换右侧终端面板显示状态。</small>
          </button>
          <button class="terminal-control-card" type="button" data-terminal-action="clear">
            <span>清空</span><small>清空当前浏览器中的终端输出。</small>
          </button>
          <button class="terminal-control-card" type="button" data-terminal-action="copy">
            <span>复制</span><small>复制当前终端输出到剪贴板。</small>
          </button>
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">本地终端偏好</div>
            <div class="settings-provider-meta">只保存在当前浏览器，不影响后端 PTY 会话和项目配置。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderTerminalToggle("clearOnReconnect", "重连时清空输出", "保持当前默认行为；关闭后重连会追加状态提示并保留旧输出。", prefs.clearOnReconnect)}
          ${renderTerminalToggle("focusOnConnect", "连接后自动聚焦", "终端连接成功后自动聚焦输出区，方便直接输入命令。", prefs.focusOnConnect)}
        </div>
        <div class="terminal-retention-block">
          <div class="settings-provider-title small">输出保留行数</div>
          <div class="appearance-choice-grid terminal-retention-grid">
            ${[1000, 3000, 5000, 10000].map((value) => renderTerminalMaxLineChoice(value, prefs.maxLines)).join("")}
          </div>
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">快捷键提示</div>
            <div class="settings-provider-meta">终端输出区聚焦后会把按键直接发送到 PTY。</div>
          </div>
        </div>
        <div class="terminal-shortcut-grid">
          ${renderTerminalShortcut("Enter", "发送回车")}
          ${renderTerminalShortcut("Ctrl + C", "中断当前命令")}
          ${renderTerminalShortcut("Tab", "补全")}
          ${renderTerminalShortcut("方向键", "历史/光标移动")}
          ${renderTerminalShortcut("粘贴", "发送剪贴板文本")}
          ${renderTerminalShortcut("重连", "重新同步窗口大小")}
        </div>
      </section>
    </div>
  `;
}

function terminalConnectionLabel() {
  if (!state.terminalWS) return state.narrator ? "未连接" : "未选择代理";
  if (state.terminalWS.readyState === WebSocket.OPEN) return "connected";
  if (state.terminalWS.readyState === WebSocket.CONNECTING) return "connecting";
  if (state.terminalWS.readyState === WebSocket.CLOSING) return "closing";
  return state.terminalStatus || "closed";
}

function renderTerminalToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row terminal-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-terminal-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderTerminalMaxLineChoice(value, current) {
  return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-terminal-max-lines="${escapeAttr(value)}">
      <span>${escapeHtml(formatNumber(value))}</span>
      <small>最多保留 ${escapeHtml(formatNumber(value))} 行终端输出。</small>
    </button>
  `;
}

function renderTerminalShortcut(keys, description) {
  return `<div class="terminal-shortcut-card"><strong>${escapeHtml(keys)}</strong><span>${escapeHtml(description)}</span></div>`;
}

function bindTerminalSettingsActions() {
  $("terminalReconnectSettingsBtn")?.addEventListener("click", reconnectTerminalFromSettings);
  $("terminalFocusSettingsBtn")?.addEventListener("click", focusTerminalPanel);
  document.querySelectorAll("[data-terminal-action]").forEach((node) => {
    node.addEventListener("click", () => handleTerminalSettingsAction(node.dataset.terminalAction).catch(showError));
  });
  document.querySelectorAll("[data-terminal-toggle]").forEach((node) => {
    node.addEventListener("change", () => setTerminalPreference(node.dataset.terminalToggle, node.checked));
  });
  document.querySelectorAll("[data-terminal-max-lines]").forEach((node) => {
    node.addEventListener("click", () => setTerminalPreference("maxLines", node.dataset.terminalMaxLines));
  });
}

async function handleTerminalSettingsAction(action) {
  if (action === "reconnect") reconnectTerminalFromSettings();
  if (action === "toggle") toggleTerminal(!$('appShell').classList.contains("terminal-collapsed"));
  if (action === "clear") clearTerminalOutput();
  if (action === "copy") await copyTerminalOutput();
  if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
}

function renderStorageSettingsContent() {
  const summary = state.storageSummary;
  const entries = Array.isArray(summary?.entries) ? summary.entries : [];
  const dbEntry = storageEntryByKey(entries, "database");
  const projectEntry = storageEntryByKey(entries, "projects");
  const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : "尚未扫描";
  return `
    <div class="settings-live-page storage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">储存空间</div>
          <div class="settings-hero-title">本地路径与容量概览</div>
          <p>检查 CodeHarbor home、SQLite 数据库、配置文件和默认项目目录的存在状态、大小和扫描是否被上限截断。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshStorageSummaryBtn" class="settings-action-btn primary" type="button">刷新储存统计</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(summary?.totalKnownBytes || 0))}</strong><span>已知占用</span></div>
        <div><strong>${escapeHtml(formatBytes(dbEntry?.sizeBytes || 0))}</strong><span>数据库文件</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>扫描时间</span></div>
      </div>
      ${state.storageError ? `<div class="settings-inline-alert">${escapeHtml(state.storageError)}</div>` : ""}
      ${summary ? renderStorageSummary(summary, projectEntry) : `<div class="settings-empty-card">正在加载储存空间统计。如果长时间没有变化，请点击“刷新储存统计”。</div>`}
    </div>
  `;
}

function renderStorageSummary(summary, projectEntry) {
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("扫描上限", summary.scanLimit || 0, "每个目录最多扫描的条目数")}
      ${renderUsageMetricCard("项目目录文件", projectEntry?.fileCount || 0, `${formatBytes(projectEntry?.sizeBytes || 0)} · ${projectEntry?.truncated ? "已截断" : "完整扫描"}`)}
      ${renderUsageMetricCard("目录数量", entries.reduce((sum, entry) => sum + Number(entry.directoryCount || 0), 0), "跨所有储存条目")}
      ${renderUsageMetricCard("文件数量", entries.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0), "跨所有储存条目")}
    </div>
    <div class="storage-entry-list">
      ${entries.map(renderStorageEntry).join("")}
    </div>
  `;
}

function renderStorageEntry(entry) {
  const status = entry.error ? entry.error : (entry.exists ? (entry.truncated ? "已扫描部分内容" : "已扫描") : "路径不存在");
  return `
    <section class="storage-entry-card">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(storageEntryLabel(entry))}</div>
          <div class="settings-provider-meta path">${escapeHtml(entry.path || "未配置")}</div>
        </div>
        <span class="settings-status-pill ${entry.error ? "warn" : (entry.exists ? "ok" : "muted")}">${escapeHtml(entry.exists ? (entry.truncated ? "部分" : "存在") : "缺失")}</span>
      </div>
      <div class="storage-entry-grid">
        <div><strong>${escapeHtml(formatBytes(entry.sizeBytes || 0))}</strong><span>大小</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.fileCount || 0))}</strong><span>文件</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.directoryCount || 0))}</strong><span>目录</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.entriesScanned || 0))}</strong><span>扫描条目</span></div>
      </div>
      <div class="settings-info-text">${escapeHtml(status)}</div>
    </section>
  `;
}

function storageEntryByKey(entries, key) {
  return (entries || []).find((entry) => entry.key === key) || null;
}

function storageEntryLabel(entry) {
  const labels = {
    home: "CodeHarbor home",
    database: "SQLite 数据库",
    config: "配置文件",
    projects: "默认项目目录",
  };
  return entry.label || labels[entry.key] || entry.key || "储存条目";
}

function bindStorageSettingsActions() {
  $("refreshStorageSummaryBtn")?.addEventListener("click", () => loadStorageSummary({ notify: true }).catch(showError));
  if (!state.storageSummary && !state.storageError) {
    loadStorageSummary().catch(showError);
  }
}

function renderUsageSettingsContent() {
  const summary = state.usageSummary;
  const counts = summary?.counts || {};
  const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : "尚未生成";
  return `
    <div class="settings-live-page usage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">使用历史</div>
          <div class="settings-hero-title">运行统计与活动概览</div>
          <p>基于本地 SQLite 表统计项目、消息、工具调用、模型请求和后台任务，帮助你判断产品使用情况和后续优化重点。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshUsageSummaryBtn" class="settings-action-btn primary" type="button">刷新统计</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(counts.messages || 0))}</strong><span>消息</span></div>
        <div><strong>${escapeHtml(formatNumber(counts.toolCalls || 0))}</strong><span>工具调用</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>统计时间</span></div>
      </div>
      ${state.usageError ? `<div class="settings-inline-alert">${escapeHtml(state.usageError)}</div>` : ""}
      ${summary ? renderUsageSummary(summary) : `<div class="settings-empty-card">正在加载使用统计。如果长时间没有变化，请点击“刷新统计”。</div>`}
    </div>
  `;
}

function renderUsageSummary(summary) {
  const counts = summary.counts || {};
  const api = summary.apiRequests || {};
  const toolCalls = summary.toolCalls || {};
  const backends = summary.backends || {};
  return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("项目", counts.projects, "本地项目工作区")}
      ${renderUsageMetricCard("章节", counts.chapters, "项目下的工作线")}
      ${renderUsageMetricCard("CodeHarbor", counts.narrators, "主代理与子代理")}
      ${renderUsageMetricCard("消息", counts.messages, `最新：${formatTimestamp(summary.messages?.latestAt)}`)}
      ${renderUsageMetricCard("工具调用", counts.toolCalls, `平均耗时：${formatDuration(toolCalls.averageDurationMs || 0)}`)}
      ${renderUsageMetricCard("模型请求", counts.apiRequests, `成本：${formatMoney(api.totalCostUsd || 0)}`)}
      ${renderUsageMetricCard("后端", counts.backends, `${formatNumber(backends.active || 0)} 个启用，${formatNumber(backends.apiKeyConfigured || 0)} 个有密钥`)}
      ${renderUsageMetricCard("后台任务", counts.backgroundTasks, `最新：${formatTimestamp(summary.backgroundTasks?.latestAt)}`)}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">消息角色</div>
        ${renderUsageCountMap(summary.messages?.byRole)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">工具状态</div>
        ${renderUsageCountMap(toolCalls.byStatus)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">热门工具</div>
        ${renderUsageTopTools(toolCalls.topTools)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">模型请求</div>
        <div class="usage-token-grid">
          <div><strong>${escapeHtml(formatNumber(api.inputTokens || 0))}</strong><span>输入 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.outputTokens || 0))}</strong><span>输出 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.reasoningTokens || 0))}</strong><span>推理 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.cachedInputTokens || 0))}</strong><span>缓存输入</span></div>
        </div>
        <div class="settings-info-text">平均耗时 ${escapeHtml(formatDuration(api.averageDurationMs || 0))} · 错误 ${escapeHtml(formatNumber(api.errors || 0))} · 最新 ${escapeHtml(formatTimestamp(api.latestAt))}</div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">请求 Provider</div>
        ${renderUsageCountMap(api.byProvider)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">后台任务状态</div>
        ${renderUsageCountMap(summary.backgroundTasks?.byStatus)}
      </section>
    </div>
  `;
}

function renderUsageMetricCard(title, value, subtitle) {
  return `
    <section class="usage-metric-card">
      <div class="usage-metric-value">${escapeHtml(formatMetricValue(value))}</div>
      <div class="usage-metric-title">${escapeHtml(title)}</div>
      <div class="usage-metric-subtitle">${escapeHtml(subtitle || "—")}</div>
    </section>
  `;
}

function formatMetricValue(value) {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "bigint") return formatNumber(Number(value));
  if (value === null || value === undefined || value === "") return "0";
  return String(value);
}

function renderUsageCountMap(value) {
  const entries = Object.entries(value || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return `<div class="settings-info-text">暂无数据</div>`;
  return `<div class="usage-map-list">${entries.map(([name, count]) => `<div class="usage-map-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(formatNumber(count))}</strong></div>`).join("")}</div>`;
}

function renderUsageTopTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return `<div class="settings-info-text">暂无工具调用</div>`;
  return `<div class="usage-map-list">${tools.map((tool) => `<div class="usage-map-row"><span>${escapeHtml(tool.name)}</span><strong>${escapeHtml(formatNumber(tool.count))}</strong></div>`).join("")}</div>`;
}

function bindUsageSettingsActions() {
  $("refreshUsageSummaryBtn")?.addEventListener("click", () => loadUsageSummary({ notify: true }).catch(showError));
  if (!state.usageSummary && !state.usageError) {
    loadUsageSummary().catch(showError);
  }
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
          <p>Codex 统一走凭证导入；中转站在 CodeHarbor 内填写 API Key、Base URL、协议和默认模型，保存后立即刷新模型列表。</p>
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
              <small>当前保存到 CodeHarbor provider：${escapeHtml(spec.providerName)}</small>
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
          <div class="settings-provider-note">例如 Groq：Provider 填 groq、协议选 OpenAI-compatible、Base URL 填 https://api.groq.com/openai/v1、默认模型填 openai/gpt-oss-20b。保存后模型前缀会是 groq:。</div>
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
  const apiKeyOptional = Boolean(provider.apiKeyOptional || setting.apiKeyOptional || provider.name === "cliproxyapi");
  const envExample = providerEnvExample({ ...provider, type, baseUrl, defaultModel: model });
  const expanded = providerConfigExpanded(`provider:${provider.name}`);
  return `
    <section class="settings-provider-card ${expanded ? "expanded" : "collapsed"}">
      <div class="settings-provider-card-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(providerLabel(provider))}</div>
          <div class="settings-provider-meta">${escapeHtml(type)} · ${escapeHtml(models.length + " 个模型")}</div>
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
              <input class="settings-field" name="baseUrl" value="${escapeAttr(baseUrl)}" placeholder="${escapeAttr(providerBaseURLPlaceholder(type, provider.name))}" />
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
  ].map((item) => `<option value="${escapeAttr(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function providerBaseURLPlaceholder(type, name) {
  if (name === "cliproxyapi") return "http://127.0.0.1:8317/v1";
  if (type === "openai-compatible") return "https://api.example.com/v1";
  if (type === "anthropic") return "留空使用 Anthropic 官方端点";
  return "留空使用 OpenAI 官方端点";
}

function providerEnvExample(provider) {
  const model = provider.defaultModel || provider.model || "your-model";
  const baseURL = provider.baseUrl || providerBaseURLPlaceholder(provider.type, provider.name);
  const rowsByProvider = {
    openai: [`export OPENAI_API_KEY="sk-..."`, `export OPENAI_MODEL="${model}"`],
    anthropic: [`export ANTHROPIC_API_KEY="sk-ant-..."`, `export ANTHROPIC_MODEL="${model}"`],
    cliproxyapi: [`export CLIPROXYAPI_BASE_URL="${baseURL}"`, `export CLIPROXYAPI_MODEL="${model}"`, `# 如果 CLIProxyAPI 启用了客户端 api-keys，再设置：`, `export CLIPROXYAPI_API_KEY="..."`],
    "openai-compatible": [`export OPENAI_COMPATIBLE_BASE_URL="${baseURL}"`, `export OPENAI_COMPATIBLE_API_KEY="sk-..."`, `export OPENAI_COMPATIBLE_MODEL="${model}"`],
  };
  return (rowsByProvider[provider.name] || rowsByProvider[provider.type] || rowsByProvider["openai-compatible"]).join("\n");
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
    refreshActiveSettingsPanel();
    notifyTerminal(`[info] ${providerLabel({ name: providerName })} 配置已保存：${response.message || "已生效"}\n`);
  } finally {
    delete form.dataset.submitting;
    setButtonBusy(saveButton, false, "保存中");
  }
}

function bindModelSettingsActions() {
  $("settingsRefreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
  $("settingsOpenLoginBtn")?.addEventListener("click", () => openSettingsModal("providers"));
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
    node.addEventListener("click", () => copyText(node.dataset.copyText || ""));
  });
  if (!state.providerAuthFiles && !state.providerAuthError) {
    loadProviderAuthFiles({ silent: true }).catch(showError);
  }
}

function allModelOptions() {
  return selectableModelProviders().flatMap((provider) => providerModelList(provider).map((model) => ({ provider, model, value: modelOptionValue(provider, model) })));
}

function providerLabel(provider) {
  if (provider.name === "cliproxyapi") return "CLIProxyAPI";
  if (provider.name === "openai-compatible") return "中转站";
  return provider.name;
}

function providerStatusText(provider) {
  if (provider.error) return "需配置/处理";
  if (provider.configured) return "已就绪";
  return "未配置";
}

async function applyPreferredModel(model) {
  if (state.modelApplying) return;
  const seq = ++state.modelApplySeq;
  const value = String(model || "").trim();
  let narratorId = "";
  state.modelApplying = true;
  setModelApplyButtonsBusy(true);
  try {
    setPreferredModel(value);
    if ($("modelSelect")) {
      if (value) $("modelSelect").value = value;
      renderModelOptions();
    }
    narratorId = state.narrator?.id || "";
    if (narratorId && value && value !== state.narrator.model) {
      const updated = await api(`/api/narrators/${narratorId}/model`, { method: "PATCH", body: JSON.stringify({ model: value }) });
      if (seq !== state.modelApplySeq || state.narrator?.id !== narratorId) return;
      state.narrator = updated;
    }
    if (seq !== state.modelApplySeq) return;
    refreshActiveSettingsPanel();
    notifyTerminal(value ? `[info] 已使用模型：${value}\n` : "[info] 已清除首选模型。\n");
  } catch (err) {
    if (!narratorId || state.narrator?.id === narratorId) throw err;
  } finally {
    if (seq === state.modelApplySeq) state.modelApplying = false;
    setModelApplyButtonsBusy(false);
  }
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text) {
  if (!text) return;
  if (await copyToClipboard(text)) {
    showToast("已复制到剪贴板。", "success");
    notifyTerminal("[info] 已复制到剪贴板。\n");
    return;
  }
  showToast("复制失败，请手动选择文本复制。", "warn");
  notifyTerminal("[warn] 复制到剪贴板失败。\n");
}

function renderSkillSettingsContent(activeKey = "commands") {
  const active = skillTabs.find((tab) => tab.key === activeKey) || skillTabs[0];
  state.activeSkillTab = active.key;
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
        ${renderSkillTabPanel(active)}
      </section>
    </div>
  `;
}

function renderSkillTabPanel(active) {
  if (active.key === "commands") return renderLocalCommandSkills(active);
  if (active.key === "mcp-tools") return renderLocalMCPTools(active);
  if (active.key === "tool-permissions") return renderLocalToolPolicy(active);
  return renderSkillRoadmapPanel(active);
}

function renderLocalCommandSkills(active) {
  const prefs = currentSkillsPreferences();
  return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-workbench-actions">
      <button id="copySkillsConfigBtn" class="settings-action-btn subtle" type="button">复制技能 JSON</button>
      <button id="resetSkillsConfigBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
    </div>
    <div class="skill-command-list">
      ${prefs.commands.length ? prefs.commands.map(renderSkillCommandCard).join("") : `<div class="settings-empty-card compact">暂无本地命令模板。</div>`}
    </div>
    <section class="settings-provider-section">
      <div class="settings-provider-title">新增命令模板</div>
      <form id="skillCommandForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>命令名<input id="skillCommandName" class="settings-field" placeholder="/explain-error" /></label>
          <label>描述<input id="skillCommandDescription" class="settings-field" placeholder="解释错误并给出修复路径" /></label>
          <label class="settings-form-span-2">提示词模板<textarea id="skillCommandPrompt" class="settings-field settings-textarea" rows="5" placeholder="请解释以下错误，指出根因并给出最小修复步骤..."></textarea></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit">添加命令</button></div>
      </form>
    </section>
  `;
}

function renderSkillCommandCard(command) {
  return `
    <div class="skill-command-card ${command.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(command.name)} <span class="settings-status-pill ${command.enabled ? "ok" : "muted"}">${command.enabled ? "启用" : "停用"}</span></div>
        <div class="settings-provider-meta">${escapeHtml(command.description || "无描述")}</div>
        <pre class="skill-command-prompt">${escapeHtml(command.prompt)}</pre>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-skill-copy-command="${escapeAttr(command.id)}">复制</button>
        <button class="settings-action-btn subtle" type="button" data-skill-toggle-command="${escapeAttr(command.id)}">${command.enabled ? "停用" : "启用"}</button>
        <button class="settings-action-btn danger" type="button" data-skill-delete-command="${escapeAttr(command.id)}">删除</button>
      </div>
    </div>
  `;
}

function renderLocalMCPTools(active) {
  const prefs = currentSkillsPreferences();
  return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-command-list">
      ${prefs.mcpServers.length ? prefs.mcpServers.map(renderMCPServerCard).join("") : `<div class="settings-empty-card compact">暂无 MCP server 草案。这里仅保存本地配置草稿，不会启动进程。</div>`}
    </div>
    <section class="settings-provider-section">
      <div class="settings-provider-title">新增 MCP server 草案</div>
      <form id="mcpServerForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>名称<input id="mcpServerName" class="settings-field" placeholder="filesystem" /></label>
          <label>Transport<select id="mcpServerTransport" class="settings-field"><option value="stdio">stdio</option><option value="sse">sse</option><option value="http">http</option></select></label>
          <label class="settings-form-span-2">启动命令 / URL<input id="mcpServerCommand" class="settings-field" placeholder="npx @modelcontextprotocol/server-filesystem ~/projects" /></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit">添加 MCP 草案</button></div>
      </form>
    </section>
  `;
}

function renderMCPServerCard(server) {
  return `
    <div class="skill-command-card ${server.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(server.name || "MCP Server")} <span class="settings-status-pill ${server.enabled ? "ok" : "muted"}">${server.enabled ? "启用草案" : "停用草案"}</span></div>
        <div class="settings-provider-meta">${escapeHtml(server.transport)} · ${escapeHtml(server.command || "未填写命令")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-mcp-toggle="${escapeAttr(server.id)}">${server.enabled ? "停用" : "启用"}</button>
        <button class="settings-action-btn danger" type="button" data-mcp-delete="${escapeAttr(server.id)}">删除</button>
      </div>
    </div>
  `;
}

function renderLocalToolPolicy(active) {
  const policy = currentSkillsPreferences().toolPolicy;
  return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="appearance-toggle-list">
      ${renderSkillPolicyToggle("requireConfirmationForExec", "执行命令前确认", "Bash/exec 类动作建议保持确认。", policy.requireConfirmationForExec)}
      ${renderSkillPolicyToggle("requireConfirmationForWrites", "写入文件前确认", "对 Write/Edit 等动作增加人工确认提醒。", policy.requireConfirmationForWrites)}
      ${renderSkillPolicyToggle("allowReadOnlyByDefault", "默认允许只读工具", "Read/Glob/Grep 等低风险工具默认可用。", policy.allowReadOnlyByDefault)}
      ${renderSkillPolicyToggle("preferPlanForLargeTasks", "大型任务优先计划", "多文件/架构变化先进入计划模式。", policy.preferPlanForLargeTasks)}
    </div>
  `;
}

function renderSkillPolicyToggle(field, title, description, checked) {
  return `
    <label class="appearance-toggle-row skill-policy-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-skill-policy="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderSkillRoadmapPanel(active) {
  return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-roadmap-grid">
      ${renderSkillRoadmapCard(active.label, active.empty)}
      ${renderSkillRoadmapCard("本地优先", "当前先保存浏览器本地草案；后续可接入项目级配置和数据库。")}
      ${renderSkillRoadmapCard("后续接入", "可继续连接 MCP registry、hook runner、子代理模板和权限策略 API。")}
    </div>
  `;
}

function renderSkillRoadmapCard(title, description) {
  return `<section class="skill-roadmap-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></section>`;
}

function bindSkillTabs(activeKey = "commands") {
  const body = $("settingsContentBody");
  body.querySelectorAll("[data-skill-tab]").forEach((node) => {
    node.addEventListener("click", () => {
      state.activeSkillTab = node.dataset.skillTab;
      body.innerHTML = renderSkillSettingsContent(node.dataset.skillTab);
      bindSkillTabs(node.dataset.skillTab);
    });
  });
  $("copySkillsConfigBtn")?.addEventListener("click", () => copyText(skillsPrefsExport()));
  $("resetSkillsConfigBtn")?.addEventListener("click", resetSkillsPreferences);
  $("skillCommandForm")?.addEventListener("submit", (event) => addSkillCommandFromPanel(event).catch(showError));
  $("mcpServerForm")?.addEventListener("submit", (event) => addMCPServerFromPanel(event).catch(showError));
  body.querySelectorAll("[data-skill-copy-command]").forEach((node) => node.addEventListener("click", () => copySkillCommandPrompt(node.dataset.skillCopyCommand).catch(showError)));
  body.querySelectorAll("[data-skill-toggle-command]").forEach((node) => node.addEventListener("click", () => toggleSkillCommand(node.dataset.skillToggleCommand)));
  body.querySelectorAll("[data-skill-delete-command]").forEach((node) => node.addEventListener("click", () => deleteSkillCommand(node.dataset.skillDeleteCommand)));
  body.querySelectorAll("[data-mcp-toggle]").forEach((node) => node.addEventListener("click", () => toggleMCPServer(node.dataset.mcpToggle)));
  body.querySelectorAll("[data-mcp-delete]").forEach((node) => node.addEventListener("click", () => deleteMCPServer(node.dataset.mcpDelete)));
  body.querySelectorAll("[data-skill-policy]").forEach((node) => node.addEventListener("change", () => setSkillPolicy(node.dataset.skillPolicy, node.checked)));
}

async function addSkillCommandFromPanel(event) {
  event.preventDefault();
  const command = normalizeSkillCommand({
    id: localSkillID("cmd"),
    name: $("skillCommandName")?.value || "",
    description: $("skillCommandDescription")?.value || "",
    prompt: $("skillCommandPrompt")?.value || "",
    enabled: true,
  });
  if (!command.name || !command.prompt) throw new Error("请填写命令名和提示词模板");
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({ ...prefs, commands: [command, ...prefs.commands] }, { notify: true });
  notifyTerminal(`[info] 已添加本地命令模板：${command.name}\n`);
}

function toggleSkillCommand(id) {
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({
    ...prefs,
    commands: prefs.commands.map((command) => command.id === id ? { ...command, enabled: !command.enabled } : command),
  }, { notify: true });
}

function deleteSkillCommand(id) {
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({ ...prefs, commands: prefs.commands.filter((command) => command.id !== id) }, { notify: true });
}

async function copySkillCommandPrompt(id) {
  const command = currentSkillsPreferences().commands.find((item) => item.id === id);
  if (!command) throw new Error("命令模板不存在");
  await copyText(command.prompt);
}

async function addMCPServerFromPanel(event) {
  event.preventDefault();
  const server = normalizeMCPServer({
    id: localSkillID("mcp"),
    name: $("mcpServerName")?.value || "",
    transport: $("mcpServerTransport")?.value || "stdio",
    command: $("mcpServerCommand")?.value || "",
    enabled: false,
  });
  if (!server.name || !server.command) throw new Error("请填写 MCP 名称和启动命令 / URL");
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({ ...prefs, mcpServers: [server, ...prefs.mcpServers] }, { notify: true });
  notifyTerminal(`[info] 已添加 MCP server 草案：${server.name}\n`);
}

function toggleMCPServer(id) {
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({
    ...prefs,
    mcpServers: prefs.mcpServers.map((server) => server.id === id ? { ...server, enabled: !server.enabled } : server),
  }, { notify: true });
}

function deleteMCPServer(id) {
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({ ...prefs, mcpServers: prefs.mcpServers.filter((server) => server.id !== id) }, { notify: true });
}

function setSkillPolicy(field, value) {
  const prefs = currentSkillsPreferences();
  saveSkillsPreferences({
    ...prefs,
    toolPolicy: { ...prefs.toolPolicy, [field]: Boolean(value) },
  }, { notify: true });
}

function skillTabLabel(key) {
  return skillTabs.find((tab) => tab.key === key)?.label || key;
}

function cliProxyProviderSummary() {
  const provider = cliProxyProvider();
  if (!provider) return "已内置 cliproxyapi provider；启动 CLIProxyAPI 后点击刷新模型。";
  const count = providerModelList(normalizeModelProvider(provider)).length;
  if (provider.error) return `${provider.error} 当前保留 ${count} 个回退模型。`;
  return `已连接 ${provider.baseUrl || "http://127.0.0.1:8317/v1"}，当前可选 ${count} 个模型；导入/切换凭证后点击刷新模型即可更新。`;
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
      { title: "CLIProxyAPI", text: cliProxyProviderSummary() },
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
  refreshActiveSettingsPanel();
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
  refreshActiveSettingsPanel();
}

function selectedModelValue() {
  return $("modelSelect")?.value || state.narrator?.model || getPreferredModel() || state.settings?.agent?.defaultModel || "";
}

function currentModelValue() {
  return state.narrator?.model || getPreferredModel() || state.settings?.agent?.defaultModel || "";
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
  updateWorkspaceMetaPills();
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
  return {
    name: provider.name || provider.type || "provider",
    type: provider.type || provider.name || "provider",
    baseUrl: provider.baseUrl || "",
    defaultModel: provider.defaultModel || provider.model || "",
    maxTokens: Number(provider.maxTokens || 0),
    models: Array.isArray(provider.models) ? provider.models.filter(Boolean) : [],
    configured: Boolean(provider.configured),
    apiKeyOptional: Boolean(provider.apiKeyOptional),
    managementUrl: provider.managementUrl || "",
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

function isCurrentModelConfigured(modelValue = $("modelSelect")?.value || state.narrator?.model || "") {
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

function modelSetupMessage(modelValue = $("modelSelect")?.value || state.narrator?.model || "") {
  const provider = currentProviderConfig(modelValue);
  const providerName = provider?.name || String(modelValue || "openai").split(":")[0] || "openai";
  if (provider?.error) {
    return `${provider.error} 配置或导入凭证后点击“刷新模型”。`;
  }
  const envByProvider = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    cliproxyapi: "CLIPROXYAPI_API_KEY（仅当 CLIProxyAPI 配置了 api-keys 时需要）",
    "openai-compatible": "OPENAI_COMPATIBLE_API_KEY 或 OPENAI_API_KEY",
  };
  const envName = envByProvider[providerName] || "对应 provider 的 API key 环境变量";
  return `当前模型 ${modelValue || "未选择"} 尚未配置 API Key。可在“设置 → 提供商”粘贴 API Key 立即生效，或在启动 CodeHarbor 前设置 ${envName} 后重启服务。`;
}

function cliProxyProvider() {
  return modelProvidersForUI().find((provider) => provider.name === "cliproxyapi")
    || (state.settings?.providers || []).find((provider) => provider.name === "cliproxyapi")
    || null;
}

function renderEmptyWorkspaceCard({ title = "选择资料夹，让 AI 开始工作", text = "CodeHarbor 会在该资料夹内读取、编辑文件，并按权限执行命令。", action = "选择资料夹", hint = "也可以点击左侧 AI 代理右侧的 ＋。", icon = "☻" } = {}) {
  return `
    <div class="empty-workspace-card">
      <div class="empty-workspace-icon">${escapeHtml(icon)}</div>
      <div class="empty-workspace-title">${escapeHtml(title)}</div>
      <div class="empty-workspace-text">${escapeHtml(text)}</div>
      <button class="empty-workspace-action" type="button" data-open-directory-shortcut="new">${escapeHtml(action)}</button>
      <div class="empty-workspace-hint">${escapeHtml(hint)}</div>
    </div>
  `;
}

function showEmptyWorkspaceState(options = {}) {
  const el = $("messages");
  if (!el) return;
  el.classList.add("empty");
  el.innerHTML = renderEmptyWorkspaceCard(options);
}

function canonicalLocalPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (value.startsWith("/")) return value;
  if (/^Users\//.test(value)) return `/${value}`;
  return value;
}

function shortPath(path) {
  const value = canonicalLocalPath(path);
  if (!value) return "未设置目录";
  const home = "/Users/aaa";
  if (value === home) return "~";
  if (value.startsWith(home + "/")) return `~/${value.slice(home.length + 1)}`;
  return value;
}

function projectPathLabel(path) {
  const value = canonicalLocalPath(path);
  return value || "未设置路径";
}

function permissionLabel(value) {
  const labels = {
    readOnly: "只读",
    acceptEdits: "可编辑",
    bypassPermissions: "自动执行",
    dontAsk: "少询问",
    default: "默认",
  };
  return labels[value] || value || "默认";
}

function currentWorkspaceModel() {
  return state.narrator?.model || selectedModelValue() || currentModelValue() || "未选择模型";
}

function updateWorkspaceMetaPills() {
  const el = $("workspaceMetaPills");
  if (!el) return;
  if (!state.project && !state.narrator) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const cwd = canonicalLocalPath(state.narrator?.cwd || state.project?.gitPath || "");
  const permission = state.narrator?.permissionMode || $("permissionMode")?.value || state.settings?.agent?.defaultPermissionMode || "acceptEdits";
  const model = currentWorkspaceModel();
  el.innerHTML = `
    <span class="workspace-pill" title="${escapeAttr(cwd)}">目录：${escapeHtml(shortPath(cwd))}</span>
    <span class="workspace-pill">权限：${escapeHtml(permissionLabel(permission))}</span>
    <span class="workspace-pill" title="${escapeAttr(model)}">模型：${escapeHtml(model)}</span>
  `;
  el.classList.remove("hidden");
}

async function loadProjects() {
  const seq = ++state.projectsLoadSeq;
  try {
    const projects = await api("/api/projects");
    if (seq !== state.projectsLoadSeq) return;
    state.projects = Array.isArray(projects) ? projects : [];
    renderProjects();
  } catch (err) {
    if (seq === state.projectsLoadSeq) throw err;
  }
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
    el.innerHTML = `
      <button class="project-card project-card-empty" type="button" id="emptyProjectHint" data-open-directory-shortcut="new">
        <div class="project-name">选择资料夹开始</div>
        <div class="project-path">点击 AI 代理右侧 ＋ 或中间按钮</div>
      </button>
    `;
    return;
  }
  if (!projects.length) {
    el.innerHTML = `<div class="empty-list">没有匹配“${escapeHtml(state.projectQuery.trim())}”的项目。</div>`;
    return;
  }
  el.innerHTML = projects.map((project, index) => {
    const active = state.project?.id === project.id;
    const status = active ? "当前" : (index === 0 ? "最近" : "");
    const path = canonicalLocalPath(project.gitPath || project.id);
    const pathLabel = projectPathLabel(path);
    return `
      <button class="project-card ${active ? "active" : ""}" type="button" data-project-id="${escapeAttr(project.id)}">
        <span class="project-active-dot" aria-hidden="true"></span>
        <span class="project-card-main">
          <span class="project-card-top">
            <span class="project-name">${escapeHtml(project.name)}</span>
            ${status ? `<span class="project-badge ${active ? "active" : ""}">${escapeHtml(status)}</span>` : ""}
          </span>
          <span class="project-path" title="${escapeAttr(path)}">${escapeHtml(pathLabel)}</span>
        </span>
      </button>
    `;
  }).join("");
  el.querySelectorAll("[data-project-id]").forEach((node) => {
    node.addEventListener("click", () => selectProject(node.dataset.projectId).catch(showError));
  });
}

async function createProjectFromDirectory(path, options = {}) {
  saveCurrentChatDraft();
  hideSlashCommandPalette();
  if (state.projectCreating) return;
  const normalizedPath = canonicalLocalPath(path);
  if (!normalizedPath) throw new Error("请先选择一个目录");
  const modalOpen = elementVisible("folderModal");
  const button = options.button || (modalOpen ? $("chooseDirectoryBtn") : null);
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const existing = projects.find((project) => normalizePath(project.gitPath) === normalizePath(normalizedPath));
  const seq = ++state.projectCreateSeq;
  state.projectCreating = true;
  const busyText = existing ? "打开中" : "创建中";
  setButtonBusy(button, true, busyText);
  setDirectoryStatus(`${existing ? "正在打开" : "正在创建"}：${normalizedPath}`, "busy");
  showToast(`${existing ? "正在打开" : "正在创建"}资料夹：${shortPath(normalizedPath)}`, "info", { force: true });
  try {
    rememberDirectory(normalizedPath);
    if (existing) {
      if (modalOpen) closeDirectoryModal();
      await selectProject(existing.id);
      showToast(`已打开：${shortPath(normalizedPath)}`, "success", { force: true });
      return;
    }
    const name = basename(normalizedPath) || "Project";
    const model = currentModelValue();
    const created = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, gitPath: normalizedPath, ...(model ? { model } : {}) }),
    });
    if (seq !== state.projectCreateSeq) return;
    if (modalOpen) closeDirectoryModal();
    await loadProjects();
    if (seq !== state.projectCreateSeq) return;
    if (created.project?.id && !state.projects.some((project) => project.id === created.project.id)) {
      state.projects = [created.project, ...state.projects];
    }
    state.project = created.project;
    state.chapter = created.chapter;
    state.narrator = created.narrator;
    state.projectChapters = created.chapter ? [created.chapter] : [];
    state.chapterNarrators = created.narrator ? [created.narrator] : [];
    renderProjects();
    await enterNarrator();
    showToast(`已选择资料夹：${shortPath(created.project?.gitPath || normalizedPath)}`, "success", { force: true });
    appendTerminal(`Created project: ${created.project.name}\nPath: ${created.project.gitPath}\n`);
  } catch (err) {
    if (seq === state.projectCreateSeq) {
      const message = err.message || String(err);
      setDirectoryStatus(`打开失败：${message}`, "error");
      throw err;
    }
  } finally {
    state.projectCreating = false;
    setButtonBusy(button, false, busyText);
  }
}

async function selectProject(id) {
  saveCurrentChatDraft();
  hideSlashCommandPalette();
  closeMobileSidebar();
  state.projectCreateSeq++;
  const seq = ++state.projectSelectSeq;
  disconnectNarratorTransports();
  state.project = state.projects.find((project) => project.id === id) || null;
  state.chapter = null;
  state.narrator = null;
  syncMessageComposerBusy();
  state.currentMessages = [];
  state.messageCopyTexts = [];
  updateConversationCopyButton();
  setMessageInputValue("", { saveDraft: false });
  state.projectChapters = [];
  state.chapterNarrators = [];
  renderProjects();
  if (!state.project) {
    updateWorkspaceMetaPills();
    showEmptyWorkspaceState();
    return;
  }
  $("currentTitle").textContent = state.project.name;
  $("currentMeta").textContent = "正在加载项目…";
  updateWorkspaceMetaPills();
  showEmptyWorkspaceState({
    title: "正在加载项目",
    text: "CodeHarbor 正在准备章节和 AI 代理。",
    action: "选择其他资料夹",
    hint: state.project.gitPath || "",
    icon: "…",
  });
  try {
    const chapters = await api(`/api/projects/${id}/chapters`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id) return;
    state.projectChapters = Array.isArray(chapters) ? chapters : [];
    state.chapter = state.projectChapters[0] || null;
    if (!state.chapter) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = "此项目还没有可用章节";
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: "此项目还没有可用章节", text: "你可以重新选择一个资料夹，或稍后在章节管理中创建工作线。", action: "选择其他资料夹", icon: "◇" });
      return;
    }
    const chapterId = state.chapter.id;
    const narrators = await api(`/api/chapters/${chapterId}/narrators`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id || state.chapter?.id !== chapterId) return;
    state.chapterNarrators = Array.isArray(narrators) ? narrators : [];
    state.narrator = state.chapterNarrators.find((narrator) => narrator.type === "primary") || state.chapterNarrators[0] || null;
    if (!state.narrator) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = "未选择 CodeHarbor 代理";
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: "此章节还没有可用代理", text: "你可以重新选择一个资料夹，或稍后在代理管理中创建代理。", action: "选择其他资料夹", icon: "♧" });
      return;
    }
    await enterNarrator();
    if (seq !== state.projectSelectSeq) return;
  } catch (err) {
    if (seq === state.projectSelectSeq && state.project?.id === id) throw err;
  }
}

async function enterNarrator() {
  if (!state.narrator) return;
  const narratorId = state.narrator.id;
  $("currentTitle").textContent = state.project?.name || state.narrator.title;
  $("currentMeta").textContent = state.narrator.title || "AI 代理已就绪";
  $("permissionMode").value = state.narrator.permissionMode || "acceptEdits";
  updateWorkspaceMetaPills();
  renderModelOptions();
  restoreCurrentChatDraft();
  syncMessageComposerBusy();
  connectWS();
  connectTerminal();
  await loadMessages(narratorId);
}

async function loadMessages(narratorId = state.narrator?.id) {
  if (!narratorId) return;
  let messages = [];
  try {
    messages = await api(`/api/narrators/${narratorId}/messages`);
  } catch (err) {
    if (state.narrator?.id === narratorId) throw err;
    return;
  }
  if (state.narrator?.id !== narratorId) return;
  const el = $("messages");
  state.currentMessages = messages;
  state.messageCopyTexts = messages.map((message) => String(message.contentText || ""));
  updateConversationCopyButton();
  const approvalCards = renderApprovalCardsHTML();
  if (!messages.length && !approvalCards) {
    el.classList.add("empty");
    el.textContent = "还没有消息。输入你的需求开始对话。";
    return;
  }
  el.classList.remove("empty");
  el.innerHTML = `${messages.map((message, index) => `
    <div class="message ${escapeAttr(message.role)}">
      <div class="message-head">
        <div class="message-role">${escapeHtml(message.role)}</div>
        <button class="message-copy-btn" type="button" data-copy-message="${escapeAttr(String(index))}" title="复制消息原文">复制</button>
      </div>
      <div class="message-content">${renderMarkdown(friendlyMessageText(message.contentText || ""))}</div>
      ${renderMessageAttachments(message)}
    </div>
  `).join("")}${approvalCards}`;
  bindMessageActionButtons(el);
  bindApprovalButtons(el);
  bindCopyCodeButtons(el);
  el.scrollTop = el.scrollHeight;
}

function currentApprovalList() {
  const narratorId = state.narrator?.id || "";
  return Object.values(state.pendingToolApprovals || {})
    .filter((item) => item && (!item.narratorId || item.narratorId === narratorId))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function renderApprovalCardsHTML() {
  const approvals = currentApprovalList();
  if (!approvals.length) return "";
  return `
    <div class="approval-stack" data-approval-stack>
      ${approvals.map(renderApprovalCard).join("")}
    </div>
  `;
}

function renderApprovalCard(approval) {
  const risk = approval.risk || "exec";
  const isDanger = risk === "danger";
  const command = approval.command || approval.input?.command || JSON.stringify(approval.input || {});
  const title = isDanger ? "危险命令已被阻止" : "需要批准执行命令";
  const warning = approval.warning || (isDanger ? "该命令被安全策略阻止。" : "请确认命令安全后再允许。");
  return `
    <section class="approval-card ${isDanger ? "danger" : ""}" data-approval-card="${escapeAttr(approval.toolUseId || "")}">
      <div class="approval-card-head">
        <div>
          <div class="approval-title">${escapeHtml(title)}</div>
          <div class="approval-meta">${escapeHtml(approval.toolName || "tool")} · ${escapeHtml(risk)} · ${escapeHtml(shortPath(approval.cwd || state.narrator?.cwd || ""))}</div>
        </div>
        <span class="approval-risk">${escapeHtml(risk)}</span>
      </div>
      <pre class="approval-command">${escapeHtml(command)}</pre>
      <div class="approval-warning">${escapeHtml(warning)}</div>
      ${approval.expiresAt ? `<div class="approval-meta">到期：${escapeHtml(formatTimestamp(approval.expiresAt))}</div>` : ""}
      ${isDanger ? `<div class="approval-blocked-note">后端已硬阻断该命令，无法通过 UI 放行。</div>` : `
        <div class="approval-actions">
          <button class="ghost-btn mini" type="button" data-approval-decision="allow_once" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">允许一次</button>
          <button class="ghost-btn mini" type="button" data-approval-decision="allow_session" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">本次会话都允许</button>
          <button class="ghost-btn mini danger" type="button" data-approval-decision="deny" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">拒绝</button>
        </div>
      `}
    </section>
  `;
}

function renderApprovalCards() {
  const el = $("messages");
  if (!el) return;
  const existing = el.querySelector("[data-approval-stack]");
  if (existing) existing.remove();
  const html = renderApprovalCardsHTML();
  if (!html) return;
  if (el.classList.contains("empty")) {
    el.classList.remove("empty");
    el.innerHTML = html;
  } else {
    el.insertAdjacentHTML("beforeend", html);
  }
  bindApprovalButtons(el);
  el.scrollTop = el.scrollHeight;
}

function bindApprovalButtons(root) {
  root.querySelectorAll("[data-approval-decision]").forEach((button) => {
    button.addEventListener("click", () => approveToolCall(button.dataset.toolUseId, button.dataset.approvalDecision, button));
  });
}

async function approveToolCall(toolUseId, decision, button) {
  if (!state.narrator?.id || !toolUseId || !decision) return;
  const approval = state.pendingToolApprovals?.[toolUseId];
  const buttons = button?.closest(".approval-card")?.querySelectorAll("button") || [];
  buttons.forEach((node) => { node.disabled = true; });
  try {
    await api(`/api/narrators/${state.narrator.id}/tool-calls/${encodeURIComponent(toolUseId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision, reason: decision === "deny" ? "denied in UI" : "approved in UI" }),
    });
    const next = { ...(state.pendingToolApprovals || {}) };
    delete next[toolUseId];
    state.pendingToolApprovals = next;
    renderApprovalCards();
    showToast(decision === "deny" ? "已拒绝工具执行。" : "已批准工具执行。", decision === "deny" ? "warn" : "success");
    notifyTerminal(`[tool] ${decision}: ${approval?.toolName || "tool"} ${toolUseId}\n`);
    scheduleMessageRefresh(120, state.narrator.id);
  } catch (err) {
    buttons.forEach((node) => { node.disabled = false; });
    showError(err);
  }
}

function rememberToolApproval(event) {
  const data = event.data || {};
  const toolUseId = data.toolUseId || data.tool_use_id;
  if (!toolUseId) return;
  state.pendingToolApprovals = {
    ...(state.pendingToolApprovals || {}),
    [toolUseId]: {
      ...data,
      narratorId: event.narratorId || state.narrator?.id,
      toolUseId,
      createdAt: event.createdAt || new Date().toISOString(),
    },
  };
  renderApprovalCards();
}

function clearToolApproval(toolUseId) {
  if (!toolUseId || !state.pendingToolApprovals?.[toolUseId]) return;
  const next = { ...(state.pendingToolApprovals || {}) };
  delete next[toolUseId];
  state.pendingToolApprovals = next;
  renderApprovalCards();
}

function clearCurrentNarratorApprovals() {
  const narratorId = state.narrator?.id;
  if (!narratorId) return;
  const next = { ...(state.pendingToolApprovals || {}) };
  for (const [key, value] of Object.entries(next)) {
    if (!value?.narratorId || value.narratorId === narratorId) delete next[key];
  }
  state.pendingToolApprovals = next;
  renderApprovalCards();
}

function renderMessageAttachments(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) return "";
  return `
    <div class="message-attachments">
      ${attachments.map((attachment) => renderSentAttachmentCard(message, attachment)).join("")}
    </div>
  `;
}

function renderSentAttachmentCard(message, attachment) {
  const kind = attachment.kind || attachmentKind({ name: attachment.filename || "", type: attachment.mimeType || "" });
  const url = attachmentURL(message, attachment);
  const subtitle = [attachmentKindLabel(kind), formatBytes(attachment.sizeBytes || 0)].filter(Boolean).join(" · ");
  const thumb = kind === "image"
    ? `<img class="attachment-thumb" src="${escapeAttr(url)}" alt="" loading="lazy" />`
    : `<span class="attachment-thumb">${escapeHtml(attachmentIcon(kind))}</span>`;
  return `
    <a class="attachment-card" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">
      ${thumb}
      <div class="attachment-meta">
        <div class="attachment-name" title="${escapeAttr(attachment.filename || "附件")}">${escapeHtml(attachment.filename || "附件")}</div>
        <div class="attachment-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    </a>
  `;
}

function attachmentURL(message, attachment) {
  return `/api/narrators/${encodeURIComponent(message.narratorId || state.narrator?.id || "")}/messages/${encodeURIComponent(message.id || attachment.messageId || "")}/attachments/${encodeURIComponent(attachment.id || "")}`;
}

function messageAttachmentsMarkdown(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) return "";
  const lines = attachments.map((attachment) => `- ${attachment.filename || "附件"}（${attachmentKindLabel(attachment.kind)}, ${formatBytes(attachment.sizeBytes || 0)}）`);
  return `\n\n附件：\n${lines.join("\n")}`;
}

function updateConversationCopyButton() {
  const button = $("copyConversationBtn");
  if (!button) return;
  const count = Array.isArray(state.currentMessages) ? state.currentMessages.length : 0;
  button.disabled = count === 0;
  button.title = count ? `复制当前 ${count} 条消息为 Markdown` : "当前没有可复制的对话";
}

function conversationMarkdown() {
  const messages = Array.isArray(state.currentMessages) ? state.currentMessages : [];
  const title = state.project?.name || state.narrator?.title || "CodeHarbor Conversation";
  const meta = [
    `# ${title} 对话导出`,
    "",
    `- 导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `- 项目：${state.project?.name || "未选择"}`,
    `- 路径：${state.narrator?.cwd || state.project?.gitPath || "未设置"}`,
    `- 代理：${state.narrator?.title || state.narrator?.id || "未选择"}`,
    `- 模型：${state.narrator?.model || selectedModelValue() || "未选择"}`,
    "",
  ];
  const body = messages.map((message, index) => {
    const role = String(message.role || "message").toUpperCase();
    const text = String(message.contentText || "").trim() || "（空消息）";
    return `## ${index + 1}. ${role}\n\n${text}${messageAttachmentsMarkdown(message)}`;
  });
  return [...meta, ...body].join("\n");
}

async function copyCurrentConversationMarkdown() {
  if (!state.currentMessages?.length) {
    showToast("当前没有可复制的对话。", "warn");
    return;
  }
  if (await copyToClipboard(conversationMarkdown())) {
    showToast("当前对话 Markdown 已复制。", "success");
    notifyTerminal("[info] 已复制当前对话 Markdown。\n");
    return;
  }
  showToast("复制当前对话失败，请稍后重试。", "warn");
}

function clearMessageRefreshTimer(narratorId) {
  const timer = state.messageRefreshTimersByNarrator?.[narratorId];
  if (!timer) return;
  window.clearTimeout(timer);
  const next = { ...(state.messageRefreshTimersByNarrator || {}) };
  delete next[narratorId];
  state.messageRefreshTimersByNarrator = next;
}

function scheduleMessageRefresh(delay = 0, narratorId = state.narrator?.id) {
  if (!narratorId) return;
  clearMessageRefreshTimer(narratorId);
  const timer = window.setTimeout(() => {
    clearMessageRefreshTimer(narratorId);
    loadMessages(narratorId).catch((err) => notifyTerminal(`[warn] 消息刷新失败：${err.message || err}\n`));
  }, Math.max(0, delay));
  state.messageRefreshTimersByNarrator = { ...(state.messageRefreshTimersByNarrator || {}), [narratorId]: timer };
}

function isMessageSendingFor(narratorId = state.narrator?.id) {
  return Boolean(narratorId && state.messageSendingByNarrator?.[narratorId]);
}

function syncMessageComposerBusy() {
  const busy = isMessageSendingFor();
  const input = $("messageText");
  if (input) input.disabled = busy;
  const attachButton = $("attachFileBtn");
  if (attachButton) attachButton.disabled = busy;
  const attachInput = $("attachFileInput");
  if (attachInput) attachInput.disabled = busy;
  setButtonBusy($("sendMessageBtn"), busy, "发送中");
}

function setMessageSendingFor(narratorId, sending) {
  if (!narratorId) return;
  const next = { ...(state.messageSendingByNarrator || {}) };
  if (sending) next[narratorId] = true;
  else delete next[narratorId];
  state.messageSendingByNarrator = next;
  syncMessageComposerBusy();
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.narrator) {
    await openDirectoryChooser();
    return;
  }
  const narratorId = state.narrator.id;
  if (isMessageSendingFor(narratorId)) return;
  const draftKey = currentChatDraftKey();
  const input = $("messageText");
  const text = input.value.trim();
  const attachments = [...(state.pendingAttachments || [])];
  if (!text && !attachments.length) return;
  if (!isCurrentModelConfigured()) {
    showModelSetupNotice();
    return;
  }
  setMessageSendingFor(narratorId, true);
  input.value = "";
  autoResizeMessageInput();
  try {
    if (attachments.length) {
      const form = new FormData();
      form.append("text", text);
      attachments.forEach((item) => form.append("files", item.file, item.file?.name || "attachment"));
      await api(`/api/narrators/${narratorId}/messages`, {
        method: "POST",
        body: form,
      });
    } else {
      await api(`/api/narrators/${narratorId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    }
    if (text) rememberPromptHistory(text);
    clearChatDraftForKey(draftKey);
    if (attachments.length) clearPendingAttachments();
    await loadMessages(narratorId);
    scheduleMessageRefresh(1200, narratorId);
  } catch (err) {
    const stillCurrent = state.narrator?.id === narratorId;
    saveChatDraftForKey(draftKey, text);
    if (stillCurrent) {
      if (!input.value.trim()) input.value = text;
      autoResizeMessageInput();
      throw err;
    }
    notifyTerminal(`[warn] 原代理消息发送失败，草稿已保留：${err.message || err}\n`);
  } finally {
    setMessageSendingFor(narratorId, false);
    if (state.narrator?.id === narratorId) input.focus();
  }
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

function disconnectNarratorTransports() {
  clearMessageRefreshTimer(state.narrator?.id);
  if (state.ws) {
    const socket = state.ws;
    state.ws = null;
    try { socket.close(); } catch {}
  }
  if (state.terminalWS) {
    const socket = state.terminalWS;
    state.terminalWS = null;
    try { socket.close(); } catch {}
  }
  const badge = $("wsBadge");
  if (badge) {
    badge.textContent = "ws idle";
    badge.classList.remove("ok");
  }
  setTerminalStatus("idle");
}

function connectWS() {
  if (!state.narrator) return;
  if (state.ws) state.ws.close();
  const narratorId = state.narrator.id;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws/narrator?id=${narratorId}`);
  state.ws = socket;
  const isCurrentSocket = () => state.ws === socket && state.narrator?.id === narratorId;
  socket.onopen = () => {
    if (!isCurrentSocket()) return;
    $("wsBadge").textContent = "ws connected";
    $("wsBadge").classList.add("ok");
  };
  socket.onclose = () => {
    if (!isCurrentSocket()) return;
    $("wsBadge").textContent = "ws closed";
    $("wsBadge").classList.remove("ok");
  };
  socket.onmessage = (message) => {
    if (!isCurrentSocket()) return;
    try {
      const event = JSON.parse(message.data);
      if (shouldLogAgentEvents()) appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
      if (event.type === "tool.approval_required") {
        rememberToolApproval(event);
        showToast(event.data?.risk === "danger" ? "危险工具调用已被阻止。" : "有工具调用等待审批。", event.data?.risk === "danger" ? "error" : "warn");
      }
      if (event.type === "tool.finished") {
        clearToolApproval(event.data?.toolUseId);
      }
      if (event.type === "agent.interrupted") {
        clearCurrentNarratorApprovals();
      }
      if (event.type === "message.created" || event.type === "agent.done") {
        scheduleMessageRefresh(80, narratorId);
      }
    } catch {
      if (shouldLogAgentEvents()) appendTerminal(`[event] ${message.data}\n`);
    }
  };
}

async function saveNarratorSettings() {
  if (state.narratorSaving) {
    state.narratorSavePending = true;
    return;
  }
  const button = $("saveNarratorBtn");
  let narratorId = "";
  state.narratorSaving = true;
  setButtonBusy(button, true, "保存中");
  try {
    const model = $("modelSelect").value.trim();
    if (model) setPreferredModel(model);
    if (!state.narrator) {
      renderModelOptions();
      refreshActiveSettingsPanel();
      notifyTerminal(model ? `[info] 已保存首选模型：${model}\n` : "[info] 尚未选择模型。\n");
      return;
    }
    narratorId = state.narrator.id;
    const id = narratorId;
    const permissionMode = $("permissionMode").value;
    const applyNarratorPatch = async (path, payload) => {
      const updated = await api(`/api/narrators/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (state.narrator?.id !== id) return false;
      state.narrator = updated;
      return true;
    };
    if (model && model !== state.narrator.model) {
      if (!await applyNarratorPatch("model", { model })) return;
    }
    if (permissionMode && permissionMode !== state.narrator.permissionMode) {
      if (!await applyNarratorPatch("permission-mode", { permissionMode })) return;
    }
    if (state.narrator?.id !== id) return;
    await enterNarrator();
    if (state.narrator?.id !== id) return;
    notifyTerminal(`Saved settings: ${state.narrator.model}, ${state.narrator.permissionMode}\n`);
  } catch (err) {
    if (!narratorId || state.narrator?.id === narratorId) throw err;
  } finally {
    state.narratorSaving = false;
    setButtonBusy(button, false, "保存中");
    if (state.narratorSavePending) {
      state.narratorSavePending = false;
      saveNarratorSettings().catch(showError);
    }
  }
}

function connectTerminal() {
  if (!state.narrator) return;
  if (state.terminalWS) state.terminalWS.close();
  const narratorId = state.narrator.id;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const output = $("terminalOutput");
  if (currentTerminalPreferences().clearOnReconnect) output.textContent = "Connecting terminal...\n";
  else appendTerminal("\n[terminal] reconnecting...\n");
  setTerminalStatus("connecting");
  const socket = new WebSocket(`${proto}://${location.host}/ws/terminal?narratorId=${narratorId}`);
  state.terminalWS = socket;
  const isCurrentSocket = () => state.terminalWS === socket && state.narrator?.id === narratorId;
  socket.onopen = () => {
    if (!isCurrentSocket()) return;
    setTerminalStatus("connected");
    resizeTerminal(socket);
    if (currentTerminalPreferences().focusOnConnect) output.focus();
  };
  socket.onclose = () => {
    if (!isCurrentSocket()) return;
    setTerminalStatus("closed");
  };
  socket.onerror = () => {
    if (!isCurrentSocket()) return;
    setTerminalStatus("error");
  };
  socket.onmessage = (message) => {
    if (!isCurrentSocket()) return;
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
  state.terminalStatus = text;
  $("terminalStatus").textContent = `terminal ${text}`;
  if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
}

function sendTerminalInput(data) {
  if (!state.narrator || !state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
  state.terminalWS.send(JSON.stringify({ type: "input", data }));
}

function resizeTerminal(socket = state.terminalWS) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (socket !== state.terminalWS) return;
  const output = $("terminalOutput");
  const cols = Math.max(40, Math.floor(output.clientWidth / 8));
  const rows = Math.max(10, Math.floor(output.clientHeight / 18));
  socket.send(JSON.stringify({ type: "resize", cols, rows }));
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
    event.stopPropagation();
    sendTerminalInput(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
    return;
  }
  if (keyMap[event.key]) {
    event.preventDefault();
    event.stopPropagation();
    sendTerminalInput(keyMap[event.key]);
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
    event.preventDefault();
    event.stopPropagation();
    sendTerminalInput(event.key);
  }
}

function appendTerminal(text) {
  const output = $("terminalOutput");
  output.textContent += text;
  trimTerminalOutput();
  output.scrollTop = output.scrollHeight;
  if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
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
  $("toggleTerminalBtn")?.classList.toggle("active", !shouldCollapse);
  if (shouldCollapse) document.body.classList.remove("mobile-terminal-open");
}

async function openDirectoryChooser(path = "", { trigger = null, preferNative = true } = {}) {
  const defaultPath = String(path || "").trim();
  if (preferNative) {
    try {
      const picked = await selectNativeDirectory(defaultPath, { trigger });
      if (picked?.canceled) return;
      if (picked?.path) {
        await createProjectFromDirectory(picked.path, { button: trigger });
        return;
      }
    } catch (err) {
      notifyTerminal(`[warn] 原生资料夹选择器不可用：${err.message || err}\n`);
      showToast("原生选择器不可用，已切换到内置目录浏览器。", "warn", { force: true });
    }
  }
  await openDirectoryModal(defaultPath);
}

async function selectNativeDirectory(path = "", { trigger = null } = {}) {
  if (state.nativeDirectorySelecting) return { canceled: true };
  state.nativeDirectorySelecting = true;
  const label = trigger?.textContent || "";
  setButtonBusy(trigger, true, "…");
  showToast("正在打开 macOS 资料夹选择器…", "info", { force: true });
  try {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const data = await api(`/api/fs/native-directory${query}`, { method: "POST", body: JSON.stringify({}) });
    if (data.canceled) {
      showToast("已取消选择资料夹。", "info", { force: true });
      return { canceled: true };
    }
    if (data.path) {
      showToast(`已选择：${shortPath(data.path)}`, "success", { force: true });
      return data;
    }
    return { canceled: true };
  } finally {
    state.nativeDirectorySelecting = false;
    setButtonBusy(trigger, false, label || "…");
  }
}

async function openDirectoryModal(path = "") {
  $("folderModal").classList.remove("hidden");
  hideNewFolderInline();
  renderRecentModalDirectories();
  setDirectoryStatus("正在载入目录…", "busy");
  await browseDirectories(path);
}

function closeDirectoryModal() {
  state.directoryBrowseSeq++;
  setDirectoryBrowserBusy(false);
  hideNewFolderInline();
  setDirectoryStatus("选择当前目录后会创建或打开项目。", "");
  $("folderModal").classList.add("hidden");
}

function setDirectoryBrowserBusy(busy) {
  ["folderModal", "directoryList", "manualDirectoryPath", "goDirectoryBtn"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (busy) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  });
}

function setDirectoryStatus(message, variant = "") {
  const el = $("directoryStatus");
  if (!el) return;
  el.textContent = message || "选择当前目录后会创建或打开项目。";
  el.classList.toggle("busy", variant === "busy");
  el.classList.toggle("error", variant === "error");
  el.classList.toggle("success", variant === "success");
}

function updateDirectoryPathDisplay(path) {
  const value = String(path || "").trim();
  const name = basename(value) || value || "选择目录";
  if ($("directoryPath")) $("directoryPath").textContent = value || "Loading...";
  if ($("manualDirectoryPath")) $("manualDirectoryPath").value = value;
  if ($("folderLocationName")) $("folderLocationName").textContent = name;
  if ($("folderLocationPill")) $("folderLocationPill").title = value || "当前路径";
}

async function browseDirectories(path = "") {
  hideNewFolderInline();
  const seq = ++state.directoryBrowseSeq;
  setDirectoryBrowserBusy(true);
  try {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const data = await api(`/api/fs/directories${query}`);
    if (seq !== state.directoryBrowseSeq || !elementVisible("folderModal")) return;
    state.directoryPath = data.path;
    state.directoryParent = data.parent || "";
    state.directoryShortcuts = data.shortcuts || [];
    updateDirectoryPathDisplay(data.path);
    setDirectoryStatus("选择当前目录后会创建或打开项目。", "");
    renderDirectoryShortcuts(state.directoryShortcuts);
    renderDirectoryList(data);
  } catch (err) {
    if (seq === state.directoryBrowseSeq && elementVisible("folderModal")) {
      setDirectoryStatus(`载入失败：${err.message || err}`, "error");
      throw err;
    }
  } finally {
    if (seq === state.directoryBrowseSeq) setDirectoryBrowserBusy(false);
  }
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
    return normalizeRecentDirectories(JSON.parse(localStorage.getItem(recentDirectoriesKey) || "[]"));
  } catch {
    return [];
  }
}

function rememberDirectory(path) {
  const normalized = canonicalLocalPath(path);
  if (!normalized) return;
  const next = [normalized, ...getRecentDirectories().filter((item) => normalizePath(item) !== normalizePath(normalized))].slice(0, 8);
  localStorage.setItem(recentDirectoriesKey, JSON.stringify(next));
  renderRecentSidebarDirectories();
  renderRecentModalDirectories();
}

function renderRecentSidebarDirectories() {
  const el = $("recentSidebarDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((rawPath) => {
    const path = canonicalLocalPath(rawPath);
    return `
      <button class="recent-item" type="button" data-path="${escapeAttr(path)}">
        <span>${escapeHtml(basename(path) || path)}</span>
        <small>${escapeHtml(projectPathLabel(path))}</small>
      </button>
    `;
  }).join("") : `<div class="empty-list">暂无最近目录</div>`;
  el.querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => createProjectFromDirectory(node.dataset.path).catch(showError));
  });
}

function renderRecentModalDirectories() {
  const el = $("recentModalDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((rawPath) => {
    const path = canonicalLocalPath(rawPath);
    return `
      <button class="folder-shortcut" type="button" data-path="${escapeAttr(path)}" title="${escapeAttr(path)}">
        <span class="folder-shortcut-icon">☆</span>
        <span>${escapeHtml(basename(path) || path)}</span>
      </button>
    `;
  }).join("") : `<div class="folder-empty-note">暂无收藏</div>`;
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
  return escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `<code class="inline-code">${code}</code>`);
}

function highlightCode(code, lang) {
  const tokens = [];
  const hold = (html) => {
    const key = `\uE000TOK${tokens.length}\uE001`;
    tokens.push(html);
    return key;
  };
  let html = escapeHtml(code);
  html = html.replace(/("[^"\n]*"|'[^'\n]*')/g, (value) => hold(`<span class="tok-string">${value}</span>`));
  html = html.replace(/(\/\/.*|#.*)$/gm, (value) => hold(`<span class="tok-comment">${value}</span>`));
  const keywordSet = "const|let|var|function|return|if|else|for|while|switch|case|break|class|type|struct|func|package|import|from|export|async|await|try|catch|defer|go|select|range";
  html = html.replace(new RegExp(`\\b(${keywordSet})\\b`, "g"), '<span class="tok-keyword">$1</span>');
  return html.replace(/\uE000TOK(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
}

function bindMessageActionButtons(root) {
  root.querySelectorAll("[data-copy-message]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.copyMessage || -1);
      const text = state.messageCopyTexts[index] || "";
      const original = button.textContent;
      if (text && await copyToClipboard(text)) {
        button.textContent = "已复制";
        showToast("消息原文已复制。", "success");
        notifyTerminal("[info] 已复制消息原文。\n");
      } else {
        button.textContent = "复制失败";
        showToast("复制消息失败，请手动选择文本复制。", "warn");
      }
      window.setTimeout(() => { button.textContent = original; }, 1200);
    });
  });
}

function bindCopyCodeButtons(root) {
  root.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      const ok = await copyToClipboard(button.dataset.code || "");
      const original = button.textContent;
      button.textContent = ok ? "已复制" : "复制失败";
      if (!ok) showToast("复制代码失败，请手动选择文本复制。", "warn");
      setTimeout(() => { button.textContent = original; }, 1200);
    });
  });
}

function autoResizeMessageInput() {
  const input = $("messageText");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  updatePromptHistoryHint();
}

function openAttachmentPicker() {
  const input = $("attachFileInput");
  if (!input || input.disabled) return;
  input.value = "";
  input.click();
}

function attachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function attachmentKind(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || type.includes("wordprocessingml.document")) return "docx";
  if (type.startsWith("text/") || /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|ya?ml|toml|ini|env|go|js|jsx|ts|tsx|css|html?|py|rb|rs|java|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|swift|kt|kts|dart|vue|svelte)$/i.test(name)) return "text";
  return "binary";
}

function attachmentIcon(kind) {
  if (kind === "image") return "🖼";
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "DOC";
  if (kind === "text") return "TXT";
  return "FILE";
}

function addPendingAttachmentFiles(files) {
  const pickedFiles = Array.from(files || []).filter(Boolean);
  if (!pickedFiles.length) return;
  const maxFileBytes = 10 * 1024 * 1024;
  const maxTotalBytes = 25 * 1024 * 1024;
  const currentTotal = state.pendingAttachments.reduce((sum, item) => sum + (item.file?.size || 0), 0);
  let nextTotal = currentTotal;
  const skipped = [];
  const added = [];
  for (const file of pickedFiles) {
    const name = file.name || "未命名文件";
    if (file.size > maxFileBytes) {
      skipped.push(`${name}（${formatBytes(file.size)}）`);
      continue;
    }
    if (nextTotal + file.size > maxTotalBytes) {
      skipped.push(`${name}（总大小超过 ${formatBytes(maxTotalBytes)}）`);
      continue;
    }
    nextTotal += file.size;
    const kind = attachmentKind(file);
    added.push({
      id: attachmentId(),
      file,
      kind,
      previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
    });
  }
  if (added.length) {
    state.pendingAttachments = [...state.pendingAttachments, ...added];
    renderPendingAttachments();
    showToast(`已加入 ${added.length} 个待发送附件。`, "success", { force: true });
  }
  if (skipped.length) {
    const preview = skipped.slice(0, 3).join("、");
    showToast(`已跳过 ${skipped.length} 个文件：${preview}${skipped.length > 3 ? " 等" : ""}。`, "warn", { force: true });
  }
}

async function importAttachmentFiles(event) {
  const picker = event?.target;
  addPendingAttachmentFiles(picker?.files || []);
  if (picker) picker.value = "";
}

function removePendingAttachment(id) {
  const removed = state.pendingAttachments.find((item) => item.id === id);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
  renderPendingAttachments();
}

function clearPendingAttachments() {
  state.pendingAttachments.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  state.pendingAttachments = [];
  renderPendingAttachments();
}

function renderPendingAttachments() {
  const wrap = $("pendingAttachments");
  if (!wrap) return;
  const attachments = state.pendingAttachments || [];
  wrap.classList.toggle("hidden", attachments.length === 0);
  wrap.innerHTML = attachments.map((item) => pendingAttachmentCardHTML(item)).join("");
  wrap.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => removePendingAttachment(button.dataset.removeAttachment));
  });
}

function pendingAttachmentCardHTML(item) {
  const file = item.file || {};
  const name = file.name || "未命名文件";
  if (item.kind === "image" && item.previewUrl) {
    return `
      <div class="pending-image-card" title="${escapeAttr(name)}">
        <img class="pending-image-thumb" src="${escapeAttr(item.previewUrl)}" alt="${escapeAttr(name)}" />
        <button class="pending-attachment-remove" type="button" title="移除附件" aria-label="移除附件" data-remove-attachment="${escapeAttr(item.id)}">×</button>
      </div>
    `;
  }
  const subtitle = formatBytes(file.size || 0);
  return `
    <div class="pending-file-chip" title="${escapeAttr(name)}">
      <span class="pending-file-icon">▯</span>
      <span class="pending-file-name">${escapeHtml(name)}</span>
      <span class="pending-file-size">${escapeHtml(subtitle)}</span>
      <button class="pending-attachment-remove" type="button" title="移除附件" aria-label="移除附件" data-remove-attachment="${escapeAttr(item.id)}">×</button>
    </div>
  `;
}

function attachmentKindLabel(kind) {
  if (kind === "image") return "图片";
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "Word";
  if (kind === "text") return "文本";
  return "文件";
}

function setComposerDragging(active) {
  $("composerInputShell")?.classList.toggle("dragging", Boolean(active));
}

function eventHasFiles(event) {
  return Array.from(event?.dataTransfer?.types || []).includes("Files");
}

function handleAttachmentDragOver(event) {
  if (!eventHasFiles(event)) return;
  event.preventDefault();
  setComposerDragging(true);
}

function handleAttachmentDragLeave(event) {
  const shell = $("composerInputShell");
  if (!shell || shell.contains(event.relatedTarget)) return;
  setComposerDragging(false);
}

function handleAttachmentDrop(event) {
  if (!eventHasFiles(event)) return;
  event.preventDefault();
  setComposerDragging(false);
  addPendingAttachmentFiles(event.dataTransfer?.files || []);
}

function setMessageInputValue(value, { saveDraft = true } = {}) {
  const input = $("messageText");
  input.value = value;
  autoResizeMessageInput();
  updateSlashCommandPalette();
  if (saveDraft) saveCurrentChatDraft();
  window.setTimeout(() => {
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
  }, 0);
}

function updatePromptHistoryHint() {
  const hint = $("promptHistoryHint");
  if (!hint) return;
  const count = currentPromptHistory().length;
  const commandCount = enabledSlashCommands().length;
  const active = state.promptHistoryIndex >= 0;
  hint.textContent = active
    ? `历史 ${state.promptHistoryIndex + 1}/${count} · ↑ 更早，↓ 更新，Enter 发送，Esc 返回草稿。`
    : commandCount
      ? `输入 / 可使用 ${commandCount} 个本地技能命令；空输入时 ↑/↓ 召回历史。`
      : count
        ? `空输入时 ↑ 查看上一条提示，↓ 返回草稿。本地已保存 ${count}/30 条。`
        : "输入框为空时 ↑/↓ 可召回最近提示。";
}

function enabledSlashCommands() {
  return currentSkillsPreferences().commands.filter((command) => command.enabled && command.name && command.prompt);
}

function slashCommandTrigger(value) {
  const text = String(value || "");
  const match = text.match(/^\s*(\/[^\s]*)$/);
  if (!match) return null;
  return {
    prefix: text.slice(0, match.index || 0),
    query: match[1].slice(1).toLowerCase(),
  };
}

function slashCommandMatches() {
  const input = $("messageText");
  const trigger = slashCommandTrigger(input?.value || "");
  if (!trigger) return [];
  const query = trigger.query;
  return enabledSlashCommands().filter((command) => {
    const haystack = `${command.name} ${command.description}`.toLowerCase();
    return !query || haystack.includes(query);
  }).slice(0, 8);
}

function slashCommandOptionId(command, index) {
  return `slash-command-option-${String(command?.id || index).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function updateSlashCommandPalette() {
  const palette = $("slashCommandPalette");
  if (!palette) return;
  const input = $("messageText");
  const trigger = slashCommandTrigger(input?.value || "");
  const matches = trigger ? slashCommandMatches() : [];
  state.slashCommandOpen = Boolean(trigger && matches.length);
  state.slashCommandQuery = trigger?.query || "";
  if (!state.slashCommandOpen) {
    state.slashCommandIndex = 0;
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    palette.classList.add("hidden");
    palette.innerHTML = "";
    return;
  }
  state.slashCommandIndex = Math.max(0, Math.min(state.slashCommandIndex, matches.length - 1));
  input?.setAttribute("aria-expanded", "true");
  input?.setAttribute("aria-activedescendant", slashCommandOptionId(matches[state.slashCommandIndex], state.slashCommandIndex));
  palette.classList.remove("hidden");
  palette.innerHTML = `
    <div class="slash-command-head">本地技能命令</div>
    ${matches.map((command, index) => `
      <button id="${escapeAttr(slashCommandOptionId(command, index))}" class="slash-command-item ${index === state.slashCommandIndex ? "active" : ""}" type="button" role="option" aria-selected="${index === state.slashCommandIndex ? "true" : "false"}" data-slash-command="${escapeAttr(command.id)}">
        <span class="slash-command-name">${escapeHtml(command.name)}</span>
        <span class="slash-command-desc">${escapeHtml(command.description || command.prompt.slice(0, 120))}</span>
      </button>
    `).join("")}
  `;
  palette.querySelectorAll("[data-slash-command]").forEach((node) => {
    node.addEventListener("mousedown", (event) => event.preventDefault());
    node.addEventListener("click", () => applySlashCommand(node.dataset.slashCommand));
  });
}

function hideSlashCommandPalette() {
  state.slashCommandOpen = false;
  state.slashCommandIndex = 0;
  state.slashCommandQuery = "";
  const input = $("messageText");
  input?.setAttribute("aria-expanded", "false");
  input?.removeAttribute("aria-activedescendant");
  const palette = $("slashCommandPalette");
  if (palette) {
    palette.classList.add("hidden");
    palette.innerHTML = "";
  }
}

function applySlashCommand(id) {
  const command = enabledSlashCommands().find((item) => item.id === id) || slashCommandMatches()[state.slashCommandIndex];
  if (!command) return false;
  const input = $("messageText");
  const value = input?.value || "";
  const next = value.replace(/^\s*\/[^\s]*$/, command.prompt);
  setMessageInputValue(next);
  hideSlashCommandPalette();
  resetPromptHistoryNavigation();
  input?.focus();
  showToast(`已插入 ${command.name} 模板。`, "success");
  return true;
}

function handleSlashCommandKeydown(event) {
  if (!state.slashCommandOpen || isComposingInput(event)) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const count = slashCommandMatches().length;
    if (!count) return false;
    state.slashCommandIndex = event.key === "ArrowDown"
      ? (state.slashCommandIndex + 1) % count
      : (state.slashCommandIndex - 1 + count) % count;
    updateSlashCommandPalette();
    event.preventDefault();
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    const selected = slashCommandMatches()[state.slashCommandIndex];
    if (selected && applySlashCommand(selected.id)) {
      event.preventDefault();
      return true;
    }
  }
  if (event.key === "Escape") {
    hideSlashCommandPalette();
    event.preventDefault();
    return true;
  }
  return false;
}

function handlePromptHistoryNavigation(event) {
  if (isComposingInput(event) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Escape") return false;
  const input = $("messageText");
  const history = currentPromptHistory();
  if (event.key === "Escape" && state.promptHistoryIndex >= 0) {
    setMessageInputValue(state.promptHistoryDraft || "");
    resetPromptHistoryNavigation();
    updatePromptHistoryHint();
    event.preventDefault();
    return true;
  }
  if (!history.length || (input.value.trim() && state.promptHistoryIndex < 0)) return false;
  if (event.key === "ArrowUp") {
    if (state.promptHistoryIndex < 0) state.promptHistoryDraft = input.value;
    state.promptHistoryIndex = Math.min(history.length - 1, state.promptHistoryIndex + 1);
    setMessageInputValue(history[state.promptHistoryIndex] || "");
    event.preventDefault();
    return true;
  }
  if (event.key === "ArrowDown" && state.promptHistoryIndex >= 0) {
    state.promptHistoryIndex -= 1;
    setMessageInputValue(state.promptHistoryIndex >= 0 ? history[state.promptHistoryIndex] : state.promptHistoryDraft || "");
    if (state.promptHistoryIndex < 0) resetPromptHistoryNavigation();
    updatePromptHistoryHint();
    event.preventDefault();
    return true;
  }
  return false;
}

function handleMessageInput() {
  resetPromptHistoryNavigation();
  autoResizeMessageInput();
  updateSlashCommandPalette();
  saveCurrentChatDraft();
}

function handleMessageKeydown(event) {
  if (handleSlashCommandKeydown(event)) return;
  if (handlePromptHistoryNavigation(event)) return;
  if (isComposingInput(event) || event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  $("messageForm").requestSubmit();
}

function openMobileSidebar() {
  document.body.classList.add("mobile-sidebar-open");
}

function closeMobileSidebar() {
  closeSidebarSettingsMenu();
  document.body.classList.remove("mobile-sidebar-open");
}

function toggleMobileTerminal() {
  document.body.classList.toggle("mobile-terminal-open");
  if (document.body.classList.contains("mobile-terminal-open")) {
    $("terminalOutput").focus();
    resizeTerminal();
  }
}

function openProjectSearch({ focus = true } = {}) {
  $("projectSearchWrap")?.classList.remove("hidden");
  $("projectSearchToggleBtn")?.classList.add("active");
  if (focus) setTimeout(() => $("projectSearch")?.focus(), 30);
}

function closeProjectSearch({ clear = false } = {}) {
  if (clear) {
    state.projectQuery = "";
    if ($("projectSearch")) $("projectSearch").value = "";
    renderProjects();
  }
  $("projectSearchWrap")?.classList.add("hidden");
  $("projectSearchToggleBtn")?.classList.remove("active");
}

function toggleProjectSearch() {
  const wrap = $("projectSearchWrap");
  if (!wrap || wrap.classList.contains("hidden")) openProjectSearch();
  else closeProjectSearch({ clear: !state.projectQuery.trim() });
}

function focusMobileSearch() {
  openMobileSidebar();
  setTimeout(() => openProjectSearch(), 160);
}

function normalizePath(path) {
  return canonicalLocalPath(path).replace(/\/+$/, "") || "/";
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

function showNewFolderInline() {
  const row = $("newFolderInline");
  const input = $("newFolderNameInput");
  row.classList.remove("hidden");
  input.value = "";
  window.setTimeout(() => input.focus(), 0);
}

function hideNewFolderInline() {
  const row = $("newFolderInline");
  if (!row) return;
  row.classList.add("hidden");
  if ($("newFolderNameInput")) $("newFolderNameInput").value = "";
}

async function createFolderInCurrentDirectory() {
  const input = $("newFolderNameInput");
  const button = $("confirmNewFolderBtn");
  if (button?.disabled) return;
  const trimmed = input?.value.trim() || "";
  if (!trimmed) {
    showToast("请输入新文件夹名称。", "warn");
    input?.focus();
    return;
  }
  if (trimmed === "." || trimmed === "..") {
    showToast("文件夹名称不能是 . 或 ..。", "warn");
    input?.focus();
    return;
  }
  if (trimmed.length > 255) {
    showToast("文件夹名称过长，请控制在 255 个字符以内。", "warn");
    input?.focus();
    return;
  }
  if (/[\\/\0]/.test(trimmed)) {
    throw new Error("文件夹名称不能包含路径分隔符或空字符");
  }
  const base = normalizePath(state.directoryPath);
  const path = base === "/" ? `/${trimmed}` : `${base}/${trimmed}`;
  const previousLabel = button?.textContent || "创建";
  if (button) {
    button.textContent = button.classList.contains("composer-send-btn") ? "…" : "发送中";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  if (input) input.disabled = true;
  try {
    await api("/api/fs/mkdir", { method: "POST", body: JSON.stringify({ path }) });
    hideNewFolderInline();
    showToast("文件夹已创建。", "success");
    await browseDirectories(path);
  } finally {
    if (button) {
      button.textContent = previousLabel;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    if (input) input.disabled = false;
  }
}

function favoriteCurrentDirectory() {
  if (!state.directoryPath) return;
  rememberDirectory(state.directoryPath);
}

function basename(path) {
  return String(path || "").replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("zh-CN").format(number);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "$0.0000";
  return `$${number.toFixed(number >= 1 ? 2 : 4)}`;
}

function formatDuration(ms) {
  const number = Number(ms || 0);
  if (!Number.isFinite(number) || number <= 0) return "0 ms";
  if (number < 1000) return `${Math.round(number)} ms`;
  if (number < 60000) return `${(number / 1000).toFixed(1)} s`;
  return `${(number / 60000).toFixed(1)} min`;
}

function formatTimestamp(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function showToast(message, variant = "info", options = {}) {
  if (!options.force && !notificationVariantEnabled(variant)) return;
  const stack = $("toastStack");
  if (!stack) return;
  const node = document.createElement("div");
  node.className = `toast toast-${variant}`;
  node.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="关闭通知">×</button>`;
  const close = () => {
    node.classList.add("leaving");
    window.setTimeout(() => node.remove(), 180);
  };
  node.querySelector("button").addEventListener("click", close);
  stack.appendChild(node);
  window.setTimeout(close, notificationToastDuration(variant));
}

function showError(err) {
  const message = err.message || String(err);
  showToast(message, "error", { force: true });
  notifyTerminal(`[error] ${message}\n`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }

document.addEventListener("keydown", handleGlobalEscape);
document.addEventListener("keydown", handleSettingsSearchShortcut);
document.addEventListener("click", handleDirectoryShortcutClick);
document.addEventListener("click", handleSidebarSettingsMenuDocumentClick);
$("refreshBtn").addEventListener("click", () => init().catch(showError));
$("sidebarAccountBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSidebarSettingsMenu();
});
$("settingsBtn").addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("profile"); });
$("providerSettingsBtn")?.addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("providers"); });
$("modelSettingsBtn")?.addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("models"); });
$("runtimeSettingsBtn")?.addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("servers-system"); });
$("aboutSettingsBtn")?.addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("about"); });
$("logoutBtn")?.addEventListener("click", () => { closeSidebarSettingsMenu(); showToast("本地 MVP 暂未启用完整账户系统，无需退出登录。", "info"); });
$("settingsSearchInput")?.addEventListener("input", (event) => updateSettingsSearchQuery(event.target.value));
$("settingsSearchInput")?.addEventListener("keydown", (event) => {
  if (isComposingInput(event)) return;
  if (event.key === "Enter") {
    const first = firstFilteredSettingsItem();
    if (first) selectSettingsPanel(first.key);
    event.preventDefault();
  }
});
$("clearSettingsSearchBtn")?.addEventListener("click", () => clearSettingsSearchQuery({ focus: true }));
$("closeSettingsModalBtn").addEventListener("click", closeSettingsModal);
$("settingsModal").addEventListener("click", (event) => { if (event.target.id === "settingsModal") closeSettingsModal(); });
$("settingsWizardBtn").addEventListener("click", (event) => {
  closeSettingsModal();
  openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError);
});
$("manageBackendsBtn").addEventListener("click", () => { closeSidebarSettingsMenu(); openBackendsModal(); });
$("closeBackendsModalBtn").addEventListener("click", closeBackendsModal);
$("backendsModal").addEventListener("click", (event) => { if (event.target.id === "backendsModal") closeBackendsModal(); });
$("backendForm").addEventListener("submit", (event) => saveBackend(event).catch(showError));
$("resetBackendFormBtn").addEventListener("click", resetBackendForm);
$("mobileMenuBtn").addEventListener("click", openMobileSidebar);
$("mobileSidebarBackdrop").addEventListener("click", closeMobileSidebar);
$("mobileTerminalBtn").addEventListener("click", toggleMobileTerminal);
$("mobileSearchBtn").addEventListener("click", focusMobileSearch);
$("projectSearchToggleBtn")?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleProjectSearch();
});
$("projectSearchClearBtn")?.addEventListener("click", () => closeProjectSearch({ clear: true }));
$("projectSearch").addEventListener("input", (event) => {
  state.projectQuery = event.target.value;
  renderProjects();
});
$("projectSearch").addEventListener("keydown", (event) => {
  if (isComposingInput(event)) return;
  if (event.key === "Escape") {
    closeProjectSearch({ clear: true });
    event.preventDefault();
  }
});
$("copyConversationBtn")?.addEventListener("click", () => copyCurrentConversationMarkdown().catch(showError));
$("closeFolderModalBtn").addEventListener("click", closeDirectoryModal);
$("cancelDirectoryBtn").addEventListener("click", closeDirectoryModal);
$("folderModal").addEventListener("click", (event) => { if (event.target.id === "folderModal") closeDirectoryModal(); });
$("folderHomeBtn").addEventListener("click", () => browseHomeDirectory().catch(showError));
$("folderParentBtn").addEventListener("click", () => browseParentDirectory().catch(showError));
$("folderRefreshBtn").addEventListener("click", () => refreshDirectory().catch(showError));
$("nativeDirectoryBtn")?.addEventListener("click", (event) => {
  selectNativeDirectory(state.directoryPath, { trigger: event.currentTarget }).then(async (picked) => {
    if (!picked?.path) return;
    updateDirectoryPathDisplay(picked.path);
    setDirectoryStatus(`已从 Finder 选择：${picked.path}，正在打开…`, "busy");
    await createProjectFromDirectory(picked.path, { button: $("chooseDirectoryBtn") });
  }).catch(showError);
});
$("folderLocationPill")?.addEventListener("click", () => {
  const input = $("manualDirectoryPath");
  input?.focus();
  input?.select();
});
$("newFolderBtn").addEventListener("click", showNewFolderInline);
$("confirmNewFolderBtn").addEventListener("click", () => createFolderInCurrentDirectory().catch(showError));
$("cancelNewFolderBtn").addEventListener("click", hideNewFolderInline);
$("newFolderNameInput").addEventListener("keydown", (event) => {
  if (isComposingInput(event)) return;
  if (event.key === "Enter") createFolderInCurrentDirectory().catch(showError);
  if (event.key === "Escape") {
    hideNewFolderInline();
    event.preventDefault();
    event.stopPropagation();
  }
});
$("favoriteDirectoryBtn").addEventListener("click", favoriteCurrentDirectory);
$("toggleHiddenFoldersBtn").addEventListener("click", () => notifyTerminal("[info] 隐藏文件夹当前不显示。\n"));
$("goDirectoryBtn").addEventListener("click", () => browseDirectories($("manualDirectoryPath").value.trim()).catch(showError));
$("manualDirectoryPath").addEventListener("keydown", (event) => {
  if (isComposingInput(event)) return;
  if (event.key === "Enter") browseDirectories($("manualDirectoryPath").value.trim()).catch(showError);
});
$("chooseDirectoryBtn").addEventListener("click", () => createProjectFromDirectory(state.directoryPath).catch(showError));
$("messageForm").addEventListener("submit", (event) => sendMessage(event).catch(showError));
$("attachFileBtn")?.addEventListener("click", openAttachmentPicker);
$("attachFileInput")?.addEventListener("change", (event) => importAttachmentFiles(event).catch(showError));
$("composerInputShell")?.addEventListener("dragenter", handleAttachmentDragOver);
$("composerInputShell")?.addEventListener("dragover", handleAttachmentDragOver);
$("composerInputShell")?.addEventListener("dragleave", handleAttachmentDragLeave);
$("composerInputShell")?.addEventListener("drop", handleAttachmentDrop);
$("messageText").addEventListener("input", handleMessageInput);
$("messageText").addEventListener("keydown", handleMessageKeydown);
$("messageText").addEventListener("focus", updateSlashCommandPalette);
$("messageText").addEventListener("blur", () => window.setTimeout(hideSlashCommandPalette, 120));
$("terminalOutput").addEventListener("keydown", handleTerminalKeydown);
$("terminalOutput").addEventListener("click", () => $("terminalOutput").focus());
$("terminalOutput").addEventListener("paste", (event) => {
  event.preventDefault();
  sendTerminalInput(event.clipboardData?.getData("text") || "");
});
$("reconnectTerminalBtn").addEventListener("click", connectTerminal);
window.addEventListener("resize", resizeTerminal);
window.addEventListener("beforeunload", saveCurrentChatDraft);
$("saveNarratorBtn").addEventListener("click", () => saveNarratorSettings().catch(showError));
$("refreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
$("openProviderLoginBtn").addEventListener("click", () => openSettingsModal("providers"));
$("modelSelect").addEventListener("change", () => {
  updateModelConfiguredState();
  saveNarratorSettings().catch(showError);
});
$("permissionMode").addEventListener("change", () => saveNarratorSettings().catch(showError));
$("toggleTerminalBtn").addEventListener("click", () => toggleTerminal());
$("collapseTerminalBtn").addEventListener("click", () => toggleTerminal(true));
$("expandTerminalBtn").addEventListener("click", () => toggleTerminal(false));

async function init() {
  if (state.initializing) return;
  const seq = ++state.initSeq;
  state.initializing = true;
  const refreshButton = $("refreshBtn");
  setButtonBusy(refreshButton, true, "刷新中");
  try {
    state.profile = loadProfilePreferences();
    applyProfilePreferences();
    state.searchPrefs = loadSearchPreferences();
    state.imGatewayPrefs = loadIMGatewayPreferences();
    state.skillsPrefs = loadSkillsPreferences();
    state.notifications = loadNotificationPreferences();
    state.appearance = loadAppearancePreferences();
    state.terminalPrefs = loadTerminalPreferences();
    state.chatDrafts = loadChatDrafts();
    state.promptHistory = loadPromptHistory();
    applyAppearancePreferences({ applyTerminalDefault: true });
    autoResizeMessageInput();
    renderRecentSidebarDirectories();
    await loadHealth();
    await Promise.all([loadSettings(), loadModelCatalog(), loadProjects(), loadBackends()]);
    if (seq !== state.initSeq) return;
    if (!state.narrator && state.projects.length) {
      await selectProject(state.projects[0].id);
    }
  } finally {
    if (seq === state.initSeq) {
      state.initializing = false;
      setButtonBusy(refreshButton, false, "刷新中");
    }
  }
}

init().catch(showError);
