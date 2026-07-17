import test from "node:test";
import assert from "node:assert/strict";

import {
  firstSettingsItemForCategory,
  groupSettingsItemsByLegacyCategory,
  legacySettingsCategories,
  settingsCategoryForItem,
} from "./settings-categories.mjs";
import { t } from "./i18n.mjs";
import { settingsItemByKey, settingsItems, skillTabs } from "./settings-data.mjs";

test("legacy settings expose the nine category shortcuts in order", () => {
  assert.deepEqual(legacySettingsCategories.map((category) => category.label), [
    "API 设置",
    "聊天平台",
    "记忆",
    "诊断",
    "网络代理",
    "权限",
    "市场",
    "日志",
    "关于",
  ]);
});

test("every existing settings page remains reachable from a legacy category", () => {
  const mapped = new Set(legacySettingsCategories.flatMap((category) => category.items));
  assert.deepEqual([...new Set(settingsItems.map((item) => item.key).filter((key) => !mapped.has(key)))], []);
  assert.equal(settingsCategoryForItem("runtime"), "diagnostics");
  assert.equal(settingsCategoryForItem("providers"), "api");
  assert.equal(settingsCategoryForItem("shared-api"), "api");
  assert.equal(firstSettingsItemForCategory("market"), "skills");
  assert.equal(settingsItemByKey("providers")?.key, "providers");
  assert.equal(settingsItemByKey("shared-api")?.key, "shared-api");
  assert.equal(settingsItemByKey("users"), null);
  assert.equal(legacySettingsCategories.some((category) => category.items.includes("users")), false);
  assert.equal(settingsItemByKey("missing"), null);
});

test("legacy category grouping preserves page order and filters empty groups", () => {
  const groups = groupSettingsItemsByLegacyCategory(settingsItems);
  assert.deepEqual(groups.map((group) => group.key), legacySettingsCategories.map((group) => group.key));
  assert.deepEqual(groups.find((group) => group.key === "api").items.map((item) => item.key), ["providers", "shared-api", "models", "profile", "appearance"]);

  const modelsOnly = groupSettingsItemsByLegacyCategory(settingsItems, (item) => item.key === "models");
  assert.deepEqual(modelsOnly.map((group) => ({ key: group.key, items: group.items.map((item) => item.key) })), [
    { key: "api", items: ["models"] },
  ]);
});

test("skill tab metadata is sourced from translated messages", () => {
  const mcpTools = skillTabs.find((tab) => tab.key === "mcp-tools");
  assert.deepEqual(mcpTools, {
    key: "mcp-tools",
    label: t("skills.tabs.mcpTools.label"),
    description: t("skills.tabs.mcpTools.description"),
    empty: t("skills.tabs.mcpTools.empty"),
    action: t("skills.tabs.mcpTools.action"),
  });
});
