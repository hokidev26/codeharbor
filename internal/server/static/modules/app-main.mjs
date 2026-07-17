import { createAgentStreamController } from "./agent-stream.mjs";
import { createAutomationControlController } from "./automation-control.mjs";
import { createBackgroundTasksController } from "./background-tasks.mjs";
import { createExecutionNotifications } from "./execution-notifications.mjs";
import { createBackendRegistryController } from "./backend-registry.mjs";
import { createChatComposerController, normalizeChatDrafts, normalizePromptHistory } from "./chat-composer.mjs?v=plan-mode-1";
import { createChatRenderingController } from "./chat-rendering.mjs?v=message-thread-1-plan-mode-2-user-message-left-1";
import {
  addRecentConversation,
  buildNavigationView,
  createNavigationRefreshController,
  normalizeNavigationPayload,
  normalizeRecentConversations,
  parseNavigationTargetId,
  renderNavigationHTML,
  renderRecentConversationsHTML,
  resolveInitialNavigationTarget,
} from "./conversation-navigation.mjs?v=mode-boundaries-2-project-flat-1";
import {
  basename,
  canonicalLocalPath,
  createDirectoryBrowserController,
  normalizePath,
  normalizeRecentDirectories,
  shortPath,
} from "./directory-browser.mjs?v=folder-picker-remote-2";
import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatNumber, formatTimestamp } from "./formatters.mjs";
import { t } from "./i18n.mjs?v=settings-flat-1-codex-browser-login-1-shared-api-1-apple-theme-1-settings-help-1";
import { appMainT as am } from "./messages-app-main-extra.mjs?v=workbench-title-edit-1";
import { shellExtraT as sx } from "./messages-shell-extra.mjs";
import { createGitWorkflowController } from "./git-workflow.mjs";
import { createLocalPreferencesSettingsController } from "./local-preferences-settings.mjs?v=settings-flat-1-apple-theme-1";
import { createMCPRegistryUIController } from "./mcp-registry-ui.mjs";
import { createPluginRegistryUIController } from "./plugin-registry-ui.mjs";
import { createMemorySettingsController } from "./memory-settings.mjs";
import { createModelProviderSettingsController } from "./model-provider-settings.mjs?v=native-codex-3-provider-console-3-account-wide-1-model-compact-1-codex-export-1-settings-flat-1-aggregates-1-codex-import-open-1-provider-create-page-1-codex-browser-login-1";
import { createPageLifecycleController } from "./page-lifecycle.mjs";
import { createProjectKanbanController } from "./project-kanban.mjs?v=workbench-3-mode-boundaries-1";
import { readLocalPreference, recentConversationsKey } from "./preferences-data.mjs?v=apple-theme-1";
import { applyRemoteAccessFailClosed, fullAccessAllowed, remoteAccessContext, terminalAccessAllowed } from "./remote-access-capabilities.mjs";
import { createRemoteAccessSettingsController } from "./remote-access-settings.mjs?v=remote-control-full-1";
import { createSharedAPISettingsController } from "./shared-api-settings.mjs?v=shared-api-1";
import { applyServerSkillsLoadResult, createSkillsPhaseBController, hydrateServerSkillSummaries, isOptimisticSkillConflict, loadServerSkillsWithFallback, normalizeSkillContext } from "./skills-bootstrap.mjs";
import { api, onAPIAuthorizationFailure, webSocketURL } from "./runtime.mjs";
import { firstSettingsItemForCategory, groupSettingsItemsByLegacyCategory, legacySettingsCategories, settingsCategoryByKey, settingsCategoryForItem } from "./settings-categories.mjs?v=users-panel-removed-1-shared-api-1";
import { settingsItemByKey, settingsItems } from "./settings-data.mjs?v=users-panel-removed-1-shared-api-1";
import { createSettingsHelpController } from "./settings-help.mjs?v=settings-help-1";
import { createSettingsPanelRegistry } from "./settings-panel-registry.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs?v=apple-theme-1";
import { createSetupWizardController } from "./setup-wizard.mjs";
import { createSpecBoardController } from "./spec-board.mjs";
import { createSystemSettingsController } from "./system-settings.mjs?v=users-panel-removed-1-about-brand-license-1";
import { createSkillsWorkbenchController } from "./skills-workbench.mjs?v=users-panel-removed-1";
import { createTerminalController } from "./terminal.mjs?v=terminal-actions-compact-1";
import { createUIShellController, elementVisible, isComposingInput } from "./ui-shell.mjs?v=permission-panel-1-mobile-toolbar-right-3-icon-rail-1";
import { createUsageHistoryController } from "./usage-history.mjs";
import { createWorkspaceSettingsController } from "./workspace-settings.mjs?v=plan-mode-1";
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
  providerAuthLoading: false,
  providerAuthMutationWarning: "",
  providerAuthSeq: 0,
  codexAccountBusy: {},
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
  remoteAccess: null,
  remoteAccessError: "",
  remoteAccessLoading: false,
  gatewayKeys: [],
  gatewayModels: [],
  gatewayUsage: { items: [], summary: {} },
  gatewayDataLoaded: false,
  gatewayDataLoading: false,
  gatewayAPIError: "",
  runtimeError: "",
  runtimeSeq: 0,
  authUser: undefined,
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
  primaryModePreference: "conversation",
  activeWorkbench: "conversation",
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
  titleEditing: false,
  titleSaving: false,
  titleDraft: "",
  titleEditSurface: "conversation",
  reasoningEffortSaving: false,
  reasoningEffortPending: undefined,
  messageModes: {},
  messageSendingByAgent: {},
  messageRefreshTimersByAgent: {},
  activePlan: null,
  pendingPlanApproval: null,
  planActionBusy: {},
  chatHydrating: false,
  currentMessages: [],
  messageCopyTexts: [],
  messageHasMoreBefore: false,
  messageNextBefore: "",
  messageOlderLoading: false,
  activeRunSummary: null,
  activeRunSummaryRunId: "",
  activeRunToolCalls: [],
  activeRunToolCallsRunId: "",
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
  agentModelSettings: null,
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
    backgroundTasks?.closeTray?.("preview-open");
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
  enforceAccessPolicy: enforceTerminalAccessPolicy,
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

onAPIAuthorizationFailure(({ status, path, error }) => {
  if (!remoteAccessContext(state)) return;
  remoteAccessSettings.invalidatePendingLoads({ status });
  applyRemoteAccessFailClosed(state, { status });
  state.remoteAccessError = error?.message || String(error || "remote authorization failed");
  disconnectAgentTransports();
  updateSecurityModeUI();
  if (state.activeSettingsPanel === "remote-access") refreshActiveSettingsPanel();
  if (state.remoteAccessAuthRefreshPending) return;
  // The controller handling its own failed authority request will commit the
  // fail-closed state in catch/finally. Other authorization failures start a
  // fresh authority read even if an older settings request is still in flight.
  if (state.remoteAccessLoading && path === "/api/security/remote-access") return;
  state.remoteAccessAuthRefreshPending = true;
  Promise.resolve()
    .then(() => remoteAccessSettings.load())
    .catch(() => {})
    .finally(() => {
      state.remoteAccessAuthRefreshPending = false;
    });
});

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
  applyPlanEvent,
  beginLiveAssistantGeneration,
  clearCurrentAgentApprovals,
  clearPlanState,
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
  replacePlanState,
  scheduleMessageRefresh,
  updateConversationCopyButton,
  updateLiveAssistantPerformance,
} = chatRendering;

function executionNoticeMessage(notice) {
  const raw = notice?.raw || {};
  const data = raw.data && typeof raw.data === "object" ? raw.data : {};
  if (notice?.family === "task_terminal") return t("backgroundTasks.notifications.taskCompleted", { task: raw.title || data.title || notice.taskId || t("backgroundTasks.task") });
  if (notice?.family === "continuation_blocked") return t("backgroundTasks.continuation.blocked", { reason: notice.reason || data.reason || "—" });
  if (notice?.family === "budget_exhausted") return t("backgroundTasks.continuation.budgetExhausted", { reason: notice.reason || data.reason || notice.budget || "—" });
  if (notice?.family === "approval_required") return t("backgroundTasks.notifications.approvalRequired");
  if (notice?.family === "completed") return t("backgroundTasks.notifications.completed");
  if (notice?.family === "error") return t("backgroundTasks.notifications.error");
  if (notice?.family === "interrupted") return t("backgroundTasks.notifications.interrupted");
  return t("backgroundTasks.notifications.truncated");
}

const executionNotifications = createExecutionNotifications({
  notifier: (notice) => {
    const taskStatus = String(notice?.raw?.status || notice?.raw?.data?.status || "").toLowerCase();
    const taskFailed = notice.family === "task_terminal" && ["failed", "error", "interrupted", "cancelled", "canceled"].includes(taskStatus);
    const variant = taskFailed || ["error", "budget_exhausted"].includes(notice.family) ? "error" : ["approval_required", "continuation_blocked", "interrupted", "truncated"].includes(notice.family) ? "warn" : "success";
    showToast(executionNoticeMessage(notice), variant);
  },
  onError: (error) => notifyTerminal(`[warn] ${error?.message || error}\n`),
});

const backgroundTasks = createBackgroundTasksController({
  request: api,
  onChange: () => {
    if ($("appShell")?.classList.contains("details-open")) renderConversationDetails();
  },
  onError: (error) => notifyTerminal(`[warn] ${error?.message || error}\n`),
  onOpenChange: (open) => {
    const shell = $("appShell");
    shell?.classList.toggle("background-tasks-open", open);
    if (!open) return;
    closeConversationDetails();
    closeWorkspace();
    toggleTerminal(true);
  },
  onNavigateAgent: (childAgentId) => {
    const conversation = state.navigationConversations.find((item) => item.agentId === childAgentId);
    if (conversation?.targetId) selectNavigationConversation(conversation.targetId).catch(showError);
    else showToast(t("backgroundTasks.openChildAgent"), "warn");
  },
  onNavigateRun: async (childAgentId, childRunId) => {
    if (childAgentId && childAgentId !== state.agent?.id) {
      const conversation = state.navigationConversations.find((item) => item.agentId === childAgentId);
      if (conversation?.targetId) await selectNavigationConversation(conversation.targetId);
    }
    if (childRunId && (!childAgentId || childAgentId === state.agent?.id)) await loadRunSummary(childRunId, { agentId: state.agent?.id });
  },
});
backgroundTasks.bind();

const agentStream = createAgentStreamController({
  api,
  webSocketURL,
  onEvent: handleAgentStreamEvent,
  onSnapshot: applyAgentLiveSnapshot,
  onStatus: updateAgentStreamStatus,
  onError: (error) => notifyTerminal(`[warn] ${am("agentStreamRestoreFailed", { message: error?.message || error })}\n`),
  getExecutionCheckpoint: (agentId) => executionNotifications.checkpoint(agentId),
});

const navigationRefresh = createNavigationRefreshController({
  refresh: () => loadProjects(),
  shouldRefresh: () => globalThis.navigator?.onLine !== false && globalThis.document?.visibilityState !== "hidden",
});

const pageLifecycle = createPageLifecycleController({
  onResume: (detail) => {
    navigationRefresh.request(detail?.reason || "lifecycle_resume");
    return agentStream.resume(detail);
  },
  onOffline: (detail) => agentStream.pause(detail?.reason || "browser_offline"),
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
  beginSettingsDialogFocus,
  bindComposerSelectMenus,
  bindSidebarResizer,
  closeMobileSidebar,
  closeProjectSearch,
  closeSidebarSettingsMenu,
  focusMobileSearch,
  handleDirectoryShortcutClick,
  handleGlobalEscape,
  handleSettingsDialogKeydown,
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

const projectKanban = createProjectKanbanController({
  specBoard,
  host: "#projectKanbanBody",
  translate: projectKanbanTranslation,
  showError,
  showToast,
});
projectKanban.bind();

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
  refreshMessageModeControl,
  refreshReasoningEffortControl,
  restoreCurrentChatDraft,
  saveCurrentChatDraft,
  saveReasoningEffort,
  scheduleMessageInputResize,
  selectedReasoningEffort,
  setMessageMode,
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
  applyPrimaryMode: applyPrimaryWorkbench,
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
  updateGlobalThemeToggle,
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
  currentPrimaryModePreference,
  currentProfilePreferences,
  currentRegionalPreferences,
  currentSearchPreferences,
  loadAppearancePreferences,
  loadNotificationPreferences,
  loadPrimaryModePreference,
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
  setPrimaryModePreference,
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
  renderAboutSettingsContent,
  renderRuntimeSettingsContent,
  renderServerSystemSettingsContent,
  renderStorageSettingsContent,
  renderUsageMetricCard,
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

function terminalSocketUsable(socket = state.terminalWS) {
  if (!socket) return false;
  const readyState = Number(socket.readyState);
  return !Number.isFinite(readyState) || readyState === 0 || readyState === 1;
}

function restoreAuthorizedAgentTransports() {
  if (state.remoteAccessFailClosed || !state.agent?.id || state.agentStreamStatus !== "idle") return false;
  backgroundTasks.setAgent(state.agent.id);
  connectWS();
  if (terminalAccessAllowed(state) && !terminalSocketUsable()) connectTerminal();
  return true;
}

const remoteAccessSettings = createRemoteAccessSettingsController({
  state,
  request: api,
  copyText: copyToClipboard,
  onChange: () => {
    updateSecurityModeUI();
    restoreAuthorizedAgentTransports();
    if (state.activeSettingsPanel === "remote-access") refreshActiveSettingsPanel();
  },
  showError,
  showToast,
});

const sharedAPISettings = createSharedAPISettingsController({
  state,
  request: api,
  reloadSettings: loadSettings,
  copyText: copyToClipboard,
  onChange: () => {
    if (state.activeSettingsPanel === "shared-api") refreshActiveSettingsPanel();
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
  ["skills", { render: () => renderSkillSettingsContent(state.activeSkillTab || "commands"), bind: () => bindSkillTabs(state.activeSkillTab || "commands") }],
  ["models", { render: renderModelSettingsContent, bind: bindModelSettingsActions }],
  ["agents", { render: renderAgentSettingsContent, bind: bindAgentSettingsActions }],
  ["providers", { render: renderProviderSettingsContent, bind: bindProviderSettingsActions }],
  ["shared-api", { render: sharedAPISettings.render, bind: sharedAPISettings.bind }],
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
  ["remote-access", { render: remoteAccessSettings.render, bind: remoteAccessSettings.bind }],
  ["terminals", { render: renderTerminalSettingsContent, bind: bindTerminalSettingsActions }],
  ["about", { render: renderAboutSettingsContent, bind: bindAboutSettingsActions, layout: "about" }],
].forEach(([key, panel]) => settingsPanelRegistry.register(key, panel));

const settingsHelp = createSettingsHelpController({
  getRoot: () => $("settingsContentBody"),
  trigger: $("settingsHelpBtn"),
  panel: $("settingsHelpPanel"),
  title: $("settingsHelpTitle"),
  body: $("settingsHelpBody"),
  closeButton: $("closeSettingsHelpBtn"),
  backdrop: $("settingsHelpBackdrop"),
  translate: t,
});
settingsHelp.bind();

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
    ${backgroundTasks.renderContinuationStatusHTML()}
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
  backgroundTasks.closeTray("details-open");
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
  if (!state.remoteAccess && !state.remoteAccessError) tasks.push(remoteAccessSettings.load());
  if (!state.storageSummary && !state.storageError) tasks.push(loadStorageSummary());
  if (!state.licenseSummary && !state.licenseError) tasks.push(loadLicenseSummary());
  if (!state.providerAuthFiles && !state.providerAuthError) tasks.push(loadProviderAuthFiles({ silent: true }));
  if (!state.serverNotificationSettings && !state.serverNotificationError) tasks.push(loadServerNotificationSettings());
  if (!state.workflowPreferences && !state.workflowError) tasks.push(loadWorkflowPreferences());
  if (!state.toolPermissionRules.length && !state.toolPermissionRulesError) tasks.push(loadToolPermissionRules());
  if (state.serverSkillsStatus === "idle") tasks.push(loadServerSkills());
  Promise.allSettled(tasks).catch(() => {});
}

function projectKanbanTranslation(key, params = {}, fallback = "") {
  const translationKey = String(key || "").startsWith("projectKanban.") ? String(key) : `projectKanban.${key}`;
  const translated = t(translationKey, params);
  return translated === translationKey ? fallback : translated;
}

function normalizedPrimaryWorkbench(value) {
  return value === "workbench" ? "workbench" : "conversation";
}

function primaryWorkbenchRailTarget(value = state.activeWorkbench) {
  return normalizedPrimaryWorkbench(value) === "workbench" ? "tasks" : "conversation";
}

function setTranslatedText(element, key) {
  if (!element) return;
  element.dataset.i18n = key;
  element.textContent = t(key);
}

function setTranslatedAttribute(element, attribute, key) {
  if (!element) return;
  element.setAttribute(`data-i18n-${attribute}`, key);
  element.setAttribute(attribute, t(key));
}

function renderPrimaryModeSidebar() {
  const taskMode = state.activeWorkbench === "workbench";
  const sidebar = $("sessionSidebar");
  const title = $("sessionSidebarTitle");
  const actions = $("sessionSidebarActions");
  const resizeHandle = $("sidebarResizeHandle");
  const searchToggle = $("projectSearchToggleBtn");
  const mobileSearch = $("mobileDrawerSearchBtn");
  const searchInput = $("projectSearch");
  const refreshButton = $("refreshBtn");
  const newProjectButton = $("newProjectBtn");
  const newTaskButton = $("newTaskBtn");
  const sidebarLabelKey = taskMode ? "workbench.sidebarLabel" : "shell.sessionSidebar";
  const sidebarTitleKey = taskMode ? "workbench.sidebarTitle" : "shell.sessionTitle";
  const sidebarActionsKey = taskMode ? "workbench.sidebarActions" : "shell.sessionActions";
  const searchLabelKey = taskMode ? "workbench.searchContextLabel" : "shell.searchProjectsLabel";
  const searchPlaceholderKey = taskMode ? "workbench.searchContext" : "shell.searchProjects";
  const refreshKey = taskMode ? "workbench.refreshTasks" : "shell.refreshSessions";

  setTranslatedAttribute(sidebar, "aria-label", sidebarLabelKey);
  setTranslatedText(title, sidebarTitleKey);
  setTranslatedAttribute(actions, "aria-label", sidebarActionsKey);
  setTranslatedAttribute(resizeHandle, "aria-label", taskMode ? "workbench.resizeSidebar" : "shell.resizeSidebar");
  [searchToggle, mobileSearch].forEach((button) => {
    setTranslatedAttribute(button, "title", searchLabelKey);
    setTranslatedAttribute(button, "aria-label", searchLabelKey);
  });
  setTranslatedAttribute(searchInput, "placeholder", searchPlaceholderKey);
  setTranslatedAttribute(searchInput, "aria-label", searchLabelKey);
  if (refreshButton?.getAttribute("aria-busy") !== "true") {
    setTranslatedAttribute(refreshButton, "title", refreshKey);
    setTranslatedAttribute(refreshButton, "aria-label", refreshKey);
  }

  newProjectButton?.classList.toggle("hidden", taskMode);
  newTaskButton?.classList.toggle("hidden", !taskMode);
  if (newTaskButton) {
    const enabled = Boolean(state.agent?.id);
    const taskActionKey = enabled ? "workbench.createTask" : "workbench.selectAgentToCreate";
    newTaskButton.disabled = !enabled;
    setTranslatedAttribute(newTaskButton, "title", taskActionKey);
    setTranslatedAttribute(newTaskButton, "aria-label", taskActionKey);
  }
}

function renderWorkbenchShell() {
  const agent = state.agent;
  const project = state.project;
  const meta = $("workbenchMeta");
  const status = $("workbenchAgentStatus");
  const agentTitle = String(agent?.title || agent?.id || "").trim();
  const projectTitle = String(project?.name || "").trim();
  renderWorkbenchHeaderIdentity();
  if (meta) {
    meta.textContent = agent
      ? `${t("workbench.currentAgent", { agent: agentTitle })} · ${t("workbench.currentProject", { project: projectTitle || "—" })}`
      : t("workbench.selectAgent");
  }
  if (status) {
    status.textContent = agent?.status || "idle";
    status.classList.toggle("ok", Boolean(agent && agent.status === "idle"));
    status.classList.toggle("warn", Boolean(agent && ["running", "interrupted"].includes(agent.status)));
  }
  const enabled = Boolean(agent?.id);
  ["workbenchFilesBtn", "workbenchGitBtn", "workbenchRunBtn", "workbenchPreviewBtn"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = !enabled;
  });
  const terminalButton = $("workbenchTerminalBtn");
  const security = currentSecuritySummary();
  const terminalLocked = !terminalAccessAllowed(state);
  if (terminalButton) terminalButton.disabled = !enabled || terminalLocked;
  const gitCount = Array.isArray(state.gitStatus?.files) ? state.gitStatus.files.length : 0;
  const gitBadge = document.querySelector("[data-workbench-git-badge]");
  if (gitBadge) {
    gitBadge.textContent = gitCount > 99 ? "99+" : String(gitCount);
    gitBadge.classList.toggle("hidden", !enabled || gitCount === 0);
  }
  const mobileButton = $("mobileWorkbenchBtn");
  if (mobileButton) {
    const active = state.activeWorkbench === "workbench";
    mobileButton.setAttribute("aria-pressed", active ? "true" : "false");
    mobileButton.classList.toggle("active", active);
  }
  renderPrimaryModeSidebar();
}

function applyPrimaryWorkbench(value) {
  const mode = normalizedPrimaryWorkbench(value);
  const previousMode = state.activeWorkbench;
  state.primaryModePreference = mode;
  state.activeWorkbench = mode;
  const workbench = mode === "workbench";
  if (previousMode !== mode) {
    state.projectQuery = "";
    if ($("projectSearch")) $("projectSearch").value = "";
    $("projectSearchWrap")?.classList.add("hidden");
    $("projectSearchToggleBtn")?.classList.remove("active");
  }
  $("conversationPanel")?.classList.toggle("hidden", workbench);
  $("workbenchPanel")?.classList.toggle("hidden", !workbench);
  document.body.classList.toggle("workbench-mode", workbench);
  const modalOpen = elementVisible("settingsModal") || elementVisible("employeeOverviewModal");
  if (!modalOpen) setGlobalRailActive(primaryWorkbenchRailTarget(mode));
  renderWorkbenchShell();
  renderProjects();
  if (workbench && state.agent?.id) specBoard.load().catch(showError);
  return mode;
}

function switchPrimaryWorkbench(value) {
  backgroundTasks.closeTray("workbench-switch");
  closeConversationDetails();
  closeSettingsModal({ restoreWorkbench: false });
  closeEmployeeOverview({ restoreWorkbench: false });
  return setPrimaryModePreference(normalizedPrimaryWorkbench(value));
}

async function focusTaskCreation() {
  if (state.activeWorkbench !== "workbench") return false;
  if (!state.agent?.id) {
    showToast(t("workbench.selectAgentToCreate"), "info", { force: true });
    return false;
  }
  closeMobileSidebar();
  if (projectKanban.focusCreate()) return true;
  await specBoard.load();
  if (projectKanban.focusCreate()) return true;
  showToast(t("projectKanban.unavailable"), "info", { force: true });
  return false;
}

async function refreshPrimaryMode() {
  await init();
  if (state.activeWorkbench === "workbench" && state.agent?.id) await specBoard.load();
  renderProjects();
}

const globalRailSettingsTargets = new Set(["profile"]);

function setGlobalRailActive(target = "conversation") {
  document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
    const active = node.dataset.globalRailTarget === target;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function openSettingsModal(key = "providers", { trigger = document.activeElement } = {}) {
  backgroundTasks.closeTray("settings-open");
  closeEmployeeOverview({ restoreWorkbench: false });
  closeConversationDetails();
  if (state.workspaceOpen && state.workspaceTab === "preview") closeWorkspace();
  const itemKey = settingsItemByKey(key)?.key || "providers";
  const modal = $("settingsModal");
  const wasOpen = !modal?.classList.contains("hidden");
  state.settingsSearchQuery = "";
  state.activeSettingsCategory = settingsCategoryForItem(itemKey, "api");
  modal?.classList.remove("hidden");
  if (!wasOpen) beginSettingsDialogFocus(trigger);
  setGlobalRailActive("profile");
  syncSettingsSearchInput();
  warmSettingsData();
  renderSettingsNav(itemKey);
  selectSettingsPanel(itemKey);
}

function closeSettingsModal({ restoreWorkbench = true } = {}) {
  const modal = $("settingsModal");
  const wasOpen = Boolean(modal && !modal.classList.contains("hidden"));
  if (wasOpen) {
    settingsHelp.close({ restoreFocus: false });
    remoteAccessSettings.consumeGeneratedPassword();
    sharedAPISettings.consumeOneTimeToken();
    $("settingsContentBody").textContent = "";
  }
  modal?.classList.add("hidden");
  if (wasOpen) restoreSettingsDialogFocus();
  if (restoreWorkbench) setGlobalRailActive(primaryWorkbenchRailTarget());
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
  backgroundTasks.closeTray("employee-overview-open");
  closeConversationDetails();
  closeSettingsModal({ restoreWorkbench: false });
  setGlobalRailActive("profile");
  $("employeeOverviewModal")?.classList.remove("hidden");
  renderEmployeeOverview();
  await automationControl.load();
  renderEmployeeOverview();
}

function closeEmployeeOverview({ restoreWorkbench = true } = {}) {
  $("employeeOverviewModal")?.classList.add("hidden");
  if (restoreWorkbench && (!$("settingsModal") || $("settingsModal").classList.contains("hidden"))) {
    setGlobalRailActive(primaryWorkbenchRailTarget());
  }
}

function activateGlobalRailTarget(target) {
  const key = String(target || "conversation");
  closeSidebarSettingsMenu();
  closeMobileSidebar();
  if (key === "conversation" || key === "tasks") {
    switchPrimaryWorkbench(key === "tasks" ? "workbench" : "conversation");
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

function settingsSearchText(category, item) {
  return [category.label, category.key, item.key, item.label, item.subtitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filteredSettingsSections() {
  const query = normalizedSettingsSearchQuery();
  return groupSettingsItemsByLegacyCategory(settingsItems, (item, category) => !query || settingsSearchText(category, item).includes(query));
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

function bindSettingsArrowNavigation(nav, selector, keys) {
  nav.querySelectorAll(selector).forEach((node) => {
    node.addEventListener("keydown", (event) => {
      const direction = keys[event.key];
      if (direction == null) return;
      const nodes = [...nav.querySelectorAll(selector)];
      const index = nodes.indexOf(event.currentTarget);
      if (index < 0 || !nodes.length) return;
      const nextIndex = direction === "first" ? 0 : direction === "last" ? nodes.length - 1 : (index + direction + nodes.length) % nodes.length;
      nodes[nextIndex]?.focus();
      event.preventDefault();
    });
  });
}

function renderSettingsCategoryNav(activeCategory = "api") {
  const nav = $("settingsCategoryNav");
  if (!nav) return;
  nav.innerHTML = legacySettingsCategories.map((category) => `
    <button class="legacy-settings-category ${category.key === activeCategory ? "active" : ""}" type="button" aria-pressed="${category.key === activeCategory ? "true" : "false"}" data-settings-category="${escapeAttr(category.key)}">${escapeHtml(category.label)}</button>
  `).join("");
  nav.querySelectorAll("[data-settings-category]").forEach((node) => {
    node.addEventListener("click", () => selectSettingsCategory(node.dataset.settingsCategory));
  });
  bindSettingsArrowNavigation(nav, "[data-settings-category]", { ArrowLeft: -1, ArrowRight: 1, Home: "first", End: "last" });
}

function selectSettingsCategory(categoryKey) {
  const category = settingsCategoryByKey(categoryKey);
  state.activeSettingsCategory = category.key;
  state.settingsSearchQuery = "";
  syncSettingsSearchInput();
  const current = state.activeSettingsPanel || "";
  const nextKey = category.items.includes(current) ? current : firstSettingsItemForCategory(category.key);
  selectSettingsPanel(nextKey);
}

function renderSettingsNav(activeKey = "providers") {
  const nav = $("settingsNav");
  if (!nav) return;
  syncSettingsSearchInput();
  const categoryKey = settingsCategoryForItem(activeKey, state.activeSettingsCategory || "api");
  state.activeSettingsCategory = categoryKey;
  renderSettingsCategoryNav(categoryKey);
  const groups = filteredSettingsSections();
  if (!groups.length) {
    nav.innerHTML = `<div class="settings-nav-empty"><strong>${escapeHtml(am("noMatchingSettings"))}</strong><span>${escapeHtml(am("matchingSettingsHint"))}</span></div>`;
    return;
  }
  nav.innerHTML = groups.map((category) => `
    <section class="settings-nav-group" aria-label="${escapeAttr(category.label)}">
      <div class="settings-nav-group-label">${escapeHtml(category.label)}</div>
      ${category.items.map((item) => `
        <button class="settings-nav-item ${item.key === activeKey ? "active" : ""}" type="button" ${item.key === activeKey ? 'aria-current="page"' : ""} data-settings-key="${escapeAttr(item.key)}" title="${escapeAttr(item.label)}">
          <span class="settings-nav-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
          <span class="settings-nav-label"><strong>${escapeHtml(item.label)}</strong></span>
        </button>
      `).join("")}
    </section>
  `).join("");
  nav.querySelectorAll("[data-settings-key]").forEach((node) => {
    node.addEventListener("click", () => selectSettingsPanel(node.dataset.settingsKey));
  });
  bindSettingsArrowNavigation(nav, "[data-settings-key]", { ArrowUp: -1, ArrowDown: 1, Home: "first", End: "last" });
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
  const item = settingsItemByKey(key) || settingsItems[0];
  const panel = settingsPanelRegistry.resolve(item.key);
  const categoryKey = settingsCategoryForItem(item.key, state.activeSettingsCategory || "api");
  settingsHelp.close({ restoreFocus: false });
  if (state.activeSettingsPanel === "shared-api" && item.key !== "shared-api") sharedAPISettings.consumeOneTimeToken();
  state.activeSettingsCategory = categoryKey;
  state.activeSettingsPanel = item.key;
  renderSettingsNav(item.key);
  const isAboutPanel = item.key === "about";
  $("settingsContentTitle")?.closest(".settings-content-head")?.classList.remove("hidden");
  $("settingsContentBody")?.closest(".settings-content")?.classList.toggle("about-panel-active", isAboutPanel);
  $("settingsContentTitle").textContent = item.label;
  $("settingsContentSubtitle").textContent = item.subtitle;
  settingsHelp.sync({ key: item.key, label: item.label, overview: item.subtitle });
  const layout = panel?.layout || (isAboutPanel ? "about" : "");
  const content = panel ? panel.render(item) : renderGenericSettingsContent(item);
  $("settingsContentBody").innerHTML = `<div class="settings-page-frame" data-settings-page="${escapeAttr(item.key)}"${layout ? ` data-panel-layout="${escapeAttr(layout)}"` : ""}>${content}</div>`;
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
        <p data-settings-help-copy>${escapeHtml(item.subtitle)}</p>
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
  const busy = options.busy === true;
  el.classList.add("empty");
  el.innerHTML = renderEmptyWorkspaceCard(options);
  if (busy) {
    el.setAttribute("aria-busy", "true");
    el.dataset.initialChatState = "loading";
  } else {
    el.removeAttribute("aria-busy");
    delete el.dataset.initialChatState;
  }
}

function markMessageViewportBusy() {
  const el = $("messages");
  if (!el) return;
  el.setAttribute("aria-busy", "true");
  el.dataset.initialChatState = "loading";
}

function clearMessageViewportBusy() {
  const el = $("messages");
  if (!el) return;
  el.removeAttribute("aria-busy");
  delete el.dataset.initialChatState;
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

function permissionMobileLabel(value) {
  return {
    readOnly: "RO",
    acceptEdits: "RW",
    bypassPermissions: "ALL",
    dontAsk: "NA",
    default: "AUTO",
  }[value] || "AUTO";
}

function updatePermissionModeDisplay() {
  const select = $("permissionMode");
  const display = document.querySelector(".permission-toolbar-pill .mode-display");
  if (!select || !display) return;
  const permission = effectivePermissionForDisplay(select.value);
  const label = permissionLabel(permission);
  display.textContent = label;
  (display.dataset ||= {}).mobileLabel = permissionMobileLabel(permission);
  const badge = $("permissionRiskBadge");
  if (badge) {
    badge.textContent = label;
    badge.classList.toggle("danger", permission === "bypassPermissions");
  }
}

function currentSecuritySummary() {
  const runtimeSecurity = state.runtimeSummary?.security || null;
  const access = state.remoteAccess || null;
  if (!runtimeSecurity && !access) return null;
  return {
    ...(runtimeSecurity || {}),
    currentRequestRemote: access?.session?.remote ?? runtimeSecurity?.currentRequestRemote,
    remoteAccessRequired: access?.session?.remote ?? runtimeSecurity?.remoteAccessRequired,
    bypassPermissionsAllowed: fullAccessAllowed(state),
    remoteTerminalAllowed: terminalAccessAllowed(state),
    maxPermissionMode: access?.capabilities?.maxPermissionMode || runtimeSecurity?.maxPermissionMode,
    accessPasswordConfigured: access?.credential?.configured ?? runtimeSecurity?.accessPasswordConfigured,
    capabilities: access?.capabilities || runtimeSecurity?.capabilities,
  };
}

function remoteSecurityHardeningActive() {
  const security = currentSecuritySummary();
  const remoteSession = Boolean(state.remoteAccess?.session?.remote);
  return Boolean(state.remoteAccessFailClosed || remoteSession || security?.remoteAccessRequired || security?.exposed || security?.currentRequestRemote || security?.bypassPermissionsAllowed === false);
}

function connectionModeSummary() {
  const remote = remoteAccessContext(state);
  if (!remote) {
    return { remote: false, restricted: false, label: am("localConnection"), title: am("localConnectionTitle"), tone: "ok" };
  }
  const restricted = !fullAccessAllowed(state);
  const mode = restricted ? am("tunnelRestrictedConnection") : am("tunnelFullConnection");
  return {
    remote: true,
    restricted,
    label: mode,
    title: am("tunnelConnectionTitle", { mode }),
    tone: restricted ? "warn" : "ok",
  };
}

function connectionMobileLabel(connection) {
  if (!connection?.remote) return "LAN";
  return connection.restricted ? "T−" : "T+";
}

function bypassDisabledBySecurity() {
  return !fullAccessAllowed(state);
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
  const terminalLocked = !terminalAccessAllowed(state);
  if (terminalLocked) enforceTerminalAccessPolicy();
  const connection = connectionModeSummary();
  const badge = $("securityModeBadge");
  if (badge) {
    badge.textContent = connection.label;
    badge.title = [connection.title, security?.message].filter(Boolean).join(" · ");
    (badge.dataset ||= {}).mobileLabel = connectionMobileLabel(connection);
    badge.classList.toggle("warn", connection.tone === "warn");
    badge.classList.toggle("ok", connection.tone === "ok");
    badge.classList.toggle("tunnel", connection.remote);
    badge.dataset.connectionMode = connection.remote ? (connection.restricted ? "tunnel-restricted" : "tunnel-full") : "local";
  }
  [$("toggleTerminalBtn"), $("workbenchTerminalBtn"), $("expandTerminalBtn"), $("reconnectTerminalBtn")].forEach((button) => {
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

function conversationHeaderTitle() {
  return state.agent?.title || state.project?.name || t("chat.noAgent");
}

function titleEditorElements(surface) {
  const workbench = surface === "workbench";
  return {
    display: $(workbench ? "workbenchTitle" : "currentTitle"),
    input: $(workbench ? "workbenchTitleInput" : "currentTitleInput"),
    edit: $(workbench ? "editWorkbenchTitleBtn" : "editConversationTitleBtn"),
    save: $(workbench ? "saveWorkbenchTitleBtn" : "saveConversationTitleBtn"),
    cancel: $(workbench ? "cancelWorkbenchTitleBtn" : "cancelConversationTitleBtn"),
    editLabel: am(workbench ? "editWorkbenchTitle" : "editConversationTitle"),
    fieldLabel: am(workbench ? "workbenchTitleLabel" : "conversationTitle"),
  };
}

function titleForSurface(surface) {
  if (surface === "workbench") return state.agent?.title || state.project?.name || t("workbench.title");
  return conversationHeaderTitle();
}

function renderAgentTitleEditor(surface) {
  const { display, input, edit, save, cancel, editLabel, fieldLabel } = titleEditorElements(surface);
  const editable = Boolean(state.agent?.id);
  if (!editable) {
    state.titleEditing = false;
    state.titleSaving = false;
    state.titleDraft = "";
  }
  const editing = editable && state.titleEditing;
  const title = titleForSurface(surface);
  if (display) {
    display.textContent = title;
    display.disabled = !editable || state.titleSaving;
    display.title = editable ? editLabel : title;
    display.setAttribute("aria-label", editable ? editLabel : title);
    display.classList.toggle("hidden", editing);
  }
  if (input) {
    input.classList.toggle("hidden", !editing);
    input.disabled = state.titleSaving;
    input.setAttribute("aria-label", fieldLabel);
    if (editing && input.value !== state.titleDraft) input.value = state.titleDraft;
  }
  if (edit) {
    edit.disabled = !editable || state.titleSaving;
    edit.classList.toggle("hidden", editing);
    edit.title = editLabel;
    edit.setAttribute("aria-label", editLabel);
  }
  if (save) {
    save.disabled = state.titleSaving;
    save.classList.toggle("hidden", !editing);
    save.toggleAttribute("aria-busy", state.titleSaving);
    save.title = am("saveConversationTitle");
    save.setAttribute("aria-label", am("saveConversationTitle"));
  }
  if (cancel) {
    cancel.disabled = state.titleSaving;
    cancel.classList.toggle("hidden", !editing);
    cancel.title = am("cancelConversationTitle");
    cancel.setAttribute("aria-label", am("cancelConversationTitle"));
  }
}

function renderConversationHeaderIdentity() {
  renderAgentTitleEditor("conversation");
}

function renderWorkbenchHeaderIdentity() {
  renderAgentTitleEditor("workbench");
}

function renderAllTitleEditors() {
  renderConversationHeaderIdentity();
  renderWorkbenchHeaderIdentity();
}

function normalizedTitleEditSurface(surface) {
  return surface === "workbench" ? "workbench" : "conversation";
}

function beginConversationTitleEdit(surface = "conversation") {
  if (!state.agent?.id || state.titleSaving) return;
  state.titleEditSurface = normalizedTitleEditSurface(surface);
  state.titleDraft = String(state.agent.title || state.project?.name || "");
  state.titleEditing = true;
  renderAllTitleEditors();
  queueMicrotask(() => {
    const input = titleEditorElements(state.titleEditSurface).input;
    input?.focus();
    input?.select();
  });
}

function cancelConversationTitleEdit() {
  if (state.titleSaving) return;
  state.titleEditing = false;
  state.titleDraft = "";
  renderAllTitleEditors();
}

function updateTitleDraft(surface, event) {
  state.titleEditSurface = normalizedTitleEditSurface(surface);
  state.titleDraft = event.target.value;
}

function handleTitleEditorKeydown(surface, event) {
  if (isComposingInput(event)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    saveConversationTitle(surface).catch(showError);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelConversationTitleEdit();
  }
}

async function saveConversationTitle(surface = state.titleEditSurface) {
  const agentId = state.agent?.id || "";
  if (!agentId || state.titleSaving) return;
  const target = normalizedTitleEditSurface(surface);
  const workbench = target === "workbench";
  const input = titleEditorElements(target).input;
  const title = String(input ? input.value : state.titleDraft || "").trim();
  if (!title) throw new Error(am(workbench ? "workbenchTitleRequired" : "conversationTitleRequired"));
  const byteLength = globalThis.TextEncoder ? new TextEncoder().encode(title).length : title.length;
  if (byteLength > 200 || /[\0\r\n]/.test(title)) throw new Error(am(workbench ? "workbenchTitleInvalid" : "conversationTitleInvalid"));
  if (title === String(state.agent?.title || "").trim()) {
    cancelConversationTitleEdit();
    return;
  }
  const generation = Number(state.agent?.entityGeneration);
  state.titleEditSurface = target;
  state.titleDraft = title;
  state.titleSaving = true;
  renderAllTitleEditors();
  try {
    const updated = await api(`/api/agents/${encodeURIComponent(agentId)}/title`, {
      method: "PATCH",
      body: JSON.stringify({ title, ...(Number.isInteger(generation) ? { entityGeneration: generation } : {}) }),
    });
    if (state.agent?.id !== agentId) return;
    state.agent = updated;
    state.worklineAgents = (state.worklineAgents || []).map((agent) => agent.id === agentId ? updated : agent);
    state.titleEditing = false;
    state.titleDraft = "";
    syncNavigationConversationFromAgent(updated, { reason: "agent-title" });
    navigationRefresh.request("agent-title");
    renderConversationHeaderIdentity();
    renderWorkbenchShell();
    rememberCurrentConversation();
    showToast(am(workbench ? "workbenchTitleSaved" : "conversationTitleSaved"), "success");
    notifyTerminal(`[info] ${am(workbench ? "workbenchTitleSavedTerminal" : "conversationTitleSavedTerminal", { title })}\n`);
  } finally {
    if (state.agent?.id === agentId) {
      state.titleSaving = false;
      renderAllTitleEditors();
    }
  }
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
  const securityText = connectionModeSummary().label;
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

function syncNavigationConversationFromAgent(agent, options = {}) {
  const agentId = String(agent?.id || "").trim();
  if (!agentId) return false;
  const index = state.navigationConversations.findIndex((item) => item.agentId === agentId);
  if (index < 0) {
    navigationRefresh.request(options.reason || "agent-discovered");
    return false;
  }
  const current = state.navigationConversations[index];
  const messageCount = Number(agent?.messageCount);
  const updated = {
    ...current,
    agentTitle: String(agent?.title || current.agentTitle),
    agentType: String(agent?.type || current.agentType),
    agentStatus: String(options.status || agent?.status || current.agentStatus || "idle"),
    model: String(agent?.model || current.model),
    permissionMode: String(agent?.permissionMode || current.permissionMode),
    cwd: String(agent?.cwd || current.cwd),
    messageCount: Number.isFinite(messageCount) ? Math.max(0, Math.trunc(messageCount)) : current.messageCount,
    lastActivityAt: String(agent?.lastMessageAt || agent?.updatedAt || current.lastActivityAt),
  };
  state.navigationConversations = [
    ...state.navigationConversations.slice(0, index),
    updated,
    ...state.navigationConversations.slice(index + 1),
  ];
  renderProjects();
  return true;
}

function renderProjects() {
  const el = $("projects");
  if (!el) return;
  const taskContext = state.activeWorkbench === "workbench";
  const effectiveNavigationMode = taskContext ? "projects" : state.navigationMode;
  renderPrimaryModeSidebar();
  const view = buildNavigationView({ projects: state.projects, conversations: state.navigationConversations }, {
    mode: effectiveNavigationMode,
    query: state.projectQuery,
  });
  const heading = $("navigationListHeading");
  setTranslatedText(heading, taskContext
    ? "workbench.contextHeading"
    : (state.navigationMode === "conversations" ? "shell.filters.conversations" : "shell.filters.projects"));
  el.innerHTML = renderNavigationHTML(view, {
    activeProjectId: state.project?.id || "",
    activeAgentId: state.agent?.id || "",
    taskContext,
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
  el.querySelectorAll("[data-primary-workbench-target]").forEach((node) => {
    node.addEventListener("click", () => switchPrimaryWorkbench(node.dataset.primaryWorkbenchTarget));
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
  state.titleEditing = false;
  state.titleSaving = false;
  state.titleDraft = "";
  renderConversationHeaderIdentity();
  state.chatHydrating = true;
  clearLiveAssistantText();
  setWorkspaceExplorerAgent(null);
  projectKanban.setAgent(null);
  renderWorkbenchShell();
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

async function selectProject(id, options = {}) {
  const seq = beginNavigationSelection(state.projects.find((project) => project.id === id) || null);
  if (!state.project) {
    state.chatHydrating = false;
    updateWorkspaceMetaPills();
    showEmptyWorkspaceState();
    return;
  }
  $("currentTitle").textContent = state.project.name;
  updateWorkspaceMetaPills();
  if (!options.preserveMessageState) {
    showEmptyWorkspaceState({
      title: am("projectLoadingTitle"),
      text: am("projectLoadingDescription"),
      action: am("chooseAnotherFolder"),
      hint: state.project.gitPath || "",
      icon: "…",
      busy: true,
    });
  }
  try {
    const worklines = await api(`/api/projects/${id}/worklines`);
    if (seq !== state.projectSelectSeq || state.project?.id !== id) return;
    state.projectWorklines = Array.isArray(worklines) ? worklines : [];
    state.workline = state.projectWorklines[0] || null;
    if (!state.workline) {
      state.chatHydrating = false;
      $("currentTitle").textContent = state.project.name;
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
      state.chatHydrating = false;
      $("currentTitle").textContent = state.project.name;
      updateWorkspaceMetaPills();
      showEmptyWorkspaceState({ title: am("noAgents"), text: am("noAgentsDescription"), action: am("chooseAnotherFolder"), icon: "♧" });
      return;
    }
    await enterAgent();
    if (seq !== state.projectSelectSeq) return;
  } catch (err) {
    if (seq === state.projectSelectSeq && state.project?.id === id) {
      state.chatHydrating = false;
      throw err;
    }
  }
}

async function selectNavigationConversation(target, options = {}) {
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
    state.chatHydrating = false;
    showEmptyWorkspaceState();
    throw new Error(am("projectNoLongerExists"));
  }

  $("currentTitle").textContent = navigationConversation?.projectName || state.project.name;
  updateWorkspaceMetaPills();
  // Keep the previous conversation in place while the next one hydrates. Replacing
  // it with a full-screen loading card causes a distracting flash on every switch.
  markMessageViewportBusy();

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
      state.chatHydrating = false;
      clearMessageViewportBusy();
      $("currentTitle").textContent = state.project.name;
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
    clearMessageViewportBusy();
    renderProjects();
  } catch (err) {
    if (seq === state.projectSelectSeq && state.project?.id === parsed.projectId) {
      state.chatHydrating = false;
      clearMessageViewportBusy();
      throw err;
    }
  }
}

async function enterAgent() {
  if (!state.agent) return;
  closeConversationDetails();
  const agentId = state.agent.id;
  backgroundTasks.setAgent(agentId);
  setWorkspaceExplorerAgent(state.agent);
  projectKanban.setAgent(state.agent);
  renderWorkbenchShell();
  if (state.activeWorkbench === "workbench") specBoard.load().catch(showError);
  renderConversationHeaderIdentity();
  $("permissionMode").value = state.agent.permissionMode || "acceptEdits";
  enforcePermissionSelectCap();
  updateWorkspaceMetaPills();
  renderModelOptions();
  refreshReasoningEffortControl();
  refreshFastModeControl();
  refreshMessageModeControl();
  await restoreCurrentChatDraft();
  syncMessageComposerBusy();
  state.chatHydrating = true;
  clearRunSummary();
  clearPlanState(agentId);
  connectTerminal();
  loadGitStatus({ silent: true }).then(renderWorkbenchShell).catch(() => {});
  let effectiveSkillsError = null;
  const effectiveSkillsPromise = refreshEffectiveSkillsPolicy().catch((error) => {
    effectiveSkillsError = error;
  });
  let messagesLoaded = false;
  try {
    [messagesLoaded] = await Promise.all([
      loadMessages(agentId),
      loadLatestRunSummary(agentId),
      backgroundTasks.loadAgent(agentId),
    ]);
    if (state.agent?.id !== agentId) return;
    state.chatHydrating = false;
    if (messagesLoaded) applyMessageSnapshot(state.currentMessages, agentId, { forceRender: true });
  } finally {
    if (state.agent?.id === agentId) {
      state.chatHydrating = false;
      connectWS();
    }
  }
  await effectiveSkillsPromise;
  if (state.agent?.id !== agentId) return;
  if (effectiveSkillsError) throw effectiveSkillsError;
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
  backgroundTasks.setAgent("");
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
  if (!state.agent?.id || state.remoteAccessFailClosed) return;
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
  renderWorkbenchShell();
}

async function applyAgentLiveSnapshot(snapshot, detail = {}) {
  const agentId = snapshot?.agent?.id || "";
  if (!agentId || state.agent?.id !== agentId) return;
  backgroundTasks.applySnapshot(snapshot, { agentId });
  if (detail.source === "initial") await executionNotifications.initial(snapshot, { agentId });
  else await executionNotifications.snapshot(snapshot, { agentId });
  state.agent = snapshot.agent;
  renderConversationHeaderIdentity();
  syncNavigationConversationFromAgent(state.agent, { reason: "agent-snapshot" });
  navigationRefresh.request("agent-snapshot");
  clearLiveAssistantText();
  const recoveredToolOutputs = Object.fromEntries(Object.entries(state.liveToolOutputs || {}).filter(([, value]) => value?.agentId && value.agentId !== agentId));
  for (const call of Array.isArray(snapshot.toolActivity) ? snapshot.toolActivity : []) {
    const toolUseId = String(call?.toolUseId || call?.tool_use_id || "").trim();
    if (toolUseId) recoveredToolOutputs[toolUseId] = { ...call, agentId, toolUseId };
  }
  state.liveToolOutputs = recoveredToolOutputs;
  clearRunSummary();
  replacePlanState(snapshot.activePlan, snapshot.pendingPlanApproval ?? snapshot.pendingPlan, agentId);
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
  refreshMessageModeControl();
  updateWorkspaceMetaPills();
  renderWorkbenchShell();
  syncMessageComposerBusy();
  const latestRun = snapshot.latestRun;
  if (latestRun?.id && ["completed", "error", "failed", "interrupted", "superseded"].includes(latestRun.status)) {
    loadRunSummary(latestRun.id, { agentId }).catch((error) => notifyTerminal(`[warn] ${am("runSummaryRestoreFailed", { message: error?.message || error })}\n`));
  }
}

async function handleAgentStreamEvent(event) {
  const agentId = state.agent?.id || "";
  if (!agentId || (event.agentId && event.agentId !== agentId)) return;
  backgroundTasks.handleEvent(event);
  await executionNotifications.live(event, { agentId });
  if (shouldLogAgentEvents()) appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
  applyPlanEvent(event);
  const runId = event.data?.runId || "";
  const requestId = event.data?.requestId || "";
  const completedMessageEvents = ["message.created", "message.completed"];
  const terminalAgentEvents = ["agent.done", "agent.error", "agent.interrupted"];
  const navigationRefreshEvents = ["agent.started", ...completedMessageEvents, ...terminalAgentEvents];
  if (event.type === "agent.started") {
    state.agent = { ...state.agent, status: "running" };
    syncNavigationConversationFromAgent(state.agent, { status: "running", reason: "agent-started" });
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
  if (terminalAgentEvents.includes(event.type)) {
    const status = event.type === "agent.error" ? "error" : "idle";
    state.agent = { ...state.agent, status };
    syncNavigationConversationFromAgent(state.agent, { status, reason: event.type });
  }
  if ([...completedMessageEvents, ...terminalAgentEvents].includes(event.type)) clearLiveAssistantText();
  if ([...completedMessageEvents, ...terminalAgentEvents].includes(event.type)) scheduleMessageRefresh(80, agentId);
  if (navigationRefreshEvents.includes(event.type)) navigationRefresh.request(event.type);
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
  if ($("appShell")?.classList.contains("background-tasks-open")) backgroundTasks.closeTray("escape");
  if ($("appShell")?.classList.contains("details-open")) closeConversationDetails();
});
document.addEventListener("keydown", handleSettingsSearchShortcut);
document.addEventListener("click", handleDirectoryShortcutClick);
document.addEventListener("click", handleSidebarSettingsMenuDocumentClick);
document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
  node.addEventListener("click", () => activateGlobalRailTarget(node.dataset.globalRailTarget));
});
$("globalThemeToggleBtn")?.addEventListener("click", () => {
  const { themePreset, theme } = currentAppearancePreferences();
  const nextPreset = themePreset === "apple"
    ? "dark"
    : themePreset === "cream"
      ? "dark"
      : themePreset === "cyber"
        ? "light"
        : theme === "dark" ? "light" : "dark";
  setAppearancePreference("themePreset", nextPreset);
});
$("refreshBtn").addEventListener("click", () => refreshPrimaryMode().catch(showError));
$("newTaskBtn")?.addEventListener("click", () => focusTaskCreation().catch(showError));
$("currentTitle")?.addEventListener("click", () => beginConversationTitleEdit("conversation"));
$("editConversationTitleBtn")?.addEventListener("click", () => beginConversationTitleEdit("conversation"));
$("saveConversationTitleBtn")?.addEventListener("click", () => saveConversationTitle("conversation").catch(showError));
$("cancelConversationTitleBtn")?.addEventListener("click", cancelConversationTitleEdit);
$("currentTitleInput")?.addEventListener("input", (event) => updateTitleDraft("conversation", event));
$("currentTitleInput")?.addEventListener("keydown", (event) => handleTitleEditorKeydown("conversation", event));
$("workbenchTitle")?.addEventListener("click", () => beginConversationTitleEdit("workbench"));
$("editWorkbenchTitleBtn")?.addEventListener("click", () => beginConversationTitleEdit("workbench"));
$("saveWorkbenchTitleBtn")?.addEventListener("click", () => saveConversationTitle("workbench").catch(showError));
$("cancelWorkbenchTitleBtn")?.addEventListener("click", cancelConversationTitleEdit);
$("workbenchTitleInput")?.addEventListener("input", (event) => updateTitleDraft("workbench", event));
$("workbenchTitleInput")?.addEventListener("keydown", (event) => handleTitleEditorKeydown("workbench", event));
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
$("settingsModal").addEventListener("keydown", (event) => {
  settingsHelp.handleKeydown(event);
  handleSettingsDialogKeydown(event);
});
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
$("mobileWorkbenchBtn")?.addEventListener("click", () => {
  switchPrimaryWorkbench(state.activeWorkbench === "workbench" ? "conversation" : "workbench");
});
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
$("workbenchBoardBtn")?.addEventListener("click", () => {
  projectKanban.render();
  $("projectKanbanBody")?.scrollTo?.({ top: 0, behavior: "smooth" });
});
$("workbenchFilesBtn")?.addEventListener("click", () => openWorkspace("files"));
$("workbenchGitBtn")?.addEventListener("click", openGitModal);
$("workbenchRunBtn")?.addEventListener("click", openConversationDetails);
$("workbenchTerminalBtn")?.addEventListener("click", () => toggleTerminalDock());
$("workbenchPreviewBtn")?.addEventListener("click", () => openWorkspace("preview"));
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
document.querySelectorAll("[data-message-mode]").forEach((button) => {
  button.addEventListener("click", () => setMessageMode(button.dataset.messageMode));
});
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
  saveCurrentChatDraft();
  navigationRefresh.stop();
  state.serverDrafts = {};
  disconnectAgentTransports();
  closeWorkspace();
  closeConversationDetails();
  state.project = null;
  state.workline = null;
  state.agent = null;
  state.projectWorklines = [];
  state.worklineAgents = [];
  state.chatHydrating = false;
  state.currentMessages = [];
  state.messageCopyTexts = [];
  clearRunSummary();
  clearPlanState();
  clearLiveAssistantText();
  setWorkspaceExplorerAgent(null);
  projectKanban.setAgent(null);
  resetGitWorkflowState();
  renderWorkbenchShell();
  renderProjects();
  showEmptyWorkspaceState();
  init().catch(showError);
});
window.addEventListener("beforeunload", () => {
  navigationRefresh.stop();
  saveCurrentChatDraft();
});
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
    backgroundTasks.closeTray("terminal-open");
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
    state.primaryModePreference = loadPrimaryModePreference();
    state.terminalPrefs = loadTerminalPreferences();
    state.chatDrafts = loadChatDrafts();
    state.promptHistory = loadPromptHistory();
    state.recentConversations = loadRecentConversations();
    applyAppearancePreferences({ applyTerminalDefault: true });
    applyPrimaryWorkbench(currentPrimaryModePreference());
    updateGlobalThemeToggle();
    if (!state.agent) {
      $("currentTitle").textContent = t("chat.noAgent");
      $("composerStatusText").textContent = t("chat.idle");
      const terminalOutput = $("terminalOutput");
      if (terminalOutput && terminalOutput.textContent.startsWith("Terminal ready.")) terminalOutput.textContent = t("terminal.ready");
    }
    renderConversationHeaderIdentity();
    updatePermissionModeDisplay();
    autoResizeMessageInput();
    renderRecentSidebarConversations();
    renderRecentSidebarDirectories();
    await loadHealth();
    await Promise.all([loadSettings(), loadRuntimeSummary(), remoteAccessSettings.load().catch(() => {}), loadModelCatalog(), loadProjects(), loadBackends(), loadServerSkills()]);
    if (seq !== state.initSeq) return;
    navigationRefresh.start();
    if (!state.agent) {
      const initialTarget = resolveInitialNavigationTarget(state.recentConversations, state.navigationConversations);
      if (initialTarget) {
        await selectNavigationConversation(initialTarget, { preserveMessageState: true });
      } else if (state.projects.length) {
        await selectProject(state.projects[0].id, { preserveMessageState: true });
      } else {
        state.chatHydrating = false;
        showEmptyWorkspaceState();
      }
    }
  } finally {
    if (seq === state.initSeq) {
      state.initializing = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.classList.remove("loading");
        refreshButton.removeAttribute("aria-busy");
        renderPrimaryModeSidebar();
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
