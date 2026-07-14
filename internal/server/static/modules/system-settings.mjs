import { $, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatBytes, formatDuration, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";
import { currentUILocale, t as baseT } from "./i18n.mjs";
import systemSettingsMessages from "./messages-system-settings.mjs";
import { localPreferenceBackupVersion } from "./preferences-data.mjs";
import { api } from "./runtime.mjs";

function lookupMessage(catalog, key) {
  return String(key || "").split(".").reduce((value, part) => (
    value && typeof value === "object" ? value[part] : undefined
  ), catalog);
}

function interpolateMessage(message, params = {}) {
  return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : match
  ));
}

function t(key, params = {}) {
  const locale = currentUILocale();
  const message = lookupMessage(systemSettingsMessages[locale], key)
    ?? lookupMessage(systemSettingsMessages["zh-CN"], key);
  return message === undefined ? baseT(key, params) : interpolateMessage(message, params);
}

export function createSystemSettingsController({
  state,
  copyText,
  loadAuthStatus,
  loadLicenseSummary,
  loadRuntimeSummary,
  loadStorageSummary,
  loadUpdateStatus,
  loadUsageSummary,
  localPreferencesBackupSummary,
  localPreferencesBackupText,
  notifyTerminal,
  refreshActiveSettingsPanel,
  restoreLocalPreferencesBackup,
  showError,
  showToast,
} = {}) {
  function renderServerSystemSettingsContent() {
    const summary = state.runtimeSummary;
    const server = summary?.server || {};
    const process = summary?.process || {};
    const go = summary?.go || {};
    const address = server.address || `${state.settings?.server?.host || "localhost"}:${state.settings?.server?.port || "7788"}`;
    return `
    <div class="settings-live-page runtime-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(t("systemSettings.serverSystem.kicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(address)}</div>
          <p>${escapeHtml(t("systemSettings.serverSystem.description"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.serverSystem.refresh"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(summary?.version || state.settings?.version || "0.1.0-dev")}</strong><span>${escapeHtml(t("systemSettings.serverSystem.version"))}</span></div>
        <div><strong>${escapeHtml(process.pid ? `#${process.pid}` : t("systemSettings.serverSystem.unavailable"))}</strong><span>${escapeHtml(t("systemSettings.serverSystem.processId"))}</span></div>
        <div><strong>${escapeHtml(go.version || t("systemSettings.serverSystem.notLoaded"))}</strong><span>${escapeHtml(t("systemSettings.serverSystem.goVersion"))}</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderServerSystemSummary(summary) : `<div class="settings-empty-card">${escapeHtml(t("systemSettings.serverSystem.loading"))}</div>`}
    </div>
  `;
  }

  function renderServerSystemSummary(summary) {
    const server = summary.server || {};
    const process = summary.process || {};
    const go = summary.go || {};
    const providers = summary.providers || {};
    const backends = summary.backends || {};
    const security = summary.security || {};
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(t("systemSettings.serverSystem.listenAddress"), server.address || t("systemSettings.serverSystem.notConfigured"), t("systemSettings.serverSystem.description"))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.accessMode"), security.remoteAccessRequired ? t("systemSettings.serverSystem.tunnelHardened") : t("systemSettings.serverSystem.local"), security.message || t("systemSettings.serverSystem.securityFallback"))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.autoExecution"), security.bypassPermissionsAllowed ? t("systemSettings.serverSystem.allowed") : t("systemSettings.serverSystem.disabled"), t("systemSettings.serverSystem.permissionCap", { mode: security.maxPermissionMode || "bypassPermissions" }))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.remoteTerminal"), security.remoteTerminalAllowed ? t("systemSettings.serverSystem.allowed") : t("systemSettings.serverSystem.disabled"), "AUTOTO_REMOTE_TERMINAL")}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.accessPassword"), security.accessPasswordConfigured ? t("systemSettings.serverSystem.configured") : t("systemSettings.serverSystem.notConfigured"), "AUTOTO_ACCESS_PASSWORD")}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.uptime"), formatUptime(process.uptimeSeconds || 0), t("systemSettings.serverSystem.startedAt", { timestamp: formatTimestamp(process.startedAt) }))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.cpu"), go.cpus || 0, `${go.os || t("systemSettings.serverSystem.unknown")}/${go.arch || t("systemSettings.serverSystem.unknown")}`)}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.provider"), providers.total || 0, t("systemSettings.serverSystem.providersConfigured", { count: formatNumber(providers.configured || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.backendSeeds"), backends.configured || 0, t("systemSettings.serverSystem.backendsActive", { count: formatNumber(backends.active || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.serverSystem.generatedAt"), formatTimestamp(summary.generatedAt), t("systemSettings.serverSystem.resampleHint"))}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.serverSystem.serviceConfig"))}</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue(t("systemSettings.serverSystem.host"), server.host || "localhost")}
          ${renderRuntimeKeyValue(t("systemSettings.serverSystem.port"), server.port || 7788)}
          ${renderRuntimeKeyValue(t("systemSettings.serverSystem.config"), server.configPath || t("systemSettings.serverSystem.notConfigured"))}
          ${renderRuntimeKeyValue(t("systemSettings.serverSystem.executable"), process.executable || t("systemSettings.serverSystem.unknown"))}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.serverSystem.localPaths"))}</div>
        <div class="runtime-kv-list">
          ${(summary.paths || []).map((entry) => renderRuntimeKeyValue(entry.label || entry.key, entry.path || t("systemSettings.serverSystem.notConfigured"))).join("")}
        </div>
      </section>
    </div>
  `;
  }

  function renderRuntimeSettingsContent() {
    const summary = state.runtimeSummary;
    const memory = summary?.memory || {};
    const go = summary?.go || {};
    return `
    <div class="settings-live-page runtime-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(t("systemSettings.runtimeResources.kicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(formatBytes(memory.allocBytes || 0))} · ${escapeHtml(t("systemSettings.runtimeResources.goroutinesValue", { count: formatNumber(go.goroutines || 0) }))}</div>
          <p>${escapeHtml(t("systemSettings.runtimeResources.description"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.runtimeResources.refresh"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(memory.sysBytes || 0))}</strong><span>${escapeHtml(t("systemSettings.runtimeResources.sysMemory"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(go.goroutines || 0))}</strong><span>${escapeHtml(t("systemSettings.runtimeResources.goroutines"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(memory.gcCycles || 0))}</strong><span>${escapeHtml(t("systemSettings.runtimeResources.gcCycles"))}</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderRuntimeResourceSummary(summary) : `<div class="settings-empty-card">${escapeHtml(t("systemSettings.runtimeResources.loading"))}</div>`}
    </div>
  `;
  }

  function renderRuntimeResourceSummary(summary) {
    const memory = summary.memory || {};
    const go = summary.go || {};
    const agent = summary.agent || {};
    const security = summary.security || {};
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.currentAlloc"), formatBytes(memory.allocBytes || 0), t("systemSettings.runtimeResources.heapObjectsHint"))}
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.heapInUse"), formatBytes(memory.heapInuseBytes || 0), t("systemSettings.runtimeResources.heapAllocHint", { size: formatBytes(memory.heapAllocBytes || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.stackInUse"), formatBytes(memory.stackInuseBytes || 0), t("systemSettings.runtimeResources.stackHint"))}
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.nextGc"), formatBytes(memory.nextGcBytes || 0), t("systemSettings.runtimeResources.gcTimes", { count: formatNumber(memory.gcCycles || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.goroutines"), go.goroutines || 0, t("systemSettings.runtimeResources.cpusAvailable", { count: formatNumber(go.cpus || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.runtimeResources.totalAlloc"), formatBytes(memory.totalAllocBytes || 0), t("systemSettings.runtimeResources.sinceStart"))}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.runtimeResources.agentDefaults"))}</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.defaultModel"), agent.defaultModel || t("systemSettings.runtimeResources.notConfigured"))}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.summaryModel"), agent.summaryModel || t("systemSettings.runtimeResources.notConfigured"))}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.defaultPermission"), agent.defaultPermissionMode || "acceptEdits")}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.currentPermissionCap"), security.maxPermissionMode || "bypassPermissions")}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.defaultPlanMode"), agent.defaultStartInPlanMode ? t("systemSettings.runtimeResources.enabled") : t("systemSettings.runtimeResources.disabled"))}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.runtimeResources.runLimits"))}</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.maxTurns"), formatNumber(agent.maxTurns || 0))}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.firstTokenTimeout"), formatDuration(agent.firstTokenTimeoutMs || 0))}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.transientRetries"), formatNumber(agent.maxTransientRetries || 0))}
          ${renderRuntimeKeyValue(t("systemSettings.runtimeResources.sampleTime"), formatTimestamp(summary.generatedAt))}
        </div>
      </section>
    </div>
  `;
  }

  function renderRuntimeKeyValue(label, value) {
    return `
    <div class="runtime-kv-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? ""))}</strong>
    </div>
  `;
  }

  function bindRuntimeSettingsActions() {
    $("refreshRuntimeSummaryBtn")?.addEventListener("click", () => loadRuntimeSummary({ notify: true }).catch(showError));
    if (!state.runtimeSummary && !state.runtimeError) {
      loadRuntimeSummary().catch(showError);
    }
  }

  function formatUptime(seconds) {
    const value = Number(seconds || 0);
    if (!Number.isFinite(value) || value <= 0) return t("systemSettings.serverSystem.uptimeSeconds", { seconds: 0 });
    if (value < 60) return t("systemSettings.serverSystem.uptimeSeconds", { seconds: Math.round(value) });
    if (value < 3600) return t("systemSettings.serverSystem.uptimeMinutes", {
      minutes: Math.floor(value / 60),
      seconds: Math.round(value % 60),
    });
    return t("systemSettings.serverSystem.uptimeHours", {
      hours: Math.floor(value / 3600),
      minutes: Math.floor((value % 3600) / 60),
    });
  }
  function aboutUpdatePresentation() {
    const status = state.updateStatus;
    const currentVersion = status?.currentVersion || state.settings?.version || "0.1.0-dev";
    if (state.updateError) {
      return { currentVersion, latestVersion: "—", label: t("systemSettings.about.checkFailed"), tone: "error" };
    }
    if (!status) {
      return { currentVersion, latestVersion: "—", label: t("systemSettings.about.notChecked"), tone: "idle" };
    }
    if (status.status === "update_available") {
      return { currentVersion, latestVersion: status.targetVersion || "—", label: t("systemSettings.about.updateAvailable"), tone: "available" };
    }
    if (status.status === "up_to_date") {
      return { currentVersion, latestVersion: status.targetVersion || currentVersion, label: t("systemSettings.about.upToDate"), tone: "current" };
    }
    if (status.status === "development_build") {
      return { currentVersion, latestVersion: "—", label: t("systemSettings.about.developmentBuild"), tone: "idle" };
    }
    return { currentVersion, latestVersion: status.targetVersion || "—", label: t("systemSettings.about.unavailable"), tone: "idle" };
  }

  function renderAboutSettingsContent() {
    const summary = state.licenseSummary;
    const modules = Array.isArray(summary?.modules) ? summary.modules : [];
    const directCount = modules.filter((module) => module.relation === "direct").length;
    const unknownCount = modules.filter((module) => !module.license || module.license === "unknown").length;
    const update = aboutUpdatePresentation();
    return `
    <div class="settings-live-page about-page legacy-about-page">
      <section class="legacy-about-overview" aria-labelledby="legacyAboutProductName">
        <div class="legacy-about-brand">
          <span class="legacy-about-logo" aria-hidden="true">
            <svg viewBox="0 0 96 96" focusable="false">
              <circle cx="48" cy="48" r="41"></circle>
              <path d="M29 55c5 9 12 14 19 14s15-5 20-14"></path>
            </svg>
          </span>
          <div>
            <h2 id="legacyAboutProductName">AutoTo</h2>
            <p>${escapeHtml(t("systemSettings.about.productTagline"))}</p>
          </div>
        </div>
        <div class="legacy-about-version-table" aria-label="${escapeHtml(t("systemSettings.about.versionInfo"))}">
          <div class="legacy-about-version-row">
            <span>${escapeHtml(t("systemSettings.about.currentVersion"))}</span>
            <strong>${escapeHtml(update.currentVersion)}</strong>
          </div>
          <div class="legacy-about-version-row">
            <span>${escapeHtml(t("systemSettings.about.latestVersion"))}</span>
            <strong>${escapeHtml(update.latestVersion)}</strong>
          </div>
          <div class="legacy-about-version-row">
            <span>${escapeHtml(t("systemSettings.about.updateStatus"))}</span>
            <strong class="legacy-about-update-state ${escapeHtml(update.tone)}">${escapeHtml(update.label)}</strong>
          </div>
        </div>
        <button id="checkForUpdatesBtn" class="legacy-about-update-button" type="button">${escapeHtml(t("systemSettings.about.checkUpdates"))}</button>
        <p class="legacy-about-update-note">${escapeHtml(t("systemSettings.about.updateNote"))}</p>
        ${state.updateError ? `<div class="settings-inline-alert legacy-about-update-error">${escapeHtml(state.updateError)}</div>` : ""}
      </section>
      <details class="legacy-about-more">
        <summary>${escapeHtml(t("systemSettings.about.advanced"))}</summary>
        <div class="legacy-about-more-content">
          ${renderLocalPreferencesBackupSection()}
          <section class="settings-provider-section legacy-about-license-section">
            <div class="settings-provider-section-head">
              <div>
                <div class="settings-provider-title">${escapeHtml(t("systemSettings.license.openSourceTitle"))}</div>
                <div class="settings-provider-meta">${escapeHtml(t("systemSettings.license.openSourceMeta"))}</div>
              </div>
              <button id="refreshLicensesBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.license.refresh"))}</button>
            </div>
            <div class="settings-status-strip">
              <div><strong>${escapeHtml(formatNumber(modules.length))}</strong><span>${escapeHtml(t("systemSettings.license.modules"))}</span></div>
              <div><strong>${escapeHtml(formatNumber(directCount))}</strong><span>${escapeHtml(t("systemSettings.license.direct"))}</span></div>
              <div><strong>${escapeHtml(formatNumber(unknownCount))}</strong><span>${escapeHtml(t("systemSettings.license.unknownCount"))}</span></div>
            </div>
          </section>
          ${state.licenseError ? `<div class="settings-inline-alert">${escapeHtml(state.licenseError)}</div>` : ""}
          ${summary ? renderLicenseSummary(summary) : `<div class="settings-empty-card">${escapeHtml(t("systemSettings.license.loading"))}</div>`}
        </div>
      </details>
    </div>
  `;
  }

  function renderLocalPreferencesBackupSection() {
    const summary = localPreferencesBackupSummary();
    const labels = summary.labels.length ? summary.labels : [t("systemSettings.localBackup.emptyLabels")];
    return `
    <section class="settings-provider-section settings-backup-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("systemSettings.localBackup.title"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("systemSettings.localBackup.meta"))}</div>
        </div>
        <div class="settings-action-row compact-actions">
          <button id="copyLocalPrefsBackupBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("systemSettings.localBackup.copy"))}</button>
          <button id="downloadLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.localBackup.download"))}</button>
        </div>
      </div>
      <div class="settings-backup-stats">
        <div><strong>${escapeHtml(formatNumber(summary.count))}</strong><span>${escapeHtml(t("systemSettings.localBackup.savedCount"))}</span></div>
        <div><strong>${escapeHtml(formatBytes(summary.bytes))}</strong><span>${escapeHtml(t("systemSettings.localBackup.estimatedSize"))}</span></div>
        <div><strong>${escapeHtml(String(localPreferenceBackupVersion))}</strong><span>${escapeHtml(t("systemSettings.localBackup.formatVersion"))}</span></div>
      </div>
      <div class="settings-backup-key-list">
        ${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="settings-inline-success">${escapeHtml(t("systemSettings.localBackup.safetyNote"))}</div>
      <textarea id="localPrefsImportText" class="settings-token-input settings-backup-import" placeholder="${escapeHtml(t("systemSettings.localBackup.importPlaceholder"))}"></textarea>
      <div class="settings-action-row settings-form-actions">
        <button id="clearLocalPrefsImportBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("systemSettings.localBackup.clearInput"))}</button>
        <button id="importLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.localBackup.import"))}</button>
      </div>
    </section>
  `;
  }

  function renderLicenseSummary(summary) {
    const modules = Array.isArray(summary.modules) ? summary.modules : [];
    const grouped = groupLicenseModules(modules);
    return `
    <section class="settings-info-card">
      <div class="settings-info-title">${escapeHtml(t("systemSettings.license.complianceTitle"))}</div>
      <div class="settings-info-text">${escapeHtml(summary.notice || t("systemSettings.license.defaultNotice"))}</div>
    </section>
    <div class="license-group-grid">
      ${Object.entries(grouped).map(([license, items]) => `
        <section class="license-group-card">
          <div class="license-group-head">
            <span>${escapeHtml(license || "unknown")}</span>
            <strong>${escapeHtml(formatNumber(items.length))}</strong>
          </div>
        </section>
      `).join("")}
    </div>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("systemSettings.license.thirdPartyTitle"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("systemSettings.license.thirdPartyMeta"))}</div>
        </div>
      </div>
      <div class="license-module-list">
        ${modules.length ? modules.map(renderLicenseModule).join("") : `<div class="settings-empty-card compact">${escapeHtml(t("systemSettings.license.empty"))}</div>`}
      </div>
    </section>
  `;
  }

  function groupLicenseModules(modules) {
    return modules.reduce((acc, module) => {
      const license = module.license || "unknown";
      acc[license] = acc[license] || [];
      acc[license].push(module);
      return acc;
    }, {});
  }

  function renderLicenseModule(module) {
    const license = module.license || "unknown";
    return `
    <div class="license-module-row">
      <div>
        <div class="license-module-name">${escapeHtml(module.path || t("systemSettings.license.pathUnknown"))}</div>
        <div class="license-module-meta">${escapeHtml(module.version || t("systemSettings.license.versionUnknown"))} · ${escapeHtml(module.relation || t("systemSettings.license.indirect"))}</div>
      </div>
      <span class="settings-status-pill ${license === "unknown" ? "warn" : "ok"}">${escapeHtml(license)}</span>
    </div>
  `;
  }

  function downloadLocalPreferencesBackup() {
    const text = localPreferencesBackupText();
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `autoto-local-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t("systemSettings.localBackup.downloaded"), "success", { force: true });
    notifyTerminal?.(`[info] ${t("systemSettings.localBackup.downloaded")}\n`);
  }

  async function importLocalPreferencesBackupFromPanel() {
    const textarea = $("localPrefsImportText");
    const button = $("importLocalPrefsBackupBtn");
    const text = textarea?.value.trim() || "";
    if (!text) throw new Error(t("systemSettings.localBackup.importRequired"));
    setButtonBusy(button, true, t("systemSettings.localBackup.importing"));
    if (textarea) textarea.disabled = true;
    try {
      const imported = restoreLocalPreferencesBackup(text);
      if (textarea) textarea.value = "";
      refreshActiveSettingsPanel();
      const message = t("systemSettings.localBackup.imported", { count: imported });
      showToast(message, "success", { force: true });
      notifyTerminal?.(`[info] ${message}\n`);
    } finally {
      setButtonBusy(button, false, t("systemSettings.localBackup.importing"));
      if (textarea) textarea.disabled = false;
    }
  }

  function bindAboutSettingsActions() {
    $("checkForUpdatesBtn")?.addEventListener("click", () => loadUpdateStatus({ notify: true }).catch(showError));
    $("refreshLicensesBtn")?.addEventListener("click", () => loadLicenseSummary({ notify: true }).catch(showError));
    $("copyLocalPrefsBackupBtn")?.addEventListener("click", () => copyText(localPreferencesBackupText()));
    $("downloadLocalPrefsBackupBtn")?.addEventListener("click", downloadLocalPreferencesBackup);
    $("importLocalPrefsBackupBtn")?.addEventListener("click", () => importLocalPreferencesBackupFromPanel().catch(showError));
    $("clearLocalPrefsImportBtn")?.addEventListener("click", () => {
      const textarea = $("localPrefsImportText");
      if (textarea) textarea.value = "";
    });
    if (!state.licenseSummary && !state.licenseError) {
      loadLicenseSummary().catch(showError);
    }
  }

  function renderUserSettingsContent() {
    const status = state.authStatus;
    const user = state.authUser;
    const hasUsers = Boolean(status?.hasUsers);
    const registrationOpen = Boolean(status?.registrationOpen);
    return `
    <div class="settings-live-page users-page">
      <section class="settings-hero-card users-hero-card">
        <div>
          <div class="settings-hero-kicker">用户管理</div>
          <div class="settings-hero-title">${escapeHtml(user ? `@${user.handle}` : (hasUsers ? "登录本地账户" : "创建首个本地账户"))}</div>
          <p>登录后，聊天草稿会按用户和 Agent 保存到服务端；这仍是本机 MVP 身份边界，不替代操作系统权限隔离。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAuthStatusBtn" class="settings-action-btn subtle" type="button">刷新状态</button>
          ${user ? `<button id="authLogoutBtn" class="settings-action-btn" type="button">退出登录</button>` : ""}
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(user ? "已登录" : "未登录")}</strong><span>会话</span></div>
        <div><strong>${escapeHtml(status ? (registrationOpen ? "开放" : "关闭") : "加载中")}</strong><span>注册入口</span></div>
        <div><strong>${escapeHtml(state.settings?.version || "0.1.0-dev")}</strong><span>实例版本</span></div>
      </div>
      ${state.authError ? `<div class="settings-inline-alert">${escapeHtml(state.authError)}</div>` : ""}
      ${user ? `
        <section class="settings-provider-section highlighted">
          <div class="settings-provider-title">当前账户</div>
          <div class="settings-provider-meta">Handle：@${escapeHtml(user.handle)} · 角色：${escapeHtml(user.role || "user")}</div>
        </section>
      ` : `
        <form id="authAccountForm" class="settings-provider-section settings-agent-form">
          <div class="settings-provider-form-grid">
            <label>Handle
              <input id="authHandle" class="settings-field" autocomplete="username" placeholder="中文或 Unicode handle" />
            </label>
            <label>密码
              <input id="authPassword" class="settings-field" type="password" autocomplete="current-password" minlength="8" placeholder="至少 8 个字符" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button id="authLoginBtn" class="settings-action-btn primary" type="submit">登录</button>
            <button id="authRegisterBtn" class="settings-action-btn subtle" type="button" ${registrationOpen || !hasUsers ? "" : "disabled"}>注册</button>
          </div>
        </form>
      `}
      ${status ? renderAuthStatusSummary(status) : `<div class="settings-empty-card">正在加载用户状态。</div>`}

    </div>
  `;
  }

  function renderAuthStatusSummary(status) {
    const hasUsers = Boolean(status.hasUsers);
    const registrationOpen = Boolean(status.registrationOpen);
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(t("systemSettings.users.localUsers"), hasUsers ? t("systemSettings.users.exists") : t("systemSettings.users.none"), hasUsers ? t("systemSettings.users.existsHint") : t("systemSettings.users.noneHint"))}
      ${renderUsageMetricCard(t("systemSettings.users.registrationStatus"), registrationOpen ? t("systemSettings.users.open") : t("systemSettings.users.closed"), registrationOpen ? t("systemSettings.users.registrationOpenHint") : t("systemSettings.users.registrationClosedHint"))}
      ${renderUsageMetricCard(t("systemSettings.users.authMode"), t("systemSettings.users.localMvp"), t("systemSettings.users.authModeHint"))}
      ${renderUsageMetricCard(t("systemSettings.users.dataSource"), "/api/auth/status", t("systemSettings.users.dataSourceHint"))}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("systemSettings.users.capabilities"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("systemSettings.users.capabilitiesMeta"))}</div>
        </div>
        <span class="settings-status-pill ${registrationOpen ? "warn" : "ok"}">${escapeHtml(registrationOpen ? t("systemSettings.users.registrationOpen") : t("systemSettings.users.registrationClosed"))}</span>
      </div>
      <div class="user-policy-grid">
        ${renderUserPolicyCard(t("systemSettings.users.accountInit"), hasUsers ? t("systemSettings.users.completed") : t("systemSettings.users.notInitialized"), hasUsers ? t("systemSettings.users.accountInitDone") : t("systemSettings.users.accountInitPending"))}
        ${renderUserPolicyCard(t("systemSettings.users.roleManagement"), t("systemSettings.users.reserved"), t("systemSettings.users.roleManagementHint"))}
        ${renderUserPolicyCard(t("systemSettings.users.secretSafety"), t("systemSettings.users.noEcho"), t("systemSettings.users.secretSafetyHint"))}
        ${renderUserPolicyCard(t("systemSettings.users.deployBoundary"), t("systemSettings.users.localTrusted"), t("systemSettings.users.deployBoundaryHint"))}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(t("systemSettings.users.nextSteps"))}</div>
          <div class="settings-provider-meta">${escapeHtml(t("systemSettings.users.nextStepsMeta"))}</div>
        </div>
      </div>
      <div class="settings-info-text">
        ${escapeHtml(t("systemSettings.users.nextStepsBody"))}
      </div>
    </section>
  `;
  }

  function renderUserPolicyCard(title, value, description) {
    return `
    <div class="user-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </div>
  `;
  }

  async function loadCurrentAuthUser() {
    try {
      state.authUser = await api("/api/auth/me");
    } catch (error) {
      if (error?.status === 401) state.authUser = null;
      else throw error;
    }
    refreshActiveSettingsPanel?.();
    return state.authUser;
  }

  async function submitAuthAccount(mode) {
    const handle = $("authHandle")?.value.trim() || "";
    const password = $("authPassword")?.value || "";
    if (!handle || !password) throw new Error("请填写 Handle 和密码");
    const user = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ handle, password }) });
    state.authUser = user;
    await loadAuthStatus();
    window.dispatchEvent(new CustomEvent("autoto:auth-changed", { detail: { user } }));
    showToast(mode === "register" ? "账户已创建并登录。" : "登录成功。", "success");
    refreshActiveSettingsPanel?.();
  }

  async function logoutAuthUser() {
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    state.authUser = null;
    window.dispatchEvent(new CustomEvent("autoto:auth-changed", { detail: { user: null } }));
    showToast("已退出本地账户。", "success");
    refreshActiveSettingsPanel?.();
  }

  function bindUserSettingsActions() {
    $("refreshAuthStatusBtn")?.addEventListener("click", () => Promise.all([loadAuthStatus({ notify: true }), loadCurrentAuthUser()]).catch(showError));
    $("authAccountForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuthAccount("login").catch(showError);
    });
    $("authRegisterBtn")?.addEventListener("click", () => submitAuthAccount("register").catch(showError));
    $("authLogoutBtn")?.addEventListener("click", () => logoutAuthUser().catch(showError));
    if (!state.authStatus && !state.authError) loadAuthStatus().catch(showError);
    if (state.authUser === undefined) loadCurrentAuthUser().catch(showError);
  }
  function renderStorageSettingsContent() {
    const summary = state.storageSummary;
    const entries = Array.isArray(summary?.entries) ? summary.entries : [];
    const dbEntry = storageEntryByKey(entries, "database");
    const projectEntry = storageEntryByKey(entries, "projects");
    const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : t("systemSettings.storage.notScanned");
    return `
    <div class="settings-live-page storage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(t("systemSettings.storage.kicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(t("systemSettings.storage.heroTitle"))}</div>
          <p>${escapeHtml(t("systemSettings.storage.description"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshStorageSummaryBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.storage.refresh"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(summary?.totalKnownBytes || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.knownUsage"))}</span></div>
        <div><strong>${escapeHtml(formatBytes(dbEntry?.sizeBytes || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.databaseFile"))}</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>${escapeHtml(t("systemSettings.storage.scanTime"))}</span></div>
      </div>
      ${state.storageError ? `<div class="settings-inline-alert">${escapeHtml(state.storageError)}</div>` : ""}
      ${summary ? renderStorageSummary(summary, projectEntry) : `<div class="settings-empty-card">${escapeHtml(t("systemSettings.storage.loading"))}</div>`}
    </div>
  `;
  }

  function renderStorageSummary(summary, projectEntry) {
    const entries = Array.isArray(summary.entries) ? summary.entries : [];
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(t("systemSettings.storage.scanLimit"), summary.scanLimit || 0, t("systemSettings.storage.scanLimitHint"))}
      ${renderUsageMetricCard(t("systemSettings.storage.projectFiles"), projectEntry?.fileCount || 0, `${formatBytes(projectEntry?.sizeBytes || 0)} · ${projectEntry?.truncated ? t("systemSettings.storage.truncated") : t("systemSettings.storage.fullScan")}`)}
      ${renderUsageMetricCard(t("systemSettings.storage.directoryCount"), entries.reduce((sum, entry) => sum + Number(entry.directoryCount || 0), 0), t("systemSettings.storage.acrossEntries"))}
      ${renderUsageMetricCard(t("systemSettings.storage.fileCount"), entries.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0), t("systemSettings.storage.acrossEntries"))}
    </div>
    <div class="storage-entry-list">
      ${entries.map(renderStorageEntry).join("")}
    </div>
  `;
  }

  function renderStorageEntry(entry) {
    const status = entry.error ? entry.error : (entry.exists ? (entry.truncated ? t("systemSettings.storage.statusPartial") : t("systemSettings.storage.statusScanned")) : t("systemSettings.storage.statusMissing"));
    return `
    <section class="storage-entry-card">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(storageEntryLabel(entry))}</div>
          <div class="settings-provider-meta path">${escapeHtml(entry.path || t("systemSettings.storage.notConfigured"))}</div>
        </div>
        <span class="settings-status-pill ${entry.error ? "warn" : (entry.exists ? "ok" : "muted")}">${escapeHtml(entry.exists ? (entry.truncated ? t("systemSettings.storage.pillPartial") : t("systemSettings.storage.pillExists")) : t("systemSettings.storage.pillMissing"))}</span>
      </div>
      <div class="storage-entry-grid">
        <div><strong>${escapeHtml(formatBytes(entry.sizeBytes || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.size"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.fileCount || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.files"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.directoryCount || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.directories"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.entriesScanned || 0))}</strong><span>${escapeHtml(t("systemSettings.storage.scannedEntries"))}</span></div>
      </div>
      <div class="settings-info-text">${escapeHtml(status)}</div>
    </section>
  `;
  }

  function storageEntryByKey(entries, key) {
    return (entries || []).find((entry) => entry.key === key) || null;
  }

  function storageEntryLabel(entry) {
    const labels = {
      home: t("systemSettings.storage.labelHome"),
      database: t("systemSettings.storage.labelDatabase"),
      config: t("systemSettings.storage.labelConfig"),
      projects: t("systemSettings.storage.labelProjects"),
    };
    return entry.label || labels[entry.key] || entry.key || t("systemSettings.storage.labelFallback");
  }

  function bindStorageSettingsActions() {
    $("refreshStorageSummaryBtn")?.addEventListener("click", () => loadStorageSummary({ notify: true }).catch(showError));
    if (!state.storageSummary && !state.storageError) {
      loadStorageSummary().catch(showError);
    }
  }

  function renderUsageSettingsContent() {
    const summary = state.usageSummary;
    const counts = summary?.counts || {};
    const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : t("systemSettings.usage.notGenerated");
    return `
    <div class="settings-live-page usage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(t("systemSettings.usage.kicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(t("systemSettings.usage.heroTitle"))}</div>
          <p>${escapeHtml(t("systemSettings.usage.description"))}</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshUsageSummaryBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("systemSettings.usage.refresh"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(counts.messages || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.messages"))}</span></div>
        <div><strong>${escapeHtml(formatNumber(counts.toolCalls || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.toolCalls"))}</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>${escapeHtml(t("systemSettings.usage.generatedAt"))}</span></div>
      </div>
      ${state.usageError ? `<div class="settings-inline-alert">${escapeHtml(state.usageError)}</div>` : ""}
      ${summary ? renderUsageSummary(summary) : `<div class="settings-empty-card">${escapeHtml(t("systemSettings.usage.loading"))}</div>`}
    </div>
  `;
  }

  function renderUsageSummary(summary) {
    const counts = summary.counts || {};
    const api = summary.apiRequests || {};
    const toolCalls = summary.toolCalls || {};
    const backends = summary.backends || {};
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard(t("systemSettings.usage.projects"), counts.projects, t("systemSettings.usage.projectsHint"))}
      ${renderUsageMetricCard(t("systemSettings.usage.worklines"), counts.worklines, t("systemSettings.usage.worklinesHint"))}
      ${renderUsageMetricCard(t("systemSettings.usage.agents"), counts.agents, t("systemSettings.usage.agentsHint"))}
      ${renderUsageMetricCard(t("systemSettings.usage.messages"), counts.messages, t("systemSettings.usage.latest", { timestamp: formatTimestamp(summary.messages?.latestAt) }))}
      ${renderUsageMetricCard(t("systemSettings.usage.toolCalls"), counts.toolCalls, t("systemSettings.usage.avgDuration", { duration: formatDuration(toolCalls.averageDurationMs || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.usage.apiRequests"), counts.apiRequests, t("systemSettings.usage.cost", { amount: formatMoney(api.totalCostUsd || 0) }))}
      ${renderUsageMetricCard(t("systemSettings.usage.backends"), counts.backends, t("systemSettings.usage.backendsDetail", { active: formatNumber(backends.active || 0), keys: formatNumber(backends.apiKeyConfigured || 0) }))}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.usage.messageRoles"))}</div>
        ${renderUsageCountMap(summary.messages?.byRole)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.usage.toolStatus"))}</div>
        ${renderUsageCountMap(toolCalls.byStatus)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.usage.topTools"))}</div>
        ${renderUsageTopTools(toolCalls.topTools)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.usage.modelRequests"))}</div>
        <div class="usage-token-grid">
          <div><strong>${escapeHtml(formatNumber(api.inputTokens || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.inputTokens"))}</span></div>
          <div><strong>${escapeHtml(formatNumber(api.outputTokens || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.outputTokens"))}</span></div>
          <div><strong>${escapeHtml(formatNumber(api.reasoningTokens || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.reasoningTokens"))}</span></div>
          <div><strong>${escapeHtml(formatNumber(api.cachedInputTokens || 0))}</strong><span>${escapeHtml(t("systemSettings.usage.cachedInput"))}</span></div>
        </div>
        <div class="settings-info-text">${escapeHtml(t("systemSettings.usage.apiSummary", {
          duration: formatDuration(api.averageDurationMs || 0),
          errors: formatNumber(api.errors || 0),
          latest: formatTimestamp(api.latestAt),
        }))}</div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">${escapeHtml(t("systemSettings.usage.requestProviders"))}</div>
        ${renderUsageCountMap(api.byProvider)}
      </section>
    </div>
  `;
  }

  function renderUsageMetricCard(title, value, subtitle) {
    return `
    <section class="usage-metric-card">
      <div class="usage-metric-value">${escapeHtml(formatMetricValue(value))}</div>
      <div class="usage-metric-title">${escapeHtml(title)}</div>
      <div class="usage-metric-subtitle">${escapeHtml(subtitle || "—")}</div>
    </section>
  `;
  }

  function formatMetricValue(value) {
    if (typeof value === "number") return formatNumber(value);
    if (typeof value === "bigint") return formatNumber(Number(value));
    if (value === null || value === undefined || value === "") return "0";
    return String(value);
  }

  function renderUsageCountMap(value) {
    const entries = Object.entries(value || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) return `<div class="settings-info-text">${escapeHtml(t("systemSettings.usage.noData"))}</div>`;
    return `<div class="usage-map-list">${entries.map(([name, count]) => `<div class="usage-map-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(formatNumber(count))}</strong></div>`).join("")}</div>`;
  }

  function renderUsageTopTools(tools) {
    if (!Array.isArray(tools) || !tools.length) return `<div class="settings-info-text">${escapeHtml(t("systemSettings.usage.noToolCalls"))}</div>`;
    return `<div class="usage-map-list">${tools.map((tool) => `<div class="usage-map-row"><span>${escapeHtml(tool.name)}</span><strong>${escapeHtml(formatNumber(tool.count))}</strong></div>`).join("")}</div>`;
  }

  function bindUsageSettingsActions() {
    $("refreshUsageSummaryBtn")?.addEventListener("click", () => loadUsageSummary({ notify: true }).catch(showError));
    if (!state.usageSummary && !state.usageError) {
      loadUsageSummary().catch(showError);
    }
  }

  return {
    bindAboutSettingsActions,
    bindRuntimeSettingsActions,
    bindStorageSettingsActions,
    bindUsageSettingsActions,
    bindUserSettingsActions,
    renderAboutSettingsContent,
    renderRuntimeSettingsContent,
    renderServerSystemSettingsContent,
    renderStorageSettingsContent,
    renderUsageMetricCard,
    renderUsageSettingsContent,
    renderUserSettingsContent,
  };
}
