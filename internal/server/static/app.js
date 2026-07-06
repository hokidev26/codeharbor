const state = {
  projects: [],
  project: null,
  chapter: null,
  narrator: null,
  settings: null,
  backends: [],
  backendHealth: null,
  directoryPath: "",
  projectQuery: "",
  ws: null,
  terminalWS: null,
};

const recentDirectoriesKey = "codeharbor.recentDirectories";

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

function setHealth(ok, text) {
  const badge = $("healthBadge");
  badge.textContent = text;
  badge.classList.toggle("ok", ok);
  badge.classList.toggle("err", !ok);
}

async function loadHealth() {
  try {
    const health = await api("/api/health");
    setHealth(true, `healthy ${health.version}`);
  } catch {
    setHealth(false, "offline");
  }
}

async function loadBackends({ checkHealth = true } = {}) {
  state.backends = await api("/api/backends");
  renderBackendPanel();
  renderBackendsList();
  if (checkHealth) await refreshActiveBackendHealth();
}

function activeBackend() {
  return state.backends.find((backend) => backend.active) || state.backends[0] || null;
}

function renderBackendPanel() {
  const backend = activeBackend();
  $("activeBackendName").textContent = backend ? `${backend.name} · ${backend.baseUrl}` : "未配置后端";
  if (!backend) setBackendHealthBadge(false, "未配置");
}

function setBackendHealthBadge(ok, text) {
  const badge = $("backendHealthBadge");
  badge.textContent = text;
  badge.classList.toggle("ok", ok);
  badge.classList.toggle("err", !ok);
}

async function refreshActiveBackendHealth() {
  const backend = activeBackend();
  if (!backend) return;
  setBackendHealthBadge(false, "checking");
  try {
    const health = await api(`/api/backends/${backend.id}/health`);
    state.backendHealth = health;
    setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
    renderBackendsList();
  } catch (err) {
    state.backendHealth = { backendId: backend.id, ok: false, status: "error", error: err.message };
    setBackendHealthBadge(false, "error");
    renderBackendsList();
  }
}

function openBackendsModal() {
  $("backendsModal").classList.remove("hidden");
  renderBackendsList();
}

function closeBackendsModal() {
  $("backendsModal").classList.add("hidden");
}

function resetBackendForm() {
  $("backendName").value = "";
  $("backendKind").value = "local";
  $("backendBaseUrl").value = "";
  $("backendApiKey").value = "";
}

function renderBackendsList() {
  const el = $("backendsList");
  if (!el) return;
  if (!state.backends.length) {
    el.innerHTML = `<div class="empty-list">还没有后端。添加一个 OpenHands Agent Server URL 后即可检测连通性。</div>`;
    return;
  }
  el.innerHTML = state.backends.map((backend) => {
    const health = state.backendHealth?.backendId === backend.id ? state.backendHealth : null;
    const healthText = health ? (health.status || (health.ok ? "online" : "offline")) : "未检测";
    return `
      <div class="backend-card ${backend.active ? "active" : ""}">
        <div class="backend-card-main">
          <div class="backend-card-title">${escapeHtml(backend.name)} ${backend.active ? "<span class='mini-tag'>active</span>" : ""}</div>
          <div class="backend-card-url">${escapeHtml(backend.baseUrl)}</div>
          <div class="backend-card-meta">${escapeHtml(backend.kind)} · ${backend.apiKeyConfigured ? "API key 已配置" : "无 API key"} · ${escapeHtml(healthText)}</div>
        </div>
        <div class="backend-card-actions">
          <button class="ghost-btn mini" type="button" data-backend-test="${escapeAttr(backend.id)}">检测</button>
          ${backend.active ? "" : `<button class="ghost-btn mini" type="button" data-backend-activate="${escapeAttr(backend.id)}">设为当前</button>`}
          <button class="ghost-btn mini danger" type="button" data-backend-delete="${escapeAttr(backend.id)}">删除</button>
        </div>
      </div>
    `;
  }).join("");
  el.querySelectorAll("[data-backend-test]").forEach((node) => {
    node.addEventListener("click", () => testBackend(node.dataset.backendTest).catch(showError));
  });
  el.querySelectorAll("[data-backend-activate]").forEach((node) => {
    node.addEventListener("click", () => activateBackend(node.dataset.backendActivate).catch(showError));
  });
  el.querySelectorAll("[data-backend-delete]").forEach((node) => {
    node.addEventListener("click", () => deleteBackend(node.dataset.backendDelete).catch(showError));
  });
}

async function saveBackend(event) {
  event.preventDefault();
  const payload = {
    name: $("backendName").value.trim(),
    kind: $("backendKind").value,
    baseUrl: $("backendBaseUrl").value.trim(),
    apiKey: $("backendApiKey").value.trim(),
    active: state.backends.length === 0,
  };
  if (!payload.baseUrl) throw new Error("请填写后端 URL");
  await api("/api/backends", { method: "POST", body: JSON.stringify(payload) });
  resetBackendForm();
  await loadBackends();
}

async function activateBackend(id) {
  await api(`/api/backends/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
  await loadBackends();
}

async function deleteBackend(id) {
  if (!confirm("删除这个后端？")) return;
  await api(`/api/backends/${id}`, { method: "DELETE" });
  await loadBackends();
}

async function testBackend(id) {
  const health = await api(`/api/backends/${id}/health`);
  state.backendHealth = health;
  if (activeBackend()?.id === id) setBackendHealthBadge(health.ok, health.status || (health.ok ? "online" : "offline"));
  renderBackendsList();
}

async function loadSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;
  renderModelOptions();
}

function renderModelOptions() {
  const select = $("modelSelect");
  const providers = state.settings?.providers || [];
  const values = providers.map((provider) => `${provider.name}:${provider.model}`);
  if (state.narrator?.model && !values.includes(state.narrator.model)) {
    values.unshift(state.narrator.model);
  }
  select.innerHTML = values.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("");
  if (state.narrator?.model) {
    select.value = state.narrator.model;
  }
}

async function loadProjects() {
  state.projects = await api("/api/projects");
  renderProjects();
}

function renderProjects() {
  const el = $("projects");
  const query = state.projectQuery.trim().toLowerCase();
  const projects = state.projects.filter((project) => {
    if (!query) return true;
    return `${project.name} ${project.gitPath || ""}`.toLowerCase().includes(query);
  });
  renderRecentSidebarDirectories();
  if (!state.projects.length) {
    el.innerHTML = `<button class="project-card" type="button" id="emptyProjectHint"><div class="project-name">选择一个目录开始</div><div class="project-path">点击上方 +</div></button>`;
    $("emptyProjectHint").addEventListener("click", () => openDirectoryModal().catch(showError));
    return;
  }
  if (!projects.length) {
    el.innerHTML = `<div class="empty-list">没有符合搜索的项目。</div>`;
    return;
  }
  el.innerHTML = projects.map((project) => `
    <button class="project-card ${state.project?.id === project.id ? "active" : ""}" type="button" data-project-id="${escapeAttr(project.id)}">
      <div class="project-name">${escapeHtml(project.name)}</div>
      <div class="project-path">${escapeHtml(project.gitPath || project.id)}</div>
    </button>
  `).join("");
  el.querySelectorAll("[data-project-id]").forEach((node) => {
    node.addEventListener("click", () => selectProject(node.dataset.projectId).catch(showError));
  });
}

async function createProjectFromDirectory(path) {
  const existing = state.projects.find((project) => project.gitPath === path);
  rememberDirectory(path);
  if (existing) {
    closeDirectoryModal();
    await selectProject(existing.id);
    return;
  }
  const name = basename(path) || "Project";
  const created = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, gitPath: path }),
  });
  closeDirectoryModal();
  await loadProjects();
  state.project = created.project;
  state.chapter = created.chapter;
  state.narrator = created.narrator;
  renderProjects();
  await enterNarrator();
  appendTerminal(`Created project: ${created.project.name}\nPath: ${created.project.gitPath}\n`);
}

async function selectProject(id) {
  closeMobileSidebar();
  state.project = state.projects.find((project) => project.id === id) || null;
  renderProjects();
  if (!state.project) return;
  const chapters = await api(`/api/projects/${id}/chapters`);
  state.chapter = chapters[0] || null;
  if (!state.chapter) return;
  const narrators = await api(`/api/chapters/${state.chapter.id}/narrators`);
  state.narrator = narrators.find((narrator) => narrator.type === "primary") || narrators[0] || null;
  await enterNarrator();
}

async function enterNarrator() {
  if (!state.narrator) return;
  $("currentTitle").textContent = state.project?.name || state.narrator.title;
  $("currentMeta").textContent = `${state.narrator.cwd || state.project?.gitPath || "No directory"} · ${state.narrator.permissionMode}`;
  $("permissionMode").value = state.narrator.permissionMode || "acceptEdits";
  renderModelOptions();
  connectWS();
  connectTerminal();
  await loadMessages();
}

async function loadMessages() {
  if (!state.narrator) return;
  const messages = await api(`/api/narrators/${state.narrator.id}/messages`);
  const el = $("messages");
  if (!messages.length) {
    el.classList.add("empty");
    el.textContent = "还没有消息。输入你的需求开始对话。";
    return;
  }
  el.classList.remove("empty");
  el.innerHTML = messages.map((message) => `
    <div class="message ${escapeAttr(message.role)}">
      <div class="message-role">${escapeHtml(message.role)}</div>
      <div class="message-content">${renderMarkdown(message.contentText || "")}</div>
    </div>
  `).join("");
  bindCopyCodeButtons(el);
  el.scrollTop = el.scrollHeight;
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.narrator) {
    await openDirectoryModal();
    return;
  }
  const text = $("messageText").value.trim();
  if (!text) return;
  $("messageText").value = "";
  autoResizeMessageInput();
  await api(`/api/narrators/${state.narrator.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  await loadMessages();
  setTimeout(() => loadMessages().catch(console.error), 1200);
}

function connectWS() {
  if (!state.narrator) return;
  if (state.ws) state.ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${proto}://${location.host}/ws/narrator?id=${state.narrator.id}`);
  state.ws.onopen = () => {
    $("wsBadge").textContent = "ws connected";
    $("wsBadge").classList.add("ok");
  };
  state.ws.onclose = () => {
    $("wsBadge").textContent = "ws closed";
    $("wsBadge").classList.remove("ok");
  };
  state.ws.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      appendTerminal(`[event] ${event.type}${event.text ? `: ${event.text}` : ""}\n`);
      if (event.type === "message.created" || event.type === "agent.done") {
        loadMessages().catch(console.error);
      }
    } catch {
      appendTerminal(`[event] ${message.data}\n`);
    }
  };
}

async function saveNarratorSettings() {
  if (!state.narrator) return;
  const id = state.narrator.id;
  const model = $("modelSelect").value.trim();
  const permissionMode = $("permissionMode").value;
  if (model && model !== state.narrator.model) {
    state.narrator = await api(`/api/narrators/${id}/model`, { method: "PATCH", body: JSON.stringify({ model }) });
  }
  if (permissionMode && permissionMode !== state.narrator.permissionMode) {
    state.narrator = await api(`/api/narrators/${id}/permission-mode`, { method: "PATCH", body: JSON.stringify({ permissionMode }) });
  }
  await enterNarrator();
  appendTerminal(`Saved settings: ${state.narrator.model}, ${state.narrator.permissionMode}\n`);
}

function connectTerminal() {
  if (!state.narrator) return;
  if (state.terminalWS) state.terminalWS.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const output = $("terminalOutput");
  output.textContent = "Connecting terminal...\n";
  setTerminalStatus("connecting");
  state.terminalWS = new WebSocket(`${proto}://${location.host}/ws/terminal?narratorId=${state.narrator.id}`);
  state.terminalWS.onopen = () => {
    setTerminalStatus("connected");
    resizeTerminal();
    output.focus();
  };
  state.terminalWS.onclose = () => setTerminalStatus("closed");
  state.terminalWS.onerror = () => setTerminalStatus("error");
  state.terminalWS.onmessage = (message) => {
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
  $("terminalStatus").textContent = `terminal ${text}`;
}

function sendTerminalInput(data) {
  if (!state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
  state.terminalWS.send(JSON.stringify({ type: "input", data }));
}

function resizeTerminal() {
  if (!state.terminalWS || state.terminalWS.readyState !== WebSocket.OPEN) return;
  const output = $("terminalOutput");
  const cols = Math.max(40, Math.floor(output.clientWidth / 8));
  const rows = Math.max(10, Math.floor(output.clientHeight / 18));
  state.terminalWS.send(JSON.stringify({ type: "resize", cols, rows }));
}

function handleTerminalKeydown(event) {
  if (!state.narrator) return;
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
    sendTerminalInput(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
    return;
  }
  if (keyMap[event.key]) {
    event.preventDefault();
    sendTerminalInput(keyMap[event.key]);
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
    event.preventDefault();
    sendTerminalInput(event.key);
  }
}

function appendTerminal(text) {
  const output = $("terminalOutput");
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

function cleanTerminalOutput(text) {
  return String(text || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

function toggleTerminal(collapsed) {
  const shouldCollapse = collapsed ?? !$("appShell").classList.contains("terminal-collapsed");
  $("appShell").classList.toggle("terminal-collapsed", shouldCollapse);
  $("expandTerminalBtn").classList.toggle("hidden", !shouldCollapse);
  if (shouldCollapse) document.body.classList.remove("mobile-terminal-open");
}

async function openDirectoryModal(path = "") {
  $("folderModal").classList.remove("hidden");
  renderRecentModalDirectories();
  await browseDirectories(path);
}

function closeDirectoryModal() {
  $("folderModal").classList.add("hidden");
}

async function browseDirectories(path = "") {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const data = await api(`/api/fs/directories${query}`);
  state.directoryPath = data.path;
  $("directoryPath").textContent = data.path;
  $("manualDirectoryPath").value = data.path;
  renderDirectoryShortcuts(data.shortcuts || []);
  renderDirectoryList(data);
}

function renderDirectoryShortcuts(shortcuts) {
  $("directoryShortcuts").innerHTML = shortcuts.map((shortcut) => `
    <button class="shortcut" type="button" data-path="${escapeAttr(shortcut.path)}">${escapeHtml(shortcut.name)}</button>
  `).join("");
  $("directoryShortcuts").querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
}

function getRecentDirectories() {
  try {
    return JSON.parse(localStorage.getItem(recentDirectoriesKey) || "[]").filter(Boolean);
  } catch {
    return [];
  }
}

function rememberDirectory(path) {
  const normalized = String(path || "").trim();
  if (!normalized) return;
  const next = [normalized, ...getRecentDirectories().filter((item) => item !== normalized)].slice(0, 8);
  localStorage.setItem(recentDirectoriesKey, JSON.stringify(next));
  renderRecentSidebarDirectories();
  renderRecentModalDirectories();
}

function renderRecentSidebarDirectories() {
  const el = $("recentSidebarDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((path) => `
    <button class="recent-item" type="button" data-path="${escapeAttr(path)}">
      <span>${escapeHtml(basename(path) || path)}</span>
      <small>${escapeHtml(path)}</small>
    </button>
  `).join("") : `<div class="empty-list">暂无最近目录</div>`;
  el.querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => createProjectFromDirectory(node.dataset.path).catch(showError));
  });
}

function renderRecentModalDirectories() {
  const el = $("recentModalDirectories");
  if (!el) return;
  const recent = getRecentDirectories();
  el.innerHTML = recent.length ? recent.map((path) => `
    <button class="shortcut" type="button" data-path="${escapeAttr(path)}">最近：${escapeHtml(basename(path) || path)}</button>
  `).join("") : "";
  el.querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
}

function renderDirectoryList(data) {
  const rows = [];
  if (data.parent) {
    rows.push(`
      <button class="directory-row" type="button" data-path="${escapeAttr(data.parent)}">
        <span>..</span><span class="directory-meta">上一级</span>
      </button>
    `);
  }
  rows.push(...(data.entries || []).map((entry) => `
    <button class="directory-row" type="button" data-path="${escapeAttr(entry.path)}">
      <span>${escapeHtml(entry.name)}</span><span class="directory-meta">目录</span>
    </button>
  `));
  $("directoryList").innerHTML = rows.join("") || `<div class="directory-meta">没有可进入的子目录。</div>`;
  $("directoryList").querySelectorAll("[data-path]").forEach((node) => {
    node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(showError));
  });
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
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code class=\"inline-code\">$1</code>");
}

function highlightCode(code, lang) {
  const tokens = [];
  const hold = (html) => {
    const key = `__TOK_${tokens.length}__`;
    tokens.push(html);
    return key;
  };
  let html = escapeHtml(code);
  html = html.replace(/("[^"\n]*"|'[^'\n]*')/g, (value) => hold(`<span class="tok-string">${value}</span>`));
  html = html.replace(/(\/\/.*|#.*)$/gm, (value) => hold(`<span class="tok-comment">${value}</span>`));
  const keywordSet = "const|let|var|function|return|if|else|for|while|switch|case|break|class|type|struct|func|package|import|from|export|async|await|try|catch|defer|go|select|range";
  html = html.replace(new RegExp(`\\b(${keywordSet})\\b`, "g"), '<span class="tok-keyword">$1</span>');
  return html.replace(/__TOK_(\d+)__/g, (_, index) => tokens[Number(index)] || "");
}

function bindCopyCodeButtons(root) {
  root.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.code || "");
      const original = button.textContent;
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = original; }, 1000);
    });
  });
}

function autoResizeMessageInput() {
  const input = $("messageText");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function handleMessageKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  $("messageForm").requestSubmit();
}

function openMobileSidebar() {
  document.body.classList.add("mobile-sidebar-open");
}

function closeMobileSidebar() {
  document.body.classList.remove("mobile-sidebar-open");
}

function toggleMobileTerminal() {
  document.body.classList.toggle("mobile-terminal-open");
  if (document.body.classList.contains("mobile-terminal-open")) {
    $("terminalOutput").focus();
    resizeTerminal();
  }
}

function focusMobileSearch() {
  openMobileSidebar();
  setTimeout(() => $("projectSearch").focus(), 160);
}

function basename(path) {
  return String(path || "").replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
}

function showError(err) {
  alert(err.message || String(err));
  appendTerminal(`[error] ${err.message || String(err)}\n`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }

$("refreshBtn").addEventListener("click", () => init().catch(showError));
$("manageBackendsBtn").addEventListener("click", openBackendsModal);
$("closeBackendsModalBtn").addEventListener("click", closeBackendsModal);
$("backendsModal").addEventListener("click", (event) => { if (event.target.id === "backendsModal") closeBackendsModal(); });
$("backendForm").addEventListener("submit", (event) => saveBackend(event).catch(showError));
$("resetBackendFormBtn").addEventListener("click", resetBackendForm);
$("mobileMenuBtn").addEventListener("click", openMobileSidebar);
$("mobileSidebarBackdrop").addEventListener("click", closeMobileSidebar);
$("mobileTerminalBtn").addEventListener("click", toggleMobileTerminal);
$("mobileSearchBtn").addEventListener("click", focusMobileSearch);
$("newProjectBtn").addEventListener("click", () => openDirectoryModal().catch(showError));
$("projectSearch").addEventListener("input", (event) => { state.projectQuery = event.target.value; renderProjects(); });
$("openFolderBtn").addEventListener("click", () => openDirectoryModal(state.narrator?.cwd || state.project?.gitPath || "").catch(showError));
$("closeFolderModalBtn").addEventListener("click", closeDirectoryModal);
$("folderModal").addEventListener("click", (event) => { if (event.target.id === "folderModal") closeDirectoryModal(); });
$("goDirectoryBtn").addEventListener("click", () => browseDirectories($("manualDirectoryPath").value.trim()).catch(showError));
$("chooseDirectoryBtn").addEventListener("click", () => createProjectFromDirectory(state.directoryPath).catch(showError));
$("messageForm").addEventListener("submit", (event) => sendMessage(event).catch(showError));
$("messageText").addEventListener("input", autoResizeMessageInput);
$("messageText").addEventListener("keydown", handleMessageKeydown);
$("terminalOutput").addEventListener("keydown", handleTerminalKeydown);
$("terminalOutput").addEventListener("click", () => $("terminalOutput").focus());
$("terminalOutput").addEventListener("paste", (event) => {
  event.preventDefault();
  sendTerminalInput(event.clipboardData?.getData("text") || "");
});
$("reconnectTerminalBtn").addEventListener("click", connectTerminal);
window.addEventListener("resize", resizeTerminal);
$("saveNarratorBtn").addEventListener("click", () => saveNarratorSettings().catch(showError));
$("modelSelect").addEventListener("change", () => saveNarratorSettings().catch(showError));
$("permissionMode").addEventListener("change", () => saveNarratorSettings().catch(showError));
$("toggleTerminalBtn").addEventListener("click", () => toggleTerminal());
$("collapseTerminalBtn").addEventListener("click", () => toggleTerminal(true));
$("expandTerminalBtn").addEventListener("click", () => toggleTerminal(false));

async function init() {
  autoResizeMessageInput();
  renderRecentSidebarDirectories();
  await loadHealth();
  await Promise.all([loadSettings(), loadProjects(), loadBackends()]);
  if (!state.narrator && state.projects.length) {
    await selectProject(state.projects[0].id);
  }
}

init().catch(showError);
