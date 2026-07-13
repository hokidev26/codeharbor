import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatNumber, formatTimestamp } from "./formatters.mjs";
import { api } from "./runtime.mjs";

export function createGitWorkflowController({
  state,
  showError,
  showToast,
} = {}) {
  function resetGitWorkflowState() {
    state.gitStatus = null;
    state.gitDiff = null;
    state.gitLog = null;
    state.gitError = "";
    state.gitSelectedPath = "";
    state.gitCommitMessage = "";
    state.gitCommitSelected = {};
    state.gitCommitBusy = false;
    state.gitOpen = false;
    state.gitSeq++;
    renderGitButtonState();
  }

  function renderGitButtonState() {
    const button = $("gitWorkflowBtn");
    if (!button) return;
    const enabled = Boolean(state.agent?.id);
    button.disabled = !enabled;
    const dirty = Boolean(state.gitStatus && state.gitStatus.clean === false);
    button.classList.toggle("active", dirty || state.gitOpen);
    const count = Array.isArray(state.gitStatus?.files) ? state.gitStatus.files.length : 0;
    button.title = dirty ? `查看 Git 变更（${count} 个文件）` : "查看 Git 变更";
  }

  async function loadGitStatus(options = {}) {
    const agentId = state.agent?.id;
    renderGitButtonState();
    if (!agentId) return null;
    const seq = ++state.gitSeq;
    try {
      const status = await api(`/api/agents/${agentId}/git/status`);
      if (seq !== state.gitSeq || state.agent?.id !== agentId) return null;
      state.gitStatus = status;
      state.gitError = "";
      const files = Array.isArray(status.files) ? status.files : [];
      state.gitCommitSelected = pruneGitCommitSelection(files);
      if (!files.some((file) => file.path === state.gitSelectedPath)) {
        state.gitSelectedPath = files[0]?.path || "";
      }
      renderGitButtonState();
      if (state.gitOpen) renderGitModal();
      return status;
    } catch (err) {
      if (seq !== state.gitSeq || state.agent?.id !== agentId) return null;
      state.gitStatus = null;
      state.gitError = err.message || String(err);
      renderGitButtonState();
      if (!options.silent) showError(err);
      if (state.gitOpen) renderGitModal();
      return null;
    }
  }

  async function loadGitDiff(options = {}) {
    const agentId = state.agent?.id;
    if (!agentId) return null;
    const scope = options.scope || state.gitScope || "all";
    const path = options.path !== undefined ? options.path : state.gitSelectedPath || "";
    const params = new URLSearchParams({ scope });
    if (path) params.set("path", path);
    const diff = await api(`/api/agents/${agentId}/git/diff?${params.toString()}`);
    if (state.agent?.id !== agentId) return null;
    state.gitDiff = diff;
    state.gitError = "";
    if (state.gitOpen) renderGitModal();
    return diff;
  }

  async function loadGitLog() {
    const agentId = state.agent?.id;
    if (!agentId) return null;
    const log = await api(`/api/agents/${agentId}/git/log?limit=30`);
    if (state.agent?.id !== agentId) return null;
    state.gitLog = log;
    state.gitError = "";
    if (state.gitOpen) renderGitModal();
    return log;
  }

  async function refreshGitWorkflow(options = {}) {
    const status = await loadGitStatus({ silent: options.silent });
    if (!status) return;
    const files = Array.isArray(status.files) ? status.files : [];
    if (!state.gitSelectedPath && files.length) state.gitSelectedPath = files[0].path || "";
    await Promise.allSettled([loadGitDiff(), loadGitLog()]);
    if (options.notify) showToast("Git 状态已刷新。", "success");
  }

  function pruneGitCommitSelection(files) {
    const next = Object.create(null);
    const selected = state.gitCommitSelected || {};
    (files || []).forEach((file) => {
      const path = file.path || "";
      if (path && selected[path]) next[path] = true;
    });
    return next;
  }

  function selectedGitCommitPaths(files = state.gitStatus?.files || []) {
    const selected = state.gitCommitSelected || {};
    return (Array.isArray(files) ? files : [])
      .map((file) => file.path || "")
      .filter((path) => path && selected[path]);
  }

  function setGitCommitSelection(paths) {
    const next = Object.create(null);
    (paths || []).forEach((path) => {
      if (path) next[path] = true;
    });
    state.gitCommitSelected = next;
    renderGitModal();
  }

  function updateGitCommitControls() {
    const input = $("gitCommitMessageInput");
    if (input) state.gitCommitMessage = input.value;
    const selectedCount = selectedGitCommitPaths().length;
    const count = $("gitCommitSelectedCount");
    if (count) count.textContent = `${formatNumber(selectedCount)} 个已选择`;
    const button = $("gitCommitBtn");
    if (button) button.disabled = state.gitCommitBusy || !selectedCount || !String(state.gitCommitMessage || "").trim();
  }

  async function commitGitSelection(event) {
    event?.preventDefault();
    if (state.gitCommitBusy) return;
    const agentId = state.agent?.id;
    if (!agentId) return;
    const input = $("gitCommitMessageInput");
    if (input) state.gitCommitMessage = input.value;
    const message = String(state.gitCommitMessage || "").trim();
    const paths = selectedGitCommitPaths();
    if (!message) {
      showToast("请输入 commit message。", "warn", { force: true });
      return;
    }
    if (!paths.length) {
      showToast("请先选择要提交的文件。", "warn", { force: true });
      return;
    }
    state.gitCommitBusy = true;
    state.gitError = "";
    renderGitModal();
    try {
      const result = await api(`/api/agents/${agentId}/git/commit`, {
        method: "POST",
        body: JSON.stringify({ message, paths }),
      });
      if (state.agent?.id !== agentId) return;
      state.gitCommitMessage = "";
      state.gitCommitSelected = {};
      const shortHash = result?.commit?.shortHash ? ` ${result.commit.shortHash}` : "";
      showToast(`已创建提交${shortHash}。`, "success", { force: true });
      await refreshGitWorkflow({ silent: true });
    } catch (err) {
      if (state.agent?.id !== agentId) return;
      state.gitError = err.message || String(err);
      showError(err);
    } finally {
      if (state.agent?.id === agentId) {
        state.gitCommitBusy = false;
        renderGitModal();
      }
    }
  }

  function openGitModal() {
    if (!state.agent?.id) return;
    state.gitOpen = true;
    $("gitModal")?.classList.remove("hidden");
    renderGitButtonState();
    renderGitModal();
    refreshGitWorkflow({ silent: true }).catch((err) => {
      state.gitError = err.message || String(err);
      renderGitModal();
    });
  }

  function closeGitModal() {
    state.gitOpen = false;
    $("gitModal")?.classList.add("hidden");
    renderGitButtonState();
  }

  function renderGitModal() {
    const body = $("gitModalBody");
    if (!body) return;
    const status = state.gitStatus;
    const files = Array.isArray(status?.files) ? status.files : [];
    const diff = state.gitDiff;
    const log = state.gitLog;
    const selectedPath = state.gitSelectedPath || "";
    const selectedCommitPaths = selectedGitCommitPaths(files);
    if ($("gitModalPath")) {
      $("gitModalPath").textContent = status?.repoRoot || state.agent?.cwd || state.project?.gitPath || "查看并提交当前 Agent 工作目录的 Git 变更。";
    }
    body.innerHTML = `
      <div class="git-toolbar">
        <div class="git-summary">
          <strong>${escapeHtml(status?.branch || status?.head || "Git")}</strong>
          <span>${escapeHtml(status?.clean === false ? `${files.length} 个文件有变更` : (status ? "工作区干净" : "尚未加载"))}</span>
          ${status?.upstream ? `<span>${escapeHtml(status.upstream)}${status.ahead || status.behind ? ` · ahead ${escapeHtml(formatNumber(status.ahead || 0))} / behind ${escapeHtml(formatNumber(status.behind || 0))}` : ""}</span>` : ""}
        </div>
        <div class="git-actions">
          <select id="gitScopeSelect" class="select git-scope-select" aria-label="Diff 范围">
            <option value="all" ${state.gitScope === "all" ? "selected" : ""}>全部</option>
            <option value="unstaged" ${state.gitScope === "unstaged" ? "selected" : ""}>未暂存</option>
            <option value="staged" ${state.gitScope === "staged" ? "selected" : ""}>已暂存</option>
          </select>
          <button id="refreshGitBtn" class="ghost-btn mini" type="button">刷新</button>
        </div>
      </div>
      ${state.gitError ? `<div class="settings-inline-alert">${escapeHtml(state.gitError)}</div>` : ""}
      ${renderGitCommitPanel(files, selectedCommitPaths)}
      <div class="git-layout">
        <aside class="git-file-list">
          <div class="git-panel-title">变更文件</div>
          ${renderGitFileList(files, selectedPath)}
        </aside>
        <section class="git-diff-panel">
          <div class="git-panel-title">Diff ${selectedPath ? `<span>${escapeHtml(selectedPath)}</span>` : ""}</div>
          ${diff?.truncated ? `<div class="settings-inline-alert">Diff 输出已截断，只显示前半部分。</div>` : ""}
          ${renderUnifiedDiff(diff?.patch || "")}
        </section>
        <aside class="git-log-panel">
          <div class="git-panel-title">最近提交</div>
          ${renderGitLog(log?.commits || [])}
        </aside>
      </div>
    `;
    bindGitModalActions();
  }

  function renderGitCommitPanel(files, selectedPaths) {
    const selectedCount = selectedPaths.length;
    const disabled = state.gitCommitBusy || selectedCount === 0 || !String(state.gitCommitMessage || "").trim();
    return `
      <form id="gitCommitForm" class="git-commit-panel">
        <div class="git-commit-head">
          <div>
            <strong>提交所选变更</strong>
            <span>只会 add/commit 下方勾选的路径；不会 push、amend、reset 或 clean。</span>
          </div>
          <span id="gitCommitSelectedCount" class="git-commit-count">${escapeHtml(formatNumber(selectedCount))} 个已选择</span>
        </div>
        <textarea id="gitCommitMessageInput" class="git-commit-message" rows="2" maxlength="10000" placeholder="输入 commit message">${escapeHtml(state.gitCommitMessage || "")}</textarea>
        <div class="git-commit-actions">
          <button id="selectAllGitFilesBtn" class="ghost-btn mini git-mini-btn" type="button" ${files.length && !state.gitCommitBusy ? "" : "disabled"}>全选变更</button>
          <button id="clearGitFilesBtn" class="ghost-btn mini git-mini-btn" type="button" ${selectedCount && !state.gitCommitBusy ? "" : "disabled"}>清空选择</button>
          <button id="gitCommitBtn" class="send-btn git-commit-submit" type="submit" ${disabled ? "disabled" : ""}>${state.gitCommitBusy ? "提交中…" : "提交所选文件"}</button>
        </div>
      </form>
    `;
  }

  function renderGitFileList(files, selectedPath) {
    if (!files.length) return `<div class="settings-empty-card compact">暂无工作区变更。</div>`;
    const selected = state.gitCommitSelected || {};
    return files.map((file) => {
      const path = file.path || "";
      const checked = Boolean(selected[path]);
      return `
        <div class="git-file-row ${path === selectedPath ? "active" : ""}">
          <input class="git-file-checkbox" type="checkbox" data-git-select="${escapeAttr(path)}" aria-label="选择 ${escapeAttr(path)} 提交" ${checked ? "checked" : ""} ${state.gitCommitBusy ? "disabled" : ""} />
          <button class="git-file-open" type="button" data-git-file="${escapeAttr(path)}">
            <span class="git-file-status ${gitFileBadgeClass(file)}">${escapeHtml(gitStatusLabel(file))}</span>
            <span class="git-file-path">${escapeHtml(path)}</span>
          </button>
        </div>
      `;
    }).join("");
  }

  function renderUnifiedDiff(patch) {
    if (!patch) return `<pre class="git-diff-view empty">暂无 diff。未跟踪文件当前只在状态列表中展示。</pre>`;
    const lines = String(patch).split("\n");
    return `<pre class="git-diff-view">${lines.map((line) => `<div class="diff-line ${diffLineClass(line)}">${escapeHtml(line || " ")}</div>`).join("")}</pre>`;
  }

  function diffLineClass(line) {
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) return "meta";
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "context";
  }

  function renderGitLog(commits) {
    if (!Array.isArray(commits) || !commits.length) return `<div class="settings-empty-card compact">暂无提交记录。</div>`;
    return `<div class="git-log-list">${commits.map((commit) => `
      <div class="git-log-row">
        <strong>${escapeHtml(commit.shortHash || "")}</strong>
        <span>${escapeHtml(commit.subject || "")}</span>
        <small>${escapeHtml(formatTimestamp(commit.date))}</small>
      </div>
    `).join("")}</div>`;
  }

  function bindGitModalActions() {
    $("refreshGitBtn")?.addEventListener("click", () => refreshGitWorkflow({ notify: true }).catch(showError));
    $("gitScopeSelect")?.addEventListener("change", (event) => {
      state.gitScope = event.target.value || "all";
      loadGitDiff().catch(showError);
    });
    $("gitCommitForm")?.addEventListener("submit", (event) => commitGitSelection(event).catch(showError));
    $("gitCommitMessageInput")?.addEventListener("input", updateGitCommitControls);
    $("selectAllGitFilesBtn")?.addEventListener("click", () => setGitCommitSelection((state.gitStatus?.files || []).map((file) => file.path || "").filter(Boolean)));
    $("clearGitFilesBtn")?.addEventListener("click", () => setGitCommitSelection([]));
    document.querySelectorAll("[data-git-select]").forEach((node) => {
      node.addEventListener("change", () => {
        const path = node.dataset.gitSelect || "";
        const next = Object.assign(Object.create(null), state.gitCommitSelected || {});
        if (node.checked) next[path] = true;
        else delete next[path];
        state.gitCommitSelected = next;
        renderGitModal();
      });
    });
    document.querySelectorAll("[data-git-file]").forEach((node) => {
      node.addEventListener("click", () => {
        state.gitSelectedPath = node.dataset.gitFile || "";
        renderGitModal();
        loadGitDiff({ path: state.gitSelectedPath }).catch(showError);
      });
    });
  }

  function gitStatusLabel(file) {
    if (file.untracked) return "??";
    return `${file.index || " "}${file.worktree || " "}`.trim() || "M";
  }

  function gitFileBadgeClass(file) {
    if (file.untracked) return "untracked";
    if (file.staged && file.unstaged) return "mixed";
    if (file.staged) return "staged";
    return "modified";
  }

  return {
    closeGitModal,
    loadGitDiff,
    loadGitLog,
    loadGitStatus,
    openGitModal,
    refreshGitWorkflow,
    renderGitButtonState,
    resetGitWorkflowState,
  };
}
