import test from "node:test";
import assert from "node:assert/strict";

import { createTerminalController } from "./terminal.mjs";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, force) {
      if (force === undefined) force = !values.has(name);
      if (force) values.add(name);
      else values.delete(name);
      return force;
    },
    contains: (name) => values.has(name),
  };
}

test("terminal toggle synchronizes the legacy header button ARIA state", () => {
  const appShell = { classList: classList(["terminal-collapsed"]) };
  const button = {
    title: "展开终端",
    classList: classList(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const expand = { classList: classList() };
  const composer = { classList: classList() };
  const elements = {
    appShell,
    toggleTerminalBtn: button,
    expandTerminalBtn: expand,
    composerTerminalBtn: composer,
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    body: { classList: classList() },
    getElementById: (id) => elements[id] || null,
  };
  try {
    const controller = createTerminalController({
      state: { remoteAccess: { session: { remote: false }, capabilities: { terminalAllowed: true } } },
      showToast: () => {},
      refreshActiveSettingsPanel: () => {},
    });
    controller.renderTerminalButtonState();
    assert.equal(button.attributes.get("aria-pressed"), "false");
    assert.equal(expand.classList.contains("hidden"), false);

    assert.equal(controller.toggleTerminal(false), true);
    assert.equal(appShell.classList.contains("terminal-collapsed"), false);
    assert.equal(button.classList.contains("active"), true);
    assert.equal(button.attributes.get("aria-pressed"), "true");
    assert.equal(button.attributes.get("aria-expanded"), "true");
    assert.equal(expand.classList.contains("hidden"), true);

    controller.toggleTerminal(true);
    assert.equal(button.classList.contains("active"), false);
    assert.equal(button.attributes.get("aria-pressed"), "false");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("terminal management action cards omit redundant descriptions", () => {
  const previousDocument = globalThis.document;
  const elements = {
    appShell: { classList: classList(["terminal-collapsed"]) },
    terminalOutput: { textContent: "hello\nworld" },
  };
  globalThis.document = {
    body: { classList: classList() },
    getElementById: (id) => elements[id] || null,
  };
  try {
    const controller = createTerminalController({
      state: {
        agent: { cwd: "/workspace" },
        terminalPrefs: { clearOnReconnect: false, focusOnConnect: true, maxLines: 5000 },
        remoteAccess: { session: { remote: false }, capabilities: { terminalAllowed: true } },
      },
      formatNumber: (value) => String(value),
    });
    const html = controller.renderTerminalSettingsContent();
    const cards = html.match(/<button class="terminal-control-card settings-card"[\s\S]*?<\/button>/g) || [];

    assert.equal(cards.length, 4);
    cards.forEach((card) => assert.doesNotMatch(card, /<small>/));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("terminal policy enforcement closes an active socket after fail-closed downgrade", () => {
  const previousDocument = globalThis.document;
  const status = { textContent: "" };
  globalThis.document = {
    body: { classList: classList() },
    getElementById: (id) => id === "terminalStatus" ? status : null,
  };
  const closed = [];
  const state = {
    remoteAccessFailClosed: true,
    remoteAccess: {
      session: { remote: true, authenticated: true, mode: "full" },
      capabilities: { terminalAllowed: true, maxPermissionMode: "bypassPermissions", filesystemScope: "host" },
    },
    terminalWS: { close: (...args) => closed.push(args) },
  };
  try {
    const controller = createTerminalController({ state, refreshActiveSettingsPanel: () => {} });
    assert.equal(controller.enforceAccessPolicy(), false);
    assert.equal(state.terminalWS, null);
    assert.equal(state.terminalStatus, "remote-locked");
    assert.deepEqual(closed, [[1008, "remote access capability changed"]]);
    assert.match(status.textContent, /remote-locked|远程|Remote/i);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
