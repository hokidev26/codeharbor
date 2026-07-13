import { $, escapeAttr, escapeHtml } from "./dom.mjs";

export const PREVIEW_IFRAME_SANDBOX = "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-scripts";
const PREVIEW_LOG_LINE_LIMIT = 400;
const PREVIEW_LOG_CHAR_LIMIT = 50000;

export function workspaceParentPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function buildWorkspaceSavePayload(path, content, expectedModTime) {
  return {
    path: String(path || ""),
    content: String(content ?? ""),
    expectedModTime: expectedModTime ?? null,
  };
}

export function renderWorkspaceEntriesHTML(entries, selectedPath = "") {
  const sorted = [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
    const directoryOrder = Number(Boolean(b?.isDir)) - Number(Boolean(a?.isDir));
    return directoryOrder || String(a?.name || "").localeCompare(String(b?.name || ""));
  });
  if (!sorted.length) return '<div class="workspace-empty-state">此目录为空。</div>';
  return sorted.map((entry) => {
    const path = String(entry?.path || "");
    const name = String(entry?.name || path || "未命名");
    const isDir = Boolean(entry?.isDir);
    const editable = entry?.editable !== false;
    const size = Number.isFinite(Number(entry?.size)) ? Number(entry.size) : 0;
    const meta = isDir ? "目录" : `${formatBytes(size)}${editable ? "" : " · 只读"}`;
    return `
      <button class="workspace-entry ${path === selectedPath ? "active" : ""}" type="button" data-workspace-path="${escapeAttr(path)}" data-workspace-dir="${isDir ? "true" : "false"}" title="${escapeAttr(path || name)}">
        <span class="workspace-entry-icon" aria-hidden="true">${isDir ? "▱" : "◇"}</span>
        <span class="workspace-entry-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta)}</small></span>
        <span class="workspace-entry-arrow" aria-hidden="true">${isDir ? "›" : ""}</span>
      </button>
    `;
  }).join("");
}

export function renderPreviewProfileOptionsHTML(profiles, selectedId = "") {
  const list = Array.isArray(profiles) ? profiles : [];
  if (!list.length) return '<option value="">未检测到预览配置</option>';
  return list.map((profile) => {
    const id = previewProfileId(profile);
    const label = previewProfileLabel(profile);
    return `<option value="${escapeAttr(id)}" ${id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

export function renderPreviewFrameHTML(url) {
  const safeURL = String(url || "");
  if (!safeURL) return '<div class="workspace-preview-empty">启动预览后会在此处显示页面。</div>';
  return `<iframe class="workspace-preview-iframe" src="${escapeAttr(safeURL)}" sandbox="${escapeAttr(PREVIEW_IFRAME_SANDBOX)}" referrerpolicy="no-referrer" title="项目预览"></iframe>`;
}

export function buildPreviewURL(status, locationLike = globalThis.location) {
  const source = status || {};
  let candidate = String(source.url || source.previewUrl || source.externalUrl || source.baseUrl || "").trim();
  const port = Number(source.port || source.previewPort || 0);
  if (!candidate && port > 0 && port <= 65535) {
    const protocol = locationLike?.protocol === "https:" ? "https:" : "http:";
    const hostname = String(locationLike?.hostname || "127.0.0.1");
    candidate = `${protocol}//${hostname}:${port}/`;
  }
  if (!candidate) return "";
  try {
    const base = locationLike?.origin || "http://127.0.0.1";
    const parsed = new URL(candidate, base);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    if (locationLike?.origin && parsed.origin === locationLike.origin) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function boundPreviewLogs(payload) {
  let text = "";
  if (typeof payload === "string") text = payload;
  else if (Array.isArray(payload)) text = payload.map(previewLogLine).join("\n");
  else if (Array.isArray(payload?.logs)) text = payload.logs.map(previewLogLine).join("\n");
  else if (Array.isArray(payload?.lines)) text = payload.lines.map(previewLogLine).join("\n");
  else if (typeof payload?.logs === "string") text = payload.logs;
  else if (typeof payload?.content === "string") text = payload.content;
  const lines = String(text || "").split(/\r?\n/).slice(-PREVIEW_LOG_LINE_LIMIT);
  return lines.join("\n").slice(-PREVIEW_LOG_CHAR_LIMIT);
}

export function createWorkspaceExplorerController({
  state = {},
  request,
  getElementById = $,
  locationLike = globalThis.location,
  openWindow = (...args) => globalThis.window?.open?.(...args),
  setTimeoutFn = (...args) => globalThis.setTimeout(...args),
  clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
  showError = () => {},
  showToast = () => {},
  pollIntervalMs = 2000,
} = {}) {
  initializeWorkspaceState(state);

  const element = (id) => getElementById?.(id) || null;
  const currentAgentId = () => String(state.workspaceAgentId || "");
  const liveAgentId = () => String(state.agent?.id || "");

  function isCurrent(seqKey, seq, agentId) {
    return state[seqKey] === seq && currentAgentId() === agentId;
  }

  function invalidateRequests() {
    state.workspaceTreeSeq += 1;
    state.workspaceFileSeq += 1;
    state.workspaceSaveSeq += 1;
    state.workspacePreviewSeq += 1;
  }

  function stopPreviewPolling() {
    if (state.workspacePreviewTimer) clearTimeoutFn(state.workspacePreviewTimer);
    state.workspacePreviewTimer = null;
  }

  function schedulePreviewPolling() {
    stopPreviewPolling();
    if (!state.workspaceOpen || state.workspaceTab !== "preview" || !currentAgentId()) return;
    state.workspacePreviewTimer = setTimeoutFn(() => {
      state.workspacePreviewTimer = null;
      refreshPreview({ polling: true }).catch(() => {});
    }, pollIntervalMs);
    state.workspacePreviewTimer?.unref?.();
  }

  function resetWorkspaceView() {
    state.workspaceTab = "files";
    state.workspacePath = "";
    state.workspaceEntries = [];
    state.workspaceTreeLoading = false;
    state.workspaceTreeError = "";
    state.workspaceFile = null;
    state.workspaceFilePath = "";
    state.workspaceFileContent = "";
    state.workspaceOriginalContent = "";
    state.workspaceFileLoading = false;
    state.workspaceSaving = false;
    state.workspaceFileStatus = "请选择左侧文件。";
    state.workspaceProfiles = [];
    state.workspaceSelectedProfileId = "";
    state.workspacePreviewStatus = null;
    state.workspacePreviewLogs = "";
    state.workspacePreviewLoading = false;
    state.workspacePreviewBusy = false;
    state.workspacePreviewError = "";
  }

  function setAgent(agent) {
    const nextId = String(agent?.id || "");
    if (nextId === currentAgentId()) {
      renderWorkspaceButtonState();
      return false;
    }
    invalidateRequests();
    stopPreviewPolling();
    state.workspaceOpen = false;
    element("workspaceModal")?.classList.add("hidden");
    state.workspaceAgentId = nextId;
    resetWorkspaceView();
    renderWorkspaceButtonState();
    renderWorkspace();
    return true;
  }

  function renderWorkspaceButtonState() {
    const button = element("workspaceExplorerBtn");
    if (!button) return;
    const enabled = Boolean(liveAgentId());
    button.disabled = !enabled;
    button.classList.toggle("active", enabled && state.workspaceOpen);
    button.setAttribute("aria-expanded", enabled && state.workspaceOpen ? "true" : "false");
    button.title = enabled ? "打开工作区文件和预览" : "请先选择 Agent";
  }

  function openWorkspace() {
    if (!liveAgentId()) return false;
    if (currentAgentId() !== liveAgentId()) setAgent(state.agent);
    state.workspaceOpen = true;
    element("workspaceModal")?.classList.remove("hidden");
    renderWorkspaceButtonState();
    renderWorkspace();
    loadTree(state.workspacePath || "").catch(showError);
    return true;
  }

  function closeWorkspace() {
    state.workspaceOpen = false;
    invalidateRequests();
    stopPreviewPolling();
    state.workspaceTreeLoading = false;
    state.workspaceFileLoading = false;
    state.workspaceSaving = false;
    state.workspacePreviewLoading = false;
    state.workspacePreviewBusy = false;
    element("workspaceModal")?.classList.add("hidden");
    renderWorkspaceButtonState();
  }

  async function loadTree(path = "") {
    const agentId = currentAgentId();
    if (!agentId) return null;
    const requestedPath = normalizeRelativePath(path);
    const seq = ++state.workspaceTreeSeq;
    state.workspaceTreeLoading = true;
    state.workspaceTreeError = "";
    renderTree();
    try {
      const query = new URLSearchParams({ path: requestedPath });
      const payload = await request(`/api/agents/${encodeURIComponent(agentId)}/workspace/tree?${query.toString()}`);
      if (!isCurrent("workspaceTreeSeq", seq, agentId)) return null;
      state.workspacePath = normalizeRelativePath(payload?.path ?? requestedPath);
      state.workspaceEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      state.workspaceTreeError = "";
      return payload;
    } catch (error) {
      if (!isCurrent("workspaceTreeSeq", seq, agentId)) return null;
      state.workspaceEntries = [];
      state.workspaceTreeError = error?.message || String(error);
      throw error;
    } finally {
      if (isCurrent("workspaceTreeSeq", seq, agentId)) {
        state.workspaceTreeLoading = false;
        renderTree();
      }
    }
  }

  async function loadFile(path) {
    const agentId = currentAgentId();
    const requestedPath = normalizeRelativePath(path);
    if (!agentId || !requestedPath) return null;
    const seq = ++state.workspaceFileSeq;
    state.workspaceFileLoading = true;
    state.workspaceFileStatus = "正在加载文件…";
    renderEditor();
    try {
      const query = new URLSearchParams({ path: requestedPath });
      const payload = await request(`/api/agents/${encodeURIComponent(agentId)}/workspace/file?${query.toString()}`);
      if (!isCurrent("workspaceFileSeq", seq, agentId)) return null;
      state.workspaceFile = { ...payload, path: normalizeRelativePath(payload?.path ?? requestedPath) };
      state.workspaceFilePath = state.workspaceFile.path;
      state.workspaceFileContent = String(payload?.content ?? "");
      state.workspaceOriginalContent = state.workspaceFileContent;
      state.workspaceFileStatus = workspaceFileStatusText(state.workspaceFile);
      renderTree();
      return payload;
    } catch (error) {
      if (!isCurrent("workspaceFileSeq", seq, agentId)) return null;
      state.workspaceFile = null;
      state.workspaceFilePath = requestedPath;
      state.workspaceFileContent = "";
      state.workspaceOriginalContent = "";
      state.workspaceFileStatus = `加载失败：${error?.message || String(error)}`;
      throw error;
    } finally {
      if (isCurrent("workspaceFileSeq", seq, agentId)) {
        state.workspaceFileLoading = false;
        renderEditor();
      }
    }
  }

  async function saveFile() {
    const agentId = currentAgentId();
    const file = state.workspaceFile;
    const editor = element("workspaceEditor");
    if (editor) state.workspaceFileContent = String(editor.value ?? "");
    if (!agentId || !file?.path) return false;
    if (file.readOnly || file.truncated) {
      state.workspaceFileStatus = file.truncated ? "文件内容已截断，不能保存。" : "此文件为只读，不能保存。";
      renderEditorControls();
      showToast(state.workspaceFileStatus, "warn", { force: true });
      return false;
    }
    const seq = ++state.workspaceSaveSeq;
    const path = normalizeRelativePath(file.path);
    const payload = buildWorkspaceSavePayload(path, state.workspaceFileContent, file.modTime);
    state.workspaceSaving = true;
    state.workspaceFileStatus = "正在保存…";
    renderEditorControls();
    try {
      const result = await request(`/api/agents/${encodeURIComponent(agentId)}/workspace/file?${new URLSearchParams({ path }).toString()}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (!isCurrent("workspaceSaveSeq", seq, agentId)) return false;
      state.workspaceFile = { ...file, ...result, path, content: state.workspaceFileContent };
      state.workspaceOriginalContent = state.workspaceFileContent;
      state.workspaceFileStatus = "已保存。";
      showToast("文件已保存。", "success", { force: true });
      return true;
    } catch (error) {
      if (!isCurrent("workspaceSaveSeq", seq, agentId)) return false;
      if (Number(error?.status) === 409) {
        state.workspaceFileStatus = "文件已在磁盘上变更，请重新加载后再保存。";
        showToast(state.workspaceFileStatus, "error", { force: true });
        return false;
      }
      state.workspaceFileStatus = `保存失败：${error?.message || String(error)}`;
      throw error;
    } finally {
      if (isCurrent("workspaceSaveSeq", seq, agentId)) {
        state.workspaceSaving = false;
        renderEditorControls();
      }
    }
  }

  function selectTab(tab) {
    const next = tab === "preview" ? "preview" : "files";
    if (state.workspaceTab === next) return;
    state.workspaceTab = next;
    state.workspacePreviewSeq += 1;
    stopPreviewPolling();
    renderWorkspace();
    if (next === "preview") loadPreview().catch(showError);
  }

  async function loadPreview() {
    const agentId = currentAgentId();
    if (!agentId) return null;
    const seq = ++state.workspacePreviewSeq;
    state.workspacePreviewLoading = true;
    state.workspacePreviewError = "";
    renderPreview();
    try {
      const base = `/api/agents/${encodeURIComponent(agentId)}/preview`;
      const detected = await request(`${base}/detect`);
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return null;
      state.workspaceProfiles = Array.isArray(detected?.profiles) ? detected.profiles : [];
      const availableIds = state.workspaceProfiles.map(previewProfileId);
      if (!availableIds.includes(state.workspaceSelectedProfileId)) state.workspaceSelectedProfileId = availableIds[0] || "";
      const [status, logs] = await Promise.all([request(`${base}/status`), request(`${base}/logs`)]);
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return null;
      applyPreviewPayload(status, logs);
      return { detected, status, logs };
    } catch (error) {
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return null;
      state.workspacePreviewError = error?.message || String(error);
      throw error;
    } finally {
      if (isCurrent("workspacePreviewSeq", seq, agentId)) {
        state.workspacePreviewLoading = false;
        renderPreview();
        schedulePreviewPolling();
      }
    }
  }

  async function refreshPreview({ polling = false } = {}) {
    const agentId = currentAgentId();
    if (!agentId || !state.workspaceOpen || state.workspaceTab !== "preview") return null;
    const seq = ++state.workspacePreviewSeq;
    if (!polling) state.workspacePreviewLoading = true;
    try {
      const base = `/api/agents/${encodeURIComponent(agentId)}/preview`;
      const [status, logs] = await Promise.all([request(`${base}/status`), request(`${base}/logs`)]);
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return null;
      applyPreviewPayload(status, logs);
      state.workspacePreviewError = "";
      return { status, logs };
    } catch (error) {
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return null;
      state.workspacePreviewError = error?.message || String(error);
      if (!polling) throw error;
      return null;
    } finally {
      if (isCurrent("workspacePreviewSeq", seq, agentId)) {
        state.workspacePreviewLoading = false;
        renderPreview();
        schedulePreviewPolling();
      }
    }
  }

  async function startPreview() {
    const agentId = currentAgentId();
    const profileId = String(element("workspacePreviewProfile")?.value || state.workspaceSelectedProfileId || "");
    if (!agentId || !profileId || state.workspacePreviewBusy) return false;
    const port = parsePreviewPort(element("workspacePreviewPort")?.value);
    const seq = ++state.workspacePreviewSeq;
    state.workspacePreviewBusy = true;
    state.workspacePreviewError = "";
    renderPreview();
    try {
      const body = { profileId };
      if (port) body.port = port;
      const status = await request(`/api/agents/${encodeURIComponent(agentId)}/preview/start`, { method: "POST", body: JSON.stringify(body) });
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return false;
      state.workspacePreviewStatus = status || {};
      showToast("预览已启动。", "success", { force: true });
      await refreshPreview();
      return true;
    } catch (error) {
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return false;
      state.workspacePreviewError = error?.message || String(error);
      throw error;
    } finally {
      if (currentAgentId() === agentId) {
        state.workspacePreviewBusy = false;
        renderPreview();
      }
    }
  }

  async function stopPreview() {
    const agentId = currentAgentId();
    if (!agentId || state.workspacePreviewBusy) return false;
    const seq = ++state.workspacePreviewSeq;
    state.workspacePreviewBusy = true;
    state.workspacePreviewError = "";
    renderPreview();
    try {
      const status = await request(`/api/agents/${encodeURIComponent(agentId)}/preview/stop`, { method: "POST" });
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return false;
      state.workspacePreviewStatus = status || { running: false };
      showToast("预览已停止。", "success", { force: true });
      await refreshPreview();
      return true;
    } catch (error) {
      if (!isCurrent("workspacePreviewSeq", seq, agentId)) return false;
      state.workspacePreviewError = error?.message || String(error);
      throw error;
    } finally {
      if (currentAgentId() === agentId) {
        state.workspacePreviewBusy = false;
        renderPreview();
      }
    }
  }

  function applyPreviewPayload(status, logs) {
    state.workspacePreviewStatus = status || {};
    state.workspacePreviewLogs = boundPreviewLogs(logs);
    const statusProfileId = String(status?.profileId || "");
    if (statusProfileId) state.workspaceSelectedProfileId = statusProfileId;
  }

  function openPreviewExternal() {
    const url = buildPreviewURL(state.workspacePreviewStatus, locationLike);
    if (!url) {
      showToast("预览地址不可用，或与 Autoto 页面同源。", "warn", { force: true });
      return false;
    }
    openWindow(url, "_blank", "noopener,noreferrer");
    return true;
  }

  function renderWorkspace() {
    const filesPanel = element("workspaceFilesPanel");
    const previewPanel = element("workspacePreviewPanel");
    filesPanel?.classList.toggle("hidden", state.workspaceTab !== "files");
    previewPanel?.classList.toggle("hidden", state.workspaceTab !== "preview");
    ["files", "preview"].forEach((tab) => {
      const button = element(tab === "files" ? "workspaceFilesTab" : "workspacePreviewTab");
      const active = state.workspaceTab === tab;
      button?.classList.toggle("active", active);
      button?.setAttribute("aria-selected", active ? "true" : "false");
    });
    const subtitle = element("workspaceModalSubtitle");
    if (subtitle) subtitle.textContent = state.agent?.cwd || state.project?.gitPath || "当前 Agent 工作目录";
    renderTree();
    renderEditor();
    renderPreview();
  }

  function renderTree() {
    const path = element("workspaceTreePath");
    if (path) path.textContent = state.workspacePath || "/";
    const parent = element("workspaceParentBtn");
    if (parent) parent.disabled = !state.workspacePath || state.workspaceTreeLoading;
    const refresh = element("workspaceRefreshTreeBtn");
    if (refresh) refresh.disabled = state.workspaceTreeLoading;
    const tree = element("workspaceTree");
    if (!tree) return;
    if (state.workspaceTreeLoading) tree.innerHTML = '<div class="workspace-loading-state">正在加载目录…</div>';
    else if (state.workspaceTreeError) tree.innerHTML = `<div class="workspace-error-state">${escapeHtml(state.workspaceTreeError)}</div>`;
    else tree.innerHTML = renderWorkspaceEntriesHTML(state.workspaceEntries, state.workspaceFilePath);
  }

  function renderEditor() {
    const editor = element("workspaceEditor");
    if (editor && editor.value !== state.workspaceFileContent) editor.value = state.workspaceFileContent;
    renderEditorControls();
  }

  function renderEditorControls() {
    const file = state.workspaceFile;
    const editor = element("workspaceEditor");
    const readOnly = !file || Boolean(file.readOnly || file.truncated || state.workspaceFileLoading);
    if (editor) {
      editor.readOnly = readOnly;
      editor.disabled = state.workspaceFileLoading;
      editor.placeholder = state.workspaceFileLoading ? "正在加载…" : "从左侧选择可编辑文本文件";
    }
    const path = element("workspaceEditorPath");
    if (path) path.textContent = state.workspaceFilePath || "未选择文件";
    const status = element("workspaceEditorStatus");
    if (status) {
      status.textContent = state.workspaceFileStatus || "";
      status.classList.toggle("error", /失败|不能保存|磁盘上变更/.test(state.workspaceFileStatus || ""));
    }
    const reload = element("workspaceReloadFileBtn");
    if (reload) reload.disabled = !file?.path || state.workspaceFileLoading || state.workspaceSaving;
    const save = element("workspaceSaveFileBtn");
    if (save) save.disabled = !file?.path || readOnly || state.workspaceSaving || state.workspaceFileContent === state.workspaceOriginalContent;
  }

  function renderPreview() {
    const profile = element("workspacePreviewProfile");
    if (profile) {
      profile.innerHTML = renderPreviewProfileOptionsHTML(state.workspaceProfiles, state.workspaceSelectedProfileId);
      profile.value = state.workspaceSelectedProfileId || "";
      profile.disabled = state.workspacePreviewLoading || state.workspacePreviewBusy || !state.workspaceProfiles.length;
    }
    const status = state.workspacePreviewStatus || {};
    const running = previewRunning(status);
    const statusNode = element("workspacePreviewStatus");
    if (statusNode) {
      statusNode.textContent = previewStatusText(status, state.workspacePreviewLoading);
      statusNode.classList.toggle("running", running);
    }
    const errorNode = element("workspacePreviewError");
    if (errorNode) {
      errorNode.textContent = state.workspacePreviewError || "";
      errorNode.classList.toggle("hidden", !state.workspacePreviewError);
    }
    const detect = element("workspaceDetectPreviewBtn");
    if (detect) detect.disabled = state.workspacePreviewLoading || state.workspacePreviewBusy;
    const start = element("workspaceStartPreviewBtn");
    if (start) start.disabled = state.workspacePreviewBusy || state.workspacePreviewLoading || running || !state.workspaceSelectedProfileId;
    const stop = element("workspaceStopPreviewBtn");
    if (stop) stop.disabled = state.workspacePreviewBusy || !running;
    const url = buildPreviewURL(status, locationLike);
    const external = element("workspaceOpenPreviewBtn");
    if (external) external.disabled = !url;
    const frameHost = element("workspacePreviewFrameHost");
    if (frameHost && String(frameHost.dataset?.previewUrl || "") !== url) {
      frameHost.innerHTML = renderPreviewFrameHTML(url);
      if (frameHost.dataset) frameHost.dataset.previewUrl = url;
    }
    const logs = element("workspacePreviewLogs");
    if (logs) logs.textContent = state.workspacePreviewLogs || "暂无预览日志。";
  }

  function bind() {
    element("workspaceExplorerBtn")?.addEventListener("click", openWorkspace);
    element("closeWorkspaceModalBtn")?.addEventListener("click", closeWorkspace);
    element("workspaceModal")?.addEventListener("click", (event) => {
      if (event.target?.id === "workspaceModal") closeWorkspace();
    });
    element("workspaceFilesTab")?.addEventListener("click", () => selectTab("files"));
    element("workspacePreviewTab")?.addEventListener("click", () => selectTab("preview"));
    element("workspaceParentBtn")?.addEventListener("click", () => loadTree(workspaceParentPath(state.workspacePath)).catch(showError));
    element("workspaceRefreshTreeBtn")?.addEventListener("click", () => loadTree(state.workspacePath).catch(showError));
    element("workspaceTree")?.addEventListener("click", (event) => {
      const target = event.target?.closest?.("[data-workspace-path]");
      if (!target) return;
      const path = target.dataset.workspacePath || "";
      if (target.dataset.workspaceDir === "true") loadTree(path).catch(showError);
      else loadFile(path).catch(showError);
    });
    element("workspaceEditor")?.addEventListener("input", (event) => {
      state.workspaceFileContent = String(event.target?.value ?? "");
      state.workspaceFileStatus = state.workspaceFileContent === state.workspaceOriginalContent ? workspaceFileStatusText(state.workspaceFile) : "有未保存的修改。";
      renderEditorControls();
    });
    element("workspaceSaveFileBtn")?.addEventListener("click", () => saveFile().catch(showError));
    element("workspaceReloadFileBtn")?.addEventListener("click", () => loadFile(state.workspaceFilePath).catch(showError));
    element("workspacePreviewProfile")?.addEventListener("change", (event) => {
      state.workspaceSelectedProfileId = String(event.target?.value || "");
      renderPreview();
    });
    element("workspaceDetectPreviewBtn")?.addEventListener("click", () => loadPreview().catch(showError));
    element("workspaceStartPreviewBtn")?.addEventListener("click", () => startPreview().catch(showError));
    element("workspaceStopPreviewBtn")?.addEventListener("click", () => stopPreview().catch(showError));
    element("workspaceOpenPreviewBtn")?.addEventListener("click", openPreviewExternal);
    globalThis.document?.addEventListener?.("keydown", (event) => {
      if (event.key === "Escape" && state.workspaceOpen) {
        closeWorkspace();
        event.preventDefault();
      }
    });
    setAgent(state.agent);
    renderWorkspaceButtonState();
  }

  return {
    bind,
    closeWorkspace,
    loadFile,
    loadPreview,
    loadTree,
    openPreviewExternal,
    openWorkspace,
    refreshPreview,
    renderWorkspace,
    renderWorkspaceButtonState,
    saveFile,
    selectTab,
    setAgent,
    startPreview,
    stopPreview,
  };
}

function initializeWorkspaceState(state) {
  const defaults = {
    workspaceAgentId: "",
    workspaceOpen: false,
    workspaceTab: "files",
    workspacePath: "",
    workspaceEntries: [],
    workspaceTreeLoading: false,
    workspaceTreeError: "",
    workspaceFile: null,
    workspaceFilePath: "",
    workspaceFileContent: "",
    workspaceOriginalContent: "",
    workspaceFileLoading: false,
    workspaceSaving: false,
    workspaceFileStatus: "请选择左侧文件。",
    workspaceProfiles: [],
    workspaceSelectedProfileId: "",
    workspacePreviewStatus: null,
    workspacePreviewLogs: "",
    workspacePreviewLoading: false,
    workspacePreviewBusy: false,
    workspacePreviewError: "",
    workspacePreviewTimer: null,
    workspaceTreeSeq: 0,
    workspaceFileSeq: 0,
    workspaceSaveSeq: 0,
    workspacePreviewSeq: 0,
  };
  Object.entries(defaults).forEach(([key, value]) => {
    if (state[key] === undefined) state[key] = value;
  });
}

function normalizeRelativePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function formatBytes(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function workspaceFileStatusText(file) {
  if (!file) return "请选择左侧文件。";
  if (file.truncated) return "文件内容已截断，仅供查看，不能保存。";
  if (file.readOnly) return "只读文件，不能保存。";
  return "已加载，可编辑。";
}

function previewProfileId(profile) {
  return String(profile?.id || profile?.profileId || profile?.name || "");
}

function previewProfileLabel(profile) {
  const id = previewProfileId(profile);
  return String(profile?.label || profile?.title || profile?.name || id || "未命名配置");
}

function previewRunning(status) {
  const value = String(status?.status || status?.state || "").toLowerCase();
  return status?.running === true || ["running", "started", "ready"].includes(value);
}

function previewStatusText(status, loading) {
  if (loading && !status) return "正在检测预览配置…";
  if (!status || !Object.keys(status).length) return "预览未启动";
  if (previewRunning(status)) {
    const port = status.port || status.previewPort;
    return port ? `运行中 · 端口 ${port}` : "运行中";
  }
  return String(status.message || status.status || status.state || "预览未启动");
}

function parsePreviewPort(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const port = Number(text);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function previewLogLine(line) {
  if (typeof line === "string") return line;
  if (line && typeof line === "object") return String(line.text || line.message || line.line || JSON.stringify(line));
  return String(line ?? "");
}
