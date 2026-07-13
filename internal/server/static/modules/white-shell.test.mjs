import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appearancePrefsKey,
  appearanceStyleVersion,
  defaultAppearancePrefs,
  localPreferenceBackupKind,
} from "./preferences-data.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";

const staticRoot = new URL("../", import.meta.url);
const indexURL = new URL("index.html", staticRoot);
const appMainURL = new URL("modules/app-main.mjs", staticRoot);

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

test("white shell adds the global rail before the conversation sidebar with the expected targets", async () => {
  const [html, appMain] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appMainURL, "utf8"),
  ]);

  assert.ok(html.indexOf('class="global-rail"') < html.indexOf('class="sidebar"'));
  const buttons = [...html.matchAll(/<button class="global-rail-button[^\"]*"[^>]*data-global-rail-target="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => ({
      target: match[1],
      label: match[2].match(/class="global-rail-label">([^<]+)</)?.[1],
      markup: match[0],
    }));
  assert.deepEqual(buttons.map(({ target, label }) => ({ target, label })), [
    { target: "conversation", label: "对话" },
    { target: "skills", label: "技能" },
    { target: "runtime", label: "监控" },
    { target: "im-gateway", label: "家电" },
    { target: "agents", label: "员工" },
    { target: "profile", label: "设置" },
  ]);
  assert.match(buttons[0].markup, /class="global-rail-button active"/);
  assert.match(buttons[0].markup, /aria-pressed="true"/);
  assert.match(appMain, /querySelectorAll\("\[data-global-rail-target\]"\)/);
  assert.match(appMain, /activateGlobalRailTarget\(node\.dataset\.globalRailTarget\)/);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "white shell must not introduce duplicate IDs");
});

test("conversation sidebar keeps navigation content and moves its existing actions into the title bar", async () => {
  const html = await readFile(indexURL, "utf8");
  const header = html.slice(html.indexOf('<header class="session-sidebar-header">'), html.indexOf("</header>", html.indexOf('<header class="session-sidebar-header">')));

  assert.match(header, /session-sidebar-title">会话</);
  for (const id of ["projectSearchToggleBtn", "newProjectBtn", "refreshBtn"]) {
    assert.match(header, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="nav-stack"/);
  for (const value of ["all", "projects", "conversations"]) {
    assert.match(html, new RegExp(`data-navigation-mode="${value}"`));
  }
  assert.match(html, /id="recentSidebarConversations"/);
  assert.match(html, /id="recentSidebarDirectories"/);
});

test("composer toolbar precedes the input row while preserving all event IDs", async () => {
  const html = await readFile(indexURL, "utf8");
  const formStart = html.indexOf('<form id="messageForm"');
  const formEnd = html.indexOf("</form>", formStart);
  const composer = html.slice(formStart, formEnd);

  const toolbarIndex = composer.indexOf('class="composer-toolbar"');
  const inputIndex = composer.indexOf('id="composerInputShell"');
  assert.ok(toolbarIndex >= 0 && toolbarIndex < inputIndex);
  assert.ok(composer.indexOf('id="modelSelect"') < inputIndex);
  assert.ok(composer.indexOf('id="permissionMode"') < inputIndex);
  assert.ok(composer.indexOf('id="messageText"') > toolbarIndex);
  assert.ok(composer.indexOf('id="sendMessageBtn"') > toolbarIndex);
});

test("initial shell and default appearance use the versioned light theme", async () => {
  const html = await readFile(indexURL, "utf8");

  assert.match(html, /<body class="theme-light white-shell ui-density-comfortable">/);
  assert.match(html, /styles\.css\?v=white-shell-2/);
  assert.match(html, /app\.js\?v=white-shell-2/);
  assert.equal(defaultAppearancePrefs.theme, "light");
  assert.equal(defaultAppearancePrefs.styleVersion, appearanceStyleVersion);
  assert.equal(appearanceStyleVersion, 2);
});

test("unversioned dark appearance migrates once to light and explicit versioned dark remains valid", () => {
  const storage = new MemoryStorage([[appearancePrefsKey, JSON.stringify({
    theme: "dark",
    density: "compact",
    terminalDefaultOpen: true,
    showEventLog: false,
  })]]);

  withBrowserStorage(storage, () => {
    const controller = createController({ activeSettingsPanel: "" });
    const migrated = controller.loadAppearancePreferences();
    assert.deepEqual(migrated, {
      styleVersion: 2,
      theme: "light",
      density: "compact",
      terminalDefaultOpen: true,
      showEventLog: false,
    });
    assert.deepEqual(JSON.parse(storage.getItem(appearancePrefsKey)), migrated);

    controller.saveAppearancePreferences({ ...migrated, theme: "dark" });
    assert.equal(JSON.parse(storage.getItem(appearancePrefsKey)).theme, "dark");
    assert.equal(JSON.parse(storage.getItem(appearancePrefsKey)).styleVersion, 2);
  });
});

test("appearance backup import and export normalize the new schema without rejecting old backups", () => {
  const storage = new MemoryStorage();

  withBrowserStorage(storage, () => {
    const controller = createController({ settings: { version: "test" } });
    const imported = controller.restoreLocalPreferencesBackup(JSON.stringify({
      kind: localPreferenceBackupKind,
      version: 1,
      preferences: {
        [appearancePrefsKey]: { theme: "dark", density: "comfortable" },
      },
    }));

    assert.equal(imported, 1);
    assert.deepEqual(JSON.parse(storage.getItem(appearancePrefsKey)), {
      styleVersion: 2,
      theme: "light",
      density: "comfortable",
      terminalDefaultOpen: false,
      showEventLog: true,
    });
    assert.deepEqual(controller.createLocalPreferencesBackup().preferences[appearancePrefsKey], {
      styleVersion: 2,
      theme: "light",
      density: "comfortable",
      terminalDefaultOpen: false,
      showEventLog: true,
    });
  });
});
