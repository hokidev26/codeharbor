import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatBytes } from "./formatters.mjs";
import { chatDraftsKey, promptHistoryKey } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";
import { mergeSlashCommands, slashCommandInsertion } from "./skills-commands.mjs";

export function normalizeChatDrafts(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source).reduce((acc, [key, draft]) => {
    const id = String(key || "").trim().slice(0, 120);
    const text = String(draft || "").slice(0, 8000);
    if (id && text.trim()) acc[id] = text;
    return acc;
  }, {});
}

export function normalizePromptHistory(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => item.slice(0, 4000))
    .slice(0, 30);
}

export function createChatComposerController({
  state,
  attachmentKind,
  currentSkillsPreferences,
  isComposingInput,
  isCurrentModelConfigured,
  loadMessages,
  notifyTerminal,
  openDirectoryChooser,
  scheduleMessageRefresh,
  showModelSetupNotice,
  showToast,
} = {}) {
  function loadChatDrafts() {
    try {
      return normalizeChatDrafts(JSON.parse(localStorage.getItem(chatDraftsKey) || "{}"));
    } catch {
      return {};
    }
  }

  function currentChatDrafts() {
    if (!state.chatDrafts || typeof state.chatDrafts !== "object") state.chatDrafts = loadChatDrafts();
    return state.chatDrafts;
  }

  function currentChatDraftKey() {
    return state.agent?.id || state.workline?.id || state.project?.id || "global";
  }

  function writeChatDrafts(drafts) {
    state.chatDrafts = normalizeChatDrafts(drafts);
    try {
      localStorage.setItem(chatDraftsKey, JSON.stringify(state.chatDrafts));
    } catch {}
  }

  function saveChatDraftForKey(key, value) {
    const id = String(key || "").trim();
    if (!id) return;
    const drafts = { ...currentChatDrafts() };
    const text = String(value || "").slice(0, 8000);
    if (text.trim()) drafts[id] = text;
    else delete drafts[id];
    writeChatDrafts(drafts);
  }

  function saveCurrentChatDraft() {
    const input = $("messageText");
    if (!input) return;
    saveChatDraftForKey(currentChatDraftKey(), input.value);
  }

  function restoreCurrentChatDraft() {
    const draft = currentChatDrafts()[currentChatDraftKey()] || "";
    setMessageInputValue(draft, { saveDraft: false });
  }

  function clearChatDraftForKey(key) {
    saveChatDraftForKey(key, "");
  }

  function loadPromptHistory() {
    try {
      return normalizePromptHistory(JSON.parse(localStorage.getItem(promptHistoryKey) || "[]"));
    } catch {
      return [];
    }
  }

  function currentPromptHistory() {
    if (!Array.isArray(state.promptHistory)) state.promptHistory = loadPromptHistory();
    return state.promptHistory;
  }

  function savePromptHistory(history) {
    state.promptHistory = normalizePromptHistory(history);
    state.promptHistoryIndex = -1;
    state.promptHistoryDraft = "";
    try {
      localStorage.setItem(promptHistoryKey, JSON.stringify(state.promptHistory));
    } catch {}
    updatePromptHistoryHint();
  }

  function rememberPromptHistory(text) {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    const next = [prompt, ...currentPromptHistory().filter((item) => item.toLowerCase() !== prompt.toLowerCase())];
    savePromptHistory(next);
  }

  function resetPromptHistoryNavigation() {
    state.promptHistoryIndex = -1;
    state.promptHistoryDraft = "";
  }

  function isMessageSendingFor(agentId = state.agent?.id) {
    return Boolean(agentId && state.messageSendingByAgent?.[agentId]);
  }

  function syncMessageComposerBusy() {
    const busy = isMessageSendingFor();
    const input = $("messageText");
    if (input) input.disabled = busy;
    const attachButton = $("attachFileBtn");
    if (attachButton) attachButton.disabled = busy;
    const attachInput = $("attachFileInput");
    if (attachInput) attachInput.disabled = busy;
    setButtonBusy($("sendMessageBtn"), busy, "发送中");
  }

  function setMessageSendingFor(agentId, sending) {
    if (!agentId) return;
    const next = { ...(state.messageSendingByAgent || {}) };
    if (sending) next[agentId] = true;
    else delete next[agentId];
    state.messageSendingByAgent = next;
    syncMessageComposerBusy();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.agent) {
      await openDirectoryChooser();
      return;
    }
    const agentId = state.agent.id;
    if (isMessageSendingFor(agentId)) return;
    const draftKey = currentChatDraftKey();
    const input = $("messageText");
    const text = input.value.trim();
    const attachments = [...(state.pendingAttachments || [])];
    if (!text && !attachments.length) return;
    if (!isCurrentModelConfigured()) {
      showModelSetupNotice();
      return;
    }
    setMessageSendingFor(agentId, true);
    input.value = "";
    autoResizeMessageInput();
    try {
      if (attachments.length) {
        const form = new FormData();
        form.append("text", text);
        attachments.forEach((item) => form.append("files", item.file, item.file?.name || "attachment"));
        await api(`/api/agents/${agentId}/messages`, {
          method: "POST",
          body: form,
        });
      } else {
        await api(`/api/agents/${agentId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      }
      if (text) rememberPromptHistory(text);
      clearChatDraftForKey(draftKey);
      if (attachments.length) clearPendingAttachments();
      await loadMessages(agentId);
      scheduleMessageRefresh(1200, agentId);
    } catch (err) {
      const stillCurrent = state.agent?.id === agentId;
      saveChatDraftForKey(draftKey, text);
      if (stillCurrent) {
        if (!input.value.trim()) input.value = text;
        autoResizeMessageInput();
        throw err;
      }
      notifyTerminal(`[warn] 原代理消息发送失败，草稿已保留：${err.message || err}\n`);
    } finally {
      setMessageSendingFor(agentId, false);
      if (state.agent?.id === agentId) input.focus();
    }
  }

  function autoResizeMessageInput() {
    const input = $("messageText");
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    updatePromptHistoryHint();
  }

  function openAttachmentPicker() {
    const input = $("attachFileInput");
    if (!input || input.disabled) return;
    input.value = "";
    input.click();
  }

  function attachmentId() {
    return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addPendingAttachmentFiles(files) {
    const pickedFiles = Array.from(files || []).filter(Boolean);
    if (!pickedFiles.length) return;
    const maxFileBytes = 10 * 1024 * 1024;
    const maxTotalBytes = 25 * 1024 * 1024;
    const currentTotal = state.pendingAttachments.reduce((sum, item) => sum + (item.file?.size || 0), 0);
    let nextTotal = currentTotal;
    const skipped = [];
    const added = [];
    for (const file of pickedFiles) {
      const name = file.name || "未命名文件";
      if (file.size > maxFileBytes) {
        skipped.push(`${name}（${formatBytes(file.size)}）`);
        continue;
      }
      if (nextTotal + file.size > maxTotalBytes) {
        skipped.push(`${name}（总大小超过 ${formatBytes(maxTotalBytes)}）`);
        continue;
      }
      nextTotal += file.size;
      const kind = attachmentKind(file);
      added.push({
        id: attachmentId(),
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
      });
    }
    if (added.length) {
      state.pendingAttachments = [...state.pendingAttachments, ...added];
      renderPendingAttachments();
      showToast(`已加入 ${added.length} 个待发送附件。`, "success", { force: true });
    }
    if (skipped.length) {
      const preview = skipped.slice(0, 3).join("、");
      showToast(`已跳过 ${skipped.length} 个文件：${preview}${skipped.length > 3 ? " 等" : ""}。`, "warn", { force: true });
    }
  }

  async function importAttachmentFiles(event) {
    const picker = event?.target;
    addPendingAttachmentFiles(picker?.files || []);
    if (picker) picker.value = "";
  }

  function removePendingAttachment(id) {
    const removed = state.pendingAttachments.find((item) => item.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
    renderPendingAttachments();
  }

  function clearPendingAttachments() {
    state.pendingAttachments.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.pendingAttachments = [];
    renderPendingAttachments();
  }

  function renderPendingAttachments() {
    const wrap = $("pendingAttachments");
    if (!wrap) return;
    const attachments = state.pendingAttachments || [];
    wrap.classList.toggle("hidden", attachments.length === 0);
    wrap.innerHTML = attachments.map((item) => pendingAttachmentCardHTML(item)).join("");
    wrap.querySelectorAll("[data-remove-attachment]").forEach((button) => {
      button.addEventListener("click", () => removePendingAttachment(button.dataset.removeAttachment));
    });
  }

  function pendingAttachmentCardHTML(item) {
    const file = item.file || {};
    const name = file.name || "未命名文件";
    if (item.kind === "image" && item.previewUrl) {
      return `
        <div class="pending-image-card" title="${escapeAttr(name)}">
          <img class="pending-image-thumb" src="${escapeAttr(item.previewUrl)}" alt="${escapeAttr(name)}" />
          <button class="pending-attachment-remove" type="button" title="移除附件" aria-label="移除附件" data-remove-attachment="${escapeAttr(item.id)}">×</button>
        </div>
      `;
    }
    const subtitle = formatBytes(file.size || 0);
    return `
      <div class="pending-file-chip" title="${escapeAttr(name)}">
        <span class="pending-file-icon">▯</span>
        <span class="pending-file-name">${escapeHtml(name)}</span>
        <span class="pending-file-size">${escapeHtml(subtitle)}</span>
        <button class="pending-attachment-remove" type="button" title="移除附件" aria-label="移除附件" data-remove-attachment="${escapeAttr(item.id)}">×</button>
      </div>
    `;
  }

  function setComposerDragging(active) {
    $("composerInputShell")?.classList.toggle("dragging", Boolean(active));
  }

  function eventHasFiles(event) {
    return Array.from(event?.dataTransfer?.types || []).includes("Files");
  }

  function handleAttachmentDragOver(event) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    setComposerDragging(true);
  }

  function handleAttachmentDragLeave(event) {
    const shell = $("composerInputShell");
    if (!shell || shell.contains(event.relatedTarget)) return;
    setComposerDragging(false);
  }

  function handleAttachmentDrop(event) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    setComposerDragging(false);
    addPendingAttachmentFiles(event.dataTransfer?.files || []);
  }

  function setMessageInputValue(value, { saveDraft = true } = {}) {
    const input = $("messageText");
    input.value = value;
    autoResizeMessageInput();
    updateSlashCommandPalette();
    if (saveDraft) saveCurrentChatDraft();
    window.setTimeout(() => {
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
    }, 0);
  }

  function updatePromptHistoryHint() {
    const hint = $("promptHistoryHint");
    if (!hint) return;
    const count = currentPromptHistory().length;
    const commandCount = enabledSlashCommands().length;
    const active = state.promptHistoryIndex >= 0;
    hint.textContent = active
      ? `历史 ${state.promptHistoryIndex + 1}/${count} · ↑ 更早，↓ 更新，Enter 发送，Esc 返回草稿。`
      : commandCount
        ? `输入 / 可使用 ${commandCount} 个技能命令（服务端优先）；空输入时 ↑/↓ 召回历史。`
        : count
          ? `空输入时 ↑ 查看上一条提示，↓ 返回草稿。本地已保存 ${count}/30 条。`
          : "输入框为空时 ↑/↓ 可召回最近提示。";
  }

  function enabledSlashCommands() {
    return mergeSlashCommands(state.serverSkills, currentSkillsPreferences().commands);
  }

  function slashCommandTrigger(value) {
    const text = String(value || "");
    const match = text.match(/^\s*(\/[^\s]*)$/);
    if (!match) return null;
    return {
      prefix: text.slice(0, match.index || 0),
      query: match[1].slice(1).toLowerCase(),
    };
  }

  function slashCommandMatches() {
    const input = $("messageText");
    const trigger = slashCommandTrigger(input?.value || "");
    if (!trigger) return [];
    const query = trigger.query;
    return enabledSlashCommands().filter((command) => {
      const haystack = `${command.name} ${command.description}`.toLowerCase();
      return !query || haystack.includes(query);
    }).slice(0, 8);
  }

  function slashCommandOptionId(command, index) {
    return `slash-command-option-${String(command?.id || index).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  function updateSlashCommandPalette() {
    const palette = $("slashCommandPalette");
    if (!palette) return;
    const input = $("messageText");
    const trigger = slashCommandTrigger(input?.value || "");
    const matches = trigger ? slashCommandMatches() : [];
    state.slashCommandOpen = Boolean(trigger && matches.length);
    state.slashCommandQuery = trigger?.query || "";
    if (!state.slashCommandOpen) {
      state.slashCommandIndex = 0;
      input?.setAttribute("aria-expanded", "false");
      input?.removeAttribute("aria-activedescendant");
      palette.classList.add("hidden");
      palette.innerHTML = "";
      return;
    }
    state.slashCommandIndex = Math.max(0, Math.min(state.slashCommandIndex, matches.length - 1));
    input?.setAttribute("aria-expanded", "true");
    input?.setAttribute("aria-activedescendant", slashCommandOptionId(matches[state.slashCommandIndex], state.slashCommandIndex));
    palette.classList.remove("hidden");
    palette.innerHTML = `
      <div class="slash-command-head">技能命令（服务端优先）</div>
      ${matches.map((command, index) => `
        <button id="${escapeAttr(slashCommandOptionId(command, index))}" class="slash-command-item ${index === state.slashCommandIndex ? "active" : ""}" type="button" role="option" aria-selected="${index === state.slashCommandIndex ? "true" : "false"}" data-slash-command="${escapeAttr(command.id)}">
          <span class="slash-command-name">${escapeHtml(command.name)}</span>
          <span class="slash-command-desc">${escapeHtml(command.description || command.prompt.slice(0, 120))}</span>
        </button>
      `).join("")}
    `;
    palette.querySelectorAll("[data-slash-command]").forEach((node) => {
      node.addEventListener("mousedown", (event) => event.preventDefault());
      node.addEventListener("click", () => applySlashCommand(node.dataset.slashCommand));
    });
  }

  function hideSlashCommandPalette() {
    state.slashCommandOpen = false;
    state.slashCommandIndex = 0;
    state.slashCommandQuery = "";
    const input = $("messageText");
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    const palette = $("slashCommandPalette");
    if (palette) {
      palette.classList.add("hidden");
      palette.innerHTML = "";
    }
  }

  function applySlashCommand(id) {
    const command = enabledSlashCommands().find((item) => item.id === id) || slashCommandMatches()[state.slashCommandIndex];
    if (!command) return false;
    const input = $("messageText");
    const value = input?.value || "";
    const insertion = slashCommandInsertion(command);
    const next = value.replace(/^\s*\/[^\s]*$/, insertion);
    setMessageInputValue(next);
    hideSlashCommandPalette();
    resetPromptHistoryNavigation();
    input?.focus();
    showToast(`已插入 ${command.name} 模板。`, "success");
    return true;
  }

  function handleSlashCommandKeydown(event) {
    if (!state.slashCommandOpen || isComposingInput(event)) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = slashCommandMatches().length;
      if (!count) return false;
      state.slashCommandIndex = event.key === "ArrowDown"
        ? (state.slashCommandIndex + 1) % count
        : (state.slashCommandIndex - 1 + count) % count;
      updateSlashCommandPalette();
      event.preventDefault();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const selected = slashCommandMatches()[state.slashCommandIndex];
      if (selected && applySlashCommand(selected.id)) {
        event.preventDefault();
        return true;
      }
    }
    if (event.key === "Escape") {
      hideSlashCommandPalette();
      event.preventDefault();
      return true;
    }
    return false;
  }

  function handlePromptHistoryNavigation(event) {
    if (isComposingInput(event) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "Escape") return false;
    const input = $("messageText");
    const history = currentPromptHistory();
    if (event.key === "Escape" && state.promptHistoryIndex >= 0) {
      setMessageInputValue(state.promptHistoryDraft || "");
      resetPromptHistoryNavigation();
      updatePromptHistoryHint();
      event.preventDefault();
      return true;
    }
    if (!history.length || (input.value.trim() && state.promptHistoryIndex < 0)) return false;
    if (event.key === "ArrowUp") {
      if (state.promptHistoryIndex < 0) state.promptHistoryDraft = input.value;
      state.promptHistoryIndex = Math.min(history.length - 1, state.promptHistoryIndex + 1);
      setMessageInputValue(history[state.promptHistoryIndex] || "");
      event.preventDefault();
      return true;
    }
    if (event.key === "ArrowDown" && state.promptHistoryIndex >= 0) {
      state.promptHistoryIndex -= 1;
      setMessageInputValue(state.promptHistoryIndex >= 0 ? history[state.promptHistoryIndex] : state.promptHistoryDraft || "");
      if (state.promptHistoryIndex < 0) resetPromptHistoryNavigation();
      updatePromptHistoryHint();
      event.preventDefault();
      return true;
    }
    return false;
  }

  function handleMessageInput() {
    resetPromptHistoryNavigation();
    autoResizeMessageInput();
    updateSlashCommandPalette();
    saveCurrentChatDraft();
  }

  function handleMessageKeydown(event) {
    if (handleSlashCommandKeydown(event)) return;
    if (handlePromptHistoryNavigation(event)) return;
    if (isComposingInput(event) || event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    $("messageForm").requestSubmit();
  }

  return {
    autoResizeMessageInput,
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleMessageInput,
    handleMessageKeydown,
    hideSlashCommandPalette,
    importAttachmentFiles,
    loadChatDrafts,
    loadPromptHistory,
    openAttachmentPicker,
    restoreCurrentChatDraft,
    saveCurrentChatDraft,
    sendMessage,
    setMessageInputValue,
    syncMessageComposerBusy,
    updatePromptHistoryHint,
    updateSlashCommandPalette,
  };
}
