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
import { createSystemSettingsController } from "./system-settings.mjs";
import {
  createUIShellController,
  defaultSidebarWidth,
  maxSidebarWidth,
  minSidebarWidth,
  normalizeSidebarWidth,
  orderPermissionMenuOptions,
  permissionMenuPrimaryValues,
  permissionMenuSecondaryValues,
  sidebarWidthFromPointer,
  sidebarWidthPreferenceKey,
} from "./ui-shell.mjs";

const staticRoot = new URL("../", import.meta.url);
const indexURL = new URL("index.html", staticRoot);
const appURL = new URL("app.js", staticRoot);
const appMainURL = new URL("modules/app-main.mjs", staticRoot);
const chatRenderingURL = new URL("modules/chat-rendering.mjs", staticRoot);
const settingsPreferencesURL = new URL("modules/settings-preferences.mjs", staticRoot);
const stylesURL = new URL("styles.css", staticRoot);
const uiShellURL = new URL("modules/ui-shell.mjs", staticRoot);

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
      label: match[2].match(/class="global-rail-label"[^>]*>([^<]+)</)?.[1],
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

test("static entry points share throughput and usage-history cache stamps", async () => {
  const [html, app] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appURL, "utf8"),
  ]);
  assert.equal((html.match(/-fast-mode-1-throughput-1-usage-history-1/g) || []).length, 2);
  assert.equal((app.match(/-fast-mode-1-throughput-1-usage-history-1/g) || []).length, 1);
  assert.doesNotMatch(html, /-throughput-1["']/);
  assert.doesNotMatch(app, /-throughput-1["']/);
});

test("conversation sidebar keeps navigation content and moves its existing actions into the title bar", async () => {
  const html = await readFile(indexURL, "utf8");
  const header = html.slice(html.indexOf('<header class="session-sidebar-header">'), html.indexOf("</header>", html.indexOf('<header class="session-sidebar-header">')));

  assert.match(header, /class="session-sidebar-title"[^>]*>会话</);
  for (const id of ["projectSearchToggleBtn", "newProjectBtn", "refreshBtn"]) {
    assert.match(header, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="nav-stack"/);
  for (const value of ["all", "projects", "conversations"]) {
    assert.match(html, new RegExp(`data-navigation-mode="${value}"`));
  }
  assert.match(html, /id="navigationListHeading"/);
  assert.match(html, /id="recentSidebarConversations"/);
  assert.match(html, /id="recentSidebarDirectories"/);
  assert.match(html, /id="globalThemeToggleBtn"/);
  assert.match(html, /id="globalHealthText"/);
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
  assert.match(composer, /<label class="composer-field-label" for="reasoningEffort" data-i18n="chat\.reasoningEffort">/);
  assert.match(composer, /id="reasoningEffort"[^>]*data-i18n-title="chat\.reasoningEffort"[^>]*data-i18n-aria-label="chat\.reasoningEffort"/);
  assert.match(composer, /id="reasoningEffortDisplay"[^>]*aria-hidden="true"/);
  assert.match(composer, /<label class="composer-field-label" for="modelSelect" data-i18n="chat\.model">/);
  assert.match(composer, /<label class="composer-field-label" for="permissionMode" data-i18n="chat\.permissionMode">/);
  assert.doesNotMatch(composer, /id="saveAgentBtn"/);
  assert.match(composer, /id="messageText"[^>]*class="[^"]*autosize-message-input/);
  assert.match(composer, /id="permissionRiskBadge"/);
  assert.match(composer, /id="sendMessageBtn"[^>]*data-i18n="chat\.send"[^>]*>发送<\/button>/);
});

test("lightning control is a capability-gated Fast mode toggle", async () => {
  const [html, styles, appMain] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(appMainURL, "utf8"),
  ]);
  assert.match(html, /id="openProviderLoginBtn"[^>]*class="[^"]*toolbar-lightning-btn[^"]*hidden[^"]*"[^>]*aria-pressed="false"[^>]*data-i18n-title="chat\.fastModeDisabled"/);
  assert.match(appMain, /openProviderLoginBtn"\)\?\.addEventListener\("click", \(\) => toggleFastMode\(\)\.catch\(showError\)\)/);
  assert.doesNotMatch(appMain, /openProviderLoginBtn"\)\.addEventListener\("click", \(\) => openSettingsModal\("providers"\)\)/);
  assert.match(styles, /\.toolbar-lightning-btn\.fast-mode-active\s*\{[\s\S]*?background:\s*#edf0ff/);
  assert.match(styles, /\.toolbar-lightning-btn\.fast-mode-active svg\s*\{[\s\S]*?fill:\s*currentColor/);
});

test("permission mode display targets only the permission toolbar pill", async () => {
  const appMain = await readFile(appMainURL, "utf8");
  assert.match(appMain, /querySelector\("\.permission-toolbar-pill \.mode-display"\)/);
  assert.doesNotMatch(appMain, /querySelector\("\.mode-display"\)/);
});

test("chat header exposes the legacy six-tool order with real SVG icons", async () => {
  const [html, appMain] = await Promise.all([readFile(indexURL, "utf8"), readFile(appMainURL, "utf8")]);
  const headerStart = html.indexOf('<header class="chat-header">');
  const headerEnd = html.indexOf("</header>", headerStart);
  const header = html.slice(headerStart, headerEnd);
  const expected = [
    "workspaceExplorerBtn",
    "gitWorkflowBtn",
    "specBoardBtn",
    "runtimeStatusBtn",
    "toggleTerminalBtn",
    "workspacePreviewBtn",
  ];
  const positions = expected.map((id) => header.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal((header.match(/<svg viewBox="0 0 24 24"/g) || []).length >= expected.length, true);
  assert.match(appMain, /runtimeStatusBtn[\s\S]*openConversationDetails\(\)/);
  assert.match(html, /id="terminalCommandForm"/);
  assert.match(html, /id="terminalCommandInput"/);
});

test("desktop conversation layout follows the compact resizable geometry", async () => {
  const [html, styles, appMain, chatRendering] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(chatRenderingURL, "utf8"),
  ]);
  assert.match(styles, /grid-template-columns:\s*76px var\(--session-sidebar-width\) minmax\(420px, 1fr\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.sidebar-resize-handle\s*\{[\s\S]*?position:\s*fixed[\s\S]*?left:\s*calc\(68px \+ var\(--session-sidebar-width\) - 3px\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.chat-panel\s*\{[\s\S]*?grid-column:\s*3/);
  assert.match(styles, /body\.white-shell\.theme-light \.terminal-panel\s*\{[\s\S]*?grid-column:\s*4/);
  assert.match(styles, /\.session-sidebar-header\s*\{[\s\S]*?height:\s*62px/);
  assert.match(styles, /body\.white-shell\.theme-light \.composer-wrap\s*\{[\s\S]*?padding:\s*6px 12px 8px/);
  assert.match(styles, /body\.white-shell\.theme-light \.message-input\s*\{[\s\S]*?min-height:\s*40px/);
  assert.match(styles, /body\.white-shell\.theme-light \.composer-send-btn\s*\{[\s\S]*?width:\s*34px/);
  assert.match(styles, /\.sidebar-resize-handle\s*\{[\s\S]*?cursor:\s*col-resize/);
  assert.match(html, /id="sidebarResizeHandle"[^>]*role="separator"[^>]*aria-valuemin="220"[^>]*aria-valuemax="420"/);
  assert.match(appMain, /bindSidebarResizer\(\)/);
  assert.match(styles, /\.sidebar-search-wrap\.hidden\s*\{[\s\S]*?display:\s*block !important/);
  assert.match(chatRendering, /class="empty-conversation-state"/);
});

test("composer selects hide external labels and open titled menus upward", async () => {
  const [html, styles, uiShell] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(uiShellURL, "utf8"),
  ]);
  for (const id of ["modelSelect", "reasoningEffort", "permissionMode"]) {
    assert.match(html, new RegExp(`data-composer-select="${id}"`));
  }
  assert.match(styles, /\.composer-native-select\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(styles, /\.composer-select-popover\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(styles, /\.composer-select-popover-title\s*\{/);
  assert.match(styles, /\.composer-select-popover\.composer-permission-popover\s*\{/);
  assert.match(styles, /\.composer-permission-option-icon svg\s*\{/);
  assert.match(styles, /\.composer-permission-safety-status\s*\{/);
  assert.match(uiShell, /heading\.textContent = binding\.label\?\.textContent/);
  assert.match(uiShell, /menu\.classList\.toggle\("composer-permission-popover", isPermissionMenu\)/);
  assert.match(uiShell, /appendPermissionSafetyStatus\(\)/);
  assert.match(uiShell, /menu\.style\.bottom = `\$\{Math\.max\(8,[\s\S]*?- rect\.top \+ 6\)\}px`/);
  assert.match(uiShell, /binding\.select\.dispatchEvent\(new EventConstructor\("change"/);
});

test("permission menu groups the real modes in figure-two order", () => {
  const options = [
    { value: "readOnly" },
    { value: "acceptEdits" },
    { value: "bypassPermissions" },
    { value: "default" },
    { value: "dontAsk" },
  ];
  assert.deepEqual(permissionMenuPrimaryValues, ["default", "acceptEdits", "bypassPermissions"]);
  assert.deepEqual(permissionMenuSecondaryValues, ["readOnly", "dontAsk"]);
  assert.deepEqual(orderPermissionMenuOptions(options).map((option) => option.value), [
    "default",
    "acceptEdits",
    "bypassPermissions",
    "readOnly",
    "dontAsk",
  ]);
});

test("desktop composer uses the full chat width without centered side gutters", async () => {
  const styles = await readFile(stylesURL, "utf8");
  const marker = "/* Final desktop full-width composer override. */";
  const desktopComposerStyles = styles.slice(styles.indexOf(marker), styles.indexOf("/* Compact mobile composer", styles.indexOf(marker)));
  assert.ok(desktopComposerStyles.startsWith(marker));
  assert.match(desktopComposerStyles, /\[class~="composer-wrap"\][\s\S]*?padding:\s*6px 10px 8px/);
  assert.match(desktopComposerStyles, /\[class~="composer-toolbar"\][\s\S]*?justify-content:\s*flex-end/);
  assert.match(desktopComposerStyles, /\[class~="composer-card"\][\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none[\s\S]*?margin:\s*0/);
  assert.match(desktopComposerStyles, /\[class~="composer-model-field"\][\s\S]*?flex:\s*0 1 300px[\s\S]*?max-width:\s*300px/);
  assert.match(desktopComposerStyles, /\[class~="toolbar-lightning-btn"\],[\s\S]*?\[class~="composer-actions"\][\s\S]*?display:\s*flex/);
  assert.match(desktopComposerStyles, /textarea#messageText[\s\S]*?--composer-input-min-height:\s*40px/);
  assert.match(desktopComposerStyles, /#sendMessageBtn[\s\S]*?width:\s*56px/);
});

test("mobile header and composer use compact icon-first layouts", async () => {
  const [html, styles] = await Promise.all([readFile(indexURL, "utf8"), readFile(stylesURL, "utf8")]);
  const marker = "/* Compact mobile composer: one utility row plus one message row. */";
  const mobileComposerStyles = styles.slice(styles.indexOf(marker), styles.indexOf("/* Model provider settings.", styles.indexOf(marker)));
  assert.ok(mobileComposerStyles.startsWith(marker));
  assert.match(html, /id="mobileTerminalBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="mobileSearchBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="composerFolderBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="composerTerminalBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(mobileComposerStyles, /\[class~="mobile-update-pill"\][\s\S]*?display:\s*none !important/);
  assert.match(mobileComposerStyles, /\[class~="mobile-topbar"\][\s\S]*?height:\s*56px/);
  assert.match(mobileComposerStyles, /\[class~="composer-card"\][\s\S]*?gap:\s*6px[\s\S]*?border:\s*0/);
  assert.match(mobileComposerStyles, /\[class~="composer-model-field"\][\s\S]*?flex:\s*1 1 72px/);
  assert.match(mobileComposerStyles, /\[class~="permission-safety-indicator"\],[\s\S]*?display:\s*none !important/);
  assert.match(mobileComposerStyles, /textarea#messageText[\s\S]*?--composer-input-min-height:\s*44px/);
  assert.match(mobileComposerStyles, /#sendMessageBtn[\s\S]*?width:\s*62px[\s\S]*?height:\s*44px/);
  assert.match(mobileComposerStyles, /\[class~="composer-hints"\][\s\S]*?display:\s*none/);
});

test("sidebar resize width clamps pointer values and keeps a stable preference key", () => {
  assert.equal(sidebarWidthPreferenceKey, "autoto.ui.sessionSidebarWidth");
  assert.equal(normalizeSidebarWidth(undefined), defaultSidebarWidth);
  assert.equal(normalizeSidebarWidth(100), minSidebarWidth);
  assert.equal(normalizeSidebarWidth(900), maxSidebarWidth);
  assert.equal(normalizeSidebarWidth("333.6"), 334);
  assert.equal(sidebarWidthFromPointer(510, 180), 330);
  assert.equal(sidebarWidthFromPointer(120, 180), minSidebarWidth);
});

test("sidebar resizer restores, drags, keys, persists, and cleans up", () => {
  const elementListeners = new Map();
  const windowListeners = new Map();
  const classes = new Set();
  const bodyClasses = new Set();
  const styleValues = new Map();
  const attributes = new Map();
  const storage = new MemoryStorage([[sidebarWidthPreferenceKey, "340"]]);
  const separator = {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    addEventListener(name, handler) { elementListeners.set(name, handler); },
    removeEventListener(name) { elementListeners.delete(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const shell = { style: { setProperty(name, value) { styleValues.set(name, value); } } };
  const sidebar = { getBoundingClientRect() { return { left: 100 }; } };
  const fakeDocument = {
    body: { classList: { add(name) { bodyClasses.add(name); }, remove(name) { bodyClasses.delete(name); } } },
    getElementById(id) { return { appShell: shell, sidebarResizeHandle: separator }[id] || null; },
    querySelector(selector) { return selector === ".sidebar" ? sidebar : null; },
  };
  const fakeWindow = {
    matchMedia() { return { matches: false }; },
    addEventListener(name, handler) { windowListeners.set(name, handler); },
    removeEventListener(name) { windowListeners.delete(name); },
  };
  const restoreDocument = replaceGlobal("document", fakeDocument);
  const restoreWindow = replaceGlobal("window", fakeWindow);
  const restoreRAF = replaceGlobal("requestAnimationFrame", (callback) => callback());
  try {
    const controller = createUIShellController({ state: {}, resizeTerminal() {} });
    const cleanup = controller.bindSidebarResizer({ storage });
    assert.equal(styleValues.get("--session-sidebar-width"), "340px");
    assert.equal(attributes.get("aria-valuenow"), "340");

    let prevented = false;
    elementListeners.get("keydown")({ key: "ArrowRight", shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(styleValues.get("--session-sidebar-width"), "348px");
    assert.equal(storage.getItem(sidebarWidthPreferenceKey), "348");

    elementListeners.get("pointerdown")({ button: 0, pointerId: 1, clientX: 450, preventDefault() {} });
    assert.equal(classes.has("is-dragging"), true);
    assert.equal(bodyClasses.has("sidebar-resizing"), true);
    windowListeners.get("pointermove")({ clientX: 500, preventDefault() {} });
    windowListeners.get("pointerup")({ pointerId: 1 });
    assert.equal(styleValues.get("--session-sidebar-width"), "400px");
    assert.equal(storage.getItem(sidebarWidthPreferenceKey), "400");
    assert.equal(classes.has("is-dragging"), false);

    elementListeners.get("dblclick")();
    assert.equal(styleValues.get("--session-sidebar-width"), `${defaultSidebarWidth}px`);
    cleanup();
    assert.equal(elementListeners.size, 0);
    assert.equal(windowListeners.size, 0);
  } finally {
    restoreRAF();
    restoreWindow();
    restoreDocument();
  }
});

test("legacy chat alignment keeps the composer untouched and flattens the transcript", async () => {
  const [styles, chatRendering] = await Promise.all([readFile(stylesURL, "utf8"), readFile(chatRenderingURL, "utf8")]);
  const marker = "/* Legacy chat transcript alignment. Intentionally excludes every composer/input selector. */";
  const legacyStart = styles.indexOf(marker);
  const legacyEnd = styles.indexOf("/* Codex account management", legacyStart);
  const legacyChatStyles = styles.slice(legacyStart, legacyEnd);

  assert.ok(legacyChatStyles.startsWith(marker));
  assert.match(legacyChatStyles, /\.chat-header\s*\{[\s\S]*?height:\s*64px/);
  assert.match(legacyChatStyles, /\.message\.user,[\s\S]*?background:\s*transparent/);
  assert.match(legacyChatStyles, /\.message\.assistant\s*\{[\s\S]*?margin-right:\s*auto/);
  assert.doesNotMatch(legacyChatStyles, /\.composer-/);
  assert.doesNotMatch(legacyChatStyles, /\.message-input/);
  assert.match(chatRendering, /empty-conversation-state[^\n]*message\.empty/);
});

test("legacy settings, employee overview, details and browser dock are mounted", async () => {
  const [html, appMain] = await Promise.all([readFile(indexURL, "utf8"), readFile(appMainURL, "utf8")]);
  for (const id of [
    "settingsCategoryNav",
    "employeeOverviewModal",
    "employeeOverviewBody",
    "conversationDetailsPanel",
    "conversationDetailsBody",
    "workspacePreviewNavigateForm",
    "workspacePreviewAddress",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="sidebar-footer hidden"/);
  assert.doesNotMatch(html, /id="settingsIdentityBtn"/);
  assert.match(appMain, /openEmployeeOverview\(\)/);
  assert.match(appMain, /renderConversationDetails\(\)/);
  assert.match(appMain, /settingsCategoryForItem/);
  assert.match(appMain, /nav\.closest\("\.legacy-settings-subbar"\)\?\.classList\.remove\("hidden"\)/);
  assert.match(appMain, /classList\.toggle\("about-panel-active", isAboutPanel\)/);
});

test("about settings use the legacy version layout and real update status", () => {
  const state = {
    settings: { version: "0.1.0-dev" },
    updateStatus: null,
    updateError: "",
    licenseSummary: null,
    licenseError: "",
  };
  const controller = createSystemSettingsController({
    state,
    localPreferencesBackupSummary: () => ({ count: 0, bytes: 0, labels: [] }),
  });

  const initial = controller.renderAboutSettingsContent();
  assert.match(initial, /class="legacy-about-logo"/);
  assert.match(initial, /id="legacyAboutProductName">AutoTo</);
  assert.match(initial, /当前版本[\s\S]*0\.1\.0-dev/);
  assert.match(initial, /最新版本[\s\S]*—/);
  assert.match(initial, /更新状态[\s\S]*尚未检查/);
  assert.match(initial, /id="checkForUpdatesBtn"/);
  assert.match(initial, /<details class="legacy-about-more">/);

  state.updateStatus = {
    status: "update_available",
    currentVersion: "1.0.0",
    targetVersion: "1.1.0",
  };
  const available = controller.renderAboutSettingsContent();
  assert.match(available, /当前版本[\s\S]*1\.0\.0/);
  assert.match(available, /最新版本[\s\S]*1\.1\.0/);
  assert.match(available, /发现可用更新/);
});

test("legacy font stack and static shell translations are wired", async () => {
  const [html, styles] = await Promise.all([readFile(indexURL, "utf8"), readFile(stylesURL, "utf8")]);
  assert.match(styles, /--ui-font:\s*-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", sans-serif/);
  assert.match(styles, /font:\s*14px\/1\.45 var\(--ui-font\)/);
  assert.match(styles, /\.legacy-settings-category\s*\{[\s\S]*?font-weight:\s*600/);
  assert.match(styles, /\.legacy-settings-content-head\s*\{[\s\S]*?margin:\s*0 36px/);
  assert.match(styles, /#settingsContentBody \* \{ font-weight:\s*400; \}/);
  assert.match(styles, /\.legacy-settings-content-head \{ display:\s*none; \}/);
  assert.match(styles, /\.legacy-settings-content-body \.settings-provider-section,[\s\S]*?border-radius:\s*0/);
  assert.match(styles, /\.legacy-settings-content-body \.settings-action-btn \{[\s\S]*?border-radius:\s*7px/);
  assert.match(styles, /\.legacy-settings-content \{[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.match(styles, /\.legacy-settings-content-body \{[\s\S]*?width:\s*auto;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*24px 24px 56px 36px;[\s\S]*?overflow:\s*visible\s*!important/);
  assert.match(styles, /\.legacy-settings-content-body \.skills-tabs \{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(html, /data-i18n="shell\.nav\.conversation"/);
  assert.match(html, /data-i18n-placeholder="chat\.messagePlaceholder"/);
  assert.match(html, /data-i18n-aria-label="settings\.categories"/);
});

test("static shell controls localize without marking runtime-owned content", async () => {
  const html = await readFile(indexURL, "utf8");
  const tag = (id) => html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] || "";

  for (const [id, marker] of [
    ["workspaceExplorerBtn", 'data-i18n-aria-label="chat.openWorkspace"'],
    ["gitWorkflowBtn", 'data-i18n-aria-label="chat.gitChanges"'],
    ["specBoardBtn", 'data-i18n-aria-label="chat.taskList"'],
    ["runtimeStatusBtn", 'data-i18n-aria-label="chat.conversationDetails"'],
    ["composerFolderBtn", 'data-i18n-title="chat.switchDirectory"'],
    ["composerTerminalBtn", 'data-i18n-aria-label="chat.toggleTerminal"'],
    ["reconnectTerminalBtn", 'data-i18n="common.reconnect"'],
    ["conversationDetailsPanel", 'data-i18n-aria-label="staticExtra.workspace.main.conversationDetails"'],
    ["backendsModalTitle", 'data-i18n="staticExtra.backend.modalTitle"'],
    ["closeGitModalBtn", 'data-i18n-aria-label="staticExtra.workspace.git.closeModal"'],
    ["workspaceModalTitle", 'data-i18n="staticExtra.workspace.explorer.modalTitle"'],
    ["workspacePreviewAddress", 'data-i18n-placeholder="staticExtra.workspace.explorer.addressPlaceholder"'],
    ["closeSpecBoardBtn", 'data-i18n-aria-label="staticExtra.workspace.spec.close"'],
  ]) assert.match(tag(id), new RegExp(marker));

  assert.match(html, /class="legacy-workbench-title" data-i18n="staticExtra\.workspace\.main\.employeeOverviewTitle"/);
  assert.match(html, /<span data-i18n="backend\.nameLabel">名称<\/span>/);
  assert.match(html, /<span data-i18n="staticExtra\.workspace\.explorer\.optionalPort">端口（可选）<\/span>/);
  assert.doesNotMatch(tag("terminalCommandInput"), /data-i18n-placeholder/, "terminal input placeholder is runtime-owned");
  for (const id of ["currentTitle", "currentMeta", "directoryStatus", "workspaceEditorPath", "workspacePreviewStatus", "workspacePreviewLogs"]) {
    assert.doesNotMatch(tag(id), /data-i18n(?:-title|-placeholder|-aria-label)?=/, `${id} is runtime-owned`);
  }
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

test("dark appearance keeps the legacy white-shell geometry and layers colors only", async () => {
  const [preferences, styles] = await Promise.all([
    readFile(settingsPreferencesURL, "utf8"),
    readFile(stylesURL, "utf8"),
  ]);

  assert.match(preferences, /classList\.toggle\("theme-light", true\)/);
  assert.match(preferences, /classList\.toggle\("theme-dark", prefs\.theme === "dark"\)/);
  assert.match(styles, /body\.white-shell\.theme-light\.theme-dark\s*\{[\s\S]*?--ws-canvas:/);
  assert.match(styles, /moon button changes only the palette/);
});

test("chat-platform settings use the shared flat settings layout", async () => {
  const styles = await readFile(stylesURL, "utf8");

  assert.match(styles, /legacy-settings-content-body \.automation-section\.span-2,[\s\S]*?grid-column:\s*1/);
  assert.match(styles, /legacy-settings-content-body \.automation-list\s*\{[\s\S]*?max-height:\s*none/);
  assert.match(styles, /legacy-settings-content-body \.automation-form[\s\S]*?border-radius:\s*0/);
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

test("model provider settings styles remain scoped, responsive, and independent from legacy cards", async () => {
  const styles = await readFile(stylesURL, "utf8");
  const marker = "/* Model provider settings. Scoped after legacy settings overrides by design. */";
  const blockIndex = styles.lastIndexOf(marker);
  const providerStyles = styles.slice(blockIndex);

  assert.ok(blockIndex > styles.lastIndexOf(".legacy-settings-content-body .settings-provider-card"));
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-page\s*\{/);
  assert.match(providerStyles, /#settingsContentBody \.mp-stat-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-toolbar,/);
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-head\s*\{/);
  assert.match(providerStyles, /#settingsContentBody \.mp-visually-hidden\s*\{/);
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-search\s*\{/);
  assert.match(providerStyles, /#settingsContentBody \.mp-add-provider-btn,/);
  assert.match(providerStyles, /#settingsContentBody \.mp-action,/);
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(providerStyles, /@media \(min-width: 1360px\)\s*\{[\s\S]*?\.mp-provider-grid\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(providerStyles, /@media \(max-width: 1120px\)\s*\{[\s\S]*?\.mp-provider-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(providerStyles, /@media \(max-width: 767px\)\s*\{[\s\S]*?\.mp-provider-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(providerStyles, /\.mp-provider-card\.is-disabled[\s\S]*?opacity:\s*\.68/);
  assert.match(providerStyles, /\.mp-status-badge\s*\{/);
  assert.match(providerStyles, /\.mp-model-chip\s*\{/);
  assert.match(providerStyles, /\.mp-provider-switch\s*\{[\s\S]*?width:\s*44px/);
  assert.match(providerStyles, /\.mp-provider-type-modal\s*\{[\s\S]*?z-index:\s*90/);
  assert.match(providerStyles, /\.mp-modal-panel\s*\{[\s\S]*?width:\s*min\(680px, 100%\)/);
  assert.match(providerStyles, /\.mp-provider-type-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(providerStyles, /\.mp-provider-drawer-backdrop\s*\{[\s\S]*?z-index:\s*80/);
  assert.match(providerStyles, /\.mp-provider-drawer\s*\{[\s\S]*?width:\s*min\(540px, 100vw\)[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(providerStyles, /\.mp-provider-drawer-body\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(providerStyles, /\.mp-provider-drawer \.mp-drawer-body\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(providerStyles, /\.mp-provider-drawer-footer\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(providerStyles, /\.mp-provider-drawer \.mp-drawer-foot\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(providerStyles, /\.mp-provider-drawer \.mp-config-section\s*\{/);
  assert.match(providerStyles, /\.mp-provider-drawer \.codex-account-table-wrap,[\s\S]*?overflow-x:\s*auto/);
  assert.doesNotMatch(providerStyles, /(?:^|\n)\s*width:\s*1120px;/m);
  assert.match(providerStyles, /body\.white-shell\.theme-light\.theme-dark #settingsContentBody \.mp-provider-page,/);
  assert.match(providerStyles, /body\.ui-density-compact #settingsContentBody \.mp-provider-page/);
  assert.match(providerStyles, /:focus-visible\s*\{/);
  assert.match(providerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(providerStyles, /\.settings-provider-card|\.settings-status-strip|\.settings-hero-card/);
  assert.doesNotMatch(providerStyles, /settingsCategoryNav|specBoardBtn|taskList|legacy-settings-category/);
  assert.ok(styles.trimEnd().endsWith(providerStyles.trimEnd()), "provider CSS must remain the final stylesheet block");
});
