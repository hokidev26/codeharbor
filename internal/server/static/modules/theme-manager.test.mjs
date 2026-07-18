import test from "node:test";
import assert from "node:assert/strict";

import {
  createThemeManager,
  normalizeThemeCatalog,
  setThemePageContext,
} from "./theme-manager.mjs";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

function fakeDocument({ fail = new Set() } = {}) {
  const children = [];
  const body = { dataset: {}, classList: new FakeClassList() };
  const documentRef = {
    body,
    head: {
      appendChild(node) {
        children.push(node);
        queueMicrotask(() => {
          if (fail.has(node.href)) node.onerror?.(new Error("failed"));
          else node.onload?.();
        });
      },
    },
    createElement(tag) {
      assert.equal(tag, "link");
      return {
        dataset: {},
        id: "",
        rel: "",
        href: "",
        remove() {
          const index = children.indexOf(this);
          if (index >= 0) children.splice(index, 1);
        },
      };
    },
    getElementById(id) {
      return children.find((node) => node.id === id) || null;
    },
  };
  return { documentRef, body, children };
}

const catalog = {
  themes: [{
    id: "argentina-spain-final",
    name: "Argentina × Spain Final",
    version: "1.0.0",
    description: "Original Autoto theme",
    author: "Autoto",
    colorScheme: "dark",
    source: "bundled",
    revision: "rev-1",
    stylesheetUrl: "/themes/argentina-spain-final/rev-1/theme.css",
    previewUrl: "/themes/argentina-spain-final/rev-1/preview.png",
    deletable: false,
  }],
};

test("theme catalog accepts only scoped same-origin theme resources", () => {
  const themes = normalizeThemeCatalog({ themes: [
    ...catalog.themes,
    { ...catalog.themes[0], id: "other", stylesheetUrl: "https://example.test/theme.css" },
    { ...catalog.themes[0], id: "Bad ID" },
    { ...catalog.themes[0], id: "bad_id", stylesheetUrl: "/themes/bad_id/rev/theme.css" },
    { ...catalog.themes[0], id: "bad--id", stylesheetUrl: "/themes/bad--id/rev/theme.css" },
  ] });
  assert.equal(themes.length, 1);
  assert.equal(themes[0].id, "argentina-spain-final");
  assert.equal(themes[0].source, "bundled");
});

test("theme manager loads a package stylesheet before persisting it", async () => {
  const { documentRef, body } = fakeDocument();
  const manager = createThemeManager({
    api: async () => catalog,
    documentRef,
    windowRef: globalThis,
  });
  let prefs = {
    themeRef: { kind: "preset", id: "light" },
    themePreset: "light",
    theme: "light",
  };
  manager.setPreferenceAdapter({
    currentAppearancePreferences: () => prefs,
    saveAppearancePreferences(next) {
      prefs = next;
    },
  });

  await manager.loadCatalog();
  await manager.activateTheme("argentina-spain-final");

  assert.equal(body.dataset.autotoTheme, "argentina-spain-final");
  assert.equal(body.dataset.themeRevision, "rev-1");
  assert.equal(body.classList.contains("theme-dark"), true);
  assert.deepEqual(prefs.themeRef, {
    kind: "package",
    id: "argentina-spain-final",
    revision: "rev-1",
    colorScheme: "dark",
  });
});

test("missing package preference falls back without overwriting the desired reference", async () => {
  const { documentRef, body } = fakeDocument();
  const manager = createThemeManager({ api: async () => catalog, documentRef, windowRef: globalThis });
  const prefs = {
    themeRef: { kind: "package", id: "missing-theme", revision: "old", colorScheme: "dark" },
    themePreset: "light",
    theme: "dark",
  };

  await manager.loadCatalog();
  const applied = await manager.applyPreference(prefs, { notifyMissing: false });

  assert.equal(applied, false);
  assert.equal(body.dataset.autotoTheme, undefined);
  assert.equal(body.dataset.themePreset, "light");
  assert.equal(manager.snapshot().missingThemeID, "missing-theme");
  assert.equal(prefs.themeRef.id, "missing-theme");
});

test("failed stylesheet keeps the package inactive and applies the base palette", async () => {
  const failingURL = catalog.themes[0].stylesheetUrl;
  const { documentRef, body } = fakeDocument({ fail: new Set([failingURL]) });
  const manager = createThemeManager({ api: async () => catalog, documentRef, windowRef: globalThis });
  await manager.loadCatalog();

  const applied = await manager.applyPreference({
    themeRef: { kind: "package", id: "argentina-spain-final", revision: "rev-1", colorScheme: "dark" },
    themePreset: "light",
  }, { notifyMissing: false });

  assert.equal(applied, false);
  assert.equal(body.dataset.autotoTheme, undefined);
  assert.equal(body.classList.contains("theme-dark"), false);
});

test("switching back to a preset cancels an in-flight package activation", async () => {
  const { documentRef, body, children } = fakeDocument();
  const pending = [];
  documentRef.head.appendChild = (node) => {
    children.push(node);
    pending.push(node);
  };
  const manager = createThemeManager({ api: async () => catalog, documentRef, windowRef: globalThis });
  let prefs = {
    themeRef: { kind: "preset", id: "light" },
    themePreset: "light",
    theme: "light",
  };
  manager.setPreferenceAdapter({
    currentAppearancePreferences: () => prefs,
    saveAppearancePreferences(next) {
      prefs = next;
    },
  });
  await manager.loadCatalog();

  const activation = manager.activateTheme("argentina-spain-final");
  assert.equal(pending.length, 1);
  manager.applyPresetFallback("light");
  pending[0].onload?.();

  assert.equal(await activation, null);
  assert.equal(body.dataset.autotoTheme, undefined);
  assert.deepEqual(prefs.themeRef, { kind: "preset", id: "light" });
});

test("theme page context is explicit and removable", () => {
  const { documentRef, body } = fakeDocument();
  setThemePageContext("home-empty", documentRef);
  assert.equal(body.dataset.themePage, "home-empty");
  setThemePageContext("", documentRef);
  assert.equal(body.dataset.themePage, undefined);
});
