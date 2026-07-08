import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatDuration, formatNumber, formatTimestamp } from "./formatters.mjs";

export function createWorkspaceSettingsController({
  state,
  api,
  copyText,
  currentProviderConfig,
  disconnectNarratorTransports,
  enterNarrator,
  getPreferredModel,
  hideSlashCommandPalette,
  loadChapterContainerData,
  notifyTerminal,
  openDirectoryChooser,
  providerLabel,
  providerStatusText,
  refreshActiveSettingsPanel,
  renderAgentModelOptions,
  renderUsageMetricCard,
  saveCurrentChatDraft,
  selectSettingsPanel,
  setPreferredModel,
  showError,
  showToast,
  syncMessageComposerBusy,
} = {}) {
  function renderAgentSettingsContent() {
    const agent = state.settings?.agent || {};
    const narrator = state.narrator;
    const currentModel = narrator?.model || getPreferredModel() || agent.defaultModel || "";
    const provider = currentProviderConfig(currentModel);
    const cwd = narrator?.cwd || state.project?.gitPath || "";
    return `
    <div class="settings-live-page agent-settings-page">
      <section class="settings-hero-card agents-hero-card">
        <div>
          <div class="settings-hero-kicker">AI 代理</div>
          <div class="settings-hero-title">${escapeHtml(narrator?.title || "未选择代理")}</div>
          <p>查看默认 Agent 策略，并快速调整当前 CodeHarbor 代理的模型、权限模式和工作目录。这里复用现有代理 API，不改全局配置文件。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAgentSettingsBtn" class="settings-action-btn primary" type="button" ${narrator ? "" : "disabled"}>刷新代理</button>
          <button id="copyAgentIdBtn" class="settings-action-btn subtle" type="button" ${narrator ? "" : "disabled"}>复制 ID</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(narrator?.status || "未选择")}</strong><span>运行状态</span></div>
        <div><strong>${escapeHtml(narrator?.permissionMode || agent.defaultPermissionMode || "acceptEdits")}</strong><span>权限模式</span></div>
        <div><strong>${escapeHtml(providerStatusText(provider || {}))}</strong><span>模型提供商</span></div>
      </div>
      <div class="usage-summary-grid">
        ${renderUsageMetricCard("默认模型", agent.defaultModel || "未配置", "新建代理默认使用")}
        ${renderUsageMetricCard("摘要模型", agent.summaryModel || "未配置", "长上下文摘要预留")}
        ${renderUsageMetricCard("最大轮次", agent.maxTurns || 0, "Agent loop 单次上限")}
        ${renderUsageMetricCard("首 token 超时", formatDuration(agent.firstTokenTimeoutMs || 0), "Provider 响应等待时间")}
        ${renderUsageMetricCard("瞬时重试", agent.maxTransientRetries || 0, "临时错误重试次数")}
        ${renderUsageMetricCard("默认计划模式", agent.defaultStartInPlanMode ? "开启" : "关闭", "新建代理初始行为")}
      </div>
      ${narrator ? renderCurrentAgentEditor(narrator, currentModel, cwd) : renderNoAgentSelectedCard()}
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">运行策略说明</div>
            <div class="settings-provider-meta">这些值来自 `/api/settings`，当前页面只调整选中的 CodeHarbor 代理；默认策略仍由服务端 config 管理。</div>
          </div>
        </div>
        <div class="agent-policy-grid">
          ${renderAgentPolicyCard("权限边界", agent.defaultPermissionMode || "acceptEdits", "新建代理默认权限；当前代理可在上方面板即时切换。")}
          ${renderAgentPolicyCard("计划模式", agent.defaultStartInPlanMode ? "默认开启" : "默认关闭", "保留给后续更完整的计划/执行流。")}
          ${renderAgentPolicyCard("模型路由", currentModel || "未选择", provider ? `${providerLabel(provider)} · ${providerStatusText(provider)}` : "等待模型列表加载")}
          ${renderAgentPolicyCard("工作目录", cwd || "未设置", "工具执行和终端默认围绕该目录工作。")}
        </div>
      </section>
    </div>
  `;
  }

  function renderCurrentAgentEditor(narrator, currentModel, cwd) {
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前代理</div>
          <div class="settings-provider-meta">${escapeHtml(narrator.type || "primary")} · ${escapeHtml(narrator.id)}</div>
        </div>
        <span class="settings-status-pill ${narrator.status === "running" ? "warn" : "ok"}">${escapeHtml(narrator.status || "idle")}</span>
      </div>
      <form id="agentSettingsForm" class="settings-agent-form">
        <div class="settings-provider-form-grid">
          <label class="settings-form-span-2">模型
            <select id="agentSettingsModel" class="settings-field">
              ${renderAgentModelOptions(currentModel)}
            </select>
          </label>
          <label>权限模式
            <select id="agentSettingsPermissionMode" class="settings-field">
              ${renderPermissionModeOptions(narrator.permissionMode || "acceptEdits")}
            </select>
          </label>
          <label>消息数
            <input class="settings-field" value="${escapeAttr(formatNumber(narrator.messageCount || 0))}" readonly />
          </label>
          <label class="settings-form-span-2">工作目录
            <input id="agentSettingsCWD" class="settings-field" value="${escapeAttr(cwd)}" placeholder="例如 /Users/me/project" />
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          <button id="useProjectPathForAgentBtn" class="settings-action-btn subtle" type="button" ${state.project?.gitPath ? "" : "disabled"}>使用项目目录</button>
          <button id="openAgentProviderBtn" class="settings-action-btn subtle" type="button">配置提供商</button>
          <button class="settings-action-btn primary" type="submit" data-agent-submit>保存当前代理</button>
        </div>
      </form>
    </section>
  `;
  }

  function renderNoAgentSelectedCard() {
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">尚未选择代理</div>
          <div class="settings-provider-meta">从左侧选择项目，或点击“选择目录”创建项目后，会在这里显示当前 CodeHarbor 主代理。</div>
        </div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn primary" type="button" data-agent-open-directory>选择目录</button>
      </div>
    </section>
  `;
  }

  function setSettingsSubmitButtonState(form, selector, submitting, busyLabel) {
    const button = form?.querySelector(selector);
    if (!button) return;
    if (submitting) {
      if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      return;
    }
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    delete button.dataset.originalLabel;
  }

  function renderPermissionModeOptions(selected) {
    return ["readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk"]
      .map((mode) => `<option value="${escapeAttr(mode)}" ${mode === selected ? "selected" : ""}>${escapeHtml(mode)}</option>`)
      .join("");
  }

  function renderAgentPolicyCard(title, value, description) {
    return `
    <div class="agent-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
  }

  function bindAgentSettingsActions() {
    $("agentSettingsForm")?.addEventListener("submit", (event) => saveAgentSettingsFromPanel(event).catch(showError));
    $("refreshAgentSettingsBtn")?.addEventListener("click", () => refreshCurrentAgent().catch(showError));
    $("copyAgentIdBtn")?.addEventListener("click", () => copyText(state.narrator?.id || ""));
    $("useProjectPathForAgentBtn")?.addEventListener("click", () => {
      if ($("agentSettingsCWD") && state.project?.gitPath) $("agentSettingsCWD").value = state.project.gitPath;
    });
    $("openAgentProviderBtn")?.addEventListener("click", () => selectSettingsPanel("providers"));
    document.querySelector("[data-agent-open-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
  }

  async function refreshCurrentAgent() {
    if (state.agentRefreshing) return;
    if (!state.narrator?.id) throw new Error("请先选择一个代理");
    const id = state.narrator.id;
    const button = $("refreshAgentSettingsBtn");
    state.agentRefreshing = true;
    setButtonBusy(button, true, "刷新中");
    try {
      const updated = await api(`/api/narrators/${id}`);
      if (state.narrator?.id !== id) return;
      state.narrator = updated;
      await enterNarrator();
      if (state.narrator?.id !== id) return;
      showToast("当前代理状态已刷新。", "success");
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.narrator?.id === id) throw err;
    } finally {
      state.agentRefreshing = false;
      setButtonBusy(button, false, "刷新中");
    }
  }

  async function saveAgentSettingsFromPanel(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form?.querySelector("[data-agent-submit]");
    if (submitButton?.disabled) return;
    if (!state.narrator?.id) throw new Error("请先选择一个代理");
    const id = state.narrator.id;
    const model = $("agentSettingsModel")?.value.trim() || "";
    const permissionMode = $("agentSettingsPermissionMode")?.value || "acceptEdits";
    const cwd = $("agentSettingsCWD")?.value.trim() || "";
    if (!cwd) throw new Error("请填写工作目录");
    setSettingsSubmitButtonState(form, "[data-agent-submit]", true, "保存中");
    const applyPatch = async (path, payload) => {
      const updated = await api(`/api/narrators/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (state.narrator?.id !== id) return false;
      state.narrator = updated;
      return true;
    };
    try {
      if (model && model !== state.narrator.model) {
        setPreferredModel(model);
        if (!await applyPatch("model", { model })) return;
      }
      if (permissionMode && permissionMode !== state.narrator.permissionMode) {
        if (!await applyPatch("permission-mode", { permissionMode })) return;
      }
      if (cwd && cwd !== state.narrator.cwd) {
        if (!await applyPatch("cwd", { cwd })) return;
      }
      if (state.narrator?.id !== id) return;
      await enterNarrator();
      if (state.narrator?.id !== id) return;
      showToast("当前代理设置已保存。", "success");
      notifyTerminal?.(`[info] 已保存当前代理：${state.narrator.model}, ${state.narrator.permissionMode}\n`);
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.narrator?.id === id) throw err;
    } finally {
      setSettingsSubmitButtonState(form, "[data-agent-submit]", false, "保存中");
    }
  }
  function renderChaptersSettingsContent() {
    const chapters = Array.isArray(state.projectChapters) ? state.projectChapters : [];
    const narrators = Array.isArray(state.chapterNarrators) ? state.chapterNarrators : [];
    const rootChapter = chapters.find((chapter) => chapter.isRoot) || chapters[0] || null;
    return `
    <div class="settings-live-page chapters-page">
      <section class="settings-hero-card chapters-hero-card">
        <div>
          <div class="settings-hero-kicker">章节与容器</div>
          <div class="settings-hero-title">${escapeHtml(state.project?.name || "未选择项目")}</div>
          <p>查看当前项目的章节/workline、root chapter、叙述者和隔离状态。当前版本不创建容器，只展示本地工作目录和后续扩展边界。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshChaptersBtn" class="settings-action-btn primary" type="button" ${state.project?.id ? "" : "disabled"}>刷新章节</button>
          <button id="openChaptersDirectoryBtn" class="settings-action-btn subtle" type="button">选择目录</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(chapters.length))}</strong><span>章节</span></div>
        <div><strong>${escapeHtml(formatNumber(narrators.length))}</strong><span>当前章节 CodeHarbor</span></div>
        <div><strong>${escapeHtml(rootChapter?.title || "暂无")}</strong><span>Root chapter</span></div>
      </div>
      ${state.chaptersError ? `<div class="settings-inline-alert">${escapeHtml(state.chaptersError)}</div>` : ""}
      ${state.project ? renderProjectChapterSummary(chapters, narrators) : renderNoProjectForChapters()}
    </div>
  `;
  }

  function renderNoProjectForChapters() {
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">尚未选择项目</div>
          <div class="settings-provider-meta">请先从左侧选择项目，或选择一个本地目录创建项目。</div>
        </div>
      </div>
      <button class="settings-action-btn primary" type="button" data-open-project-directory>选择目录</button>
    </section>
  `;
  }

  function renderProjectChapterSummary(chapters, narrators) {
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("项目状态", state.project?.status || "active", state.project?.gitPath || "未配置路径")}
      ${renderUsageMetricCard("当前章节", state.chapter?.title || "暂无", state.chapter?.role || "root")}
      ${renderUsageMetricCard("当前代理", state.narrator?.title || "暂无", state.narrator?.permissionMode || "未选择")}
      ${renderUsageMetricCard("Flow mode", state.project?.flowMode || "default", "项目工作流模式")}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">章节 / 工作线</div>
          <div class="settings-provider-meta path">${escapeHtml(state.project?.gitPath || "未配置项目路径")}</div>
        </div>
      </div>
      <div class="chapter-list">
        ${chapters.length ? chapters.map(renderChapterCard).join("") : `<div class="settings-empty-card compact">当前项目还没有章节记录。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前章节 CodeHarbor</div>
          <div class="settings-provider-meta">来自 `/api/chapters/{id}/narrators`；用于确认主代理、子代理和工作目录。</div>
        </div>
      </div>
      <div class="chapter-narrator-list">
        ${narrators.length ? narrators.map(renderChapterNarratorCard).join("") : `<div class="settings-empty-card compact">当前章节暂无 CodeHarbor 代理。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">容器与隔离边界</div>
          <div class="settings-provider-meta">当前 MVP 以本地目录/工作树为主，容器运行、远程 sandbox 和 worktree merge 会在后续阶段接入。</div>
        </div>
        <span class="settings-status-pill muted">本地目录模式</span>
      </div>
      <div class="chapter-boundary-grid">
        ${renderChapterBoundaryCard("工作目录", state.narrator?.cwd || state.project?.gitPath || "未设置", "工具和终端围绕该路径运行。")}
        ${renderChapterBoundaryCard("Branch", state.chapter?.branch || "未绑定", "后续 Git worktree/branch 管理预留。")}
        ${renderChapterBoundaryCard("Worktree", state.chapter?.worktreePath || "未启用", "当前未自动创建隔离 worktree。")}
        ${renderChapterBoundaryCard("Base", state.chapter?.baseBranch || "未设置", "后续 merge/review 可使用。")}
      </div>
    </section>
  `;
  }

  function renderChapterCard(chapter) {
    const active = chapter.id === state.chapter?.id;
    return `
    <div class="chapter-card ${active ? "active" : ""}">
      <div>
        <div class="chapter-title">${escapeHtml(chapter.title || "Untitled chapter")} ${chapter.isRoot ? "<span class='settings-status-pill ok'>root</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(chapter.role || "chapter")} · ${escapeHtml(chapter.status || "active")} · ${escapeHtml(formatTimestamp(chapter.updatedAt))}</div>
        <div class="settings-provider-meta path">${escapeHtml(chapter.worktreePath || chapter.branch || state.project?.gitPath || "未绑定路径")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-chapter="${escapeAttr(chapter.id)}">查看</button>
      </div>
    </div>
  `;
  }

  function renderChapterNarratorCard(narrator) {
    const active = narrator.id === state.narrator?.id;
    return `
    <div class="chapter-narrator-card ${active ? "active" : ""}">
      <div>
        <div class="chapter-title">${escapeHtml(narrator.title || state.project?.name || "CodeHarbor")} ${active ? "<span class='settings-status-pill ok'>current</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(narrator.type || "primary")} · ${escapeHtml(narrator.status || "idle")} · ${escapeHtml(narrator.permissionMode || "acceptEdits")}</div>
        <div class="settings-provider-meta path">${escapeHtml(narrator.cwd || state.project?.gitPath || "未设置工作目录")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-narrator="${escapeAttr(narrator.id)}">设为当前</button>
      </div>
    </div>
  `;
  }

  function renderChapterBoundaryCard(title, value, description) {
    return `
    <div class="chapter-boundary-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
  }

  function bindChaptersSettingsActions() {
    $("refreshChaptersBtn")?.addEventListener("click", () => loadChapterContainerData({ notify: true }).catch(showError));
    $("openChaptersDirectoryBtn")?.addEventListener("click", (event) => openDirectoryChooser(state.project?.gitPath || "", { trigger: event.currentTarget }).catch(showError));
    document.querySelector("[data-open-project-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
    document.querySelectorAll("[data-select-chapter]").forEach((node) => {
      node.addEventListener("click", () => selectChapterFromSettings(node.dataset.selectChapter).catch(showError));
    });
    document.querySelectorAll("[data-select-narrator]").forEach((node) => {
      node.addEventListener("click", () => selectNarratorFromSettings(node.dataset.selectNarrator).catch(showError));
    });
    if (state.project?.id && !state.projectChapters.length && !state.chaptersError) {
      loadChapterContainerData().catch(showError);
    }
  }

  async function selectChapterFromSettings(chapterID) {
    saveCurrentChatDraft();
    hideSlashCommandPalette();
    const chapter = state.projectChapters.find((item) => item.id === chapterID);
    if (!chapter) return;
    const projectId = state.project?.id || "";
    disconnectNarratorTransports();
    state.chapter = chapter;
    state.narrator = null;
    syncMessageComposerBusy();
    try {
      const narrators = await api(`/api/chapters/${chapter.id}/narrators`);
      if (state.project?.id !== projectId || state.chapter?.id !== chapterID) return;
      state.chapterNarrators = Array.isArray(narrators) ? narrators : [];
      state.narrator = state.chapterNarrators.find((narrator) => narrator.type === "primary") || state.chapterNarrators[0] || state.narrator;
      if (state.narrator) await enterNarrator();
      if (state.project?.id !== projectId || state.chapter?.id !== chapterID) return;
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.project?.id === projectId && state.chapter?.id === chapterID) throw err;
    }
  }

  async function selectNarratorFromSettings(narratorID) {
    saveCurrentChatDraft();
    hideSlashCommandPalette();
    const narrator = state.chapterNarrators.find((item) => item.id === narratorID);
    if (!narrator) return;
    const chapterId = state.chapter?.id || "";
    state.narrator = narrator;
    await enterNarrator();
    if (state.chapter?.id !== chapterId || state.narrator?.id !== narratorID) return;
    refreshActiveSettingsPanel();
  }

  return {
    bindAgentSettingsActions,
    bindChaptersSettingsActions,
    renderAgentSettingsContent,
    renderChaptersSettingsContent,
  };
}
