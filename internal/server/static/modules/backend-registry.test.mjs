import test from "node:test";
import assert from "node:assert/strict";

import { createBackendRegistryController } from "./backend-registry.mjs";

test("agent admin settings renders backend status without exposing an API key", () => {
  const controller = createBackendRegistryController({
    state: {
      backends: [{
        id: "backend-1",
        name: "<Primary>",
        kind: "cloud",
        baseUrl: "https://example.test",
        apiKeyConfigured: true,
        apiKey: "must-not-render",
        active: true,
        updatedAt: "2025-01-01T00:00:00Z",
      }],
      backendHealth: { backendId: "backend-1", ok: true, status: "Online" },
      backendActionBusy: {},
      backendDeleteConfirmId: "",
    },
  });

  const html = controller.renderAgentAdminSettingsContent();
  assert.match(html, /settings-page-section/);
  assert.match(html, /settings-stat-grid/);
  assert.match(html, /settings-data-list/);
  assert.match(html, /data-settings-backend-test="backend-1"/);
  assert.match(html, /id="settingsBackendForm"/);
  assert.match(html, /id="settingsBackendApiKey"[^>]*type="password"/);
  assert.match(html, /settings-badge ok/);
  assert.match(html, /&lt;Primary&gt;/);
  assert.doesNotMatch(html, /must-not-render/);
});
