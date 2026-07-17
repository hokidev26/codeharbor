import test from "node:test";
import assert from "node:assert/strict";

import { formatBytes, formatCurrency, formatDuration, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";

test("formatBytes scales and guards invalid values", () => {
  assert.equal(formatBytes(0, { locale: "en-US" }), "0 B");
  assert.equal(formatBytes(Number.NaN, { locale: "en-US" }), "0 B");
  assert.equal(formatBytes(512, { locale: "en-US" }), "512 B");
  assert.equal(formatBytes(1536, { locale: "en-US" }), "1.5 KB");
  assert.equal(formatBytes(10 * 1024 * 1024, { locale: "zh-CN" }), "10 MB");
});

test("formatDuration uses compact localized numbers", () => {
  assert.equal(formatDuration(0, { locale: "zh-CN" }), "0 ms");
  assert.equal(formatDuration(999, { locale: "en-US" }), "999 ms");
  assert.equal(formatDuration(1500, { locale: "en-US" }), "1.5 s");
  assert.equal(formatDuration(120000, { locale: "zh-CN" }), "2.0 min");
});

test("currency and number formatting are stable for invalid and small values", () => {
  assert.equal(formatMoney(0.123456, { locale: "en-US" }), "$0.1235");
  assert.equal(formatMoney(12, { locale: "zh-CN" }), "$12.00");
  assert.equal(formatMoney(Number.NaN, { locale: "en-US" }), "$0.0000");
  assert.equal(formatCurrency(12, { locale: "en-US", currency: "CNY", currencyDisplay: "symbol" }), "CN¥12.00");
  assert.equal(formatCurrency(12, { locale: "zh-CN", currency: "CNY", currencyDisplay: "symbol" }), "¥12.00");
  assert.equal(formatNumber(Number.NaN, { locale: "en-US" }), "0");
});

test("formatTimestamp is deterministic for explicit UTC zh/en preferences", () => {
  const value = "2025-01-02T03:04:05Z";
  assert.equal(formatTimestamp(value, { locale: "zh-CN", timezone: "UTC" }), "2025/01/02 03:04:05");
  assert.equal(formatTimestamp(value, { locale: "en-US", timezone: "UTC" }), "01/02/2025, 03:04:05");
});

test("formatTimestamp supports compact time-only message labels", () => {
  const value = "2025-01-02T03:04:05Z";
  assert.equal(formatTimestamp(value, { locale: "zh-CN", timezone: "UTC", timeOnly: true }), "03:04");
  assert.equal(formatTimestamp(value, { locale: "en-US", timezone: "UTC", timeOnly: true }), "03:04");
});

test("formatTimestamp uses explicit fallbacks for missing and invalid dates", () => {
  assert.equal(formatTimestamp(""), "暂无");
  assert.equal(formatTimestamp("not-a-date"), "无效日期");
  assert.equal(formatTimestamp("", { locale: "en" }), "N/A");
  assert.equal(formatTimestamp("not-a-date", { locale: "en" }), "Invalid date");
  assert.equal(formatTimestamp("not-a-date", { invalidFallback: "invalid" }), "invalid");
  assert.equal(formatTimestamp("not-a-date", { fallback: "fallback" }), "fallback");
  assert.doesNotThrow(() => formatTimestamp("2025-01-02T03:04:05Z", {
    locale: "en-US",
    timezone: "Mars/Olympus",
  }));
});
