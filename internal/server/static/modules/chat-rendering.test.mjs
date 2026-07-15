import test from "node:test";
import assert from "node:assert/strict";

import {
  chatMessagePresentation,
  createChatRenderingController,
  formatTurnUsagePerformance,
  normalizeTurnUsage,
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
    scrollHeight: 100,
    scrollTop: 0,
  };
}

function renderSnapshot(messages, stateOverrides = {}) {
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
    assert.equal(controller.applyMessageSnapshot(messages, "agent-1"), true);
    return { html: messagesElement.innerHTML, state };
  } finally {
    globalThis.document = previousDocument;
  }
}

test("chatMessagePresentation sends only user semantics to the right", () => {
  assert.deepEqual(chatMessagePresentation({ role: "user" }).alignment, "right");
  assert.deepEqual(chatMessagePresentation({ role: "HUMAN" }).alignment, "right");
  for (const role of ["assistant", "tool", "system", "error", "task_report", "legacy", ""]) {
    assert.equal(chatMessagePresentation({ role }).alignment, "left", role);
  }
});

test("message rendering aligns user right and assistant, legacy, and streaming messages left", () => {
  const { html, state } = renderSnapshot([
    { role: "user", contentText: "hello", createdAt: "2026-02-03T04:05:06Z" },
    { role: "assistant", contentText: "reply" },
    { role: "tool", contentText: "legacy result" },
    { role: "assistant", contentText: "streaming", streaming: true },
  ]);

  assert.match(html, /class="message user chat-message chat-flow-item chat-flow-right" data-chat-alignment="right"/);
  assert.equal((html.match(/data-chat-alignment="left" data-message-role=/g) || []).length, 3);
  assert.match(html, /class="message assistant chat-message chat-flow-item chat-flow-left"[^>]*data-message-role="tool"/);
  assert.match(html, /<time class="message-time" datetime="2026-02-03T04:05:06Z">/);
  assert.equal((html.match(/data-copy-message=/g) || []).length, 4);
  assert.deepEqual(state.messageCopyTexts, ["hello", "reply", "legacy result", "streaming"]);
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
  assert.match(html, /class="live-tool-output-stack chat-flow-stack chat-flow-left" data-chat-alignment="left"/);
  assert.match(html, /data-chat-report="tool-output"/);
  assert.match(html, /data-chat-report="run-summary"/);
  assert.match(html, /data-chat-report="tool-approval"/);
  assert.doesNotMatch(html, /<run error>/);
  assert.match(html, /&lt;run error&gt;/);
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
