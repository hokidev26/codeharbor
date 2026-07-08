export const recentDirectoriesKey = "codeharbor.recentDirectories";
export const preferredModelKey = "codeharbor.preferredModel";
export const modelVisibilityPrefsKey = "codeharbor.modelVisibility";
export const profilePrefsKey = "codeharbor.profile";
export const searchPrefsKey = "codeharbor.search";
export const imGatewayPrefsKey = "codeharbor.imGateway";
export const skillsPrefsKey = "codeharbor.skills";
export const notificationPrefsKey = "codeharbor.notifications";
export const appearancePrefsKey = "codeharbor.appearance";
export const terminalPrefsKey = "codeharbor.terminal";
export const chatDraftsKey = "codeharbor.chatDrafts";
export const promptHistoryKey = "codeharbor.promptHistory";
export const relayProtocolPrefsKey = "codeharbor.relayProtocol";
export const localPreferenceBackupKind = "codeharbor.local-preferences";
export const localPreferenceBackupVersion = 1;

export const localPreferenceBackupKeys = [
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

export const defaultProfilePrefs = {
  displayName: "",
  roleLabel: "Local developer",
  avatarInitials: "CH",
  gitName: "",
  gitEmail: "",
  workspaceLabel: "CodeHarbor Local",
};

export const defaultSearchPrefs = {
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

export const defaultIMGatewayPrefs = {
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

export const defaultSkillsPrefs = {
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

export const defaultNotificationPrefs = {
  toastEnabled: true,
  infoToasts: true,
  successToasts: true,
  warningToasts: true,
  errorToasts: true,
  terminalNotices: true,
  duration: "normal",
};

export const defaultAppearancePrefs = {
  theme: "dark",
  density: "comfortable",
  terminalDefaultOpen: false,
  showEventLog: true,
};

export const defaultTerminalPrefs = {
  clearOnReconnect: true,
  focusOnConnect: true,
  maxLines: 5000,
};
