import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceSettingsController } from "./workspace-settings.mjs";

function createController(state) {
  return createWorkspaceSettingsController({
    state,
    currentProviderConfig: () => ({ kind: "local" }),
    getPreferredModel: () => "model-a",
    providerLabel: () => "Local",
    providerStatusText: () => "Ready",
    renderAgentModelOptions: (selected) => `<option value="${selected}" selected>${selected}</option>`,
    renderUsageMetricCard: (title, value, description) => `<div>${title}:${value}:${description}</div>`,
  });
}

test("agent settings retains form hooks and exposes the remote permission boundary", () => {
  const controller = createController({
    settings: { agent: {} },
    agent: {
      id: "agent-1",
      title: "<Agent>",
      type: "primary",
      status: "idle",
      model: "model-a",
      permissionMode: "bypassPermissions",
      planMode: true,
      cwd: "/tmp/project",
    },
    project: { gitPath: "/tmp/project" },
    runtimeSummary: { security: { bypassPermissionsAllowed: false } },
  });

  const html = controller.renderAgentSettingsContent();
  assert.match(html, /id="agentSettingsForm"/);
  assert.match(html, /id="agentSettingsPermissionMode"/);
  assert.match(html, /id="agentSettingsPlanMode"/);
  assert.match(html, /id="continuationSettingsForm"/);
  assert.match(html, /id="continuationMode"/);
  assert.match(html, /id="continuationTokenBudget"/);
  assert.match(html, /data-continuation-submit disabled/);
  assert.match(html, /<option value="true" selected>计划<\/option>/);
  assert.match(html, /settings-form-grid/);
  assert.match(html, /settings-alert/);
  assert.match(html, /value="bypassPermissions"[^>]*disabled/);
  assert.match(html, /&lt;Agent&gt;/);
});

test("agent settings persists the current Agent plan mode through the plan-mode endpoint", async () => {
  const previousDocument = globalThis.document;
  const requests = [];
  const submitButton = { disabled: false, dataset: {}, textContent: "Save", setAttribute() {}, removeAttribute() {} };
  let submitHandler = null;
  const form = {
    addEventListener(type, handler) { if (type === "submit") submitHandler = handler; },
    querySelector(selector) { return selector === "[data-agent-submit]" ? submitButton : null; },
  };
  const elements = {
    agentSettingsForm: form,
    agentSettingsModel: { value: "model-a" },
    agentSettingsPermissionMode: { value: "acceptEdits" },
    agentSettingsPlanMode: { value: "true" },
    agentSettingsReasoningEffort: { value: "" },
    agentSettingsCWD: { value: "/tmp/project" },
  };
  globalThis.document = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
  };
  try {
    const state = {
      settings: { agent: {} },
      agent: { id: "agent-1", model: "model-a", permissionMode: "acceptEdits", planMode: false, cwd: "/tmp/project" },
      project: { gitPath: "/tmp/project" },
    };
    const controller = createWorkspaceSettingsController({
      state,
      api: async (path, options) => {
        requests.push({ path, options });
        return { ...state.agent, planMode: JSON.parse(options.body).planMode };
      },
      currentProviderConfig: () => ({ kind: "local" }),
      getPreferredModel: () => "model-a",
      providerLabel: () => "Local",
      providerStatusText: () => "Ready",
      renderAgentModelOptions: () => "",
      renderUsageMetricCard: () => "",
      enterAgent: async () => {},
      setPreferredModel: () => {},
      refreshActiveSettingsPanel: () => {},
      showToast: () => {},
    });
    controller.bindAgentSettingsActions();
    await submitHandler({ preventDefault() {}, currentTarget: form });

    assert.deepEqual(requests, [{
      path: "/api/agents/agent-1/plan-mode",
      options: { method: "PATCH", body: JSON.stringify({ planMode: true }) },
    }]);
    assert.equal(state.agent.planMode, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("continuation settings use the advertised endpoint and preserve optional budgets", async () => {
  const previousDocument = globalThis.document;
  const requests = [];
  const submitButton = { disabled: false, dataset: {}, textContent: "Save", setAttribute() {}, removeAttribute() {} };
  let submitHandler = null;
  const continuationForm = {
    addEventListener(type, handler) { if (type === "submit") submitHandler = handler; },
    querySelector(selector) { return selector === "[data-continuation-submit]" ? submitButton : null; },
  };
  const elements = {
    continuationSettingsForm: continuationForm,
    continuationMode: { value: "safe" },
    continuationSegmentTurns: { value: "4" },
    continuationMaxContinuations: { value: "3" },
    continuationMaxTotalTurns: { value: "18" },
    continuationDuration: { value: "120000" },
    continuationTokenBudget: { value: "9000" },
  };
  globalThis.document = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
  };
  try {
    const state = { settings: { agent: { continuation: { mode: "off", settingsEndpoint: "/api/settings/agent/continuation" } } }, agent: null };
    const controller = createWorkspaceSettingsController({
      state,
      api: async (path, options) => {
        requests.push({ path, options });
        return { continuation: JSON.parse(options.body) };
      },
      currentProviderConfig: () => null,
      getPreferredModel: () => "",
      providerLabel: () => "",
      providerStatusText: () => "",
      renderAgentModelOptions: () => "",
      renderUsageMetricCard: () => "",
      refreshActiveSettingsPanel: () => {},
      showToast: () => {},
    });
    controller.bindAgentSettingsActions();
    await submitHandler({ preventDefault() {}, currentTarget: continuationForm });
    assert.equal(requests[0].path, "/api/settings/agent/continuation");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      mode: "safe",
      segmentTurns: 4,
      maxContinuations: 3,
      maxTotalTurns: 18,
      maxRunDurationMs: 120000,
      maxRunTokens: 9000,
    });
    assert.equal(state.settings.agent.continuation.mode, "safe");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("workline settings retains selection hooks in shared data rows", () => {
  const controller = createController({
    project: { id: "project-1", name: "Project", gitPath: "/tmp/project", status: "active" },
    workline: { id: "workline-1", title: "Main", role: "root", branch: "main", worktreePath: "/tmp/project", baseBranch: "main" },
    agent: { id: "agent-1", title: "Primary", permissionMode: "acceptEdits", cwd: "/tmp/project" },
    projectWorklines: [{ id: "workline-1", title: "Main", isRoot: true, status: "active", branch: "main" }],
    worklineAgents: [{ id: "agent-1", title: "Primary", type: "primary", status: "idle", permissionMode: "acceptEdits", cwd: "/tmp/project" }],
  });

  const html = controller.renderWorklinesSettingsContent();
  assert.match(html, /settings-data-list/);
  assert.match(html, /settings-data-row active/);
  assert.match(html, /data-select-workline="workline-1"/);
  assert.match(html, /data-select-agent="agent-1"/);
  assert.match(html, /settings-card/);
});
