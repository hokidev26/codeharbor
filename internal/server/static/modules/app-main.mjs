import { createAgentStreamController } from "./agent-stream.mjs";
import { createBackendRegistryController } from "./backend-registry.mjs";
import { createChatComposerController, normalizeChatDrafts, normalizePromptHistory } from "./chat-composer.mjs";
import { createChatRenderingController } from "./chat-rendering.mjs";
import {
  addRecentConversation,
  buildNavigationView,
  normalizeNavigationPayload,
  normalizeRecentConversations,
  parseNavigationTargetId,
  renderNavigationHTML,
  renderRecentConversationsHTML,
} from "./conversation-navigation.mjs";
import {
  basename,
  canonicalLocalPath,
  createDirectoryBrowserController,
  normalizePath,
  normalizeRecentDirectories,
  shortPath,
} from "./directory-browser.mjs";
import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatNumber, formatTimestamp } from "./formatters.mjs";
import { createGitWorkflowController } from "./git-workflow.mjs";
import { createLocalPreferencesSettingsController } from "./local-preferences-settings.mjs";
import { createMCPRegistryUIController } from "./mcp-registry-ui.mjs";
import { createMemorySettingsController } from "./memory-settings.mjs";
import { createModelProviderSettingsController } from "./model-provider-settings.mjs";
import { readLocalPreference, recentConversationsKey } from "./preferences-data.mjs";
import { applyServerSkillsLoadResult, createSkillsPhaseBController, hydrateServerSkillSummaries, isOptimisticSkillConflict, loadServerSkillsWithFallback, normalizeSkillContext } from "./skills-bootstrap.mjs";
import { api, webSocketURL } from "./runtime.mjs";
import { settingsItems, settingsSections } from "./settings-data.mjs";
import { createSettingsPanelRegistry } from "./settings-panel-registry.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";
import { createSystemSettingsController } from "./system-settings.mjs";
import { createSkillsWorkbenchController } from "./skills-workbench.mjs";
import { createTerminalController } from "./terminal.mjs";
import { createUIShellController, elementVisible, isComposingInput } from "./ui-shell.mjs";
import { createWorkspaceSettingsController } from "./workspace-settings.mjs";
import { createWorkspaceExplorerController } from "./workspace-explorer.mjs";

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

let skillsPhaseB = null;

const state = {
  projects: [],
  navigationConversations: [],
  navigationLoadSeq: 0,
  navigationMode: "all",
  recentConversations: [],
  project: null,
  workline: null,
  agent: null,
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
  serverSkills: [],
  serverSkillsStatus: "idle",
  serverSkillsHadServerData: false,
  serverSkillsLoadSeq: 0,
  serverSkillsSaving: false,
  serverSkillsError: "",
  activeSkillTab: "commands",
  skillContextScope: "global",
  skillsV2: { contexts: {}, effective: {} },
  workflowPreferences: null,
  workflowError: "",
  workflowLoading: false,
  workflowSaving: false,
  toolPermissionRules: [],
  toolPermissionRulesLoading: false,
  toolPermissionRulesSaving: false,
  toolPermissionRulesError: "",
  notifications: null,
  serverNotificationSettings: null,
  serverNotificationError: "",
  serverNotificationLoading: false,
  serverNotificationSaving: false,
  serverNotificationTesting: false,
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
  agentSaving: false,
  agentSavePending: false,
  messageSendingByAgent: {},
  messageRefreshTimersByAgent: {},
  currentMessages: [],
  messageCopyTexts: [],
  activeRunSummary: null,
  activeRunSummaryRunId: "",
  runSummaryLoading: false,
  runSummaryError: "",
  runRollbackBusy: false,
  runSummarySeq: 0,
  liveToolOutputs: {},
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
  projectWorklines: [],
  worklineAgents: [],
  worklinesError: "",
  worklinesSeq: 0,
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

const workspaceExplorer = createWorkspaceExplorerController({
  state,
  request: api,
  showError,
  showToast,
});

function getSelectedModelValue() {
  return selectedModelValue();
}

const chatRendering = createChatRenderingController({
  state,
  attachmentIcon,
  attachmentKind,
  copyToClipboard,
  notifyTerminal,
  openGitModal: () => gitWorkflow.openGitModal?.(),
  refreshGitWorkflow: (options) => gitWorkflow.refreshGitWorkflow?.(options),
  selectedModelValue: getSelectedModelValue,
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
  bind: bindWorkspaceExplorer,
  setAgent: setWorkspaceExplorerAgent,
} = workspaceExplorer;

const {
  appendToolOutput,
  applyMessageSnapshot,
  clearCurrentAgentApprovals,
  clearMessageRefreshTimer,
  clearRunSummary,
  clearToolApproval,
  copyCurrentConversationMarkdown,
  finishToolOutput,
  loadLatestRunSummary,
  loadMessages,
  loadRunSummary,
  rememberToolApproval,
  rememberToolStarted,
  replacePendingApprovals,
  scheduleMessageRefresh,
  updateConversationCopyButton,
} = chatRendering;

const agentStream = createAgentStreamController({
  api,
  webSocketURL,
  onEvent: handleAgentStreamEvent,
  onSnapshot: applyAgentLiveSnapshot,
  onStatus: updateAgentStreamStatus,
  onError: (error) => notifyTerminal(`[warn] Agent 实时流恢复失败：${error?.message || error}\n`),
});

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
  getEffectiveSkillsPolicy: () => skillsPhaseB?.getEffectivePolicy(state.agent?.id, getEffectiveSkillContext()) || {
    items: [], status: "idle", error: "", hasAuthoritativeData: false,
  },
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
  state,
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
  loadServerNotificationSettings,
  saveServerNotificationSettings,
  testServerNotification,
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
  disconnectAgentTransports,
  enterAgent,
  getPreferredModel,
  hideSlashCommandPalette,
  loadWorklineContainerData,
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
  bindWorklinesSettingsActions,
  renderAgentSettingsContent,
  renderWorklinesSettingsContent,
} = workspaceSettings;

function getSkillContext() {
  return normalizeSkillContext({
    scope: state.skillContextScope,
    projectId: state.project?.id || "",
    worklineId: state.workline?.id || "",
  });
}

function getEffectiveSkillContext() {
  if (state.project?.id && state.workline?.id) {
    return normalizeSkillContext({
      scope: "workspace",
      projectId: state.project.id,
      worklineId: state.workline.id,
    });
  }
  if (state.project?.id) return normalizeSkillContext({ scope: "project", projectId: state.project.id });
  return normalizeSkillContext({ scope: "global" });
}

function setSkillContext(context = {}) {
  const requested = normalizeSkillContext({
    ...context,
    projectId: state.project?.id || context.projectId || "",
    worklineId: state.workline?.id || context.worklineId || "",
  });
  if (requested.scope === "project" && !requested.projectId) {
    state.skillContextScope = "global";
    showToast("请先选择项目，再查看项目级 Skills。", "warn");
    return getSkillContext();
  }
  if (requested.scope === "workspace" && !requested.worklineId) {
    state.skillContextScope = state.project?.id ? "project" : "global";
    showToast("请先选择工作线，再查看工作区 Skills。", "warn");
    return getSkillContext();
  }
  state.skillContextScope = requested.scope;
  return requested;
}

let skillsPhaseBRenderQueued = false;
skillsPhaseB = createSkillsPhaseBController({
  state,
  api,
  getContext: getSkillContext,
  onEffectiveInvalidated: () => refreshEffectiveSkillsPolicy(),
  onChange: () => {
    updateSlashCommandPalette();
    updatePromptHistoryHint();
    if (skillsPhaseBRenderQueued || state.activeSettingsPanel !== "skills") return;
    skillsPhaseBRenderQueued = true;
    queueMicrotask(() => {
      skillsPhaseBRenderQueued = false;
      if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
    });
  },
});

async function refreshEffectiveSkillsPolicy() {
  const agentId = state.agent?.id || "";
  if (!agentId || !skillsPhaseB) return [];
  try {
    return await skillsPhaseB.loadEffective(agentId, getEffectiveSkillContext());
  } catch (error) {
    notifyTerminal(`[warn] effective Skills 刷新失败：${error?.message || error}\n`);
    return [];
  }
}

function invalidateAndRefreshEffectiveSkillsPolicy() {
  skillsPhaseB?.invalidateEffective({ drop: true });
  return refreshEffectiveSkillsPolicy();
}

const skillsWorkbench = createSkillsWorkbenchController({
  state,
  bindMCPRegistryActions,
  copyText,
  createServerSkill,
  createToolPermissionRule,
  currentSkillsPreferences,
  deleteServerSkill,
  deleteToolPermissionRule,
  isMCPRegistryActionBusy,
  importServerSkill,
  loadServerSkills,
  loadServerSkillDetail,
  loadWorkflowPolicy,
  localSkillID,
  normalizeMCPServer,
  normalizeSkillCommand,
  notifyTerminal,
  previewServerSkillImport,
  renderMCPRegistryList,
  resetSkillsPreferences,
  saveSkillsPreferences,
  saveWorkflowPreferences,
  showError,
  skillsPhaseB,
  skillsPrefsExport,
  getSkillContext,
  setSkillContext,
  updateServerSkill,
  updateToolPermissionRule,
});

const {
  bindSkillTabs,
  renderSkillSettingsContent,
} = skillsWorkbench;

const memorySettings = createMemorySettingsController({
  request: api,
  onChange: () => {
    if (state.activeSettingsPanel === "memory") refreshActiveSettingsPanel();
  },
  showError,
  showToast,
});

const settingsPanelRegistry = createSettingsPanelRegistry();
[
  ["profile", { render: renderProfileSettingsContent, bind: bindProfileSettingsActions }],
  ["memory", { render: memorySettings.render, bind: memorySettings.bind }],
  ["skills", { render: () => renderSkillSettingsContent(state.activeSkillTab || "commands"), bind: () => bindSkillTabs("commands") }],
  ["models", { render: renderModelSettingsContent, bind: bindModelSettingsActions }],
  ["agents", { render: renderAgentSettingsContent, bind: bindAgentSettingsActions }],
  ["providers", { render: renderProviderSettingsContent, bind: bindProviderSettingsActions }],
  ["network-search", { render: renderNetworkSearchSettingsContent, bind: bindNetworkSearchSettingsActions }],
  ["im-gateway", { render: renderIMGatewaySettingsContent, bind: bindIMGatewaySettingsActions }],
  ["notifications", { render: renderNotificationSettingsContent, bind: bindNotificationSettingsActions }],
  ["appearance", { render: renderAppearanceSettingsContent, bind: bindAppearanceSettingsActions }],
  ["agent-admin", { render: renderAgentAdminSettingsContent, bind: bindAgentAdminSettingsActions }],
  ["worklines-containers", { render: renderWorklinesSettingsContent, bind: bindWorklinesSettingsActions }],
  ["storage", { render: renderStorageSettingsContent, bind: bindStorageSettingsActions }],
  ["usage", { render: renderUsageSettingsContent, bind: bindUsageSettingsActions }],
  ["servers-system", { render: renderServerSystemSettingsContent, bind: bindRuntimeSettingsActions }],
  ["runtime", { render: renderRuntimeSettingsContent, bind: bindRuntimeSettingsActions }],
  ["users", { render: renderUserSettingsContent, bind: bindUserSettingsActions }],
  ["terminals", { render: renderTerminalSettingsContent, bind: bindTerminalSettingsActions }],
  ["about", { render: renderAboutSettingsContent, bind: bindAboutSettingsActions }],
].forEach(([key, panel]) => settingsPanelRegistry.register(key, panel));

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

async function loadServerNotificationSettings({ notify = false } = {}) {
  state.serverNotificationLoading = true;
  state.serverNotificationError = "";
  try {
    state.serverNotificationSettings = await api("/api/notifications/settings");
    if (notify) notifyTerminal("[info] 服务端通知设置已刷新。\n");
  } catch (err) {
    state.serverNotificationSettings = null;
    state.serverNotificationError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 服务端通知设置刷新失败：${state.serverNotificationError}\n`);
  } finally {
    state.serverNotificationLoading = false;
  }
  if (state.activeSettingsPanel === "notifications") refreshActiveSettingsPanel();
}

async function saveServerNotificationSettings(payload) {
  state.serverNotificationSaving = true;
  state.serverNotificationError = "";
  try {
    state.serverNotificationSettings = await api("/api/notifications/settings", { method: "PUT", body: JSON.stringify(payload) });
    showToast("Webhook 通知设置已保存。", "success", { force: true });
    notifyTerminal("[info] Webhook 通知设置已保存。\n");
  } catch (err) {
    state.serverNotificationError = err.message || String(err);
    showError(err);
  } finally {
    state.serverNotificationSaving = false;
    if (state.activeSettingsPanel === "notifications") refreshActiveSettingsPanel();
  }
}

async function testServerNotification() {
  state.serverNotificationTesting = true;
  state.serverNotificationError = "";
  try {
    await api("/api/notifications/test", { method: "POST", body: JSON.stringify({}) });
    showToast("Webhook 测试通知已发送。", "success", { force: true });
    notifyTerminal("[info] Webhook 测试通知已发送。\n");
  } catch (err) {
    state.serverNotificationError = err.message || String(err);
    showError(err);
  } finally {
    state.serverNotificationTesting = false;
    if (state.activeSettingsPanel === "notifications") refreshActiveSettingsPanel();
  }
}

function sortServerSkills(a, b) {
  return Number(Boolean(b?.enabled)) - Number(Boolean(a?.enabled))
    || String(a?.command || "").localeCompare(String(b?.command || ""));
}

function refreshServerSkillsUI() {
  updateSlashCommandPalette();
  updatePromptHistoryHint();
  if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
}

async function loadServerSkills({ notify = false } = {}) {
  const seq = ++state.serverSkillsLoadSeq;
  const previous = Array.isArray(state.serverSkills) ? state.serverSkills : [];
  if (state.serverSkillsStatus === "ready" || state.serverSkillsStatus === "stale") state.serverSkillsHadServerData = true;
  const hadServerData = state.serverSkillsHadServerData;
  state.serverSkillsStatus = "loading";
  state.serverSkillsError = "";
  refreshServerSkillsUI();
  const result = await loadServerSkillsWithFallback(async () => {
    const summaries = await api("/api/skills");
    return hydrateServerSkillSummaries(summaries, (id) => api(`/api/skills/${encodeURIComponent(id)}`), 4);
  }, previous, { hadServerData });
  if (seq !== state.serverSkillsLoadSeq) return state.serverSkills;
  applyServerSkillsLoadResult(state, seq, { ...result, skills: result.skills.sort(sortServerSkills) });
  if (result.status === "ready") state.serverSkillsHadServerData = true;
  if (notify) {
    const fallback = hadServerData ? "已保留上次加载的服务端策略" : "尚无 authoritative policy，本地模板保持不可用";
    notifyTerminal(result.error
      ? `[warn] 服务端技能刷新失败，${fallback}：${result.error}\n`
      : "[info] 服务端技能已刷新。\n");
  }
  refreshServerSkillsUI();
  return state.serverSkills;
}

async function loadServerSkillDetail(id) {
  const skill = (state.serverSkills || []).find((item) => item.id === id);
  if (!skill) throw new Error("服务端技能不存在");
  if (skill.detailLoaded && String(skill.prompt || "").trim()) return skill;
  const requestedUpdatedAt = skill.updatedAt;
  try {
    const detail = await api(`/api/skills/${encodeURIComponent(id)}`);
    const latest = (state.serverSkills || []).find((item) => item.id === id);
    if (!latest) throw new Error("服务端技能不存在");
    if (latest.updatedAt !== requestedUpdatedAt && detail.updatedAt !== latest.updatedAt) {
      throw new Error("技能详情已变化，请重新打开后重试");
    }
    const merged = { ...latest, ...detail, detailLoaded: true, detailError: "" };
    state.serverSkills = (state.serverSkills || []).map((item) => item.id === id ? merged : item).sort(sortServerSkills);
    refreshServerSkillsUI();
    return merged;
  } catch (err) {
    const message = err?.message || String(err);
    state.serverSkills = (state.serverSkills || []).map((item) => {
      if (item.id !== id || item.updatedAt !== requestedUpdatedAt) return item;
      return { ...item, detailLoaded: false, detailError: message };
    }).sort(sortServerSkills);
    refreshServerSkillsUI();
    throw err;
  }
}

async function createServerSkill(payload, { silent = false } = {}) {
  state.serverSkillsSaving = true;
  state.serverSkillsError = "";
  try {
    const created = await api("/api/skills", { method: "POST", body: JSON.stringify(payload) });
    state.serverSkills = [{ ...created, detailLoaded: true }, ...(state.serverSkills || []).filter((item) => item.id !== created.id)].sort(sortServerSkills);
    state.serverSkillsStatus = "ready";
    await invalidateAndRefreshEffectiveSkillsPolicy();
    if (!silent) showToast("服务端技能已保存。", "success", { force: true });
    return created;
  } catch (err) {
    state.serverSkillsError = err.message || String(err);
    throw err;
  } finally {
    state.serverSkillsSaving = false;
    refreshServerSkillsUI();
  }
}

async function updateServerSkill(id, payload, { silent = false } = {}) {
  state.serverSkillsSaving = true;
  state.serverSkillsError = "";
  try {
    const current = (state.serverSkills || []).find((item) => item.id === id);
    if (!current?.updatedAt) throw new Error("服务端技能版本缺失，请刷新后重试");
    const updated = await api(`/api/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...payload, expectedUpdatedAt: current.updatedAt }),
    });
    state.serverSkills = (state.serverSkills || []).map((item) => item.id === updated.id ? { ...updated, detailLoaded: true } : item).sort(sortServerSkills);
    state.serverSkillsStatus = "ready";
    await invalidateAndRefreshEffectiveSkillsPolicy();
    if (!silent) showToast("服务端技能已更新。", "success", { force: true });
    return updated;
  } catch (err) {
    if (isOptimisticSkillConflict(err)) {
      await loadServerSkills();
      const message = state.serverSkillsStatus === "ready"
        ? "技能已被其他客户端更新；已刷新服务端列表，请检查后重试。"
        : "技能已被其他客户端更新，但自动刷新失败；请手动刷新后重试。";
      state.serverSkillsError = message;
      throw new Error(message);
    }
    state.serverSkillsError = err.message || String(err);
    throw err;
  } finally {
    state.serverSkillsSaving = false;
    refreshServerSkillsUI();
  }
}

async function deleteServerSkill(id) {
  state.serverSkillsSaving = true;
  state.serverSkillsError = "";
  try {
    await api(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.serverSkills = (state.serverSkills || []).filter((item) => item.id !== id);
    await invalidateAndRefreshEffectiveSkillsPolicy();
    showToast("服务端技能已删除。", "success", { force: true });
  } catch (err) {
    state.serverSkillsError = err.message || String(err);
    throw err;
  } finally {
    state.serverSkillsSaving = false;
    refreshServerSkillsUI();
  }
}

async function previewServerSkillImport(content) {
  return api("/api/skills/import/preview", { method: "POST", body: JSON.stringify({ content }) });
}

async function importServerSkill(content) {
  state.serverSkillsSaving = true;
  state.serverSkillsError = "";
  try {
    const imported = await api("/api/skills/import", { method: "POST", body: JSON.stringify({ content }) });
    state.serverSkills = [{ ...imported, detailLoaded: true }, ...(state.serverSkills || []).filter((item) => item.id !== imported.id)].sort(sortServerSkills);
    state.serverSkillsStatus = "ready";
    await invalidateAndRefreshEffectiveSkillsPolicy();
    showToast("SKILL.md 已导入并保持停用状态。", "success", { force: true });
    return imported;
  } catch (err) {
    state.serverSkillsError = err.message || String(err);
    throw err;
  } finally {
    state.serverSkillsSaving = false;
    refreshServerSkillsUI();
  }
}

async function loadWorkflowPreferences({ notify = false } = {}) {
  state.workflowLoading = true;
  state.workflowError = "";
  try {
    state.workflowPreferences = await api("/api/workflow/preferences");
    if (notify) notifyTerminal("[info] 工作流权限偏好已刷新。\n");
  } catch (err) {
    state.workflowError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 工作流权限偏好刷新失败：${state.workflowError}\n`);
  } finally {
    state.workflowLoading = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

async function saveWorkflowPreferences(payload) {
  state.workflowSaving = true;
  state.workflowError = "";
  try {
    state.workflowPreferences = await api("/api/workflow/preferences", { method: "PUT", body: JSON.stringify(payload) });
    showToast("工具权限偏好已保存。", "success", { force: true });
  } catch (err) {
    state.workflowError = err.message || String(err);
    showError(err);
  } finally {
    state.workflowSaving = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

async function loadToolPermissionRules({ notify = false } = {}) {
  state.toolPermissionRulesLoading = true;
  state.toolPermissionRulesError = "";
  try {
    state.toolPermissionRules = await api("/api/workflow/tool-permissions");
    if (notify) notifyTerminal("[info] 工具权限规则已刷新。\n");
  } catch (err) {
    state.toolPermissionRulesError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 工具权限规则刷新失败：${state.toolPermissionRulesError}\n`);
  } finally {
    state.toolPermissionRulesLoading = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

async function createToolPermissionRule(payload) {
  state.toolPermissionRulesSaving = true;
  state.toolPermissionRulesError = "";
  try {
    const rule = await api("/api/workflow/tool-permissions", { method: "POST", body: JSON.stringify(payload) });
    state.toolPermissionRules = [rule, ...(state.toolPermissionRules || [])].sort(toolPermissionRuleSort);
    showToast("工具权限规则已添加。", "success", { force: true });
  } catch (err) {
    state.toolPermissionRulesError = err.message || String(err);
    showError(err);
  } finally {
    state.toolPermissionRulesSaving = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

async function updateToolPermissionRule(id, payload) {
  state.toolPermissionRulesSaving = true;
  state.toolPermissionRulesError = "";
  try {
    const rule = await api(`/api/workflow/tool-permissions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    state.toolPermissionRules = (state.toolPermissionRules || []).map((item) => item.id === id ? rule : item).sort(toolPermissionRuleSort);
    showToast("工具权限规则已更新。", "success", { force: true });
  } catch (err) {
    state.toolPermissionRulesError = err.message || String(err);
    showError(err);
  } finally {
    state.toolPermissionRulesSaving = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

async function deleteToolPermissionRule(id) {
  state.toolPermissionRulesSaving = true;
  state.toolPermissionRulesError = "";
  try {
    await api(`/api/workflow/tool-permissions/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.toolPermissionRules = (state.toolPermissionRules || []).filter((item) => item.id !== id);
    showToast("工具权限规则已删除。", "success", { force: true });
  } catch (err) {
    state.toolPermissionRulesError = err.message || String(err);
    showError(err);
  } finally {
    state.toolPermissionRulesSaving = false;
    if (state.activeSettingsPanel === "skills") refreshActiveSettingsPanel();
  }
}

function toolPermissionRuleSort(a, b) {
  return Number(b?.priority || 0) - Number(a?.priority || 0) || String(a?.createdAt || "").localeCompare(String(b?.createdAt || ""));
}

async function loadWorkflowPolicy({ notify = false } = {}) {
  await Promise.allSettled([loadWorkflowPreferences({ notify }), loadToolPermissionRules({ notify })]);
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

async function loadWorklineContainerData({ notify = false } = {}) {
  const seq = ++state.worklinesSeq;
  const button = $("refreshWorklinesBtn");
  setButtonBusy(button, true, "刷新中");
  const projectId = state.project?.id || "";
  try {
    if (!projectId) {
      state.projectWorklines = [];
      state.worklineAgents = [];
      state.worklinesError = "";
      return;
    }
    const worklines = await api(`/api/projects/${projectId}/worklines`);
    if (seq !== state.worklinesSeq || state.project?.id !== projectId) return;
    state.projectWorklines = Array.isArray(worklines) ? worklines : [];
    if (!state.workline && state.projectWorklines.length) state.workline = state.projectWorklines[0];
    const currentWorkline = state.projectWorklines.find((workline) => workline.id === state.workline?.id) || state.projectWorklines[0] || null;
    if (currentWorkline) state.workline = currentWorkline;
    if (currentWorkline?.id) {
      const worklineId = currentWorkline.id;
      const agents = await api(`/api/worklines/${worklineId}/agents`);
      if (seq !== state.worklinesSeq || state.workline?.id !== worklineId) return;
      state.worklineAgents = Array.isArray(agents) ? agents : [];

    } else {
      state.worklineAgents = [];
    }
    state.worklinesError = "";
    if (notify) notifyTerminal("[info] 工作线与代理状态已刷新。\n");
  } catch (err) {
    if (seq !== state.worklinesSeq || state.project?.id !== projectId) return;
    state.projectWorklines = [];
    state.worklineAgents = [];
    state.worklinesError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] 工作线与代理刷新失败：${state.worklinesError}\n`);
  } finally {
    if (seq === state.worklinesSeq) setButtonBusy(button, false, "刷新中");
  }
  if (seq === state.worklinesSeq && state.activeSettingsPanel === "worklines-containers") refreshActiveSettingsPanel();
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
    updateSecurityModeUI();
    if (notify) notifyTerminal("[info] 运行时状态已刷新。\n");
  } catch (err) {
    if (seq !== state.runtimeSeq) return;
    state.runtimeSummary = null;
    state.runtimeError = err.message || String(err);
    updateSecurityModeUI();
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
  if (!state.serverNotificationSettings && !state.serverNotificationError) tasks.push(loadServerNotificationSettings());
  if (!state.workflowPreferences && !state.workflowError) tasks.push(loadWorkflowPreferences());
  if (!state.toolPermissionRules.length && !state.toolPermissionRulesError) tasks.push(loadToolPermissionRules());
  if (state.serverSkillsStatus === "idle") tasks.push(loadServerSkills());
  Promise.allSettled(tasks).catch(() => {});
}

const globalRailSettingsTargets = new Set(["skills", "runtime", "im-gateway", "agents", "profile"]);

function setGlobalRailActive(target = "conversation") {
  document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
    const active = node.dataset.globalRailTarget === target;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function openSettingsModal(key = "profile") {
  state.settingsSearchQuery = "";
  $("settingsModal").classList.remove("hidden");
  setGlobalRailActive(globalRailSettingsTargets.has(key) ? key : "profile");
  syncSettingsSearchInput();
  warmSettingsData();
  renderSettingsNav(key);
  selectSettingsPanel(key);
}

function closeSettingsModal() {
  $("settingsModal").classList.add("hidden");
  setGlobalRailActive("conversation");
}

function activateGlobalRailTarget(target) {
  const key = String(target || "conversation");
  closeSidebarSettingsMenu();
  closeMobileSidebar();
  if (key === "conversation") {
    closeSettingsModal();
    return;
  }
  if (globalRailSettingsTargets.has(key)) openSettingsModal(key);
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
  const panel = settingsPanelRegistry.resolve(item.key);
  state.activeSettingsPanel = item.key;
  $("settingsContentTitle").textContent = item.label;
  $("settingsContentSubtitle").textContent = item.subtitle;
  $("settingsContentBody").innerHTML = panel ? panel.render(item) : renderGenericSettingsContent(item);
  $("settingsNav").querySelectorAll(".settings-nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.settingsKey === item.key);
  });
  panel?.bind?.(item);
}

function refreshActiveSettingsPanel() {
  const modal = $("settingsModal");
  if (!modal || modal.classList.contains("hidden")) return;
  selectSettingsPanel(state.activeSettingsPanel || "profile");
}

function renderGenericSettingsContent(item) {
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
      { title: "Autoto", text: "Local-first Go AI coding Autoto server MVP." },
      { title: "License", text: "MIT License；第三方依赖请查看 THIRD_PARTY_NOTICES.md。" },
    ],
  };
  return base[key] || [
    { title: "页面已预留", text: "该设置项已加入导航，具体配置表单将在后续版本补齐。" },
    { title: "下一步", text: "可根据实际后端能力继续接入 API、验证和保存逻辑。" },
  ];
}

function renderEmptyWorkspaceCard({ title = "选择资料夹，让 AI 开始工作", text = "Autoto 会在该资料夹内读取、编辑文件，并按权限执行命令。", action = "选择资料夹", hint = "也可以点击左侧 AI 代理右侧的 ＋。", icon = "☻" } = {}) {
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
    bypassPermissions: "全部允许",
    dontAsk: "不询问",
    default: "自动",
  };
  return labels[value] || value || "自动";
}

function updatePermissionModeDisplay() {
  const select = $("permissionMode");
  const display = document.querySelector(".mode-display");
  if (!select || !display) return;
  display.textContent = permissionLabel(effectivePermissionForDisplay(select.value));
}

function currentSecuritySummary() {
  return state.runtimeSummary?.security || null;
}

function remoteSecurityHardeningActive() {
  const security = currentSecuritySummary();
  if (!security) return false;
  return Boolean(security.remoteAccessRequired || security.exposed || security.currentRequestRemote || security.bypassPermissionsAllowed === false);
}

function bypassDisabledBySecurity() {
  const security = currentSecuritySummary();
  return remoteSecurityHardeningActive() && security?.bypassPermissionsAllowed === false;
}

function effectivePermissionForDisplay(value) {
  if (value === "bypassPermissions" && bypassDisabledBySecurity()) return "acceptEdits";
  return value;
}

function enforcePermissionSelectCap() {
  const select = $("permissionMode");
  if (!select) return;
  const disabled = bypassDisabledBySecurity();
  const option = Array.from(select.options).find((item) => item.value === "bypassPermissions");
  if (option) {
    option.disabled = disabled;
    option.textContent = disabled ? "全部允许（远程禁用）" : "全部允许";
  }
  if (disabled && select.value === "bypassPermissions") {
    select.value = "acceptEdits";
  }
  updatePermissionModeDisplay();
}

async function logoutRemoteAccess() {
  closeSidebarSettingsMenu();
  if (!remoteSecurityHardeningActive()) {
    showToast("本地 MVP 暂未启用完整账户系统，无需退出登录。", "info");
    return;
  }
  await api("/auth/remote-access/logout", { method: "POST" });
  showToast("已退出远程访问，请重新输入访问密码。", "success", { force: true });
  location.reload();
}

function updateSecurityModeUI() {
  const security = currentSecuritySummary();
  const active = remoteSecurityHardeningActive();
  const terminalLocked = Boolean(security?.remoteAccessRequired && security?.remoteTerminalAllowed === false);
  const badge = $("securityModeBadge");
  if (badge) {
    badge.textContent = active ? "隧道收紧" : "本地";
    badge.title = security?.message || (active ? "远程收紧已启用" : "本地模式");
    badge.classList.toggle("warn", active);
    badge.classList.toggle("ok", !active);
  }
  const banner = $("remoteSecurityBanner");
  if (banner) {
    if (active) {
      const passwordText = security?.accessPasswordConfigured ? "访问密码已启用" : "未配置访问密码";
      const terminalText = terminalLocked ? "终端已锁定" : "终端显式开放";
      banner.innerHTML = `<strong>远程收紧</strong><span>${escapeHtml(passwordText)} · 已禁用自动执行 · ${escapeHtml(terminalText)}</span>`;
      banner.classList.remove("hidden");
      banner.classList.toggle("danger", !security?.accessPasswordConfigured);
    } else {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      banner.classList.remove("danger");
    }
  }
  [$("toggleTerminalBtn"), $("expandTerminalBtn"), $("reconnectTerminalBtn")].forEach((button) => {
    if (!button) return;
    if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title || "";
    button.disabled = terminalLocked;
    button.title = terminalLocked ? "远程收紧模式默认禁用交互式终端" : button.dataset.defaultTitle;
  });
  enforcePermissionSelectCap();
  updateWorkspaceMetaPills();
}

function currentWorkspaceModel() {
  return state.agent?.model || selectedModelValue() || currentModelValue() || "未选择模型";
}

function updateWorkspaceMetaPills() {
  const el = $("workspaceMetaPills");
  if (!el) return;
  if (!state.project && !state.agent) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const cwd = canonicalLocalPath(state.agent?.cwd || state.project?.gitPath || "");
  const permission = effectivePermissionForDisplay(state.agent?.permissionMode || $("permissionMode")?.value || state.settings?.agent?.defaultPermissionMode || "acceptEdits");
  const model = currentWorkspaceModel();
  const securityText = remoteSecurityHardeningActive() ? "隧道收紧" : "本地";
  el.innerHTML = `
    <span class="workspace-pill" title="${escapeAttr(cwd)}">目录：${escapeHtml(shortPath(cwd))}</span>
    <span class="workspace-pill">权限：${escapeHtml(permissionLabel(permission))}</span>
    <span class="workspace-pill security-workspace-pill">模式：${escapeHtml(securityText)}</span>
    <span class="workspace-pill" title="${escapeAttr(model)}">模型：${escapeHtml(model)}</span>
  `;
  el.classList.remove("hidden");
}

function loadRecentConversations() {
  try {
    return normalizeRecentConversations(JSON.parse(readLocalPreference(recentConversationsKey) || "[]"));
  } catch {
    return [];
  }
}

function rememberCurrentConversation() {
  if (!state.project?.id || !state.workline?.id || !state.agent?.id) return;
  state.recentConversations = addRecentConversation(state.recentConversations, {
    projectId: state.project.id,
    worklineId: state.workline.id,
    agentId: state.agent.id,
  });
  try {
    localStorage.setItem(recentConversationsKey, JSON.stringify(state.recentConversations));
  } catch {}
  renderRecentSidebarConversations();
}

function renderRecentSidebarConversations() {
  const el = $("recentSidebarConversations");
  if (!el) return;
  el.innerHTML = renderRecentConversationsHTML(state.recentConversations, state.navigationConversations, state.agent?.id || "");
  el.querySelectorAll("[data-navigation-target]").forEach((node) => {
    node.addEventListener("click", () => selectNavigationConversation(node.dataset.navigationTarget).catch(showError));
  });
}

async function loadProjects() {
  const seq = ++state.navigationLoadSeq;
  try {
    const payload = await api("/api/navigation");
    if (seq !== state.navigationLoadSeq) return;
    const navigation = normalizeNavigationPayload(payload);
    state.projects = navigation.projects;
    state.navigationConversations = navigation.conversations;
    renderProjects();
  } catch (err) {
    if (seq === state.navigationLoadSeq) throw err;
  }
}

function renderProjects() {
  const el = $("projects");
  if (!el) return;
  const view = buildNavigationView({ projects: state.projects, conversations: state.navigationConversations }, {
    mode: state.navigationMode,
    query: state.projectQuery,
  });
  el.innerHTML = renderNavigationHTML(view, {
    activeProjectId: state.project?.id || "",
    activeAgentId: state.agent?.id || "",
  });
  $("navigationFilters")?.querySelectorAll("[data-navigation-mode]").forEach((node) => {
    const active = node.dataset.navigationMode === state.navigationMode;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });
  el.querySelectorAll("[data-project-id]").forEach((node) => {
    node.addEventListener("click", () => selectProject(node.dataset.projectId).catch(showError));
  });
  el.querySelectorAll("[data-navigation-target]").forEach((node) => {
    node.addEventListener("click", () => selectNavigationConversation(node.dataset.navigationTarget).catch(showError));
  });
  renderRecentSidebarConversations();
  renderRecentSidebarDirectories();
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
    state.workline = created.workline;
    state.agent = created.agent;
    state.projectWorklines = created.workline ? [created.workline] : [];
    state.worklineAgents = created.agent ? [created.agent] : [];
    renderProjects();
    await enterAgent();
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

function beginNavigationSelection(project) {
  saveCurrentChatDraft();
  hideSlashCommandPalette();
  closeMobileSidebar();
  state.projectCreateSeq++;
  const seq = ++state.projectSelectSeq;
  disconnectAgentTransports();
  state.project = project || null;
  state.workline = null;
  state.agent = null;
  setWorkspaceExplorerAgent(null);
  syncMessageComposerBusy();
  state.currentMessages = [];
  state.messageCopyTexts = [];
  resetGitWorkflowState();
  updateConversationCopyButton();
  setMessageInputValue("", { saveDraft: false });
  state.projectWorklines = [];
  state.worklineAgents = [];
  renderProjects();
  return seq;
}

async function selectProject(id) {
  const seq = beginNavigationSelection(state.projects.find((project) => project.id === id) || null);
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
    text: "Autoto 正在准备工作线和 AI 代理。",
    action: "选择其他资料夹",
    hint: state.project.gitPath || "",
    icon: "…",
  });
  try {
    const worklines = await api(`/api/projects/${id}/worklines`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id) return;
    state.projectWorklines = Array.isArray(worklines) ? worklines : [];
    state.workline = state.projectWorklines[0] || null;
    if (!state.workline) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = "此项目还没有可用工作线";
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: "此项目还没有可用工作线", text: "你可以重新选择一个资料夹，或稍后在工作线管理中创建工作线。", action: "选择其他资料夹", icon: "◇" });
      return;
    }
    const worklineId = state.workline.id;
    const agents = await api(`/api/worklines/${worklineId}/agents`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id || state.workline?.id !== worklineId) return;
    state.worklineAgents = Array.isArray(agents) ? agents : [];
    state.agent = state.worklineAgents.find((agent) => agent.type === "primary") || state.worklineAgents[0] || null;
    if (!state.agent) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = "未选择 Agent";
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: "此工作线还没有可用代理", text: "你可以重新选择一个资料夹，或稍后在代理管理中创建代理。", action: "选择其他资料夹", icon: "♧" });
      return;
    }
    await enterAgent();
    if (seq !== state.projectSelectSeq) return;
  } catch (err) {
    if (seq === state.projectSelectSeq && state.project?.id === id) throw err;
  }
}

async function selectNavigationConversation(target) {
  const parsed = typeof target === "string" ? parseNavigationTargetId(target) : parseNavigationTargetId(target?.targetId || "");
  if (!parsed) throw new Error("无效的会话导航目标");
  const navigationConversation = state.navigationConversations.find((item) => item.targetId === parsed.targetId) || null;
  const project = state.projects.find((item) => item.id === parsed.projectId) || (navigationConversation ? {
    id: navigationConversation.projectId,
    name: navigationConversation.projectName,
    gitPath: navigationConversation.projectPath,
    updatedAt: navigationConversation.projectUpdatedAt,
  } : null);
  const seq = beginNavigationSelection(project);
  if (!state.project) {
    showEmptyWorkspaceState();
    throw new Error("对应项目已不存在，请刷新导航后重试");
  }

  $("currentTitle").textContent = navigationConversation?.projectName || state.project.name;
  $("currentMeta").textContent = "正在打开指定会话…";
  updateWorkspaceMetaPills();
  showEmptyWorkspaceState({
    title: "正在打开会话",
    text: "Autoto 正在定位指定工作线和 AI 代理。",
    action: "选择其他资料夹",
    hint: [navigationConversation?.worklineTitle, navigationConversation?.agentTitle].filter(Boolean).join(" / "),
    icon: "…",
  });

  try {
    const [worklines, agents] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(parsed.projectId)}/worklines`),
      api(`/api/worklines/${encodeURIComponent(parsed.worklineId)}/agents`),
    ]);
    if (seq !== state.projectSelectSeq || state.project?.id !== parsed.projectId) return;
    state.projectWorklines = Array.isArray(worklines) ? worklines : [];
    state.workline = state.projectWorklines.find((item) => item.id === parsed.worklineId) || null;
    state.worklineAgents = Array.isArray(agents) ? agents : [];
    state.agent = state.worklineAgents.find((item) => item.id === parsed.agentId) || null;
    if (!state.workline || !state.agent) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = "指定会话已不可用";
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({
        title: "指定会话已不可用",
        text: "工作线或 Agent 可能已被删除，请刷新导航后选择其他会话。",
        action: "选择其他资料夹",
        icon: "◇",
      });
      throw new Error("指定工作线或 Agent 已不存在");
    }
    await enterAgent();
    if (seq !== state.projectSelectSeq) return;
    renderProjects();
  } catch (err) {
    if (seq === state.projectSelectSeq && state.project?.id === parsed.projectId) throw err;
  }
}

async function enterAgent() {
  if (!state.agent) return;
  const agentId = state.agent.id;
  setWorkspaceExplorerAgent(state.agent);
  $("currentTitle").textContent = state.project?.name || state.agent.title;
  $("currentMeta").textContent = state.agent.title || "AI 代理已就绪";
  $("permissionMode").value = state.agent.permissionMode || "acceptEdits";
  enforcePermissionSelectCap();
  updateWorkspaceMetaPills();
  renderModelOptions();
  restoreCurrentChatDraft();
  syncMessageComposerBusy();
  clearRunSummary();
  connectWS();
  connectTerminal();
  loadGitStatus({ silent: true }).catch(() => {});
  const effectiveSkillsPromise = refreshEffectiveSkillsPolicy();
  await loadLatestRunSummary(agentId);
  await Promise.all([loadMessages(agentId), effectiveSkillsPromise]);
  if (state.agent?.id !== agentId) return;
  rememberCurrentConversation();
  renderProjects();
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

function setComposerConnectionStatus(text, ok = false) {
  const label = $("composerStatusText");
  const dot = $("composerStatusDot");
  if (label) label.textContent = text;
  if (dot) dot.classList.toggle("ok", ok);
}

function disconnectAgentTransports() {
  clearMessageRefreshTimer(state.agent?.id);
  agentStream.disconnect();
  state.ws = null;
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
  setComposerConnectionStatus("空闲");
  setTerminalStatus("idle");
}

function connectWS() {
  if (!state.agent?.id) return;
  agentStream.connect(state.agent.id).catch((error) => {
    if (state.agent?.id) notifyTerminal(`[warn] Agent 实时快照加载失败：${error?.message || error}\n`);
  });
}

function updateAgentStreamStatus(detail = {}) {
  const badge = $("wsBadge");
  const streamStatus = detail.status || "idle";
  const labels = {
    idle: ["ws idle", "空闲", false],
    syncing: ["ws syncing", "同步中", false],
    resyncing: ["ws resync", "恢复中", false],
    connecting: ["ws connecting", "连接中", false],
    reconnecting: ["ws reconnecting", "重连中", false],
    connected: [detail.resume === "replayed" ? "ws replayed" : "ws connected", "已连接", true],
    offline: ["ws offline", "离线", false],
  };
  const [badgeText, composerText, ok] = labels[streamStatus] || labels.offline;
  if (badge) {
    badge.textContent = badgeText;
    badge.classList.toggle("ok", ok);
  }
  setComposerConnectionStatus(composerText, ok);
}

function applyAgentLiveSnapshot(snapshot) {
  const agentId = snapshot?.agent?.id || "";
  if (!agentId || state.agent?.id !== agentId) return;
  state.agent = snapshot.agent;
  state.liveToolOutputs = Object.fromEntries(Object.entries(state.liveToolOutputs || {}).filter(([, value]) => value?.agentId && value.agentId !== agentId));
  clearRunSummary();
  replacePendingApprovals(snapshot.pendingApprovals, agentId);
  applyMessageSnapshot(snapshot.messages, agentId);
  const permissionMode = $("permissionMode");
  if (permissionMode) permissionMode.value = state.agent.permissionMode || "acceptEdits";
  enforcePermissionSelectCap();
  renderModelOptions();
  updateWorkspaceMetaPills();
  syncMessageComposerBusy();
  const latestRun = snapshot.latestRun;
  if (latestRun?.id && ["completed", "failed", "interrupted"].includes(latestRun.status)) {
    loadRunSummary(latestRun.id, { agentId }).catch((error) => notifyTerminal(`[warn] Run 回顾恢复失败：${error?.message || error}\n`));
  }
}

function handleAgentStreamEvent(event) {
  const agentId = state.agent?.id || "";
  if (!agentId || (event.agentId && event.agentId !== agentId)) return;
  if (shouldLogAgentEvents()) appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
  const runId = event.data?.runId || "";
  if (event.type === "agent.started") clearRunSummary();
  if (event.type === "tool.started") rememberToolStarted(event);
  if (event.type === "tool.output") appendToolOutput(event);
  if (event.type === "tool.approval_required") {
    rememberToolApproval(event);
    showToast(event.data?.risk === "danger" ? "危险工具调用已被阻止。" : "有工具调用等待审批。", event.data?.risk === "danger" ? "error" : "warn");
  }
  if (event.type === "tool.finished") {
    clearToolApproval(event.data?.toolUseId);
    finishToolOutput(event);
  }
  if (event.type === "agent.interrupted") clearCurrentAgentApprovals();
  if (["message.created", "agent.done", "agent.error", "agent.interrupted"].includes(event.type)) scheduleMessageRefresh(80, agentId);
  if (["agent.done", "agent.error", "agent.interrupted"].includes(event.type) && runId) {
    loadRunSummary(runId, { agentId }).catch((error) => notifyTerminal(`[warn] Run 回顾加载失败：${error?.message || error}\n`));
  }
}

async function saveAgentSettings() {
  if (state.agentSaving) {
    state.agentSavePending = true;
    return;
  }
  const button = $("saveAgentBtn");
  let agentId = "";
  state.agentSaving = true;
  setButtonBusy(button, true, "保存中");
  try {
    const model = $("modelSelect").value.trim();
    if (model) setPreferredModel(model);
    if (!state.agent) {
      renderModelOptions();
      refreshActiveSettingsPanel();
      notifyTerminal(model ? `[info] 已保存首选模型：${model}\n` : "[info] 尚未选择模型。\n");
      return;
    }
    agentId = state.agent.id;
    const id = agentId;
    const permissionMode = $("permissionMode").value;
    const applyAgentPatch = async (path, payload) => {
      const updated = await api(`/api/agents/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (state.agent?.id !== id) return false;
      state.agent = updated;
      return true;
    };
    if (model && model !== state.agent.model) {
      if (!await applyAgentPatch("model", { model })) return;
    }
    if (permissionMode && permissionMode !== state.agent.permissionMode) {
      if (!await applyAgentPatch("permission-mode", { permissionMode })) return;
    }
    if (state.agent?.id !== id) return;
    await enterAgent();
    if (state.agent?.id !== id) return;
    notifyTerminal(`Saved settings: ${state.agent.model}, ${state.agent.permissionMode}\n`);
  } catch (err) {
    if (!agentId || state.agent?.id === agentId) throw err;
  } finally {
    state.agentSaving = false;
    setButtonBusy(button, false, "保存中");
    if (state.agentSavePending) {
      state.agentSavePending = false;
      saveAgentSettings().catch(showError);
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

bindWorkspaceExplorer();
document.addEventListener("keydown", handleGlobalEscape);
document.addEventListener("keydown", handleSettingsSearchShortcut);
document.addEventListener("click", handleDirectoryShortcutClick);
document.addEventListener("click", handleSidebarSettingsMenuDocumentClick);
document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
  node.addEventListener("click", () => activateGlobalRailTarget(node.dataset.globalRailTarget));
});
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
$("logoutBtn")?.addEventListener("click", () => logoutRemoteAccess().catch(showError));
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
$("mobileSidebarCloseBtn")?.addEventListener("click", closeMobileSidebar);
$("mobileSidebarBackdrop").addEventListener("click", closeMobileSidebar);
$("mobileTerminalBtn").addEventListener("click", toggleMobileTerminal);
$("mobileSearchBtn").addEventListener("click", focusMobileSearch);
$("mobileDrawerSearchBtn")?.addEventListener("click", focusMobileSearch);
$("mobileSidebarSettingsBtn")?.addEventListener("click", () => {
  closeMobileSidebar();
  closeSidebarSettingsMenu();
  openSettingsModal("profile");
});
$("mobileSidebarLogoutBtn")?.addEventListener("click", () => {
  closeMobileSidebar();
  closeSidebarSettingsMenu();
  logoutRemoteAccess().catch(showError);
});
$("navigationFilters")?.querySelectorAll("[data-navigation-mode]").forEach((node) => {
  node.addEventListener("click", () => {
    state.navigationMode = node.dataset.navigationMode || "all";
    renderProjects();
  });
});
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
$("saveAgentBtn").addEventListener("click", () => saveAgentSettings().catch(showError));
$("refreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
$("openProviderLoginBtn").addEventListener("click", () => openSettingsModal("providers"));
$("modelSelect").addEventListener("change", () => {
  updateModelConfiguredState();
  saveAgentSettings().catch(showError);
});
$("permissionMode").addEventListener("change", () => {
  updatePermissionModeDisplay();
  saveAgentSettings().catch(showError);
});
$("toggleTerminalBtn").addEventListener("click", () => toggleTerminal());
$("composerTerminalBtn")?.addEventListener("click", () => toggleTerminal());
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
    state.recentConversations = loadRecentConversations();
    applyAppearancePreferences({ applyTerminalDefault: true });
    autoResizeMessageInput();
    renderRecentSidebarConversations();
    renderRecentSidebarDirectories();
    await loadHealth();
    await Promise.all([loadSettings(), loadRuntimeSummary(), loadModelCatalog(), loadProjects(), loadBackends(), loadServerSkills()]);
    if (seq !== state.initSeq) return;
    if (!state.agent && state.projects.length) {
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
