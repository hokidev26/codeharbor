import { t } from "./i18n.mjs";

function settingItem(key, icon, messageKey) {
  return {
    key,
    icon,
    label: t(`settings.item.${messageKey}.label`),
    subtitle: t(`settings.item.${messageKey}.subtitle`),
  };
}

export const settingsSections = [
  {
    title: t("settings.section.personal"),
    items: [
      settingItem("profile", "♙", "profile"),
      settingItem("memory", "◈", "memory"),
      settingItem("models", "⚙", "models"),
      settingItem("agents", "♧", "agents"),
      settingItem("skills", "✦", "skills"),
      settingItem("notifications", "♢", "notifications"),
      settingItem("appearance", "◉", "appearance"),
      settingItem("im-gateway", "⌂", "imGateway"),
    ],
  },
  {
    title: t("settings.section.instance"),
    items: [
      settingItem("providers", "☁", "providers"),
      settingItem("network-search", "⌕", "networkSearch"),
      settingItem("agent-admin", "⬡", "agentAdmin"),
      settingItem("worklines-containers", "◇", "worklines"),
      settingItem("servers-system", "▤", "serversSystem"),
      settingItem("terminals", "▻", "terminals"),
      settingItem("storage", "▭", "storage"),
      settingItem("runtime", "▷", "runtime"),
      settingItem("remote-access", "◉", "remoteAccess"),
      settingItem("usage", "▧", "usage"),
      settingItem("about", "ⓘ", "about"),
    ],
  },
];

export const settingsItems = settingsSections.flatMap((section) => section.items);
export const settingsItemsByKey = new Map(settingsItems.map((item) => [item.key, item]));

export function settingsItemByKey(key) {
  return settingsItemsByKey.get(String(key || "")) || null;
}

export const skillTabs = [
  { key: "commands", messageKey: "commands" },
  { key: "optional-tools", messageKey: "optionalTools" },
  { key: "tool-permissions", messageKey: "toolPermissions" },
  { key: "global-skills", messageKey: "globalSkills" },
  { key: "project-skills", messageKey: "projectSkills" },
  { key: "subagents", messageKey: "subagents" },
  { key: "global-prompts", messageKey: "globalPrompts" },
  { key: "system-prompts", messageKey: "systemPrompts" },
  { key: "mcp-tools", messageKey: "mcpTools" },
  { key: "plugins", messageKey: "plugins" },
  { key: "hooks", messageKey: "hooks" },
].map(({ messageKey, ...tab }) => ({
  ...tab,
  label: t(`skills.tabs.${messageKey}.label`),
  description: t(`skills.tabs.${messageKey}.description`),
  empty: t(`skills.tabs.${messageKey}.empty`),
  action: t(`skills.tabs.${messageKey}.action`),
}));
