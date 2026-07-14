import { currentUILocale } from "./i18n.mjs";
import { getDateTimeFormatter, getNumberFormatter } from "./locale-registry.mjs";
import { preferencesMessage } from "./messages-preferences.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function regionalOptions(options = {}) {
  return { locale: options.locale, timezone: options.timezone ?? options.timeZone };
}

export function formatNumber(value, options = {}) {
  const number = finiteNumber(value);
  const formatter = getNumberFormatter({
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
    notation: options.notation,
    signDisplay: options.signDisplay,
    useGrouping: options.useGrouping,
  }, regionalOptions(options));
  return formatter.format(number);
}

export function formatBytes(value, options = {}) {
  const bytes = finiteNumber(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  if (bytes <= 0) return `${formatNumber(0, { ...options, maximumFractionDigits: 0 })} B`;
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const fractionDigits = unit === 0 || size >= 10 ? 0 : 1;
  return `${formatNumber(size, {
    ...options,
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })} ${units[unit]}`;
}

export function formatDuration(ms, options = {}) {
  const number = finiteNumber(ms);
  if (number <= 0) return `${formatNumber(0, { ...options, maximumFractionDigits: 0 })} ms`;
  if (number < 1000) return `${formatNumber(Math.round(number), { ...options, maximumFractionDigits: 0 })} ms`;
  if (number < 60000) {
    return `${formatNumber(number / 1000, {
      ...options,
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} s`;
  }
  return `${formatNumber(number / 60000, {
    ...options,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} min`;
}

export function formatCurrency(value, options = {}) {
  const number = finiteNumber(value);
  const currency = /^[A-Z]{3}$/.test(String(options.currency || "USD").toUpperCase())
    ? String(options.currency || "USD").toUpperCase()
    : "USD";
  const fractionDigits = Math.abs(number) >= 1 ? 2 : 4;
  const currencyDisplay = ["symbol", "narrowSymbol", "code", "name"].includes(options.currencyDisplay)
    ? options.currencyDisplay
    : "narrowSymbol";
  return getNumberFormatter({
    style: "currency",
    currency,
    currencyDisplay,
    minimumFractionDigits: options.minimumFractionDigits ?? fractionDigits,
    maximumFractionDigits: options.maximumFractionDigits ?? fractionDigits,
  }, regionalOptions(options)).format(number);
}

export function formatMoney(value, options = {}) {
  return formatCurrency(value, options);
}

export function formatTimestamp(value, options = {}) {
  const locale = options.locale ?? currentUILocale();
  const emptyFallback = options.emptyFallback ?? options.fallback ?? preferencesMessage("formatters.emptyTimestamp", {}, locale);
  const invalidFallback = options.invalidFallback ?? options.fallback ?? preferencesMessage("formatters.invalidTimestamp", {}, locale);
  if (value === null || value === undefined || value === "") return emptyFallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return invalidFallback;
  return getDateTimeFormatter({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }, regionalOptions(options)).format(date);
}
