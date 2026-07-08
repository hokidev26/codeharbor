import { createBackendRegistryController } from "./backend-registry.mjs";
import { createChatComposerController, normalizeChatDrafts, normalizePromptHistory } from "./chat-composer.mjs";
import { createChatRenderingController } from "./chat-rendering.mjs";
import {
  basename,
  canonicalLocalPath,
  createDirectoryBrowserController,
  normalizePath,
  normalizeRecentDirectories,
  projectPathLabel,
  shortPath,
} from "./directory-browser.mjs";
import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatNumber, formatTimestamp } from "./formatters.mjs";
import { createGitWorkflowController } from "./git-workflow.mjs";
import { createLocalPreferencesSettingsController } from "./local-preferences-settings.mjs";
import { createMCPRegistryUIController } from "./mcp-registry-ui.mjs";
import { createModelProviderSettingsController } from "./model-provider-settings.mjs";
import { api, webSocketURL } from "./runtime.mjs";
import { settingsItems, settingsSections } from "./settings-data.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";
import { createSystemSettingsController } from "./system-settings.mjs";
import { createSkillsWorkbenchController } from "./skills-workbench.mjs";
import { createTerminalController } from "./terminal.mjs";
import { createUIShellController, elementVisible, isComposingInput } from "./ui-shell.mjs";
import { createWorkspaceSettingsController } from "./workspace-settings.mjs";

let backendRegistry = null;
let settingsPreferences = null;

function activeBackend() {
  return backendRegistry.activeBackend();
}

function closeBackendsModal() {
  backendRegistry.closeBackendsModal();
}

function currentSkillsPreferences() {
  return settingsPreferences.currentSkillsPreferences();
}

function notifyTerminal(message) {
  settingsPreferences.notifyTerminal(message);
}

function updateSidebarAccountSummary() {
  settingsPreferences.updateSidebarAccountSummary();
}

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
  gitStatus: null,
  gitDiff: null,
  gitLog: null,
  gitError: "",
  gitSeq: 0,
  gitScope: "all",
  gitSelectedPath: "",
  gitCommitMessage: "",
  gitCommitSelected: {},
  gitCommitBusy: false,
  gitOpen: false,
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
  mcpRegistryServers: [],
  mcpRegistryTools: {},
  mcpRegistryError: "",
  mcpRegistrySeq: 0,
  mcpRegistryLoaded: false,
  mcpRegistryLoading: false,
  mcpRegistryActionBusy: {},
  mcpRegistryEditingId: "",
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

const terminal = createTerminalController({
  state,
  copyToClipboard,
  formatNumber,
  notifyTerminal,
  refreshActiveSettingsPanel,
  showError,
  showToast,
});

const gitWorkflow = createGitWorkflowController({
  state,
  showError,
  showToast,
});

const chatRendering = createChatRenderingController({
  state,
  attachmentIcon,
  attachmentKind,
  copyToClipboard,
  notifyTerminal,
  selectedModelValue,
  shortPath,
  showError,
  showToast,
});

const {
  appendTerminal,
  bindTerminalSettingsActions,
  clearTerminalOutput,
  connectTerminal,
  copyTerminalOutput,
  currentTerminalPreferences,
  focusTerminalPanel,
  handleTerminalKeydown,
  loadTerminalPreferences,
  normalizeTerminalPreferences,
  reconnectTerminalFromSettings,
  renderTerminalSettingsContent,
  resizeTerminal,
  saveTerminalPreferences,
  sendTerminalInput,
  setTerminalPreference,
  setTerminalStatus,
  terminalOutputStats,
  terminalOutputText,
  toggleTerminal,
  trimTerminalOutput,
} = terminal;

const {
  closeGitModal,
  loadGitStatus,
  openGitModal,
  resetGitWorkflowState,
} = gitWorkflow;

const {
  clearCurrentNarratorApprovals,
  clearMessageRefreshTimer,
  clearToolApproval,
  copyCurrentConversationMarkdown,
  loadMessages,
  rememberToolApproval,
  scheduleMessageRefresh,
  updateConversationCopyButton,
} = chatRendering;

const directoryBrowser = createDirectoryBrowserController({
  state,
  createProjectFromDirectory,
  elementVisible,
  notifyTerminal,
  showError,
  showToast,
});

const {
  browseDirectories,
  browseHomeDirectory,
  browseParentDirectory,
  closeDirectoryModal,
  createFolderInCurrentDirectory,
  favoriteCurrentDirectory,
  hideNewFolderInline,
  openDirectoryChooser,
  refreshDirectory,
  rememberDirectory,
  renderRecentModalDirectories,
  renderRecentSidebarDirectories,
  selectNativeDirectory,
  setDirectoryStatus,
  showNewFolderInline,
  updateDirectoryPathDisplay,
} = directoryBrowser;

backendRegistry = createBackendRegistryController({
  state,
  refreshActiveSettingsPanel,
  showError,
  showToast,
  updateSidebarAccountSummary,
});

const {
  bindAgentAdminSettingsActions,
  loadBackends,
  openBackendsModal,
  renderAgentAdminSettingsContent,
  renderBackendPanel,
  resetBackendForm,
  saveBackend,
} = backendRegistry;

const uiShell = createUIShellController({
  state,
  clearSettingsSearchQuery,
  closeBackendsModal,
  closeDirectoryModal,
  closeSettingsModal,
  focusSettingsSearchInput,
  normalizedSettingsSearchQuery,
  openDirectoryChooser,
  renderProjects,
  resizeTerminal,
  showError,
});

const {
  closeMobileSidebar,
  closeProjectSearch,
  closeSidebarSettingsMenu,
  focusMobileSearch,
  handleDirectoryShortcutClick,
  handleGlobalEscape,
  handleSettingsSearchShortcut,
  handleSidebarSettingsMenuDocumentClick,
  openMobileSidebar,
  toggleMobileTerminal,
  toggleProjectSearch,
  toggleSidebarSettingsMenu,
} = uiShell;

const modelProviderSettings = createModelProviderSettingsController({
  state,
  copyText,
  loadModelCatalog,
  loadSettings,
  notifyTerminal,
  openSettingsModal,
  refreshActiveSettingsPanel,
  showError,
  updateWorkspaceMetaPills,
});

const {
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
} = modelProviderSettings;

const chatComposer = createChatComposerController({
  state,
  attachmentKind,
  currentSkillsPreferences,
  isComposingInput,
  isCurrentModelConfigured,
  loadMessages,
  notifyTerminal,
  openDirectoryChooser,
  scheduleMessageRefresh,
  showModelSetupNotice,
  showToast,
});

const {
  autoResizeMessageInput,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  handleMessageInput,
  handleMessageKeydown,
  hideSlashCommandPalette,
  importAttachmentFiles,
  loadChatDrafts,
  loadPromptHistory,
  openAttachmentPicker,
  restoreCurrentChatDraft,
  saveCurrentChatDraft,
  sendMessage,
  setMessageInputValue,
  syncMessageComposerBusy,
  updatePromptHistoryHint,
  updateSlashCommandPalette,
} = chatComposer;

settingsPreferences = createSettingsPreferencesController({
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
});

const mcpRegistryUI = createMCPRegistryUIController({
  state,
  copyText,
  currentSkillsPreferences,
  refreshActiveSettingsPanel,
  showError,
  showToast,
});

const {
  bindMCPRegistryActions,
  isMCPRegistryActionBusy,
  renderMCPRegistryList,
} = mcpRegistryUI;

const {
  applyAppearancePreferences,
  applyProfilePreferences,
  currentAppearancePreferences,
  currentIMGatewayPreferences,
  currentNotificationPreferences,
  currentProfilePreferences,
  currentSearchPreferences,
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
  normalizeMCPServer,
  normalizeSkillCommand,
  notificationToastDuration,
  notificationVariantEnabled,
  profileDisplayName,
  profileGitEnvExample,
  resetIMGatewayPreferences,
  resetNotificationPreferences,
  resetProfilePreferences,
  resetSearchPreferences,
  resetSkillsPreferences,
  restoreLocalPreferencesBackup,
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
} = settingsPreferences;

const localPreferencesSettings = createLocalPreferencesSettingsController({
  copyText,
  currentAppearancePreferences,
  currentIMGatewayPreferences,
  currentNotificationPreferences,
  currentProfilePreferences,
  currentSearchPreferences,
  imGatewayChannelLabel,
  imGatewayPrefsExport,
  notifyTerminal,
  profileDisplayName,
  profileGitEnvExample,
  resetIMGatewayPreferences,
  resetNotificationPreferences,
  resetProfilePreferences,
  resetSearchPreferences,
  saveIMGatewayPreferences,
  saveProfilePreferences,
  saveSearchPreferences,
  searchPrefsExport,
  searchProviderLabel,
  setAppearancePreference,
  setNotificationPreference,
  showError,
  showToast,
});

const {
  bindAppearanceSettingsActions,
  bindIMGatewaySettingsActions,
  bindNetworkSearchSettingsActions,
  bindNotificationSettingsActions,
  bindProfileSettingsActions,
  renderAppearanceSettingsContent,
  renderIMGatewaySettingsContent,
  renderNetworkSearchSettingsContent,
  renderNotificationSettingsContent,
  renderProfileSettingsContent,
} = localPreferencesSettings;

const systemSettings = createSystemSettingsController({
  state,
  copyText,
  loadAuthStatus,
  loadLicenseSummary,
  loadRuntimeSummary,
  loadStorageSummary,
  loadUsageSummary,
  localPreferencesBackupSummary,
  localPreferencesBackupText,
  notifyTerminal,
  refreshActiveSettingsPanel,
  restoreLocalPreferencesBackup,
  showError,
  showToast,
});

const {
  bindAboutSettingsActions,
  bindRuntimeSettingsActions,
  bindStorageSettingsActions,
  bindUsageSettingsActions,
  bindUserSettingsActions,
  renderAboutSettingsContent,
  renderRuntimeSettingsContent,
  renderServerSystemSettingsContent,
  renderStorageSettingsContent,
  renderUsageMetricCard,
  renderUsageSettingsContent,
  renderUserSettingsContent,
} = systemSettings;

const workspaceSettings = createWorkspaceSettingsController({
  state,
  api,
  copyText,
  currentProviderConfig,
  disconnectNarratorTransports,
  enterNarrator,
  getPreferredModel,
  hideSlashCommandPalette,
  loadChapterContainerData,
  notifyTerminal,
  openDirectoryChooser,
  providerLabel,
  providerStatusText,
  refreshActiveSettingsPanel,
  renderAgentModelOptions,
  renderUsageMetricCard,
  saveCurrentChatDraft,
  selectSettingsPanel,
  setPreferredModel,
  showError,
  showToast,
  syncMessageComposerBusy,
});

const {
  bindAgentSettingsActions,
  bindChaptersSettingsActions,
  renderAgentSettingsContent,
  renderChaptersSettingsContent,
} = workspaceSettings;

const skillsWorkbench = createSkillsWorkbenchController({
  state,
  bindMCPRegistryActions,
  copyText,
  currentSkillsPreferences,
  isMCPRegistryActionBusy,
  localSkillID,
  normalizeMCPServer,
  normalizeSkillCommand,
  notifyTerminal,
  renderMCPRegistryList,
  resetSkillsPreferences,
  saveSkillsPreferences,
  showError,
  skillsPrefsExport,
});

const {
  bindSkillTabs,
  renderSkillSettingsContent,
} = skillsWorkbench;

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
  resetGitWorkflowState();
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
  loadGitStatus({ silent: true }).catch(() => {});
  await loadMessages(narratorId);
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
  const socket = new WebSocket(webSocketURL(`/ws/narrator?id=${encodeURIComponent(narratorId)}`));
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
$("gitWorkflowBtn")?.addEventListener("click", openGitModal);
$("closeGitModalBtn")?.addEventListener("click", closeGitModal);
$("gitModal")?.addEventListener("click", (event) => { if (event.target.id === "gitModal") closeGitModal(); });
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
