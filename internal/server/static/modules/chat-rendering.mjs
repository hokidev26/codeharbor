import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatBytes, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";
import { api } from "./runtime.mjs";

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
  async function loadMessages(narratorId = state.narrator?.id) {
    if (!narratorId) return;
    let messages = [];
    try {
      messages = await api(`/api/narrators/${narratorId}/messages`);
    } catch (err) {
      if (state.narrator?.id === narratorId) throw err;
      return;
    }
    if (state.narrator?.id !== narratorId) return;
    const el = $("messages");
    state.currentMessages = messages;
    state.messageCopyTexts = messages.map((message) => String(message.contentText || ""));
    updateConversationCopyButton();
    const liveToolCards = renderLiveToolOutputCardsHTML();
    const runSummaryCard = renderRunSummaryCardHTML();
    const approvalCards = renderApprovalCardsHTML();
    if (!messages.length && !liveToolCards && !runSummaryCard && !approvalCards) {
      el.classList.add("empty");
      el.textContent = "还没有消息。输入你的需求开始对话。";
      return;
    }
    el.classList.remove("empty");
    el.innerHTML = `${messages.map((message, index) => `
      <div class="message ${escapeAttr(message.role)}">
        <div class="message-head">
          <div class="message-role">${escapeHtml(message.role)}</div>
          <button class="message-copy-btn" type="button" data-copy-message="${escapeAttr(String(index))}" title="复制消息原文">复制</button>
        </div>
        <div class="message-content">${renderMarkdown(friendlyMessageText(message.contentText || ""))}</div>
        ${renderMessageAttachments(message)}
      </div>
    `).join("")}${liveToolCards}${runSummaryCard}${approvalCards}`;
    bindMessageActionButtons(el);
    bindRunSummaryButtons(el);
    bindApprovalButtons(el);
    bindCopyCodeButtons(el);
    el.scrollTop = el.scrollHeight;
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

  async function loadLatestRunSummary(narratorId = state.narrator?.id) {
    if (!narratorId) return null;
    const seq = Number(state.runSummarySeq || 0) + 1;
    state.runSummarySeq = seq;
    state.activeRunSummary = null;
    state.activeRunSummaryRunId = "";
    state.runSummaryLoading = false;
    state.runSummaryError = "";
    state.runRollbackBusy = false;
    try {
      const runs = await api(`/api/narrators/${narratorId}/runs?limit=1`);
      if (seq !== state.runSummarySeq || state.narrator?.id !== narratorId) return null;
      const run = Array.isArray(runs) ? runs[0] : null;
      if (!run || !isTerminalRunStatus(run.status)) {
        renderRunSummaryCard();
        return null;
      }
      return await loadRunSummary(run.id, { narratorId });
    } catch (err) {
      if (seq === state.runSummarySeq && state.narrator?.id === narratorId) {
        state.runSummaryError = err.message || String(err);
        renderRunSummaryCard();
      }
      notifyTerminal?.(`[warn] 最近 Run 回顾加载失败：${err.message || err}\n`);
      return null;
    }
  }

  async function loadRunSummary(runId, options = {}) {
    const narratorId = options.narratorId || state.narrator?.id;
    if (!narratorId || !runId) return null;
    const seq = Number(state.runSummarySeq || 0) + 1;
    state.runSummarySeq = seq;
    state.activeRunSummaryRunId = runId;
    state.runSummaryLoading = true;
    state.runSummaryError = "";
    renderRunSummaryCard();
    try {
      const summary = await api(`/api/narrators/${narratorId}/runs/${encodeURIComponent(runId)}`);
      if (seq !== state.runSummarySeq || state.narrator?.id !== narratorId) return null;
      state.activeRunSummary = summary;
      state.activeRunSummaryRunId = summary?.run?.id || runId;
      state.runSummaryLoading = false;
      state.runSummaryError = "";
      renderRunSummaryCard();
      if (options.notify) showToast("Run 回顾已刷新。", "success");
      return summary;
    } catch (err) {
      if (seq !== state.runSummarySeq || state.narrator?.id !== narratorId) return null;
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
      <section class="run-summary-card ${escapeAttr(runStatusClass(status))}" data-run-summary-card data-run-id="${escapeAttr(runId)}">
        <div class="run-summary-head">
          <div>
            <div class="run-summary-kicker">任务回顾</div>
            <div class="run-summary-title">${escapeHtml(runStatusLabel(status))}${state.runSummaryLoading ? " · 正在刷新" : ""}</div>
            <div class="run-summary-meta">${escapeHtml(runTimeRange(run))}${runId ? ` · ${escapeHtml(shortRunId(runId))}` : ""}</div>
          </div>
          <span class="run-summary-status">${escapeHtml(status)}</span>
        </div>
        ${state.runSummaryError ? `<div class="run-summary-alert">${escapeHtml(state.runSummaryError)}</div>` : ""}
        ${renderRunCheckpoint(run, checkpoint)}
        <div class="run-summary-metrics">
          ${renderRunMetric("消息", summary?.messageCount)}
          ${renderRunMetric("工具", summary?.toolCallCount)}
          ${renderRunMetric("待审批", summary?.pendingApprovals, Number(summary?.pendingApprovals || 0) ? "warn" : "")}
          ${renderRunMetric("拒绝 / 错误", `${formatNumber(summary?.deniedToolCalls || 0)} / ${formatNumber(summary?.errorToolCalls || 0)}`, Number(summary?.deniedToolCalls || 0) || Number(summary?.errorToolCalls || 0) ? "bad" : "")}
          ${renderRunMetric("API", summary?.apiRequestCount)}
          ${renderRunMetric("Tokens in / out", tokenText)}
          ${renderRunMetric("成本", formatMoney(summary?.costUsd || 0))}
        </div>
        ${renderRunToolCalls(toolCalls)}
        ${renderRunMessagePreviews(recentMessages)}
        <div class="run-summary-actions">
          <button class="ghost-btn mini" type="button" data-run-summary-open-git>查看 Git 变更</button>
          <button class="ghost-btn mini danger" type="button" data-run-summary-rollback="${escapeAttr(runId)}" title="${escapeAttr(checkpoint.reason)}" ${checkpoint.available && runId && !state.runRollbackBusy ? "" : "disabled"}>${state.runRollbackBusy ? "回滚中…" : "回滚到开始前"}</button>
          <button class="ghost-btn mini" type="button" data-run-summary-copy="${escapeAttr(runId)}" ${summary ? "" : "disabled"}>复制摘要</button>
          <button class="ghost-btn mini" type="button" data-run-summary-refresh="${escapeAttr(runId)}" ${runId ? "" : "disabled"}>刷新回顾</button>
        </div>
      </section>
    `;
  }

  function renderRunCheckpoint(run, checkpoint = runCheckpointState(run)) {
    if (!run) return "";
    const head = run.baseHead ? shortGitHash(run.baseHead) : "未记录";
    return `
      <div class="run-summary-checkpoint ${escapeAttr(checkpoint.tone)}">
        <span>Git checkpoint</span>
        <strong>${escapeHtml(head)}</strong>
        <em>${escapeHtml(checkpoint.reason)}</em>
      </div>
    `;
  }

  function runCheckpointState(run) {
    if (!run?.baseHead) {
      return { available: false, tone: "muted", reason: "本轮开始时工作区不干净或无法读取 Git HEAD，不能自动回滚。" };
    }
    if (run.endHead && run.endHead !== run.baseHead) {
      return { available: false, tone: "warn", reason: "本轮产生了提交，自动回滚不会跨 commit 执行。" };
    }
    return { available: true, tone: "ok", reason: `可恢复到 ${shortGitHash(run.baseHead)}，并清理 checkpoint 之后产生的未跟踪文件。` };
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
    if (!toolCalls.length) return `<div class="run-summary-empty">本轮没有工具调用。</div>`;
    const visible = toolCalls.slice(0, 6);
    const more = toolCalls.length > visible.length ? `<div class="run-summary-more">另有 ${escapeHtml(formatNumber(toolCalls.length - visible.length))} 个工具调用未显示。</div>` : "";
    return `
      <div class="run-summary-section">
        <div class="run-summary-section-title">工具调用</div>
        <div class="run-tool-list">
          ${visible.map((call) => `
            <div class="run-tool-row ${escapeAttr(toolStatusClass(call.status))}">
              <span class="run-tool-name">${escapeHtml(call.toolName || "tool")}</span>
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
        <div class="run-summary-section-title">最近消息</div>
        <div class="run-message-preview-list">
          ${messages.slice(-3).map((message) => `
            <div class="run-message-preview">
              <span>${escapeHtml(message.role || "message")}</span>
              <strong>${escapeHtml(compactText(message.contentText || "", 120))}</strong>
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
        else showToast("Git 面板暂不可用。", "warn");
      });
    });
  }

  async function rollbackRunToCheckpoint(runId) {
    const narratorId = state.narrator?.id;
    const run = state.activeRunSummary?.run;
    const checkpoint = runCheckpointState(run);
    if (!narratorId || !runId || !checkpoint.available) {
      showToast(checkpoint.reason || "当前 Run 没有可用 checkpoint。", "warn", { force: true });
      return;
    }
    const confirmed = window.confirm("确认回滚到本轮开始前的 Git checkpoint？\n\n这会恢复 tracked/staged 文件，并删除 checkpoint 之后产生的未跟踪文件；不会 push，也不会跨 commit 回滚。");
    if (!confirmed) return;
    state.runRollbackBusy = true;
    state.runSummaryError = "";
    renderRunSummaryCard();
    try {
      const result = await api(`/api/narrators/${narratorId}/runs/${encodeURIComponent(runId)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      if (state.narrator?.id !== narratorId) return;
      if (result?.status) {
        state.gitStatus = result.status;
        state.gitDiff = null;
      }
      showToast("已回滚到任务开始前 checkpoint。", "success", { force: true });
      if (typeof refreshGitWorkflow === "function") {
        try {
          await refreshGitWorkflow({ silent: true });
        } catch (err) {
          notifyTerminal?.(`[warn] Git 状态刷新失败：${err.message || err}\n`);
        }
      }
    } catch (err) {
      if (state.narrator?.id !== narratorId) return;
      state.runSummaryError = err.message || String(err);
      renderRunSummaryCard();
      throw err;
    } finally {
      if (state.narrator?.id === narratorId) {
        state.runRollbackBusy = false;
        renderRunSummaryCard();
      }
    }
  }

  async function copyActiveRunSummaryMarkdown(button) {
    const summary = state.activeRunSummary;
    if (!summary?.run || !copyToClipboard) {
      showToast("当前没有可复制的 Run 回顾。", "warn");
      return;
    }
    const original = button?.textContent || "复制摘要";
    const ok = await copyToClipboard(runSummaryMarkdown(summary));
    if (button) {
      button.textContent = ok ? "已复制" : "复制失败";
      window.setTimeout(() => { button.textContent = original; }, 1200);
    }
    showToast(ok ? "Run 回顾 Markdown 已复制。" : "复制 Run 回顾失败。", ok ? "success" : "warn");
  }

  function runSummaryMarkdown(summary) {
    const run = summary.run || {};
    const lines = [
      `# Run 回顾 ${run.id || ""}`.trim(),
      "",
      `- 状态：${run.status || "unknown"}`,
      `- 时间：${runTimeRange(run)}`,
      `- 消息：${formatNumber(summary.messageCount || 0)}`,
      `- 工具调用：${formatNumber(summary.toolCallCount || 0)}（待审批 ${formatNumber(summary.pendingApprovals || 0)}，拒绝 ${formatNumber(summary.deniedToolCalls || 0)}，错误 ${formatNumber(summary.errorToolCalls || 0)}）`,
      `- API 请求：${formatNumber(summary.apiRequestCount || 0)}`,
      `- Tokens：${formatNumber(summary.inputTokens || 0)} in / ${formatNumber(summary.outputTokens || 0)} out`,
      `- 成本：${formatMoney(summary.costUsd || 0)}`,
      "",
      "## 工具调用",
    ];
    const toolCalls = Array.isArray(summary.toolCalls) ? summary.toolCalls : [];
    if (!toolCalls.length) lines.push("- 无");
    else toolCalls.forEach((call) => lines.push(`- ${call.toolName || "tool"}：${call.status || "unknown"}${call.errorMessage ? ` — ${call.errorMessage}` : ""}`));
    const messages = Array.isArray(summary.recentMessages) ? summary.recentMessages : [];
    if (messages.length) {
      lines.push("", "## 最近消息");
      messages.slice(-6).forEach((message) => lines.push(`- ${message.role || "message"}: ${compactText(message.contentText || "", 180)}`));
    }
    return lines.join("\n");
  }

  function isTerminalRunStatus(status) {
    return ["completed", "error", "interrupted", "superseded"].includes(String(status || ""));
  }

  function runStatusLabel(status) {
    const value = String(status || "unknown");
    if (value === "completed") return "任务已完成";
    if (value === "error") return "任务失败";
    if (value === "interrupted") return "任务已中断";
    if (value === "superseded") return "任务已被新请求替换";
    if (value === "running") return "任务运行中";
    if (value === "pending") return "任务等待运行";
    if (value === "loading") return "正在加载任务回顾";
    return "任务状态未知";
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
    if (value === "completed") return "完成";
    if (value === "pending_approval") return "待审批";
    if (value === "denied") return "拒绝";
    if (value === "error") return "错误";
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
    if (!run) return "暂无时间";
    const start = formatTimestamp(run.startedAt || run.createdAt);
    const end = run.completedAt ? formatTimestamp(run.completedAt) : "未完成";
    return `${start} → ${end}`;
  }

  function shortRunId(runId) {
    const value = String(runId || "");
    if (value.length <= 12) return value;
    return `${value.slice(0, 8)}…${value.slice(-4)}`;
  }

  function compactText(text, max = 140) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "（空）";
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
    const toolName = data.toolName || "tool";
    if (!toolUseId || toolName !== "Bash") return;
    state.liveToolOutputs = {
      ...(state.liveToolOutputs || {}),
      [toolUseId]: {
        narratorId: event.narratorId || state.narrator?.id,
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
      narratorId: event.narratorId || state.narrator?.id,
      runId: data.runId || "",
      toolUseId,
      toolName: data.toolName || "Bash",
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
        toolName: data.toolName || current.toolName || "Bash",
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
    const narratorId = current.narratorId || state.narrator?.id || "";
    window.setTimeout(() => {
      const existing = state.liveToolOutputs?.[toolUseId];
      if (!existing || (existing.narratorId && narratorId && existing.narratorId !== narratorId)) return;
      const next = { ...(state.liveToolOutputs || {}) };
      delete next[toolUseId];
      state.liveToolOutputs = next;
      renderLiveToolOutputCards();
    }, 2500);
  }

  function currentLiveToolOutputList() {
    const narratorId = state.narrator?.id || "";
    return Object.values(state.liveToolOutputs || {})
      .filter((item) => item && (!item.narratorId || item.narratorId === narratorId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function renderLiveToolOutputCardsHTML() {
    const outputs = currentLiveToolOutputList();
    if (!outputs.length) return "";
    return `
      <div class="live-tool-output-stack" data-live-tool-output-stack>
        ${outputs.map(renderLiveToolOutputCard).join("")}
      </div>
    `;
  }

  function renderLiveToolOutputCard(item) {
    const status = item.status || "running";
    const output = item.output || "等待命令输出…";
    return `
      <section class="live-tool-output-card ${escapeAttr(toolStatusClass(status))}" data-live-tool-output-card="${escapeAttr(item.toolUseId || "")}">
        <div class="live-tool-output-head">
          <div>
            <div class="live-tool-output-title">${escapeHtml(item.toolName || "Bash")} 实时输出</div>
            <div class="live-tool-output-meta">${escapeHtml(status)}${item.durationMs ? ` · ${escapeHtml(formatNumber(item.durationMs))} ms` : ""}${item.runId ? ` · ${escapeHtml(shortRunId(item.runId))}` : ""}</div>
          </div>
          <span class="live-tool-output-dot">${status === "running" ? "运行中" : toolStatusLabel(status)}</span>
        </div>
        <pre class="live-tool-output-body">${escapeHtml(output)}</pre>
        ${item.truncated ? `<div class="live-tool-output-note">实时输出过长，已截断；最终结果仍会保存为工具结果摘要。</div>` : ""}
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
    return `...[earlier output truncated]\n${value.slice(value.length - max)}`;
  }

  function currentApprovalList() {
    const narratorId = state.narrator?.id || "";
    return Object.values(state.pendingToolApprovals || {})
      .filter((item) => item && (!item.narratorId || item.narratorId === narratorId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function renderApprovalCardsHTML() {
    const approvals = currentApprovalList();
    if (!approvals.length) return "";
    return `
      <div class="approval-stack" data-approval-stack>
        ${approvals.map(renderApprovalCard).join("")}
      </div>
    `;
  }

  function renderApprovalCard(approval) {
    const risk = approval.risk || "exec";
    const isDanger = risk === "danger";
    const command = approval.command || approval.input?.command || JSON.stringify(approval.input || {});
    const title = isDanger ? "危险命令已被阻止" : "需要批准执行命令";
    const warning = approval.warning || (isDanger ? "该命令被安全策略阻止。" : "请确认命令安全后再允许。");
    return `
      <section class="approval-card ${isDanger ? "danger" : ""}" data-approval-card="${escapeAttr(approval.toolUseId || "")}">
        <div class="approval-card-head">
          <div>
            <div class="approval-title">${escapeHtml(title)}</div>
            <div class="approval-meta">${escapeHtml(approval.toolName || "tool")} · ${escapeHtml(risk)} · ${escapeHtml(shortPath(approval.cwd || state.narrator?.cwd || ""))}</div>
          </div>
          <span class="approval-risk">${escapeHtml(risk)}</span>
        </div>
        <pre class="approval-command">${escapeHtml(command)}</pre>
        <div class="approval-warning">${escapeHtml(warning)}</div>
        ${approval.expiresAt ? `<div class="approval-meta">到期：${escapeHtml(formatTimestamp(approval.expiresAt))}</div>` : ""}
        ${isDanger ? `<div class="approval-blocked-note">后端已硬阻断该命令，无法通过 UI 放行。</div>` : `
          <div class="approval-actions">
            <button class="ghost-btn mini" type="button" data-approval-decision="allow_once" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">允许一次</button>
            <button class="ghost-btn mini" type="button" data-approval-decision="allow_session" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">本次会话都允许</button>
            <button class="ghost-btn mini danger" type="button" data-approval-decision="deny" data-tool-use-id="${escapeAttr(approval.toolUseId || "")}">拒绝</button>
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
    if (!state.narrator?.id || !toolUseId || !decision) return;
    const approval = state.pendingToolApprovals?.[toolUseId];
    const buttons = button?.closest(".approval-card")?.querySelectorAll("button") || [];
    buttons.forEach((node) => { node.disabled = true; });
    try {
      await api(`/api/narrators/${state.narrator.id}/tool-calls/${encodeURIComponent(toolUseId)}/approval`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: decision === "deny" ? "denied in UI" : "approved in UI" }),
      });
      const next = { ...(state.pendingToolApprovals || {}) };
      delete next[toolUseId];
      state.pendingToolApprovals = next;
      renderApprovalCards();
      showToast(decision === "deny" ? "已拒绝工具执行。" : "已批准工具执行。", decision === "deny" ? "warn" : "success");
      notifyTerminal(`[tool] ${decision}: ${approval?.toolName || "tool"} ${toolUseId}\n`);
      scheduleMessageRefresh(120, state.narrator.id);
    } catch (err) {
      buttons.forEach((node) => { node.disabled = false; });
      showError(err);
    }
  }

  function rememberToolApproval(event) {
    const data = event.data || {};
    const toolUseId = data.toolUseId || data.tool_use_id;
    if (!toolUseId) return;
    state.pendingToolApprovals = {
      ...(state.pendingToolApprovals || {}),
      [toolUseId]: {
        ...data,
        narratorId: event.narratorId || state.narrator?.id,
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

  function clearCurrentNarratorApprovals() {
    const narratorId = state.narrator?.id;
    if (!narratorId) return;
    const next = { ...(state.pendingToolApprovals || {}) };
    for (const [key, value] of Object.entries(next)) {
      if (!value?.narratorId || value.narratorId === narratorId) delete next[key];
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
          <div class="attachment-name" title="${escapeAttr(attachment.filename || "附件")}">${escapeHtml(attachment.filename || "附件")}</div>
          <div class="attachment-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </a>
    `;
  }

  function attachmentURL(message, attachment) {
    return `/api/narrators/${encodeURIComponent(message.narratorId || state.narrator?.id || "")}/messages/${encodeURIComponent(message.id || attachment.messageId || "")}/attachments/${encodeURIComponent(attachment.id || "")}`;
  }

  function messageAttachmentsMarkdown(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return "";
    const lines = attachments.map((attachment) => `- ${attachment.filename || "附件"}（${attachmentKindLabel(attachment.kind)}, ${formatBytes(attachment.sizeBytes || 0)}）`);
    return `\n\n附件：\n${lines.join("\n")}`;
  }

  function attachmentKindLabel(kind) {
    if (kind === "image") return "图片";
    if (kind === "pdf") return "PDF";
    if (kind === "docx") return "Word";
    if (kind === "text") return "文本";
    return "文件";
  }

  function updateConversationCopyButton() {
    const button = $("copyConversationBtn");
    if (!button) return;
    const count = Array.isArray(state.currentMessages) ? state.currentMessages.length : 0;
    button.disabled = count === 0;
    button.title = count ? `复制当前 ${count} 条消息为 Markdown` : "当前没有可复制的对话";
  }

  function conversationMarkdown() {
    const messages = Array.isArray(state.currentMessages) ? state.currentMessages : [];
    const title = state.project?.name || state.narrator?.title || "CodeHarbor Conversation";
    const meta = [
      `# ${title} 对话导出`,
      "",
      `- 导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      `- 项目：${state.project?.name || "未选择"}`,
      `- 路径：${state.narrator?.cwd || state.project?.gitPath || "未设置"}`,
      `- 代理：${state.narrator?.title || state.narrator?.id || "未选择"}`,
      `- 模型：${state.narrator?.model || selectedModelValue() || "未选择"}`,
      "",
    ];
    const body = messages.map((message, index) => {
      const role = String(message.role || "message").toUpperCase();
      const text = String(message.contentText || "").trim() || "（空消息）";
      return `## ${index + 1}. ${role}\n\n${text}${messageAttachmentsMarkdown(message)}`;
    });
    return [...meta, ...body].join("\n");
  }

  async function copyCurrentConversationMarkdown() {
    if (!state.currentMessages?.length) {
      showToast("当前没有可复制的对话。", "warn");
      return;
    }
    if (await copyToClipboard(conversationMarkdown())) {
      showToast("当前对话 Markdown 已复制。", "success");
      notifyTerminal("[info] 已复制当前对话 Markdown。\n");
      return;
    }
    showToast("复制当前对话失败，请稍后重试。", "warn");
  }

  function clearMessageRefreshTimer(narratorId) {
    const timer = state.messageRefreshTimersByNarrator?.[narratorId];
    if (!timer) return;
    window.clearTimeout(timer);
    const next = { ...(state.messageRefreshTimersByNarrator || {}) };
    delete next[narratorId];
    state.messageRefreshTimersByNarrator = next;
  }

  function scheduleMessageRefresh(delay = 0, narratorId = state.narrator?.id) {
    if (!narratorId) return;
    clearMessageRefreshTimer(narratorId);
    const timer = window.setTimeout(() => {
      clearMessageRefreshTimer(narratorId);
      loadMessages(narratorId).catch((err) => notifyTerminal(`[warn] 消息刷新失败：${err.message || err}\n`));
    }, Math.max(0, delay));
    state.messageRefreshTimersByNarrator = { ...(state.messageRefreshTimersByNarrator || {}), [narratorId]: timer };
  }

  function friendlyMessageText(text) {
    const value = String(text || "");
    if (value.includes("OpenAI official provider is not configured")) {
      return "当前 OpenAI 模型尚未配置 API Key。请在启动 CodeHarbor 前设置 `OPENAI_API_KEY`，然后重启服务；或在下方模型菜单选择已配置的模型。";
    }
    if (value.includes("Anthropic provider is not configured")) {
      return "当前 Anthropic 模型尚未配置 API Key。请在启动 CodeHarbor 前设置 `ANTHROPIC_API_KEY`，然后重启服务；或在下方模型菜单选择已配置的模型。";
    }
    if (value.includes("OpenAI-compatible provider is not configured")) {
      return "当前 OpenAI-compatible 模型尚未配置 API Key。请设置 `OPENAI_COMPATIBLE_API_KEY` 或 `OPENAI_API_KEY`，并确认 Base URL 后重启服务。";
    }
    if (value.includes("cliproxyapi provider request failed") && value.includes("127.0.0.1:8317")) {
      return "无法连接本地 CLIProxyAPI。请先启动 CLIProxyAPI，并确认它监听 `http://127.0.0.1:8317/v1`；如果你改过端口，请设置 `CLIPROXYAPI_BASE_URL` 后重启 CodeHarbor。";
    }
    if (value.includes("cliproxyapi model request failed: 401")) {
      return "CLIProxyAPI 返回 401。请确认 CLIProxyAPI 的 `api-keys` 配置；如启用了客户端鉴权，请在启动 CodeHarbor 前设置 `CLIPROXYAPI_API_KEY`。";
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
      blocks.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span><button class="copy-code" type="button" data-code="${escapeAttr(code)}">复制</button></div><pre><code>${highlightCode(code, lang)}</code></pre></div>`);
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
    root.querySelectorAll("[data-copy-message]").forEach((button) => {
      button.addEventListener("click", async () => {
        const index = Number(button.dataset.copyMessage || -1);
        const text = state.messageCopyTexts[index] || "";
        const original = button.textContent;
        if (text && await copyToClipboard(text)) {
          button.textContent = "已复制";
          showToast("消息原文已复制。", "success");
          notifyTerminal("[info] 已复制消息原文。\n");
        } else {
          button.textContent = "复制失败";
          showToast("复制消息失败，请手动选择文本复制。", "warn");
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
        button.textContent = ok ? "已复制" : "复制失败";
        if (!ok) showToast("复制代码失败，请手动选择文本复制。", "warn");
        setTimeout(() => { button.textContent = original; }, 1200);
      });
    });
  }

  return {
    appendToolOutput,
    clearCurrentNarratorApprovals,
    clearMessageRefreshTimer,
    clearRunSummary,
    clearToolApproval,
    copyCurrentConversationMarkdown,
    finishToolOutput,
    loadLatestRunSummary,
    loadMessages,
    loadRunSummary,
    rememberToolApproval,
    rememberToolStarted,
    scheduleMessageRefresh,
    updateConversationCopyButton,
  };
}
