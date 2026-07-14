import test from "node:test";
import assert from "node:assert/strict";

import { createGitWorkflowController } from "./git-workflow.mjs";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    toggle(name, force) {
      if (force === undefined) force = !values.has(name);
      if (force) values.add(name);
      else values.delete(name);
      return force;
    },
    contains: (name) => values.has(name),
  };
}

test("Git header button distinguishes dirty state from an open modal", () => {
  const badge = { textContent: "", classList: classList(["hidden"]) };
  const button = {
    disabled: true,
    title: "",
    classList: classList(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelector(selector) { return selector === "[data-git-tool-badge]" ? badge : null; },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => id === "gitWorkflowBtn" ? button : null };
  try {
    const state = {
      agent: { id: "agent-1" },
      gitOpen: false,
      gitError: "",
      gitStatus: { clean: false, files: [{ path: "a" }, { path: "b" }] },
    };
    const controller = createGitWorkflowController({ state });
    controller.renderGitButtonState();

    assert.equal(button.disabled, false);
    assert.equal(button.classList.contains("has-changes"), true);
    assert.equal(button.classList.contains("active"), false);
    assert.equal(badge.textContent, "2");
    assert.equal(badge.classList.contains("hidden"), false);
    assert.equal(button.attributes.get("aria-expanded"), "false");

    state.gitOpen = true;
    controller.renderGitButtonState();
    assert.equal(button.classList.contains("active"), true);
    assert.equal(button.classList.contains("has-changes"), false);
    assert.equal(button.attributes.get("aria-expanded"), "true");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
