import { currentUILocale } from "./i18n.mjs";
import { t as skillsMessage } from "./messages-skills.mjs";

function pluginMessage(key, params = {}) {
  return skillsMessage(`pluginRegistry.${key}`, params, currentUILocale());
}

export function buildPluginInstallPayload(rootPath) {
  const normalized = String(rootPath || "").trim();
  if (!normalized) throw new Error(pluginMessage("pathRequired"));
  return { rootPath: normalized };
}

export function pluginEnvironmentStatuses(plugin = {}) {
  const source = Array.isArray(plugin.environment)
    ? plugin.environment
    : Array.isArray(plugin.env)
      ? plugin.env
      : Array.isArray(plugin.envKeys)
        ? plugin.envKeys
        : [];
  return source.map((entry) => {
    if (typeof entry === "string") return { key: entry, configured: false };
    return {
      key: String(entry?.key || entry?.name || ""),
      configured: Boolean(entry?.configured),
    };
  }).filter((entry) => entry.key);
}

export function pluginTools(result = {}) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result.tools) ? result.tools : [];
}
