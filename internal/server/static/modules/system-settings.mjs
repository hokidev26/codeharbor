import { $, escapeHtml, setButtonBusy } from "./dom.mjs";
import { formatBytes, formatDuration, formatMoney, formatNumber, formatTimestamp } from "./formatters.mjs";
import { localPreferenceBackupVersion } from "./preferences-data.mjs";

export function createSystemSettingsController({
  state,
  copyText,
  loadAuthStatus,
  loadLicenseSummary,
  loadRuntimeSummary,
  loadStorageSummary,
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
          <div class="settings-hero-kicker">服务器与系统</div>
          <div class="settings-hero-title">${escapeHtml(address)}</div>
          <p>查看本地服务监听地址、版本、配置路径和 Go 运行环境。该面板只读取当前进程状态，不写入配置。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(summary?.version || state.settings?.version || "0.1.0-dev")}</strong><span>版本</span></div>
        <div><strong>${escapeHtml(process.pid ? `#${process.pid}` : "暂无")}</strong><span>进程 ID</span></div>
        <div><strong>${escapeHtml(go.version || "未加载")}</strong><span>Go 版本</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderServerSystemSummary(summary) : `<div class="settings-empty-card">正在加载服务器与系统状态。如果长时间没有变化，请点击“刷新状态”。</div>`}
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
      ${renderUsageMetricCard("监听地址", server.address || "未配置", "当前 Web UI 与 API 服务地址")}
      ${renderUsageMetricCard("访问模式", security.remoteAccessRequired ? "隧道收紧" : "本地", security.message || "当前请求的安全状态")}
      ${renderUsageMetricCard("自动执行", security.bypassPermissionsAllowed ? "允许" : "禁用", `权限上限：${security.maxPermissionMode || "bypassPermissions"}`)}
      ${renderUsageMetricCard("远程终端", security.remoteTerminalAllowed ? "允许" : "禁用", "AUTOTO_REMOTE_TERMINAL")}
      ${renderUsageMetricCard("访问密码", security.accessPasswordConfigured ? "已配置" : "未配置", "AUTOTO_ACCESS_PASSWORD")}
      ${renderUsageMetricCard("运行时长", formatUptime(process.uptimeSeconds || 0), `启动：${formatTimestamp(process.startedAt)}`)}
      ${renderUsageMetricCard("CPU", go.cpus || 0, `${go.os || "unknown"}/${go.arch || "unknown"}`)}
      ${renderUsageMetricCard("Provider", providers.total || 0, `${formatNumber(providers.configured || 0)} 个已配置`)}
      ${renderUsageMetricCard("后端种子", backends.configured || 0, `${formatNumber(backends.active || 0)} 个默认启用`)}
      ${renderUsageMetricCard("生成时间", formatTimestamp(summary.generatedAt), "点击刷新可重新采样")}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">服务配置</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("Host", server.host || "localhost")}
          ${renderRuntimeKeyValue("Port", server.port || 7788)}
          ${renderRuntimeKeyValue("Config", server.configPath || "未配置")}
          ${renderRuntimeKeyValue("Executable", process.executable || "未知")}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">本地路径</div>
        <div class="runtime-kv-list">
          ${(summary.paths || []).map((entry) => renderRuntimeKeyValue(entry.label || entry.key, entry.path || "未配置")).join("")}
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
          <div class="settings-hero-kicker">运行资源</div>
          <div class="settings-hero-title">${escapeHtml(formatBytes(memory.allocBytes || 0))} · ${escapeHtml(formatNumber(go.goroutines || 0))} goroutines</div>
          <p>查看 Go runtime 内存、goroutine、GC 与代理默认限制，适合定位本地服务是否异常膨胀。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshRuntimeSummaryBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(memory.sysBytes || 0))}</strong><span>系统内存</span></div>
        <div><strong>${escapeHtml(formatNumber(go.goroutines || 0))}</strong><span>Goroutines</span></div>
        <div><strong>${escapeHtml(formatNumber(memory.gcCycles || 0))}</strong><span>GC 次数</span></div>
      </div>
      ${state.runtimeError ? `<div class="settings-inline-alert">${escapeHtml(state.runtimeError)}</div>` : ""}
      ${summary ? renderRuntimeResourceSummary(summary) : `<div class="settings-empty-card">正在加载运行资源。如果长时间没有变化，请点击“刷新状态”。</div>`}
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
      ${renderUsageMetricCard("当前分配", formatBytes(memory.allocBytes || 0), "仍在使用的 Go 堆对象")}
      ${renderUsageMetricCard("堆占用", formatBytes(memory.heapInuseBytes || 0), `HeapAlloc ${formatBytes(memory.heapAllocBytes || 0)}`)}
      ${renderUsageMetricCard("栈占用", formatBytes(memory.stackInuseBytes || 0), "当前 goroutine 栈空间")}
      ${renderUsageMetricCard("下次 GC", formatBytes(memory.nextGcBytes || 0), `${formatNumber(memory.gcCycles || 0)} 次 GC`)}
      ${renderUsageMetricCard("Goroutines", go.goroutines || 0, `${formatNumber(go.cpus || 0)} CPU 可用`)}
      ${renderUsageMetricCard("累计分配", formatBytes(memory.totalAllocBytes || 0), "进程启动以来累计")}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">代理默认值</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("默认模型", agent.defaultModel || "未配置")}
          ${renderRuntimeKeyValue("摘要模型", agent.summaryModel || "未配置")}
          ${renderRuntimeKeyValue("默认权限", agent.defaultPermissionMode || "acceptEdits")}
          ${renderRuntimeKeyValue("当前权限上限", security.maxPermissionMode || "bypassPermissions")}
          ${renderRuntimeKeyValue("默认计划模式", agent.defaultStartInPlanMode ? "开启" : "关闭")}
        </div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">运行限制</div>
        <div class="runtime-kv-list">
          ${renderRuntimeKeyValue("最大轮次", formatNumber(agent.maxTurns || 0))}
          ${renderRuntimeKeyValue("首 token 超时", formatDuration(agent.firstTokenTimeoutMs || 0))}
          ${renderRuntimeKeyValue("瞬时重试", formatNumber(agent.maxTransientRetries || 0))}
          ${renderRuntimeKeyValue("采样时间", formatTimestamp(summary.generatedAt))}
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
    if (!Number.isFinite(value) || value <= 0) return "0 s";
    if (value < 60) return `${Math.round(value)} s`;
    if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${hours} h ${minutes} min`;
  }
  function renderAboutSettingsContent() {
    const summary = state.licenseSummary;
    const modules = Array.isArray(summary?.modules) ? summary.modules : [];
    const directCount = modules.filter((module) => module.relation === "direct").length;
    const unknownCount = modules.filter((module) => !module.license || module.license === "unknown").length;
    return `
    <div class="settings-live-page about-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">关于 Autoto</div>
          <div class="settings-hero-title">${escapeHtml(state.settings?.version || "0.1.0-dev")}</div>
          <p>Autoto 是本地优先的 Go AI 编程 Agent 服务。这里展示构建时依赖和许可证，方便发布前做开源合规检查。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshLicensesBtn" class="settings-action-btn primary" type="button">刷新依赖</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(modules.length))}</strong><span>依赖模块</span></div>
        <div><strong>${escapeHtml(formatNumber(directCount))}</strong><span>直接依赖</span></div>
        <div><strong>${escapeHtml(formatNumber(unknownCount))}</strong><span>未知许可证</span></div>
      </div>
      ${renderLocalPreferencesBackupSection()}
      ${state.licenseError ? `<div class="settings-inline-alert">${escapeHtml(state.licenseError)}</div>` : ""}
      ${summary ? renderLicenseSummary(summary) : `<div class="settings-empty-card">正在加载第三方依赖列表。如果长时间没有变化，请点击“刷新依赖”。</div>`}
    </div>
  `;
  }

  function renderLocalPreferencesBackupSection() {
    const summary = localPreferencesBackupSummary();
    const labels = summary.labels.length ? summary.labels : ["尚无本地偏好"];
    return `
    <section class="settings-provider-section settings-backup-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">本地设置备份</div>
          <div class="settings-provider-meta">导出/导入浏览器 localStorage 中的 Autoto 白名单偏好，用于迁移主题、技能草案、聊天草稿、提示词历史、通知、搜索策略和最近目录。</div>
        </div>
        <div class="settings-action-row compact-actions">
          <button id="copyLocalPrefsBackupBtn" class="settings-action-btn subtle" type="button">复制备份</button>
          <button id="downloadLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">下载备份</button>
        </div>
      </div>
      <div class="settings-backup-stats">
        <div><strong>${escapeHtml(formatNumber(summary.count))}</strong><span>已保存偏好</span></div>
        <div><strong>${escapeHtml(formatBytes(summary.bytes))}</strong><span>估算大小</span></div>
        <div><strong>${escapeHtml(String(localPreferenceBackupVersion))}</strong><span>备份格式</span></div>
      </div>
      <div class="settings-backup-key-list">
        ${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="settings-inline-success">备份不包含 API Key、数据库、项目文件、CLIProxyAPI 凭证文件或后端 registry；导入只会覆盖上述白名单 localStorage 偏好。</div>
      <textarea id="localPrefsImportText" class="settings-token-input settings-backup-import" placeholder='粘贴 autoto.local-preferences JSON 后点击“导入备份”'></textarea>
      <div class="settings-action-row settings-form-actions">
        <button id="clearLocalPrefsImportBtn" class="settings-action-btn subtle" type="button">清空输入</button>
        <button id="importLocalPrefsBackupBtn" class="settings-action-btn primary" type="button">导入备份</button>
      </div>
    </section>
  `;
  }

  function renderLicenseSummary(summary) {
    const modules = Array.isArray(summary.modules) ? summary.modules : [];
    const grouped = groupLicenseModules(modules);
    return `
    <section class="settings-info-card">
      <div class="settings-info-title">合规提示</div>
      <div class="settings-info-text">${escapeHtml(summary.notice || "该列表仅作开发辅助，正式发布前请重新运行完整许可证扫描。")}</div>
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
          <div class="settings-provider-title">第三方依赖</div>
          <div class="settings-provider-meta">来自 Go build info；unknown 代表需要发布前人工确认。</div>
        </div>
      </div>
      <div class="license-module-list">
        ${modules.length ? modules.map(renderLicenseModule).join("") : `<div class="settings-empty-card compact">暂无依赖数据。开发运行时可能缺少 build info。</div>`}
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
        <div class="license-module-name">${escapeHtml(module.path || "unknown")}</div>
        <div class="license-module-meta">${escapeHtml(module.version || "版本未知")} · ${escapeHtml(module.relation || "indirect")}</div>
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
    showToast("本地设置备份已下载。", "success", { force: true });
    notifyTerminal?.("[info] 本地设置备份已下载。\n");
  }

  async function importLocalPreferencesBackupFromPanel() {
    const textarea = $("localPrefsImportText");
    const button = $("importLocalPrefsBackupBtn");
    const text = textarea?.value.trim() || "";
    if (!text) throw new Error("请先粘贴本地设置备份 JSON");
    setButtonBusy(button, true, "导入中");
    if (textarea) textarea.disabled = true;
    try {
      const imported = restoreLocalPreferencesBackup(text);
      if (textarea) textarea.value = "";
      refreshActiveSettingsPanel();
      showToast(`已导入 ${imported} 项本地设置。`, "success", { force: true });
      notifyTerminal?.(`[info] 已导入 ${imported} 项本地设置。\n`);
    } finally {
      setButtonBusy(button, false, "导入中");
      if (textarea) textarea.disabled = false;
    }
  }

  function bindAboutSettingsActions() {
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
    const hasUsers = Boolean(status?.hasUsers);
    const registrationOpen = Boolean(status?.registrationOpen);
    return `
    <div class="settings-live-page users-page">
      <section class="settings-hero-card users-hero-card">
        <div>
          <div class="settings-hero-kicker">用户管理</div>
          <div class="settings-hero-title">${escapeHtml(hasUsers ? "已有本地用户" : "尚未创建用户")}</div>
          <p>当前版本保持本地开发 MVP 边界：这里先展示账户初始化和注册状态，后续可扩展为用户列表、角色和访问策略。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshAuthStatusBtn" class="settings-action-btn primary" type="button">刷新状态</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(status ? (hasUsers ? "已初始化" : "未初始化") : "加载中")}</strong><span>用户状态</span></div>
        <div><strong>${escapeHtml(status ? (registrationOpen ? "开放" : "关闭") : "加载中")}</strong><span>注册入口</span></div>
        <div><strong>${escapeHtml(state.settings?.version || "0.1.0-dev")}</strong><span>实例版本</span></div>
      </div>
      ${state.authError ? `<div class="settings-inline-alert">${escapeHtml(state.authError)}</div>` : ""}
      ${status ? renderAuthStatusSummary(status) : `<div class="settings-empty-card">正在加载本地账户状态。如果长时间没有变化，请点击“刷新状态”。</div>`}
    </div>
  `;
  }

  function renderAuthStatusSummary(status) {
    const hasUsers = Boolean(status.hasUsers);
    const registrationOpen = Boolean(status.registrationOpen);
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("本地用户", hasUsers ? "已存在" : "暂无", hasUsers ? "数据库中已检测到用户记录" : "适合首次启动或纯本地使用")}
      ${renderUsageMetricCard("注册状态", registrationOpen ? "开放" : "关闭", registrationOpen ? "允许初始化/注册流程继续" : "注册入口当前关闭")}
      ${renderUsageMetricCard("认证模式", "本地 MVP", "当前 API 仅暴露状态，不回显敏感信息")}
      ${renderUsageMetricCard("数据来源", "/api/auth/status", "只读状态接口")}
    </div>
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">当前能力</div>
          <div class="settings-provider-meta">Autoto 仍面向可信本地使用；用户管理页先提供清晰状态与安全边界。</div>
        </div>
        <span class="settings-status-pill ${registrationOpen ? "warn" : "ok"}">${escapeHtml(registrationOpen ? "注册开放" : "注册关闭")}</span>
      </div>
      <div class="user-policy-grid">
        ${renderUserPolicyCard("账号初始化", hasUsers ? "已完成" : "未初始化", hasUsers ? "已存在至少一个本地用户记录。" : "尚未检测到用户，可作为首次初始化提示。")}
        ${renderUserPolicyCard("角色管理", "预留", "后续可接入角色、访问策略和审计日志。")}
        ${renderUserPolicyCard("Secret 安全", "不回显", "该接口不会返回 JWT secret、API key 或用户凭据。")}
        ${renderUserPolicyCard("部署边界", "本地可信", "公开网络部署前应补充完整认证、CSRF 和权限策略。")}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">建议下一步</div>
          <div class="settings-provider-meta">这里记录产品化路线，避免把 MVP 误认为多用户生产环境。</div>
        </div>
      </div>
      <div class="settings-info-text">
        当前页面是只读治理视图。后续如果需要正式多用户，可继续增加用户列表 API、登录会话、角色策略、访问审计和管理员操作确认。
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

  function bindUserSettingsActions() {
    $("refreshAuthStatusBtn")?.addEventListener("click", () => loadAuthStatus({ notify: true }).catch(showError));
    if (!state.authStatus && !state.authError) {
      loadAuthStatus().catch(showError);
    }
  }
  function renderStorageSettingsContent() {
    const summary = state.storageSummary;
    const entries = Array.isArray(summary?.entries) ? summary.entries : [];
    const dbEntry = storageEntryByKey(entries, "database");
    const projectEntry = storageEntryByKey(entries, "projects");
    const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : "尚未扫描";
    return `
    <div class="settings-live-page storage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">储存空间</div>
          <div class="settings-hero-title">本地路径与容量概览</div>
          <p>检查 Autoto home、SQLite 数据库、配置文件和默认项目目录的存在状态、大小和扫描是否被上限截断。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshStorageSummaryBtn" class="settings-action-btn primary" type="button">刷新储存统计</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatBytes(summary?.totalKnownBytes || 0))}</strong><span>已知占用</span></div>
        <div><strong>${escapeHtml(formatBytes(dbEntry?.sizeBytes || 0))}</strong><span>数据库文件</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>扫描时间</span></div>
      </div>
      ${state.storageError ? `<div class="settings-inline-alert">${escapeHtml(state.storageError)}</div>` : ""}
      ${summary ? renderStorageSummary(summary, projectEntry) : `<div class="settings-empty-card">正在加载储存空间统计。如果长时间没有变化，请点击“刷新储存统计”。</div>`}
    </div>
  `;
  }

  function renderStorageSummary(summary, projectEntry) {
    const entries = Array.isArray(summary.entries) ? summary.entries : [];
    return `
    <div class="usage-summary-grid">
      ${renderUsageMetricCard("扫描上限", summary.scanLimit || 0, "每个目录最多扫描的条目数")}
      ${renderUsageMetricCard("项目目录文件", projectEntry?.fileCount || 0, `${formatBytes(projectEntry?.sizeBytes || 0)} · ${projectEntry?.truncated ? "已截断" : "完整扫描"}`)}
      ${renderUsageMetricCard("目录数量", entries.reduce((sum, entry) => sum + Number(entry.directoryCount || 0), 0), "跨所有储存条目")}
      ${renderUsageMetricCard("文件数量", entries.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0), "跨所有储存条目")}
    </div>
    <div class="storage-entry-list">
      ${entries.map(renderStorageEntry).join("")}
    </div>
  `;
  }

  function renderStorageEntry(entry) {
    const status = entry.error ? entry.error : (entry.exists ? (entry.truncated ? "已扫描部分内容" : "已扫描") : "路径不存在");
    return `
    <section class="storage-entry-card">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(storageEntryLabel(entry))}</div>
          <div class="settings-provider-meta path">${escapeHtml(entry.path || "未配置")}</div>
        </div>
        <span class="settings-status-pill ${entry.error ? "warn" : (entry.exists ? "ok" : "muted")}">${escapeHtml(entry.exists ? (entry.truncated ? "部分" : "存在") : "缺失")}</span>
      </div>
      <div class="storage-entry-grid">
        <div><strong>${escapeHtml(formatBytes(entry.sizeBytes || 0))}</strong><span>大小</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.fileCount || 0))}</strong><span>文件</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.directoryCount || 0))}</strong><span>目录</span></div>
        <div><strong>${escapeHtml(formatNumber(entry.entriesScanned || 0))}</strong><span>扫描条目</span></div>
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
      home: "Autoto home",
      database: "SQLite 数据库",
      config: "配置文件",
      projects: "默认项目目录",
    };
    return entry.label || labels[entry.key] || entry.key || "储存条目";
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
    const generatedAt = summary?.generatedAt ? formatTimestamp(summary.generatedAt) : "尚未生成";
    return `
    <div class="settings-live-page usage-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">使用历史</div>
          <div class="settings-hero-title">运行统计与活动概览</div>
          <p>基于本地 SQLite 表统计项目、消息、工具调用和模型请求，帮助你判断产品使用情况和后续优化重点。</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshUsageSummaryBtn" class="settings-action-btn primary" type="button">刷新统计</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(formatNumber(counts.messages || 0))}</strong><span>消息</span></div>
        <div><strong>${escapeHtml(formatNumber(counts.toolCalls || 0))}</strong><span>工具调用</span></div>
        <div><strong>${escapeHtml(generatedAt)}</strong><span>统计时间</span></div>
      </div>
      ${state.usageError ? `<div class="settings-inline-alert">${escapeHtml(state.usageError)}</div>` : ""}
      ${summary ? renderUsageSummary(summary) : `<div class="settings-empty-card">正在加载使用统计。如果长时间没有变化，请点击“刷新统计”。</div>`}
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
      ${renderUsageMetricCard("项目", counts.projects, "本地项目工作区")}
      ${renderUsageMetricCard("工作线", counts.worklines, "项目下的工作线")}
      ${renderUsageMetricCard("Agent", counts.agents, "主代理与子代理")}
      ${renderUsageMetricCard("消息", counts.messages, `最新：${formatTimestamp(summary.messages?.latestAt)}`)}
      ${renderUsageMetricCard("工具调用", counts.toolCalls, `平均耗时：${formatDuration(toolCalls.averageDurationMs || 0)}`)}
      ${renderUsageMetricCard("模型请求", counts.apiRequests, `成本：${formatMoney(api.totalCostUsd || 0)}`)}
      ${renderUsageMetricCard("后端", counts.backends, `${formatNumber(backends.active || 0)} 个启用，${formatNumber(backends.apiKeyConfigured || 0)} 个有密钥`)}
    </div>
    <div class="usage-detail-grid">
      <section class="settings-info-card">
        <div class="settings-info-title">消息角色</div>
        ${renderUsageCountMap(summary.messages?.byRole)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">工具状态</div>
        ${renderUsageCountMap(toolCalls.byStatus)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">热门工具</div>
        ${renderUsageTopTools(toolCalls.topTools)}
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">模型请求</div>
        <div class="usage-token-grid">
          <div><strong>${escapeHtml(formatNumber(api.inputTokens || 0))}</strong><span>输入 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.outputTokens || 0))}</strong><span>输出 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.reasoningTokens || 0))}</strong><span>推理 token</span></div>
          <div><strong>${escapeHtml(formatNumber(api.cachedInputTokens || 0))}</strong><span>缓存输入</span></div>
        </div>
        <div class="settings-info-text">平均耗时 ${escapeHtml(formatDuration(api.averageDurationMs || 0))} · 错误 ${escapeHtml(formatNumber(api.errors || 0))} · 最新 ${escapeHtml(formatTimestamp(api.latestAt))}</div>
      </section>
      <section class="settings-info-card">
        <div class="settings-info-title">请求 Provider</div>
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
    if (!entries.length) return `<div class="settings-info-text">暂无数据</div>`;
    return `<div class="usage-map-list">${entries.map(([name, count]) => `<div class="usage-map-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(formatNumber(count))}</strong></div>`).join("")}</div>`;
  }

  function renderUsageTopTools(tools) {
    if (!Array.isArray(tools) || !tools.length) return `<div class="settings-info-text">暂无工具调用</div>`;
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
