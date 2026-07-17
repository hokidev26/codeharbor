import test from "node:test";
import assert from "node:assert/strict";

import automationMessages from "./messages-automation.mjs";
import appMainExtraMessages from "./messages-app-main-extra.mjs";
import chatRenderingExtraMessages, { t as chatRenderingExtraT } from "./messages-chat-rendering-extra.mjs";
import shellExtraMessages from "./messages-shell-extra.mjs";
import skillsMessages from "./messages-skills.mjs";
import {
  applyDocumentLocale,
  currentUILocale,
  flattenMessageKeys,
  messageCatalogs,
  resolveUILocale,
  setUILocale,
  t,
  uiLocales,
} from "./i18n.mjs";

test("all supported UI locales expose the same message keys", () => {
  const expected = flattenMessageKeys(messageCatalogs["zh-CN"]);
  assert.deepEqual(uiLocales, ["zh-TW", "zh-CN", "en"]);
  for (const locale of uiLocales) {
    assert.deepEqual(flattenMessageKeys(messageCatalogs[locale]), expected, locale);
  }
});

test("domain message packs expose matching keys for all locales", () => {
  for (const [name, pack] of Object.entries({ appMainExtra: appMainExtraMessages, automation: automationMessages, chatRenderingExtra: chatRenderingExtraMessages, shellExtra: shellExtraMessages, skills: skillsMessages })) {
    const expected = flattenMessageKeys(pack["zh-CN"]);
    for (const locale of uiLocales) assert.deepEqual(flattenMessageKeys(pack[locale]), expected, `${name}:${locale}`);
  }
});

test("UI locale resolution supports traditional, simplified, English, and safe fallback", () => {
  assert.equal(resolveUILocale("zh-TW"), "zh-TW");
  assert.equal(resolveUILocale("zh-Hant-HK"), "zh-TW");
  assert.equal(resolveUILocale("zh-CN"), "zh-CN");
  assert.equal(resolveUILocale("zh-Hans-SG"), "zh-CN");
  assert.equal(resolveUILocale("en-US"), "en");
  assert.equal(resolveUILocale("fr-FR"), "en");
});

test("translations interpolate values and fall back to keys", () => {
  assert.equal(t("common.itemCount", { count: 3 }, "zh-TW"), "共 3 項");
  assert.equal(t("common.itemCount", { count: 3 }, "en"), "3 items");
  assert.equal(t("memory.noMatches", { query: "demo" }, "en"), "No memories match “demo”.");
  assert.equal(t("mcp.discoveredTools", { count: 3 }, "zh-TW"), "已發現 3 個 MCP 工具。");
  assert.equal(t("missing.translation.key", {}, "en"), "missing.translation.key");
});

test("model provider console exposes aligned nested keys for every locale", () => {
  const expected = flattenMessageKeys(messageCatalogs["zh-CN"].modelProvider.console);
  for (const required of [
    "actions.refreshModels",
    "actions.enableProvider",
    "codex.footer",
    "drawer.configurationDescription",
    "fields.apiKeyEditingPlaceholder",
    "messages.currentDraftTestSucceeded",
    "messages.currentDraftTestNeedsApiKey",
    "messages.currentDraftTestFailed",
    "origins.unknown",
    "relay.title",
  ]) assert.ok(expected.includes(required), required);

  for (const locale of uiLocales) {
    assert.deepEqual(flattenMessageKeys(messageCatalogs[locale].modelProvider.console), expected, locale);
  }
});

test("model provider console interpolates model, count, and failure details", () => {
  assert.equal(
    t("modelProvider.console.fields.finalModelExample", { provider: "openai", model: "gpt-4.1-mini" }, "zh-CN"),
    "最终模型示例：openai:gpt-4.1-mini",
  );
  assert.equal(t("modelProvider.console.messages.modelCount", { count: 3 }, "zh-TW"), "3 個模型");
  assert.equal(
    t("modelProvider.console.messages.mutationRefreshWarning", { message: "offline" }, "en"),
    "The change succeeded, but refreshing the provider list failed: offline",
  );
});

test("chat activity timeline has concise, safe copy in every locale", () => {
  const keys = [
    "processTitle", "processProtected", "input", "output", "noOutput", "localService",
    "details", "diff", "running", "completed", "failed", "searching", "reading",
    "editing", "writing", "runningCommand", "genericStep", "truncated",
  ];

  for (const locale of uiLocales) {
    const activity = chatRenderingExtraMessages[locale].chatRenderingExtra.activity;
    for (const key of keys) assert.equal(typeof activity[key], "string", `${locale}:${key}`);
    assert.ok(activity.processProtected.length > 0, `${locale}:processProtected`);
    assert.equal(chatRenderingExtraT("activity.processTitle", { count: 3 }, locale).includes("3"), true, locale);

    const copy = Object.values(activity).join(" ").toLowerCase();
    assert.doesNotMatch(copy, /chain of thought|思维链已加密/);
  }

  assert.equal(chatRenderingExtraT("activity.input", {}, "fr-FR"), "输入");
});

test("document locale updates lang and data-ui-locale", () => {
  const root = { title: "", documentElement: { lang: "", dataset: {} }, querySelectorAll() { return []; } };
  assert.equal(applyDocumentLocale("zh-TW", root), "zh-TW");
  assert.equal(root.documentElement.lang, "zh-Hant-TW");
  assert.equal(root.documentElement.dataset.uiLocale, "zh-TW");
  assert.equal(root.title, "Autoto");

  setUILocale("en", root);
  assert.equal(currentUILocale(), "en");
  assert.equal(root.documentElement.lang, "en");
});
