import test from "node:test";
import assert from "node:assert/strict";

import {
  chatMessagePresentation,
  createChatRenderingController,
  formatTurnUsagePerformance,
  normalizeAgentPlan,
  normalizeToolActivity,
  normalizeTurnUsage,
  renderToolActivityStackHTML,
  renderToolDiffHTML,
} from "./chat-rendering.mjs";

function fakeMessagesElement() {
  const classes = new Set(["empty"]);
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML(_position, html) { this.innerHTML += html; },
    scrollHeight: 100,
    scrollTop: 0,
  };
}

function renderSnapshot(messages, stateOverrides = {}, applyOptions = {}) {
  const messagesElement = fakeMessagesElement();
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return id === "messages" ? messagesElement : null;
    },
  };
  const state = {
    agent: { id: "agent-1", cwd: "/work/project" },
    currentMessages: [],
    messageCopyTexts: [],
    liveToolOutputs: {},
    liveAssistantActive: false,
    liveAssistantText: "",
    liveAssistantRequestId: "",
    liveAssistantRunId: "",
    liveAssistantStartedAt: "",
    liveAssistantPerformance: null,
    pendingToolApprovals: {},
    activeRunSummary: null,
    activeRunSummaryRunId: "",
    runSummaryLoading: false,
    runSummaryError: "",
    ...stateOverrides,
  };
  try {
    const controller = createChatRenderingController({
      state,
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });
    assert.equal(controller.applyMessageSnapshot(messages, "agent-1", applyOptions), true);
    return { html: messagesElement.innerHTML, state };
  } finally {
    globalThis.document = previousDocument;
  }
}

test("chatMessagePresentation keeps user semantics while aligning messages left", () => {
  assert.deepEqual(chatMessagePresentation({ role: "user" }).alignment, "left");
  assert.deepEqual(chatMessagePresentation({ role: "user" }).roleClass, "user");
  assert.deepEqual(chatMessagePresentation({ role: "HUMAN" }).alignment, "left");
  assert.deepEqual(chatMessagePresentation({ role: "HUMAN" }).roleClass, "user");
  for (const role of ["assistant", "tool", "system", "error", "task_report", "legacy", ""]) {
    assert.equal(chatMessagePresentation({ role }).alignment, "left", role);
  }
  const persistedToolResult = chatMessagePresentation({ role: "user", parentToolUseId: "tool-1" });
  assert.equal(persistedToolResult.alignment, "left");
  assert.equal(persistedToolResult.roleClass, "assistant");
  assert.equal(persistedToolResult.normalizedRole, "tool");
});

test("chat hydration batches message snapshots until the final forced render", () => {
  const deferred = renderSnapshot([{ role: "assistant", contentText: "ready" }], { chatHydrating: true });
  assert.equal(deferred.html, "");
  assert.equal(deferred.state.currentMessages[0].contentText, "ready");

  const committed = renderSnapshot([{ role: "assistant", contentText: "ready" }], { chatHydrating: true }, { forceRender: true });
  assert.match(committed.html, /ready/);
});

test("message rendering aligns user, assistant, legacy, and streaming messages left", () => {
  const { html, state } = renderSnapshot([
    { role: "user", contentText: "hello", createdAt: "2026-02-03T04:05:06Z" },
    { role: "assistant", contentText: "reply" },
    { role: "tool", contentText: "legacy result" },
    { role: "assistant", contentText: "streaming", streaming: true },
  ]);

  assert.match(html, /class="message user chat-message chat-flow-item chat-flow-left" data-chat-alignment="left"/);
  assert.equal((html.match(/data-chat-alignment="left" data-message-role=/g) || []).length, 4);
  assert.match(html, /class="message assistant chat-message chat-flow-item chat-flow-left"[^>]*data-message-role="tool"/);
  assert.match(html, /class="message-avatar" aria-hidden="true">U<\/span>/);
  assert.match(html, /<time class="message-time" datetime="2026-02-03T04:05:06Z" title="[^"]+">[^<]+<\/time>/);
  assert.ok(html.indexOf('class="message-meta"') < html.indexOf('class="message-head-actions"'));
  assert.ok(html.indexOf('class="message-head-actions"') < html.indexOf('class="message-time"'));
  assert.equal((html.match(/data-copy-message=/g) || []).length, 4);
  assert.deepEqual(state.messageCopyTexts, ["hello", "reply", "legacy result", "streaming"]);
});

test("message correction editor exposes a neutral editing-state style hook", () => {
  const { html } = renderSnapshot([{
    id: "message-1",
    role: "user",
    contentText: "original text",
  }], {
    editingMessageId: "message-1",
    correctionText: "updated text",
    correctionFiles: [],
  });

  assert.match(html, /class="message user message-editing chat-message/);
  assert.match(html, /class="message-correction-editor"/);
  assert.match(html, />updated text<\/textarea>/);
});

test("task reports, tool output, approvals, and errors expose left-aligned bounded-layout hooks", () => {
  const { html } = renderSnapshot([
    { role: "error", contentText: "request failed" },
  ], {
    liveToolOutputs: {
      tool1: { agentId: "agent-1", toolUseId: "tool1", toolName: "Bash", status: "running", output: "working" },
    },
    pendingToolApprovals: {
      approval1: { agentId: "agent-1", toolUseId: "approval1", toolName: "Bash", command: "pwd", risk: "exec" },
    },
    activeRunSummaryRunId: "run-1",
    activeRunSummary: {
      run: { id: "run-1", status: "error", checkpointState: "none", createdAt: "2026-02-03T00:00:00Z", completedAt: "2026-02-03T00:01:00Z" },
      toolCalls: [],
      recentMessages: [],
    },
    runSummaryError: "<run error>",
  });

  assert.match(html, /data-message-role="error"/);
  assert.match(html, /class="live-tool-output-stack tool-activity-stack chat-flow-stack chat-flow-left" data-chat-alignment="left"/);
  assert.match(html, /data-chat-report="tool-activity"/);
  assert.match(html, /tool-activity-summary/);
  assert.match(html, /data-chat-report="run-summary"/);
  assert.match(html, /data-chat-report="tool-approval"/);
  assert.doesNotMatch(html, /<run error>/);
  assert.match(html, /&lt;run error&gt;/);
});

test("plan cards render pending review data safely and react to live plan events", () => {
  const rawPlan = {
    id: `plan\" onmouseover=\"boom`,
    goal: `<Ship auth safely>`,
    status: "pending_approval",
    steps: [{ title: "Map <routes>", description: "Check middleware", status: "draft" }],
    risks: ["Do not expose <tokens>"],
    reviewVerdict: "review",
    reviewFindings: ["Check <CSRF> handling"],
    staleReason: "<workspace changed>",
  };
  const normalized = normalizeAgentPlan(rawPlan, "agent-1");
  assert.equal(normalized.agentId, "agent-1");
  assert.equal(normalized.steps[0].detail, "Check middleware");

  const { html, state } = renderSnapshot([], {
    activePlan: rawPlan,
    pendingPlanApproval: rawPlan,
    planActionBusy: {},
  });
  assert.match(html, /data-chat-report="agent-plan"/);
  assert.match(html, /data-plan-action="approve"/);
  assert.match(html, /data-plan-action="cancel"/);
  assert.match(html, /data-plan-action="replan"/);
  assert.doesNotMatch(html, /data-plan-action="execute"/);
  assert.match(html, /&lt;Ship auth safely&gt;/);
  assert.match(html, /Map &lt;routes&gt;/);
  assert.match(html, /Check &lt;CSRF&gt; handling/);
  assert.match(html, /&lt;workspace changed&gt;/);
  assert.doesNotMatch(html, /onmouseover="boom"|<Ship auth safely>/);

  const previousDocument = globalThis.document;
  const messagesElement = fakeMessagesElement();
  globalThis.document = { getElementById(id) { return id === "messages" ? messagesElement : null; } };
  try {
    const liveState = { ...state, chatHydrating: true };
    const controller = createChatRenderingController({
      state: liveState,
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });
    assert.equal(controller.applyPlanEvent({ type: "plan.approved", agentId: "agent-1", data: { plan: { ...rawPlan, status: "approved" } } }), true);
    assert.equal(liveState.activePlan.status, "approved");
    assert.equal(liveState.pendingPlanApproval, null);
    assert.equal(controller.applyPlanEvent({ type: "plan.stale", agentId: "agent-1", text: "changed files", data: { plan: { ...rawPlan, staleReason: "", status: "stale" } } }), true);
    assert.equal(liveState.activePlan.status, "stale");
    assert.equal(liveState.activePlan.staleReason, "changed files");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("plan actions use the Agent plan action contract and update local state", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const messagesElement = fakeMessagesElement();
  const requests = [];
  globalThis.document = { getElementById(id) { return id === "messages" ? messagesElement : null; } };
  globalThis.window = { setTimeout() { return 0; }, clearTimeout() {} };
  try {
    const state = {
      agent: { id: "agent-1" },
      currentMessages: [],
      activePlan: { id: "plan-1", revision: 3, goal: "Ship it", status: "approved" },
      pendingPlanApproval: null,
      planActionBusy: {},
      chatHydrating: true,
    };
    const controller = createChatRenderingController({
      state,
      apiRequest: async (path, options) => {
        requests.push({ path, options });
        return { plan: { id: "plan-1", goal: "Ship it", status: "executing" } };
      },
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });

    await controller.performPlanAction("plan-1", "execute");
    assert.deepEqual(requests, [{
      path: "/api/agents/agent-1/plans/plan-1/execute",
      options: { method: "POST", body: "{\"revision\":3}" },
    }]);
    assert.equal(state.activePlan.status, "executing");
    assert.deepEqual(state.planActionBusy, {});
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("message rendering escapes role, text, and code attributes without breaking markdown or copy", () => {
  const { html } = renderSnapshot([
    {
      role: `user\" onmouseover=\"boom`,
      contentText: `<img src=x onerror=boom>\n\n\`\`\`js\nconst value = \"<unsafe>\";\n\`\`\``,
    },
  ]);

  assert.match(html, /data-chat-alignment="left"/);
  assert.doesNotMatch(html, /<img src=x|onmouseover="boom/);
  assert.match(html, /&lt;img src=x onerror=boom&gt;/);
  assert.match(html, /user&quot; onmouseover=&quot;boom/);
  assert.match(html, /class="code-block"/);
  assert.match(html, /class="copy-code"/);
  assert.match(html, /data-copy-message="0"/);
});

test("model generation renders a waiting assistant card before the first text delta", () => {
  const { html } = renderSnapshot([], {
    liveAssistantActive: true,
    liveAssistantRequestId: "request-1",
    liveAssistantRunId: "run-1",
    liveAssistantStartedAt: "2026-03-16T10:00:00Z",
  });

  assert.match(html, /data-live-assistant/);
  assert.match(html, /data-request-id="request-1"/);
  assert.match(html, /data-started-at="2026-03-16T10:00:00Z"/);
  assert.match(html, /等待首 token/);
  assert.doesNotMatch(html, /class="empty-conversation-state"/);
});

test("live estimated performance is compact and visibly approximate", () => {
  const { html } = renderSnapshot([], {
    liveAssistantActive: true,
    liveAssistantText: "streaming reply",
    liveAssistantRequestId: `request\" onmouseover=\"boom`,
    liveAssistantRunId: `<run-id>`,
    liveAssistantPerformance: {
      outputTokens: 36,
      ttftMs: 820,
      durationMs: 2300,
      tokensPerSecond: 24.6,
      estimated: true,
    },
  });

  assert.match(html, /≈吞吐量 24\.6 tok\/s \| TTFT 0\.8s/);
  assert.match(html, /message-performance-live is-estimated/);
  assert.ok(html.indexOf("message-performance-live") < html.indexOf("message-content"), "live metrics should render in the card header");
  assert.match(html, /request&quot; onmouseover=&quot;boom/);
  assert.match(html, /data-run-id="&lt;run-id&gt;"/);
  assert.doesNotMatch(html, /onmouseover="boom"|<run-id>/);
});

test("historical assistant messages render precise persisted turn usage without approximation", () => {
  const { html } = renderSnapshot([{
    role: "assistant",
    contentText: "final reply",
    turnUsage: {
      inputTokens: 120,
      outputTokens: 36,
      cachedInputTokens: 20,
      reasoningTokens: 8,
      ttftMs: 820,
      durationMs: 2300,
      tokensPerSecond: 24.6,
      estimated: false,
    },
  }]);

  assert.match(html, /class="message-performance"/);
  assert.match(html, /吞吐量 24\.6 tok\/s \| TTFT 0\.8s/);
  assert.ok(html.indexOf("final reply") < html.indexOf("message-performance"), "persisted metrics should render in the message footer");
  assert.doesNotMatch(html, /≈|is-estimated/);
});

test("turn usage performance labels are localized in all supported UI languages", () => {
  const usage = { tokensPerSecond: 12.34, ttftMs: 780, estimated: true };
  assert.equal(formatTurnUsagePerformance(usage, { locale: "en" }), "≈Throughput 12.3 tok/s | TTFT 0.8s");
  assert.equal(formatTurnUsagePerformance(usage, { locale: "zh-CN" }), "≈吞吐量 12.3 tok/s | TTFT 0.8s");
  assert.equal(formatTurnUsagePerformance(usage, { locale: "zh-TW" }), "≈吞吐量 12.3 tok/s | TTFT 0.8s");
});

test("turn usage normalization drops zero, negative, non-finite, extreme, and injectable values", () => {
  assert.deepEqual(normalizeTurnUsage({
    inputTokens: -1,
    outputTokens: 0,
    cachedInputTokens: Number.NaN,
    reasoningTokens: 1e12,
    ttftMs: Number.POSITIVE_INFINITY,
    durationMs: 999999999999,
    tokensPerSecond: `<img src=x onerror=boom>`,
    estimated: true,
  }), {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    ttftMs: null,
    durationMs: null,
    tokensPerSecond: null,
    estimated: true,
  });
  assert.equal(normalizeTurnUsage({ ttftMs: 0 }).ttftMs, 0);
  assert.equal(formatTurnUsagePerformance({ ttftMs: 0 }, { locale: "en" }), "TTFT 0.0s");
  assert.equal(formatTurnUsagePerformance({ outputTokens: 0, durationMs: -4, tokensPerSecond: Number.NaN }, { locale: "en" }), "");
  const { html } = renderSnapshot([{ role: "assistant", contentText: "safe", turnUsage: { tokensPerSecond: `<svg onload=boom>` } }]);
  assert.doesNotMatch(html, /<svg|onload=boom|message-performance/);
});

test("tool activity renders every supported tool as an auditable process without hidden-reasoning wording", () => {
  const html = renderToolActivityStackHTML([
    { toolUseId: "grep", toolName: "Grep", status: "completed", inputJson: { path: "src", pattern: "TODO" } },
    { toolUseId: "read", toolName: "Read", status: "completed", inputJson: { file_path: "src/main.mjs", pages: "1-2" } },
    { toolUseId: "edit", toolName: "Edit", status: "completed", inputJson: { file_path: "src/main.mjs", old_string: "old", new_string: "new" } },
    { toolUseId: "write", toolName: "Write", status: "completed", inputJson: { file_path: "notes.txt" } },
    { toolUseId: "glob", toolName: "Glob", status: "completed", inputJson: { path: "src", pattern: "**/*.mjs" } },
    { toolUseId: "bash", toolName: "Bash", status: "running", inputJson: { command: "node --test" }, executionDeviceId: "local" },
  ]);

  for (const tool of ["Grep", "Read", "Edit", "Write", "Glob", "Bash"]) assert.match(html, new RegExp(`>${tool}<`));
  for (const className of ["tool-activity-stack", "tool-activity-group", "tool-activity-summary", "tool-activity-steps", "tool-activity-card", "tool-activity-details", "status-running", "status-completed"]) {
    assert.match(html, new RegExp(className));
  }
  assert.match(html, /本(?:机|地)服务/);
  assert.match(html, /可审计摘要/);
  assert.doesNotMatch(html, /思维链已加密|chain of thought encrypted/i);
});

test("tool activity escapes dangerous data and bounds command and output rendering", () => {
  const hostile = `<img src=x onerror="boom">`;
  const html = renderToolActivityStackHTML([{
    toolUseId: `id\" onmouseover=\"boom`,
    toolName: hostile,
    status: "error",
    inputJson: { command: hostile.repeat(400) },
    output: hostile.repeat(400),
    errorMessage: hostile,
  }]);

  assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.doesNotMatch(html, /<img|onmouseover="boom"/);
  assert.match(html, /status-error/);
  assert.ok(html.length < 40_000, "tool data should be bounded");
});

test("tool activity keeps legacy data compatible when safety facts are absent", () => {
  const normalized = normalizeToolActivity({
    toolUseId: "legacy-bash",
    toolName: "Bash",
    status: "completed",
    inputJson: { command: "node --test" },
  });

  assert.equal(normalized.eventVersion, null);
  assert.equal(normalized.decision, "");
  assert.equal(normalized.decisionSource, "");
  assert.equal(normalized.decisionScope, "");
  assert.equal(normalized.ruleId, "");
  assert.equal(normalized.commandFacts, null);
  assert.equal(normalized.permissionDecisionReason, "");
});

test("tool activity warns when dynamic commands cannot be classified reliably", () => {
  const call = {
    toolUseId: "dynamic-bash",
    toolName: "Bash",
    status: "waiting_approval",
    shellSafe: false,
    commandFacts: {
      parseKnown: true,
      program: "dynamic",
      commandCount: 1,
    },
  };
  const normalized = normalizeToolActivity(call);
  const html = renderToolActivityStackHTML([call]);

  assert.equal(normalized.shellSafe, false);
  assert.equal(normalized.commandFacts.program, "dynamic");
  assert.match(html, /无法可靠分类该动态命令；批准前请核对完整命令与展开后的行为/);
});

test("tool activity renders bounded localized safety facts without command parameters", () => {
  const secret = "super-secret-token";
  const call = {
    toolUseId: "facts-1",
    toolName: "Bash",
    status: "denied",
    eventVersion: 2,
    decision: "deny",
    decisionSource: "rule",
    ruleId: "rule-42",
    decisionScope: "session",
    permissionDecisionReason: "Denied <by policy>",
    commandFacts: {
      parseKnown: true,
      program: "git",
      subcommand: "status",
      commandCount: 2,
      compound: true,
      pipeline: true,
      redirection: true,
      substitution: true,
      background: true,
      effects: ["network-access"],
      dangerous: ["git-reset-hard"],
      injected: `<img src=x data-secret=${secret}>`,
    },
  };
  const normalized = normalizeToolActivity(call);
  const html = renderToolActivityStackHTML([call]);

  assert.deepEqual(normalized.commandFacts, {
    parseKnown: true,
    program: "git",
    subcommand: "status",
    commandCount: 2,
    compound: true,
    pipeline: true,
    redirection: true,
    substitution: true,
    background: true,
    effects: ["network-access"],
    dangerous: ["git-reset-hard"],
  });
  assert.equal(normalized.eventVersion, 2);
  assert.equal(normalized.decisionSource, "rule");
  assert.equal(normalized.decisionScope, "session");
  assert.match(html, /来源：权限规则/);
  assert.match(html, /作用域：本次会话/);
  assert.match(html, /安全判定/);
  for (const label of ["复合", "管道", "重定向", "命令替换", "后台", "程序：git", "白名单子命令：status", "影响：network-access", "危险：git-reset-hard"]) assert.match(html, new RegExp(label));
  assert.match(html, /Denied &lt;by policy&gt;/);
  assert.doesNotMatch(html, new RegExp(secret));
  assert.doesNotMatch(html, /<img/);
});

test("tool activity rejects malformed command facts and bounds fact arrays", () => {
  const secret = "secret-argument-should-not-render";
  const normalized = normalizeToolActivity({
    toolUseId: "facts-invalid",
    toolName: "Bash",
    eventVersion: "2",
    decision: "allow_everything",
    decisionSource: "<unsafe-source>",
    ruleId: `<${secret}>`,
    decisionScope: "all",
    permissionDecidedBy: "policy",
    permissionDecisionReason: `<img src=x>${"x".repeat(1_000)}`,
    commandFacts: {
      parseKnown: "yes",
      program: `git ${secret}`,
      subcommand: secret,
      commandCount: Number.POSITIVE_INFINITY,
      compound: "true",
      pipeline: true,
      effects: ["network-access", ...Array.from({ length: 20 }, () => secret)],
      dangerous: ["git-reset-hard", ...Array.from({ length: 20 }, () => secret)],
    },
  });
  const html = renderToolActivityStackHTML([normalized]);

  assert.equal(normalized.eventVersion, null);
  assert.equal(normalized.decision, "");
  assert.equal(normalized.decisionSource, "policy", "historical permissionDecidedBy remains a localized source fallback");
  assert.equal(normalized.ruleId, "");
  assert.equal(normalized.decisionScope, "");
  assert.equal(normalized.commandFacts.parseKnown, null);
  assert.equal(normalized.commandFacts.program, "");
  assert.equal(normalized.commandFacts.commandCount, null);
  assert.equal(normalized.commandFacts.compound, null);
  assert.deepEqual(normalized.commandFacts.effects, ["network-access"]);
  assert.deepEqual(normalized.commandFacts.dangerous, ["git-reset-hard"]);
  assert.ok(normalized.permissionDecisionReason.length <= 600);
  assert.match(html, /来源：策略/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, new RegExp(secret));
  assert.ok(html.length < 20_000, "malformed safety facts remain bounded");
});

test("approval cards reuse normalized safety facts without a second approval state", () => {
  const { html } = renderSnapshot([], {
    pendingToolApprovals: {
      approvalFacts: {
        agentId: "agent-1",
        toolUseId: "approval-facts",
        toolName: "Bash",
        inputJson: { command: "git status" },
        risk: "exec",
        decisionSource: "default_policy",
        decisionScope: "tool_call",
        commandFacts: { parseKnown: true, program: "git", subcommand: "status", commandCount: 1, compound: false, effects: [], dangerous: [] },
      },
    },
  });

  assert.match(html, /data-chat-report="tool-approval"/);
  assert.match(html, /来源：默认策略/);
  assert.match(html, /作用域：本次工具调用/);
  assert.match(html, /单条/);
  assert.match(html, /程序：git/);
});

test("approval cards prominently warn for unclassified dynamic commands", () => {
  const { html } = renderSnapshot([], {
    pendingToolApprovals: {
      dynamicCommand: {
        agentId: "agent-1",
        toolUseId: "dynamic-command",
        toolName: "Bash",
        inputJson: { command: "x=rm; $x -rf tmp" },
        risk: "exec",
        commandFacts: { parseKnown: false, program: "dynamic", commandCount: 1, compound: true, effects: [], dangerous: [] },
      },
    },
  });

  assert.match(html, /语法未知/);
  assert.match(html, /程序：dynamic/);
  assert.match(html, /无法可靠分类该命令/);
});

test("tool activity localizes every backend decision source", () => {
  const expected = new Map([
    ["policy_unavailable", "权限策略不可用"],
    ["workflow_unavailable", "工作流偏好不可用"],
    ["human_approval", "人工审批"],
    ["generation_invalidation", "授权版本失效"],
  ]);
  for (const [decisionSource, label] of expected) {
    const normalized = normalizeToolActivity({ toolUseId: decisionSource, toolName: "Bash", decision: "deny", decisionSource });
    assert.equal(normalized.decisionSource, decisionSource);
    assert.match(renderToolActivityStackHTML([normalized]), new RegExp(label));
  }
  const liveReason = normalizeToolActivity({ toolUseId: "live-reason", toolName: "Read", decision: "allow", decisionSource: "default_policy", reason: "Allowed <by live policy>" });
  assert.equal(liveReason.permissionDecisionReason, "Allowed <by live policy>");
  assert.match(renderToolActivityStackHTML([liveReason]), /Allowed &lt;by live policy&gt;/);
});

test("live omitted approval commands remain fail-closed until detail hydration", async () => {
  const messagesElement = fakeMessagesElement();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => id === "messages" ? messagesElement : null };
  const state = { agent: { id: "agent-1", cwd: "/work/project" }, pendingToolApprovals: {}, liveToolOutputs: {}, currentMessages: [], messageCopyTexts: [] };
  let resolveDetail;
  let requestedURL = "";
  const detail = new Promise((resolve) => { resolveDetail = resolve; });
  try {
    const controller = createChatRenderingController({
      state,
      apiRequest: async (url) => { requestedURL = url; return detail; },
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });
    controller.rememberToolApproval({
      agentId: "agent-1",
      data: {
        toolUseId: "approval-hydrate",
        toolName: "Bash",
        risk: "exec",
        commandOmitted: true,
        inputJson: { commandPresent: true },
        commandFacts: { parseKnown: true, program: "git", subcommand: "status", commandCount: 1 },
      },
    });
    assert.match(messagesElement.innerHTML, /正在安全加载完整命令/);
    assert.match(messagesElement.innerHTML, /data-approval-decision="allow_once"[^>]*disabled/);
    assert.equal(state.pendingToolApprovals["approval-hydrate"].commandOmitted, true);

    resolveDetail({ status: "pending_approval", inputJson: { command: "git status --short" } });
    await detail;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requestedURL, "/api/agents/agent-1/tool-calls/approval-hydrate");
    assert.equal(state.pendingToolApprovals["approval-hydrate"].command, "git status --short");
    assert.equal(state.pendingToolApprovals["approval-hydrate"].commandOmitted, false);
    assert.match(messagesElement.innerHTML, /git status --short/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("approval detail hydration failure keeps allow actions disabled", async () => {
  const messagesElement = fakeMessagesElement();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => id === "messages" ? messagesElement : null };
  const state = { agent: { id: "agent-1", cwd: "/work/project" }, pendingToolApprovals: {}, liveToolOutputs: {}, currentMessages: [], messageCopyTexts: [] };
  try {
    const controller = createChatRenderingController({
      state,
      apiRequest: async () => { throw new Error("offline"); },
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });
    controller.rememberToolApproval({ agentId: "agent-1", data: { toolUseId: "approval-failed", toolName: "Bash", risk: "exec", commandOmitted: true, inputJson: { commandPresent: true } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.pendingToolApprovals["approval-failed"].commandLoadFailed, true);
    assert.match(messagesElement.innerHTML, /无法加载完整命令/);
    assert.match(messagesElement.innerHTML, /data-approval-decision="allow_session"[^>]*disabled/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("Edit activity renders escaped structured and fallback diffs with red-green line hooks", () => {
  const fallback = renderToolDiffHTML({
    toolUseId: "edit-fallback",
    toolName: "Edit",
    inputJson: { old_string: "before <unsafe>", new_string: "after <unsafe>" },
  });
  const structured = renderToolDiffHTML({
    toolUseId: "edit-structured",
    toolName: "Edit",
    outputJson: { output: "Edited file", meta: { diff: "--- a/file\n+++ b/file\n@@ -335,1 +335,1 @@\n-old\n+new" } },
  });

  assert.match(fallback, /tool-diff-line del/);
  assert.match(fallback, /tool-diff-line add/);
  assert.match(fallback, /&lt;unsafe&gt;/);
  assert.doesNotMatch(fallback, /<unsafe>/);
  assert.match(structured, /tool-diff-line meta/);
  assert.match(structured, /tool-diff-line-number[^>]*>335</);
});

test("live tool events retain all tools and preserve streamed Bash output after completion", () => {
  const messagesElement = fakeMessagesElement();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => messagesElement };
  const state = { agent: { id: "agent-1" }, liveToolOutputs: {}, pendingToolApprovals: {}, currentMessages: [], messageCopyTexts: [] };
  try {
    const controller = createChatRenderingController({
      state,
      attachmentIcon: () => "file",
      attachmentKind: () => "file",
      copyToClipboard: async () => true,
      notifyTerminal: () => {},
      selectedModelValue: () => "",
      shortPath: (value) => value,
      showError: () => {},
      showToast: () => {},
    });
    controller.rememberToolStarted({ agentId: "agent-1", createdAt: "2026-01-01T00:00:00Z", data: { tool_use_id: "read-1", tool_name: "Read", run_id: "run-1", input_json: { file_path: "a.txt" }, execution_device_id: "local" } });
    controller.finishToolOutput({ agentId: "agent-1", data: { toolUseId: "read-1", runId: "run-1", status: "completed", resultPreview: "file contents", resultTruncated: true } });
    controller.rememberToolStarted({ agentId: "agent-1", data: { toolUseId: "bash-1", toolName: "Bash", runId: "run-1", input: { command: "printf ok" } } });
    controller.appendToolOutput({ agentId: "agent-1", text: "first\n", data: { toolUseId: "bash-1", runId: "run-1" } });
    controller.appendToolOutput({ agentId: "agent-1", text: "second", data: { toolUseId: "bash-1", runId: "run-1" } });
    controller.finishToolOutput({ agentId: "agent-1", data: { toolUseId: "bash-1", runId: "run-1", status: "completed", duration_ms: 25, resultPreview: "first\nsecond" } });

    assert.equal(state.liveToolOutputs["read-1"].toolName, "Read");
    assert.equal(state.liveToolOutputs["read-1"].output, "file contents");
    assert.equal(state.liveToolOutputs["read-1"].truncated, true);
    assert.equal(state.liveToolOutputs["bash-1"].output, "first\nsecond");
    assert.equal(state.liveToolOutputs["bash-1"].status, "completed");
    assert.equal(state.liveToolOutputs["bash-1"].durationMs, 25);
    assert.match(messagesElement.innerHTML, /first\nsecond/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("run review uses complete tool calls and falls back to summary calls when detail loading fails", async () => {
  const fullCall = { toolUseId: "full-1", toolName: "Read", status: "completed", inputJson: { file_path: "full.txt" }, outputJson: { output: "full output", meta: { path: "full.txt" } }, durationMs: 31 };
  const fallbackCall = { toolUseId: "summary-1", toolName: "Grep", status: "error", inputJson: { path: "src", pattern: "x" }, errorMessage: "failed" };
  const summary = { run: { id: "run-1", status: "completed", createdAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z" }, toolCalls: [fallbackCall], recentMessages: [] };
  const messagesElement = fakeMessagesElement();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => messagesElement };
  try {
    const state = { agent: { id: "agent-1" }, liveToolOutputs: {}, pendingToolApprovals: {}, currentMessages: [], messageCopyTexts: [] };
    const controller = createChatRenderingController({
      state,
      apiRequest: async (url) => url.includes("/tool-calls?") ? { toolCalls: [fullCall], hasMore: false } : summary,
      attachmentIcon: () => "file", attachmentKind: () => "file", copyToClipboard: async () => true,
      notifyTerminal: () => {}, selectedModelValue: () => "", shortPath: (value) => value, showError: () => {}, showToast: () => {},
    });
    await controller.loadRunSummary("run-1");
    assert.deepEqual(state.activeRunToolCalls, [fullCall]);
    assert.match(messagesElement.innerHTML, /full.txt/);
    assert.match(messagesElement.innerHTML, /full output/);
    assert.doesNotMatch(messagesElement.innerHTML, /&quot;meta&quot;/);

    const fallbackState = { agent: { id: "agent-1" }, liveToolOutputs: {}, pendingToolApprovals: {}, currentMessages: [], messageCopyTexts: [] };
    const fallbackController = createChatRenderingController({
      state: fallbackState,
      apiRequest: async (url) => {
        if (url.includes("/tool-calls?")) throw new Error("detail unavailable");
        return summary;
      },
      attachmentIcon: () => "file", attachmentKind: () => "file", copyToClipboard: async () => true,
      notifyTerminal: () => {}, selectedModelValue: () => "", shortPath: (value) => value, showError: () => {}, showToast: () => {},
    });
    await fallbackController.loadRunSummary("run-1");
    assert.deepEqual(fallbackState.activeRunToolCalls, [fallbackCall]);
    assert.equal(normalizeToolActivity(fallbackState.activeRunToolCalls[0]).status, "error");
  } finally {
    globalThis.document = previousDocument;
  }
});
