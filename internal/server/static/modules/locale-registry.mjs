export const supportedLocalePreferences = Object.freeze(["auto", "zh-CN", "zh-TW", "en-US"]);
export const defaultRegionalPreferences = Object.freeze({ locale: "auto", timezone: "auto" });

const formatterCache = new Map();
let regionalPreferences = { ...defaultRegionalPreferences };

export function normalizeLocalePreference(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "auto") return "auto";
  const alias = {
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    "zh-tw": "zh-TW",
    "zh-hant": "zh-TW",
    "zh-hk": "zh-TW",
    "zh-mo": "zh-TW",
    en: "en-US",
    "en-us": "en-US",
  }[text.toLowerCase()];
  if (alias) return alias;
  const lower = text.toLowerCase();
  if (lower.startsWith("zh-hant-") || lower.startsWith("zh-tw-") || lower.startsWith("zh-hk-") || lower.startsWith("zh-mo-")) return "zh-TW";
  if (lower.startsWith("zh-hans-") || lower.startsWith("zh-cn-") || lower.startsWith("zh-sg-")) return "zh-CN";
  if (lower.startsWith("en-")) return "en-US";
  try {
    const canonical = Intl.getCanonicalLocales(text)[0];
    return supportedLocalePreferences.includes(canonical) ? canonical : "auto";
  } catch {
    return "auto";
  }
}

export function normalizeTimeZonePreference(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "auto") return "auto";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: text }).resolvedOptions().timeZone || "auto";
  } catch {
    return "auto";
  }
}

export function normalizeRegionalPreferences(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : { locale: value };
  return {
    locale: normalizeLocalePreference(source.locale ?? source.language ?? source.lang),
    timezone: normalizeTimeZonePreference(source.timezone ?? source.timeZone ?? source.zone),
  };
}

export function setRegionalPreferences(value = {}) {
  regionalPreferences = normalizeRegionalPreferences(value);
  clearIntlFormatterCache();
  return getRegionalPreferences();
}

export function getRegionalPreferences() {
  return { ...regionalPreferences };
}

function supportedLocaleFromCandidate(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text === "zh-tw" || text === "zh-hant" || text.startsWith("zh-hant-") || text === "zh-hk" || text.startsWith("zh-hk-") || text === "zh-mo" || text.startsWith("zh-mo-")) return "zh-TW";
  if (text === "zh" || text === "zh-cn" || text === "zh-hans" || text.startsWith("zh-hans-") || text === "zh-sg" || text.startsWith("zh-sg-")) return "zh-CN";
  if (text === "en" || text.startsWith("en-")) return "en-US";
  return "";
}

export function resolveLocale(value = regionalPreferences.locale) {
  const preference = normalizeLocalePreference(value);
  if (preference !== "auto") return preference;
  const candidates = [
    ...(Array.isArray(globalThis.navigator?.languages) ? globalThis.navigator.languages : []),
    globalThis.navigator?.language,
  ].filter(Boolean);
  try {
    candidates.push(new Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {}
  for (const candidate of candidates) {
    const supported = supportedLocaleFromCandidate(candidate);
    if (supported) return supported;
  }
  return "en-US";
}

export function resolveTimeZone(value = regionalPreferences.timezone) {
  const preference = normalizeTimeZonePreference(value);
  if (preference !== "auto") return preference;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function stableOptionsKey(options) {
  return Object.keys(options)
    .sort()
    .map((key) => `${key}:${String(options[key])}`)
    .join("|");
}

function cachedFormatter(kind, locale, options, create) {
  const key = `${kind}|${locale}|${stableOptionsKey(options)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, create());
  return formatterCache.get(key);
}

export function getNumberFormatter(options = {}, preferences = {}) {
  const locale = resolveLocale(preferences.locale ?? regionalPreferences.locale);
  return cachedFormatter("number", locale, options, () => new Intl.NumberFormat(locale, options));
}

export function getDateTimeFormatter(options = {}, preferences = {}) {
  const locale = resolveLocale(preferences.locale ?? regionalPreferences.locale);
  const timezone = resolveTimeZone(preferences.timezone ?? preferences.timeZone ?? regionalPreferences.timezone);
  const formatterOptions = { ...options, timeZone: timezone };
  return cachedFormatter("datetime", locale, formatterOptions, () => new Intl.DateTimeFormat(locale, formatterOptions));
}

export function clearIntlFormatterCache() {
  formatterCache.clear();
}

export function intlFormatterCacheSize() {
  return formatterCache.size;
}
