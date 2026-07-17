import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsPanelRegistry } from "./settings-panel-registry.mjs";

test("register stores render and resolves normalized keys", () => {
  const registry = createSettingsPanelRegistry();
  const render = (item) => `<p>${item.label}</p>`;

  assert.equal(registry.register(" profile ", { render }), registry);
  const panel = registry.resolve("profile");

  assert.equal(panel.render({ label: "Profile" }), "<p>Profile</p>");
  assert.equal(panel.bind, undefined);
});

test("register rejects empty keys and definitions without render", () => {
  const registry = createSettingsPanelRegistry();

  assert.throws(() => registry.register("", { render() {} }), /key must not be empty/);
  assert.throws(() => registry.register("   ", { render() {} }), /key must not be empty/);
  assert.throws(() => registry.register("profile", {}), /render must be a function/);
  assert.throws(() => registry.register("about", { render() {}, layout: "   " }), /layout must be a non-empty string/);
  assert.throws(() => registry.register("about", { render() {}, layout: 2 }), /layout must be a non-empty string/);
});

test("register rejects duplicate keys", () => {
  const registry = createSettingsPanelRegistry();
  registry.register("profile", { render: () => "profile" });

  assert.throws(() => registry.register(" profile ", { render: () => "duplicate" }), /already registered: profile/);
});

test("resolve returns undefined for unknown keys", () => {
  const registry = createSettingsPanelRegistry();

  assert.equal(registry.resolve("unknown"), undefined);
});

test("register stores an optional normalized layout contract", () => {
  const registry = createSettingsPanelRegistry();
  registry.register("about", { render: () => "about", layout: " about " });

  assert.equal(registry.resolve("about").layout, "about");
});

test("bind is optional and invoked from a resolved panel", () => {
  const calls = [];
  const registry = createSettingsPanelRegistry();
  registry.register("runtime", {
    render: () => "runtime",
    bind: (...args) => calls.push(args),
  });

  registry.resolve("runtime").bind("runtime", { ready: true });

  assert.deepEqual(calls, [["runtime", { ready: true }]]);
});
