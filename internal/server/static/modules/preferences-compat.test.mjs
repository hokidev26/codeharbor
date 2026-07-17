import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appearancePrefsKey,
  appearanceStyleVersion,
  appearanceThemePresets,
  defaultAppearancePrefs,
  defaultPrimaryModePreference,
  defaultRegionalPrefs,
  defaultSearchPrefs,
  legacyLocalPreferenceBackupKind,
  localPreferenceBackupKind,
  normalizeImportedRegionalPreferences,
  normalizePrimaryModePreference,
  normalizeRegionalPreferences,
  primaryModePrefsKey,
  profilePrefsKey,
  regionalPrefsKey,
} from "./preferences-data.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";
import { createLocalPreferencesSettingsController } from "./local-preferences-settings.mjs";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function withBrowserStorage(storage, callback) {
  const body = {
    dataset: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) {
        return this.values.has(name);
      },
    },
  };
  const restoreStorage = replaceGlobal("localStorage", storage);
  const restoreDocument = replaceGlobal("document", {
    title: "",
    body,
    getElementById() {
      return null;
    },
  });
  try {
    return callback(body);
  } finally {
    restoreDocument();
    restoreStorage();
  }
}

function createController(state = {}, options = {}) {
  return createSettingsPreferencesController({
    state,
    ...options,
    loadChatDrafts: () => ({}),
    loadPromptHistory: () => [],
    loadTerminalPreferences: () => ({}),
    normalizeChatDrafts: (value) => value,
    normalizePromptHistory: (value) => value,
    normalizeRecentDirectories: (value) => value,
    normalizeTerminalPreferences: (value) => value,
    relayProtocolSpec: (key) => ({ key: key || "completions" }),
  });
}

test("settings lazily migrates legacy CodeHarbor preferences without deleting them", () => {
  const legacyKey = "codeharbor.profile";
  const legacyValue = JSON.stringify({ displayName: "Legacy user" });
  const storage = new MemoryStorage([[legacyKey, legacyValue]]);

  withBrowserStorage(storage, () => {
    const profile = createController().loadProfilePreferences();

    assert.equal(profile.displayName, "Legacy user");
    assert.equal(profile.avatarInitials, "AT");
    assert.equal(storage.getItem(profilePrefsKey), legacyValue);
    assert.equal(storage.getItem(legacyKey), legacyValue);
  });
});

test("canonical Autoto preference takes priority over its legacy value", () => {
  const legacyKey = "codeharbor.profile";
  const canonicalValue = JSON.stringify({ displayName: "Autoto user" });
  const legacyValue = JSON.stringify({ displayName: "Legacy user" });
  const storage = new MemoryStorage([
    [profilePrefsKey, canonicalValue],
    [legacyKey, legacyValue],
  ]);

  withBrowserStorage(storage, () => {
    const profile = createController().loadProfilePreferences();

    assert.equal(profile.displayName, "Autoto user");
    assert.equal(storage.getItem(profilePrefsKey), canonicalValue);
    assert.equal(storage.getItem(legacyKey), legacyValue);
  });
});

test("primary mode migrates from the legacy CodeHarbor key", () => {
  const legacyKey = "codeharbor.ui.primaryMode";
  const storage = new MemoryStorage([[legacyKey, "workbench"]]);

  withBrowserStorage(storage, () => {
    const controller = createController();

    assert.equal(controller.loadPrimaryModePreference(), "workbench");
    assert.equal(controller.currentPrimaryModePreference(), "workbench");
    assert.equal(storage.getItem(primaryModePrefsKey), "workbench");
    assert.equal(storage.getItem(legacyKey), "workbench");
  });
});

test("primary mode backup normalizes invalid stored values", () => {
  const storage = new MemoryStorage([[primaryModePrefsKey, "kanban"]]);

  withBrowserStorage(storage, () => {
    const backup = createController().createLocalPreferencesBackup();

    assert.equal(backup.preferences[primaryModePrefsKey], defaultPrimaryModePreference);
  });
});

test("backup export uses Autoto format and import accepts legacy CodeHarbor format", () => {
  const storage = new MemoryStorage();

  withBrowserStorage(storage, () => {
    const controller = createController({ settings: { version: "1.2.3" } });
    const imported = controller.restoreLocalPreferencesBackup(JSON.stringify({
      kind: legacyLocalPreferenceBackupKind,
      version: 1,
      preferences: {
        "codeharbor.profile": { displayName: "Imported user", avatarInitials: "ch" },
      },
    }));

    assert.equal(imported, 1);
    assert.deepEqual(JSON.parse(storage.getItem(profilePrefsKey)), {
      displayName: "Imported user",
      roleLabel: "Local developer",
      avatarInitials: "CH",
      gitName: "",
      gitEmail: "",
      workspaceLabel: "Autoto Local",
    });

    const backup = controller.createLocalPreferencesBackup();
    assert.equal(backup.kind, localPreferenceBackupKind);
    assert.ok(Object.keys(backup.preferences).every((key) => key.startsWith("autoto.")));
  });
});

test("primary mode import reloads state and reapplies the injected UI callback", () => {
  const storage = new MemoryStorage();
  const appliedModes = [];

  withBrowserStorage(storage, () => {
    const state = {};
    const controller = createController(state, { applyPrimaryMode: (mode) => appliedModes.push(mode) });
    const imported = controller.restoreLocalPreferencesBackup(JSON.stringify({
      kind: legacyLocalPreferenceBackupKind,
      version: 1,
      preferences: {
        "codeharbor.ui.primaryMode": "workbench",
      },
    }));

    assert.equal(imported, 1);
    assert.equal(storage.getItem(primaryModePrefsKey), "workbench");
    assert.equal(state.primaryModePreference, "workbench");
    assert.equal(controller.currentPrimaryModePreference(), "workbench");
    assert.equal(appliedModes.at(-1), "workbench");
  });
});

test("primary mode rejects invalid values as conversation", () => {
  const storage = new MemoryStorage([[primaryModePrefsKey, "kanban"]]);
  const appliedModes = [];

  withBrowserStorage(storage, () => {
    const controller = createController({}, { applyPrimaryMode: (mode) => appliedModes.push(mode) });

    assert.equal(normalizePrimaryModePreference("workbench"), "workbench");
    assert.equal(normalizePrimaryModePreference("CONVERSATION"), defaultPrimaryModePreference);
    assert.equal(controller.loadPrimaryModePreference(), defaultPrimaryModePreference);
    assert.equal(controller.setPrimaryModePreference("invalid"), defaultPrimaryModePreference);
    assert.equal(storage.getItem(primaryModePrefsKey), defaultPrimaryModePreference);
    assert.equal(appliedModes.at(-1), defaultPrimaryModePreference);

    controller.restoreLocalPreferencesBackup(JSON.stringify({
      preferences: { [primaryModePrefsKey]: "invalid" },
    }));
    assert.equal(controller.currentPrimaryModePreference(), defaultPrimaryModePreference);
    assert.equal(storage.getItem(primaryModePrefsKey), defaultPrimaryModePreference);
  });
});

test("regional preferences default to auto and import legacy field names", () => {
  const storage = new MemoryStorage();

  withBrowserStorage(storage, () => {
    const controller = createController({ settings: { version: "1.2.3" } });
    assert.deepEqual(controller.currentRegionalPreferences(), defaultRegionalPrefs);
    assert.deepEqual(normalizeRegionalPreferences({ locale: "invalid", timezone: "Mars/Olympus" }), {
      locale: "auto",
      timezone: "auto",
    });
    assert.deepEqual(normalizeImportedRegionalPreferences({
      regionalPreferences: { language: "zh", timeZone: "Asia/Shanghai" },
    }), {
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    });
    controller.saveRegionalPreferences({ locale: "zh-Hant-HK", timezone: "Asia/Taipei" });
    assert.deepEqual(JSON.parse(storage.getItem(regionalPrefsKey)), {
      locale: "zh-TW",
      timezone: "Asia/Taipei",
    });

    const imported = controller.restoreLocalPreferencesBackup(JSON.stringify({
      kind: legacyLocalPreferenceBackupKind,
      version: 1,
      preferences: {
        "codeharbor.regional": { language: "en", timeZone: "UTC" },
      },
    }));

    assert.equal(imported, 1);
    assert.deepEqual(JSON.parse(storage.getItem(regionalPrefsKey)), {
      locale: "en-US",
      timezone: "UTC",
    });
    assert.deepEqual(controller.currentRegionalPreferences(), {
      locale: "en-US",
      timezone: "UTC",
    });
    assert.deepEqual(controller.createLocalPreferencesBackup().preferences[regionalPrefsKey], {
      locale: "en-US",
      timezone: "UTC",
    });
  });
});

test("appearance presets default to light and migrate version 2 and unversioned preferences", () => {
  assert.equal(appearanceStyleVersion, 3);
  assert.deepEqual(appearanceThemePresets, ["light", "dark", "cyber", "cream", "apple"]);
  assert.deepEqual(defaultAppearancePrefs, {
    styleVersion: 3,
    themePreset: "light",
    theme: "light",
    density: "comfortable",
    terminalDefaultOpen: false,
    showEventLog: true,
  });

  withBrowserStorage(new MemoryStorage([[appearancePrefsKey, JSON.stringify({
    styleVersion: 2,
    theme: "dark",
    density: "compact",
  })]]), () => {
    const appearance = createController().loadAppearancePreferences();
    assert.equal(appearance.themePreset, "dark");
    assert.equal(appearance.theme, "dark");
  });

  withBrowserStorage(new MemoryStorage([[appearancePrefsKey, JSON.stringify({ theme: "dark" })]]), () => {
    const appearance = createController().loadAppearancePreferences();
    assert.equal(appearance.themePreset, "light");
    assert.equal(appearance.theme, "light");
  });
});

test("appearance preset derives the palette, rejects unknown values, and updates body markers", () => {
  withBrowserStorage(new MemoryStorage([[appearancePrefsKey, JSON.stringify({
    styleVersion: 3,
    themePreset: "solar",
    theme: "dark",
  })]]), () => {
    const controller = createController();
    assert.deepEqual(controller.loadAppearancePreferences(), { ...defaultAppearancePrefs });
    assert.deepEqual(JSON.parse(localStorage.getItem(appearancePrefsKey)), { ...defaultAppearancePrefs });
  });

  withBrowserStorage(new MemoryStorage([[appearancePrefsKey, JSON.stringify({
    styleVersion: 3,
    themePreset: "cyber",
    theme: "light",
  })]]), (body) => {
    const controller = createController();
    assert.deepEqual(controller.normalizeAppearancePreferences({ styleVersion: 3, themePreset: "solar", theme: "dark" }), {
      ...defaultAppearancePrefs,
    });

    controller.applyAppearancePreferences();
    assert.equal(controller.currentAppearancePreferences().theme, "dark");
    assert.equal(body.dataset.themePreset, "cyber");
    assert.equal(body.classList.contains("theme-light"), true);
    assert.equal(body.classList.contains("theme-dark"), true);

    controller.setAppearancePreference("themePreset", "cream");
    assert.equal(body.dataset.themePreset, "cream");
    assert.equal(body.classList.contains("theme-dark"), false);
    assert.deepEqual(JSON.parse(localStorage.getItem(appearancePrefsKey)).themePreset, "cream");

    controller.setAppearancePreference("themePreset", "apple");
    assert.equal(body.dataset.themePreset, "apple");
    assert.equal(body.classList.contains("theme-dark"), false);
    assert.equal(JSON.parse(localStorage.getItem(appearancePrefsKey)).themePreset, "apple");
    assert.equal(JSON.parse(localStorage.getItem(appearancePrefsKey)).theme, "light");
  });
});

test("appearance backup retains the normalized theme preset", () => {
  withBrowserStorage(new MemoryStorage(), () => {
    const controller = createController();
    controller.restoreLocalPreferencesBackup(JSON.stringify({
      kind: localPreferenceBackupKind,
      version: 1,
      preferences: {
        [appearancePrefsKey]: { styleVersion: 3, themePreset: "apple", density: "compact" },
      },
    }));

    assert.deepEqual(JSON.parse(localStorage.getItem(appearancePrefsKey)), {
      styleVersion: 3,
      themePreset: "apple",
      theme: "light",
      density: "compact",
      terminalDefaultOpen: false,
      showEventLog: true,
    });
    assert.equal(controller.createLocalPreferencesBackup().preferences[appearancePrefsKey].themePreset, "apple");
  });
});

test("network search settings render one compact strategy form without summary cards", () => {
  const settings = createLocalPreferencesSettingsController({
    currentSearchPreferences: () => ({ ...defaultSearchPrefs, provider: "custom", customEndpoint: "https://search.example.test/api" }),
  });
  const markup = settings.renderNetworkSearchSettingsContent();

  assert.match(markup, /compact-settings-page network-search-page/);
  assert.match(markup, /id="searchSettingsForm" class="compact-settings-section-controls"/);
  assert.match(markup, /compact-settings-switch-list/);
  assert.match(markup, /compact-settings-grid two-column/);
  assert.match(markup, /id="searchCustomEndpoint"/);
  assert.doesNotMatch(markup, /settings-stat-grid|settings-stat-card|settings-hero-card|appearance-choice/);
});

test("appearance settings render a flat compact form with five accessible preset previews", async () => {
  const settings = createLocalPreferencesSettingsController({
    currentAppearancePreferences: () => ({ ...defaultAppearancePrefs, themePreset: "apple" }),
    currentRegionalPreferences: () => ({ locale: "en-US", timezone: "auto" }),
  });
  const markup = settings.renderAppearanceSettingsContent();
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /compact-settings-page appearance-page/);
  assert.match(markup, /compact-settings-section/);
  assert.match(markup, /compact-settings-choice-grid four-column/);
  assert.doesNotMatch(markup, /settings-stat-grid|settings-stat-card|settings-hero-card/);
  assert.match(markup, /role="radiogroup" aria-label=/);
  for (const preset of ["light", "dark", "cyber", "cream", "apple"]) {
    assert.match(markup, new RegExp(`data-appearance-field="themePreset" data-appearance-value="${preset}"`));
    assert.match(markup, new RegExp(`theme-preset-preview-${preset}`));
  }
  assert.match(markup, /theme-preset-preview-apple[\s\S]*?aria-checked="true"|aria-checked="true"[\s\S]*?theme-preset-preview-apple/);
  assert.match(styles, /data-theme-preset="cyber"[\s\S]*?--ws-primary: #a7ff32/);
  assert.match(styles, /data-theme-preset="cream"[\s\S]*?--ws-canvas: #fff9ee/);
  assert.match(styles, /data-theme-preset="apple"[\s\S]*?--ws-primary: #007aff/);
  assert.match(styles, /\.theme-preset-preview-cyber/);
  assert.match(styles, /\.theme-preset-preview-cream/);
  assert.match(styles, /\.theme-preset-preview-apple/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?data-theme-preset="apple"/);
  assert.match(styles, /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?data-theme-preset="apple"/);
  assert.match(styles, /@media \(prefers-contrast: more\), \(forced-colors: active\) \{[\s\S]*?data-theme-preset="apple"/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?#settingsContentBody \.appearance-theme-grid \{ grid-template-columns: 1fr; \}/);
});

test("apple theme cache stamps reach the static entry and updated modules", async () => {
  const [html, app, appMain, i18n, localPreferences, settingsPreferences] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("./app-main.mjs", import.meta.url), "utf8"),
    readFile(new URL("./i18n.mjs", import.meta.url), "utf8"),
    readFile(new URL("./local-preferences-settings.mjs", import.meta.url), "utf8"),
    readFile(new URL("./settings-preferences.mjs", import.meta.url), "utf8"),
  ]);

  assert.equal((html.match(/apple-theme-1/g) || []).length, 2);
  assert.equal((app.match(/apple-theme-1/g) || []).length, 1);
  assert.match(appMain, /local-preferences-settings\.mjs\?v=[^"\n]*apple-theme-1/);
  assert.match(appMain, /settings-preferences\.mjs\?v=apple-theme-1/);
  assert.match(localPreferences, /i18n\.mjs\?v=apple-theme-1/);
  assert.match(localPreferences, /preferences-data\.mjs\?v=apple-theme-1/);
  assert.match(settingsPreferences, /preferences-data\.mjs\?v=apple-theme-1/);
  assert.equal((i18n.match(/messages-(?:en|zh-CN|zh-TW)\.mjs\?v=[^"\n]*apple-theme-1/g) || []).length, 3);
});

test("global theme toggle returns custom presets to the binary themes", async () => {
  const appMain = await readFile(new URL("./app-main.mjs", import.meta.url), "utf8");

  assert.match(appMain, /updateGlobalThemeToggle,/);
  assert.match(appMain, /themePreset === "apple"\s*\? "dark"/);
  assert.match(appMain, /themePreset === "cream"\s*\? "dark"/);
  assert.match(appMain, /themePreset === "cyber"\s*\? "light"/);
  assert.match(appMain, /setAppearancePreference\("themePreset", nextPreset\)/);
});

test("runtime prefers the Autoto token and falls back to the CodeHarbor token", async () => {
  const requests = [];
  const restores = [
    replaceGlobal("location", new URL("https://local.example.test/")),
    replaceGlobal("fetch", async (path, options) => {
      requests.push({ path, options });
      return { ok: true, text: async () => "" };
    }),
  ];
  if (!globalThis.FormData) restores.push(replaceGlobal("FormData", class FormData {}));

  const restoreCanonicalWindow = replaceGlobal("window", {
    AUTOTO_LOCAL_TOKEN: "autoto-token",
    CODEHARBOR_LOCAL_TOKEN: "legacy-token",
  });
  try {
    const canonicalRuntime = await import(new URL("./runtime.mjs?compat=canonical", import.meta.url).href);
    assert.equal(new URL(canonicalRuntime.withLocalToken("/api/status"), "https://local.example.test").searchParams.get("token"), "autoto-token");

    const restoreLegacyWindow = replaceGlobal("window", { CODEHARBOR_LOCAL_TOKEN: "legacy-token" });
    try {
      const legacyRuntime = await import(new URL("./runtime.mjs?compat=legacy", import.meta.url).href);
      assert.equal(new URL(legacyRuntime.withLocalToken("/api/status"), "https://local.example.test").searchParams.get("token"), "legacy-token");
      await legacyRuntime.api("/api/status");
      assert.equal(requests.at(-1).options.headers["X-Autoto-Token"], "legacy-token");
      assert.equal(requests.at(-1).options.headers["X-CodeHarbor-Token"], undefined);
    } finally {
      restoreLegacyWindow();
    }
  } finally {
    restoreCanonicalWindow();
    restores.reverse().forEach((restore) => restore());
  }
});
