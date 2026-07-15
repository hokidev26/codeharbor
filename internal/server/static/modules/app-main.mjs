import { createAgentStreamController } from "./agent-stream.mjs";
import { createAutomationControlController } from "./automation-control.mjs";
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
import { t } from "./i18n.mjs";
import { appMainT as am } from "./messages-app-main-extra.mjs";
import { shellExtraT as sx } from "./messages-shell-extra.mjs";
import { createGitWorkflowController } from "./git-workflow.mjs";
import { createLocalPreferencesSettingsController } from "./local-preferences-settings.mjs";
import { createMCPRegistryUIController } from "./mcp-registry-ui.mjs";
import { createPluginRegistryUIController } from "./plugin-registry-ui.mjs";
import { createMemorySettingsController } from "./memory-settings.mjs";
import { createModelProviderSettingsController } from "./model-provider-settings.mjs?v=native-codex-3-provider-console-1";
import { readLocalPreference, recentConversationsKey } from "./preferences-data.mjs";
import { applyServerSkillsLoadResult, createSkillsPhaseBController, hydrateServerSkillSummaries, isOptimisticSkillConflict, loadServerSkillsWithFallback, normalizeSkillContext } from "./skills-bootstrap.mjs";
import { api, webSocketURL } from "./runtime.mjs";
import { firstSettingsItemForCategory, legacySettingsCategories, settingsCategoryByKey, settingsCategoryForItem } from "./settings-categories.mjs";
import { settingsItems, settingsSections } from "./settings-data.mjs";
import { createSettingsPanelRegistry } from "./settings-panel-registry.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";
import { createSetupWizardController } from "./setup-wizard.mjs";
import { createSpecBoardController } from "./spec-board.mjs";
import { createSystemSettingsController } from "./system-settings.mjs";
import { createSkillsWorkbenchController } from "./skills-workbench.mjs";
import { createTerminalController } from "./terminal.mjs";
import { createUIShellController, elementVisible, isComposingInput } from "./ui-shell.mjs?v=permission-panel-1";
import { createUsageHistoryController } from "./usage-history.mjs";
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
  healthOK: null,
  healthLabel: "checking",
  agentStreamStatus: "idle",
  settings: null,
  settingsLoadSeq: 0,
  modelCatalog: null,
  modelCatalogSeq: 0,
  providerAuthFiles: null,
  providerAuthError: "",
  providerAuthSeq: 0,
  providerConfigStatus: "",
  providerConfigExpanded: {},
  providerConsole: {},
  storageSummary: null,
  storageError: "",
  storageSeq: 0,
  licenseSummary: null,
  licenseError: "",
  licenseSeq: 0,
  updateStatus: null,
  updateError: "",
  updateSeq: 0,
  usageHistory: null,
  runtimeSummary: null,
  runtimeError: "",
  runtimeSeq: 0,
  authStatus: null,
  authUser: undefined,
  authError: "",
  authSeq: 0,
  profile: null,
  searchPrefs: null,
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
  reasoningEffortSaving: false,
  reasoningEffortPending: undefined,
  messageSendingByAgent: {},
  messageRefreshTimersByAgent: {},
  currentMessages: [],
  messageCopyTexts: [],
  messageHasMoreBefore: false,
  messageNextBefore: "",
  messageOlderLoading: false,
  activeRunSummary: null,
  activeRunSummaryRunId: "",
  runSummaryLoading: false,
  runSummaryError: "",
  runRollbackBusy: false,
  runSummarySeq: 0,
  liveToolOutputs: {},
  liveAssistantActive: false,
  liveAssistantText: "",
  liveAssistantRequestId: "",
  liveAssistantRunId: "",
  liveAssistantProvider: "",
  liveAssistantModel: "",
  liveAssistantStartedAt: "",
  liveAssistantPerformance: null,
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
  activeSettingsPanel: "providers",
  activeSettingsCategory: "api",
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
  onPreviewOpen: () => {
    closeConversationDetails();
    toggleTerminal(true);
    $("appShell")?.classList.add("preview-open");
  },
  onPreviewClose: () => {
    $("appShell")?.classList.remove("preview-open");
  },
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
  renderTerminalButtonState,
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
  closeWorkspace,
  openWorkspace,
  setAgent: setWorkspaceExplorerAgent,
} = workspaceExplorer;

const {
  appendLiveAssistantText,
  appendToolOutput,
  applyMessageSnapshot,
  beginLiveAssistantGeneration,
  clearCurrentAgentApprovals,
  clearLiveAssistantText,
  clearMessageRefreshTimer,
  clearRunSummary,
  clearToolApproval,
  copyCurrentConversationMarkdown,
  finishToolOutput,
  loadLatestRunSummary,
  loadMessages,
  loadOlderMessages,
  loadRunSummary,
  rememberToolApproval,
  rememberToolStarted,
  replacePendingApprovals,
  scheduleMessageRefresh,
  updateConversationCopyButton,
  updateLiveAssistantPerformance,
} = chatRendering;

const agentStream = createAgentStreamController({
  api,
  webSocketURL,
  onEvent: handleAgentStreamEvent,
  onSnapshot: applyAgentLiveSnapshot,
  onStatus: updateAgentStreamStatus,
  onError: (error) => notifyTerminal(`[warn] ${am("agentStreamRestoreFailed", { message: error?.message || error })}\n`),
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
  translate: t,
});

const {
  bindComposerSelectMenus,
  bindSidebarResizer,
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

bindSidebarResizer();
bindComposerSelectMenus();

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
} = modelProviderSettings;

const setupWizard = createSetupWizardController({
  state,
  loadModelCatalog,
  loadSettings,
  openSettingsModal,
  renderModelOptions,
  setPreferredModel,
  showToast,
});
const { bindSetupWizardActions, openSetupWizard } = setupWizard;

const specBoard = createSpecBoardController({ request: api, showError, showToast });
specBoard.bind();

const chatComposer = createChatComposerController({
  state,
  attachmentKind,
  currentProviderConfig,
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
  onMessageAccepted: (result, agentId) => specBoard.handleGoalConfirmation(result, agentId),
});

const {
  autoResizeMessageInput,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  handleMessageInput,
  handleMessageKeydown,
  handleMessagePaste,
  hideSlashCommandPalette,
  importAttachmentFiles,
  loadChatDrafts,
  loadPromptHistory,
  openAttachmentPicker,
  refreshFastModeControl,
  refreshReasoningEffortControl,
  restoreCurrentChatDraft,
  saveCurrentChatDraft,
  saveReasoningEffort,
  scheduleMessageInputResize,
  selectedReasoningEffort,
  sendMessage,
  setMessageInputValue,
  syncMessageComposerBusy,
  toggleFastMode,
  updateDraftLimitHint,
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

const pluginRegistryUI = createPluginRegistryUIController({
  state,
  refreshActiveSettingsPanel,
  showError,
  showToast,
});

const {
  bindPluginRegistryActions,
  renderPluginRegistryPanel,
} = pluginRegistryUI;

const {
  applyAppearancePreferences,
  applyProfilePreferences,
  currentAppearancePreferences,
  currentNotificationPreferences,
  currentProfilePreferences,
  currentRegionalPreferences,
  currentSearchPreferences,
  loadAppearancePreferences,
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
  resetNotificationPreferences,
  resetProfilePreferences,
  resetSearchPreferences,
  resetSkillsPreferences,
  restoreLocalPreferencesBackup,
  saveNotificationPreferences,
  saveProfilePreferences,
  saveRegionalPreferences,
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
  currentNotificationPreferences,
  currentProfilePreferences,
  currentRegionalPreferences,
  currentSearchPreferences,
  notifyTerminal,
  profileDisplayName,
  profileGitEnvExample,
  resetNotificationPreferences,
  resetProfilePreferences,
  resetSearchPreferences,
  loadServerNotificationSettings,
  saveServerNotificationSettings,
  testServerNotification,
  saveProfilePreferences,
  saveRegionalPreferences,
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
  bindNetworkSearchSettingsActions,
  bindNotificationSettingsActions,
  bindProfileSettingsActions,
  renderAppearanceSettingsContent,
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
  loadUpdateStatus,
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
  bindUserSettingsActions,
  renderAboutSettingsContent,
  renderRuntimeSettingsContent,
  renderServerSystemSettingsContent,
  renderStorageSettingsContent,
  renderUsageMetricCard,
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
    showToast(sx("app.projectSkillsRequired"), "warn");
    return getSkillContext();
  }
  if (requested.scope === "workspace" && !requested.worklineId) {
    state.skillContextScope = state.project?.id ? "project" : "global";
    showToast(sx("app.workspaceSkillsRequired"), "warn");
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
    notifyTerminal(`[warn] ${am("effectiveSkillsRefreshFailed", { message: error?.message || error })}\n`);
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
  bindPluginRegistryActions,
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
  renderPluginRegistryPanel,
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

const automationControl = createAutomationControlController({
  request: api,
  onChange: () => {
    if (state.activeSettingsPanel === "im-gateway") refreshActiveSettingsPanel();
  },
  showError,
  showToast,
});

const usageHistory = createUsageHistoryController({
  state,
  request: api,
  onChange: () => {
    if (state.activeSettingsPanel === "usage") refreshActiveSettingsPanel();
  },
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
  ["im-gateway", { render: automationControl.render, bind: automationControl.bind }],
  ["notifications", { render: renderNotificationSettingsContent, bind: bindNotificationSettingsActions }],
  ["appearance", { render: renderAppearanceSettingsContent, bind: bindAppearanceSettingsActions }],
  ["agent-admin", { render: renderAgentAdminSettingsContent, bind: bindAgentAdminSettingsActions }],
  ["worklines-containers", { render: renderWorklinesSettingsContent, bind: bindWorklinesSettingsActions }],
  ["storage", { render: renderStorageSettingsContent, bind: bindStorageSettingsActions }],
  ["usage", { render: usageHistory.render, bind: usageHistory.bind }],
  ["servers-system", { render: renderServerSystemSettingsContent, bind: bindRuntimeSettingsActions }],
  ["runtime", { render: renderRuntimeSettingsContent, bind: bindRuntimeSettingsActions }],
  ["users", { render: renderUserSettingsContent, bind: bindUserSettingsActions }],
  ["terminals", { render: renderTerminalSettingsContent, bind: bindTerminalSettingsActions }],
  ["about", { render: renderAboutSettingsContent, bind: bindAboutSettingsActions }],
].forEach(([key, panel]) => settingsPanelRegistry.register(key, panel));

function updateRuntimeStatusButton() {
  const button = $("runtimeStatusBtn");
  const indicator = $("runtimeStatusIndicator");
  if (!button || !indicator) return;
  const streamStatus = state.agentStreamStatus || "idle";
  const security = state.runtimeSummary?.security || {};
  const remoteWarning = Boolean(security.remoteAccessRequired && !security.accessPasswordConfigured);
  let tone = "idle";
  if (state.healthOK === false || state.runtimeError || streamStatus === "offline" || remoteWarning) tone = "error";
  else if (["syncing", "resyncing", "connecting", "reconnecting"].includes(streamStatus)) tone = "busy";
  else if (state.healthOK === true && (!state.agent || streamStatus === "connected")) tone = "ok";
  indicator.className = `header-tool-indicator ${tone}`;
  button.classList.toggle("tool-error", tone === "error");
  const streamLabel = state.agent ? `Agent ${streamStatus}` : t("chat.noAgent");
  button.title = `${t("workspace.main.conversationDetails")} · ${state.healthLabel || "checking"} · ${streamLabel}${remoteWarning ? " · access password is not configured" : ""}`;
}

function conversationDetailMetrics() {
  const messages = Array.isArray(state.currentMessages) ? state.currentMessages : [];
  const summary = state.activeRunSummary || {};
  const terminal = terminalOutputStats();
  const previewRunning = Boolean(state.workspacePreviewStatus?.running || ["running", "started", "ready"].includes(String(state.workspacePreviewStatus?.status || "").toLowerCase()));
  return {
    messages: messages.length,
    cost: Number(summary.costUsd || 0),
    inputTokens: Number(summary.inputTokens || 0),
    outputTokens: Number(summary.outputTokens || 0),
    cacheTokens: Number(summary.cacheReadTokens || summary.cachedTokens || 0),
    tools: Number(summary.toolCallCount || (Array.isArray(summary.toolCalls) ? summary.toolCalls.length : 0)),
    terminal: state.terminalWS ? 1 : terminal.lines > 1 ? 1 : 0,
    browser: previewRunning ? 1 : 0,
    approvals: Number(summary.pendingApprovals || 0),
  };
}

function renderConversationDetails() {
  const body = $("conversationDetailsBody");
  if (!body) return;
  const metrics = conversationDetailMetrics();
  const rows = [
    [sx("app.sessionId"), state.agent?.id || "—", true],
    [sx("app.type"), state.agent?.type || sx("app.programWorkspace")],
    [sx("app.projectPath"), state.agent?.cwd || state.project?.gitPath || "—", true],
    [sx("app.projectName"), state.project?.name || "—"],
    [sx("app.workline"), state.workline?.title || state.workline?.id || "—"],
    [sx("app.currentModel"), state.agent?.model || currentWorkspaceModel()],
    [sx("app.permissionMode"), state.agent?.permissionMode || "—"],
  ];
  body.innerHTML = `
    <section class="conversation-detail-hero"><div><h2>${escapeHtml(state.project?.name || state.agent?.title || sx("app.noConversationSelected"))}</h2><p>${escapeHtml(state.agent?.title || sx("app.selectConversationHint"))}</p></div><span class="conversation-detail-status">${escapeHtml(state.agent?.status || t("chat.idle"))}</span></section>
    <section class="conversation-metric-grid">
      ${[["Messages", metrics.messages], ["Cost", `$${metrics.cost.toFixed(4)}`], [sx("app.inputTokens"), metrics.inputTokens], [sx("app.outputTokens"), metrics.outputTokens], [sx("app.cacheTokens"), metrics.cacheTokens], [sx("app.tools"), metrics.tools], [t("terminal.title"), metrics.terminal], [sx("app.browser"), metrics.browser], [sx("app.pendingApprovals"), metrics.approvals]].map(([label, value]) => `<div class="conversation-metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(typeof value === "number" ? formatNumber(value) : value)}</strong></div>`).join("")}
    </section>
    <section class="conversation-detail-table">${rows.map(([label, value, copy]) => `<div class="conversation-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${copy && value !== "—" ? `<button type="button" data-copy-detail="${escapeAttr(value)}">${escapeHtml(t("workspace.chat.copy"))}</button>` : ""}</div>`).join("")}</section>
    <button class="legacy-secondary-btn conversation-runtime-link" type="button" data-details-runtime>${escapeHtml(sx("app.viewRuntime"))}</button>
  `;
  body.querySelectorAll("[data-copy-detail]").forEach((node) => node.addEventListener("click", () => copyText(node.dataset.copyDetail)));
  body.querySelector("[data-details-runtime]")?.addEventListener("click", () => {
    closeConversationDetails();
    openSettingsModal("runtime");
  });
}

function openConversationDetails() {
  if (!state.agent) showToast(am("selectConversationFirst"), "warn");
  closeWorkspace();
  toggleTerminal(true);
  $("appShell")?.classList.add("details-open");
  $("conversationDetailsPanel")?.classList.remove("hidden");
  $("runtimeStatusBtn")?.classList.add("active");
  $("runtimeStatusBtn")?.setAttribute("aria-expanded", "true");
  renderConversationDetails();
}

function closeConversationDetails() {
  $("appShell")?.classList.remove("details-open");
  $("conversationDetailsPanel")?.classList.add("hidden");
  $("runtimeStatusBtn")?.classList.remove("active");
  $("runtimeStatusBtn")?.setAttribute("aria-expanded", "false");
}

function setHealth(ok, text) {
  state.healthOK = Boolean(ok);
  state.healthLabel = text;
  const badge = $("healthBadge");
  if (badge) {
    badge.textContent = text;
    badge.classList.toggle("ok", ok);
    badge.classList.toggle("err", !ok);
  }
  const globalHealthDot = $("globalHealthDot");
  const globalHealthText = $("globalHealthText");
  globalHealthDot?.classList.toggle("ok", ok);
  globalHealthDot?.classList.toggle("err", !ok);
  if (globalHealthText) globalHealthText.textContent = t(ok ? "shell.online" : "shell.offline");
  updateRuntimeStatusButton();
}

function updateGlobalThemeToggle() {
  const button = $("globalThemeToggleBtn");
  const icon = $("globalThemeToggleIcon");
  if (!button || !icon) return;
  const dark = currentAppearancePreferences().theme === "dark";
  button.setAttribute("aria-pressed", dark ? "true" : "false");
  icon.textContent = dark ? "☀" : "☾";
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
    refreshReasoningEffortControl();
    refreshFastModeControl();
  } catch (err) {
    if (seq === state.settingsLoadSeq) throw err;
  }
}

async function loadServerNotificationSettings({ notify = false } = {}) {
  state.serverNotificationLoading = true;
  state.serverNotificationError = "";
  try {
    state.serverNotificationSettings = await api("/api/notifications/settings");
    if (notify) notifyTerminal(`[info] ${am("notificationSettingsRefreshed")}\n`);
  } catch (err) {
    state.serverNotificationSettings = null;
    state.serverNotificationError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("notificationSettingsRefreshFailed", { message: state.serverNotificationError })}\n`);
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
    showToast(am("notificationSettingsSaved"), "success", { force: true });
    notifyTerminal(`[info] ${am("notificationSettingsSaved")}\n`);
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
    showToast(am("notificationTestSent"), "success", { force: true });
    notifyTerminal(`[info] ${am("notificationTestSent")}\n`);
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
    const fallback = hadServerData ? am("serverSkillsFallbackKept") : am("serverSkillsNoAuthoritative");
    notifyTerminal(result.error
      ? `[warn] ${am("serverSkillsRefreshFailed", { fallback, message: result.error })}\n`
      : `[info] ${am("serverSkillsRefreshed")}\n`);
  }
  refreshServerSkillsUI();
  return state.serverSkills;
}

async function loadServerSkillDetail(id) {
  const skill = (state.serverSkills || []).find((item) => item.id === id);
  if (!skill) throw new Error(am("serverSkillMissing"));
  if (skill.detailLoaded && String(skill.prompt || "").trim()) return skill;
  const requestedUpdatedAt = skill.updatedAt;
  try {
    const detail = await api(`/api/skills/${encodeURIComponent(id)}`);
    const latest = (state.serverSkills || []).find((item) => item.id === id);
    if (!latest) throw new Error(am("serverSkillMissing"));
    if (latest.updatedAt !== requestedUpdatedAt && detail.updatedAt !== latest.updatedAt) {
      throw new Error(am("serverSkillChanged"));
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
    if (!silent) showToast(am("serverSkillSaved"), "success", { force: true });
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
    if (!current?.updatedAt) throw new Error(am("serverSkillVersionMissing"));
    const updated = await api(`/api/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...payload, expectedUpdatedAt: current.updatedAt }),
    });
    state.serverSkills = (state.serverSkills || []).map((item) => item.id === updated.id ? { ...updated, detailLoaded: true } : item).sort(sortServerSkills);
    state.serverSkillsStatus = "ready";
    await invalidateAndRefreshEffectiveSkillsPolicy();
    if (!silent) showToast(am("serverSkillUpdated"), "success", { force: true });
    return updated;
  } catch (err) {
    if (isOptimisticSkillConflict(err)) {
      await loadServerSkills();
      const message = state.serverSkillsStatus === "ready"
        ? am("serverSkillConflictRefreshed")
        : am("serverSkillConflictRefreshFailed");
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
    showToast(am("serverSkillDeleted"), "success", { force: true });
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
    showToast(am("skillImportedDisabled"), "success", { force: true });
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
    if (notify) notifyTerminal(`[info] ${am("workflowPreferencesRefreshed")}\n`);
  } catch (err) {
    state.workflowError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("workflowPreferencesRefreshFailed", { message: state.workflowError })}\n`);
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
    showToast(am("toolPermissionPreferencesSaved"), "success", { force: true });
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
    if (notify) notifyTerminal(`[info] ${am("toolPermissionRulesRefreshed")}\n`);
  } catch (err) {
    state.toolPermissionRulesError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("toolPermissionRulesRefreshFailed", { message: state.toolPermissionRulesError })}\n`);
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
    showToast(am("toolPermissionRuleAdded"), "success", { force: true });
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
    showToast(am("toolPermissionRuleUpdated"), "success", { force: true });
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
    showToast(am("toolPermissionRuleDeleted"), "success", { force: true });
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
  refreshReasoningEffortControl();
  refreshFastModeControl();
  refreshActiveSettingsPanel();
}

async function loadStorageSummary({ notify = false } = {}) {
  const seq = ++state.storageSeq;
  const button = $("refreshStorageSummaryBtn");
  setButtonBusy(button, true, am("scanning"));
  try {
    const summary = await api("/api/storage/summary");
    if (seq !== state.storageSeq) return;
    state.storageSummary = summary;
    state.storageError = "";
    if (notify) notifyTerminal(`[info] ${am("storageRefreshed")}\n`);
  } catch (err) {
    if (seq !== state.storageSeq) return;
    state.storageSummary = null;
    state.storageError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("storageRefreshFailed", { message: state.storageError })}\n`);
  } finally {
    if (seq === state.storageSeq) setButtonBusy(button, false, am("scanning"));
  }
  if (seq === state.storageSeq && state.activeSettingsPanel === "storage") refreshActiveSettingsPanel();
}

async function loadLicenseSummary({ notify = false } = {}) {
  const seq = ++state.licenseSeq;
  const button = $("refreshLicensesBtn");
  setButtonBusy(button, true, am("refreshing"));
  try {
    const summary = await api("/api/licenses");
    if (seq !== state.licenseSeq) return;
    state.licenseSummary = summary;
    state.licenseError = "";
    if (notify) notifyTerminal(`[info] ${am("licensesRefreshed")}\n`);
  } catch (err) {
    if (seq !== state.licenseSeq) return;
    state.licenseSummary = null;
    state.licenseError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("licensesRefreshFailed", { message: state.licenseError })}\n`);
  } finally {
    if (seq === state.licenseSeq) setButtonBusy(button, false, am("refreshing"));
  }
  if (seq === state.licenseSeq && state.activeSettingsPanel === "about") refreshActiveSettingsPanel();
}

async function loadUpdateStatus({ notify = false } = {}) {
  const seq = ++state.updateSeq;
  const button = $("checkForUpdatesBtn");
  setButtonBusy(button, true, am("checking"));
  try {
    const status = await api("/api/update/status");
    if (seq !== state.updateSeq) return;
    state.updateStatus = status;
    state.updateError = "";
    if (notify) notifyTerminal(`[info] ${am("updateStatus", { status: status?.status || "unknown" })}\n`);
  } catch (err) {
    if (seq !== state.updateSeq) return;
    state.updateStatus = null;
    state.updateError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("updateCheckFailed", { message: state.updateError })}\n`);
  } finally {
    if (seq === state.updateSeq) setButtonBusy(button, false, am("checking"));
  }
  if (seq === state.updateSeq && state.activeSettingsPanel === "about") refreshActiveSettingsPanel();
}

async function loadWorklineContainerData({ notify = false } = {}) {
  const seq = ++state.worklinesSeq;
  const button = $("refreshWorklinesBtn");
  setButtonBusy(button, true, am("refreshing"));
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
    if (notify) notifyTerminal(`[info] ${am("worklinesAgentsRefreshed")}\n`);
  } catch (err) {
    if (seq !== state.worklinesSeq || state.project?.id !== projectId) return;
    state.projectWorklines = [];
    state.worklineAgents = [];
    state.worklinesError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("worklinesAgentsRefreshFailed", { message: state.worklinesError })}\n`);
  } finally {
    if (seq === state.worklinesSeq) setButtonBusy(button, false, am("refreshing"));
  }
  if (seq === state.worklinesSeq && state.activeSettingsPanel === "worklines-containers") refreshActiveSettingsPanel();
}

async function loadAuthStatus({ notify = false } = {}) {
  const seq = ++state.authSeq;
  const button = $("refreshAuthStatusBtn");
  setButtonBusy(button, true, am("refreshing"));
  try {
    const status = await api("/api/auth/status");
    if (seq !== state.authSeq) return;
    state.authStatus = status;
    state.authError = "";
    if (notify) notifyTerminal(`[info] ${am("userRegistrationRefreshed")}\n`);
  } catch (err) {
    if (seq !== state.authSeq) return;
    state.authStatus = null;
    state.authError = err.message || String(err);
    if (notify) notifyTerminal(`[warn] ${am("userRegistrationRefreshFailed", { message: state.authError })}\n`);
  } finally {
    if (seq === state.authSeq) setButtonBusy(button, false, am("refreshing"));
  }
  if (seq === state.authSeq && state.activeSettingsPanel === "users") refreshActiveSettingsPanel();
}

async function loadRuntimeSummary({ notify = false } = {}) {
  const seq = ++state.runtimeSeq;
  const button = $("refreshRuntimeSummaryBtn");
  setButtonBusy(button, true, am("refreshing"));
  try {
    const summary = await api("/api/runtime/summary");
    if (seq !== state.runtimeSeq) return;
    state.runtimeSummary = summary;
    state.runtimeError = "";
    updateSecurityModeUI();
    if (notify) notifyTerminal(`[info] ${am("runtimeRefreshed")}\n`);
  } catch (err) {
    if (seq !== state.runtimeSeq) return;
    state.runtimeSummary = null;
    state.runtimeError = err.message || String(err);
    updateSecurityModeUI();
    if (notify) notifyTerminal(`[warn] ${am("runtimeRefreshFailed", { message: state.runtimeError })}\n`);
  } finally {
    if (seq === state.runtimeSeq) setButtonBusy(button, false, am("refreshing"));
  }
  if (seq === state.runtimeSeq && ["servers-system", "runtime"].includes(state.activeSettingsPanel)) refreshActiveSettingsPanel();
}

function warmSettingsData() {
  if (state.settingsWarmupStarted) return;
  state.settingsWarmupStarted = true;
  const tasks = [];
  if (!state.runtimeSummary && !state.runtimeError) tasks.push(loadRuntimeSummary());
  if (!state.storageSummary && !state.storageError) tasks.push(loadStorageSummary());
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

function openSettingsModal(key = "providers") {
  closeEmployeeOverview();
  closeConversationDetails();
  if (state.workspaceOpen && state.workspaceTab === "preview") closeWorkspace();
  const itemKey = settingsItems.some((item) => item.key === key) ? key : "providers";
  state.settingsSearchQuery = "";
  state.activeSettingsCategory = settingsCategoryForItem(itemKey, "api");
  $("settingsModal").classList.remove("hidden");
  setGlobalRailActive(globalRailSettingsTargets.has(key) ? key : "profile");
  syncSettingsSearchInput();
  warmSettingsData();
  renderSettingsNav(itemKey);
  selectSettingsPanel(itemKey);
}

function closeSettingsModal() {
  $("settingsModal").classList.add("hidden");
  setGlobalRailActive("conversation");
}

function employeeAgentRecords() {
  const records = new Map();
  (state.navigationConversations || []).forEach((item) => {
    if (item?.agentId && !records.has(item.agentId)) records.set(item.agentId, item);
  });
  if (state.agent?.id && !records.has(state.agent.id)) {
    records.set(state.agent.id, {
      agentId: state.agent.id,
      agentTitle: state.agent.title || state.agent.id,
      agentStatus: state.agent.status || "idle",
      model: state.agent.model || "",
      permissionMode: state.agent.permissionMode || "",
      cwd: state.agent.cwd || "",
      projectId: state.project?.id || "",
      projectName: state.project?.name || "",
      worklineId: state.workline?.id || "",
      worklineTitle: state.workline?.title || "",
    });
  }
  return [...records.values()];
}

function renderEmployeeOverview() {
  const body = $("employeeOverviewBody");
  if (!body) return;
  const agents = employeeAgentRecords();
  const schedules = automationControl.getState().schedules || [];
  body.innerHTML = `
    <section class="employee-section">
      <div class="employee-section-head"><div><h2>${escapeHtml(am("employeeTeamTitle"))}</h2><p>${escapeHtml(am("employeeTeamDescription"))}</p></div><button class="legacy-primary-btn" type="button" data-employee-action="new">${escapeHtml(am("addEmployee"))}</button></div>
      <div class="employee-card-grid">
        ${agents.length ? agents.map((agent) => `
          <button class="employee-card ${agent.agentId === state.agent?.id ? "active" : ""}" type="button" data-employee-target="${escapeAttr(agent.targetId || "")}" ${agent.targetId ? "" : "disabled"}>
            <span class="employee-avatar">${escapeHtml(String(agent.agentTitle || "AI").slice(0, 2).toUpperCase())}</span>
            <span class="employee-card-main"><strong>${escapeHtml(agent.agentTitle || agent.agentId)}</strong><small>${escapeHtml(agent.projectName || am("unlinkedProject"))} · ${escapeHtml(agent.worklineTitle || agent.agentStatus || "idle")}</small><em>${escapeHtml(agent.model || am("noModelSelected"))}</em></span>
            <span class="employee-status ${escapeAttr(agent.agentStatus || "idle")}">${escapeHtml(agent.agentStatus || "idle")}</span>
          </button>
        `).join("") : `<div class="legacy-empty-panel">${escapeHtml(am("noEmployees"))}</div>`}
      </div>
    </section>
    <section class="employee-section schedule-section">
      <div class="employee-section-head"><div><h2>${escapeHtml(am("scheduledTasksTitle"))}</h2><p>${escapeHtml(am("scheduledTasksDescription"))}</p></div><div class="employee-actions"><button class="legacy-primary-btn" type="button" data-employee-action="schedule">${escapeHtml(am("addSchedule"))}</button><button class="legacy-secondary-btn" type="button" data-employee-action="history">${escapeHtml(am("executionHistory"))}</button></div></div>
      <div class="employee-schedule-layout">
        <div class="employee-schedule-list">
          ${schedules.length ? schedules.map((schedule) => `<button type="button" class="employee-schedule-row" data-employee-action="schedule"><strong>${escapeHtml(schedule.name || schedule.id)}</strong><small>${escapeHtml(schedule.expression || am("cronUnconfigured"))} · ${escapeHtml(schedule.status || "ready")}</small></button>`).join("") : `<div class="legacy-empty-panel compact">${escapeHtml(am("noScheduledTasks"))}</div>`}
        </div>
        <div class="employee-schedule-detail">${schedules.length ? `<strong>${escapeHtml(schedules[0].name || schedules[0].id)}</strong><p>${escapeHtml(schedules[0].prompt || am("taskContentMissing"))}</p><dl><div><dt>Agent</dt><dd>${escapeHtml(schedules[0].agentId || "—")}</dd></div><div><dt>${escapeHtml(am("nextRun"))}</dt><dd>${escapeHtml(formatTimestamp(schedules[0].nextRunAt))}</dd></div></dl>` : escapeHtml(am("editOrAddTask"))}</div>
      </div>
    </section>
  `;
  body.querySelectorAll("[data-employee-target]").forEach((node) => {
    node.addEventListener("click", () => {
      const target = node.dataset.employeeTarget;
      if (!target) return;
      closeEmployeeOverview();
      selectNavigationConversation(target).catch(showError);
    });
  });
  body.querySelectorAll("[data-employee-action]").forEach((node) => {
    node.addEventListener("click", () => {
      const action = node.dataset.employeeAction;
      closeEmployeeOverview();
      openSettingsModal(action === "new" ? "agents" : "im-gateway");
    });
  });
}

async function openEmployeeOverview() {
  closeSettingsModal();
  setGlobalRailActive("agents");
  $("employeeOverviewModal")?.classList.remove("hidden");
  renderEmployeeOverview();
  await automationControl.load();
  renderEmployeeOverview();
}

function closeEmployeeOverview() {
  $("employeeOverviewModal")?.classList.add("hidden");
  if (!$("settingsModal") || $("settingsModal").classList.contains("hidden")) setGlobalRailActive("conversation");
}

function activateGlobalRailTarget(target) {
  const key = String(target || "conversation");
  closeSidebarSettingsMenu();
  closeMobileSidebar();
  if (key === "conversation") {
    closeSettingsModal();
    closeEmployeeOverview();
    return;
  }
  if (key === "agents") {
    openEmployeeOverview().catch(showError);
    return;
  }
  if (globalRailSettingsTargets.has(key)) openSettingsModal(key === "profile" ? "providers" : key);
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

function settingsItemsForCategory(categoryKey) {
  const category = settingsCategoryByKey(categoryKey);
  return category.items.map((key) => settingsItems.find((item) => item.key === key)).filter(Boolean);
}

function renderSettingsCategoryNav(activeCategory = "api") {
  const nav = $("settingsCategoryNav");
  if (!nav) return;
  nav.innerHTML = legacySettingsCategories.map((category) => `
    <button class="legacy-settings-category ${category.key === activeCategory ? "active" : ""}" type="button" role="tab" aria-selected="${category.key === activeCategory ? "true" : "false"}" data-settings-category="${escapeAttr(category.key)}">${escapeHtml(category.label)}</button>
  `).join("");
  nav.querySelectorAll("[data-settings-category]").forEach((node) => {
    node.addEventListener("click", () => selectSettingsCategory(node.dataset.settingsCategory));
  });
}

function selectSettingsCategory(categoryKey) {
  const category = settingsCategoryByKey(categoryKey);
  state.activeSettingsCategory = category.key;
  state.settingsSearchQuery = "";
  syncSettingsSearchInput();
  const current = state.activeSettingsPanel || "";
  const nextKey = category.items.includes(current) ? current : firstSettingsItemForCategory(category.key);
  renderSettingsNav(nextKey);
  selectSettingsPanel(nextKey);
}

function renderSettingsNav(activeKey = "providers") {
  const nav = $("settingsNav");
  if (!nav) return;
  syncSettingsSearchInput();
  const query = normalizedSettingsSearchQuery();
  const categoryKey = query ? settingsCategoryForItem(activeKey, state.activeSettingsCategory || "api") : settingsCategoryForItem(activeKey, state.activeSettingsCategory || "api");
  state.activeSettingsCategory = categoryKey;
  renderSettingsCategoryNav(categoryKey);
  const items = query
    ? filteredSettingsSections().flatMap((section) => section.items)
    : settingsItemsForCategory(categoryKey);
  nav.closest(".legacy-settings-subbar")?.classList.remove("hidden");
  if (!items.length) {
    nav.innerHTML = `<div class="settings-nav-empty"><strong>${escapeHtml(am("noMatchingSettings"))}</strong><span>${escapeHtml(am("matchingSettingsHint"))}</span></div>`;
    return;
  }
  nav.innerHTML = items.map((item) => `
    <button class="settings-nav-item ${item.key === activeKey ? "active" : ""}" type="button" role="tab" aria-selected="${item.key === activeKey ? "true" : "false"}" data-settings-key="${escapeAttr(item.key)}" title="${escapeAttr(item.subtitle)}">
      <span class="settings-nav-label"><strong>${escapeHtml(item.label)}</strong></span>
    </button>
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
  const categoryKey = settingsCategoryForItem(item.key, state.activeSettingsCategory || "api");
  state.activeSettingsCategory = categoryKey;
  state.activeSettingsPanel = item.key;
  renderSettingsCategoryNav(categoryKey);
  const nav = $("settingsNav");
  if (!normalizedSettingsSearchQuery() && !nav?.querySelector(`[data-settings-key="${item.key}"]`)) renderSettingsNav(item.key);
  const isAboutPanel = item.key === "about";
  $("settingsContentTitle")?.closest(".settings-content-head")?.classList.toggle("hidden", isAboutPanel);
  $("settingsContentBody")?.closest(".settings-content")?.classList.toggle("about-panel-active", isAboutPanel);
  $("settingsContentTitle").textContent = item.label;
  $("settingsContentSubtitle").textContent = item.subtitle;
  $("settingsContentBody").innerHTML = panel ? panel.render(item) : renderGenericSettingsContent(item);
  nav?.querySelectorAll(".settings-nav-item").forEach((node) => {
    const active = node.dataset.settingsKey === item.key;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
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
    showToast(am("copiedToClipboard"), "success");
    notifyTerminal(`[info] ${am("copiedToClipboard")}\n`);
    return;
  }
  showToast(am("copyFailed"), "warn");
  notifyTerminal(`[warn] ${am("copyFailed")}\n`);
}

function settingsPanelDetails(key) {
  const base = {
    profile: [
      { title: am("currentStatus"), text: am("profileStatusDescription") },
      { title: am("quickActions"), text: am("profileQuickActionsDescription") },
    ],
    models: [
      { title: am("defaultModel"), text: state.settings?.agent?.defaultModel || am("defaultModelNotLoaded") },
      { title: am("configuredProviders"), text: am("providerProfiles", { count: state.settings?.providers?.length || 0 }) },
    ],
    agents: [
      { title: am("defaultPermission"), text: state.settings?.agent?.defaultPermissionMode || "acceptEdits" },
      { title: am("executionPolicy"), text: am("executionPolicyDescription") },
    ],
    providers: [
      { title: "Codex OAuth", text: codexProviderSummary() },
      { title: "Secret", text: am("secretDescription") },
    ],
    "agent-admin": [
      { title: am("backendCount"), text: am("agentServerBackends", { count: state.backends.length }) },
      { title: am("currentBackend"), text: activeBackend()?.name || am("backendNotConfigured") },
    ],
    "servers-system": [
      { title: am("serverPort"), text: `${state.settings?.server?.host || "localhost"}:${state.settings?.server?.port || "7788"}` },
      { title: am("version"), text: state.settings?.version || "0.1.0-dev" },
    ],
    about: [
      { title: "Autoto", text: "Local-first Go AI coding Autoto server MVP." },
      { title: "License", text: am("licenseDescription") },
    ],
  };
  return base[key] || [
    { title: am("reservedPage"), text: am("reservedPageDescription") },
    { title: am("nextStep"), text: am("nextStepDescription") },
  ];
}

function renderEmptyWorkspaceCard({ title = t("chat.emptyTitle"), text = t("chat.emptyDescription"), action = t("chat.chooseFolderAction"), hint = t("chat.emptyHint"), icon = "☻" } = {}) {
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
    readOnly: t("chat.permission.readOnly"),
    acceptEdits: t("chat.permission.editable"),
    bypassPermissions: t("chat.permission.allowAll"),
    dontAsk: t("chat.permission.dontAsk"),
    default: t("chat.permission.automatic"),
  };
  return labels[value] || value || t("chat.permission.automatic");
}

function updatePermissionModeDisplay() {
  const select = $("permissionMode");
  const display = document.querySelector(".permission-toolbar-pill .mode-display");
  if (!select || !display) return;
  const permission = effectivePermissionForDisplay(select.value);
  const label = permissionLabel(permission);
  display.textContent = label;
  const badge = $("permissionRiskBadge");
  if (badge) {
    badge.textContent = label;
    badge.classList.toggle("danger", permission === "bypassPermissions");
  }
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
    option.textContent = disabled ? `${t("chat.permission.allowAll")} (${t("workspace.terminal.remoteDisabled")})` : t("chat.permission.allowAll");
  }
  if (disabled && select.value === "bypassPermissions") {
    select.value = "acceptEdits";
  }
  updatePermissionModeDisplay();
}

async function logoutRemoteAccess() {
  closeSidebarSettingsMenu();
  if (!remoteSecurityHardeningActive()) {
    showToast(t("workspace.main.localMvpNoLogout"), "info");
    return;
  }
  await api("/auth/remote-access/logout", { method: "POST" });
  showToast(t("workspace.main.remoteLoggedOut"), "success", { force: true });
  location.reload();
}

function updateSecurityModeUI() {
  const security = currentSecuritySummary();
  const active = remoteSecurityHardeningActive();
  const terminalLocked = Boolean(security?.remoteAccessRequired && security?.remoteTerminalAllowed === false);
  const badge = $("securityModeBadge");
  if (badge) {
    badge.textContent = active ? t("workspace.main.remoteHardened") : t("workspace.main.local");
    badge.title = security?.message || (active ? t("workspace.main.remoteHardened") : t("workspace.main.local"));
    badge.classList.toggle("warn", active);
    badge.classList.toggle("ok", !active);
  }
  const banner = $("remoteSecurityBanner");
  if (banner) {
    if (active) {
      const passwordText = security?.accessPasswordConfigured ? t("workspace.main.passwordEnabled") : t("workspace.main.passwordMissing");
      const terminalText = terminalLocked ? t("workspace.main.terminalLocked") : t("workspace.main.terminalOpen");
      banner.innerHTML = `<strong>${escapeHtml(t("workspace.main.remoteHardened"))}</strong><span>${escapeHtml(passwordText)} · ${escapeHtml(t("workspace.main.autoExecutionDisabled"))} · ${escapeHtml(terminalText)}</span>`;
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
    button.title = terminalLocked ? am("remoteTerminalDisabledTitle") : button.dataset.defaultTitle;
  });
  enforcePermissionSelectCap();
  updateWorkspaceMetaPills();
  renderTerminalButtonState();
  updateRuntimeStatusButton();
}

function currentWorkspaceModel() {
  return state.agent?.model || selectedModelValue() || currentModelValue() || am("noModelSelected");
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
  const securityText = remoteSecurityHardeningActive() ? t("workspace.main.remoteHardened") : t("workspace.main.local");
  el.innerHTML = `
    <span class="workspace-pill" title="${escapeAttr(cwd)}">${escapeHtml(t("workspace.main.directoryLabel", { path: shortPath(cwd) }))}</span>
    <span class="workspace-pill">${escapeHtml(t("workspace.main.permissionLabel", { permission: permissionLabel(permission) }))}</span>
    <span class="workspace-pill security-workspace-pill">${escapeHtml(t("workspace.main.modeLabel", { mode: securityText }))}</span>
    <span class="workspace-pill" title="${escapeAttr(model)}">${escapeHtml(t("workspace.main.modelLabel", { model }))}</span>
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
  const heading = $("navigationListHeading");
  if (heading) heading.textContent = t(state.navigationMode === "conversations" ? "shell.filters.conversations" : "shell.filters.projects");
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
  if (!normalizedPath) throw new Error(t("workspace.main.selectDirectory"));
  const modalOpen = elementVisible("folderModal");
  const button = options.button || (modalOpen ? $("chooseDirectoryBtn") : null);
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const existing = projects.find((project) => normalizePath(project.gitPath) === normalizePath(normalizedPath));
  const seq = ++state.projectCreateSeq;
  state.projectCreating = true;
  const busyText = existing ? t("workspace.main.opening") : t("workspace.main.creating");
  setButtonBusy(button, true, busyText);
  setDirectoryStatus(`${busyText}：${normalizedPath}`, "busy");
  showToast(`${busyText}：${shortPath(normalizedPath)}`, "info", { force: true });
  try {
    rememberDirectory(normalizedPath);
    if (existing) {
      if (modalOpen) closeDirectoryModal();
      await selectProject(existing.id);
      showToast(t("workspace.main.opened", { path: shortPath(normalizedPath) }), "success", { force: true });
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
    showToast(t("workspace.main.selectedDirectory", { path: shortPath(created.project?.gitPath || normalizedPath) }), "success", { force: true });
    appendTerminal(`Created project: ${created.project.name}\nPath: ${created.project.gitPath}\n`);
  } catch (err) {
    if (seq === state.projectCreateSeq) {
      const message = err.message || String(err);
      setDirectoryStatus(am("openingFailed", { message }), "error");
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
  clearLiveAssistantText();
  setWorkspaceExplorerAgent(null);
  syncMessageComposerBusy();
  refreshReasoningEffortControl();
  refreshFastModeControl();
  state.currentMessages = [];
  state.messageCopyTexts = [];
  state.messageHasMoreBefore = false;
  state.messageNextBefore = "";
  state.messageOlderLoading = false;
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
  $("currentMeta").textContent = am("projectLoading");
  updateWorkspaceMetaPills();
  showEmptyWorkspaceState({
    title: am("projectLoadingTitle"),
    text: am("projectLoadingDescription"),
    action: am("chooseAnotherFolder"),
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
      $("currentMeta").textContent = am("noWorklines");
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: am("noWorklines"), text: am("noWorklinesDescription"), action: am("chooseAnotherFolder"), icon: "◇" });
      return;
    }
    const worklineId = state.workline.id;
    const agents = await api(`/api/worklines/${worklineId}/agents`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id || state.workline?.id !== worklineId) return;
    state.worklineAgents = Array.isArray(agents) ? agents : [];
    state.agent = state.worklineAgents.find((agent) => agent.type === "primary") || state.worklineAgents[0] || null;
    if (!state.agent) {
      $("currentTitle").textContent = state.project.name;
      $("currentMeta").textContent = am("noAgent");
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: am("noAgents"), text: am("noAgentsDescription"), action: am("chooseAnotherFolder"), icon: "♧" });
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
  if (!parsed) throw new Error(am("invalidConversationTarget"));
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
    throw new Error(am("projectNoLongerExists"));
  }

  $("currentTitle").textContent = navigationConversation?.projectName || state.project.name;
  $("currentMeta").textContent = am("conversationOpening");
  updateWorkspaceMetaPills();
  showEmptyWorkspaceState({
    title: am("conversationOpeningTitle"),
    text: am("conversationOpeningDescription"),
    action: am("chooseAnotherFolder"),
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
      $("currentMeta").textContent = am("conversationUnavailable");
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({
        title: am("conversationUnavailable"),
        text: am("conversationUnavailableDescription"),
        action: am("chooseAnotherFolder"),
        icon: "◇",
      });
      throw new Error(am("worklineOrAgentMissing"));
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
  closeConversationDetails();
  const agentId = state.agent.id;
  setWorkspaceExplorerAgent(state.agent);
  specBoard.setAgent(state.agent);
  $("currentTitle").textContent = state.project?.name || state.agent.title;
  $("currentMeta").textContent = state.agent.title || am("agentReady");
  $("permissionMode").value = state.agent.permissionMode || "acceptEdits";
  enforcePermissionSelectCap();
  updateWorkspaceMetaPills();
  renderModelOptions();
  refreshReasoningEffortControl();
  refreshFastModeControl();
  await restoreCurrentChatDraft();
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
      <div class="setup-notice-title">${escapeHtml(t("workspace.main.modelKeyMissing"))}</div>
      <p>${escapeHtml(modelSetupMessage())}</p>
      <div class="setup-notice-actions">
        <button class="ghost-btn mini" type="button" id="openModelSettingsNoticeBtn">${escapeHtml(t("workspace.main.openModelSettings"))}</button>
        <button class="ghost-btn mini" type="button" id="openProviderSettingsNoticeBtn">${escapeHtml(t("workspace.main.openProviderSettings"))}</button>
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
  state.agentStreamStatus = "idle";
  setComposerConnectionStatus(t("workspace.main.idle"));
  setTerminalStatus("idle");
  updateRuntimeStatusButton();
}

function connectWS() {
  if (!state.agent?.id) return;
  agentStream.connect(state.agent.id).catch((error) => {
    if (state.agent?.id) notifyTerminal(`[warn] ${am("agentLiveSnapshotFailed", { message: error?.message || error })}\n`);
  });
}

function updateAgentStreamStatus(detail = {}) {
  const badge = $("wsBadge");
  const streamStatus = detail.status || "idle";
  state.agentStreamStatus = streamStatus;
  const labels = {
    idle: ["ws idle", t("workspace.main.idle"), false],
    syncing: ["ws syncing", t("workspace.main.syncing"), false],
    resyncing: ["ws resync", t("workspace.main.recovering"), false],
    connecting: ["ws connecting", t("workspace.main.connecting"), false],
    reconnecting: ["ws reconnecting", t("workspace.main.reconnecting"), false],
    connected: [detail.resume === "replayed" ? "ws replayed" : "ws connected", t("workspace.main.connected"), true],
    offline: ["ws offline", t("workspace.main.offline"), false],
  };
  const [badgeText, composerText, ok] = labels[streamStatus] || labels.offline;
  if (badge) {
    badge.textContent = badgeText;
    badge.classList.toggle("ok", ok);
  }
  setComposerConnectionStatus(composerText, ok);
  updateRuntimeStatusButton();
}

function applyAgentLiveSnapshot(snapshot) {
  const agentId = snapshot?.agent?.id || "";
  if (!agentId || state.agent?.id !== agentId) return;
  state.agent = snapshot.agent;
  clearLiveAssistantText();
  state.liveToolOutputs = Object.fromEntries(Object.entries(state.liveToolOutputs || {}).filter(([, value]) => value?.agentId && value.agentId !== agentId));
  clearRunSummary();
  replacePendingApprovals(snapshot.pendingApprovals, agentId);
  applyMessageSnapshot(snapshot.messages, agentId, {
    hasMoreBefore: snapshot.messageHasMoreBefore,
    nextBefore: snapshot.messageNextBefore,
  });
  const permissionMode = $("permissionMode");
  if (permissionMode) permissionMode.value = state.agent.permissionMode || "acceptEdits";
  enforcePermissionSelectCap();
  renderModelOptions();
  refreshReasoningEffortControl();
  refreshFastModeControl();
  updateWorkspaceMetaPills();
  syncMessageComposerBusy();
  const latestRun = snapshot.latestRun;
  if (latestRun?.id && ["completed", "error", "failed", "interrupted", "superseded"].includes(latestRun.status)) {
    loadRunSummary(latestRun.id, { agentId }).catch((error) => notifyTerminal(`[warn] ${am("runSummaryRestoreFailed", { message: error?.message || error })}\n`));
  }
}

function handleAgentStreamEvent(event) {
  const agentId = state.agent?.id || "";
  if (!agentId || (event.agentId && event.agentId !== agentId)) return;
  if (shouldLogAgentEvents()) appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
  const runId = event.data?.runId || "";
  const requestId = event.data?.requestId || "";
  if (event.type === "agent.started") {
    clearRunSummary();
    clearLiveAssistantText();
  }
  if (event.type === "model.started") {
    beginLiveAssistantGeneration({
      requestId,
      runId,
      provider: event.data?.provider,
      model: event.data?.model,
      startedAt: event.data?.startedAt,
    });
  }
  if (event.type === "agent.text") {
    appendLiveAssistantText(event.text || event.data?.text || "", { requestId, runId });
  }
  if (event.type === "model.streaming") {
    updateLiveAssistantPerformance(event.data?.pendingThroughput, { requestId, runId });
  }
  if (event.type === "model.completed") {
    const throughput = event.data?.throughput && typeof event.data.throughput === "object" ? { ...event.data.throughput } : {};
    if (throughput.ttftMs == null && event.data?.ttftMs != null) throughput.ttftMs = event.data.ttftMs;
    updateLiveAssistantPerformance(throughput, { requestId, runId, replace: true });
  }
  if (event.type === "tool.started") rememberToolStarted(event);
  if (event.type === "tool.output") appendToolOutput(event);
  if (event.type === "tool.approval_required") {
    rememberToolApproval(event);
    showToast(event.data?.risk === "danger" ? t("workspace.chat.dangerousToolBlocked") : t("workspace.chat.toolApproval"), event.data?.risk === "danger" ? "error" : "warn");
  }
  if (event.type === "tool.finished") {
    clearToolApproval(event.data?.toolUseId);
    finishToolOutput(event);
  }
  if (event.type === "agent.interrupted") clearCurrentAgentApprovals();
  const completedMessageEvents = ["message.created", "message.completed"];
  const terminalAgentEvents = ["agent.done", "agent.error", "agent.interrupted"];
  if ([...completedMessageEvents, ...terminalAgentEvents].includes(event.type)) clearLiveAssistantText();
  if ([...completedMessageEvents, ...terminalAgentEvents].includes(event.type)) scheduleMessageRefresh(80, agentId);
  if (terminalAgentEvents.includes(event.type) && runId) {
    loadRunSummary(runId, { agentId }).catch((error) => notifyTerminal(`[warn] ${am("runSummaryLoadFailed", { message: error?.message || error })}\n`));
  }
}

async function saveAgentSettings() {
  if (state.agentSaving) {
    state.agentSavePending = true;
    return;
  }
  let agentId = "";
  state.agentSaving = true;
  try {
    const model = $("modelSelect").value.trim();
    if (model) setPreferredModel(model);
    if (!state.agent) {
      renderModelOptions();
      refreshActiveSettingsPanel();
      notifyTerminal(model ? `[info] ${am("modelPreferenceSaved", { model })}\n` : `[info] ${am("noModelSelectedTerminal")}\n`);
      return;
    }
    agentId = state.agent.id;
    const id = agentId;
    const permissionMode = $("permissionMode").value;
    const reasoningEffort = selectedReasoningEffort(model);
    const applyAgentPatch = async (path, payload) => {
      const updated = await api(`/api/agents/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (state.agent?.id !== id) return false;
      state.agent = updated;
      return true;
    };
    if (model && model !== state.agent.model) {
      if (!await applyAgentPatch("model", { model })) return;
    }
    const storedReasoningEffort = String(state.agent.reasoningEffort || "").trim().toLowerCase();
    if ((storedReasoningEffort && storedReasoningEffort !== reasoningEffort) || (!storedReasoningEffort && reasoningEffort !== "auto")) {
      if (!await applyAgentPatch("reasoning-effort", { reasoningEffort })) return;
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
  node.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="${escapeAttr(am("closeNotification"))}">×</button>`;
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

bindSetupWizardActions();
bindWorkspaceExplorer();
document.addEventListener("keydown", handleGlobalEscape);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("employeeOverviewModal")?.classList.contains("hidden")) closeEmployeeOverview();
  if ($("appShell")?.classList.contains("details-open")) closeConversationDetails();
});
document.addEventListener("keydown", handleSettingsSearchShortcut);
document.addEventListener("click", handleDirectoryShortcutClick);
document.addEventListener("click", handleSidebarSettingsMenuDocumentClick);
document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
  node.addEventListener("click", () => activateGlobalRailTarget(node.dataset.globalRailTarget));
});
$("globalThemeToggleBtn")?.addEventListener("click", () => {
  const nextTheme = currentAppearancePreferences().theme === "dark" ? "light" : "dark";
  setAppearancePreference("theme", nextTheme);
  updateGlobalThemeToggle();
});
$("refreshBtn").addEventListener("click", () => init().catch(showError));
$("sidebarAccountBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSidebarSettingsMenu();
});
$("settingsBtn").addEventListener("click", () => { closeSidebarSettingsMenu(); openSettingsModal("providers"); });
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
$("settingsIdentityBtn")?.addEventListener("click", () => selectSettingsPanel("profile"));
$("closeSettingsModalBtn").addEventListener("click", closeSettingsModal);
$("settingsModal").addEventListener("click", (event) => { if (event.target.id === "settingsModal") closeSettingsModal(); });
$("closeEmployeeOverviewBtn")?.addEventListener("click", closeEmployeeOverview);
$("employeeOverviewModal")?.addEventListener("click", (event) => { if (event.target.id === "employeeOverviewModal") closeEmployeeOverview(); });
$("closeConversationDetailsBtn")?.addEventListener("click", closeConversationDetails);
$("settingsWizardBtn").addEventListener("click", () => {
  closeSettingsModal();
  openSetupWizard().catch(showError);
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
  openSettingsModal("providers");
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
$("runtimeStatusBtn")?.addEventListener("click", () => {
  if ($("appShell")?.classList.contains("details-open")) closeConversationDetails();
  else openConversationDetails();
});
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
    setDirectoryStatus(am("finderSelectionOpening", { path: picked.path }), "busy");
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
$("toggleHiddenFoldersBtn").addEventListener("click", () => notifyTerminal(`[info] ${am("hiddenFoldersNotShown")}\n`));
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
$("messageText").addEventListener("paste", scheduleMessageInputResize);
$("messageText").addEventListener("keydown", handleMessageKeydown);
$("messageText").addEventListener("paste", handleMessagePaste);
$("messageText").addEventListener("compositionstart", () => { state.mentionComposing = true; });
$("messageText").addEventListener("compositionend", () => { state.mentionComposing = false; handleMessageInput(); });
$("messageText").addEventListener("focus", updateSlashCommandPalette);
$("messageText").addEventListener("blur", () => window.setTimeout(hideSlashCommandPalette, 120));
$("terminalOutput").addEventListener("keydown", handleTerminalKeydown);
$("terminalOutput").addEventListener("click", () => $("terminalOutput").focus());
$("terminalOutput").addEventListener("paste", (event) => {
  event.preventDefault();
  sendTerminalInput(event.clipboardData?.getData("text") || "");
});
$("reconnectTerminalBtn").addEventListener("click", connectTerminal);
window.addEventListener("resize", () => {
  resizeTerminal();
  autoResizeMessageInput();
});
window.addEventListener("autoto:auth-changed", () => {
  state.serverDrafts = {};
  if (state.agent?.id) restoreCurrentChatDraft().catch(showError);
});
window.addEventListener("beforeunload", saveCurrentChatDraft);
$("refreshModelsBtn")?.addEventListener("click", () => refreshModelCatalog().catch(showError));
$("openProviderLoginBtn")?.addEventListener("click", () => toggleFastMode().catch(showError));
$("modelSelect").addEventListener("change", () => {
  updateModelConfiguredState();
  refreshReasoningEffortControl({ modelValue: $("modelSelect").value });
  refreshFastModeControl({ modelValue: $("modelSelect").value });
  saveAgentSettings().catch(showError);
});
$("reasoningEffort")?.addEventListener("change", (event) => {
  refreshReasoningEffortControl({ requestedValue: event.target.value });
  saveReasoningEffort(event.target.value).catch(showError);
});
$("permissionMode").addEventListener("change", () => {
  updatePermissionModeDisplay();
  saveAgentSettings().catch(showError);
});
function toggleTerminalDock(collapsed) {
  if (collapsed !== true) {
    closeConversationDetails();
    if (state.workspaceOpen && state.workspaceTab === "preview") closeWorkspace();
  }
  toggleTerminal(collapsed);
}
$("toggleTerminalBtn").addEventListener("click", () => toggleTerminalDock());
$("composerTerminalBtn")?.addEventListener("click", () => toggleTerminalDock());
$("collapseTerminalBtn").addEventListener("click", () => toggleTerminalDock(true));
$("expandTerminalBtn").addEventListener("click", () => toggleTerminalDock(false));
$("terminalCommandForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("terminalCommandInput");
  const command = String(input?.value || "").trim();
  if (!command) return;
  if (!sendTerminalInput(`${command}\r`)) {
    showToast(state.agent ? am("terminalNotConnected") : am("selectAgentFirst"), "warn", { force: true });
    return;
  }
  input.value = "";
  $("terminalOutput")?.focus();
});
renderTerminalButtonState();
updateRuntimeStatusButton();

async function init() {
  if (state.initializing) return;
  const seq = ++state.initSeq;
  state.initializing = true;
  const refreshButton = $("refreshBtn");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.classList.add("loading");
    refreshButton.setAttribute("aria-busy", "true");
    refreshButton.title = t("common.refreshing");
  }
  try {
    state.profile = loadProfilePreferences();
    applyProfilePreferences();
    state.searchPrefs = loadSearchPreferences();
    state.skillsPrefs = loadSkillsPreferences();
    state.notifications = loadNotificationPreferences();
    state.appearance = loadAppearancePreferences();
    state.terminalPrefs = loadTerminalPreferences();
    state.chatDrafts = loadChatDrafts();
    state.promptHistory = loadPromptHistory();
    state.recentConversations = loadRecentConversations();
    applyAppearancePreferences({ applyTerminalDefault: true });
    updateGlobalThemeToggle();
    if (!state.agent) {
      $("currentTitle").textContent = t("chat.noAgent");
      $("currentMeta").textContent = t("chat.startHint");
      $("composerStatusText").textContent = t("chat.idle");
      const terminalOutput = $("terminalOutput");
      if (terminalOutput && terminalOutput.textContent.startsWith("Terminal ready.")) terminalOutput.textContent = t("terminal.ready");
    }
    updatePermissionModeDisplay();
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
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.classList.remove("loading");
        refreshButton.removeAttribute("aria-busy");
        refreshButton.title = t("shell.refreshSessions");
      }
    }
  }
}

function openRequestedInitialView() {
  const params = new URLSearchParams(globalThis.location?.search || "");
  const view = params.get("view") || "";
  if (view === "settings") openSettingsModal(params.get("panel") || "providers");
  if (view === "employees") openEmployeeOverview().catch(showError);
  if (view === "details") openConversationDetails();
  if (view === "browser") openWorkspace("preview");
  if (view === "terminal") toggleTerminalDock(false);
}

init().then(openRequestedInitialView).catch(showError);
