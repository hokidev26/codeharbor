import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { AUTOTO_LOCAL_TOKEN: "", CODEHARBOR_LOCAL_TOKEN: "" };
const {
  calculateMessageInputSize,
  createChatComposerController,
  normalizeReasoningEffort,
  reasoningEffortValuesForCapabilities,
  resizeMessageInputElement,
  slashCommandsForEffectivePolicy,
} = await import("./chat-composer.mjs");

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

test("reasoning effort normalizes legacy and unknown values against backend capabilities", () => {
  assert.equal(normalizeReasoningEffort(""), "auto");
  assert.equal(normalizeReasoningEffort("inherit"), "auto");
  assert.equal(normalizeReasoningEffort("MEDIUM"), "medium");
  assert.equal(normalizeReasoningEffort("extreme"), "auto");
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEffort: false }), ["auto"]);
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEffort: true }), ["auto", "low", "medium", "high"]);
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEfforts: ["low", "xhigh", "unknown"] }), ["auto", "low", "xhigh"]);
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEffortValues: ["medium", "unknown"] }), ["auto", "medium"]);
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEffort: { supportedValues: ["high", "xhigh"] } }), ["auto", "high", "xhigh"]);
  assert.deepEqual(reasoningEffortValuesForCapabilities({ reasoningEffort: ["low", "xhigh"] }), ["auto", "low", "xhigh"]);
  assert.equal(normalizeReasoningEffort("xhigh", ["auto", "low", "xhigh"]), "xhigh");
  assert.equal(normalizeReasoningEffort("xhigh", ["auto", "low", "high"]), "auto");
});

test("message textarea autosize clamps to bounds and toggles internal scrolling", () => {
  assert.deepEqual(calculateMessageInputSize({ scrollHeight: 20, minHeight: 44, maxHeight: 128 }), { height: 44, scrollable: false });
  assert.deepEqual(calculateMessageInputSize({ scrollHeight: 96, minHeight: 44, maxHeight: 128 }), { height: 96, scrollable: false });
  assert.deepEqual(calculateMessageInputSize({ scrollHeight: 220, minHeight: 44, maxHeight: 128 }), { height: 128, scrollable: true });

  const toggles = [];
  const input = {
    scrollHeight: 220,
    style: {},
    classList: { toggle(name, active) { toggles.push([name, active]); } },
  };
  const computedStyle = {
    minHeight: "44px",
    maxHeight: "128px",
    getPropertyValue() { return ""; },
  };
  assert.deepEqual(resizeMessageInputElement(input, computedStyle), { height: 128, scrollable: true });
  assert.equal(input.style.height, "128px");
  assert.equal(input.style.overflowY, "auto");
  assert.deepEqual(toggles.at(-1), ["message-input-scrollable", true]);

  input.scrollHeight = 30;
  assert.deepEqual(resizeMessageInputElement(input, computedStyle), { height: 44, scrollable: false });
  assert.equal(input.style.height, "44px");
  assert.equal(input.style.overflowY, "hidden");
  assert.deepEqual(toggles.at(-1), ["message-input-scrollable", false]);
});

test("reasoning effort control crops unsupported values when the selected model changes", () => {
  const elements = {};
  const pill = { classList: { toggle() {} } };
  elements.reasoningEffort = {
    value: "auto",
    innerHTML: "",
    disabled: false,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    closest() { return pill; },
  };
  elements.reasoningEffortDisplay = { textContent: "" };
  elements.modelSelect = { value: "reasoning:model" };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  try {
    const controller = createChatComposerController({
      state: { agent: { id: "agent-1", model: "reasoning:model", reasoningEffort: "high" } },
      currentProviderConfig: (model) => ({ capabilities: model === "basic:model" ? { reasoningEffort: false } : { reasoningEffort: true } }),
    });

    assert.equal(controller.refreshReasoningEffortControl(), "high");
    assert.equal(controller.refreshReasoningEffortControl({ modelValue: "basic:model" }), "auto");
    assert.equal(elements.reasoningEffort.value, "auto");
    assert.equal(elements.reasoningEffort.disabled, true);
    assert.equal(elements.reasoningEffortDisplay.textContent, "自动");
    assert.equal(controller.selectedReasoningEffort("basic:model"), "auto");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("reasoning effort control persists the selected Agent override", async () => {
  const elements = {};
  const pillClasses = [];
  const pill = { classList: { toggle(name, active) { pillClasses.push([name, active]); } } };
  elements.reasoningEffort = {
    value: "auto",
    innerHTML: "",
    disabled: false,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    closest() { return pill; },
  };
  elements.reasoningEffortDisplay = { textContent: "" };
  elements.modelSelect = { value: "openai:gpt-5" };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  const requests = [];
  const state = {
    agent: { id: "agent-1", model: "openai:gpt-5", reasoningEffort: "low" },
    reasoningEffortSaving: false,
    reasoningEffortPending: undefined,
  };
  try {
    const controller = createChatComposerController({
      state,
      currentProviderConfig: () => ({ capabilities: { reasoningEffort: true } }),
      request: async (path, options) => {
        requests.push({ path, options });
        return { ...state.agent, reasoningEffort: JSON.parse(options.body).reasoningEffort };
      },
    });

    assert.equal(controller.refreshReasoningEffortControl(), "low");
    assert.equal(elements.reasoningEffort.value, "low");
    await controller.saveReasoningEffort("high");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/agents/agent-1/reasoning-effort");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      reasoningEffort: "high",
      model: "openai:gpt-5",
      entityGeneration: 0,
    });
    assert.equal(state.agent.reasoningEffort, "high");
    assert.equal(elements.reasoningEffortDisplay.textContent, "高");
    assert.ok(pillClasses.some(([name]) => name === "reasoning-effort-saving"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("reasoning effort saves remain isolated when switching Agents", async () => {
  const elements = {};
  const pill = { classList: { toggle() {} } };
  elements.reasoningEffort = {
    value: "auto",
    innerHTML: "",
    disabled: false,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    closest() { return pill; },
  };
  elements.reasoningEffortDisplay = { textContent: "" };
  elements.modelSelect = { value: "openai:model-a" };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  const requests = [];
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const state = { agent: { id: "agent-a", model: "openai:model-a", reasoningEffort: "low" } };
  try {
    const controller = createChatComposerController({
      state,
      currentProviderConfig: () => ({ capabilities: { reasoningEffort: true } }),
      request: (path, options) => {
        const pending = deferred();
        requests.push({ path, options, ...pending });
        return pending.promise;
      },
    });

    const savingA = controller.saveReasoningEffort("high");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/agents/agent-a/reasoning-effort");

    state.agent = { id: "agent-b", model: "openai:model-b", reasoningEffort: "medium" };
    elements.modelSelect.value = "openai:model-b";
    const savingB = controller.saveReasoningEffort("low");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].path, "/api/agents/agent-b/reasoning-effort");

    requests[0].resolve({ id: "agent-a", model: "openai:model-a", reasoningEffort: "high" });
    await savingA;
    assert.equal(state.agent.id, "agent-b");
    assert.equal(state.agent.reasoningEffort, "low");

    requests[1].resolve({ id: "agent-b", model: "openai:model-b", reasoningEffort: "low" });
    await savingB;
    assert.equal(state.agent.id, "agent-b");
    assert.equal(state.agent.reasoningEffort, "low");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("reasoning effort responses cannot overwrite a newer model state", async () => {
  const elements = {};
  const pill = { classList: { toggle() {} } };
  elements.reasoningEffort = {
    value: "auto",
    innerHTML: "",
    disabled: false,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
    closest() { return pill; },
  };
  elements.reasoningEffortDisplay = { textContent: "" };
  elements.modelSelect = { value: "reasoning:model" };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  let resolveRequest;
  const state = {
    agent: { id: "agent-1", model: "reasoning:model", reasoningEffort: "low", entityGeneration: 7 },
  };
  try {
    const controller = createChatComposerController({
      state,
      currentProviderConfig: (model) => ({ capabilities: model === "basic:model" ? { reasoningEffort: false } : { reasoningEffort: true } }),
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
    });

    const saving = controller.saveReasoningEffort("high");
    state.agent = { id: "agent-1", model: "basic:model", reasoningEffort: "auto", entityGeneration: 8 };
    elements.modelSelect.value = "basic:model";
    resolveRequest({ id: "agent-1", model: "reasoning:model", reasoningEffort: "high", entityGeneration: 8 });
    await saving;

    assert.deepEqual(state.agent, { id: "agent-1", model: "basic:model", reasoningEffort: "auto", entityGeneration: 8 });
  } finally {
    globalThis.document = previousDocument;
  }
});

test("message textarea autosizes restored drafts, input, scheduled paste measurement, and send reset", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const classChanges = [];
  let messageValue = "";
  const input = {
    scrollHeight: 46,
    style: {},
    classList: { toggle(name, active) { classChanges.push([name, active]); } },
    get value() { return messageValue; },
    set value(value) {
      messageValue = String(value || "");
      this.scrollHeight = messageValue ? 220 : 46;
    },
    setAttribute() {},
    removeAttribute() {},
    focus() {},
  };
  const elements = {
    messageText: input,
    messageForm: { requestSubmit() {} },
    promptHistoryHint: { textContent: "" },
    slashCommandPalette: { classList: { add() {}, remove() {} }, innerHTML: "" },
  };
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  globalThis.window = { ...previousWindow, setTimeout(callback) { callback(); } };
  globalThis.getComputedStyle = () => ({ minHeight: "46px", maxHeight: "128px", getPropertyValue() { return ""; } });
  globalThis.requestAnimationFrame = (callback) => callback();
  const state = {
    agent: { id: "agent-1", model: "openai:model" },
    chatDrafts: { "agent-1": "saved draft" },
    promptHistory: [],
    pendingAttachments: [],
    serverSkills: [],
  };
  try {
    const controller = createChatComposerController({
      state,
      currentSkillsPreferences: () => ({ commands: [] }),
      isCurrentModelConfigured: () => true,
      loadMessages: async () => {},
      onMessageAccepted: async () => {},
      request: async () => ({}),
      scheduleMessageRefresh() {},
    });

    controller.restoreCurrentChatDraft();
    assert.equal(input.value, "saved draft");
    assert.equal(input.style.height, "128px");
    assert.equal(input.style.overflowY, "auto");

    input.value = "typed";
    input.scrollHeight = 96;
    controller.handleMessageInput();
    assert.equal(input.style.height, "96px");
    assert.equal(input.style.overflowY, "hidden");
    assert.equal(state.chatDrafts["agent-1"], "typed");

    input.scrollHeight = 220;
    controller.scheduleMessageInputResize();
    assert.equal(input.style.height, "128px");
    assert.equal(input.style.overflowY, "auto");

    await controller.sendMessage({ preventDefault() {} });
    assert.equal(input.value, "");
    assert.equal(input.style.height, "46px");
    assert.equal(input.style.overflowY, "hidden");
    assert.equal(state.chatDrafts["agent-1"], undefined);
    assert.deepEqual(classChanges.at(-1), ["message-input-scrollable", false]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.getComputedStyle = previousGetComputedStyle;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("message textarea Enter submission preserves IME and Shift+Enter behavior", () => {
  const previousDocument = globalThis.document;
  let submitted = 0;
  const input = {
    value: "hello",
    scrollHeight: 46,
    style: {},
    classList: { toggle() {} },
    setAttribute() {},
    removeAttribute() {},
  };
  const elements = {
    messageText: input,
    messageForm: { requestSubmit() { submitted += 1; } },
    promptHistoryHint: { textContent: "" },
    slashCommandPalette: { classList: { add() {}, remove() {} }, innerHTML: "" },
  };
  globalThis.document = { getElementById(id) { return elements[id] || null; } };
  try {
    const controller = createChatComposerController({
      state: { agent: { id: "agent-1" }, promptHistory: [], serverSkills: [] },
      currentSkillsPreferences: () => ({ commands: [] }),
      isComposingInput: (event) => Boolean(event.isComposing || event.keyCode === 229),
    });
    const keydown = (extra = {}) => {
      let prevented = false;
      controller.handleMessageKeydown({ key: "Enter", preventDefault() { prevented = true; }, ...extra });
      return prevented;
    };

    assert.equal(keydown({ isComposing: true }), false);
    assert.equal(keydown({ keyCode: 229 }), false);
    assert.equal(keydown({ shiftKey: true }), false);
    assert.equal(keydown(), true);
    assert.equal(submitted, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});
