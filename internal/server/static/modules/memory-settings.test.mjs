import test from "node:test";
import assert from "node:assert/strict";

import { setUILocale } from "./i18n.mjs";
import {
  createMemorySettingsController,
  normalizeMemoryPayload,
  parseMemoryKeywords,
  renderMemoryItem,
  renderMemorySettingsContent,
} from "./memory-settings.mjs";

test("parseMemoryKeywords supports comma and newline separators with stable deduplication", () => {
  assert.deepEqual(
    parseMemoryKeywords(" project, pnpm\nproject\r\n TypeScript , ,pnpm "),
    ["project", "pnpm", "TypeScript"],
  );
  assert.deepEqual(parseMemoryKeywords(["alpha,beta", " beta ", "gamma\ndelta"]), ["alpha", "beta", "gamma", "delta"]);
});

test("memory rendering escapes content, keywords, ids, queries, and errors", () => {
  const malicious = '"><img src=x onerror="boom">';
  const html = renderMemorySettingsContent({
    error: `<script>alert("error")</script>`,
    query: malicious,
    items: [{
      id: malicious,
      content: `<script>alert("content")</script>`,
      keywords: [`<img src=x onerror="keyword">`],
      pinned: true,
    }],
  });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;content&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;keyword&quot;&gt;/);
  assert.match(html, /value="&quot;&gt;&lt;img src=x onerror=&quot;boom&quot;&gt;"/);
  assert.match(html, /settings-page-section/);
  assert.match(html, /settings-stat-grid/);
  assert.match(html, /settings-data-list/);
});

test("memory settings render translated UI text while preserving escaped user content", () => {
  setUILocale("en");
  try {
    const html = renderMemorySettingsContent({
      query: '"<unsafe>',
      items: [{ id: "memory-1", content: "<custom memory>", keywords: ["project"], pinned: true }],
    });
    assert.match(html, /Long-term memory/);
    assert.match(html, />Pinned</);
    assert.match(html, /&lt;custom memory&gt;/);
    assert.match(html, /value="&quot;&lt;unsafe&gt;"/);
  } finally {
    setUILocale("zh-CN");
  }
});

test("controller drops stale memory list responses", async () => {
  const pending = new Map();
  const request = (path) => new Promise((resolve) => {
    const query = new URL(path, "http://localhost").searchParams.get("q");
    pending.set(query, resolve);
  });
  const controller = createMemorySettingsController({ request });

  const older = controller.load({ query: "older" });
  const newer = controller.load({ query: "newer", includeArchived: true });
  pending.get("newer")([{ id: "new", content: "new response", keywords: ["new"] }]);
  assert.equal(await newer, true);
  pending.get("older")([{ id: "old", content: "stale response", keywords: ["old"] }]);
  assert.equal(await older, false);

  const state = controller.getState();
  assert.equal(state.query, "newer");
  assert.equal(state.includeArchived, true);
  assert.deepEqual(state.items.map((item) => item.id), ["new"]);
  assert.equal(state.loading, false);
});

test("normalizeMemoryPayload trims content, parses keywords, and includes only supported fields", () => {
  assert.deepEqual(normalizeMemoryPayload({
    content: "  remember this  ",
    keywords: "alpha, beta\nalpha",
    pinned: 1,
    archived: true,
    ignored: "nope",
  }), {
    content: "remember this",
    keywords: ["alpha", "beta"],
    pinned: true,
  });

  assert.deepEqual(normalizeMemoryPayload({
    keywords: [" one ", "two,three"],
    archived: 1,
  }, { partial: true }), {
    keywords: ["one", "two", "three"],
    archived: true,
  });
});

test("archived and pinned memories render their status and inverse actions", () => {
  const html = renderMemoryItem({
    id: "memory-1",
    content: "Pinned archived memory",
    keywords: ["project"],
    pinned: true,
    archivedAt: "2026-07-13T00:00:00Z",
  });

  assert.match(html, />已置顶</);
  assert.match(html, />已归档</);
  assert.match(html, />取消置顶</);
  assert.match(html, />恢复</);
  assert.doesNotMatch(html, />归档</);
});

test("controller sends normalized create and patch payloads", async () => {
  const calls = [];
  const controller = createMemorySettingsController({
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (options.method) return {};
      return [];
    },
    confirmDelete: () => true,
  });

  assert.equal(await controller.create({ content: "  body  ", keywords: "a, b\na", pinned: "yes" }), true);
  assert.equal(await controller.update("a/b", { keywords: "x\ny", archived: 1 }), true);

  assert.deepEqual(JSON.parse(calls[0].options.body), { content: "body", keywords: ["a", "b"], pinned: true });
  assert.equal(calls[2].path, "/api/memories/a%2Fb");
  assert.deepEqual(JSON.parse(calls[2].options.body), { keywords: ["x", "y"], archived: true });
});
