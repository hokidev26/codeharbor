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
      state: {},
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
