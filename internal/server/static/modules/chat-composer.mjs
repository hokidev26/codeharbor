import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatBytes, formatNumber } from "./formatters.mjs";
import { chatDraftsKey, promptHistoryKey } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";
import { mergeSlashCommands, slashCommandInsertion } from "./skills-commands.mjs";

export const maxChatDraftCharacters = 8000;

export function interfaceLocale(documentRef = globalThis.document, navigatorRef = globalThis.navigator) {
  return documentRef?.documentElement?.lang || navigatorRef?.language || "zh-CN";
}

export function unicodeCharacters(value = "") {
  return Array.from(String(value || ""));
}

export function truncateChatDraft(value = "", max = maxChatDraftCharacters) {
  const characters = unicodeCharacters(value);
  return {
    text: characters.slice(0, Math.max(0, max)).join(""),
    length: characters.length,
    truncated: characters.length > max,
  };
}

export function mentionTrigger(value = "", cursor = String(value || "").length) {
  const text = String(value || "").slice(0, Math.max(0, cursor));
  const match = text.match(/(?:^|\s)@([^\s@]{0,64})$/u);
  if (!match) return null;
  const query = match[1] || "";
  return { query, start: text.length - query.length - 1, end: text.length };
}

export function clipboardFiles(event) {
  const files = Array.from(event?.clipboardData?.files || []).filter(Boolean);
  if (files.length) return files;
  return Array.from(event?.clipboardData?.items || [])
    .filter((item) => item?.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

export function normalizeChatDrafts(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source).reduce((acc, [key, draft]) => {
    const id = String(key || "").trim().slice(0, 120);
    const { text } = truncateChatDraft(draft);
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

  function serverDraftState(agentId = state.agent?.id) {
    if (!state.serverDrafts || typeof state.serverDrafts !== "object") state.serverDrafts = {};
    if (!agentId) return null;
    if (!state.serverDrafts[agentId]) state.serverDrafts[agentId] = { enabled: false, version: 0, seq: 0, timer: null };
    return state.serverDrafts[agentId];
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
    const { text } = truncateChatDraft(value);
    if (text.trim()) drafts[id] = text;
    else delete drafts[id];
    writeChatDrafts(drafts);
  }

  async function persistServerDraft(agentId, value) {
    const draftState = serverDraftState(agentId);
    if (!draftState?.enabled) return;
    const result = await api(`/api/agents/${agentId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ text: truncateChatDraft(value).text, version: draftState.version }),
    });
    if (state.agent?.id === agentId) draftState.version = Number(result?.version || draftState.version + 1);
  }

  function scheduleServerDraftSave(agentId, value) {
    const draftState = serverDraftState(agentId);
    if (!draftState?.enabled) return;
    window.clearTimeout(draftState.timer);
    draftState.timer = window.setTimeout(() => {
      persistServerDraft(agentId, value).catch(async (error) => {
        if (error?.status === 409) {
          try {
            const latest = await api(`/api/agents/${agentId}/draft`);
            draftState.version = Number(latest?.version || 0);
            await persistServerDraft(agentId, value);
            return;
          } catch (retryError) {
            error = retryError;
          }
        }
        notifyTerminal?.(`[warn] 私有草稿保存失败：${error?.message || error}\n`);
      });
    }, 400);
  }

  function saveCurrentChatDraft() {
    const input = $("messageText");
    if (!input) return;
    const agentId = state.agent?.id;
    const draftState = serverDraftState(agentId);
    if (agentId && draftState?.enabled) {
      scheduleServerDraftSave(agentId, input.value);
      return;
    }
    saveChatDraftForKey(currentChatDraftKey(), input.value);
  }

  async function restoreCurrentChatDraft() {
    const agentId = state.agent?.id;
    if (agentId) {
      const draftState = serverDraftState(agentId);
      const seq = ++draftState.seq;
      try {
        const draft = await api(`/api/agents/${agentId}/draft`);
        if (state.agent?.id !== agentId || draftState.seq !== seq) return;
        draftState.enabled = true;
        draftState.version = Number(draft?.version || 0);
        saveChatDraftForKey(currentChatDraftKey(), "");
        setMessageInputValue(draft?.contentText || "", { saveDraft: false });
        return;
      } catch (error) {
        if (state.agent?.id !== agentId || draftState.seq !== seq) return;
        if (error?.status === 404) {
          draftState.enabled = true;
          draftState.version = 0;
          saveChatDraftForKey(currentChatDraftKey(), "");
          setMessageInputValue("", { saveDraft: false });
          return;
        }
        if (error?.status !== 401) notifyTerminal?.(`[warn] 私有草稿读取失败，已回退到浏览器草稿：${error?.message || error}\n`);
      }
    }
    const draft = currentChatDrafts()[currentChatDraftKey()] || "";
    setMessageInputValue(draft, { saveDraft: false });
  }

  function clearChatDraftForKey(key) {
    const agentId = state.agent?.id;
    const draftState = serverDraftState(agentId);
    if (agentId && draftState?.enabled) {
      window.clearTimeout(draftState.timer);
      draftState.version = 0;
      api(`/api/agents/${agentId}/draft`, { method: "DELETE" }).catch(() => {});
      return;
    }
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

  function updateDraftLimitHint() {
    const input = $("messageText");
    const hint = $("chatDraftLimitHint");
    if (!input || !hint) return;
    const length = unicodeCharacters(input.value).length;
    const locale = interfaceLocale();
    const over = Math.max(0, length - maxChatDraftCharacters);
    hint.classList.toggle("warn", over > 0);
    hint.textContent = over > 0
      ? `已超出 ${formatNumber(over, locale)} 个字符；草稿只保存前 ${formatNumber(maxChatDraftCharacters, locale)} 个字符。`
      : `${formatNumber(length, locale)} / ${formatNumber(maxChatDraftCharacters, locale)} 个字符`;
  }

  function autoResizeMessageInput() {
    const input = $("messageText");
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    updatePromptHistoryHint();
    updateDraftLimitHint();
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

  function handleMessagePaste(event) {
    const files = clipboardFiles(event);
    if (!files.length) return false;
    addPendingAttachmentFiles(files);
    // Keep the browser's normal text paste and undo stack intact when the
    // clipboard contains both text and files.
    return true;
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

  function hideMentionPalette() {
    state.mentionOpen = false;
    state.mentionUsers = [];
    state.mentionIndex = 0;
    const palette = $("mentionPalette");
    if (palette) {
      palette.classList.add("hidden");
      palette.innerHTML = "";
    }
  }

  function insertMention(user) {
    const input = $("messageText");
    const trigger = mentionTrigger(input?.value || "", input?.selectionStart || 0);
    if (!input || !trigger || !user?.handle) return false;
    input.setRangeText(`@${user.handle} `, trigger.start, trigger.end, "end");
    hideMentionPalette();
    handleMessageInput();
    input.focus();
    return true;
  }

  function renderMentionPalette() {
    const palette = $("mentionPalette");
    if (!palette) return;
    const users = Array.isArray(state.mentionUsers) ? state.mentionUsers : [];
    if (!state.mentionOpen || !users.length) {
      hideMentionPalette();
      return;
    }
    state.mentionIndex = Math.max(0, Math.min(Number(state.mentionIndex || 0), users.length - 1));
    palette.classList.remove("hidden");
    palette.innerHTML = users.map((user, index) => `
      <button class="slash-command-item ${index === state.mentionIndex ? "active" : ""}" type="button" data-mention-user="${escapeAttr(user.id || user.handle)}">
        <span class="slash-command-name">@${escapeHtml(user.handle || "")}</span>
        <span class="slash-command-desc">${escapeHtml(user.role || "user")}</span>
      </button>
    `).join("");
    palette.querySelectorAll("[data-mention-user]").forEach((button, index) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => insertMention(users[index]));
    });
  }

  async function updateMentionPalette() {
    if (state.mentionComposing) return;
    const input = $("messageText");
    const trigger = mentionTrigger(input?.value || "", input?.selectionStart || 0);
    if (!trigger) {
      hideMentionPalette();
      return;
    }
    const seq = Number(state.mentionSeq || 0) + 1;
    state.mentionSeq = seq;
    try {
      const users = await api(`/api/users?handlePrefix=${encodeURIComponent(trigger.query)}&limit=8`);
      if (seq !== state.mentionSeq) return;
      state.mentionUsers = Array.isArray(users) ? users : [];
      state.mentionOpen = state.mentionUsers.length > 0;
      state.mentionIndex = 0;
      renderMentionPalette();
    } catch (error) {
      if (seq === state.mentionSeq && error?.status === 401) hideMentionPalette();
    }
  }

  function handleMentionKeydown(event) {
    if (!state.mentionOpen || state.mentionComposing) return false;
    const users = Array.isArray(state.mentionUsers) ? state.mentionUsers : [];
    if (!users.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      state.mentionIndex = event.key === "ArrowDown"
        ? (state.mentionIndex + 1) % users.length
        : (state.mentionIndex - 1 + users.length) % users.length;
      renderMentionPalette();
      event.preventDefault();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (insertMention(users[state.mentionIndex])) event.preventDefault();
      return true;
    }
    if (event.key === "Escape") {
      hideMentionPalette();
      event.preventDefault();
      return true;
    }
    return false;
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
    updateMentionPalette();
    saveCurrentChatDraft();
  }

  function handleMessageKeydown(event) {
    if (handleMentionKeydown(event)) return;
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
    handleMessagePaste,
    hideMentionPalette,
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
    updateDraftLimitHint,
    updateMentionPalette,
    updatePromptHistoryHint,
    updateSlashCommandPalette,
  };
}
