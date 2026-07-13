import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { defaultTerminalPrefs, terminalPrefsKey } from "./preferences-data.mjs";
import { webSocketURL } from "./runtime.mjs";

export function createTerminalController({
  state,
  copyToClipboard,
  formatNumber,
  notifyTerminal,
  refreshActiveSettingsPanel,
  showError,
  showToast,
} = {}) {
  function loadTerminalPreferences() {
    try {
      return normalizeTerminalPreferences(JSON.parse(localStorage.getItem(terminalPrefsKey) || "{}"));
    } catch {
      return normalizeTerminalPreferences({});
    }
  }

  function normalizeTerminalPreferences(value = {}) {
    const maxLines = Number(value.maxLines || defaultTerminalPrefs.maxLines);
    return {
      clearOnReconnect: value.clearOnReconnect !== undefined ? Boolean(value.clearOnReconnect) : defaultTerminalPrefs.clearOnReconnect,
      focusOnConnect: value.focusOnConnect !== undefined ? Boolean(value.focusOnConnect) : defaultTerminalPrefs.focusOnConnect,
      maxLines: [1000, 3000, 5000, 10000].includes(maxLines) ? maxLines : defaultTerminalPrefs.maxLines,
    };
  }

  function currentTerminalPreferences() {
    if (!state.terminalPrefs) state.terminalPrefs = loadTerminalPreferences();
    return state.terminalPrefs;
  }

  function saveTerminalPreferences(next, { notify = false } = {}) {
    state.terminalPrefs = normalizeTerminalPreferences(next);
    try {
      localStorage.setItem(terminalPrefsKey, JSON.stringify(state.terminalPrefs));
    } catch {}
    trimTerminalOutput();
    if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
    if (notify) showToast("终端偏好已保存。", "success", { force: true });
  }

  function setTerminalPreference(field, value) {
    const prefs = { ...currentTerminalPreferences() };
    if (field === "maxLines") prefs.maxLines = Number(value || defaultTerminalPrefs.maxLines);
    else prefs[field] = value === true || value === "true";
    saveTerminalPreferences(prefs, { notify: true });
  }

  function terminalOutputText() {
    return $("terminalOutput")?.textContent || "";
  }

  function terminalOutputStats() {
    const text = terminalOutputText();
    return {
      chars: text.length,
      lines: text ? text.split("\n").length : 0,
    };
  }

  function clearTerminalOutput({ notify = true } = {}) {
    const output = $("terminalOutput");
    if (!output) return;
    output.textContent = "Terminal cleared.\n";
    if (notify) showToast("终端输出已清空。", "success");
    if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
  }

  async function copyTerminalOutput() {
    const text = terminalOutputText();
    if (!text.trim()) throw new Error("当前终端没有可复制内容");
    if (await copyToClipboard(text)) {
      showToast("终端输出已复制。", "success");
      notifyTerminal("[info] 已复制终端输出。\n");
      return;
    }
    showToast("复制终端输出失败，请手动选择文本复制。", "warn");
    notifyTerminal("[warn] 复制终端输出失败。\n");
  }

  function remoteTerminalLocked() {
    const security = state.runtimeSummary?.security || {};
    return Boolean(security.remoteAccessRequired && security.remoteTerminalAllowed === false);
  }

  function remoteTerminalLockedMessage() {
    return "远程收紧模式已禁用交互式终端；如确需远程 shell，请在可信边缘认证后显式设置 AUTOTO_REMOTE_TERMINAL=true。";
  }

  function focusTerminalPanel() {
    if (remoteTerminalLocked()) {
      showToast(remoteTerminalLockedMessage(), "warn", { force: true });
      appendTerminal(`[terminal] ${remoteTerminalLockedMessage()}\n`);
      return;
    }
    toggleTerminal(false);
    $("terminalOutput")?.focus();
    resizeTerminal();
  }

  function reconnectTerminalFromSettings() {
    if (!state.agent) {
      showToast("请先选择一个 AI 代理再连接终端。", "warn");
      return;
    }
    if (remoteTerminalLocked()) {
      showToast(remoteTerminalLockedMessage(), "warn", { force: true });
      appendTerminal(`[terminal] ${remoteTerminalLockedMessage()}\n`);
      setTerminalStatus("remote-locked");
      return;
    }
    connectTerminal();
  }

  function trimTerminalOutput() {
    const output = $("terminalOutput");
    if (!output) return;
    const maxLines = currentTerminalPreferences().maxLines;
    if (!maxLines || maxLines <= 0) return;
    const lines = output.textContent.split("\n");
    if (lines.length <= maxLines) return;
    output.textContent = lines.slice(lines.length - maxLines).join("\n");
  }

  function renderTerminalSettingsContent() {
    const prefs = currentTerminalPreferences();
    const stats = terminalOutputStats();
    const collapsed = $("appShell")?.classList.contains("terminal-collapsed") || false;
    const wsLabel = terminalConnectionLabel();
    const cwd = state.agent?.cwd || state.project?.gitPath || "未选择代理";
    const locked = remoteTerminalLocked();
    return `
      <div class="settings-live-page terminal-settings-page">
        <section class="settings-hero-card terminal-hero-card">
          <div>
            <div class="settings-hero-kicker">终端管理</div>
            <div class="settings-hero-title">${escapeHtml(wsLabel)} · ${escapeHtml(collapsed ? "面板已收起" : "面板已展开")}</div>
            <p>${escapeHtml(locked ? remoteTerminalLockedMessage() : "管理当前 AI 代理的交互式 PTY 终端，支持重连、清空、复制输出和控制本地输出保留策略。")}</p>
          </div>
          <div class="settings-action-row">
            <button id="terminalReconnectSettingsBtn" class="settings-action-btn primary" type="button" ${locked ? "disabled" : ""}>重连终端</button>
            <button id="terminalFocusSettingsBtn" class="settings-action-btn subtle" type="button" ${locked ? "disabled" : ""}>聚焦终端</button>
          </div>
        </section>
        <div class="settings-status-strip">
          <div><strong>${escapeHtml(wsLabel)}</strong><span>连接状态</span></div>
          <div><strong>${escapeHtml(locked ? "远程禁用" : "可用")}</strong><span>终端策略</span></div>
          <div><strong>${escapeHtml(formatNumber(stats.lines))}</strong><span>输出行数</span></div>
          <div><strong>${escapeHtml(formatNumber(stats.chars))}</strong><span>字符数</span></div>
        </div>
        <section class="settings-provider-section highlighted">
          <div class="settings-provider-section-head">
            <div>
              <div class="settings-provider-title">当前会话</div>
              <div class="settings-provider-meta path">${escapeHtml(cwd)}</div>
            </div>
            <span class="settings-status-pill ${state.agent ? "ok" : "warn"}">${escapeHtml(state.agent ? "已选择代理" : "未选择代理")}</span>
          </div>
          <div class="terminal-control-grid">
            <button class="terminal-control-card" type="button" data-terminal-action="reconnect" ${locked ? "disabled" : ""}>
              <span>重连</span><small>${escapeHtml(locked ? "远程收紧下默认关闭 PTY。" : "重新建立 `/ws/terminal` 连接。")}</small>
            </button>
            <button class="terminal-control-card" type="button" data-terminal-action="toggle" ${locked ? "disabled" : ""}>
              <span>${escapeHtml(collapsed ? "展开" : "收起")}</span><small>${escapeHtml(locked ? "终端面板已被远程策略锁定。" : "切换右侧终端面板显示状态。")}</small>
            </button>
            <button class="terminal-control-card" type="button" data-terminal-action="clear">
              <span>清空</span><small>清空当前浏览器中的终端输出。</small>
            </button>
            <button class="terminal-control-card" type="button" data-terminal-action="copy">
              <span>复制</span><small>复制当前终端输出到剪贴板。</small>
            </button>
          </div>
        </section>
        <section class="settings-provider-section">
          <div class="settings-provider-section-head">
            <div>
              <div class="settings-provider-title">本地终端偏好</div>
              <div class="settings-provider-meta">只保存在当前浏览器，不影响后端 PTY 会话和项目配置。</div>
            </div>
          </div>
          <div class="appearance-toggle-list">
            ${renderTerminalToggle("clearOnReconnect", "重连时清空输出", "保持当前默认行为；关闭后重连会追加状态提示并保留旧输出。", prefs.clearOnReconnect)}
            ${renderTerminalToggle("focusOnConnect", "连接后自动聚焦", "终端连接成功后自动聚焦输出区，方便直接输入命令。", prefs.focusOnConnect)}
          </div>
          <div class="terminal-retention-block">
            <div class="settings-provider-title small">输出保留行数</div>
            <div class="appearance-choice-grid terminal-retention-grid">
              ${[1000, 3000, 5000, 10000].map((value) => renderTerminalMaxLineChoice(value, prefs.maxLines)).join("")}
            </div>
          </div>
        </section>
        <section class="settings-provider-section">
          <div class="settings-provider-section-head">
            <div>
              <div class="settings-provider-title">快捷键提示</div>
              <div class="settings-provider-meta">终端输出区聚焦后会把按键直接发送到 PTY。</div>
            </div>
          </div>
          <div class="terminal-shortcut-grid">
            ${renderTerminalShortcut("Enter", "发送回车")}
            ${renderTerminalShortcut("Ctrl + C", "中断当前命令")}
            ${renderTerminalShortcut("Tab", "补全")}
            ${renderTerminalShortcut("方向键", "历史/光标移动")}
            ${renderTerminalShortcut("粘贴", "发送剪贴板文本")}
            ${renderTerminalShortcut("重连", "重新同步窗口大小")}
          </div>
        </section>
      </div>
    `;
  }

  function terminalConnectionLabel() {
    if (!state.terminalWS) return state.agent ? "未连接" : "未选择代理";
    if (state.terminalWS.readyState === WebSocket.OPEN) return "connected";
    if (state.terminalWS.readyState === WebSocket.CONNECTING) return "connecting";
    if (state.terminalWS.readyState === WebSocket.CLOSING) return "closing";
    return state.terminalStatus || "closed";
  }

  function renderTerminalToggle(field, title, description, checked) {
    return `
      <label class="appearance-toggle-row terminal-toggle-row">
        <span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(description)}</small>
        </span>
        <input type="checkbox" data-terminal-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
      </label>
    `;
  }

  function renderTerminalMaxLineChoice(value, current) {
    return `
      <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-terminal-max-lines="${escapeAttr(value)}">
        <span>${escapeHtml(formatNumber(value))}</span>
        <small>最多保留 ${escapeHtml(formatNumber(value))} 行终端输出。</small>
      </button>
    `;
  }

  function renderTerminalShortcut(keys, description) {
    return `<div class="terminal-shortcut-card"><strong>${escapeHtml(keys)}</strong><span>${escapeHtml(description)}</span></div>`;
  }

  function bindTerminalSettingsActions() {
    $("terminalReconnectSettingsBtn")?.addEventListener("click", reconnectTerminalFromSettings);
    $("terminalFocusSettingsBtn")?.addEventListener("click", focusTerminalPanel);
    document.querySelectorAll("[data-terminal-action]").forEach((node) => {
      node.addEventListener("click", () => handleTerminalSettingsAction(node.dataset.terminalAction).catch(showError));
    });
    document.querySelectorAll("[data-terminal-toggle]").forEach((node) => {
      node.addEventListener("change", () => setTerminalPreference(node.dataset.terminalToggle, node.checked));
    });
    document.querySelectorAll("[data-terminal-max-lines]").forEach((node) => {
      node.addEventListener("click", () => setTerminalPreference("maxLines", node.dataset.terminalMaxLines));
    });
  }

  async function handleTerminalSettingsAction(action) {
    if (action === "reconnect") reconnectTerminalFromSettings();
    if (action === "toggle") toggleTerminal(!$("appShell").classList.contains("terminal-collapsed"));
    if (action === "clear") clearTerminalOutput();
    if (action === "copy") await copyTerminalOutput();
    if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
  }

  function connectTerminal() {
    if (!state.agent) return;
    if (remoteTerminalLocked()) {
      if (state.terminalWS) state.terminalWS.close();
      appendTerminal(`[terminal] ${remoteTerminalLockedMessage()}\n`);
      setTerminalStatus("remote-locked");
      return;
    }
    if (state.terminalWS) state.terminalWS.close();
    const agentId = state.agent.id;
    const output = $("terminalOutput");
    if (currentTerminalPreferences().clearOnReconnect) output.textContent = "Connecting terminal...\n";
    else appendTerminal("\n[terminal] reconnecting...\n");
    setTerminalStatus("connecting");
    const socket = new WebSocket(webSocketURL(`/ws/terminal?agentId=${encodeURIComponent(agentId)}`));
    state.terminalWS = socket;
    const isCurrentSocket = () => state.terminalWS === socket && state.agent?.id === agentId;
    socket.onopen = () => {
      if (!isCurrentSocket()) return;
      setTerminalStatus("connected");
      resizeTerminal(socket);
      if (currentTerminalPreferences().focusOnConnect) output.focus();
    };
    socket.onclose = () => {
      if (!isCurrentSocket()) return;
      setTerminalStatus("closed");
    };
    socket.onerror = () => {
      if (!isCurrentSocket()) return;
      setTerminalStatus("error");
    };
    socket.onmessage = (message) => {
      if (!isCurrentSocket()) return;
      try {
        const event = JSON.parse(message.data);
        if (event.type === "output") appendTerminal(cleanTerminalOutput(event.data || ""));
        if (event.type === "error") appendTerminal(`\n[terminal error] ${event.data || "unknown error"}\n`);
      } catch {
        appendTerminal(message.data);
      }
    };
  }

  function setTerminalStatus(text) {
    state.terminalStatus = text;
    const status = $("terminalStatus");
    if (status) status.textContent = `terminal ${text}`;
    if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
  }

  function sendTerminalInput(data) {
    if (remoteTerminalLocked()) return;
    if (!state.agent || !state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
    state.terminalWS.send(JSON.stringify({ type: "input", data }));
  }

  function resizeTerminal(socket = state.terminalWS) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket !== state.terminalWS) return;
    const output = $("terminalOutput");
    const cols = Math.max(40, Math.floor(output.clientWidth / 8));
    const rows = Math.max(10, Math.floor(output.clientHeight / 18));
    socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  function handleTerminalKeydown(event) {
    if (!state.agent || remoteTerminalLocked()) return;
    const keyMap = {
      Enter: "\r",
      Backspace: "\x7f",
      Tab: "\t",
      Escape: "\x1b",
      ArrowUp: "\x1b[A",
      ArrowDown: "\x1b[B",
      ArrowRight: "\x1b[C",
      ArrowLeft: "\x1b[D",
      Delete: "\x1b[3~",
      Home: "\x1b[H",
      End: "\x1b[F",
      PageUp: "\x1b[5~",
      PageDown: "\x1b[6~",
    };
    if (event.ctrlKey && event.key.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      sendTerminalInput(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
      return;
    }
    if (keyMap[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      sendTerminalInput(keyMap[event.key]);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      sendTerminalInput(event.key);
    }
  }

  function appendTerminal(text) {
    const output = $("terminalOutput");
    output.textContent += text;
    trimTerminalOutput();
    output.scrollTop = output.scrollHeight;
    if (state.activeSettingsPanel === "terminals") refreshActiveSettingsPanel();
  }

  function cleanTerminalOutput(text) {
    return String(text || "")
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
  }

  function toggleTerminal(collapsed) {
    if (remoteTerminalLocked() && collapsed === false) {
      showToast(remoteTerminalLockedMessage(), "warn", { force: true });
      appendTerminal(`[terminal] ${remoteTerminalLockedMessage()}\n`);
      setTerminalStatus("remote-locked");
      return;
    }
    const shouldCollapse = collapsed ?? !$("appShell").classList.contains("terminal-collapsed");
    $("appShell").classList.toggle("terminal-collapsed", shouldCollapse);
    $("expandTerminalBtn").classList.toggle("hidden", !shouldCollapse);
    $("toggleTerminalBtn")?.classList.toggle("active", !shouldCollapse);
    if (shouldCollapse) document.body.classList.remove("mobile-terminal-open");
  }

  return {
    appendTerminal,
    bindTerminalSettingsActions,
    clearTerminalOutput,
    connectTerminal,
    copyTerminalOutput,
    currentTerminalPreferences,
    focusTerminalPanel,
    handleTerminalKeydown,
    loadTerminalPreferences,
    normalizeTerminalPreferences,
    reconnectTerminalFromSettings,
    renderTerminalSettingsContent,
    resizeTerminal,
    saveTerminalPreferences,
    sendTerminalInput,
    setTerminalPreference,
    setTerminalStatus,
    terminalConnectionLabel,
    terminalOutputStats,
    terminalOutputText,
    toggleTerminal,
    trimTerminalOutput,
  };
}
