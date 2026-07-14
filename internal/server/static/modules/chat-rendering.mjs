import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatBytes, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";
import { api } from "./runtime.mjs";
import { visibleMessageText } from "./skills-commands.mjs";
import { t as cr } from "./messages-chat-rendering-extra.mjs";

const userMessageRoles = new Set(["user", "human"]);

export function chatMessagePresentation(message = {}) {
  const role = String(message.role || "message").trim() || "message";
  const normalizedRole = role.toLowerCase();
  const alignment = userMessageRoles.has(normalizedRole) ? "right" : "left";
  const timestampValue = [message.createdAt, message.created_at, message.timestamp, message.sentAt, message.updatedAt]
    .map((value) => String(value || "").trim())
    .find((value) => value && !Number.isNaN(Date.parse(value))) || "";
  return {
    role,
    normalizedRole,
    roleClass: alignment === "right" ? "user" : "assistant",
    alignment,
    timestampValue,
  };
}

const messagePageLimit = 100;

export function createChatRenderingController({
  state,
  attachmentIcon,
  attachmentKind,
  copyToClipboard,
  notifyTerminal,
  openGitModal,
  refreshGitWorkflow,
  selectedModelValue,
  shortPath,
  showError,
  showToast,
} = {}) {
  async function loadMessages(agentId = state.agent?.id) {
    if (!agentId) return;
    let page;
    try {
      page = await api(`/api/agents/${encodeURIComponent(agentId)}/messages?limit=${messagePageLimit}`);
    } catch (err) {
      if (state.agent?.id === agentId) throw err;
      return;
    }
    applyMessageSnapshot(page?.messages, agentId, {
      hasMoreBefore: page?.hasMoreBefore,
      nextBefore: page?.nextBefore,
    });
  }

  async function loadOlderMessages(agentId = state.agent?.id) {
    if (!agentId || state.agent?.id !== agentId || !state.messageHasMoreBefore || !state.messageNextBefore || state.messageOlderLoading) return;
    state.messageOlderLoading = true;
    const el = $("messages");
    const previousHeight = el?.scrollHeight || 0;
    const previousTop = el?.scrollTop || 0;
    applyMessageSnapshot(state.currentMessages, agentId, { preserveScroll: true });
    try {
      const page = await api(`/api/agents/${encodeURIComponent(agentId)}/messages?before=${encodeURIComponent(state.messageNextBefore)}&limit=${messagePageLimit}`);
      if (state.agent?.id !== agentId) return;
      const older = Array.isArray(page?.messages) ? page.messages : [];
      const existing = new Set((state.currentMessages || []).map((message) => message?.id).filter(Boolean));
      const merged = [...older.filter((message) => !message?.id || !existing.has(message.id)), ...(state.currentMessages || [])];
      applyMessageSnapshot(merged, agentId, {
        hasMoreBefore: page?.hasMoreBefore,
        nextBefore: page?.nextBefore,
        preserveScroll: true,
      });
      if (el) el.scrollTop = previousTop + Math.max(0, el.scrollHeight - previousHeight);
    } finally {
      state.messageOlderLoading = false;
      if (state.agent?.id === agentId) applyMessageSnapshot(state.currentMessages, agentId, { preserveScroll: true });
    }
  }

  function applyMessageSnapshot(messages, agentId = state.agent?.id, options = {}) {
    if (!agentId || state.agent?.id !== agentId) return false;
    const normalized = Array.isArray(messages) ? messages : [];
    if (options.hasMoreBefore !== undefined) state.messageHasMoreBefore = Boolean(options.hasMoreBefore);
    if (options.nextBefore !== undefined) state.messageNextBefore = String(options.nextBefore || "");
    const el = $("messages");
    state.currentMessages = normalized;
    state.messageCopyTexts = normalized.map(visibleMessageText);
    updateConversationCopyButton();
    if (!el) return true;
    const liveAssistantCard = renderLiveAssistantCardHTML();
    const liveToolCards = renderLiveToolOutputCardsHTML();
    const runSummaryCard = renderRunSummaryCardHTML();
    const approvalCards = renderApprovalCardsHTML();
    if (!normalized.length && !liveAssistantCard && !liveToolCards && !runSummaryCard && !approvalCards) {
      el.classList.add("empty");
      el.innerHTML = `<div class="empty-conversation-state">${escapeHtml(cr("message.empty"))}</div>`;
      return true;
    }
    el.classList.remove("empty");
    const olderMessagesControl = state.messageHasMoreBefore ? `
      <div class="message-history-control">
        <button class="ghost-btn mini" type="button" data-load-older-messages ${state.messageOlderLoading ? "disabled" : ""}>
          ${state.messageOlderLoading ? "正在加载…" : "加载更早消息"}
        </button>
      </div>
    ` : "";
    el.innerHTML = `${olderMessagesControl}${normalized.map(renderChatMessageHTML).join("")}${liveAssistantCard}${liveToolCards}${runSummaryCard}${approvalCards}`;
    bindMessageActionButtons(el);
    el.querySelector("[data-load-older-messages]")?.addEventListener("click", () => {
      loadOlderMessages(agentId).catch(showError);
    });
    bindRunSummaryButtons(el);
    bindApprovalButtons(el);
    bindCopyCodeButtons(el);
    if (!options.preserveScroll) el.scrollTop = el.scrollHeight;
    return true;
  }

  function renderLiveAssistantCardHTML() {
    const text = String(state.liveAssistantText || "");
    if (!text) return "";
    return `
      <div class="message assistant live-assistant-message" data-live-assistant data-run-id="${escapeAttr(state.liveAssistantRunId || "")}">
        <div class="message-head">
          <div class="message-role">assistant</div>
          <span class="live-assistant-status">正在生成</span>
        </div>
        <div class="message-content">${renderMarkdown(text)}</div>
      </div>
    `;
  }

  function renderChatMessageHTML(message, index) {
    const presentation = chatMessagePresentation(message);
    const timeHTML = presentation.timestampValue
      ? `<time class="message-time" datetime="${escapeAttr(presentation.timestampValue)}">${escapeHtml(formatTimestamp(presentation.timestampValue))}</time>`
      : "";
    const actions = `${message.role === "user" ? `<button class="message-copy-btn" type="button" data-correct-message="${escapeAttr(message.id || "")}" title="更正并重新发送">更正</button>` : ""}<button class="message-copy-btn" type="button" data-copy-message="${escapeAttr(String(index))}" title="${escapeAttr(cr("message.copyTitle"))}">${escapeHtml(cr("message.copy"))}</button>`;
    return `
      <div class="message ${presentation.roleClass} chat-message chat-flow-item chat-flow-${presentation.alignment}" data-chat-alignment="${presentation.alignment}" data-message-role="${escapeAttr(presentation.normalizedRole)}">
        <div class="message-head">
          <div class="message-meta"><div class="message-role">${escapeHtml(presentation.role)}${message.correctionOfMessageId ? " · 更正" : ""}</div>${timeHTML}</div>
          <div class="message-head-actions">${actions}</div>
        </div>
        ${message.id && state.editingMessageId === message.id ? renderCorrectionEditor(message) : `<div class="message-content">${renderMarkdown(friendlyMessageText(visibleMessageText(message)))}</div>${renderMessageAttachments(message)}`}
      </div>
    `;
  }

  function renderLiveAssistantCard() {
    const el = $("messages");
    if (!el) return;
    const existing = el.querySelector("[data-live-assistant]");
    const html = renderLiveAssistantCardHTML();
    if (!html) {
      existing?.remove();
      if (!state.currentMessages?.length && !renderLiveToolOutputCardsHTML() && !renderRunSummaryCardHTML() && !renderApprovalCardsHTML()) {
        el.classList.add("empty");
        el.textContent = "还没有消息。输入你的需求开始对话。";
      }
      return;
    }
    el.classList.remove("empty");
    if (existing) existing.outerHTML = html;
    else el.insertAdjacentHTML("beforeend", html);
    bindCopyCodeButtons(el);
    el.scrollTop = el.scrollHeight;
  }

  function appendLiveAssistantText(text, runId = "") {
    const delta = String(text || "");
    if (!delta) return;
    if (runId && state.liveAssistantRunId && state.liveAssistantRunId !== runId) state.liveAssistantText = "";
    if (runId) state.liveAssistantRunId = runId;
    state.liveAssistantText = `${state.liveAssistantText || ""}${delta}`;
    renderLiveAssistantCard();
  }

  function clearLiveAssistantText() {
    state.liveAssistantText = "";
    state.liveAssistantRunId = "";
    renderLiveAssistantCard();
  }

  function renderCorrectionEditor(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const files = Array.isArray(state.correctionFiles) ? state.correctionFiles : [];
    return `
      <form class="message-correction-editor" data-correction-form="${escapeAttr(message.id || "")}">
        <textarea class="message-correction-text" data-correction-text rows="4">${escapeHtml(state.correctionText ?? visibleMessageText(message))}</textarea>
        ${attachments.length ? `<div class="message-correction-attachments">${attachments.map((attachment) => `
          <label><input type="checkbox" data-keep-correction-attachment value="${escapeAttr(attachment.id || "")}" checked /> ${escapeHtml(attachment.filename || "附件")}</label>
        `).join("")}</div>` : ""}
        ${files.length ? `<div class="message-correction-new-files">${files.map((file) => `<span>${escapeHtml(file.name || "附件")}</span>`).join("")}</div>` : ""}
        <label class="message-correction-file-label">添加图片或文本文件<input type="file" data-correction-files multiple /></label>
        <div class="message-correction-actions">
          <button class="ghost-btn mini" type="button" data-correction-cancel>取消</button>
          <button class="ghost-btn mini" type="submit">更正并重新发送</button>
        </div>
      </form>
    `;
  }

  function correctionClipboardFiles(event) {
    const direct = Array.from(event?.clipboardData?.files || []).filter(Boolean);
    if (direct.length) return direct;
    return Array.from(event?.clipboardData?.items || [])
      .filter((item) => item?.kind === "file")
      .map((item) => item.getAsFile?.())
      .filter(Boolean);
  }

  function openCorrectionEditor(messageId) {
    state.editingMessageId = messageId;
    state.correctionText = visibleMessageText(state.currentMessages.find((message) => message.id === messageId) || {});
    state.correctionFiles = [];
    applyMessageSnapshot(state.currentMessages, state.agent?.id);
  }

  function closeCorrectionEditor() {
    state.editingMessageId = "";
    state.correctionText = "";
    state.correctionFiles = [];
    applyMessageSnapshot(state.currentMessages, state.agent?.id);
  }

  async function submitCorrection(form) {
    const agentId = state.agent?.id;
    const messageId = form?.dataset?.correctionForm || "";
    if (!agentId || !messageId) return;
    const text = form.querySelector("[data-correction-text]")?.value ?? state.correctionText ?? "";
    const keepAttachmentIds = Array.from(form.querySelectorAll("[data-keep-correction-attachment]:checked")).map((input) => input.value).filter(Boolean);
    const files = Array.isArray(state.correctionFiles) ? state.correctionFiles : [];
    const payload = new FormData();
    payload.append("text", text);
    payload.append("keepAttachmentIds", JSON.stringify(keepAttachmentIds));
    files.forEach((file) => payload.append("files", file, file.name || "attachment"));
    await api(`/api/agents/${agentId}/messages/${encodeURIComponent(messageId)}/corrections`, { method: "POST", body: payload });
    state.editingMessageId = "";
    state.correctionText = "";
    state.correctionFiles = [];
    await loadMessages(agentId);
    showToast("已创建更正消息并重新运行。", "success");
  }

  function clearRunSummary() {
    state.activeRunSummary = null;
    state.activeRunSummaryRunId = "";
    state.runSummaryLoading = false;
    state.runSummaryError = "";
    state.runRollbackBusy = false;
    state.runSummarySeq = Number(state.runSummarySeq || 0) + 1;
    renderRunSummaryCard();
  }

  async function loadLatestRunSummary(agentId = state.agent?.id) {
    if (!agentId) return null;
    const seq = Number(state.runSummarySeq || 0) + 1;
    state.runSummarySeq = seq;
    state.activeRunSummary = null;
    state.activeRunSummaryRunId = "";
    state.runSummaryLoading = false;
    state.runSummaryError = "";
    state.runRollbackBusy = false;
    try {
      const runs = await api(`/api/agents/${agentId}/runs?limit=1`);
      if (seq !== state.runSummarySeq || state.agent?.id !== agentId) return null;
      const run = Array.isArray(runs) ? runs[0] : null;
      if (!run || !isTerminalRunStatus(run.status)) {
        renderRunSummaryCard();
        return null;
      }
      return await loadRunSummary(run.id, { agentId });
    } catch (err) {
      if (seq === state.runSummarySeq && state.agent?.id === agentId) {
        state.runSummaryError = err.message || String(err);
        renderRunSummaryCard();
      }
      notifyTerminal?.(`[warn] ${cr("run.refreshFailed", { message: err.message || err })}\n`);
      return null;
    }
  }

  async function loadRunSummary(runId, options = {}) {
    const agentId = options.agentId || state.agent?.id;
    if (!agentId || !runId) return null;
    const seq = Number(state.runSummarySeq || 0) + 1;
    state.runSummarySeq = seq;
    state.activeRunSummaryRunId = runId;
    state.runSummaryLoading = true;
    state.runSummaryError = "";
    renderRunSummaryCard();
    try {
      const summary = await api(`/api/agents/${agentId}/runs/${encodeURIComponent(runId)}`);
      if (seq !== state.runSummarySeq || state.agent?.id !== agentId) return null;
      state.activeRunSummary = summary;
      state.activeRunSummaryRunId = summary?.run?.id || runId;
      state.runSummaryLoading = false;
      state.runSummaryError = "";
      renderRunSummaryCard();
      if (options.notify) showToast(cr("run.refreshed"), "success");
      return summary;
    } catch (err) {
      if (seq !== state.runSummarySeq || state.agent?.id !== agentId) return null;
      state.runSummaryLoading = false;
      state.runSummaryError = err.message || String(err);
      renderRunSummaryCard();
      throw err;
    }
  }

  function renderRunSummaryCard() {
    const el = $("messages");
    if (!el) return;
    const existing = el.querySelector("[data-run-summary-card]");
    if (existing) existing.remove();
    const html = renderRunSummaryCardHTML();
    if (!html) return;
    if (el.classList.contains("empty")) {
      el.classList.remove("empty");
      el.innerHTML = html;
    } else {
      const approvalStack = el.querySelector("[data-approval-stack]");
      if (approvalStack) approvalStack.insertAdjacentHTML("beforebegin", html);
      else el.insertAdjacentHTML("beforeend", html);
    }
    bindRunSummaryButtons(el);
    el.scrollTop = el.scrollHeight;
  }

  function renderRunSummaryCardHTML() {
    const summary = state.activeRunSummary;
    const run = summary?.run;
    const runId = state.activeRunSummaryRunId || run?.id || "";
    if (!run && !runId && !state.runSummaryLoading && !state.runSummaryError) return "";
    const status = run?.status || (state.runSummaryLoading ? "loading" : "unknown");
    const checkpoint = runCheckpointState(run);
    const toolCalls = Array.isArray(summary?.toolCalls) ? summary.toolCalls : [];
    const recentMessages = Array.isArray(summary?.recentMessages) ? summary.recentMessages : [];
    const tokenText = `${formatNumber(summary?.inputTokens || 0)} / ${formatNumber(summary?.outputTokens || 0)}`;
    return `
      <section class="run-summary-card chat-flow-item chat-flow-left chat-report-card ${escapeAttr(runStatusClass(status))}" data-chat-alignment="left" data-chat-report="run-summary" data-run-summary-card data-run-id="${escapeAttr(runId)}">
        <div class="run-summary-head">
          <div>
            <div class="run-summary-kicker">${escapeHtml(cr("run.review"))}</div>
            <div class="run-summary-title">${escapeHtml(runStatusLabel(status))}${state.runSummaryLoading ? ` · ${escapeHtml(cr("run.refreshing"))}` : ""}</div>
            <div class="run-summary-meta">${escapeHtml(runTimeRange(run))}${runId ? ` · ${escapeHtml(shortRunId(runId))}` : ""}</div>
          </div>
          <span class="run-summary-status">${escapeHtml(status)}</span>
        </div>
        ${state.runSummaryError ? `<div class="run-summary-alert">${escapeHtml(state.runSummaryError)}</div>` : ""}
        ${renderRunCheckpoint(run, checkpoint)}
        <div class="run-summary-metrics">
          ${renderRunMetric(cr("run.metrics.messages"), summary?.messageCount)}
          ${renderRunMetric(cr("run.metrics.tools"), summary?.toolCallCount)}
          ${renderRunMetric(cr("run.metrics.pendingApprovals"), summary?.pendingApprovals, Number(summary?.pendingApprovals || 0) ? "warn" : "")}
          ${renderRunMetric(cr("run.metrics.deniedErrors"), `${formatNumber(summary?.deniedToolCalls || 0)} / ${formatNumber(summary?.errorToolCalls || 0)}`, Number(summary?.deniedToolCalls || 0) || Number(summary?.errorToolCalls || 0) ? "bad" : "")}
          ${renderRunMetric(cr("run.metrics.api"), summary?.apiRequestCount)}
          ${renderRunMetric(cr("run.metrics.tokensInOut"), tokenText)}
          ${renderRunMetric(cr("run.metrics.cost"), formatMoney(summary?.costUsd || 0))}
        </div>
        ${renderRunToolCalls(toolCalls)}
        ${renderRunMessagePreviews(recentMessages)}
        <div class="run-summary-actions">
          <button class="ghost-btn mini" type="button" data-run-summary-open-git>${escapeHtml(cr("run.gitChanges"))}</button>
          <button class="ghost-btn mini danger" type="button" data-run-summary-rollback="${escapeAttr(runId)}" title="${escapeAttr(checkpoint.reason)}" ${checkpoint.available && runId && !state.runRollbackBusy ? "" : "disabled"}>${escapeHtml(state.runRollbackBusy ? cr("run.rollingBack") : cr("run.rollback"))}</button>
          <button class="ghost-btn mini" type="button" data-run-summary-copy="${escapeAttr(runId)}" ${summary ? "" : "disabled"}>${escapeHtml(cr("run.copySummary"))}</button>
          <button class="ghost-btn mini" type="button" data-run-summary-refresh="${escapeAttr(runId)}" ${runId ? "" : "disabled"}>${escapeHtml(cr("run.refreshReview"))}</button>
        </div>
      </section>
    `;
  }

  function renderRunCheckpoint(run, checkpoint = runCheckpointState(run)) {
    if (!run) return "";
    const head = run.baseHead ? shortGitHash(run.baseHead) : cr("run.checkpointNotRecorded");
    return `
      <div class="run-summary-checkpoint ${escapeAttr(checkpoint.tone)}">
        <span>${escapeHtml(cr("run.checkpoint"))}</span>
        <strong>${escapeHtml(head)}</strong>
        <em>${escapeHtml(checkpoint.reason)}</em>
      </div>
    `;
  }

  function runCheckpointState(run) {
    const state = String(run?.checkpointState || "").trim();
    if (state === "rolled_back") {
      return { available: false, tone: "muted", reason: cr("run.checkpointRolledBack") };
    }
    if (state === "rolling_back") {
      return { available: false, tone: "warn", reason: cr("run.checkpointRollingBack") };
    }
    if (state === "invalid") {
      return { available: false, tone: "warn", reason: run?.checkpointError || cr("run.checkpointInvalid") };
    }
    if (state === "capturing") {
      return { available: false, tone: "warn", reason: cr("run.checkpointCapturing") };
    }
    if (state === "tracking") {
      return { available: false, tone: "muted", reason: cr("run.checkpointTracking") };
    }
    if (!run?.baseHead) {
      return { available: false, tone: "muted", reason: cr("run.checkpointDirtyWorkspace") };
    }
    if (run.endHead && run.endHead !== run.baseHead) {
      return { available: false, tone: "warn", reason: cr("run.checkpointHasCommit") };
    }
    if (state === "none") {
      return { available: false, tone: "muted", reason: cr("run.checkpointNoSnapshot") };
    }
    if (state !== "ready") {
      return { available: false, tone: "warn", reason: cr("run.checkpointUnknown") };
    }
    if (!run.gitSnapshotAt || !run.checkpointRepoRoot) {
      return { available: false, tone: "muted", reason: cr("run.checkpointNoSnapshot") };
    }
    return { available: true, tone: "ok", reason: cr("run.checkpointRestoreHint", { hash: shortGitHash(run.baseHead) }) };
  }

  function shortGitHash(hash) {
    const text = String(hash || "").trim();
    return text ? text.slice(0, 8) : "";
  }

  function renderRunMetric(label, value, tone = "") {
    const text = typeof value === "number" ? formatNumber(value) : String(value ?? "0");
    return `<div class="run-summary-metric ${tone ? `tone-${escapeAttr(tone)}` : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong></div>`;
  }

  function renderRunToolCalls(toolCalls) {
    if (!toolCalls.length) return `<div class="run-summary-empty">${escapeHtml(cr("run.noToolCalls"))}</div>`;
    const visible = toolCalls.slice(0, 6);
    const more = toolCalls.length > visible.length ? `<div class="run-summary-more">${escapeHtml(cr("run.moreToolCalls", { count: formatNumber(toolCalls.length - visible.length) }))}</div>` : "";
    return `
      <div class="run-summary-section">
        <div class="run-summary-section-title">${escapeHtml(cr("run.toolCalls"))}</div>
        <div class="run-tool-list">
          ${visible.map((call) => `
            <div class="run-tool-row ${escapeAttr(toolStatusClass(call.status))}">
              <span class="run-tool-name">${escapeHtml(call.toolName || cr("defaults.tool"))}</span>
              <span class="run-tool-status">${escapeHtml(toolStatusLabel(call.status))}</span>
              <span class="run-tool-preview">${escapeHtml(toolCallPreview(call))}</span>
            </div>
          `).join("")}
        </div>
        ${more}
      </div>
    `;
  }

  function renderRunMessagePreviews(messages) {
    if (!messages.length) return "";
    return `
      <div class="run-summary-section">
        <div class="run-summary-section-title">${escapeHtml(cr("run.recentMessages"))}</div>
        <div class="run-message-preview-list">
          ${messages.slice(-3).map((message) => `
            <div class="run-message-preview">
              <span>${escapeHtml(message.role || cr("defaults.message"))}</span>
              <strong>${escapeHtml(compactText(visibleMessageText(message), 120))}</strong>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function bindRunSummaryButtons(root) {
    root.querySelectorAll("[data-run-summary-refresh]").forEach((button) => {
      button.addEventListener("click", () => {
        const runId = button.dataset.runSummaryRefresh || state.activeRunSummaryRunId || "";
        if (!runId) return;
        loadRunSummary(runId, { notify: true }).catch(showError);
      });
    });
    root.querySelectorAll("[data-run-summary-rollback]").forEach((button) => {
      button.addEventListener("click", () => {
        const runId = button.dataset.runSummaryRollback || state.activeRunSummaryRunId || "";
        if (!runId) return;
        rollbackRunToCheckpoint(runId).catch(showError);
      });
    });
    root.querySelectorAll("[data-run-summary-copy]").forEach((button) => {
      button.addEventListener("click", () => copyActiveRunSummaryMarkdown(button));
    });
    root.querySelectorAll("[data-run-summary-open-git]").forEach((button) => {
      button.addEventListener("click", () => {
        if (typeof openGitModal === "function") openGitModal();
        else showToast(cr("run.gitUnavailable"), "warn");
      });
    });
  }

  async function rollbackRunToCheckpoint(runId) {
    const agentId = state.agent?.id;
    const run = state.activeRunSummary?.run;
    const checkpoint = runCheckpointState(run);
    if (!agentId || !runId || !checkpoint.available) {
      showToast(checkpoint.reason || cr("run.noCheckpoint"), "warn", { force: true });
      return;
    }
    const preview = await api(`/api/agents/${agentId}/runs/${encodeURIComponent(runId)}/rollback`);
    if (state.agent?.id !== agentId) return;
    if (!preview?.available) {
      const reason = preview?.reason || cr("run.noCheckpoint");
      state.runSummaryError = reason;
      renderRunSummaryCard();
      showToast(reason, "warn", { force: true });
      return;
    }
    const confirmed = window.confirm(rollbackPreviewConfirmation(preview));
    if (!confirmed) return;
    state.runRollbackBusy = true;
    state.runSummaryError = "";
    renderRunSummaryCard();
    try {
      const result = await api(`/api/agents/${agentId}/runs/${encodeURIComponent(runId)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      if (state.agent?.id !== agentId) return;
      if (result?.status) {
        state.gitStatus = result.status;
        state.gitDiff = null;
      }
      try {
        await loadRunSummary(runId);
      } catch (err) {
        notifyTerminal?.(`[warn] ${cr("run.refreshFailed", { message: err.message || err })}\n`);
      }
      const rollbackWarning = String(result?.warning || "").trim();
      if (rollbackWarning) {
        notifyTerminal?.(`[warn] ${rollbackWarning}\n`);
        showToast(cr("run.rollbackRefreshFailed"), "warn", { force: true });
      } else {
        showToast(cr("run.rollbackComplete"), "success", { force: true });
      }
      if (typeof refreshGitWorkflow === "function") {
        try {
          await refreshGitWorkflow({ silent: true });
        } catch (err) {
          notifyTerminal?.(`[warn] ${cr("run.gitRefreshFailed", { message: err.message || err })}\n`);
        }
      }
    } catch (err) {
      if (state.agent?.id !== agentId) return;
      state.runSummaryError = err.message || String(err);
      renderRunSummaryCard();
      throw err;
    } finally {
      if (state.agent?.id === agentId) {
        state.runRollbackBusy = false;
        renderRunSummaryCard();
      }
    }
  }

  function rollbackPreviewConfirmation(preview) {
    const restorePaths = Array.isArray(preview?.restorePaths) ? preview.restorePaths : [];
    const deletePaths = Array.isArray(preview?.deletePaths) ? preview.deletePaths : [];
    const lines = [
      cr("run.rollbackConfirm"),
      "",
      cr("run.rollbackSummary", { restoreCount: Number(preview?.restoreCount || 0), deleteCount: Number(preview?.deleteCount || 0) }),
    ];
    if (restorePaths.length) lines.push("", cr("run.restorePaths"), ...restorePaths.map((path) => `- ${path}`));
    if (deletePaths.length) lines.push("", cr("run.deletePaths"), ...deletePaths.map((path) => `- ${path}`));
    if (preview?.truncated) lines.push("", cr("run.rollbackTruncated"));
    lines.push("", cr("run.rollbackSafety"));
    return lines.join("\n");
  }

  async function copyActiveRunSummaryMarkdown(button) {
    const summary = state.activeRunSummary;
    if (!summary?.run || !copyToClipboard) {
      showToast(cr("run.noSummary"), "warn");
      return;
    }
    const original = button?.textContent || cr("run.copySummary");
    const ok = await copyToClipboard(runSummaryMarkdown(summary));
    if (button) {
      button.textContent = ok ? cr("message.copied") : cr("message.copyFailed");
      window.setTimeout(() => { button.textContent = original; }, 1200);
    }
    showToast(ok ? cr("run.summaryCopied") : cr("run.summaryCopyFailed"), ok ? "success" : "warn");
  }

  function runSummaryMarkdown(summary) {
    const run = summary.run || {};
    const lines = [
      `# ${cr("run.markdown.title", { id: run.id || "" })}`.trim(),
      "",
      `- ${cr("run.markdown.status", { status: run.status || "unknown" })}`,
      `- ${cr("run.markdown.time", { time: runTimeRange(run) })}`,
      `- ${cr("run.markdown.messages", { count: formatNumber(summary.messageCount || 0) })}`,
      `- ${cr("run.markdown.toolCalls", { count: formatNumber(summary.toolCallCount || 0), pending: formatNumber(summary.pendingApprovals || 0), denied: formatNumber(summary.deniedToolCalls || 0), errors: formatNumber(summary.errorToolCalls || 0) })}`,
      `- ${cr("run.markdown.apiRequests", { count: formatNumber(summary.apiRequestCount || 0) })}`,
      `- ${cr("run.markdown.tokens", { input: formatNumber(summary.inputTokens || 0), output: formatNumber(summary.outputTokens || 0) })}`,
      `- ${cr("run.markdown.cost", { cost: formatMoney(summary.costUsd || 0) })}`,
      "",
      `## ${cr("run.markdown.toolsHeading")}`,
    ];
    const toolCalls = Array.isArray(summary.toolCalls) ? summary.toolCalls : [];
    if (!toolCalls.length) lines.push(`- ${cr("run.markdown.none")}`);
    else toolCalls.forEach((call) => lines.push(`- ${call.toolName || cr("defaults.tool")}：${call.status || "unknown"}${call.errorMessage ? ` — ${call.errorMessage}` : ""}`));
    const messages = Array.isArray(summary.recentMessages) ? summary.recentMessages : [];
    if (messages.length) {
      lines.push("", `## ${cr("run.markdown.recentMessagesHeading")}`);
      messages.slice(-6).forEach((message) => lines.push(`- ${message.role || cr("defaults.message")}: ${compactText(visibleMessageText(message), 180)}`));
    }
    return lines.join("\n");
  }

  function isTerminalRunStatus(status) {
    return ["completed", "error", "interrupted", "superseded"].includes(String(status || ""));
  }

  function runStatusLabel(status) {
    const value = String(status || "unknown");
    if (value === "completed") return cr("run.status.completed");
    if (value === "error") return cr("run.status.error");
    if (value === "interrupted") return cr("run.status.interrupted");
    if (value === "superseded") return cr("run.status.superseded");
    if (value === "running") return cr("run.status.running");
    if (value === "pending") return cr("run.status.pending");
    if (value === "loading") return cr("run.status.loading");
    return cr("run.status.unknown");
  }

  function runStatusClass(status) {
    const value = String(status || "unknown");
    if (value === "completed") return "status-completed";
    if (value === "error") return "status-error";
    if (value === "interrupted" || value === "superseded") return "status-warn";
    return "status-neutral";
  }

  function toolStatusLabel(status) {
    const value = String(status || "unknown");
    if (value === "completed") return cr("run.toolStatus.completed");
    if (value === "pending_approval") return cr("run.toolStatus.pendingApproval");
    if (value === "denied") return cr("run.toolStatus.denied");
    if (value === "error") return cr("run.toolStatus.error");
    return value;
  }

  function toolStatusClass(status) {
    const value = String(status || "unknown");
    if (value === "completed") return "status-completed";
    if (value === "pending_approval") return "status-warn";
    if (value === "denied" || value === "error") return "status-error";
    return "status-neutral";
  }

  function runTimeRange(run) {
    if (!run) return cr("run.noTime");
    const start = formatTimestamp(run.startedAt || run.createdAt);
    const end = run.completedAt ? formatTimestamp(run.completedAt) : cr("run.unfinished");
    return `${start} → ${end}`;
  }

  function shortRunId(runId) {
    const value = String(runId || "");
    if (value.length <= 12) return value;
    return `${value.slice(0, 8)}…${value.slice(-4)}`;
  }

  function compactText(text, max = 140) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return cr("defaults.empty");
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function toolCallPreview(call) {
    if (call.errorMessage) return compactText(call.errorMessage, 120);
    const input = call.inputJson;
    if (input && typeof input === "object") {
      if (input.command) return compactText(input.command, 120);
      if (input.file_path) return compactText(input.file_path, 120);
      if (input.pattern) return compactText(input.pattern, 120);
    }
    if (typeof input === "string") return compactText(input, 120);
    try {
      return compactText(JSON.stringify(input || {}), 120);
    } catch {
      return "";
    }
  }

  function rememberToolStarted(event) {
    const data = event.data || {};
    const toolUseId = data.toolUseId || data.tool_use_id;
    const toolName = data.toolName || cr("defaults.tool");
    if (!toolUseId || toolName !== "Bash") return;
    state.liveToolOutputs = {
      ...(state.liveToolOutputs || {}),
      [toolUseId]: {
        agentId: event.agentId || state.agent?.id,
        runId: data.runId || "",
        toolUseId,
        toolName,
        risk: data.risk || "exec",
        status: "running",
        output: "",
        truncated: false,
        createdAt: event.createdAt || new Date().toISOString(),
      },
    };
    renderLiveToolOutputCards();
  }

  function appendToolOutput(event) {
    const data = event.data || {};
    const toolUseId = data.toolUseId || data.tool_use_id;
    if (!toolUseId) return;
    const current = state.liveToolOutputs?.[toolUseId] || {
      agentId: event.agentId || state.agent?.id,
      runId: data.runId || "",
      toolUseId,
      toolName: data.toolName || cr("defaults.bash"),
      risk: data.risk || "exec",
      status: "running",
      output: "",
      truncated: false,
      createdAt: event.createdAt || new Date().toISOString(),
    };
    const nextOutput = trimLiveToolOutput(`${current.output || ""}${event.text || ""}`);
    state.liveToolOutputs = {
      ...(state.liveToolOutputs || {}),
      [toolUseId]: {
        ...current,
        toolName: data.toolName || current.toolName || cr("defaults.bash"),
        status: current.status || "running",
        output: nextOutput,
        truncated: Boolean(current.truncated || data.truncated),
      },
    };
    renderLiveToolOutputCards();
  }

  function finishToolOutput(event) {
    const data = event.data || {};
    const toolUseId = data.toolUseId || data.tool_use_id;
    const current = toolUseId ? state.liveToolOutputs?.[toolUseId] : null;
    if (!toolUseId || !current) return;
    state.liveToolOutputs = {
      ...(state.liveToolOutputs || {}),
      [toolUseId]: {
        ...current,
        status: data.status || "completed",
        durationMs: data.durationMs || current.durationMs || 0,
      },
    };
    renderLiveToolOutputCards();
    const agentId = current.agentId || state.agent?.id || "";
    window.setTimeout(() => {
      const existing = state.liveToolOutputs?.[toolUseId];
      if (!existing || (existing.agentId && agentId && existing.agentId !== agentId)) return;
      const next = { ...(state.liveToolOutputs || {}) };
      delete next[toolUseId];
      state.liveToolOutputs = next;
      renderLiveToolOutputCards();
    }, 2500);
  }

  function currentLiveToolOutputList() {
    const agentId = state.agent?.id || "";
    return Object.values(state.liveToolOutputs || {})
      .filter((item) => item && (!item.agentId || item.agentId === agentId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function renderLiveToolOutputCardsHTML() {
    const outputs = currentLiveToolOutputList();
    if (!outputs.length) return "";
    return `
      <div class="live-tool-output-stack chat-flow-stack chat-flow-left" data-chat-alignment="left" data-live-tool-output-stack>
        ${outputs.map(renderLiveToolOutputCard).join("")}
      </div>
    `;
  }

  function renderLiveToolOutputCard(item) {
    const status = item.status || "running";
    const output = item.output || cr("liveOutput.waiting");
    return `
      <section class="live-tool-output-card chat-flow-item chat-flow-left chat-report-card ${escapeAttr(toolStatusClass(status))}" data-chat-alignment="left" data-chat-report="tool-output" data-live-tool-output-card="${escapeAttr(item.toolUseId || "")}">
        <div class="live-tool-output-head">
          <div>
            <div class="live-tool-output-title">${escapeHtml(cr("liveOutput.title", { toolName: item.toolName || cr("defaults.bash") }))}</div>
            <div class="live-tool-output-meta">${escapeHtml(status)}${item.durationMs ? ` · ${escapeHtml(formatNumber(item.durationMs))} ms` : ""}${item.runId ? ` · ${escapeHtml(shortRunId(item.runId))}` : ""}</div>
          </div>
          <span class="live-tool-output-dot">${status === "running" ? cr("liveOutput.running") : toolStatusLabel(status)}</span>
        </div>
        <pre class="live-tool-output-body">${escapeHtml(output)}</pre>
        ${item.truncated ? `<div class="live-tool-output-note">${escapeHtml(cr("liveOutput.truncated"))}</div>` : ""}
      </section>
    `;
  }

  function renderLiveToolOutputCards() {
    const el = $("messages");
    if (!el) return;
    const existing = el.querySelector("[data-live-tool-output-stack]");
    if (existing) existing.remove();
    const html = renderLiveToolOutputCardsHTML();
    if (!html) return;
    if (el.classList.contains("empty")) {
      el.classList.remove("empty");
      el.innerHTML = html;
    } else {
      const runSummary = el.querySelector("[data-run-summary-card]");
      const approvalStack = el.querySelector("[data-approval-stack]");
      if (runSummary) runSummary.insertAdjacentHTML("beforebegin", html);
      else if (approvalStack) approvalStack.insertAdjacentHTML("beforebegin", html);
      else el.insertAdjacentHTML("beforeend", html);
    }
    el.scrollTop = el.scrollHeight;
  }

  function trimLiveToolOutput(text) {
    const max = 40000;
    const value = String(text || "");
    if (value.length <= max) return value;
    return `${cr("liveOutput.earlierTruncated")}\n${value.slice(value.length - max)}`;
  }

  function currentApprovalList() {
    const agentId = state.agent?.id || "";
    return Object.values(state.pendingToolApprovals || {})
      .filter((item) => item && (!item.agentId || item.agentId === agentId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function renderApprovalCardsHTML() {
    const approvals = currentApprovalList();
    if (!approvals.length) return "";
    return `
      <div class="approval-stack chat-flow-stack chat-flow-left" data-chat-alignment="left" data-approval-stack>
        ${approvals.map(renderApprovalCard).join("")}
      </div>
    `;
  }

  function renderApprovalCard(approval) {
    const risk = approval.risk || "exec";
    const isDanger = risk === "danger";
    const command = approval.command || approval.input?.command || JSON.stringify(approval.input || {});
    const title = isDanger ? cr("approval.blockedTitle") : cr("approval.requiredTitle");
    const warning = approval.warning || (isDanger ? cr("approval.blockedWarning") : cr("approval.warning"));
    return `
      <section class="approval-card chat-flow-item chat-flow-left chat-report-card ${isDanger ? "danger" : ""}" data-chat-alignment="left" data-chat-report="tool-approval" data-approval-card="${escapeAttr(approval.toolUseId || "")}">
        <div class="approval-card-head">
          <div>
            <div class="approval-title">${escapeHtml(title)}</div>
            <div class="approval-meta">${escapeHtml(approval.toolName || cr("defaults.tool"))} · ${escapeHtml(risk)} · ${escapeHtml(shortPath(approval.cwd || state.agent?.cwd || ""))}</div>
          </div>
          <span class="approval-risk">${escapeHtml(risk)}</span>
        </div>
        <pre class="approval-command">${escapeHtml(command)}</pre>
        <div class="approval-warning">${escapeHtml(warning)}</div>
        ${approval.expiresAt ? `<div class="approval-meta">${escapeHtml(cr("approval.expires", { time: formatTimestamp(approval.expiresAt) }))}</div>` : ""}
        ${isDanger ? `<div class="approval-blocked-note">${escapeHtml(cr("approval.blockedNote"))}</div>` : `
          <div class="approval-actions">
            <button class="ghost-btn mini" type="button" data-approval-decision="allow_once" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">${escapeHtml(cr("approval.allowOnce"))}</button>
            <button class="ghost-btn mini" type="button" data-approval-decision="allow_session" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">${escapeHtml(cr("approval.allowSession"))}</button>
            <button class="ghost-btn mini danger" type="button" data-approval-decision="deny" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">${escapeHtml(cr("approval.deny"))}</button>
          </div>
        `}
      </section>
    `;
  }

  function renderApprovalCards() {
    const el = $("messages");
    if (!el) return;
    const existing = el.querySelector("[data-approval-stack]");
    if (existing) existing.remove();
    const html = renderApprovalCardsHTML();
    if (!html) return;
    if (el.classList.contains("empty")) {
      el.classList.remove("empty");
      el.innerHTML = html;
    } else {
      el.insertAdjacentHTML("beforeend", html);
    }
    bindApprovalButtons(el);
    el.scrollTop = el.scrollHeight;
  }

  function bindApprovalButtons(root) {
    root.querySelectorAll("[data-approval-decision]").forEach((button) => {
      button.addEventListener("click", () => approveToolCall(button.dataset.toolUseId, button.dataset.approvalDecision, button));
    });
  }

  async function approveToolCall(toolUseId, decision, button) {
    if (!state.agent?.id || !toolUseId || !decision) return;
    const approval = state.pendingToolApprovals?.[toolUseId];
    const buttons = button?.closest(".approval-card")?.querySelectorAll("button") || [];
    buttons.forEach((node) => { node.disabled = true; });
    try {
      await api(`/api/agents/${state.agent.id}/tool-calls/${encodeURIComponent(toolUseId)}/approval`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: decision === "deny" ? "denied in UI" : "approved in UI" }),
      });
      const next = { ...(state.pendingToolApprovals || {}) };
      delete next[toolUseId];
      state.pendingToolApprovals = next;
      renderApprovalCards();
      showToast(decision === "deny" ? cr("approval.deniedToast") : cr("approval.approvedToast"), decision === "deny" ? "warn" : "success");
      notifyTerminal(`[tool] ${decision}: ${approval?.toolName || cr("defaults.tool")} ${toolUseId}\n`);
      scheduleMessageRefresh(120, state.agent.id);
    } catch (err) {
      buttons.forEach((node) => { node.disabled = false; });
      showError(err);
    }
  }

  function replacePendingApprovals(approvals, agentId = state.agent?.id) {
    if (!agentId || state.agent?.id !== agentId) return false;
    const next = { ...(state.pendingToolApprovals || {}) };
    for (const [key, value] of Object.entries(next)) {
      if (!value?.agentId || value.agentId === agentId) delete next[key];
    }
    for (const call of Array.isArray(approvals) ? approvals : []) {
      const toolUseId = call?.toolUseId || call?.tool_use_id;
      if (!toolUseId) continue;
      const input = call.inputJson && typeof call.inputJson === "object" ? call.inputJson : {};
      const toolName = call.toolName || cr("defaults.tool");
      const lowerToolName = String(toolName).toLowerCase();
      next[toolUseId] = {
        ...call,
        agentId,
        toolUseId,
        toolName,
        command: input.command || input.file_path || input.path || JSON.stringify(input),
        cwd: input.cwd || state.agent?.cwd || "",
        risk: lowerToolName === "bash" ? "exec" : (["write", "edit"].includes(lowerToolName) ? "write" : "read"),
        warning: call.permissionSuggestions || call.permissionDecisionReason || cr("approval.awaiting"),
        createdAt: call.createdAt || new Date().toISOString(),
      };
    }
    state.pendingToolApprovals = next;
    renderApprovalCards();
    return true;
  }

  function rememberToolApproval(event) {
    const data = event.data || {};
    const toolUseId = data.toolUseId || data.tool_use_id;
    if (!toolUseId) return;
    state.pendingToolApprovals = {
      ...(state.pendingToolApprovals || {}),
      [toolUseId]: {
        ...data,
        agentId: event.agentId || state.agent?.id,
        toolUseId,
        createdAt: event.createdAt || new Date().toISOString(),
      },
    };
    renderApprovalCards();
  }

  function clearToolApproval(toolUseId) {
    if (!toolUseId || !state.pendingToolApprovals?.[toolUseId]) return;
    const next = { ...(state.pendingToolApprovals || {}) };
    delete next[toolUseId];
    state.pendingToolApprovals = next;
    renderApprovalCards();
  }

  function clearCurrentAgentApprovals() {
    const agentId = state.agent?.id;
    if (!agentId) return;
    const next = { ...(state.pendingToolApprovals || {}) };
    for (const [key, value] of Object.entries(next)) {
      if (!value?.agentId || value.agentId === agentId) delete next[key];
    }
    state.pendingToolApprovals = next;
    renderApprovalCards();
  }

  function renderMessageAttachments(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return "";
    return `
      <div class="message-attachments">
        ${attachments.map((attachment) => renderSentAttachmentCard(message, attachment)).join("")}
      </div>
    `;
  }

  function renderSentAttachmentCard(message, attachment) {
    const kind = attachment.kind || attachmentKind({ name: attachment.filename || "", type: attachment.mimeType || "" });
    const url = attachmentURL(message, attachment);
    const subtitle = [attachmentKindLabel(kind), formatBytes(attachment.sizeBytes || 0)].filter(Boolean).join(" · ");
    const thumb = kind === "image"
      ? `<img class="attachment-thumb" src="${escapeAttr(url)}" alt="" loading="lazy" />`
      : `<span class="attachment-thumb">${escapeHtml(attachmentIcon(kind))}</span>`;
    return `
      <a class="attachment-card" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">
        ${thumb}
        <div class="attachment-meta">
          <div class="attachment-name" title="${escapeAttr(attachment.filename || cr("attachment.attachment"))}">${escapeHtml(attachment.filename || cr("attachment.attachment"))}</div>
          <div class="attachment-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </a>
    `;
  }

  function attachmentURL(message, attachment) {
    return `/api/agents/${encodeURIComponent(message.agentId || state.agent?.id || "")}/messages/${encodeURIComponent(message.id || attachment.messageId || "")}/attachments/${encodeURIComponent(attachment.id || "")}`;
  }

  function messageAttachmentsMarkdown(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return "";
    const lines = attachments.map((attachment) => `- ${cr("attachment.line", { filename: attachment.filename || cr("attachment.attachment"), kind: attachmentKindLabel(attachment.kind), size: formatBytes(attachment.sizeBytes || 0) })}`);
    return `\n\n${cr("attachment.heading")}\n${lines.join("\n")}`;
  }

  function attachmentKindLabel(kind) {
    if (kind === "image") return cr("attachment.images");
    if (kind === "pdf") return cr("attachment.pdf");
    if (kind === "docx") return cr("attachment.docx");
    if (kind === "text") return cr("attachment.text");
    return cr("attachment.file");
  }

  function updateConversationCopyButton() {
    const button = $("copyConversationBtn");
    if (!button) return;
    const count = Array.isArray(state.currentMessages) ? state.currentMessages.length : 0;
    button.disabled = count === 0;
    button.title = count ? cr("conversation.copyTitle", { count }) : cr("conversation.noCopyTitle");
  }

  function conversationMarkdown() {
    const messages = Array.isArray(state.currentMessages) ? state.currentMessages : [];
    const title = state.project?.name || state.agent?.title || "Autoto Conversation";
    const meta = [
      `# ${cr("conversation.exportTitle", { title })}`,
      "",
      `- ${cr("conversation.exportedAt", { time: formatTimestamp(new Date()) })}`,
      `- ${cr("conversation.project", { project: state.project?.name || cr("conversation.unselected") })}`,
      `- ${cr("conversation.path", { path: state.agent?.cwd || state.project?.gitPath || cr("conversation.unset") })}`,
      `- ${cr("conversation.agent", { agent: state.agent?.title || state.agent?.id || cr("conversation.unselected") })}`,
      `- ${cr("conversation.model", { model: state.agent?.model || selectedModelValue() || cr("conversation.unselected") })}`,
      "",
    ];
    const body = messages.map((message, index) => {
      const role = String(message.role || cr("defaults.message")).toUpperCase();
      const text = visibleMessageText(message).trim() || cr("conversation.emptyMessage");
      return `## ${index + 1}. ${role}\n\n${text}${messageAttachmentsMarkdown(message)}`;
    });
    return [...meta, ...body].join("\n");
  }

  async function copyCurrentConversationMarkdown() {
    if (!state.currentMessages?.length) {
      showToast(cr("conversation.none"), "warn");
      return;
    }
    if (await copyToClipboard(conversationMarkdown())) {
      showToast(cr("conversation.copied"), "success");
      notifyTerminal(`[info] ${cr("conversation.copiedTerminal")}\n`);
      return;
    }
    showToast(cr("conversation.copyFailed"), "warn");
  }

  function clearMessageRefreshTimer(agentId) {
    const timer = state.messageRefreshTimersByAgent?.[agentId];
    if (!timer) return;
    window.clearTimeout(timer);
    const next = { ...(state.messageRefreshTimersByAgent || {}) };
    delete next[agentId];
    state.messageRefreshTimersByAgent = next;
  }

  function scheduleMessageRefresh(delay = 0, agentId = state.agent?.id) {
    if (!agentId) return;
    clearMessageRefreshTimer(agentId);
    const timer = window.setTimeout(() => {
      clearMessageRefreshTimer(agentId);
      loadMessages(agentId).catch((err) => notifyTerminal(`[warn] ${cr("conversation.refreshFailed", { message: err.message || err })}\n`));
    }, Math.max(0, delay));
    state.messageRefreshTimersByAgent = { ...(state.messageRefreshTimersByAgent || {}), [agentId]: timer };
  }

  function friendlyMessageText(text) {
    const value = String(text || "");
    if (value.includes("OpenAI official provider is not configured")) {
      return cr("provider.openAI");
    }
    if (value.includes("Anthropic provider is not configured")) {
      return cr("provider.anthropic");
    }
    if (value.includes("OpenAI-compatible provider is not configured")) {
      return cr("provider.compatible");
    }
    if (value.includes("cliproxyapi provider request failed") && value.includes("127.0.0.1:8317")) {
      return cr("provider.cliProxyUnavailable");
    }
    if (value.includes("cliproxyapi model request failed: 401")) {
      return cr("provider.cliProxyUnauthorized");
    }
    return value;
  }

  function renderMarkdown(text) {
    const blocks = [];
    const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) blocks.push(renderMarkdownText(text.slice(lastIndex, match.index)));
      const lang = (match[1] || "text").trim() || "text";
      const code = match[2] || "";
      blocks.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span><button class="copy-code" type="button" data-code="${escapeAttr(code)}">${escapeHtml(cr("code.copy"))}</button></div><pre><code>${highlightCode(code, lang)}</code></pre></div>`);
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) blocks.push(renderMarkdownText(text.slice(lastIndex)));
    return blocks.join("");
  }

  function renderMarkdownText(text) {
    const lines = String(text || "").split(/\n+/).filter((line) => line.trim() !== "");
    if (!lines.length) return "";
    const html = [];
    let list = [];
    const flushList = () => {
      if (list.length) {
        html.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
        list = [];
      }
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        list.push(bullet[1]);
      } else {
        flushList();
        html.push(`<p>${renderInlineMarkdown(line)}</p>`);
      }
    }
    flushList();
    return html.join("");
  }

  function renderInlineMarkdown(text) {
    return escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `<code class="inline-code">${code}</code>`);
  }

  function highlightCode(code, lang) {
    const tokens = [];
    const hold = (html) => {
      const key = `\uE000TOK${tokens.length}\uE001`;
      tokens.push(html);
      return key;
    };
    let html = escapeHtml(code);
    html = html.replace(/("[^"\n]*"|'[^'\n]*')/g, (value) => hold(`<span class="tok-string">${value}</span>`));
    html = html.replace(/(\/\/.*|#.*)$/gm, (value) => hold(`<span class="tok-comment">${value}</span>`));
    const keywordSet = "const|let|var|function|return|if|else|for|while|switch|case|break|class|type|struct|func|package|import|from|export|async|await|try|catch|defer|go|select|range";
    html = html.replace(new RegExp(`\\b(${keywordSet})\\b`, "g"), '<span class="tok-keyword">$1</span>');
    return html.replace(/\uE000TOK(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
  }

  function bindMessageActionButtons(root) {
    root.querySelectorAll("[data-correct-message]").forEach((button) => {
      button.addEventListener("click", () => openCorrectionEditor(button.dataset.correctMessage || ""));
    });
    root.querySelector("[data-correction-cancel]")?.addEventListener("click", closeCorrectionEditor);
    root.querySelector("[data-correction-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCorrection(event.currentTarget).catch(showError);
    });
    root.querySelector("[data-correction-text]")?.addEventListener("input", (event) => {
      state.correctionText = event.target.value;
    });
    root.querySelector("[data-correction-files]")?.addEventListener("change", (event) => {
      state.correctionText = root.querySelector("[data-correction-text]")?.value ?? state.correctionText ?? "";
      state.correctionFiles = Array.from(event.target?.files || []).filter(Boolean);
      applyMessageSnapshot(state.currentMessages, state.agent?.id);
    });
    root.querySelector("[data-correction-text]")?.addEventListener("paste", (event) => {
      const files = correctionClipboardFiles(event);
      if (!files.length) return;
      state.correctionFiles = [...(state.correctionFiles || []), ...files];
      window.setTimeout(() => applyMessageSnapshot(state.currentMessages, state.agent?.id), 0);
    });
    root.querySelectorAll("[data-copy-message]").forEach((button) => {
      button.addEventListener("click", async () => {
        const index = Number(button.dataset.copyMessage || -1);
        const text = state.messageCopyTexts[index] || "";
        const original = button.textContent;
        if (text && await copyToClipboard(text)) {
          button.textContent = cr("message.copied");
          showToast(cr("message.copiedToast"), "success");
          notifyTerminal(`[info] ${cr("message.copiedToast")}\n`);
        } else {
          button.textContent = cr("message.copyFailed");
          showToast(cr("message.copyFailedToast"), "warn");
        }
        window.setTimeout(() => { button.textContent = original; }, 1200);
      });
    });
  }

  function bindCopyCodeButtons(root) {
    root.querySelectorAll(".copy-code").forEach((button) => {
      button.addEventListener("click", async () => {
        const ok = await copyToClipboard(button.dataset.code || "");
        const original = button.textContent;
        button.textContent = ok ? cr("code.copied") : cr("code.copyFailed");
        if (!ok) showToast(cr("code.copyFailedToast"), "warn");
        setTimeout(() => { button.textContent = original; }, 1200);
      });
    });
  }

  return {
    appendLiveAssistantText,
    appendToolOutput,
    applyMessageSnapshot,
    clearCurrentAgentApprovals,
    clearLiveAssistantText,
    clearMessageRefreshTimer,
    clearRunSummary,
    clearToolApproval,
    copyCurrentConversationMarkdown,
    finishToolOutput,
    loadLatestRunSummary,
    loadMessages,
    loadOlderMessages,
    loadRunSummary,
    rememberToolApproval,
    rememberToolStarted,
    replacePendingApprovals,
    scheduleMessageRefresh,
    updateConversationCopyButton,
  };
}
