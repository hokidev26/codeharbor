import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsNavigationHelpers } from "./settings-navigation-helpers.mjs";

// Only the pure search-landing decision is exercised here; the surrounding
// helpers need no DOM for it.
function makeHelpers(settingsSearchQuery = "") {
  return createSettingsNavigationHelpers({
    state: { settingsSearchQuery },
    showToast: () => {},
    notifyTerminal: () => {},
    isMobileSettingsViewport: () => false,
    renderMobileSettingsIndex: () => {},
    renderSettingsNav: () => {},
    selectSettingsPanel: () => {},
  });
}

const sections = (...groups) => groups.map((items, index) => ({
  key: `group-${index}`,
  items: items.map((key) => ({ key })),
}));

test("a panel that still matches the search keeps focus", () => {
  const { nextFilteredSettingsKey } = makeHelpers();
  // Typing must not yank the reader off the panel they are reading whenever it
  // is still in the filtered list.
  assert.equal(nextFilteredSettingsKey("providers", sections(["skills", "providers"], ["about"])), "providers");
  assert.equal(nextFilteredSettingsKey("about", sections(["skills"], ["about"])), "about");
});

test("a panel filtered out moves to the first remaining item", () => {
  const { nextFilteredSettingsKey } = makeHelpers();
  assert.equal(nextFilteredSettingsKey("providers", sections(["skills", "storage"])), "skills");
  assert.equal(nextFilteredSettingsKey("providers", sections(["about", "usage"], ["skills"])), "about");
});

test("filtered sections never contain an empty group, which is what makes first-item selection correct", () => {
  // nextFilteredSettingsKey reaches for sections[0].items[0]. That is only the
  // first *visible* item because grouping drops categories whose items all
  // filtered out. If that ever stopped holding, an empty leading category would
  // silently strand the user on a hidden panel.
  const { filteredSettingsSections } = makeHelpers("s");
  const groups = filteredSettingsSections();
  assert.ok(groups.length > 0, "the probe query should match something");
  for (const group of groups) {
    assert.ok(group.items.length > 0, `category ${group.key} must not be present while empty`);
  }
});

test("a search matching nothing keeps the current panel instead of blanking the pane", () => {
  const { nextFilteredSettingsKey } = makeHelpers();
  // Mid-typing a query routinely matches nothing; the detail pane must not go
  // empty and strand the user with no selection.
  assert.equal(nextFilteredSettingsKey("providers", []), "providers");
  assert.equal(nextFilteredSettingsKey("providers", sections([])), "providers");
  assert.equal(nextFilteredSettingsKey("providers", sections([], [])), "providers");
});

test("the landing key is always one the user can actually see, or the unchanged current one", () => {
  const { nextFilteredSettingsKey } = makeHelpers();
  const cases = [
    { active: "providers", groups: sections(["skills", "providers"]) },
    { active: "providers", groups: sections(["skills"]) },
    { active: "providers", groups: [] },
  ];
  for (const { active, groups } of cases) {
    const next = nextFilteredSettingsKey(active, groups);
    const visible = groups.flatMap((section) => section.items.map((item) => item.key));
    assert.ok(visible.includes(next) || next === active, `${next} must be visible or the unchanged active key`);
  }
});
