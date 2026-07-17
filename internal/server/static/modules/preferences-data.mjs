import { currentUILocale } from "./i18n.mjs";
import { defaultRegionalPreferences, normalizeRegionalPreferences } from "./locale-registry.mjs";
import { preferencesMessage } from "./messages-preferences.mjs";

const canonicalLocalPreferencePrefix = "autoto.";
const legacyLocalPreferencePrefix = "codeharbor.";

export const recentDirectoriesKey = "autoto.recentDirectories";
export const recentConversationsKey = "autoto.recentConversations";
export const preferredModelKey = "autoto.preferredModel";
export const modelVisibilityPrefsKey = "autoto.modelVisibility";
export const profilePrefsKey = "autoto.profile";
export const searchPrefsKey = "autoto.search";
export const imGatewayPrefsKey = "autoto.imGateway";
export const skillsPrefsKey = "autoto.skills";
export const notificationPrefsKey = "autoto.notifications";
export const appearancePrefsKey = "autoto.appearance";
export const terminalPrefsKey = "autoto.terminal";
export const regionalPrefsKey = "autoto.regional";
export const chatDraftsKey = "autoto.chatDrafts";
export const promptHistoryKey = "autoto.promptHistory";
export const relayProtocolPrefsKey = "autoto.relayProtocol";
export const primaryModePrefsKey = "autoto.ui.primaryMode";
export const defaultPrimaryModePreference = "conversation";
export const localPreferenceBackupKind = "autoto.local-preferences";
export const legacyLocalPreferenceBackupKind = "codeharbor.local-preferences";
export const localPreferenceBackupVersion = 1;

export const localPreferenceKeys = [
  recentDirectoriesKey,
  recentConversationsKey,
  preferredModelKey,
  modelVisibilityPrefsKey,
  profilePrefsKey,
  searchPrefsKey,
  imGatewayPrefsKey,
  skillsPrefsKey,
  notificationPrefsKey,
  appearancePrefsKey,
  terminalPrefsKey,
  regionalPrefsKey,
  chatDraftsKey,
  promptHistoryKey,
  relayProtocolPrefsKey,
  primaryModePrefsKey,
];

export function legacyLocalPreferenceKey(key) {
  const canonicalKey = String(key || "");
  if (!canonicalKey.startsWith(canonicalLocalPreferencePrefix)) return "";
  return `${legacyLocalPreferencePrefix}${canonicalKey.slice(canonicalLocalPreferencePrefix.length)}`;
}

export function readLocalPreference(key, storage = globalThis.localStorage) {
  const canonicalKey = String(key || "");
  const currentValue = storage.getItem(canonicalKey);
  if (currentValue !== null) return currentValue;

  const legacyKey = legacyLocalPreferenceKey(canonicalKey);
  if (!legacyKey) return null;
  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return null;

  try {
    storage.setItem(canonicalKey, legacyValue);
  } catch {}
  return legacyValue;
}

export function migrateLegacyLocalPreferences(storage = globalThis.localStorage) {
  localPreferenceKeys.forEach((key) => {
    try {
      readLocalPreference(key, storage);
    } catch {}
  });
}

export const localPreferenceBackupKeys = [
  { key: profilePrefsKey, labelKey: "profile", type: "json" },
  { key: searchPrefsKey, labelKey: "search", type: "json" },
  { key: imGatewayPrefsKey, labelKey: "imGateway", type: "json" },
  { key: skillsPrefsKey, labelKey: "skills", type: "json" },
  { key: notificationPrefsKey, labelKey: "notifications", type: "json" },
  { key: appearancePrefsKey, labelKey: "appearance", type: "json" },
  { key: terminalPrefsKey, labelKey: "terminal", type: "json" },
  { key: regionalPrefsKey, labelKey: "regional", type: "json" },
  { key: chatDraftsKey, labelKey: "chatDrafts", type: "json" },
  { key: promptHistoryKey, labelKey: "promptHistory", type: "json" },
  { key: recentDirectoriesKey, labelKey: "recentDirectories", type: "json" },
  { key: recentConversationsKey, labelKey: "recentConversations", type: "json" },
  { key: preferredModelKey, labelKey: "preferredModel", type: "string" },
  { key: relayProtocolPrefsKey, labelKey: "relayProtocol", type: "string" },
  { key: primaryModePrefsKey, labelKey: "primaryMode", type: "string" },
].map((entry) => ({ ...entry, label: localPreferenceBackupLabel(entry) }));

export function localPreferenceBackupLabel(entry, locale = currentUILocale()) {
  return preferencesMessage(`backupLabels.${entry?.labelKey || ""}`, {}, locale);
}

export function normalizePrimaryModePreference(value) {
  return String(value || "").trim() === "workbench" ? "workbench" : defaultPrimaryModePreference;
}

export const defaultProfilePrefs = {
  displayName: "",
  roleLabel: "Local developer",
  avatarInitials: "AT",
  gitName: "",
  gitEmail: "",
  workspaceLabel: "Autoto Local",
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

export const appearanceStyleVersion = 3;
export const appearanceThemePresets = Object.freeze(["light", "dark", "cyber", "cream", "apple"]);
export const appearanceThemePresetTheme = Object.freeze({
  light: "light",
  dark: "dark",
  cyber: "dark",
  cream: "light",
  apple: "light",
});

export function normalizeAppearanceThemePreset(value) {
  const preset = String(value || "").trim().toLowerCase();
  return appearanceThemePresets.includes(preset) ? preset : "";
}

export function appearanceThemeForPreset(preset) {
  return appearanceThemePresetTheme[normalizeAppearanceThemePreset(preset)] || "light";
}

export const defaultAppearancePrefs = {
  styleVersion: appearanceStyleVersion,
  themePreset: "light",
  theme: "light",
  density: "comfortable",
  terminalDefaultOpen: false,
  showEventLog: true,
};

export const defaultTerminalPrefs = {
  clearOnReconnect: true,
  focusOnConnect: true,
  maxLines: 5000,
};

export const defaultRegionalPrefs = defaultRegionalPreferences;
export { normalizeRegionalPreferences };

export function normalizeImportedRegionalPreferences(value = {}) {
  const source = value?.regionalPreferences ?? value?.regional ?? value;
  return normalizeRegionalPreferences(source);
}
