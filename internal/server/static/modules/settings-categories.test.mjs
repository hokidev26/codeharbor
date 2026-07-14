import test from "node:test";
import assert from "node:assert/strict";

import {
  firstSettingsItemForCategory,
  legacySettingsCategories,
  settingsCategoryForItem,
} from "./settings-categories.mjs";
import { t } from "./i18n.mjs";
import { settingsItems, skillTabs } from "./settings-data.mjs";

test("legacy settings expose the nine horizontal categories in order", () => {
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
  assert.equal(firstSettingsItemForCategory("market"), "skills");
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
