import test from "node:test";
import assert from "node:assert/strict";

import { formatBytes, formatDuration, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";

test("formatBytes scales and guards invalid values", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(Number.NaN), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
});

test("formatDuration uses compact units", () => {
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(999), "999 ms");
  assert.equal(formatDuration(1500), "1.5 s");
  assert.equal(formatDuration(120000), "2.0 min");
});

test("formatMoney and formatNumber are stable for invalid and small values", () => {
  assert.equal(formatMoney(0.123456), "$0.1235");
  assert.equal(formatMoney(12), "$12.00");
  assert.equal(formatMoney(Number.NaN), "$0.0000");
  assert.equal(formatNumber(Number.NaN), "0");
});

test("formatTimestamp returns fallback for missing or invalid values", () => {
  assert.equal(formatTimestamp(""), "暂无");
  assert.equal(formatTimestamp("not-a-date"), "not-a-date");
});
