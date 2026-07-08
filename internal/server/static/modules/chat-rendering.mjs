import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatBytes, formatTimestamp } from "./formatters.mjs";
import { api } from "./runtime.mjs";

export function createChatRenderingController({
  state,
  attachmentIcon,
  attachmentKind,
  copyToClipboard,
  notifyTerminal,
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
    const approvalCards = renderApprovalCardsHTML();
    if (!messages.length && !approvalCards) {
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
    `).join("")}${approvalCards}`;
    bindMessageActionButtons(el);
    bindApprovalButtons(el);
    bindCopyCodeButtons(el);
    el.scrollTop = el.scrollHeight;
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
    clearCurrentNarratorApprovals,
    clearMessageRefreshTimer,
    clearToolApproval,
    copyCurrentConversationMarkdown,
    loadMessages,
    rememberToolApproval,
    scheduleMessageRefresh,
    updateConversationCopyButton,
  };
}
