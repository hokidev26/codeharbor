import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appearancePrefsKey,
  appearanceStyleVersion,
  appearanceThemePresets,
  defaultAppearancePrefs,
  localPreferenceBackupKind,
} from "./preferences-data.mjs";
import { nativeDirectoryPickerAllowed } from "./directory-browser.mjs";
import { createSettingsPreferencesController } from "./settings-preferences.mjs";
import { createSystemSettingsController } from "./system-settings.mjs";
import {
  compactComposerModelLabel,
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
const i18nURL = new URL("modules/i18n.mjs", staticRoot);
const backgroundTasksURL = new URL("modules/background-tasks.mjs", staticRoot);
const chatRenderingURL = new URL("modules/chat-rendering.mjs", staticRoot);
const directoryBrowserURL = new URL("modules/directory-browser.mjs", staticRoot);
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

test("native directory picker requires capability, loopback, and macOS", () => {
  const options = { state: { remoteAccess: { capabilities: { nativePickerAllowed: true } } }, platformLike: "MacIntel" };
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "localhost" }, options), true);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "127.0.0.1" }, options), true);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "::1" }, options), true);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "192.168.0.146" }, options), false);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "appliance-tires-empire-partner.trycloudflare.com" }, options), false);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "localhost" }, { ...options, platformLike: "Win32" }), false);
  assert.equal(nativeDirectoryPickerAllowed({ hostname: "localhost" }, { state: {}, platformLike: "MacIntel" }), false);
});

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
    { target: "tasks", label: "任务" },
    { target: "profile", label: "设置" },
  ]);
  assert.ok(html.indexOf('data-global-rail-target="profile"') < html.indexOf('id="globalThemeToggleBtn"'));
  assert.doesNotMatch(html, /data-global-rail-target="(?:skills|runtime|im-gateway|agents)"/);
  assert.match(buttons[0].markup, /class="global-rail-button active"/);
  assert.match(buttons[0].markup, /aria-pressed="true"/);
  assert.match(appMain, /querySelectorAll\("\[data-global-rail-target\]"\)/);
  assert.match(appMain, /activateGlobalRailTarget\(node\.dataset\.globalRailTarget\)/);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "white shell must not introduce duplicate IDs");
});

test("dual workbench shell keeps conversation and Kanban views in one runtime", async () => {
  const [html, appMain, styles] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(stylesURL, "utf8"),
  ]);

  assert.match(html, /id="conversationPanel" class="chat-panel"/);
  assert.match(html, /id="workbenchPanel" class="workbench-panel hidden"/);
  assert.match(html, /id="projectKanbanBody"/);
  const workbenchHeaderStart = html.indexOf('<header class="workbench-header">');
  const workbenchHeader = html.slice(workbenchHeaderStart, html.indexOf("</header>", workbenchHeaderStart));
  assert.match(workbenchHeader, /class="workbench-kicker sr-only"/);
  assert.match(workbenchHeader, /id="workbenchTitleEditor" class="chat-title-editor workbench-title-editor"/);
  assert.match(workbenchHeader, /id="workbenchTitle" class="workbench-title chat-title-display"[^>]*disabled>任务工作台<\/button>/);
  assert.match(workbenchHeader, /id="workbenchTitleInput" class="chat-title-input workbench-title-input hidden"/);
  assert.match(workbenchHeader, /id="editWorkbenchTitleBtn"[\s\S]*?id="saveWorkbenchTitleBtn"[\s\S]*?id="cancelWorkbenchTitleBtn"/);
  assert.match(workbenchHeader, /id="workbenchMeta" class="workbench-meta sr-only"/);
  assert.doesNotMatch(workbenchHeader, /id="workbenchTitle"[^>]*data-i18n/);
  assert.match(appMain, /function renderWorkbenchHeaderIdentity\(\)[\s\S]*?renderAgentTitleEditor\("workbench"\)/);
  assert.match(appMain, /\$\("workbenchTitle"\)\?\.addEventListener\("click", \(\) => beginConversationTitleEdit\("workbench"\)\)/);
  assert.match(appMain, /saveConversationTitle\("workbench"\)\.catch\(showError\)/);
  assert.match(appMain, /workbenchTitleRequired[\s\S]*?workbenchTitleInvalid[\s\S]*?workbenchTitleSaved/);
  assert.match(styles, /\.workbench-header\s*\{[^}]*height:\s*64px[^}]*min-height:\s*64px[^}]*flex:\s*0 0 64px[^}]*padding:\s*0 18px/);
  assert.match(styles, /\.workbench-heading\s*\{[^}]*flex:\s*1 1 auto[^}]*display:\s*flex[^}]*align-items:\s*center/);
  assert.match(styles, /\.workbench-title\s*\{[^}]*max-width:\s*min\(42vw, 520px\)[^}]*font-size:\s*16px[^}]*font-weight:\s*700/);
  assert.match(styles, /\.workbench-title-editor\s*\{[^}]*max-width:\s*min\(46vw, 620px\)[^}]*flex:\s*1 1 auto/);
  assert.match(styles, /\.workbench-title-input\s*\{[^}]*width:\s*min\(34vw, 420px\)[^}]*min-width:\s*140px/);
  assert.match(styles, /@media \(max-width:\s*767px\)\s*\{[\s\S]*?\.workbench-header\s*\{[^}]*height:\s*54px[^}]*flex:\s*0 0 54px[^}]*padding:\s*0 14px[\s\S]*?\.workbench-title\s*\{[^}]*font-size:\s*16px[^}]*font-weight:\s*500/);
  assert.match(styles, /\.workbench-header:has\(\.workbench-title-input:not\(\.hidden\)\) \.workbench-header-actions\s*\{[^}]*display:\s*none/);
  assert.match(html, /id="mobileWorkbenchBtn"[^>]*aria-pressed="false"/);
  assert.match(appMain, /function applyPrimaryWorkbench\(value\)/);
  assert.match(appMain, /setPrimaryModePreference\(normalizedPrimaryWorkbench\(value\)\)/);
  assert.match(appMain, /normalizedPrimaryWorkbench\(value\) === "workbench" \? "tasks" : "conversation"/);
  assert.match(appMain, /key === "conversation" \|\| key === "tasks"/);
  assert.match(appMain, /conversationPanel"\)\?\.classList\.toggle\("hidden", workbench\)/);
  assert.match(appMain, /workbenchPanel"\)\?\.classList\.toggle\("hidden", !workbench\)/);
  const applyStart = appMain.indexOf("function applyPrimaryWorkbench");
  const applyEnd = appMain.indexOf("function switchPrimaryWorkbench", applyStart);
  const applyBody = appMain.slice(applyStart, applyEnd);
  assert.doesNotMatch(applyBody, /disconnectAgentTransports|selectProject|selectNavigationConversation|beginNavigationSelection/);
  assert.match(appMain, /createPageLifecycleController\(\{[\s\S]*?agentStream\.resume\(detail\)[\s\S]*?agentStream\.pause/);
  assert.match(appMain, /autoto:auth-changed[\s\S]*?disconnectAgentTransports\(\)[\s\S]*?projectKanban\.setAgent\(null\)[\s\S]*?init\(\)\.catch\(showError\)/);
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

test("Codex browser login cache stamps reach the static entry and locale catalogs", async () => {
  const [html, app, appMain, i18n] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(i18nURL, "utf8"),
  ]);
  assert.equal((html.match(/codex-browser-login-1/g) || []).length, 2);
  assert.equal((app.match(/codex-browser-login-1/g) || []).length, 1);
  assert.match(appMain, /model-provider-settings\.mjs\?v=[^"\n]*codex-browser-login-1/);
  assert.match(appMain, /i18n\.mjs\?v=[^"\n]*codex-browser-login-1/);
  assert.equal((i18n.match(/messages-(?:en|zh-CN|zh-TW)\.mjs\?v=[^"\n]*codex-browser-login-1/g) || []).length, 3);
});

test("folder picker uses stable SVG actions and directory icons instead of font glyphs", async () => {
  const [html, directoryBrowser, styles, appMain] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(directoryBrowserURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(appMainURL, "utf8"),
  ]);
  const toolbar = html.slice(html.indexOf('<div class="folder-toolbar"'), html.indexOf('<div id="newFolderInline"'));
  const newFolderButton = toolbar.slice(toolbar.indexOf('id="newFolderBtn"'), toolbar.indexOf('</button>', toolbar.indexOf('id="newFolderBtn"')));

  assert.match(newFolderButton, /class="folder-tool-btn folder-tool-btn-labeled"/);
  assert.match(newFolderButton, /aria-controls="newFolderInline" aria-expanded="false"/);
  assert.match(newFolderButton, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(newFolderButton, /data-i18n="folder\.newFolder">新建文件夹<\/span>/);
  assert.doesNotMatch(toolbar, /▱＋/);
  assert.match(directoryBrowser, /const directoryFolderIcon = `[\s\S]*class="directory-folder-svg"/);
  assert.match(directoryBrowser, /class="directory-icon" aria-hidden="true">\$\{directoryFolderIcon\}/);
  assert.doesNotMatch(directoryBrowser, /class="directory-icon">▱/);
  assert.match(directoryBrowser, /trigger\?\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(directoryBrowser, /trigger\?\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(styles, /\.folder-tool-btn-labeled \{/);
  assert.match(styles, /\.directory-folder-stroke \{/);
  assert.match(appMain, /directory-browser\.mjs\?v=folder-picker-remote-2/);
  assert.equal((html.match(/folder-picker-remote-2/g) || []).length, 2);
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

test("conversation and task modes expose separate creation boundaries", async () => {
  const [html, appMain, styles] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(stylesURL, "utf8"),
  ]);

  assert.match(html, /id="sessionSidebar" class="sidebar"/);
  assert.match(html, /id="sessionSidebarTitle" class="session-sidebar-title"/);
  assert.match(html, /id="newProjectBtn" class="[^"]*conversation-mode-only/);
  assert.match(html, /id="newTaskBtn" class="[^"]*task-mode-action hidden"[^>]*disabled/);
  assert.match(html, /id="specBoardBtn" class="[^"]*hidden/);
  assert.match(html, /id="navigationFilters" class="[^"]*conversation-mode-only/);
  assert.match(html, /recent-directories-sidebar conversation-mode-only/);
  assert.match(appMain, /const effectiveNavigationMode = taskContext \? "projects" : state\.navigationMode/);
  assert.match(appMain, /renderNavigationHTML\(view, \{[\s\S]*?taskContext,/);
  assert.match(appMain, /newTaskBtn"\)\?\.addEventListener\("click", \(\) => focusTaskCreation\(\)\.catch\(showError\)\)/);
  assert.match(appMain, /projectKanban\.focusCreate\(\)/);
  assert.match(appMain, /data-primary-workbench-target/);
  assert.match(styles, /body\.white-shell\.theme-light\.workbench-mode \.conversation-mode-only\s*\{[\s\S]*?display:\s*none !important/);
  assert.match(styles, /body\.white-shell\.theme-light\.workbench-mode #newTaskBtn\s*\{[\s\S]*?background:\s*var\(--task-accent-soft\)/);
  assert.match(styles, /\.navigation-boundary-empty\s*\{/);
});

test("composer toolbar precedes the input row while preserving all event IDs", async () => {
  const html = await readFile(indexURL, "utf8");
  const formStart = html.indexOf('<form id="messageForm"');
  const formEnd = html.indexOf("</form>", formStart);
  const composer = html.slice(formStart, formEnd);

  const toolbarIndex = composer.indexOf('class="composer-toolbar"');
  const inputIndex = composer.indexOf('id="composerInputShell"');
  assert.ok(toolbarIndex >= 0 && toolbarIndex < inputIndex);
  assert.ok(composer.indexOf('id="headerTaskSummaryBtn"') > toolbarIndex && composer.indexOf('id="headerTaskSummaryBtn"') < inputIndex);
  assert.ok(composer.indexOf('id="modelSelect"') < inputIndex);
  assert.ok(composer.indexOf('id="permissionMode"') < inputIndex);
  assert.doesNotMatch(html, /id="currentMeta"/);
  assert.doesNotMatch(html, /id="wsBadge"/);
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

test("background tasks share the right utility column instead of overlaying chat", async () => {
  const [html, styles, appMain] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(appMainURL, "utf8"),
  ]);
  const detailsPanel = html.indexOf('id="conversationDetailsPanel"');
  const taskPanel = html.indexOf('id="backgroundTaskTray"');
  assert.ok(detailsPanel >= 0 && taskPanel > detailsPanel);
  assert.match(html, /id="backgroundTaskTray" class="utility-panel background-task-panel hidden"/);
  assert.doesNotMatch(html, /id="backgroundTaskTray" class="background-task-tray/);
  assert.match(styles, /\.app-shell\.background-tasks-open/);
  assert.match(styles, /\.background-task-panel-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.background-task-tray-grid\s*\{[\s\S]*?grid-template-rows:/);
  assert.match(appMain, /onOpenChange:\s*\(open\)\s*=>\s*\{[\s\S]*?classList\.toggle\("background-tasks-open", open\)/);
  assert.match(appMain, /function openConversationDetails\(\)\s*\{[\s\S]*?backgroundTasks\.closeTray\("details-open"\)/);
});

test("browser preview dock compacts both control rows to preserve page space", async () => {
  const styles = await readFile(stylesURL, "utf8");
  const dockStart = styles.indexOf("body.white-shell.theme-light .workspace-preview-dock-mode {");
  const dockEnd = styles.indexOf("@media (min-width: 1280px)", dockStart);
  const dock = styles.slice(dockStart, dockEnd);
  assert.match(dock, /\.workspace-preview-dock-mode \.workspace-modal-head\s*\{[\s\S]*?flex:\s*0 0 50px;[\s\S]*?grid-template-rows:\s*1fr/);
  assert.match(dock, /\.workspace-preview-dock-mode \.workspace-preview-toolbar\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?padding:\s*6px 10px/);
  assert.match(dock, /\.workspace-browser-icon\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px/);
  assert.match(dock, /\.workspace-browser-address\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?height:\s*32px/);
  assert.match(dock, /\.workspace-viewport-btn\s*\{[\s\S]*?min-height:\s*32px/);
});

test("desktop conversation layout follows the compact resizable geometry", async () => {
  const [html, styles, appMain, chatRendering] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(stylesURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(chatRenderingURL, "utf8"),
  ]);
  const finalDesktopComposer = styles.slice(styles.indexOf("/* Final desktop full-width composer override. */"));
  assert.match(styles, /grid-template-columns:\s*76px var\(--session-sidebar-width\) minmax\(420px, 1fr\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.sidebar-resize-handle\s*\{[\s\S]*?position:\s*fixed[\s\S]*?left:\s*calc\(68px \+ var\(--session-sidebar-width\) - 3px\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.chat-panel\s*\{[\s\S]*?grid-column:\s*3/);
  assert.match(styles, /body\.white-shell\.theme-light \.terminal-panel\s*\{[\s\S]*?grid-column:\s*4/);
  assert.match(styles, /\.session-sidebar-header\s*\{[\s\S]*?height:\s*62px/);
  assert.match(styles, /body\.white-shell\.theme-light \.composer-wrap\s*\{[\s\S]*?padding:\s*6px 12px 8px/);
  assert.match(styles, /body\.white-shell\.theme-light \.message-input\s*\{[\s\S]*?min-height:\s*40px/);
  assert.match(styles, /body\.white-shell\.theme-light \.composer-send-btn\s*\{[\s\S]*?width:\s*34px/);
  assert.match(styles, /body\.white-shell\.theme-light \.project-card\.navigation-project-row\s*\{[\s\S]*?min-height:\s*44px[\s\S]*?padding:\s*5px 8px/);
  assert.match(styles, /body\.white-shell\.theme-light \.navigation-conversation-row\s*\{[\s\S]*?min-height:\s*42px[\s\S]*?grid-template-columns:\s*14px minmax\(0, 1fr\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.navigation-project-group \+ \.navigation-project-group\s*\{[\s\S]*?margin-top:\s*2px/);
  assert.match(styles, /body\.white-shell\.theme-light \.messages:not\(\.empty\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?grid-auto-rows:\s*max-content[\s\S]*?justify-content:\s*start[\s\S]*?row-gap:\s*14px[\s\S]*?padding:\s*14px 16px 14px/);
  assert.match(styles, /body\.white-shell\.theme-light \.messages:not\(\.empty\) > \[class~="message"\]\s*\{[^}]*justify-self:\s*stretch[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*white-space:\s*normal/);
  assert.match(styles, /body\.white-shell\.theme-light \.messages:not\(\.empty\) > \[class~="message"\]\[class~="user"\]\[class~="chat-flow-left"\]\s*\{[^}]*justify-self:\s*start[^}]*align-self:\s*start[^}]*width:\s*fit-content[^}]*min-width:\s*126px[^}]*max-width:\s*min\(760px, 82%\)[^}]*height:\s*fit-content[^}]*margin:\s*0 0 14px[^}]*background:\s*var\(--ws-primary-soft\)[^}]*color:\s*var\(--ws-text\)/);
  assert.match(styles, /\[class~="message"\]\[class~="user"\]\[class~="chat-flow-left"\] \.message-head-actions\s*\{[^}]*position:\s*absolute[^}]*display:\s*flex/);
  assert.match(styles, /\[class~="message"\]\[class~="user"\]\[class~="chat-flow-left"\] \.message-copy-btn\s*\{[^}]*width:\s*22px[^}]*font-size:\s*0/);
  assert.match(styles, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\[class~="message"\]\[class~="user"\]\[class~="chat-flow-left"\]\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*92%[^}]*margin-left:\s*0/);
  assert.match(styles, /\[class~="message"\]\[class~="user"\]\[class~="chat-flow-left"\]\[class~="message-editing"\]\s*\{[^}]*justify-self:\s*stretch[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*background:\s*var\(--ws-card\)/);
  assert.match(styles, /\[class~="message"\]:not\(\[class~="live-assistant-message"\]\) \.message-head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto max-content/);
  assert.match(styles, /\[class~="message"\]:not\(\[class~="live-assistant-message"\]\) \.message-time\s*\{[^}]*grid-column:\s*3[^}]*justify-self:\s*end/);
  assert.match(styles, /\.message-editing \.message-correction-text\s*\{[\s\S]*?border-radius:\s*7px[\s\S]*?background:\s*var\(--ws-input\)/);
  assert.match(styles, /body\.white-shell\.theme-light \.messages:not\(\.empty\) > \[class~="run-summary-card"\]\s*\{[\s\S]*?justify-self:\s*stretch[\s\S]*?width:\s*100%/);
  assert.match(finalDesktopComposer, /\[class~="toolbar-model-pill"\],[\s\S]*?\[class~="model-tool-btn"\]\[class~="icon-only"\]\s*\{[\s\S]*?border-radius:\s*6px/);
  assert.match(finalDesktopComposer, /textarea#messageText\s*\{[\s\S]*?border-radius:\s*7px/);
  assert.match(finalDesktopComposer, /#sendMessageBtn\s*\{[\s\S]*?border-radius:\s*7px/);
  assert.match(styles, /\.sidebar-resize-handle\s*\{[\s\S]*?cursor:\s*col-resize/);
  assert.match(html, /id="sidebarResizeHandle"[^>]*role="separator"[^>]*aria-valuemin="220"[^>]*aria-valuemax="420"/);
  assert.match(appMain, /bindSidebarResizer\(\)/);
  assert.match(styles, /\.sidebar-search-wrap\.hidden\s*\{[\s\S]*?display:\s*block !important/);
  assert.match(html, /id="messages" class="messages empty" data-initial-chat-state="loading" aria-busy="true"/);
  assert.match(html, /workspace\.main\.loadingProjectTitle/);
  assert.doesNotMatch(html, /id="messages"[\s\S]{0,500}data-i18n="chat\.emptyTitle"/);
  assert.match(appMain, /resolveInitialNavigationTarget\(state\.recentConversations, state\.navigationConversations\)/);
  assert.match(appMain, /createNavigationRefreshController\(\{[\s\S]*?refresh:\s*\(\) => loadProjects\(\)[\s\S]*?visibilityState !== "hidden"/);
  assert.match(appMain, /navigationRefresh\.request\(event\.type\)/);
  assert.match(appMain, /navigationRefresh\.start\(\)/);
  assert.match(appMain, /syncNavigationConversationFromAgent\(state\.agent/);
  assert.match(appMain, /preserveMessageState:\s*true/);
  assert.match(appMain, /function markMessageViewportBusy\(\)[\s\S]*?dataset\.initialChatState = "loading"/);
  assert.match(appMain, /selectNavigationConversation[\s\S]*?markMessageViewportBusy\(\)/);
  assert.doesNotMatch(appMain, /conversationOpeningTitle/);
  assert.match(chatRendering, /state\.chatHydrating && options\.forceRender !== true/);
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
  assert.match(desktopComposerStyles, /\[class~="composer-toolbar"\][\s\S]*?justify-content:\s*flex-start/);
  assert.match(desktopComposerStyles, /\[class~="composer-task-summary"\][\s\S]*?height:\s*30px[\s\S]*?margin-right:\s*auto/);
  assert.match(desktopComposerStyles, /\[class~="composer-card"\][\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none[\s\S]*?margin:\s*0/);
  assert.match(desktopComposerStyles, /\[class~="composer-model-field"\][\s\S]*?flex:\s*0 1 300px[\s\S]*?max-width:\s*300px/);
  assert.match(desktopComposerStyles, /\[class~="toolbar-lightning-btn"\],[\s\S]*?\[class~="composer-actions"\][\s\S]*?display:\s*flex/);
  assert.match(desktopComposerStyles, /textarea#messageText[\s\S]*?--composer-input-min-height:\s*40px/);
  assert.match(desktopComposerStyles, /#sendMessageBtn[\s\S]*?width:\s*56px/);
});

test("composer task activity is borderless, left aligned, and spins blue while active", async () => {
  const [styles, backgroundTasks] = await Promise.all([readFile(stylesURL, "utf8"), readFile(backgroundTasksURL, "utf8")]);
  const marker = "/* Minimal left-aligned task activity, matching the inline running indicator. */";
  const indicatorStyles = styles.slice(styles.indexOf(marker));
  assert.ok(indicatorStyles.startsWith(marker));
  assert.match(indicatorStyles, /\.composer-task-summary\s*\{[\s\S]*?margin-right:\s*auto[\s\S]*?padding:\s*0[\s\S]*?border:\s*0[\s\S]*?background:\s*transparent/);
  assert.match(indicatorStyles, /\.composer-task-summary\.has-task[\s\S]*?color:\s*var\(--ws-primary/);
  assert.match(indicatorStyles, /\.header-task-status-dot\.running,[\s\S]*?\.header-task-status-dot\.queued[\s\S]*?border-top-color:\s*var\(--ws-primary[\s\S]*?animation:\s*composer-task-indicator-spin/);
  assert.match(indicatorStyles, /@keyframes composer-task-indicator-spin[\s\S]*?rotate\(360deg\)/);
  assert.match(backgroundTasks, /headerQueue\.classList\.toggle\("hidden", summary\.queuedCount <= 0\)/);
});

test("composer responds to its actual width before the mobile breakpoint", async () => {
  const [html, styles] = await Promise.all([readFile(indexURL, "utf8"), readFile(stylesURL, "utf8")]);
  assert.match(html, /styles\.css\?v=[^"]*composer-responsive-2/);
  const marker = "/* Responsive composer tiers follow the editor's real width, not the full viewport. */";
  const responsiveStyles = styles.slice(styles.indexOf(marker), styles.indexOf("/* Flat, single-pass settings layout", styles.indexOf(marker)));
  assert.ok(responsiveStyles.startsWith(marker));
  assert.match(responsiveStyles, /\.composer-wrap\s*\{[^}]*container-name:\s*composer-shell[^}]*container-type:\s*inline-size/);
  assert.match(responsiveStyles, /\.composer-select-value\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(responsiveStyles, /\.permission-toolbar-pill\s*\{[^}]*width:\s*124px[^}]*min-width:\s*124px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*1320px\)[\s\S]*?\.composer-task-summary\s*\{[^}]*width:\s*180px[^}]*max-width:\s*180px[^}]*flex:\s*0 1 180px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.composer-task-summary\s*\{[^}]*width:\s*30px[^}]*flex:\s*0 0 30px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.composer-model-field\s*\{[^}]*min-width:\s*140px[^}]*max-width:\s*200px[^}]*flex:\s*1 1 160px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.effort-pill\s*\{[^}]*width:\s*92px[^}]*min-width:\s*92px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.permission-toolbar-pill\s*\{[^}]*width:\s*112px[^}]*min-width:\s*112px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.message-mode-option::after\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*900px\)[\s\S]*?\.permission-safety-indicator\s*\{[^}]*display:\s*none/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*620px\)[\s\S]*?\.composer-model-field\s*\{[^}]*max-width:\s*88px[^}]*flex:\s*1 1 62px/);
  assert.match(responsiveStyles, /@container composer-shell \(max-width:\s*620px\)[\s\S]*?\.composer-permission-field \.composer-select-value::before\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
});

test("mobile header and composer use compact icon-first layouts", async () => {
  const [html, styles, appMain, app] = await Promise.all([readFile(indexURL, "utf8"), readFile(stylesURL, "utf8"), readFile(appMainURL, "utf8"), readFile(appURL, "utf8")]);
  const marker = "/* Compact mobile composer: one utility row plus one message row. */";
  const mobileComposerStyles = styles.slice(styles.indexOf(marker), styles.indexOf("/* Model provider settings.", styles.indexOf(marker)));
  assert.ok(mobileComposerStyles.startsWith(marker));
  assert.match(html, /styles\.css\?v=[^"]*mobile-short-labels-1/);
  assert.match(html, /app\.js\?v=[^"]*mobile-short-labels-1/);
  assert.match(app, /app-main\.mjs\?v=[^"]*mobile-short-labels-1/);
  assert.match(html, /id="mobileTerminalBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="mobileSearchBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="composerFolderBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /id="composerTerminalBtn"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /data-composer-select="modelSelect"[\s\S]*?class="composer-select-icon"[\s\S]*?id="modelSelectDisplay"[^>]*data-mobile-label="模型"/);
  assert.match(html, /data-composer-select="reasoningEffort"[\s\S]*?class="composer-select-icon"[\s\S]*?id="reasoningEffortDisplay"[^>]*data-mobile-label="Auto"/);
  assert.match(html, /data-composer-select="permissionMode"[\s\S]*?class="composer-select-icon"[\s\S]*?data-mobile-label="RW"/);
  assert.match(html, /id="securityModeBadge"[^>]*data-mobile-label="LAN"/);
  assert.doesNotMatch(html, /id="(?:remoteSecurityBanner|workbenchRemoteSecurityBanner)"/);
  assert.doesNotMatch(appMain, /\$\("(?:remoteSecurityBanner|workbenchRemoteSecurityBanner)"\)/);
  assert.match(html, /data-message-mode="plan"[^>]*data-mobile-label="P"/);
  assert.match(html, /data-message-mode="execute"[^>]*data-mobile-label="▶"/);
  assert.match(html, /id="sendMessageBtn"[^>]*data-mobile-label="↑"/);
  assert.equal(compactComposerModelLabel("cliproxyapi:claude-sonnet-4-6"), "sonnet");
  assert.equal(compactComposerModelLabel("codex:gpt-5.5"), "gpt-5.5");
  assert.equal(compactComposerModelLabel("openai:gpt-4-1-mini"), "gpt-4.1");
  assert.match(appMain, /readOnly:\s*"RO"[\s\S]*?acceptEdits:\s*"RW"[\s\S]*?bypassPermissions:\s*"ALL"/);
  assert.match(appMain, /connection\.restricted \? "T−" : "T\+"/);
  assert.match(mobileComposerStyles, /\[class~="mobile-update-pill"\][\s\S]*?display:\s*none !important/);
  assert.match(mobileComposerStyles, /\[class~="mobile-topbar"\][\s\S]*?height:\s*56px/);
  assert.match(mobileComposerStyles, /\[class~="composer-card"\][\s\S]*?gap:\s*6px[\s\S]*?border:\s*0/);
  assert.match(mobileComposerStyles, /\[class~="composer-toolbar"\][\s\S]*?justify-content:\s*flex-end/);
  assert.match(mobileComposerStyles, /\[class~="composer-controls"\][\s\S]*?flex:\s*0 1 auto[\s\S]*?justify-content:\s*flex-end[\s\S]*?margin-left:\s*auto/);
  assert.match(mobileComposerStyles, /\[class~="composer-model-field"\][\s\S]*?width:\s*96px[\s\S]*?flex:\s*0 1 96px/);
  assert.match(mobileComposerStyles, /\[class~="composer-message-mode-field"\][\s\S]*?width:\s*54px[\s\S]*?flex:\s*0 0 54px/);
  assert.match(mobileComposerStyles, /\[class~="composer-select-icon"\]\s*\{[^}]*display:\s*inline-flex/);
  assert.match(mobileComposerStyles, /\[class~="composer-model-field"\] \[class~="composer-select-value"\]::after\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(mobileComposerStyles, /\[class~="message-mode-option"\]::after\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(mobileComposerStyles, /\[class~="composer-permission-field"\][\s\S]*?\[class~="composer-select-value"\]::before\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(mobileComposerStyles, /\[class~="permission-safety-indicator"\],[\s\S]*?display:\s*none !important/);
  assert.match(mobileComposerStyles, /textarea#messageText[\s\S]*?--composer-input-min-height:\s*44px/);
  assert.match(mobileComposerStyles, /#sendMessageBtn[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(mobileComposerStyles, /#sendMessageBtn::before\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(styles, /\.composer-task-summary:disabled,[\s\S]*?\.composer-task-summary:not\(\.has-task\)\s*\{[^}]*display:\s*none/);
  assert.match(styles, /\.composer-task-summary\s*\{[^}]*width:\s*28px[^}]*margin-right:\s*auto/);
  assert.match(styles, /\.security-mode-pill::before\s*\{[^}]*content:\s*attr\(data-mobile-label\)/);
  assert.match(styles, /#backgroundTasksBtn\s*\{\s*display:\s*none/);
  assert.match(mobileComposerStyles, /\[class~="composer-hints"\][\s\S]*?display:\s*none/);
});

test("narrow composer switches atomically to a fixed unframed icon rail", async () => {
  const [styles, uiShell] = await Promise.all([readFile(stylesURL, "utf8"), readFile(uiShellURL, "utf8")]);
  const marker = "/* Narrow composer icon rail: preserve every control at one fixed size. */";
  const iconRail = styles.slice(styles.indexOf(marker), styles.indexOf("/* Flat, single-pass settings layout", styles.indexOf(marker)));
  assert.ok(iconRail.startsWith(marker));
  assert.match(iconRail, /@container composer-shell \(max-width:\s*480px\)/);
  assert.match(iconRail, /\.composer-status\s*\{[^}]*width:\s*28px[^}]*display:\s*inline-flex[^}]*flex:\s*0 0 28px/);
  assert.match(iconRail, /\.composer-status-dot,[\s\S]*?\.composer-status-dot\.ok\s*\{[^}]*width:\s*14px[^}]*border:\s*2px solid[^}]*background:\s*transparent/);
  assert.match(iconRail, /\.composer-controls\s*\{[^}]*min-width:\s*max-content[^}]*flex:\s*0 0 auto[^}]*overflow:\s*visible/);
  assert.match(iconRail, /:is\(\.composer-model-field, \.composer-effort-field, \.composer-permission-field\)\s*\{[^}]*width:\s*28px[^}]*min-width:\s*28px[^}]*max-width:\s*28px[^}]*flex:\s*0 0 28px/);
  assert.match(iconRail, /:is\(\.toolbar-model-pill, \.effort-pill, \.permission-toolbar-pill\)\s*\{[^}]*width:\s*28px[^}]*flex:\s*0 0 28px[^}]*border:\s*0[^}]*background:\s*transparent/);
  assert.match(iconRail, /\.composer-select-value\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/);
  assert.match(iconRail, /\.composer-select-chevron\s*\{[^}]*display:\s*none/);
  assert.match(iconRail, /\.composer-message-mode-field\s*\{[^}]*width:\s*52px[^}]*flex:\s*0 0 52px/);
  assert.match(iconRail, /\.message-mode-toggle\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/);
  assert.match(iconRail, /\.toolbar-lightning-btn:not\(\.hidden\),[\s\S]*?\.composer-toolbar-icon\s*\{[^}]*width:\s*28px[^}]*display:\s*inline-flex[^}]*border:\s*0[^}]*background:\s*transparent/);
  assert.match(iconRail, /\.model-tool-btn\.icon-only\.composer-toolbar-icon\s*\{[^}]*width:\s*28px[^}]*height:\s*30px[^}]*min-height:\s*30px/);
  assert.match(iconRail, /\.composer-actions\s*\{[^}]*flex:\s*0 0 auto[^}]*gap:\s*4px/);
  assert.match(uiShell, /trigger\.setAttribute\("aria-label", fieldLabel \? `\$\{fieldLabel\}：\$\{optionText\}` : optionText\)/);
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

test("settings dialog mounts the shadcn shell without dropping legacy entry points", async () => {
  const [html, appMain, uiShell] = await Promise.all([
    readFile(indexURL, "utf8"),
    readFile(appMainURL, "utf8"),
    readFile(uiShellURL, "utf8"),
  ]);
  for (const id of [
    "settingsModal",
    "settingsModalTitle",
    "settingsCategoryNav",
    "settingsSearchInput",
    "clearSettingsSearchBtn",
    "closeSettingsModalBtn",
    "settingsNav",
    "settingsContentTitle",
    "settingsContentSubtitle",
    "settingsContentBody",
    "settingsIdentityBtn",
    "settingsIdentityAvatar",
    "settingsIdentityName",
    "settingsIdentityMeta",
    "employeeOverviewModal",
    "employeeOverviewBody",
    "conversationDetailsPanel",
    "conversationDetailsBody",
    "workspacePreviewNavigateForm",
    "workspacePreviewAddress",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const className of [
    "settings-dialog-shell",
    "settings-sidebar",
    "settings-sidebar-header",
    "settings-identity-card",
    "settings-sidebar-search",
    "settings-mobile-category-nav",
    "settings-nav-groups",
    "settings-main",
    "settings-main-header",
    "settings-main-heading",
    "settings-page-scroll",
  ]) assert.match(html, new RegExp(`class="[^"]*${className}`));
  assert.match(html, /class="sidebar-footer hidden"/);
  assert.match(appMain, /groupSettingsItemsByLegacyCategory/);
  assert.match(appMain, /class="settings-nav-group"/);
  assert.match(appMain, /aria-current="page"/);
  assert.match(appMain, /class="settings-page-frame" data-settings-page=/);
  assert.match(appMain, /data-panel-layout=/);
  assert.match(appMain, /handleSettingsDialogKeydown/);
  assert.match(appMain, /beginSettingsDialogFocus/);
  assert.match(uiShell, /settingsDialogHasNestedModal/);
  assert.match(uiShell, /restoreSettingsDialogFocus/);
  assert.match(uiShell, /event\.defaultPrevented/);
  assert.match(appMain, /openEmployeeOverview\(\)/);
  assert.match(appMain, /renderConversationDetails\(\)/);
  assert.match(appMain, /settingsCategoryForItem/);
  assert.match(appMain, /classList\.toggle\("about-panel-active", isAboutPanel\)/);
  assert.match(appMain, /bindSkillTabs\(state\.activeSkillTab \|\| "commands"\)/);
  assert.doesNotMatch(appMain, /\["users",\s*\{\s*render:/);
});

test("settings shadcn shell stays centered and keeps complete mobile navigation", async () => {
  const styles = await readFile(stylesURL, "utf8");
  const settingsMarker = "Settings shadcn system — scoped integration.";
  const providerMarker = "/* Model provider settings. Scoped after legacy settings overrides by design. */";
  const settingsIndex = styles.indexOf(settingsMarker);
  const providerIndex = styles.indexOf(providerMarker);
  assert.ok(settingsIndex > 0 && providerIndex > settingsIndex);
  const settingsStyles = styles.slice(settingsIndex, providerIndex);
  assert.match(settingsStyles, /#settingsModal\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.match(settingsStyles, /#settingsModal \.settings-dialog-shell\s*\{[\s\S]*?width:\s*min\(1520px, calc\(100vw - 24px\)\);[\s\S]*?grid-template-columns:\s*240px minmax\(0, 1fr\);/);
  assert.doesNotMatch(settingsStyles, /\.settings-dialog-shell:has\(\.codex-account-console\)/);
  assert.match(settingsStyles, /\.settings-main\.legacy-settings-content\s*\{[\s\S]*?overflow:\s*hidden !important;/);
  assert.match(settingsStyles, /\.automation-hero p/);
  const mobile = settingsStyles.slice(settingsStyles.indexOf("@media (max-width: 767px)"));
  assert.match(mobile, /\.settings-sidebar\s*\{[\s\S]*?display:\s*grid;/);
  assert.doesNotMatch(mobile, /\.settings-sidebar\s*\{[^}]*display:\s*none;/);
  assert.match(mobile, /\.settings-mobile-category-nav,[\s\S]*?\.settings-nav-groups\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(mobile, /\.settings-nav-group\s*\{[\s\S]*?display:\s*contents;/);
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
  assert.match(initial, /class="legacy-about-logo"[\s\S]*?\/ui\/autoto-logo\.svg/);
  assert.doesNotMatch(initial, /legacy-about-logo-spark/);
  assert.match(initial, /class="legacy-about-overview"/);
  assert.doesNotMatch(initial, /legacy-about-overview settings-page-section settings-card/);
  assert.match(initial, /id="legacyAboutProductName">Autoto</);
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

  state.licenseSummary = {
    notice: "Development aid only; verify before distribution. Not legal advice.",
    modules: [
      { path: "example.com/unknown", version: "v1.0.0", license: "unknown", relation: "indirect" },
      { path: "example.com/direct", version: "v2.0.0", license: "MIT", relation: "direct" },
    ],
  };
  const licenses = controller.renderAboutSettingsContent();
  assert.match(licenses, /class="legacy-about-license-metrics/);
  assert.match(licenses, /class="license-accordion warn" open/);
  assert.match(licenses, /未知许可证/);
  assert.match(licenses, /MIT/);
  assert.match(licenses, /直接依赖/);
  assert.doesNotMatch(licenses, /Development aid only/);
  assert.doesNotMatch(licenses, /license-group-grid/);
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
  for (const id of ["currentTitle", "directoryStatus", "workspaceEditorPath", "workspacePreviewStatus", "workspacePreviewLogs"]) {
    assert.doesNotMatch(tag(id), /data-i18n(?:-title|-placeholder|-aria-label)?=/, `${id} is runtime-owned`);
  }
});

test("initial shell and default appearance use the versioned light theme", async () => {
  const html = await readFile(indexURL, "utf8");

  assert.match(html, /<body class="theme-light white-shell ui-density-comfortable">/);
  assert.match(html, /styles\.css\?v=white-shell-2/);
  assert.match(html, /app\.js\?v=white-shell-2/);
  assert.equal(defaultAppearancePrefs.themePreset, "light");
  assert.equal(defaultAppearancePrefs.theme, "light");
  assert.equal(defaultAppearancePrefs.styleVersion, appearanceStyleVersion);
  assert.equal(appearanceStyleVersion, 3);
  assert.deepEqual(appearanceThemePresets, ["light", "dark", "cyber", "cream", "apple"]);
});

test("dark appearance keeps the legacy white-shell geometry and layers colors only", async () => {
  const [preferences, styles] = await Promise.all([
    readFile(settingsPreferencesURL, "utf8"),
    readFile(stylesURL, "utf8"),
  ]);

  assert.match(preferences, /classList\.toggle\("theme-light", true\)/);
  assert.match(preferences, /classList\.toggle\("theme-dark", prefs\.theme === "dark"\)/);
  assert.match(styles, /body\.white-shell\.theme-light\.theme-dark\s*\{[\s\S]*?--ws-canvas:/);
  assert.match(styles, /body\.white-shell\.theme-light\.theme-dark \.workbench-panel\s*\{[\s\S]*?background:\s*var\(--ws-canvas\)/);
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
      styleVersion: 3,
      themePreset: "light",
      theme: "light",
      density: "compact",
      terminalDefaultOpen: true,
      showEventLog: false,
    });
    assert.deepEqual(JSON.parse(storage.getItem(appearancePrefsKey)), migrated);

    controller.saveAppearancePreferences({ ...migrated, themePreset: "dark" });
    assert.equal(JSON.parse(storage.getItem(appearancePrefsKey)).themePreset, "dark");
    assert.equal(JSON.parse(storage.getItem(appearancePrefsKey)).theme, "dark");
    assert.equal(JSON.parse(storage.getItem(appearancePrefsKey)).styleVersion, 3);
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
      styleVersion: 3,
      themePreset: "light",
      theme: "light",
      density: "comfortable",
      terminalDefaultOpen: false,
      showEventLog: true,
    });
    assert.deepEqual(controller.createLocalPreferencesBackup().preferences[appearancePrefsKey], {
      styleVersion: 3,
      themePreset: "light",
      theme: "light",
      density: "comfortable",
      terminalDefaultOpen: false,
      showEventLog: true,
    });
  });
});

test("Codex and Anthropic account consoles use the available desktop width for account actions", async () => {
  const styles = await readFile(stylesURL, "utf8");

  assert.match(styles, /#settingsModal \.settings-page-frame:has\(\.codex-account-console\)\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/);
  assert.match(styles, /#settingsContentBody \.codex-account-table th:nth-child\(8\)\s*\{\s*width:\s*22%;\s*\}/);
  assert.match(styles, /#settingsContentBody \.codex-account-actions\s*\{[\s\S]*?border-radius:\s*9px;[\s\S]*?background:\s*var\(--settings-muted\)/);
  assert.match(styles, /#settingsContentBody \.anthropic-account-table th:nth-child\(8\)\s*\{\s*width:\s*19%;\s*\}/);
  assert.match(styles, /#settingsContentBody \.codex-browser-login-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(styles, /#settingsContentBody \.codex-browser-login-actions\s*\{[\s\S]*?justify-content:\s*flex-end;/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?#settingsContentBody \.codex-browser-login-body \{ grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?#settingsContentBody \.codex-accounts-panel \.codex-account-table-wrap \{ overflow:\s*visible;/);
});

test("agent model pools collapse and the current-model catalog stays compact", async () => {
  const styles = await readFile(stylesURL, "utf8");

  assert.match(styles, /#settingsContentBody \.agent-model-pool-details\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /#settingsContentBody \.agent-model-pool-summary\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(styles, /#settingsContentBody \.agent-model-pool-options\s*\{[\s\S]*?max-height:\s*150px;/);
  assert.match(styles, /#settingsContentBody \.agent-model-catalog \.settings-model-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(420px, 1fr\)\)/);
  assert.match(styles, /#settingsContentBody \.agent-model-catalog-item\s*\{[\s\S]*?min-height:\s*40px;[\s\S]*?padding:\s*0 4px 0 0;/);
});

test("model provider settings styles remain scoped, responsive, and independent from legacy cards", async () => {
  const styles = await readFile(stylesURL, "utf8");
  const marker = "/* Model provider settings. Scoped after legacy settings overrides by design. */";
  const blockIndex = styles.lastIndexOf(marker);
  const providerStyles = styles.slice(blockIndex);

  assert.ok(blockIndex > styles.lastIndexOf(".legacy-settings-content-body .settings-provider-card"));
  assert.match(providerStyles, /#settingsContentBody \.mp-provider-page\s*\{/);
  assert.match(providerStyles, /#settingsContentBody \.mp-stat-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
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
  assert.doesNotMatch(providerStyles, /\.mp-provider-switch|data-mp-provider-toggle/);
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
