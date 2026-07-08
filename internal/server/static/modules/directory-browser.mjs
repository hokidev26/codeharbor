import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { recentDirectoriesKey } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";

export function normalizeRecentDirectories(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function canonicalLocalPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (value.startsWith("/")) return value;
  if (/^Users\//.test(value)) return `/${value}`;
  return value;
}

export function shortPath(path) {
  const value = canonicalLocalPath(path);
  if (!value) return "未设置目录";
  const home = "/Users/aaa";
  if (value === home) return "~";
  if (value.startsWith(home + "/")) return `~/${value.slice(home.length + 1)}`;
  return value;
}

export function projectPathLabel(path) {
  const value = canonicalLocalPath(path);
  return value || "未设置路径";
}

export function normalizePath(path) {
  return canonicalLocalPath(path).replace(/\/+$/, "") || "/";
}

export function basename(path) {
  return String(path || "").replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
}

export function createDirectoryBrowserController({
  state,
  createProjectFromDirectory,
  elementVisible,
  notifyTerminal,
  showError,
  showToast,
} = {}) {
  function directoryElementVisible(id) {
    return typeof elementVisible === "function" ? elementVisible(id) : Boolean($(id) && !$(id).classList.contains("hidden"));
  }

  function reportError(err) {
    if (typeof showError === "function") showError(err);
  }

  async function openDirectoryChooser(path = "", { trigger = null, preferNative = true } = {}) {
    const defaultPath = String(path || "").trim();
    if (preferNative) {
      try {
        const picked = await selectNativeDirectory(defaultPath, { trigger });
        if (picked?.canceled) return;
        if (picked?.path) {
          await createProjectFromDirectory(picked.path, { button: trigger });
          return;
        }
      } catch (err) {
        notifyTerminal?.(`[warn] 原生资料夹选择器不可用：${err.message || err}\n`);
        showToast?.("原生选择器不可用，已切换到内置目录浏览器。", "warn", { force: true });
      }
    }
    await openDirectoryModal(defaultPath);
  }

  async function selectNativeDirectory(path = "", { trigger = null } = {}) {
    if (state.nativeDirectorySelecting) return { canceled: true };
    state.nativeDirectorySelecting = true;
    const label = trigger?.textContent || "";
    setButtonBusy(trigger, true, "…");
    showToast?.("正在打开 macOS 资料夹选择器…", "info", { force: true });
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const data = await api(`/api/fs/native-directory${query}`, { method: "POST", body: JSON.stringify({}) });
      if (data.canceled) {
        showToast?.("已取消选择资料夹。", "info", { force: true });
        return { canceled: true };
      }
      if (data.path) {
        showToast?.(`已选择：${shortPath(data.path)}`, "success", { force: true });
        return data;
      }
      return { canceled: true };
    } finally {
      state.nativeDirectorySelecting = false;
      setButtonBusy(trigger, false, label || "…");
    }
  }

  async function openDirectoryModal(path = "") {
    $("folderModal").classList.remove("hidden");
    hideNewFolderInline();
    renderRecentModalDirectories();
    setDirectoryStatus("正在载入目录…", "busy");
    await browseDirectories(path);
  }

  function closeDirectoryModal() {
    state.directoryBrowseSeq++;
    setDirectoryBrowserBusy(false);
    hideNewFolderInline();
    setDirectoryStatus("选择当前目录后会创建或打开项目。", "");
    $("folderModal").classList.add("hidden");
  }

  function setDirectoryBrowserBusy(busy) {
    ["folderModal", "directoryList", "manualDirectoryPath", "goDirectoryBtn"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (busy) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    });
  }

  function setDirectoryStatus(message, variant = "") {
    const el = $("directoryStatus");
    if (!el) return;
    el.textContent = message || "选择当前目录后会创建或打开项目。";
    el.classList.toggle("busy", variant === "busy");
    el.classList.toggle("error", variant === "error");
    el.classList.toggle("success", variant === "success");
  }

  function updateDirectoryPathDisplay(path) {
    const value = String(path || "").trim();
    const name = basename(value) || value || "选择目录";
    if ($("directoryPath")) $("directoryPath").textContent = value || "Loading...";
    if ($("manualDirectoryPath")) $("manualDirectoryPath").value = value;
    if ($("folderLocationName")) $("folderLocationName").textContent = name;
    if ($("folderLocationPill")) $("folderLocationPill").title = value || "当前路径";
  }

  async function browseDirectories(path = "") {
    hideNewFolderInline();
    const seq = ++state.directoryBrowseSeq;
    setDirectoryBrowserBusy(true);
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const data = await api(`/api/fs/directories${query}`);
      if (seq !== state.directoryBrowseSeq || !directoryElementVisible("folderModal")) return;
      state.directoryPath = data.path;
      state.directoryParent = data.parent || "";
      state.directoryShortcuts = data.shortcuts || [];
      updateDirectoryPathDisplay(data.path);
      setDirectoryStatus("选择当前目录后会创建或打开项目。", "");
      renderDirectoryShortcuts(state.directoryShortcuts);
      renderDirectoryList(data);
    } catch (err) {
      if (seq === state.directoryBrowseSeq && directoryElementVisible("folderModal")) {
        setDirectoryStatus(`载入失败：${err.message || err}`, "error");
        throw err;
      }
    } finally {
      if (seq === state.directoryBrowseSeq) setDirectoryBrowserBusy(false);
    }
  }

  function renderDirectoryShortcuts(shortcuts) {
    const iconByName = {
      Home: "⌂",
      Desktop: "▣",
      Downloads: "▾",
      Documents: "□",
      Projects: "▱",
      Root: "⌜",
    };
    $("directoryShortcuts").innerHTML = shortcuts.map((shortcut) => {
      const active = normalizePath(shortcut.path) === normalizePath(state.directoryPath);
      const label = shortcutLabel(shortcut.name);
      return `
      <button class="folder-shortcut ${active ? "active" : ""}" type="button" data-path="${escapeAttr(shortcut.path)}">
        <span class="folder-shortcut-icon">${escapeHtml(iconByName[shortcut.name] || "▱")}</span>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
    }).join("");
    $("directoryShortcuts").querySelectorAll("[data-path]").forEach((node) => {
      node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(reportError));
    });
  }

  function shortcutLabel(name) {
    return {
      Home: "主目录",
      Desktop: "桌面",
      Downloads: "下载",
      Documents: "文档",
      Projects: "项目",
      Root: "根目录",
    }[name] || name;
  }

  function getRecentDirectories() {
    try {
      return normalizeRecentDirectories(JSON.parse(localStorage.getItem(recentDirectoriesKey) || "[]"));
    } catch {
      return [];
    }
  }

  function rememberDirectory(path) {
    const normalized = canonicalLocalPath(path);
    if (!normalized) return;
    const next = [normalized, ...getRecentDirectories().filter((item) => normalizePath(item) !== normalizePath(normalized))].slice(0, 8);
    localStorage.setItem(recentDirectoriesKey, JSON.stringify(next));
    renderRecentSidebarDirectories();
    renderRecentModalDirectories();
  }

  function renderRecentSidebarDirectories() {
    const el = $("recentSidebarDirectories");
    if (!el) return;
    const recent = getRecentDirectories();
    el.innerHTML = recent.length ? recent.map((rawPath) => {
      const path = canonicalLocalPath(rawPath);
      return `
      <button class="recent-item" type="button" data-path="${escapeAttr(path)}">
        <span>${escapeHtml(basename(path) || path)}</span>
        <small>${escapeHtml(projectPathLabel(path))}</small>
      </button>
    `;
    }).join("") : `<div class="empty-list">暂无最近目录</div>`;
    el.querySelectorAll("[data-path]").forEach((node) => {
      node.addEventListener("click", () => createProjectFromDirectory(node.dataset.path).catch(reportError));
    });
  }

  function renderRecentModalDirectories() {
    const el = $("recentModalDirectories");
    if (!el) return;
    const recent = getRecentDirectories();
    el.innerHTML = recent.length ? recent.map((rawPath) => {
      const path = canonicalLocalPath(rawPath);
      return `
      <button class="folder-shortcut" type="button" data-path="${escapeAttr(path)}" title="${escapeAttr(path)}">
        <span class="folder-shortcut-icon">☆</span>
        <span>${escapeHtml(basename(path) || path)}</span>
      </button>
    `;
    }).join("") : `<div class="folder-empty-note">暂无收藏</div>`;
    el.querySelectorAll("[data-path]").forEach((node) => {
      node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(reportError));
    });
  }

  function renderDirectoryList(data) {
    const rows = [];
    if (data.parent) {
      rows.push(`
      <button class="directory-row parent-row" type="button" data-path="${escapeAttr(data.parent)}">
        <span class="directory-row-main"><span class="directory-icon">↰</span><span>上一级</span></span>
        <span class="directory-meta">..</span>
      </button>
    `);
    }
    rows.push(...(data.entries || []).map((entry) => `
    <button class="directory-row" type="button" data-path="${escapeAttr(entry.path)}">
      <span class="directory-row-main"><span class="directory-icon">▱</span><span>${escapeHtml(entry.name)}</span></span>
      <span class="directory-meta">文件夹</span>
    </button>
  `));
    $("directoryList").innerHTML = rows.join("") || `<div class="folder-empty-state">此目录下没有可进入的文件夹。</div>`;
    $("directoryList").querySelectorAll("[data-path]").forEach((node) => {
      node.addEventListener("click", () => browseDirectories(node.dataset.path).catch(reportError));
    });
  }

  function homeShortcutPath() {
    const home = state.directoryShortcuts.find((shortcut) => shortcut.name === "Home");
    return home?.path || "";
  }

  async function browseHomeDirectory() {
    await browseDirectories(homeShortcutPath());
  }

  async function browseParentDirectory() {
    if (!state.directoryParent) return;
    await browseDirectories(state.directoryParent);
  }

  async function refreshDirectory() {
    await browseDirectories(state.directoryPath);
  }

  function showNewFolderInline() {
    const row = $("newFolderInline");
    const input = $("newFolderNameInput");
    row.classList.remove("hidden");
    input.value = "";
    window.setTimeout(() => input.focus(), 0);
  }

  function hideNewFolderInline() {
    const row = $("newFolderInline");
    if (!row) return;
    row.classList.add("hidden");
    if ($("newFolderNameInput")) $("newFolderNameInput").value = "";
  }

  async function createFolderInCurrentDirectory() {
    const input = $("newFolderNameInput");
    const button = $("confirmNewFolderBtn");
    if (button?.disabled) return;
    const trimmed = input?.value.trim() || "";
    if (!trimmed) {
      showToast?.("请输入新文件夹名称。", "warn");
      input?.focus();
      return;
    }
    if (trimmed === "." || trimmed === "..") {
      showToast?.("文件夹名称不能是 . 或 ..。", "warn");
      input?.focus();
      return;
    }
    if (trimmed.length > 255) {
      showToast?.("文件夹名称过长，请控制在 255 个字符以内。", "warn");
      input?.focus();
      return;
    }
    if (/[\\/\0]/.test(trimmed)) {
      throw new Error("文件夹名称不能包含路径分隔符或空字符");
    }
    const base = normalizePath(state.directoryPath);
    const path = base === "/" ? `/${trimmed}` : `${base}/${trimmed}`;
    const previousLabel = button?.textContent || "创建";
    if (button) {
      button.textContent = button.classList.contains("composer-send-btn") ? "…" : "发送中";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    if (input) input.disabled = true;
    try {
      await api("/api/fs/mkdir", { method: "POST", body: JSON.stringify({ path }) });
      hideNewFolderInline();
      showToast?.("文件夹已创建。", "success");
      await browseDirectories(path);
    } finally {
      if (button) {
        button.textContent = previousLabel;
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
      if (input) input.disabled = false;
    }
  }

  function favoriteCurrentDirectory() {
    if (!state.directoryPath) return;
    rememberDirectory(state.directoryPath);
  }

  return {
    browseDirectories,
    browseHomeDirectory,
    browseParentDirectory,
    closeDirectoryModal,
    createFolderInCurrentDirectory,
    favoriteCurrentDirectory,
    hideNewFolderInline,
    openDirectoryChooser,
    refreshDirectory,
    rememberDirectory,
    renderRecentModalDirectories,
    renderRecentSidebarDirectories,
    selectNativeDirectory,
    setDirectoryStatus,
    showNewFolderInline,
    updateDirectoryPathDisplay,
  };
}
