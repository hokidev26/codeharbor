import { t } from "./i18n.mjs";

export const legacySettingsCategories = Object.freeze([
  { key: "api", label: t("settings.category.api"), items: ["providers", "models", "profile", "appearance"] },
  { key: "chat", label: t("settings.category.chat"), items: ["im-gateway"] },
  { key: "memory", label: t("settings.category.memory"), items: ["memory"] },
  { key: "diagnostics", label: t("settings.category.diagnostics"), items: ["runtime", "servers-system", "storage", "terminals"] },
  { key: "network", label: t("settings.category.network"), items: ["network-search", "agent-admin"] },
  { key: "permissions", label: t("settings.category.permissions"), items: ["agents", "users", "worklines-containers"] },
  { key: "market", label: t("settings.category.market"), items: ["skills"] },
  { key: "logs", label: t("settings.category.logs"), items: ["notifications", "usage"] },
  { key: "about", label: t("settings.category.about"), items: ["about"] },
]);

const categoryByItem = new Map();
legacySettingsCategories.forEach((category) => category.items.forEach((item) => categoryByItem.set(item, category.key)));

export function settingsCategoryForItem(key, fallback = "api") {
  return categoryByItem.get(String(key || "")) || fallback;
}

export function settingsCategoryByKey(key) {
  return legacySettingsCategories.find((category) => category.key === key) || legacySettingsCategories[0];
}

export function firstSettingsItemForCategory(key) {
  return settingsCategoryByKey(key)?.items?.[0] || "providers";
}
