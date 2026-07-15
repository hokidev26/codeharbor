import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { t } from "./messages-skills.mjs";
import { normalizeSlashCommandName } from "./skills-commands.mjs";
import { skillTabs } from "./settings-data.mjs";

function currentRestoreReviewChallenge(error) {
  const body = error?.body;
  const contentHash = String(body?.contentHash || "").trim();
  const scannerVersion = Number(body?.scannerVersion);
  if (
    error?.status !== 409
    || body?.code !== "skill_restore_review_required"
    || String(body?.scanVerdict || "").toLowerCase() !== "review"
    || !Array.isArray(body?.scanFindings)
    || !contentHash
    || !Number.isSafeInteger(scannerVersion)
    || scannerVersion < 1
  ) return null;
  return {
    scanVerdict: "review",
    scanFindings: body.scanFindings,
    contentHash,
    scannerVersion,
  };
}

export function isCurrentRestoreReviewConflict(error) {
  return Boolean(currentRestoreReviewChallenge(error));
}

export function formatRestoreReviewChallenge(challenge) {
  const hash = challenge.contentHash.length > 16 ? `${challenge.contentHash.slice(0, 16)}…` : challenge.contentHash;
  const findings = challenge.scanFindings.length
    ? challenge.scanFindings.map((finding) => {
      const code = String(finding?.code || "scan");
      const severity = String(finding?.severity || challenge.scanVerdict);
      const message = String(finding?.message || t("skillsWorkbench.restoreReview.findingDefault"));
      return `- [${severity}] ${code}: ${message}`;
    }).join("\n")
    : t("skillsWorkbench.restoreReview.noFindings");
  return t("skillsWorkbench.restoreReview.prompt", { scannerVersion: challenge.scannerVersion, hash, findings });
}

export async function restoreRevisionWithCurrentRiskConfirmation(restore, confirmRisk) {
  try {
    return await restore({ acknowledgeRisk: false, acknowledgedContentHash: "" });
  } catch (error) {
    const challenge = currentRestoreReviewChallenge(error);
    if (!challenge) throw error;
    if (!confirmRisk?.(formatRestoreReviewChallenge(challenge), challenge)) return null;
    return restore({ acknowledgeRisk: true, acknowledgedContentHash: challenge.contentHash });
  }
}

export function createSkillsWorkbenchController({
  state,
  bindMCPRegistryActions,
  bindPluginRegistryActions,
  copyText,
  createServerSkill,
  createToolPermissionRule,
  currentSkillsPreferences,
  deleteServerSkill,
  deleteToolPermissionRule,
  isMCPRegistryActionBusy,
  importServerSkill,
  loadServerSkills,
  loadServerSkillDetail,
  loadWorkflowPolicy,
  localSkillID,
  normalizeMCPServer,
  normalizeSkillCommand,
  notifyTerminal,
  previewServerSkillImport,
  renderMCPRegistryList,
  renderPluginRegistryPanel,
  resetSkillsPreferences,
  saveSkillsPreferences,
  saveWorkflowPreferences,
  showError,
  skillsPhaseB,
  skillsPrefsExport,
  getSkillContext,
  setSkillContext,
  updateServerSkill,
  updateToolPermissionRule,
} = {}) {
  function renderSkillSettingsContent(activeKey = "commands") {
    const active = skillTabs.find((tab) => tab.key === activeKey) || skillTabs[0];
    state.activeSkillTab = active.key;
    return `
    <div class="skills-page">
      <div class="skills-tabs" role="tablist" aria-label="${escapeAttr(t("skillsWorkbench.tabsAriaLabel"))}">
        ${skillTabs.map((tab) => `
          <button class="skills-tab ${tab.key === active.key ? "active" : ""}" type="button" data-skill-tab="${escapeAttr(tab.key)}" role="tab" aria-selected="${tab.key === active.key ? "true" : "false"}">
            ${escapeHtml(tab.label)}
          </button>
        `).join("")}
      </div>
      <section class="skills-tab-panel" role="tabpanel">
        ${renderSkillTabPanel(active)}
      </section>
    </div>
  `;
  }

  function renderSkillTabPanel(active) {
    if (active.key === "commands") return renderLocalCommandSkills(active);
    if (active.key === "mcp-tools") return renderLocalMCPTools(active);
    if (active.key === "plugins") return renderPluginRegistryPanel(active);
    if (active.key === "tool-permissions") return renderLocalToolPolicy(active);
    return renderSkillRoadmapPanel(active);
  }

  let pendingSkillImportContent = "";
  let pendingSkillImportPreview = null;
  let localMigrationSummary = "";

  function renderLocalCommandSkills(active) {
    const phaseBMarkup = skillsPhaseB ? renderSkillsPhaseBCommands(active) : "";
    if (state.serverSkillsStatus === "idle") {
      loadServerSkills?.().catch(showError);
    }
    const localCommands = currentSkillsPreferences().commands || [];
    const serverSkills = Array.isArray(state.serverSkills) ? state.serverSkills : [];
    const loading = state.serverSkillsStatus === "loading";
    return `
    <p class="skills-description">${escapeHtml(active.description)} ${escapeHtml(t("skillsWorkbench.commands.compatibilityDescription"))}${skillsPhaseB ? ` ${escapeHtml(t("skillsWorkbench.commands.phaseBDescription"))}` : ""}</p>
    <div class="skill-workbench-actions skills-primary-actions">
      <button id="refreshServerSkillsBtn" class="settings-action-btn subtle" type="button" ${loading ? "disabled" : ""}>${loading ? t("skillsWorkbench.commands.statusLoading") : t("skillsWorkbench.commands.refreshServer")}</button>
      <button id="migrateLocalSkillsBtn" class="settings-action-btn subtle" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>${t("skillsWorkbench.commands.migrateLocal", { count: localCommands.length })}</button>
    </div>
    ${phaseBMarkup}
    ${state.serverSkillsError ? `<div class="settings-inline-alert">${escapeHtml(state.serverSkillsError)}</div>` : ""}
    ${localMigrationSummary ? `<div class="settings-provider-meta">${escapeHtml(localMigrationSummary)}</div>` : ""}
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.commands.serverTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.commands.serverDescription"))}</div>
        </div>
        <span class="settings-status-pill ${loading || state.serverSkillsStatus === "stale" ? "warn" : state.serverSkillsStatus === "error" ? "muted" : "ok"}">${loading ? t("skillsWorkbench.commands.statusLoading") : state.serverSkillsStatus === "stale" ? t("skillsWorkbench.commands.statusStale") : state.serverSkillsStatus === "error" ? t("skillsWorkbench.commands.statusError") : state.serverSkillsStatus === "ready" ? t("skillsWorkbench.commands.statusReady") : t("skillsWorkbench.commands.statusIdle")}</span>
      </div>
      <div class="skill-command-list">
        ${loading && !serverSkills.length ? `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.commands.loading"))}</div>` : serverSkills.length ? serverSkills.map(renderServerSkillCard).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.commands.empty"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.commands.importTitle"))}</div>
      <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.commands.importDescription"))}</div>
      <div class="settings-action-row settings-form-actions">
        <input id="skillImportFile" class="hidden" type="file" accept=".md,text/markdown,text/plain" />
        <button id="chooseSkillImportFileBtn" class="settings-action-btn subtle" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>${escapeHtml(t("skillsWorkbench.commands.chooseFile"))}</button>
      </div>
      ${renderSkillImportPreview()}
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.commands.createTitle"))}</div>
      <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.commands.createDescription"))}</div>
      <form id="skillCommandForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>${escapeHtml(t("skillsWorkbench.commands.nameLabel"))}<input id="skillCommandName" class="settings-field" placeholder="${escapeAttr(t("skillsWorkbench.commands.namePlaceholder"))}" /></label>
          <label>${escapeHtml(t("skillsWorkbench.commands.descriptionLabel"))}<input id="skillCommandDescription" class="settings-field" placeholder="${escapeAttr(t("skillsWorkbench.commands.descriptionPlaceholder"))}" /></label>
          <label class="settings-form-span-2">${escapeHtml(t("skillsWorkbench.commands.promptLabel"))}<textarea id="skillCommandPrompt" class="settings-field settings-textarea" rows="5" placeholder="${escapeAttr(t("skillsWorkbench.commands.promptPlaceholder"))}"></textarea></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit" ${state.serverSkillsSaving ? "disabled" : ""}>${escapeHtml(t("skillsWorkbench.commands.saveDisabled"))}</button></div>
      </form>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.commands.localFallbackTitle"))}</div>
      <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.commands.localFallbackDescription"))}</div>
    </section>
  `;
  }

  function renderSkillsPhaseBCommands(active) {
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    if (bucket.status === "idle") skillsPhaseB.load(context).catch(showError);
    const loading = bucket.status === "loading";
    const drawer = bucket.drawer;
    const revisions = drawer ? (bucket.revisions?.[drawer.skillId] || { items: [], status: "idle" }) : null;
    return `
      <section class="settings-provider-section highlighted skills-v2-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.commands.phaseBTitle"))}</div>
            <div class="settings-provider-meta">${escapeHtml(skillContextLabel(context))} · ${escapeHtml(t("skillsWorkbench.commands.snapshot", { sequence: String(bucket.snapshotSequence ?? "—") }))}</div>
          </div>
          <div class="skill-workbench-actions">
            ${setSkillContext ? `<select id="skillsV2ScopeSelect" class="settings-field skills-scope-select" aria-label="${escapeAttr(t("skillsWorkbench.commands.scopeAriaLabel"))}">${renderSkillScopeOptions(context.scope)}</select>` : ""}
            <button id="refreshSkillsV2Btn" class="settings-action-btn subtle" type="button" ${loading ? "disabled" : ""}>${loading ? t("skillsWorkbench.commands.statusLoading") : t("skillsWorkbench.commands.refresh")}</button>
          </div>
        </div>
        ${bucket.error ? `<div class="settings-inline-alert">${escapeHtml(bucket.error)}</div>` : ""}
        <div class="skill-command-list">
          ${loading && !bucket.items.length ? `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.commands.loadingSkills"))}</div>` : bucket.items.length ? bucket.items.map((skill) => renderPhaseBSkillCard(skill, context)).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.commands.scopeEmpty"))}</div>`}
        </div>
        ${bucket.nextCursor ? `<button id="loadMoreSkillsV2Btn" class="settings-action-btn subtle" type="button" ${bucket.status === "loading-more" ? "disabled" : ""}>${bucket.status === "loading-more" ? t("skillsWorkbench.commands.statusLoading") : t("skillsWorkbench.commands.loadMore")}</button>` : ""}
      </section>
      ${drawer ? renderSkillRevisionDrawer({ drawer, revisions, context }) : ""}
    `;
  }

  function skillVerdictLabel(verdict) {
    return {
      safe: t("skillsWorkbench.skills.verdictSafe"),
      review: t("skillsWorkbench.skills.verdictReview"),
      blocked: t("skillsWorkbench.skills.verdictBlocked"),
    }[String(verdict || "").toLowerCase()] || String(verdict || "");
  }

  function renderScanFindings(findings) {
    return findings.length
      ? `<ul class="skill-findings">${findings.map((finding) => `<li><strong>${escapeHtml(finding.code || "scan")}</strong>：${escapeHtml(finding.message || t("skillsWorkbench.skills.findingDefault"))}</li>`).join("")}</ul>`
      : `<div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.skills.noReviewFindings"))}</div>`;
  }

  function renderServerSkillCard(skill) {
    const verdict = String(skill.scanVerdict || "safe");
    const tone = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "muted";
    const detailsLoaded = Boolean(skill.detailLoaded && String(skill.prompt || "").trim());
    const findings = Array.isArray(skill.scanFindings) ? skill.scanFindings : [];
    const findingCount = Number.isFinite(Number(skill.findingCount)) ? Number(skill.findingCount) : findings.length;
    const canEnable = verdict !== "blocked";
    const findingsMarkup = detailsLoaded
      ? renderScanFindings(findings)
      : `<div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.skills.findingCount", { count: findingCount }))}</div>`;
    return `
    <div class="skill-command-card ${skill.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(skill.command)} <span class="settings-status-pill ${skill.enabled ? "ok" : "muted"}">${escapeHtml(skill.enabled ? t("skillsWorkbench.skills.enabled") : t("skillsWorkbench.skills.disabled"))}</span> <span class="settings-status-pill ${tone}">${escapeHtml(skillVerdictLabel(verdict))}</span></div>
        <div class="settings-provider-meta">${escapeHtml(skill.name || t("skillsWorkbench.skills.unnamed"))} · ${escapeHtml(skill.description || t("skillsWorkbench.skills.noDescription"))} · ${escapeHtml(t("skillsWorkbench.skills.source", { source: skillSourceLabel(skill.source) }))}</div>
        ${findingsMarkup}
        ${detailsLoaded ? `<pre class="skill-command-prompt">${escapeHtml(skill.prompt)}</pre>` : `<div class="settings-provider-meta">${skill.detailError ? escapeHtml(t("skillsWorkbench.skills.detailLoadFailed", { message: skill.detailError })) : escapeHtml(t("skillsWorkbench.skills.detailNotLoaded"))}</div>`}
      </div>
      <div class="settings-action-row">
        ${detailsLoaded ? "" : `<button class="settings-action-btn subtle" type="button" data-server-skill-detail="${escapeAttr(skill.id)}">${escapeHtml(t("skillsWorkbench.skills.loadDetail"))}</button>`}
        <button class="settings-action-btn subtle" type="button" data-server-skill-copy="${escapeAttr(skill.id)}">${escapeHtml(t("skillsWorkbench.skills.copy"))}</button>
        <button class="settings-action-btn subtle" type="button" data-server-skill-toggle="${escapeAttr(skill.id)}" ${!canEnable || state.serverSkillsSaving ? "disabled" : ""}>${escapeHtml(skill.enabled ? t("skillsWorkbench.skills.disabled") : canEnable ? t("skillsWorkbench.skills.enabled") : t("skillsWorkbench.skills.cannotEnable"))}</button>
        <button class="settings-action-btn danger" type="button" data-server-skill-delete="${escapeAttr(skill.id)}" ${state.serverSkillsSaving ? "disabled" : ""}>${escapeHtml(t("skillsWorkbench.skills.delete"))}</button>
      </div>
    </div>
  `;
  }

  function renderSkillImportPreview() {
    const preview = pendingSkillImportPreview;
    if (!preview) return "";
    const findings = Array.isArray(preview.scanFindings) ? preview.scanFindings : [];
    const verdict = String(preview.scanVerdict || "safe");
    const blocked = verdict === "blocked";
    return `
      <div class="skill-command-card ${blocked ? "disabled" : ""}">
        <div>
          <div class="skill-command-title">${escapeHtml(t("skillsWorkbench.skills.preview", { command: preview.command || "" }))}&nbsp;<span class="settings-status-pill ${blocked ? "muted" : verdict === "review" ? "warn" : "ok"}">${escapeHtml(skillVerdictLabel(verdict))}</span></div>
          <div class="settings-provider-meta">${escapeHtml(preview.name || "")} · ${escapeHtml(preview.description || "")}</div>
          ${renderScanFindings(findings)}
        </div>
        <div class="settings-action-row"><button id="confirmSkillImportBtn" class="settings-action-btn primary" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>${escapeHtml(t("skillsWorkbench.skills.importConfirm"))}</button></div>
      </div>
    `;
  }

  function skillSourceLabel(source) {
    return {
      manual: t("skillsWorkbench.skills.sourceManual"),
      local_migration: t("skillsWorkbench.skills.sourceMigration"),
      skill_md: t("skillsWorkbench.skills.sourceSkillMd"),
    }[String(source || "")] || t("skillsWorkbench.skills.sourceUnknown");
  }

  function renderLocalMCPTools(active) {
    const prefs = currentSkillsPreferences();
    const editingRegistryId = state.mcpRegistryEditingId || "";
    const editingRegistryServer = editingRegistryId ? state.mcpRegistryServers.find((server) => server.id === editingRegistryId) : null;
    const editingRegistryArgs = Array.isArray(editingRegistryServer?.args) ? editingRegistryServer.args.join(" ") : "";
    const registrySubmitting = editingRegistryId ? isMCPRegistryActionBusy(editingRegistryId, "update") : isMCPRegistryActionBusy("new", "create");
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.mcp.registryTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.mcp.registryDescription"))}</div>
        </div>
        <button id="refreshMCPRegistryBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t(state.mcpRegistryLoading ? "skillsWorkbench.mcp.refreshingRegistry" : "skillsWorkbench.mcp.refreshRegistry"))}</button>
      </div>
      ${renderMCPRegistryList()}
      <form id="mcpRegistryForm" class="skill-command-form" data-mcp-registry-editing="${escapeAttr(editingRegistryId)}">
        <div class="settings-provider-title">${escapeHtml(t(editingRegistryId ? "skillsWorkbench.mcp.editServer" : "skillsWorkbench.mcp.addServer"))}</div>
        ${editingRegistryId ? `<div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.mcp.editingDescription", { id: editingRegistryId }))}</div>` : ""}
        <div class="settings-provider-form-grid">
          <label>${escapeHtml(t("skillsWorkbench.mcp.nameLabel"))}<input id="mcpRegistryName" class="settings-field" value="${escapeAttr(editingRegistryServer?.name || "")}" placeholder="filesystem" /></label>
          <label>${escapeHtml(t("skillsWorkbench.mcp.enabledLabel"))}
            <select id="mcpRegistryEnabled" class="settings-field"><option value="true" ${editingRegistryServer?.enabled === false ? "" : "selected"}>enabled</option><option value="false" ${editingRegistryServer?.enabled === false ? "selected" : ""}>disabled</option></select>
          </label>
          <label>${escapeHtml(t("skillsWorkbench.mcp.commandLabel"))}<input id="mcpRegistryCommand" class="settings-field" value="${escapeAttr(editingRegistryServer?.command || "")}" placeholder="npx" /></label>
          <label>${escapeHtml(t("skillsWorkbench.mcp.argsLabel"))}<input id="mcpRegistryArgs" class="settings-field" value="${escapeAttr(editingRegistryArgs)}" placeholder="@modelcontextprotocol/server-filesystem ~/projects" /></label>
          <label class="settings-form-span-2">${escapeHtml(t("skillsWorkbench.mcp.cwdLabel"))}<input id="mcpRegistryCWD" class="settings-field" value="${escapeAttr(editingRegistryServer?.cwd || "")}" placeholder="${escapeAttr(t("skillsWorkbench.mcp.cwdPlaceholder"))}" /></label>
          <label class="settings-form-span-2">${escapeHtml(t("skillsWorkbench.mcp.envLabel"))}
            <textarea id="mcpRegistryEnv" class="settings-field settings-textarea" rows="3" placeholder='${escapeAttr(t("skillsWorkbench.mcp.envPlaceholder"))}'></textarea>
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          ${editingRegistryId ? `<button id="cancelMCPRegistryEditBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("skillsWorkbench.mcp.cancelEdit"))}</button>` : ""}
          <button class="settings-action-btn primary" type="submit" ${registrySubmitting ? "disabled" : ""}>${escapeHtml(t(registrySubmitting ? (editingRegistryId ? "skillsWorkbench.mcp.updating" : "skillsWorkbench.mcp.creating") : (editingRegistryId ? "skillsWorkbench.mcp.updateServer" : "skillsWorkbench.mcp.createServer")))}</button>
        </div>
      </form>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.mcp.localDraftTitle"))}</div>
      <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.mcp.localDraftDescription"))}</div>
      <div class="skill-command-list">
        ${prefs.mcpServers.length ? prefs.mcpServers.map(renderMCPServerCard).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.mcp.localDraftEmpty"))}</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.mcp.addDraftTitle"))}</div>
      <form id="mcpServerForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>${escapeHtml(t("skillsWorkbench.mcp.nameLabel"))}<input id="mcpServerName" class="settings-field" placeholder="filesystem" /></label>
          <label>${escapeHtml(t("skillsWorkbench.mcp.transportLabel"))}<select id="mcpServerTransport" class="settings-field"><option value="stdio">stdio</option><option value="sse">sse</option><option value="http">http</option></select></label>
          <label class="settings-form-span-2">${escapeHtml(t("skillsWorkbench.mcp.startCommandLabel"))}<input id="mcpServerCommand" class="settings-field" placeholder="${escapeAttr(t("skillsWorkbench.mcp.commandPlaceholder"))}" /></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit">${escapeHtml(t("skillsWorkbench.mcp.addDraft"))}</button></div>
      </form>
    </section>
  `;
  }

  function renderMCPServerCard(server) {
    return `
    <div class="skill-command-card ${server.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(server.name || t("skillsWorkbench.mcp.defaultName"))} <span class="settings-status-pill ${server.enabled ? "ok" : "muted"}">${escapeHtml(t(server.enabled ? "skillsWorkbench.mcp.draftEnabled" : "skillsWorkbench.mcp.draftDisabled"))}</span></div>
        <div class="settings-provider-meta">${escapeHtml(server.transport)} · ${escapeHtml(server.command || t("skillsWorkbench.mcp.commandMissing"))}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-mcp-register="${escapeAttr(server.id)}" ${isMCPRegistryActionBusy(server.id, "register") ? "disabled" : ""}>${escapeHtml(t(isMCPRegistryActionBusy(server.id, "register") ? "skillsWorkbench.mcp.saving" : "skillsWorkbench.mcp.saveToRegistry"))}</button>
        <button class="settings-action-btn subtle" type="button" data-mcp-toggle="${escapeAttr(server.id)}">${escapeHtml(t(server.enabled ? "skillsWorkbench.skills.disabled" : "skillsWorkbench.skills.enabled"))}</button>
        <button class="settings-action-btn danger" type="button" data-mcp-delete="${escapeAttr(server.id)}">${escapeHtml(t("skillsWorkbench.skills.delete"))}</button>
      </div>
    </div>
  `;
  }

  function renderLocalToolPolicy(active) {
    if (!state.workflowPreferences && !state.workflowLoading && !state.workflowError) {
      loadWorkflowPolicy?.().catch(showError);
    }
    const prefs = state.workflowPreferences || { requireConfirmationForExec: true, requireConfirmationForWrites: false, allowReadOnlyByDefault: true };
    const rules = Array.isArray(state.toolPermissionRules) ? state.toolPermissionRules : [];
    const loading = state.workflowLoading || state.toolPermissionRulesLoading;
    return `
    <p class="skills-description">${escapeHtml(active.description)} ${escapeHtml(t("skillsWorkbench.permissions.description"))}</p>
    <div class="skill-workbench-actions">
      <button id="refreshWorkflowPolicyBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t(loading ? "skillsWorkbench.commands.statusLoading" : "skillsWorkbench.permissions.refreshServer"))}</button>
    </div>
    ${state.workflowError || state.toolPermissionRulesError ? `<div class="settings-inline-alert">${escapeHtml(state.workflowError || state.toolPermissionRulesError)}</div>` : ""}
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.permissions.preferencesTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.permissions.preferencesDescription"))}</div>
        </div>
        <span class="settings-status-pill ${loading ? "warn" : "ok"}">${escapeHtml(t(loading ? "skillsWorkbench.commands.statusLoading" : "skillsWorkbench.permissions.connected"))}</span>
      </div>
      <div class="appearance-toggle-list">
        ${renderWorkflowPolicyToggle("requireConfirmationForExec", t("skillsWorkbench.permissions.confirmExecTitle"), t("skillsWorkbench.permissions.confirmExecDescription"), prefs.requireConfirmationForExec !== false)}
        ${renderWorkflowPolicyToggle("requireConfirmationForWrites", t("skillsWorkbench.permissions.confirmWritesTitle"), t("skillsWorkbench.permissions.confirmWritesDescription"), Boolean(prefs.requireConfirmationForWrites))}
        ${renderWorkflowPolicyToggle("allowReadOnlyByDefault", t("skillsWorkbench.permissions.allowReadOnlyTitle"), t("skillsWorkbench.permissions.allowReadOnlyDescription"), prefs.allowReadOnlyByDefault !== false)}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.permissions.rulesTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.permissions.rulesDescription"))}</div>
        </div>
      </div>
      <div class="skill-command-list workflow-rule-list">
        ${rules.length ? rules.map(renderToolPermissionRuleCard).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.permissions.rulesEmpty"))}</div>`}
      </div>
      <form id="toolPermissionRuleForm" class="skill-command-form workflow-rule-form">
        <div class="settings-provider-title">${escapeHtml(t("skillsWorkbench.permissions.addRule"))}</div>
        <div class="settings-provider-form-grid">
          <label>${escapeHtml(t("skillsWorkbench.permissions.modeLabel"))}<select id="toolPermissionMode" class="settings-field">${renderPermissionRuleOptions(["*", "readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk"], "acceptEdits")}</select></label>
          <label>${escapeHtml(t("skillsWorkbench.permissions.toolNameLabel"))}<input id="toolPermissionToolName" class="settings-field" value="Bash" placeholder="${escapeAttr(t("skillsWorkbench.permissions.toolNamePlaceholder"))}" /></label>
          <label>${escapeHtml(t("skillsWorkbench.permissions.riskLabel"))}<select id="toolPermissionRisk" class="settings-field">${renderPermissionRuleOptions(["read", "write", "exec", "danger", "*"], "exec")}</select></label>
          <label>${escapeHtml(t("skillsWorkbench.permissions.decisionLabel"))}<select id="toolPermissionDecision" class="settings-field">${renderPermissionRuleOptions(["ask", "deny", "allow"], "ask")}</select></label>
          <label>${escapeHtml(t("skillsWorkbench.permissions.priorityLabel"))}<input id="toolPermissionPriority" class="settings-field" type="number" value="10" /></label>
          <label class="settings-form-span-2">${escapeHtml(t("skillsWorkbench.permissions.descriptionLabel"))}<input id="toolPermissionDescription" class="settings-field" placeholder="${escapeAttr(t("skillsWorkbench.permissions.descriptionPlaceholder"))}" /></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit" ${state.toolPermissionRulesSaving ? "disabled" : ""}>${escapeHtml(t(state.toolPermissionRulesSaving ? "skillsWorkbench.mcp.saving" : "skillsWorkbench.permissions.addServerRule"))}</button></div>
      </form>
    </section>
  `;
  }

  function renderWorkflowPolicyToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row skill-policy-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-workflow-policy="${escapeAttr(field)}" ${checked ? "checked" : ""} ${state.workflowSaving ? "disabled" : ""} />
    </label>
  `;
  }

  function renderToolPermissionRuleCard(rule) {
    return `
    <div class="skill-command-card workflow-rule-card ${rule.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(rule.toolName || "*")} <span class="settings-status-pill ${rule.enabled ? "ok" : "muted"}">${escapeHtml(t(rule.enabled ? "skillsWorkbench.skills.enabled" : "skillsWorkbench.skills.disabled"))}</span></div>
        <div class="settings-provider-meta">${escapeHtml(t("skillsWorkbench.permissions.ruleMeta", { mode: rule.mode || "*", risk: rule.risk || "*", decision: rule.decision || "ask", priority: String(rule.priority || 0) }))}</div>
        ${rule.description ? `<div class="settings-provider-meta">${escapeHtml(rule.description)}</div>` : ""}
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-tool-permission-toggle="${escapeAttr(rule.id)}" ${state.toolPermissionRulesSaving ? "disabled" : ""}>${escapeHtml(t(rule.enabled ? "skillsWorkbench.skills.disabled" : "skillsWorkbench.skills.enabled"))}</button>
        <button class="settings-action-btn danger" type="button" data-tool-permission-delete="${escapeAttr(rule.id)}" ${state.toolPermissionRulesSaving ? "disabled" : ""}>${escapeHtml(t("skillsWorkbench.skills.delete"))}</button>
      </div>
    </div>
  `;
  }

  function renderPermissionRuleOptions(options, selected) {
    return options.map((option) => `<option value="${escapeAttr(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  }

  function renderSkillRoadmapPanel(active) {
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-roadmap-grid">
      ${renderSkillRoadmapCard(active.label, active.empty)}
      ${renderSkillRoadmapCard(t("skillsWorkbench.roadmap.serverTitle"), t("skillsWorkbench.roadmap.serverDescription"))}
      ${renderSkillRoadmapCard(t("skillsWorkbench.roadmap.boundaryTitle"), t("skillsWorkbench.roadmap.boundaryDescription"))}
    </div>
  `;
  }

  function renderSkillRoadmapCard(title, description) {
    return `<section class="skill-roadmap-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></section>`;
  }

  function bindSkillTabs(activeKey = "commands") {
    const body = $("settingsContentBody");
    body.querySelectorAll("[data-skill-tab]").forEach((node) => {
      node.addEventListener("click", () => {
        state.activeSkillTab = node.dataset.skillTab;
        body.innerHTML = renderSkillSettingsContent(node.dataset.skillTab);
        bindSkillTabs(node.dataset.skillTab);
      });
    });
    bindMCPRegistryActions(body);
    if (activeKey === "plugins") bindPluginRegistryActions?.(body);
    $("refreshServerSkillsBtn")?.addEventListener("click", () => loadServerSkills?.({ notify: true }).catch(showError));
    $("refreshSkillsV2Btn")?.addEventListener("click", () => skillsPhaseB?.load(getSkillContext?.() || { scope: "global" }).catch(showError));
    $("loadMoreSkillsV2Btn")?.addEventListener("click", () => skillsPhaseB?.loadMore(getSkillContext?.() || { scope: "global" }).catch(showError));
    $("skillsV2ScopeSelect")?.addEventListener("change", (event) => {
      const context = getSkillContext?.() || {};
      setSkillContext?.({ ...context, scope: event.target.value });
      rerenderSkillPanel();
    });
    body.querySelectorAll("[data-skill-v2-detail]").forEach((node) => node.addEventListener("click", () => skillsPhaseB?.loadDetail(node.dataset.skillV2Detail, getSkillContext?.() || { scope: "global" }).catch(showError)));
    body.querySelectorAll("[data-skill-v2-revisions]").forEach((node) => node.addEventListener("click", () => openSkillRevisionDrawer(node.dataset.skillV2Revisions).catch(showError)));
    body.querySelectorAll("[data-skill-v2-revision-detail]").forEach((node) => node.addEventListener("click", () => openSkillRevisionDetail(node.dataset.skillV2RevisionDetail, node.dataset.skillV2RevisionId).catch(showError)));
    body.querySelectorAll("[data-skill-v2-restore]").forEach((node) => node.addEventListener("click", () => restoreSkillRevisionFromDrawer(node.dataset.skillV2Restore, node.dataset.skillV2RevisionId).catch(showError)));
    $("closeSkillRevisionDrawerBtn")?.addEventListener("click", closeSkillRevisionDrawer);
    $("migrateLocalSkillsBtn")?.addEventListener("click", () => migrateLocalSkillTemplates().catch(showError));
    $("chooseSkillImportFileBtn")?.addEventListener("click", () => $("skillImportFile")?.click());
    $("skillImportFile")?.addEventListener("change", (event) => previewSelectedSkillFile(event).catch(showError));
    $("confirmSkillImportBtn")?.addEventListener("click", () => confirmSkillImport().catch(showError));
    $("skillCommandForm")?.addEventListener("submit", (event) => addSkillCommandFromPanel(event).catch(showError));
    $("mcpServerForm")?.addEventListener("submit", (event) => addMCPServerFromPanel(event).catch(showError));
    body.querySelectorAll("[data-server-skill-detail]").forEach((node) => node.addEventListener("click", () => loadServerSkillDetail?.(node.dataset.serverSkillDetail).catch(showError)));
    body.querySelectorAll("[data-server-skill-copy]").forEach((node) => node.addEventListener("click", () => copyServerSkillPrompt(node.dataset.serverSkillCopy).catch(showError)));
    body.querySelectorAll("[data-server-skill-toggle]").forEach((node) => node.addEventListener("click", () => toggleServerSkill(node.dataset.serverSkillToggle).catch(showError)));
    body.querySelectorAll("[data-server-skill-delete]").forEach((node) => node.addEventListener("click", () => deleteServerSkillFromPanel(node.dataset.serverSkillDelete).catch(showError)));
    body.querySelectorAll("[data-mcp-toggle]").forEach((node) => node.addEventListener("click", () => toggleMCPServer(node.dataset.mcpToggle)));
    body.querySelectorAll("[data-mcp-delete]").forEach((node) => node.addEventListener("click", () => deleteMCPServer(node.dataset.mcpDelete)));
    $("refreshWorkflowPolicyBtn")?.addEventListener("click", () => loadWorkflowPolicy?.({ notify: true }).catch(showError));
    $("toolPermissionRuleForm")?.addEventListener("submit", (event) => addToolPermissionRuleFromPanel(event).catch(showError));
    body.querySelectorAll("[data-workflow-policy]").forEach((node) => node.addEventListener("change", () => saveWorkflowPreferencesFromPanel().catch(showError)));
    body.querySelectorAll("[data-tool-permission-toggle]").forEach((node) => node.addEventListener("click", () => toggleToolPermissionRule(node.dataset.toolPermissionToggle).catch(showError)));
    body.querySelectorAll("[data-tool-permission-delete]").forEach((node) => node.addEventListener("click", () => deleteToolPermissionRuleFromPanel(node.dataset.toolPermissionDelete).catch(showError)));
  }

  async function saveWorkflowPreferencesFromPanel() {
    const payload = {
      requireConfirmationForExec: Boolean(document.querySelector('[data-workflow-policy="requireConfirmationForExec"]')?.checked),
      requireConfirmationForWrites: Boolean(document.querySelector('[data-workflow-policy="requireConfirmationForWrites"]')?.checked),
      allowReadOnlyByDefault: Boolean(document.querySelector('[data-workflow-policy="allowReadOnlyByDefault"]')?.checked),
    };
    await saveWorkflowPreferences?.(payload);
    notifyTerminal?.(`[info] ${t("skillsWorkbench.toast.workflowSaved")}\n`);
  }

  async function addToolPermissionRuleFromPanel(event) {
    event.preventDefault();
    const payload = {
      mode: $("toolPermissionMode")?.value || "*",
      toolName: $("toolPermissionToolName")?.value || "*",
      risk: $("toolPermissionRisk")?.value || "exec",
      decision: $("toolPermissionDecision")?.value || "ask",
      priority: Number($("toolPermissionPriority")?.value || 0),
      enabled: true,
      description: $("toolPermissionDescription")?.value || "",
    };
    await createToolPermissionRule?.(payload);
    notifyTerminal?.(`[info] ${t("skillsWorkbench.toast.ruleAdded", payload)}\n`);
  }

  async function toggleToolPermissionRule(id) {
    const rule = (state.toolPermissionRules || []).find((item) => item.id === id);
    if (!rule) return;
    await updateToolPermissionRule?.(id, { enabled: !rule.enabled });
  }

  async function deleteToolPermissionRuleFromPanel(id) {
    if (!id) return;
    const ok = window.confirm(t("skillsWorkbench.confirmation.deleteRule"));
    if (!ok) return;
    await deleteToolPermissionRule?.(id);
  }

  function rerenderSkillPanel() {
    const body = $("settingsContentBody");
    if (!body || state.activeSettingsPanel !== "skills") return;
    body.innerHTML = renderSkillSettingsContent(state.activeSkillTab || "commands");
    bindSkillTabs(state.activeSkillTab || "commands");
  }

  async function openSkillRevisionDrawer(skillId) {
    if (!skillsPhaseB) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    bucket.drawer = { skillId, selectedRevision: null, revisionDetail: null, revisionDetailError: "" };
    rerenderSkillPanel();
    await skillsPhaseB.loadRevisions(skillId, context);
  }

  async function openSkillRevisionDetail(skillId, revisionId) {
    if (!skillsPhaseB) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    if (!bucket.drawer || bucket.drawer.skillId !== skillId) return;
    try {
      bucket.drawer.revisionDetail = await skillsPhaseB.loadRevisionDetail(skillId, revisionId, context);
      bucket.drawer.selectedRevision = revisionId;
      bucket.drawer.revisionDetailError = "";
    } catch (error) {
      bucket.drawer.revisionDetail = null;
      bucket.drawer.revisionDetailError = error?.message || String(error);
      throw error;
    } finally {
      rerenderSkillPanel();
    }
  }

  async function restoreSkillRevisionFromDrawer(skillId, revisionNo) {
    if (!skillsPhaseB || !window.confirm(t("skillsWorkbench.confirmation.restoreRevision"))) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    const revisions = bucket.revisions?.[skillId]?.items || [];
    const revision = revisions.find((item) => String(item.revisionNo ?? item.revision) === String(revisionNo));
    if (!revision) throw new Error(t("skillsWorkbench.errors.revisionMissing"));
    const current = bucket.items.find((item) => item.id === skillId);
    const restored = await restoreRevisionWithCurrentRiskConfirmation(
      ({ acknowledgeRisk, acknowledgedContentHash }) => skillsPhaseB.restoreRevision(skillId, revision, context, {
        expectedUpdatedAt: current?.updatedAt,
        acknowledgeRisk,
        acknowledgedContentHash,
      }),
      (message) => window.confirm(message),
    );
    if (restored) rerenderSkillPanel();
  }

  function closeSkillRevisionDrawer() {
    if (!skillsPhaseB) return;
    const bucket = skillsPhaseB.ensureContext(getSkillContext?.() || { scope: "global" });
    bucket.drawer = null;
    rerenderSkillPanel();
  }

  async function previewSelectedSkillFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    if (file.size > 128 * 1024) throw new Error(t("skillsWorkbench.errors.fileTooLarge"));
    pendingSkillImportContent = await file.text();
    pendingSkillImportPreview = await previewServerSkillImport?.(pendingSkillImportContent);
    if (!pendingSkillImportPreview) throw new Error(t("skillsWorkbench.errors.previewFailed"));
    rerenderSkillPanel();
  }

  async function confirmSkillImport() {
    if (!pendingSkillImportContent || !pendingSkillImportPreview) throw new Error(t("skillsWorkbench.errors.selectAndPreview"));
    const verdict = pendingSkillImportPreview.scanVerdict || "safe";
    const command = pendingSkillImportPreview.command || t("skillsWorkbench.skills.unnamed");
    const confirmed = window.confirm(t("skillsWorkbench.confirmation.importSkill", { command, verdict }));
    if (!confirmed) return;
    await importServerSkill?.(pendingSkillImportContent);
    notifyTerminal?.(`[info] ${t("skillsWorkbench.toast.importComplete", { command: pendingSkillImportPreview.command || "skill" })}\n`);
    pendingSkillImportContent = "";
    pendingSkillImportPreview = null;
    rerenderSkillPanel();
  }

  async function addSkillCommandFromPanel(event) {
    event.preventDefault();
    const payload = {
      name: $("skillCommandName")?.value || "",
      command: $("skillCommandName")?.value || "",
      description: $("skillCommandDescription")?.value || "",
      prompt: $("skillCommandPrompt")?.value || "",
      enabled: false,
      source: "manual",
    };
    if (!String(payload.command).trim() || !String(payload.prompt).trim()) throw new Error(t("skillsWorkbench.errors.commandAndPromptRequired"));
    const created = await createServerSkill?.(payload);
    notifyTerminal?.(`[info] ${t("skillsWorkbench.toast.skillSaved", { command: created?.command || payload.command })}\n`);
  }

  async function toggleServerSkill(id) {
    const skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill) return;
    if (skill.enabled) {
      await updateServerSkill?.(id, { enabled: false });
      return;
    }
    if (skill.scanVerdict === "blocked") {
      throw new Error(t("skillsWorkbench.errors.skillBlocked"));
    }
    let acknowledgeRisk = false;
    if (skill.scanVerdict === "review") {
      acknowledgeRisk = window.confirm(t("skillsWorkbench.confirmation.enableReview"));
      if (!acknowledgeRisk) return;
    }
    await updateServerSkill?.(id, { enabled: true, acknowledgeRisk });
  }

  async function deleteServerSkillFromPanel(id) {
    const skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill || !window.confirm(t("skillsWorkbench.confirmation.deleteSkill", { command: skill.command }))) return;
    await deleteServerSkill?.(id);
  }

  async function copyServerSkillPrompt(id) {
    let skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill) throw new Error(t("skillsWorkbench.errors.skillNotFound"));
    if (!skill.detailLoaded || !String(skill.prompt || "").trim()) skill = await loadServerSkillDetail?.(id);
    if (!String(skill?.prompt || "").trim()) throw new Error(t("skillsWorkbench.errors.detailUnavailable"));
    await copyText(skill.prompt);
  }

  async function migrateLocalSkillTemplates() {
    if (state.serverSkillsStatus !== "ready" && state.serverSkillsStatus !== "stale") await loadServerSkills?.();
    const localCommands = currentSkillsPreferences().commands || [];
    const seen = new Set((state.serverSkills || [])
      .map((item) => normalizeSlashCommandName(item?.command))
      .filter(Boolean));
    let created = 0;
    let skipped = 0;
    let conflict = 0;
    for (const template of localCommands) {
      const name = String(template?.name || "").trim();
      const normalizedCommand = normalizeSlashCommandName(name);
      const prompt = String(template?.prompt || "").trim();
      if (!name || !normalizedCommand || !prompt) {
        skipped += 1;
        continue;
      }
      if (seen.has(normalizedCommand)) {
        skipped += 1;
        continue;
      }
      try {
        const saved = await createServerSkill?.({
          name,
          command: normalizedCommand,
          description: String(template.description || ""),
          prompt,
          source: "local_migration",
          enabled: false,
        }, { silent: true });
        seen.add(normalizeSlashCommandName(saved?.command || normalizedCommand));
        created += 1;
      } catch (err) {
        if (String(err?.message || err).toLowerCase().includes("exists")) conflict += 1;
        else conflict += 1;
      }
    }
    localMigrationSummary = t("skillsWorkbench.toast.migrationComplete", { created, skipped, conflict });
    notifyTerminal?.(`[info] ${localMigrationSummary}\n`);
    rerenderSkillPanel();
  }

  async function addMCPServerFromPanel(event) {
    event.preventDefault();
    const server = normalizeMCPServer({
      id: localSkillID("mcp"),
      name: $("mcpServerName")?.value || "",
      transport: $("mcpServerTransport")?.value || "stdio",
      command: $("mcpServerCommand")?.value || "",
      enabled: false,
    });
    if (!server.name || !server.command) throw new Error(t("skillsWorkbench.errors.mcpRequired"));
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, mcpServers: [server, ...prefs.mcpServers] }, { notify: true });
    notifyTerminal(`[info] ${t("skillsWorkbench.toast.mcpDraftAdded", { name: server.name })}\n`);
  }

  function toggleMCPServer(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({
      ...prefs,
      mcpServers: prefs.mcpServers.map((server) => server.id === id ? { ...server, enabled: !server.enabled } : server),
    }, { notify: true });
  }

  function deleteMCPServer(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, mcpServers: prefs.mcpServers.filter((server) => server.id !== id) }, { notify: true });
  }

  function setSkillPolicy(field, value) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({
      ...prefs,
      toolPolicy: { ...prefs.toolPolicy, [field]: Boolean(value) },
    }, { notify: true });
  }

  return {
    bindSkillTabs,
    renderSkillSettingsContent,
  };
}

export function skillContextLabel(context = {}) {
  const scope = String(context.scope || "global").toLowerCase();
  if (scope === "project") return t("skillsWorkbench.scope.project", { suffix: context.projectId ? ` · ${context.projectId}` : "" });
  if (scope === "workspace") return t("skillsWorkbench.scope.workspace", { suffix: context.worklineId ? ` · ${context.worklineId}` : "" });
  return t("skillsWorkbench.scope.global");
}

export function skillScopeShadowHint(skill, activeContext = {}) {
  const ownerScope = String(skill?.scope || skill?.ownerScope || "global").toLowerCase();
  const activeScope = String(activeContext?.scope || "global").toLowerCase();
  if (skill?.shadowedBy || skill?.shadowed) return t("skillsWorkbench.scope.shadowed");
  if (ownerScope !== activeScope) return t("skillsWorkbench.scope.owner", { scope: skillContextLabel({ scope: ownerScope, projectId: skill?.projectId, worklineId: skill?.worklineId }) });
  return t("skillsWorkbench.scope.currentOwner");
}

export function renderSkillScopeBadge(skill) {
  const scope = String(skill?.scope || skill?.ownerScope || "global").toLowerCase();
  const label = scope === "project" ? t("skillsWorkbench.scope.projectBadge") : scope === "workspace" ? t("skillsWorkbench.scope.workspaceBadge") : t("skillsWorkbench.scope.globalBadge");
  return `<span class="skill-scope-badge skill-scope-${escapeAttr(scope)}">${escapeHtml(label)}</span>`;
}

function renderSkillScopeOptions(selected) {
  return ["global", "project", "workspace"].map((scope) => `<option value="${scope}" ${scope === selected ? "selected" : ""}>${escapeHtml(skillContextLabel({ scope }))}</option>`).join("");
}

function renderPhaseBSkillCard(skill, context) {
  const verdict = String(skill.scanVerdict || "safe").toLowerCase();
  const tone = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "muted";
  const detailLoaded = Boolean(skill.detailLoaded && String(skill.prompt || "").trim());
  return `
    <div class="skill-command-card skills-v2-card ${skill.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(skill.command || skill.name || t("skillsWorkbench.skills.unnamedCommand"))} ${renderSkillScopeBadge(skill)} <span class="settings-status-pill ${tone}">${escapeHtml({ safe: t("skillsWorkbench.skills.verdictSafe"), review: t("skillsWorkbench.skills.verdictReview"), blocked: t("skillsWorkbench.skills.verdictBlocked") }[verdict] || verdict)}</span></div>
        <div class="settings-provider-meta">${escapeHtml(skill.description || t("skillsWorkbench.skills.noDescription"))} · ${escapeHtml(skillScopeShadowHint(skill, context))}</div>
        ${detailLoaded ? `<pre class="skill-command-prompt">${escapeHtml(skill.prompt)}</pre>` : skill.detailError ? `<div class="settings-inline-alert">${escapeHtml(t("skillsWorkbench.skills.localFallbackBlocked", { message: skill.detailError }))}</div>` : ""}
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-skill-v2-detail="${escapeAttr(skill.id)}">${escapeHtml(t(detailLoaded ? "skillsWorkbench.skills.refreshDetail" : "skillsWorkbench.skills.loadDetail"))}</button>
        <button class="settings-action-btn subtle" type="button" data-skill-v2-revisions="${escapeAttr(skill.id)}">${escapeHtml(t("skillsWorkbench.revisions.title"))}</button>
      </div>
    </div>
  `;
}

export function renderSkillRevisionDrawer({ drawer, revisions = {}, context = {} } = {}) {
  const items = Array.isArray(revisions.items) ? revisions.items : [];
  const selected = drawer?.revisionDetail;
  return `
    <aside class="skill-revision-drawer" aria-label="${escapeAttr(t("skillsWorkbench.revisions.ariaLabel"))}">
      <div class="skill-revision-drawer-head"><div><strong>${escapeHtml(t("skillsWorkbench.revisions.title"))}</strong><small>${escapeHtml(skillContextLabel(context))}</small></div><button id="closeSkillRevisionDrawerBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("skillsWorkbench.revisions.close"))}</button></div>
      ${revisions.error ? `<div class="settings-inline-alert">${escapeHtml(revisions.error)}</div>` : ""}
      <div class="skill-revision-list">
        ${revisions.status === "loading" && !items.length ? `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.revisions.loading"))}</div>` : items.length ? items.map((revision) => {
          const revisionNo = String(revision.revisionNo ?? revision.revision ?? "");
          return `<div class="skill-revision-card ${String(drawer?.selectedRevision || "") === revisionNo ? "selected" : ""}"><div><strong>${escapeHtml(revision.label || t("skillsWorkbench.revisions.label", { revision: revisionNo }))}</strong><small>${escapeHtml(revision.createdAt || revision.updatedAt || "")}</small></div><div class="settings-action-row"><button class="settings-action-btn subtle" type="button" data-skill-v2-revision-detail="${escapeAttr(drawer?.skillId)}" data-skill-v2-revision-id="${escapeAttr(revisionNo)}">${escapeHtml(t("skillsWorkbench.revisions.view"))}</button><button class="settings-action-btn danger" type="button" data-skill-v2-restore="${escapeAttr(drawer?.skillId)}" data-skill-v2-revision-id="${escapeAttr(revisionNo)}">${escapeHtml(t("skillsWorkbench.revisions.restore"))}</button></div></div>`;
        }).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("skillsWorkbench.revisions.empty"))}</div>`}
      </div>
      ${selected ? `<pre class="skill-command-prompt skill-revision-detail">${escapeHtml(selected.prompt || selected.content || JSON.stringify(selected, null, 2))}</pre>` : drawer?.revisionDetailError ? `<div class="settings-inline-alert">${escapeHtml(drawer.revisionDetailError)}</div>` : ""}
    </aside>
  `;
}
