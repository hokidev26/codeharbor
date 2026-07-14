import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatDuration, formatNumber, formatTimestamp } from "./formatters.mjs";

export function createWorkspaceSettingsController({
  state,
  api,
  copyText,
  currentProviderConfig,
  disconnectAgentTransports,
  enterAgent,
  getPreferredModel,
  hideSlashCommandPalette,
  loadWorklineContainerData,
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
    const agentConfig = state.settings?.agent || {};
    const agent = state.agent;
    const currentModel = agent?.model || getPreferredModel() || agentConfig.defaultModel || "";
    const provider = currentProviderConfig(currentModel);
    const cwd = agent?.cwd || state.project?.gitPath || "";
    return `
    <div class="settings-live-page agent-settings-page">
      <section class="settings-hero-card agents-hero-card">
        <div>
          <div class="settings-hero-kicker">AI 代理</div>
          <div class="settings-hero-title">${escapeHtml(agent?.title || "未选择代理")}</div>
          <p>查看默认 Agent 策略，并快速调整当前 Agent 的模型、权限模式和工作目录。这里复用现有 Agent API，不改全局配置文件。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAgentSettingsBtn" class="settings-action-btn primary" type="button" ${agent ? "" : "disabled"}>刷新代理</button>
          <button id="copyAgentIdBtn" class="settings-action-btn subtle" type="button" ${agent ? "" : "disabled"}>复制 ID</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(agent?.status || "未选择")}</strong><span>运行状态</span></div>
        <div><strong>${escapeHtml(agent?.permissionMode || agentConfig.defaultPermissionMode || "acceptEdits")}</strong><span>权限模式</span></div>
        <div><strong>${escapeHtml(providerStatusText(provider || {}))}</strong><span>模型提供商</span></div>
      </div>
      <div class="usage-summary-grid">
        ${renderUsageMetricCard("默认模型", agentConfig.defaultModel || "未配置", "新建代理默认使用")}
        ${renderUsageMetricCard("摘要模型", agentConfig.summaryModel || "未配置", "长上下文摘要预留")}
        ${renderUsageMetricCard("最大轮次", agentConfig.maxTurns || 0, "Agent loop 单次上限")}
        ${renderUsageMetricCard("首 token 超时", formatDuration(agentConfig.firstTokenTimeoutMs || 0), "Provider 响应等待时间")}
        ${renderUsageMetricCard("瞬时重试", agentConfig.maxTransientRetries || 0, "临时错误重试次数")}
        ${renderUsageMetricCard("默认计划模式", agentConfig.defaultStartInPlanMode ? "开启" : "关闭", "新建代理初始行为")}
      </div>
      ${agent ? renderCurrentAgentEditor(agent, currentModel, cwd) : renderNoAgentSelectedCard()}
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">运行策略说明</div>
            <div class="settings-provider-meta">这些值来自 `/api/settings`，当前页面只调整选中的 Agent；默认策略仍由服务端 config 管理。</div>
          </div>
        </div>
        <div class="agent-policy-grid">
          ${renderAgentPolicyCard("权限边界", agentConfig.defaultPermissionMode || "acceptEdits", "新建代理默认权限；当前代理可在上方面板即时切换。")}
          ${renderAgentPolicyCard("计划模式", agentConfig.defaultStartInPlanMode ? "默认开启" : "默认关闭", "保留给后续更完整的计划/执行流。")}
          ${renderAgentPolicyCard("模型路由", currentModel || "未选择", provider ? `${providerLabel(provider)} · ${providerStatusText(provider)}` : "等待模型列表加载")}
          ${renderAgentPolicyCard("工作目录", cwd || "未设置", "工具执行和终端默认围绕该目录工作。")}
        </div>
      </section>
    </div>
  `;
  }

  function renderCurrentAgentEditor(agent, currentModel, cwd) {
    return `
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前代理</div>
          <div class="settings-provider-meta">${escapeHtml(agent.type || "primary")} · ${escapeHtml(agent.id)}</div>
        </div>
        <span class="settings-status-pill ${agent.status === "running" ? "warn" : "ok"}">${escapeHtml(agent.status || "idle")}</span>
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
              ${renderPermissionModeOptions(agent.permissionMode || "acceptEdits")}
            </select>
          </label>
          <label>思考强度
            <select id="agentSettingsReasoningEffort" class="settings-field">
              ${["", "low", "medium", "high"].map((value) => `<option value="${escapeAttr(value)}" ${value === (agent.reasoningEffort || "") ? "selected" : ""}>${escapeHtml(value || "自动")}</option>`).join("")}
            </select>
          </label>
          <label>消息数
            <input class="settings-field" value="${escapeAttr(formatNumber(agent.messageCount || 0))}" readonly />
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
          <div class="settings-provider-meta">从左侧选择项目，或点击“选择目录”创建项目后，会在这里显示当前 Agent 主代理。</div>
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
    const bypassDisabled = Boolean(state.runtimeSummary?.security?.bypassPermissionsAllowed === false);
    const effectiveSelected = bypassDisabled && selected === "bypassPermissions" ? "acceptEdits" : selected;
    return ["readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk"]
      .map((mode) => {
        const disabled = bypassDisabled && mode === "bypassPermissions";
        const label = disabled ? `${mode}（远程禁用）` : mode;
        return `<option value="${escapeAttr(mode)}" ${mode === effectiveSelected ? "selected" : ""} ${disabled ? "disabled" : ""}>${escapeHtml(label)}</option>`;
      })
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
    $("copyAgentIdBtn")?.addEventListener("click", () => copyText(state.agent?.id || ""));
    $("useProjectPathForAgentBtn")?.addEventListener("click", () => {
      if ($("agentSettingsCWD") && state.project?.gitPath) $("agentSettingsCWD").value = state.project.gitPath;
    });
    $("openAgentProviderBtn")?.addEventListener("click", () => selectSettingsPanel("providers"));
    document.querySelector("[data-agent-open-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
  }

  async function refreshCurrentAgent() {
    if (state.agentRefreshing) return;
    if (!state.agent?.id) throw new Error("请先选择一个代理");
    const id = state.agent.id;
    const button = $("refreshAgentSettingsBtn");
    state.agentRefreshing = true;
    setButtonBusy(button, true, "刷新中");
    try {
      const updated = await api(`/api/agents/${id}`);
      if (state.agent?.id !== id) return;
      state.agent = updated;
      await enterAgent();
      if (state.agent?.id !== id) return;
      showToast("当前代理状态已刷新。", "success");
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.agent?.id === id) throw err;
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
    if (!state.agent?.id) throw new Error("请先选择一个代理");
    const id = state.agent.id;
    const model = $("agentSettingsModel")?.value.trim() || "";
    const permissionMode = $("agentSettingsPermissionMode")?.value || "acceptEdits";
    const reasoningEffort = $("agentSettingsReasoningEffort")?.value || "";
    const cwd = $("agentSettingsCWD")?.value.trim() || "";
    if (!cwd) throw new Error("请填写工作目录");
    setSettingsSubmitButtonState(form, "[data-agent-submit]", true, "保存中");
    const applyPatch = async (path, payload) => {
      const updated = await api(`/api/agents/${id}/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (state.agent?.id !== id) return false;
      state.agent = updated;
      return true;
    };
    try {
      if (model && model !== state.agent.model) {
        setPreferredModel(model);
        if (!await applyPatch("model", { model })) return;
      }
      if (permissionMode && permissionMode !== state.agent.permissionMode) {
        if (!await applyPatch("permission-mode", { permissionMode })) return;
      }
      if (reasoningEffort !== (state.agent.reasoningEffort || "")) {
        if (!await applyPatch("reasoning-effort", { reasoningEffort })) return;
      }
      if (cwd && cwd !== state.agent.cwd) {
        if (!await applyPatch("cwd", { cwd })) return;
      }
      if (state.agent?.id !== id) return;
      await enterAgent();
      if (state.agent?.id !== id) return;
      showToast("当前代理设置已保存。", "success");
      notifyTerminal?.(`[info] 已保存当前代理：${state.agent.model}, ${state.agent.permissionMode}\n`);
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.agent?.id === id) throw err;
    } finally {
      setSettingsSubmitButtonState(form, "[data-agent-submit]", false, "保存中");
    }
  }
  function renderWorklinesSettingsContent() {
    const worklines = Array.isArray(state.projectWorklines) ? state.projectWorklines : [];
    const agents = Array.isArray(state.worklineAgents) ? state.worklineAgents : [];
    const rootWorkline = worklines.find((workline) => workline.isRoot) || worklines[0] || null;
    return `
    <div class="settings-live-page worklines-page">
      <section class="settings-hero-card worklines-hero-card">
        <div>
          <div class="settings-hero-kicker">工作线与容器</div>
          <div class="settings-hero-title">${escapeHtml(state.project?.name || "未选择项目")}</div>
          <p>查看当前项目的工作线、根工作线、Agent 和隔离状态。当前版本不创建容器，只展示本地工作目录和后续扩展边界。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshWorklinesBtn" class="settings-action-btn primary" type="button" ${state.project?.id ? "" : "disabled"}>刷新工作线</button>
          <button id="openWorklinesDirectoryBtn" class="settings-action-btn subtle" type="button">选择目录</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(worklines.length))}</strong><span>工作线</span></div>
        <div><strong>${escapeHtml(formatNumber(agents.length))}</strong><span>当前工作线 Agent</span></div>
        <div><strong>${escapeHtml(rootWorkline?.title || "暂无")}</strong><span>Root workline</span></div>
      </div>
      ${state.worklinesError ? `<div class="settings-inline-alert">${escapeHtml(state.worklinesError)}</div>` : ""}
      ${state.project ? renderProjectWorklineSummary(worklines, agents) : renderNoProjectForWorklines()}
    </div>
  `;
  }

  function renderNoProjectForWorklines() {
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

  function renderProjectWorklineSummary(worklines, agents) {
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("项目状态", state.project?.status || "active", state.project?.gitPath || "未配置路径")}
      ${renderUsageMetricCard("当前工作线", state.workline?.title || "暂无", state.workline?.role || "root")}
      ${renderUsageMetricCard("当前代理", state.agent?.title || "暂无", state.agent?.permissionMode || "未选择")}
      ${renderUsageMetricCard("Flow mode", state.project?.flowMode || "default", "项目工作流模式")}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">工作线</div>
          <div class="settings-provider-meta path">${escapeHtml(state.project?.gitPath || "未配置项目路径")}</div>
        </div>
      </div>
      <div class="workline-list">
        ${worklines.length ? worklines.map(renderWorklineCard).join("") : `<div class="settings-empty-card compact">当前项目还没有工作线记录。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前工作线 Agent</div>
          <div class="settings-provider-meta">来自 `/api/worklines/{id}/agents`；用于确认主代理、子代理和工作目录。</div>
        </div>
      </div>
      <div class="workline-agent-list">
        ${agents.length ? agents.map(renderWorklineAgentCard).join("") : `<div class="settings-empty-card compact">当前工作线暂无 Agent。</div>`}
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
      <div class="workline-boundary-grid">
        ${renderWorklineBoundaryCard("工作目录", state.agent?.cwd || state.project?.gitPath || "未设置", "工具和终端围绕该路径运行。")}
        ${renderWorklineBoundaryCard("Branch", state.workline?.branch || "未绑定", "后续 Git worktree/branch 管理预留。")}
        ${renderWorklineBoundaryCard("Worktree", state.workline?.worktreePath || "未启用", "当前未自动创建隔离 worktree。")}
        ${renderWorklineBoundaryCard("Base", state.workline?.baseBranch || "未设置", "后续 merge/review 可使用。")}
      </div>
    </section>
  `;
  }

  function renderWorklineCard(workline) {
    const active = workline.id === state.workline?.id;
    return `
    <div class="workline-card ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(workline.title || "Untitled workline")} ${workline.isRoot ? "<span class='settings-status-pill ok'>root</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(workline.role || "workline")} · ${escapeHtml(workline.status || "active")} · ${escapeHtml(formatTimestamp(workline.updatedAt))}</div>
        <div class="settings-provider-meta path">${escapeHtml(workline.worktreePath || workline.branch || state.project?.gitPath || "未绑定路径")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-workline="${escapeAttr(workline.id)}">查看</button>
      </div>
    </div>
  `;
  }

  function renderWorklineAgentCard(agent) {
    const active = agent.id === state.agent?.id;
    return `
    <div class="workline-agent-card ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(agent.title || state.project?.name || "Agent")} ${active ? "<span class='settings-status-pill ok'>current</span>" : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(agent.type || "primary")} · ${escapeHtml(agent.status || "idle")} · ${escapeHtml(agent.permissionMode || "acceptEdits")}</div>
        <div class="settings-provider-meta path">${escapeHtml(agent.cwd || state.project?.gitPath || "未设置工作目录")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-agent="${escapeAttr(agent.id)}">设为当前</button>
      </div>
    </div>
  `;
  }

  function renderWorklineBoundaryCard(title, value, description) {
    return `
    <div class="workline-boundary-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
  }

  function bindWorklinesSettingsActions() {
    $("refreshWorklinesBtn")?.addEventListener("click", () => loadWorklineContainerData({ notify: true }).catch(showError));
    $("openWorklinesDirectoryBtn")?.addEventListener("click", (event) => openDirectoryChooser(state.project?.gitPath || "", { trigger: event.currentTarget }).catch(showError));
    document.querySelector("[data-open-project-directory]")?.addEventListener("click", (event) => openDirectoryChooser("", { trigger: event.currentTarget }).catch(showError));
    document.querySelectorAll("[data-select-workline]").forEach((node) => {
      node.addEventListener("click", () => selectWorklineFromSettings(node.dataset.selectWorkline).catch(showError));
    });
    document.querySelectorAll("[data-select-agent]").forEach((node) => {
      node.addEventListener("click", () => selectAgentFromSettings(node.dataset.selectAgent).catch(showError));
    });
    if (state.project?.id && !state.projectWorklines.length && !state.worklinesError) {
      loadWorklineContainerData().catch(showError);
    }
  }

  async function selectWorklineFromSettings(worklineID) {
    saveCurrentChatDraft();
    hideSlashCommandPalette();
    const workline = state.projectWorklines.find((item) => item.id === worklineID);
    if (!workline) return;
    const projectId = state.project?.id || "";
    disconnectAgentTransports();
    state.workline = workline;
    state.agent = null;
    syncMessageComposerBusy();
    try {
      const agents = await api(`/api/worklines/${workline.id}/agents`);
      if (state.project?.id !== projectId || state.workline?.id !== worklineID) return;
      state.worklineAgents = Array.isArray(agents) ? agents : [];
      state.agent = state.worklineAgents.find((agent) => agent.type === "primary") || state.worklineAgents[0] || state.agent;
      if (state.agent) await enterAgent();
      if (state.project?.id !== projectId || state.workline?.id !== worklineID) return;
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.project?.id === projectId && state.workline?.id === worklineID) throw err;
    }
  }

  async function selectAgentFromSettings(agentID) {
    saveCurrentChatDraft();
    hideSlashCommandPalette();
    const agent = state.worklineAgents.find((item) => item.id === agentID);
    if (!agent) return;
    const worklineId = state.workline?.id || "";
    state.agent = agent;
    await enterAgent();
    if (state.workline?.id !== worklineId || state.agent?.id !== agentID) return;
    refreshActiveSettingsPanel();
  }

  return {
    bindAgentSettingsActions,
    bindWorklinesSettingsActions,
    renderAgentSettingsContent,
    renderWorklinesSettingsContent,
  };
}
