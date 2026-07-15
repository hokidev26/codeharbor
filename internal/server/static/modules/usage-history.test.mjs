import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { usageHistoryMessages, usageHistoryMessage } from "./messages-usage-history.mjs";
import {
  appendUsageHistoryItems,
  buildUsageHistoryURL,
  createUsageHistoryController,
  createUsageHistoryState,
  normalizeUsageHistoryResponse,
  renderUsageHistory,
  renderUsageTrendSVG,
  usageHistoryMetrics,
} from "./usage-history.mjs";

function response(overrides = {}) {
  return {
    generatedAt: "2026-03-01T00:00:00Z",
    summary: { requestCount: 1, totalTokens: 30, inputTokens: 10, outputTokens: 20, successRate: 1 },
    trend: [{ bucket: "2026-03-01", requestCount: 1, totalTokens: 30 }],
    options: { providers: ["openai"], models: ["gpt-5"], kinds: ["chat"] },
    items: [{ id: "one", createdAt: "2026-03-01T00:00:00Z", provider: "openai", model: "gpt-5", status: "success" }],
    nextCursor: "",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("usage history URL uses URLSearchParams and preserves supported filters", () => {
  const url = buildUsageHistoryURL({
    filters: { provider: "Open AI & Co", model: "gpt/5?x=1", kind: "chat", from: "2026-01-02", to: "2026-02-03" },
    bucket: "month",
    limit: 99,
    cursor: "next=one&two",
  });
  const parsed = new URL(url, "http://localhost");
  assert.equal(parsed.pathname, "/api/usage/history");
  assert.deepEqual(Object.fromEntries(parsed.searchParams), {
    provider: "Open AI & Co",
    model: "gpt/5?x=1",
    kind: "chat",
    from: "2026-01-02",
    to: "2026-02-03",
    bucket: "month",
    limit: "50",
    cursor: "next=one&two",
  });
  assert.doesNotMatch(url, /Open AI|next=one&two/);
});

test("normalization converts all metrics, arrays, and text to safe bounded values", () => {
  const normalized = normalizeUsageHistoryResponse({
    generatedAt: 123,
    summary: { requestCount: "4", inputTokens: "bad", totalCostUsd: -2, successRate: "0.75" },
    trend: [{ bucket: 9, requestCount: "2", averageTTFTMs: Infinity }],
    options: { providers: ["x", "x", null, ""], models: "bad", kinds: ["chat"] },
    items: [{ id: 8, inputTokens: "5", durationMs: -1, status: null }],
    nextCursor: 44,
  });
  assert.equal(normalized.generatedAt, "123");
  assert.equal(normalized.summary.requestCount, 4);
  assert.equal(normalized.summary.inputTokens, 0);
  assert.equal(normalized.summary.totalCostUsd, 0);
  assert.equal(normalized.summary.successRate, 0.75);
  assert.equal(normalized.trend[0].bucket, "9");
  assert.equal(normalized.trend[0].averageTTFTMs, 0);
  assert.deepEqual(normalized.options.providers, ["x"]);
  assert.deepEqual(normalized.options.models, []);
  assert.equal(normalized.items[0].id, "8");
  assert.equal(normalized.items[0].inputTokens, 5);
  assert.equal(normalized.items[0].durationMs, 0);
  assert.equal(normalized.nextCursor, "44");
});

test("usage history defaults to total tokens", () => {
  assert.equal(createUsageHistoryState().metric, "totalTokens");
  assert.match(renderUsageHistory({ status: "ready" }), /value="totalTokens" selected/);
});

test("selected filters remain visible and missing summary timings render as dashes", () => {
  const html = renderUsageHistory({
    status: "ready",
    filters: { provider: "selected-provider", model: "selected-model", kind: "selected-kind" },
    options: { providers: [], models: [], kinds: [] },
    summary: { averageTTFTMs: 0, averageDurationMs: 0 },
  });
  assert.match(html, /value="selected-provider" selected/);
  assert.match(html, /value="selected-model" selected/);
  assert.match(html, /value="selected-kind" selected/);
  assert.equal((html.match(/<strong>—<\/strong>/g) || []).length >= 2, true);
});

test("inline SVG has grid, axes, line, point titles, compact axis labels, and an empty state", () => {
  const svg = renderUsageTrendSVG([
    { bucket: "2026-01-01", requestCount: 2 },
    { bucket: "2026-01-02", requestCount: 5 },
  ], "requests");
  assert.match(svg, /^<svg/);
  assert.match(svg, /uh-chart-grid/);
  assert.match(svg, /uh-chart-axis/);
  assert.match(svg, /<path class="uh-chart-line"/);
  assert.equal((svg.match(/<circle class="uh-chart-point"/g) || []).length, 2);
  assert.match(svg, /<title>2026-01-02:/);
  const largeAxis = renderUsageTrendSVG([{ bucket: "large", totalTokens: 1250000 }], "totalTokens").split('<line class="uh-chart-axis"')[0];
  assert.doesNotMatch(largeAxis, />1,250,000</);
  assert.match(renderUsageTrendSVG([], "requests"), /uh-chart-empty/);
});

test("render escapes malicious server fields in cards, SVG, filters, and table", () => {
  const attack = '\"><img src=x onerror="boom">';
  const html = renderUsageHistory({
    status: "ready",
    generatedAt: attack,
    summary: {},
    metric: "requests",
    trend: [{ bucket: `<script>alert(1)</script>`, requestCount: 1 }],
    options: { providers: [attack], models: [attack], kinds: [attack] },
    filters: { provider: attack, model: attack, kind: attack },
    items: [{ id: attack, createdAt: attack, agentId: attack, agentTitle: attack, kind: attack, provider: attack, model: attack, errorMessage: `<svg onload=boom>`, status: attack }],
  });
  assert.doesNotMatch(html, /<script>|<img src=x|<svg onload/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.match(html, /&lt;svg onload=boom&gt;/);
  assert.doesNotMatch(html, /credential|raw dump/i);
});

test("summary uses compact primary counts with precise subtitles", () => {
  const html = renderUsageHistory({
    status: "ready",
    summary: { requestCount: 1250000, totalTokens: 2500000, inputTokens: 1000000, outputTokens: 1500000, reasoningTokens: 800000, cachedInputTokens: 700000, errors: 12000 },
  });
  assert.match(html, /精确值 1,250,000/);
  assert.match(html, /输入 1,000,000 · 输出 1,500,000/);
  assert.doesNotMatch(html, /<strong>1,250,000<\/strong>/);
  assert.doesNotMatch(html, /<strong>2,500,000<\/strong>/);
});

test("request rows localize known statuses and show missing durations as dashes", () => {
  const html = renderUsageHistory({
    status: "ready",
    items: [
      { id: "ok", status: "completed", ttftMs: 0, durationMs: 0 },
      { id: "bad", status: "failed", ttftMs: 25, durationMs: 1000 },
    ],
  });
  assert.match(html, />成功<\/span>/);
  assert.match(html, />错误<\/span>/);
  assert.match(html, /<td>—<\/td>\s*<td>—<\/td>/);
  assert.match(html, /<td>25 ms<\/td>\s*<td>1\.0 s<\/td>/);
});

test("all ten metrics and required three-language keys are present", () => {
  assert.deepEqual(usageHistoryMetrics, [
    "requests", "totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens",
    "averageTTFTMs", "averageDurationMs", "totalCostUsd", "errors",
  ]);
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    assert.ok(usageHistoryMessages[locale].usageHistory.title);
    assert.ok(usageHistoryMessages[locale].usageHistory.filters.apply);
    assert.ok(usageHistoryMessages[locale].usageHistory.history.loadMore);
    assert.ok(usageHistoryMessages[locale].usageHistory.history.statusSuccess);
    assert.ok(usageHistoryMessages[locale].usageHistory.history.statusError);
    assert.ok(usageHistoryMessages[locale].usageHistory.history.statusUnknown);
    assert.notEqual(usageHistoryMessage("usageHistory.trend.metrics.totalCostUsd", {}, locale), "usageHistory.trend.metrics.totalCostUsd");
  }
});

test("render includes explicit empty and error states", () => {
  assert.match(renderUsageHistory({ status: "ready", items: [], trend: [] }), /当前筛选条件下暂无请求记录/);
  const error = renderUsageHistory({ status: "error", error: `<bad>`, items: [], trend: [] });
  assert.match(error, /请求历史加载失败/);
  assert.match(error, /&lt;bad&gt;/);
  assert.doesNotMatch(error, /<bad>/);
});

test("controller ignores stale responses", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const state = {};
  const controller = createUsageHistoryController({
    state,
    request: (url) => {
      calls.push(url);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });
  const older = controller.refresh();
  const newer = controller.refresh();
  second.resolve(response({ generatedAt: "new", items: [{ id: "new" }] }));
  await newer;
  first.resolve(response({ generatedAt: "old", items: [{ id: "old" }] }));
  await older;
  assert.equal(state.usageHistory.generatedAt, "new");
  assert.deepEqual(state.usageHistory.items.map((item) => item.id), ["new"]);
  assert.equal(state.usageHistory.status, "ready");
});

test("controller applies filters, changes bucket with fetch, and metric without fetch", async () => {
  const urls = [];
  const state = {};
  const controller = createUsageHistoryController({ state, request: async (url) => { urls.push(url); return response(); } });
  await controller.applyFilters({ provider: "a&b", model: "m/x", kind: "chat", from: "2026-01-01", to: "2026-01-31" });
  let parsed = new URL(urls.at(-1), "http://localhost");
  assert.equal(parsed.searchParams.get("provider"), "a&b");
  assert.equal(parsed.searchParams.get("model"), "m/x");
  assert.equal(parsed.searchParams.get("from"), "2026-01-01");
  const requestCount = urls.length;
  controller.setMetric("totalTokens");
  assert.equal(urls.length, requestCount);
  assert.equal(state.usageHistory.metric, "totalTokens");
  await controller.setBucket("hour");
  parsed = new URL(urls.at(-1), "http://localhost");
  assert.equal(parsed.searchParams.get("bucket"), "hour");
  assert.equal(urls.length, requestCount + 1);
  await controller.resetFilters();
  parsed = new URL(urls.at(-1), "http://localhost");
  assert.equal(parsed.searchParams.has("provider"), false);
});

test("load more appends and deduplicates request rows", async () => {
  const urls = [];
  const pages = [
    response({ items: [{ id: "one", provider: "a" }], nextCursor: "cursor&2" }),
    response({ items: [{ id: "one", provider: "duplicate" }, { id: "two" }], nextCursor: "" }),
  ];
  const state = {};
  const controller = createUsageHistoryController({ state, request: async (url) => { urls.push(url); return pages.shift(); } });
  await controller.refresh();
  await controller.loadMore();
  assert.deepEqual(state.usageHistory.items.map((item) => item.id), ["one", "two"]);
  const parsed = new URL(urls[1], "http://localhost");
  assert.equal(parsed.searchParams.get("cursor"), "cursor&2");
  assert.equal(state.usageHistory.nextCursor, "");
  assert.deepEqual(appendUsageHistoryItems([{ id: "x" }], [{ id: "x" }, { id: "y" }]).map((item) => item.id), ["x", "y"]);
});

test("static integration uses the new usage controller and leaves metric card reusable", async () => {
  const root = new URL("../", import.meta.url);
  const [appMain, systemSettings, styles] = await Promise.all([
    readFile(new URL("modules/app-main.mjs", root), "utf8"),
    readFile(new URL("modules/system-settings.mjs", root), "utf8"),
    readFile(new URL("styles.css", root), "utf8"),
  ]);
  assert.match(appMain, /createUsageHistoryController/);
  assert.match(appMain, /\["usage", \{ render: usageHistory\.render, bind: usageHistory\.bind \}\]/);
  assert.doesNotMatch(appMain, /loadUsageSummary|usageSummary|usageError|usageSeq/);
  assert.doesNotMatch(systemSettings, /renderUsageSettingsContent|bindUsageSettingsActions|refreshUsageSummaryBtn/);
  assert.match(systemSettings, /function renderUsageMetricCard/);
  const usageMarker = styles.indexOf("/* Usage history request analytics.");
  const providerMarker = styles.lastIndexOf("/* Model provider settings. Scoped after legacy settings overrides by design. */");
  assert.ok(usageMarker >= 0 && usageMarker < providerMarker);
  assert.match(styles.slice(usageMarker, providerMarker), /#settingsContentBody \.usage-history-page/);
  assert.ok(styles.trimEnd().endsWith(styles.slice(providerMarker).trimEnd()));
});
