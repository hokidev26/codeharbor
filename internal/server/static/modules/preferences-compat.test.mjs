import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultRegionalPrefs,
  legacyLocalPreferenceBackupKind,
  localPreferenceBackupKind,
  normalizeImportedRegionalPreferences,
  normalizeRegionalPreferences,
  profilePrefsKey,
  regionalPrefsKey,
} from "./preferences-data.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";

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
  const restoreStorage = replaceGlobal("localStorage", storage);
  const restoreDocument = replaceGlobal("document", {
    title: "",
    body: { classList: { toggle() {} } },
    getElementById() {
      return null;
    },
  });
  try {
    return callback();
  } finally {
    restoreDocument();
    restoreStorage();
  }
}

function createController(state = {}) {
  return createSettingsPreferencesController({
    state,
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
