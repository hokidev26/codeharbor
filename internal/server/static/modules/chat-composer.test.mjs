import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { AUTOTO_LOCAL_TOKEN: "", CODEHARBOR_LOCAL_TOKEN: "" };
const { slashCommandsForEffectivePolicy } = await import("./chat-composer.mjs");

test("chat composer hides local templates until effective policy is authoritative", () => {
  const local = [{ id: "local", name: "/local", prompt: "local prompt", enabled: true }];
  assert.deepEqual(slashCommandsForEffectivePolicy({ hasAuthoritativeData: false, items: [] }, local), []);
  assert.deepEqual(slashCommandsForEffectivePolicy({ hasAuthoritativeData: true, items: [] }, local), [
    { id: "local-local", name: "/local", description: "", prompt: "local prompt", source: "local" },
  ]);
});

test("chat composer honors unusable effective owners as command shadows", () => {
  const commands = slashCommandsForEffectivePolicy({
    hasAuthoritativeData: true,
    items: [
      { id: "workspace-disabled", command: "/disabled", scope: "workspace", enabled: false, scanVerdict: "safe" },
      { id: "project-blocked", command: "/blocked", scope: "project", enabled: true, scanVerdict: "blocked" },
      { id: "workspace-review", command: "/review", scope: "workspace", enabled: true, scanVerdict: "review" },
      { id: "global-safe", command: "/safe", scope: "global", enabled: true, scanVerdict: "safe" },
    ],
  }, [
    { id: "local-disabled", name: "/disabled", prompt: "bypass disabled", enabled: true },
    { id: "local-blocked", name: "/blocked", prompt: "bypass blocked", enabled: true },
    { id: "local-review", name: "/review", prompt: "bypass review", enabled: true },
  ]);
  assert.deepEqual(commands, [
    { id: "server-global-safe", name: "/safe", description: "", prompt: "", source: "server" },
  ]);
});
