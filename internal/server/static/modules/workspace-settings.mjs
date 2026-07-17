import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatDuration, formatNumber, formatTimestamp } from "./formatters.mjs";
import { t } from "./i18n.mjs";
import { fullAccessAllowed } from "./remote-access-capabilities.mjs";

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

  function continuationSettings(agentConfig = {}) {
    const source = agentConfig.continuation && typeof agentConfig.continuation === "object"
      ? agentConfig.continuation
      : (agentConfig.autoContinuation && typeof agentConfig.autoContinuation === "object" ? agentConfig.autoContinuation : {});
    return {
      mode: String(source.mode ?? agentConfig.autoContinuationMode ?? "off"),
      segmentTurns: source.segmentTurns ?? agentConfig.continuationSegmentTurns ?? "",
      maxContinuations: source.maxContinuations ?? agentConfig.maxContinuations ?? "",
      maxTotalTurns: source.maxTotalTurns ?? agentConfig.maxTotalTurns ?? "",
      maxDurationMs: source.maxRunDurationMs ?? source.maxDurationMs ?? source.durationBudgetMs ?? agentConfig.maxRunDurationMs ?? agentConfig.continuationMaxDurationMs ?? "",
      tokenBudget: source.maxRunTokens ?? source.tokenBudget ?? agentConfig.maxRunTokens ?? agentConfig.continuationTokenBudget ?? "",
      endpoint: String(source.settingsEndpoint ?? agentConfig.continuationSettingsEndpoint ?? state.settings?.continuationSettingsEndpoint ?? ""),
    };
  }

  function renderContinuationSettings(agentConfig = {}) {
    const config = continuationSettings(agentConfig);
    const writable = Boolean(config.endpoint);
    const numericField = (id, label, value, placeholder) => `<label class="settings-form-field">${escapeHtml(label)}<input id="${id}" class="settings-field" type="number" min="0" step="1" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" /></label>`;
    return `<section class="settings-provider-section settings-page-section settings-card">
      <div class="settings-provider-section-head settings-card-header"><div><div class="settings-provider-title settings-card-title">${escapeHtml(wt("continuationTitle"))}</div><div class="settings-provider-meta settings-card-description" data-settings-help-copy>${escapeHtml(wt("continuationDescription"))}</div></div><span class="settings-status-pill settings-badge ${config.mode === "safe" ? "ok" : "muted"}">${escapeHtml(config.mode === "safe" ? wt("continuationSafe") : wt("continuationOff"))}</span></div>
      <form id="continuationSettingsForm" class="settings-card-content">
        <div class="continuation-settings-grid settings-form-grid">
          <label class="settings-form-field">${escapeHtml(wt("continuationMode"))}<select id="continuationMode" class="settings-field"><option value="off" ${config.mode === "safe" ? "" : "selected"}>${escapeHtml(wt("continuationOff"))}</option><option value="safe" ${config.mode === "safe" ? "selected" : ""}>${escapeHtml(wt("continuationSafe"))}</option></select></label>
          ${numericField("continuationSegmentTurns", wt("continuationSegmentTurns"), config.segmentTurns, wt("continuationOptional"))}
          ${numericField("continuationMaxContinuations", wt("continuationMaxContinuations"), config.maxContinuations, wt("continuationOptional"))}
          ${numericField("continuationMaxTotalTurns", wt("continuationMaxTotalTurns"), config.maxTotalTurns, wt("continuationOptional"))}
          ${numericField("continuationDuration", wt("continuationDuration"), config.maxDurationMs, wt("continuationMilliseconds"))}
          ${numericField("continuationTokenBudget", wt("continuationTokenBudget"), config.tokenBudget, wt("continuationOptional"))}
        </div>
        <div class="settings-inline-alert ${writable ? "hidden" : ""}">${escapeHtml(wt("continuationCompatibilityHint"))}</div>
        <div class="settings-action-row settings-form-actions settings-card-footer"><button class="settings-action-btn primary" type="submit" data-continuation-submit ${writable ? "" : "disabled"}>${escapeHtml(wt("continuationSave"))}</button></div>
      </form>
    </section>`;
  }

  function renderAgentSettingsContent() {
    const agentConfig = state.settings?.agent || {};
    const agent = state.agent;
    const currentModel = agent?.model || getPreferredModel() || agentConfig.defaultModel || "";
    const provider = currentProviderConfig(currentModel);
    const cwd = agent?.cwd || state.project?.gitPath || "";
    return `
    <div class="settings-live-page agent-settings-page">
      <section class="settings-hero-card agents-hero-card settings-page-section settings-card">
        <div class="settings-card-header">
          <div class="settings-hero-kicker">${escapeHtml(wt("agentHeroKicker"))}</div>
          <div class="settings-hero-title settings-card-title">${escapeHtml(agent?.title || wt("noAgentSelected"))}</div>
          <p class="settings-card-description" data-settings-help-copy>${escapeHtml(wt("agentHeroDescription"))}</p>
        </div>
        <div class="settings-action-row settings-toolbar settings-inline-actions settings-card-footer">
          <button id="refreshAgentSettingsBtn" class="settings-action-btn primary" type="button" ${agent ? "" : "disabled"}>${escapeHtml(wt("refreshAgent"))}</button>
          <button id="copyAgentIdBtn" class="settings-action-btn subtle" type="button" ${agent ? "" : "disabled"}>${escapeHtml(wt("copyId"))}</button>
        </div>
      </section>
      <div class="settings-status-strip settings-stat-grid">
        <div class="settings-stat-card"><strong>${escapeHtml(agent?.status || wt("noAgentSelected"))}</strong><span>${escapeHtml(wt("runtimeStatus"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(agent?.permissionMode || agentConfig.defaultPermissionMode || "acceptEdits")}</strong><span>${escapeHtml(wt("permissionMode"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(providerStatusText(provider || {}))}</strong><span>${escapeHtml(wt("modelProvider"))}</span></div>
      </div>
      <div class="usage-summary-grid settings-stat-grid">
        ${renderUsageMetricCard(wt("defaultModel"), agentConfig.defaultModel || wt("unconfigured"), wt("defaultAgentModel"))}
        ${renderUsageMetricCard(wt("summaryModel"), agentConfig.summaryModel || wt("unconfigured"), wt("summaryModelDescription"))}
        ${renderUsageMetricCard(wt("maxTurns"), agentConfig.maxTurns || 0, wt("maxTurnsDescription"))}
        ${renderUsageMetricCard(wt("firstTokenTimeout"), formatDuration(agentConfig.firstTokenTimeoutMs || 0), wt("firstTokenTimeoutDescription"))}
        ${renderUsageMetricCard(wt("transientRetries"), agentConfig.maxTransientRetries || 0, wt("transientRetriesDescription"))}
        ${renderUsageMetricCard(wt("defaultPlanMode"), agentConfig.defaultStartInPlanMode ? wt("enabled") : wt("disabled"), wt("defaultPlanModeDescription"))}
      </div>
      ${renderContinuationSettings(agentConfig)}
      ${agent ? renderCurrentAgentEditor(agent, currentModel, cwd) : renderNoAgentSelectedCard()}
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(wt("runtimePolicy"))}</div>
            <div class="settings-provider-meta settings-card-description" data-settings-help-copy>${escapeHtml(wt("runtimePolicyDescription"))}</div>
          </div>
        </div>
        <div class="agent-policy-grid settings-card-content">
          ${renderAgentPolicyCard(wt("permissionBoundary"), agentConfig.defaultPermissionMode || "acceptEdits", wt("permissionBoundaryDescription"), true)}
          ${renderAgentPolicyCard(wt("planMode"), agent?.planMode === true ? wt("planModePlan") : wt("planModeExecute"), wt("planModeDescription"), true)}
          ${renderAgentPolicyCard(wt("modelRouting"), currentModel || wt("noneSelected"), provider ? `${providerLabel(provider)} · ${providerStatusText(provider)}` : wt("waitingModelList"))}
          ${renderAgentPolicyCard(wt("workDirectory"), cwd || wt("notSet"), wt("workDirectoryDescription"), true)}
        </div>
      </section>
    </div>
  `;
  }

  function renderCurrentAgentEditor(agent, currentModel, cwd) {
    const bypassDisabled = !fullAccessAllowed(state);
    return `
    <section class="settings-provider-section highlighted settings-page-section settings-card">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("currentAgent"))}</div>
          <div class="settings-provider-meta settings-card-description">${escapeHtml(agent.type || wt("primary"))} · ${escapeHtml(agent.id)}</div>
        </div>
        <span class="settings-status-pill settings-badge ${agent.status === "running" ? "warn" : "ok"}">${escapeHtml(agent.status || "idle")}</span>
      </div>
      <form id="agentSettingsForm" class="settings-agent-form settings-card-content">
        <div class="settings-provider-form-grid settings-form-grid">
          <label class="settings-form-span-2 settings-form-field">${escapeHtml(wt("model"))}
            <select id="agentSettingsModel" class="settings-field">
              ${renderAgentModelOptions(currentModel)}
            </select>
          </label>
          <label class="settings-form-field">${escapeHtml(wt("permissionMode"))}
            <select id="agentSettingsPermissionMode" class="settings-field">
              ${renderPermissionModeOptions(agent.permissionMode || "acceptEdits")}
            </select>
          </label>
          <label class="settings-form-field">${escapeHtml(wt("planMode"))}
            <select id="agentSettingsPlanMode" class="settings-field">
              <option value="false" ${agent.planMode === true ? "" : "selected"}>${escapeHtml(wt("planModeExecute"))}</option>
              <option value="true" ${agent.planMode === true ? "selected" : ""}>${escapeHtml(wt("planModePlan"))}</option>
            </select>
          </label>
          <label class="settings-form-field">${escapeHtml(wt("reasoningEffort"))}
            <select id="agentSettingsReasoningEffort" class="settings-field">
              ${["", "low", "medium", "high", "xhigh"].map((value) => `<option value="${escapeAttr(value)}" ${value === (agent.reasoningEffort || "") ? "selected" : ""}>${escapeHtml(value || wt("automatic"))}</option>`).join("")}
            </select>
          </label>
          <label class="settings-form-field">${escapeHtml(wt("messageCount"))}
            <input class="settings-field" value="${escapeAttr(formatNumber(agent.messageCount || 0))}" readonly />
          </label>
          <label class="settings-form-span-2 settings-form-field">${escapeHtml(wt("workDirectory"))}
            <input id="agentSettingsCWD" class="settings-field" value="${escapeAttr(cwd)}" placeholder="${escapeAttr(wt("cwdPlaceholder"))}" />
          </label>
        </div>
        ${bypassDisabled ? `<div class="settings-inline-alert settings-alert" role="alert">${escapeHtml(wt("permissionModeRemoteDisabled", { mode: wt("permissionModeBypassPermissions") }))}</div>` : ""}
        <div class="settings-action-row settings-form-actions settings-inline-actions settings-card-footer">
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
    <section class="settings-provider-section highlighted settings-page-section settings-card settings-empty-state">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("noAgentCardTitle"))}</div>
          <div class="settings-provider-meta settings-card-description">${escapeHtml(wt("noAgentCardDescription"))}</div>
        </div>
      </div>
      <div class="settings-action-row settings-toolbar settings-inline-actions settings-card-footer">
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
        const key = `permissionMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
        const modeLabel = wt(key);
        const label = disabled ? wt("permissionModeRemoteDisabled", { mode: modeLabel }) : modeLabel;
        return `<option value="${escapeAttr(mode)}" ${mode === effectiveSelected ? "selected" : ""} ${disabled ? "disabled" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function renderAgentPolicyCard(title, value, description, helpCopy = false) {
    return `
    <div class="agent-policy-card settings-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small${helpCopy ? " data-settings-help-copy" : ""}>${escapeHtml(description)}</small>
    </div>
  `;
  }

  function bindAgentSettingsActions() {
    $("agentSettingsForm")?.addEventListener("submit", (event) => saveAgentSettingsFromPanel(event).catch(showError));
    $("continuationSettingsForm")?.addEventListener("submit", (event) => saveContinuationSettingsFromPanel(event).catch(showError));
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

  async function saveContinuationSettingsFromPanel(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const config = continuationSettings(state.settings?.agent || {});
    if (!config.endpoint) return;
    const optionalNumber = (id) => {
      const raw = $(id)?.value;
      if (raw === "" || raw === null || raw === undefined) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
    };
    const payload = {
      mode: $("continuationMode")?.value === "safe" ? "safe" : "off",
      segmentTurns: optionalNumber("continuationSegmentTurns"),
      maxContinuations: optionalNumber("continuationMaxContinuations"),
      maxTotalTurns: optionalNumber("continuationMaxTotalTurns"),
      maxRunDurationMs: optionalNumber("continuationDuration"),
      maxRunTokens: optionalNumber("continuationTokenBudget"),
    };
    setSettingsSubmitButtonState(form, "[data-continuation-submit]", true, wt("saving"));
    try {
      const response = await api(config.endpoint, { method: "PATCH", body: JSON.stringify(payload) });
      const continuation = response?.continuation || response?.agent?.continuation || response || payload;
      state.settings = {
        ...(state.settings || {}),
        agent: { ...(state.settings?.agent || {}), continuation: { ...payload, ...(continuation || {}), settingsEndpoint: config.endpoint } },
      };
      showToast(wt("continuationSaved"), "success");
      refreshActiveSettingsPanel();
    } finally {
      setSettingsSubmitButtonState(form, "[data-continuation-submit]", false, wt("saving"));
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
    const planMode = $("agentSettingsPlanMode")?.value === "true";
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
      if (planMode !== Boolean(state.agent.planMode)) {
        if (!await applyPatch("plan-mode", { planMode })) return;
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
      <section class="settings-hero-card worklines-hero-card settings-page-section settings-card">
        <div class="settings-card-header">
          <div class="settings-hero-kicker">${escapeHtml(wt("worklinesHeroKicker"))}</div>
          <div class="settings-hero-title settings-card-title">${escapeHtml(state.project?.name || wt("noProjectSelected"))}</div>
          <p class="settings-card-description" data-settings-help-copy>${escapeHtml(wt("worklinesHeroDescription"))}</p>
        </div>
        <div class="settings-action-row settings-toolbar settings-inline-actions settings-card-footer">
          <button id="refreshWorklinesBtn" class="settings-action-btn primary" type="button" ${state.project?.id ? "" : "disabled"}>${escapeHtml(wt("refreshWorklines"))}</button>
          <button id="openWorklinesDirectoryBtn" class="settings-action-btn subtle" type="button">${escapeHtml(wt("chooseDirectory"))}</button>
        </div>
      </section>
      <div class="settings-status-strip settings-stat-grid">
        <div class="settings-stat-card"><strong>${escapeHtml(formatNumber(worklines.length))}</strong><span>${escapeHtml(wt("worklines"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(formatNumber(agents.length))}</strong><span>${escapeHtml(wt("worklineAgents"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(rootWorkline?.title || wt("none"))}</strong><span>${escapeHtml(wt("rootWorkline"))}</span></div>
      </div>
      ${state.worklinesError ? `<div class="settings-inline-alert settings-alert" role="alert">${escapeHtml(state.worklinesError)}</div>` : ""}
      ${state.project ? renderProjectWorklineSummary(worklines, agents) : renderNoProjectForWorklines()}
    </div>
  `;
  }

  function renderNoProjectForWorklines() {
    return `
    <section class="settings-provider-section highlighted settings-page-section settings-card settings-empty-state">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("noProjectCardTitle"))}</div>
          <div class="settings-provider-meta settings-card-description">${escapeHtml(wt("noProjectCardDescription"))}</div>
        </div>
      </div>
      <div class="settings-inline-actions settings-card-footer">
        <button class="settings-action-btn primary" type="button" data-open-project-directory>${escapeHtml(wt("chooseDirectory"))}</button>
      </div>
    </section>
  `;
  }

  function renderProjectWorklineSummary(worklines, agents) {
    return `
    <div class="usage-summary-grid settings-stat-grid">
      ${renderUsageMetricCard(wt("projectStatus"), state.project?.status || wt("active"), state.project?.gitPath || wt("unconfiguredPath"))}
      ${renderUsageMetricCard(wt("currentWorkline"), state.workline?.title || wt("none"), state.workline?.role || wt("root"))}
      ${renderUsageMetricCard(wt("currentAgentLabel"), state.agent?.title || wt("none"), state.agent?.permissionMode || wt("noAgentSelected"))}
      ${renderUsageMetricCard(wt("flowMode"), state.project?.flowMode || "default", wt("flowModeDescription"))}
    </div>
    <section class="settings-provider-section highlighted settings-page-section settings-card">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("worklinesTitle"))}</div>
          <div class="settings-provider-meta settings-card-description path">${escapeHtml(state.project?.gitPath || wt("unconfiguredProjectPath"))}</div>
        </div>
      </div>
      <div class="workline-list settings-data-list settings-card-content">
        ${worklines.length ? worklines.map(renderWorklineCard).join("") : `<div class="settings-empty-card settings-empty-state compact">${escapeHtml(wt("noWorklineRecords"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section settings-page-section settings-card">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("worklineAgentsTitle"))}</div>
          <div class="settings-provider-meta settings-card-description" data-settings-help-copy>${escapeHtml(wt("worklineAgentsDescription"))}</div>
        </div>
      </div>
      <div class="workline-agent-list settings-data-list settings-card-content">
        ${agents.length ? agents.map(renderWorklineAgentCard).join("") : `<div class="settings-empty-card settings-empty-state compact">${escapeHtml(wt("noWorklineAgents"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section settings-page-section settings-card">
      <div class="settings-provider-section-head settings-card-header">
        <div>
          <div class="settings-provider-title settings-card-title">${escapeHtml(wt("containersIsolation"))}</div>
          <div class="settings-provider-meta settings-card-description" data-settings-help-copy>${escapeHtml(wt("containersIsolationDescription"))}</div>
        </div>
        <span class="settings-status-pill settings-badge muted">${escapeHtml(wt("localDirectoryMode"))}</span>
      </div>
      <div class="workline-boundary-grid settings-card-content">
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
    <div class="workline-card settings-data-row ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(workline.title || wt("untitledWorkline"))} ${workline.isRoot ? `<span class='settings-status-pill settings-badge ok'>${escapeHtml(wt("root"))}</span>` : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(workline.role || wt("workline"))} · ${escapeHtml(workline.status || wt("active"))} · ${escapeHtml(formatTimestamp(workline.updatedAt))}</div>
        <div class="settings-provider-meta path">${escapeHtml(workline.worktreePath || workline.branch || state.project?.gitPath || wt("unboundPath"))}</div>
      </div>
      <div class="settings-action-row settings-toolbar settings-inline-actions">
        <button class="settings-action-btn subtle" type="button" data-select-workline="${escapeAttr(workline.id)}">${escapeHtml(wt("view"))}</button>
      </div>
    </div>
  `;
  }

  function renderWorklineAgentCard(agent) {
    const active = agent.id === state.agent?.id;
    return `
    <div class="workline-agent-card settings-data-row ${active ? "active" : ""}">
      <div>
        <div class="workline-title">${escapeHtml(agent.title || state.project?.name || wt("agent"))} ${active ? `<span class='settings-status-pill settings-badge ok'>${escapeHtml(wt("current"))}</span>` : ""}</div>
        <div class="settings-provider-meta">${escapeHtml(agent.type || wt("primary"))} · ${escapeHtml(agent.status || wt("idle"))} · ${escapeHtml(agent.permissionMode || "acceptEdits")}</div>
        <div class="settings-provider-meta path">${escapeHtml(agent.cwd || state.project?.gitPath || wt("unsetWorkDirectory"))}</div>
      </div>
      <div class="settings-action-row settings-toolbar settings-inline-actions">
        <button class="settings-action-btn subtle" type="button" data-select-agent="${escapeAttr(agent.id)}">${escapeHtml(wt("setCurrent"))}</button>
      </div>
    </div>
  `;
  }

  function renderWorklineBoundaryCard(title, value, description) {
    return `
    <div class="workline-boundary-card settings-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small data-settings-help-copy>${escapeHtml(description)}</small>
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
