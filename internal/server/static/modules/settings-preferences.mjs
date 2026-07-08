import { $ } from "./dom.mjs";
import {
  appearancePrefsKey,
  chatDraftsKey,
  defaultAppearancePrefs,
  defaultIMGatewayPrefs,
  defaultNotificationPrefs,
  defaultProfilePrefs,
  defaultSearchPrefs,
  defaultSkillsPrefs,
  imGatewayPrefsKey,
  localPreferenceBackupKeys,
  localPreferenceBackupKind,
  localPreferenceBackupVersion,
  notificationPrefsKey,
  preferredModelKey,
  profilePrefsKey,
  promptHistoryKey,
  recentDirectoriesKey,
  relayProtocolPrefsKey,
  searchPrefsKey,
  skillsPrefsKey,
  terminalPrefsKey,
} from "./preferences-data.mjs";

export function createSettingsPreferencesController({
  state,
  activeBackend,
  appendTerminal,
  loadChatDrafts,
  loadPromptHistory,
  loadTerminalPreferences,
  normalizeChatDrafts,
  normalizePromptHistory,
  normalizeRecentDirectories,
  normalizeTerminalPreferences,
  refreshActiveSettingsPanel,
  relayProtocolSpec,
  renderModelOptions,
  renderRecentModalDirectories,
  renderRecentSidebarDirectories,
  showToast,
  toggleTerminal,
  trimTerminalOutput,
  updatePromptHistoryHint,
  updateSlashCommandPalette,
} = {}) {
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
    if (state.activeSettingsPanel === "profile") refreshActiveSettingsPanel?.();
    if (notify) showToast?.("个人资料已保存。", "success", { force: true });
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
    const backend = activeBackend?.();
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
    if (state.activeSettingsPanel === "network-search") refreshActiveSettingsPanel?.();
    if (notify) showToast?.("网络搜索策略已保存。", "success", { force: true });
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
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel?.();
    updatePromptHistoryHint?.();
    updateSlashCommandPalette?.();
    if (notify) showToast?.("技能工作台已保存。", "success", { force: true });
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
    if (state.activeSettingsPanel === "im-gateway") refreshActiveSettingsPanel?.();
    if (notify) showToast?.("IM 网关策略已保存。", "success", { force: true });
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
    if (state.activeSettingsPanel === "notifications") refreshActiveSettingsPanel?.();
    if (notify) showToast?.("通知偏好已保存。", "success", { force: true });
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
    if (currentNotificationPreferences().terminalNotices) appendTerminal?.(message);
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
    if (state.activeSettingsPanel === "appearance") refreshActiveSettingsPanel?.();
    if (notify) showToast?.("外观偏好已保存。", "success");
  }

  function applyAppearancePreferences({ applyTerminalDefault = false } = {}) {
    const prefs = currentAppearancePreferences();
    document.body.classList.toggle("theme-light", prefs.theme === "light");
    document.body.classList.toggle("theme-dark", prefs.theme === "dark");
    document.body.classList.toggle("ui-density-compact", prefs.density === "compact");
    document.body.classList.toggle("ui-density-comfortable", prefs.density !== "compact");
    if (applyTerminalDefault && $("appShell")) {
      toggleTerminal?.(!prefs.terminalDefaultOpen);
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
    trimTerminalOutput?.();
    updatePromptHistoryHint?.();
    renderRecentSidebarDirectories?.();
    renderRecentModalDirectories?.();
    renderModelOptions?.();
  }

  return {
    applyAppearancePreferences,
    applyProfilePreferences,
    createLocalPreferencesBackup,
    currentAppearancePreferences,
    currentIMGatewayPreferences,
    currentNotificationPreferences,
    currentProfilePreferences,
    currentSearchPreferences,
    currentSkillsPreferences,
    imGatewayChannelLabel,
    imGatewayPrefsExport,
    loadAppearancePreferences,
    loadIMGatewayPreferences,
    loadNotificationPreferences,
    loadProfilePreferences,
    loadSearchPreferences,
    loadSkillsPreferences,
    localPreferencesBackupSummary,
    localPreferencesBackupText,
    localSkillID,
    normalizeAppearancePreferences,
    normalizeDomainList,
    normalizeIMGatewayPreferences,
    normalizeLineList,
    normalizeMCPServer,
    normalizeNotificationPreferences,
    normalizeProfilePreferences,
    normalizeSearchPreferences,
    normalizeSkillCommand,
    normalizeSkillsPreferences,
    notificationToastDuration,
    notificationVariantEnabled,
    notifyTerminal,
    profileDisplayName,
    profileGitEnvExample,
    resetAppearancePreferences: () => saveAppearancePreferences({ ...defaultAppearancePrefs }, { applyTerminalDefault: true, notify: true }),
    resetIMGatewayPreferences,
    resetNotificationPreferences,
    resetProfilePreferences,
    resetSearchPreferences,
    resetSkillsPreferences,
    restoreLocalPreferencesBackup,
    saveAppearancePreferences,
    saveIMGatewayPreferences,
    saveNotificationPreferences,
    saveProfilePreferences,
    saveSearchPreferences,
    saveSkillsPreferences,
    searchPrefsExport,
    searchProviderLabel,
    setAppearancePreference,
    setNotificationPreference,
    shouldLogAgentEvents,
    skillsPrefsExport,
    updateSidebarAccountSummary,
  };
}
