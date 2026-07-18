import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBackendRegistryController } from "./backend-registry.mjs";

const sourceURL = new URL("./backend-registry.mjs", import.meta.url);

test("backend registry keeps modal management without the duplicate settings page", async () => {
  const controller = createBackendRegistryController({
    state: {
      backends: [{ id: "backend-1", name: "Primary", active: true }],
      backendHealth: null,
      backendActionBusy: {},
      backendDeleteConfirmId: "",
    },
  });
  const source = await readFile(sourceURL, "utf8");

  assert.equal(typeof controller.openBackendsModal, "function");
  assert.equal(typeof controller.renderBackendPanel, "function");
  assert.equal(typeof controller.loadBackends, "function");
  assert.equal("renderAgentAdminSettingsContent" in controller, false);
  assert.equal("bindAgentAdminSettingsActions" in controller, false);
  assert.doesNotMatch(source, /settingsBackendForm|data-settings-backend-test|agent-admin-page/);
});
