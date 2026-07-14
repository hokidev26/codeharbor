import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatDuration, formatNumber, formatTimestamp } from "./formatters.mjs";
import { t } from "./i18n.mjs";

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
  const wt = (key, params) => t(`workspaceSettings.${key}`, params);

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
          <div class="settings-hero-kicker">${escapeHtml(wt("agentHeroKicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(agent?.title || wt("noAgentSelected"))}</div>
          <p>${escapeHtml(wt("agentHeroDescription"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAgentSettingsBtn" class="settings-action-btn primary" type="button" ${agent ? "" : "disabled"}>${escapeHtml(wt("refreshAgent"))}</button>
          <button id="copyAgentIdBtn" class="settings-action-btn subtle" type="button" ${agent ? "" : "disabled"}>${escapeHtml(wt("copyId"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(agent?.status || wt("noAgentSelected"))}</strong><span>${escapeHtml(wt("runtimeStatus"))}</span></div>
        <div><strong>${escapeHtml(agent?.permissionMode || agentConfig.defaultPermissionMode || "acceptEdits")}</strong><span>${escapeHtml(wt("permissionMode"))}</span></div>
        <div><strong>${escapeHtml(providerStatusText(provider || {}))}</strong><span>${escapeHtml(wt("modelProvider"))}</span></div>
      </div>
      <div class="usage-summary-grid">
        ${renderUsageMetricCard(wt("defaultModel"), agentConfig.defaultModel || wt("unconfigured"), wt("defaultAgentModel"))}
        ${renderUsageMetricCard(wt("summaryModel"), agentConfig.summaryModel || wt("unconfigured"), wt("summaryModelDescription"))}
        ${renderUsageMetricCard(wt("maxTurns"), agentConfig.maxTurns || 0, wt("maxTurnsDescription"))}
        ${renderUsageMetricCard(wt("firstTokenTimeout"), formatDuration(agentConfig.firstTokenTimeoutMs || 0), wt("firstTokenTimeoutDescription"))}
        ${renderUsageMetricCard(wt("transientRetries"), agentConfig.maxTransientRetries || 0, wt("transientRetriesDescription"))}
        ${renderUsageMetricCard(wt("defaultPlanMode"), agentConfig.defaultStartInPlanMode ? wt("enabled") : wt("disabled"), wt("defaultPlanModeDescription"))}
      </div>
      ${agent ? renderCurrentAgentEditor(agent, currentModel, cwd) : renderNoAgentSelectedCard()}
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
          <div class="settings-provider-title">${escapeHtml(wt("runtimePolicy"))}</div>
          <div class="settings-provider-meta">${escapeHtml(wt("runtimePolicyDescription"))}</div>

          </div>
        </div>
        <div class="agent-policy-grid">
          ${renderAgentPolicyCard(wt("permissionBoundary"), agentConfig.defaultPermissionMode || "acceptEdits", wt("permissionBoundaryDescription"))}
          ${renderAgentPolicyCard(wt("planMode"), agentConfig.defaultStartInPlanMode ? wt("planModeEnabled") : wt("planModeDisabled"), wt("planModeDescription"))}
          ${renderAgentPolicyCard(wt("modelRouting"), currentModel || wt("noneSelected"), provider ? `${providerLabel(provider)} · ${providerStatusText(provider)}` : wt("waitingModelList"))}
          ${renderAgentPolicyCard(wt("workDirectory"), cwd || wt("notSet"), wt("workDirectoryDescription"))}
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
          <div class="settings-provider-title">${escapeHtml(wt("currentAgent"))}</div>
          <div class="settings-provider-meta">${escapeHtml(agent.type || wt("primary"))} · ${escapeHtml(agent.id)}</div>
        </div>
        <span class="settings-status-pill ${agent.status === "running" ? "warn" : "ok"}">${escapeHtml(agent.status || "idle")}</span>
      </div>
      <form id="agentSettingsForm" class="settings-agent-form">
        <div class="settings-provider-form-grid">
          <label class="settings-form-span-2">${escapeHtml(wt("model"))}
            <select id="agentSettingsModel" class="settings-field">
              ${renderAgentModelOptions(currentModel)}
            </select>
          </label>
          <label>${escapeHtml(wt("permissionMode"))}
            <select id="agentSettingsPermissionMode" class="settings-field">
              ${renderPermissionModeOptions(agent.permissionMode || "acceptEdits")}
            </select>
          </label>
          <label>${escapeHtml(wt("reasoningEffort"))}
            <select id="agentSettingsReasoningEffort" class="settings-field">
              ${["", "low", "medium", "high", "xhigh"].map((value) => `<option value="${escapeAttr(value)}" ${value === (agent.reasoningEffort || "") ? "selected" : ""}>${escapeHtml(value || wt("automatic"))}</option>`).join("")}
            </select>
          </label>
          <label>${escapeHtml(wt("messageCount"))}
            <input class="settings-field" value="${escapeAttr(formatNumber(agent.messageCount || 0))}" readonly />
          </label>
          <label class="settings-form-span-2">${escapeHtml(wt("workDirectory"))}
            <input id="agentSettingsCWD" class="settings-field" value="${escapeAttr(cwd)}" placeholder="${escapeAttr(wt("cwdPlaceholder"))}" />
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          <button id="useProjectPathForAgentBtn" class="settings-action-btn subtle" type="button" ${state.project?.gitPath ? "" : "disabled"}>${escapeHtml(wt("useProjectDirectory"))}</button>
          <button id="openAgentProviderBtn" class="settings-action-btn subtle" type="button">${escapeHtml(wt("configureProvider"))}</button>
          <button class="settings-action-btn primary" type="submit" data-agent-submit>${escapeHtml(wt("saveCurrentAgent"))}</button>
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
          <div class="settings-provider-title">${escapeHtml(wt("noAgentCardTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(wt("noAgentCardDescription"))}</div>
        </div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn primary" type="button" data-agent-open-directory>${escapeHtml(wt("chooseDirectory"))}</button>
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
        const label = disabled ? wt("permissionModeRemoteDisabled", { mode }) : mode;
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
    if (!state.agent?.id) throw new Error(wt("selectAgentRequired"));
    const id = state.agent.id;
    const button = $("refreshAgentSettingsBtn");
    state.agentRefreshing = true;
    setButtonBusy(button, true, t("common.refreshing"));
    try {
      const updated = await api(`/api/agents/${id}`);
      if (state.agent?.id !== id) return;
      state.agent = updated;
      await enterAgent();
      if (state.agent?.id !== id) return;
      showToast(wt("agentStatusRefreshed"), "success");
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.agent?.id === id) throw err;
    } finally {
      state.agentRefreshing = false;
      setButtonBusy(button, false, t("common.refreshing"));
    }
  }

  async function saveAgentSettingsFromPanel(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form?.querySelector("[data-agent-submit]");
    if (submitButton?.disabled) return;
    if (!state.agent?.id) throw new Error(wt("selectAgentRequired"));
    const id = state.agent.id;
    const model = $("agentSettingsModel")?.value.trim() || "";
    const permissionMode = $("agentSettingsPermissionMode")?.value || "acceptEdits";
    const reasoningEffort = $("agentSettingsReasoningEffort")?.value || "";
    const cwd = $("agentSettingsCWD")?.value.trim() || "";
    if (!cwd) throw new Error(wt("cwdRequired"));
    setSettingsSubmitButtonState(form, "[data-agent-submit]", true, wt("saving"));
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
      showToast(wt("agentSettingsSaved"), "success");
      notifyTerminal?.(`[info] ${wt("agentSettingsSavedTerminal", { model: state.agent.model, permissionMode: state.agent.permissionMode })}\n`);
      refreshActiveSettingsPanel();
    } catch (err) {
      if (state.agent?.id === id) throw err;
    } finally {
      setSettingsSubmitButtonState(form, "[data-agent-submit]", false, wt("saving"));
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
          <div class="settings-hero-kicker">${escapeHtml(wt("worklinesHeroKicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(state.project?.name || wt("noProjectSelected"))}</div>
          <p>${escapeHtml(wt("worklinesHeroDescription"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshWorklinesBtn" class="settings-action-btn primary" type="button" ${state.project?.id ? "" : "disabled"}>${escapeHtml(wt("refreshWorklines"))}</button>
          <button id="openWorklinesDirectoryBtn" class="settings-action-btn subtle" type="button">${escapeHtml(wt("chooseDirectory"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(worklines.length))}</strong><span>${escapeHtml(wt("worklines"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(agents.length))}</strong><span>${escapeHtml(wt("worklineAgents"))}</span></div>
        <div><strong>${escapeHtml(rootWorkline?.title || wt("none"))}</strong><span>${escapeHtml(wt("rootWorkline"))}</span></div>
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
          <div class="settings-provider-title">${escapeHtml(wt("noProjectCardTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(wt("noProjectCardDescription"))}</div>
        </div>
      </div>
      <button class="settings-action-btn primary" type="button" data-open-project-directory>${escapeHtml(wt("chooseDirectory"))}</button>
    </section>
  `;
  }

  function renderProjectWorklineSummary(worklines, agents) {
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(wt("projectStatus"), state.project?.status || wt("active"), state.project?.gitPath || wt("unconfiguredPath"))}
      ${renderUsageMetricCard(wt("currentWorkline"), state.workline?.title || wt("none"), state.workline?.role || wt("root"))}
      ${renderUsageMetricCard(wt("currentAgentLabel"), state.agent?.title || wt("none"), state.agent?.permissionMode || wt("noAgentSelected"))}
      ${renderUsageMetricCard(wt("flowMode"), state.project?.flowMode || "default", wt("flowModeDescription"))}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(wt("worklinesTitle"))}</div>
          <div class="settings-provider-meta path">${escapeHtml(state.project?.gitPath || wt("unconfiguredProjectPath"))}</div>
        </div>
      </div>
      <div class="workline-list">
        ${worklines.length ? worklines.map(renderWorklineCard).join("") : `<div class="settings-empty-card compact">${escapeHtml(wt("noWorklineRecords"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(wt("worklineAgentsTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(wt("worklineAgentsDescription"))}</div>
        </div>
      </div>
      <div class="workline-agent-list">
        ${agents.length ? agents.map(renderWorklineAgentCard).join("") : `<div class="settings-empty-card compact">${escapeHtml(wt("noWorklineAgents"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(wt("containersIsolation"))}</div>
          <div class="settings-provider-meta">${escapeHtml(wt("containersIsolationDescription"))}</div>
        </div>
        <span class="settings-status-pill muted">${escapeHtml(wt("localDirectoryMode"))}</span>
      </div>
      <div class="workline-boundary-grid">
        ${renderWorklineBoundaryCard(wt("workDirectory"), state.agent?.cwd || state.project?.gitPath || wt("notSet"), wt("workDirectoryDescription"))}
        ${renderWorklineBoundaryCard(wt("branch"), state.workline?.branch || wt("unbound"), wt("branchDescription"))}
        ${renderWorklineBoundaryCard(wt("worktree"), state.workline?.worktreePath || wt("disabledWorktree"), wt("worktreeDescription"))}
        ${renderWorklineBoundaryCard(wt("base"), state.workline?.baseBranch || wt("notSet"), wt("baseDescription"))}
      </div>
    </section>
  `;
  }

  function renderWorklineCard(workline) {
    const active = workline.id === state.workline?.id;
    return `
    <div class="workline-card ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(workline.title || wt("untitledWorkline"))} ${workline.isRoot ? `<span class='settings-status-pill ok'>${escapeHtml(wt("root"))}</span>` : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(workline.role || wt("workline"))} · ${escapeHtml(workline.status || wt("active"))} · ${escapeHtml(formatTimestamp(workline.updatedAt))}</div>
        <div class="settings-provider-meta path">${escapeHtml(workline.worktreePath || workline.branch || state.project?.gitPath || wt("unboundPath"))}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-workline="${escapeAttr(workline.id)}">${escapeHtml(wt("view"))}</button>
      </div>
    </div>
  `;
  }

  function renderWorklineAgentCard(agent) {
    const active = agent.id === state.agent?.id;
    return `
    <div class="workline-agent-card ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(agent.title || state.project?.name || wt("agent"))} ${active ? `<span class='settings-status-pill ok'>${escapeHtml(wt("current"))}</span>` : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(agent.type || wt("primary"))} · ${escapeHtml(agent.status || wt("idle"))} · ${escapeHtml(agent.permissionMode || "acceptEdits")}</div>
        <div class="settings-provider-meta path">${escapeHtml(agent.cwd || state.project?.gitPath || wt("unsetWorkDirectory"))}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-select-agent="${escapeAttr(agent.id)}">${escapeHtml(wt("setCurrent"))}</button>
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
