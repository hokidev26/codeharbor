import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatNumber } from "./formatters.mjs";
import { defaultIMGatewayPrefs, defaultSearchPrefs } from "./preferences-data.mjs";

export function createLocalPreferencesSettingsController({
  state,
  copyText,
  currentAppearancePreferences,
  currentIMGatewayPreferences,
  currentNotificationPreferences,
  currentProfilePreferences,
  currentSearchPreferences,
  imGatewayChannelLabel,
  imGatewayPrefsExport,
  notifyTerminal,
  profileDisplayName,
  profileGitEnvExample,
  resetIMGatewayPreferences,
  resetNotificationPreferences,
  resetProfilePreferences,
  resetSearchPreferences,
  loadServerNotificationSettings,
  saveServerNotificationSettings,
  testServerNotification,
  saveIMGatewayPreferences,
  saveProfilePreferences,
  saveSearchPreferences,
  searchPrefsExport,
  searchProviderLabel,
  setAppearancePreference,
  setNotificationPreference,
  showError,
  showToast,
} = {}) {
  function renderProfileSettingsContent() {
    const profile = currentProfilePreferences();
    const gitConfigured = Boolean(profile.gitName && profile.gitEmail);
    return `
    <div class="settings-live-page profile-page">
      <section class="settings-hero-card profile-hero-card">
        <div class="profile-hero-main">
          <div class="profile-avatar-preview">${escapeHtml(profile.avatarInitials)}</div>
          <div>
            <div class="settings-hero-kicker">个人资料</div>
            <div class="settings-hero-title">${escapeHtml(profileDisplayName())}</div>
            <p>${escapeHtml(profile.roleLabel)} · ${escapeHtml(profile.workspaceLabel)}</p>
          </div>
        </div>
        <div class="settings-action-row">
          <button id="resetProfilePrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(profile.avatarInitials)}</strong><span>头像缩写</span></div>
        <div><strong>${escapeHtml(gitConfigured ? "已填写" : "未填写")}</strong><span>Git 身份</span></div>
        <div><strong>${escapeHtml("本地浏览器")}</strong><span>保存位置</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">显示资料</div>
            <div class="settings-provider-meta">这些资料只影响当前浏览器的工作台展示和复制辅助，不写入服务端用户表。</div>
          </div>
        </div>
        <form id="profileSettingsForm" class="settings-profile-form">
          <div class="settings-provider-form-grid">
            <label>显示名称
              <input id="profileDisplayName" class="settings-field" value="${escapeAttr(profile.displayName)}" placeholder="例如 Ada" />
            </label>
            <label>头像缩写
              <input id="profileAvatarInitials" class="settings-field" value="${escapeAttr(profile.avatarInitials)}" placeholder="CH" maxlength="4" />
            </label>
            <label>身份标签
              <input id="profileRoleLabel" class="settings-field" value="${escapeAttr(profile.roleLabel)}" placeholder="Local developer" />
            </label>
            <label>工作台标签
              <input id="profileWorkspaceLabel" class="settings-field" value="${escapeAttr(profile.workspaceLabel)}" placeholder="CodeHarbor Local" />
            </label>
            <label>Git user.name
              <input id="profileGitName" class="settings-field" value="${escapeAttr(profile.gitName)}" placeholder="用于复制 git config 示例" />
            </label>
            <label>Git user.email
              <input id="profileGitEmail" class="settings-field" value="${escapeAttr(profile.gitEmail)}" placeholder="you@example.com" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button id="copyProfileGitEnvBtn" class="settings-action-btn subtle" type="button">复制 Git 设置</button>
            <button class="settings-action-btn primary" type="submit">保存个人资料</button>
          </div>
        </form>
      </section>
      <div class="profile-info-grid">
        ${renderProfileInfoCard("本地优先", "个人资料保存在 localStorage，不会上传或写入 SQLite。")}
        ${renderProfileInfoCard("Git 辅助", gitConfigured ? "可以复制 git config 命令，方便统一提交身份。" : "填写 Git 姓名和邮箱后可生成 git config 命令。")}
        ${renderProfileInfoCard("账号系统", "完整头像上传、登录用户资料和角色绑定仍由后续用户系统承接。")}
      </div>
    </div>
  `;
  }

  function renderProfileInfoCard(title, description) {
    return `
    <section class="profile-info-card">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </section>
  `;
  }

  function bindProfileSettingsActions() {
    $("profileSettingsForm")?.addEventListener("submit", (event) => saveProfileSettingsFromPanel(event).catch(showError));
    $("resetProfilePrefsBtn")?.addEventListener("click", resetProfilePreferences);
    $("copyProfileGitEnvBtn")?.addEventListener("click", () => copyText(profileGitEnvExample()));
  }

  async function saveProfileSettingsFromPanel(event) {
    event.preventDefault();
    saveProfilePreferences({
      displayName: $("profileDisplayName")?.value || "",
      avatarInitials: $("profileAvatarInitials")?.value || "",
      roleLabel: $("profileRoleLabel")?.value || "",
      workspaceLabel: $("profileWorkspaceLabel")?.value || "",
      gitName: $("profileGitName")?.value || "",
      gitEmail: $("profileGitEmail")?.value || "",
    }, { notify: true });
    notifyTerminal?.("[info] 个人资料偏好已保存。\n");
  }
  function renderNetworkSearchSettingsContent() {
    const prefs = currentSearchPreferences();
    const allowedCount = prefs.allowedDomains ? prefs.allowedDomains.split("\n").filter(Boolean).length : 0;
    const blockedCount = prefs.blockedDomains ? prefs.blockedDomains.split("\n").filter(Boolean).length : 0;
    return `
    <div class="settings-live-page network-search-page">
      <section class="settings-hero-card network-search-hero-card">
        <div>
          <div class="settings-hero-kicker">网络搜索</div>
          <div class="settings-hero-title">${escapeHtml(prefs.enabled ? searchProviderLabel(prefs.provider) : "搜索未启用")}</div>
          <p>配置未来接入搜索/检索服务时的默认策略。当前仅保存本地偏好，不会主动联网，也不会把查询发送到后端。</p>
        </div>
        <div class="settings-action-row">
          <button id="copySearchPrefsBtn" class="settings-action-btn subtle" type="button">复制配置</button>
          <button id="resetSearchPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.enabled ? "开启" : "关闭")}</strong><span>搜索权限</span></div>
        <div><strong>${escapeHtml(searchProviderLabel(prefs.provider))}</strong><span>提供商</span></div>
        <div><strong>${escapeHtml(formatNumber(prefs.maxResults))}</strong><span>默认结果数</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">搜索策略</div>
            <div class="settings-provider-meta">为后续接入 DuckDuckGo、Brave、Tavily、SearXNG 或自定义搜索网关预留一致配置。</div>
          </div>
          <span class="settings-status-pill ${prefs.enabled ? "ok" : "muted"}">${escapeHtml(prefs.enabled ? "允许搜索" : "仅本地")}</span>
        </div>
        <form id="searchSettingsForm" class="settings-search-form">
          <div class="appearance-toggle-list">
            ${renderSearchToggle("enabled", "允许网络搜索", "总开关；关闭时 Agent/Search UI 应保持本地优先，不主动联网。", prefs.enabled)}
            ${renderSearchToggle("confirmBeforeSearch", "搜索前确认", "建议保持开启，尤其是在查询可能包含项目路径、错误日志或业务信息时。", prefs.confirmBeforeSearch)}
            ${renderSearchToggle("safeSearch", "安全搜索", "让兼容提供商优先返回过滤后的网页结果。", prefs.safeSearch)}
            ${renderSearchToggle("preferGitHub", "优先 GitHub / 开源结果", "适合查找开源库、issue、README 和示例实现。", prefs.preferGitHub)}
          </div>
          <div class="settings-provider-form-grid search-form-grid">
            <label>默认结果数
              <select id="searchMaxResults" class="settings-field">
                ${[3, 5, 10, 20].map((value) => `<option value="${value}" ${prefs.maxResults === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>自定义端点
              <input id="searchCustomEndpoint" class="settings-field" value="${escapeAttr(prefs.customEndpoint)}" placeholder="例如 https://search.example.com/api" />
            </label>
            <label class="settings-form-span-2">允许域名（一行一个，可选）
              <textarea id="searchAllowedDomains" class="settings-field settings-textarea" rows="4" placeholder="github.com\nsourcegraph.com">${escapeHtml(prefs.allowedDomains)}</textarea>
            </label>
            <label class="settings-form-span-2">屏蔽域名（一行一个，可选）
              <textarea id="searchBlockedDomains" class="settings-field settings-textarea" rows="4" placeholder="example-spam.com">${escapeHtml(prefs.blockedDomains)}</textarea>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit">保存搜索策略</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">搜索提供商</div>
            <div class="settings-provider-meta">这里只保存策略，不安装依赖；后续可把开源搜索服务接入后端或 MCP。</div>
          </div>
        </div>
        <div class="search-provider-grid">
          ${renderSearchProviderChoice("duckduckgo", "DuckDuckGo", "无需账号的通用网页搜索预设。", prefs.provider)}
          ${renderSearchProviderChoice("brave", "Brave Search", "适合正式 API key 网关接入。", prefs.provider)}
          ${renderSearchProviderChoice("tavily", "Tavily", "偏 Agent/RAG 工作流的搜索 API。", prefs.provider)}
          ${renderSearchProviderChoice("searxng", "SearXNG", "适合自托管开源 metasearch。", prefs.provider)}
          ${renderSearchProviderChoice("custom", "自定义端点", "连接内部搜索、企业网关或 MCP adapter。", prefs.provider)}
        </div>
      </section>
      <div class="search-policy-grid">
        ${renderSearchPolicyCard("允许域", formatNumber(allowedCount), allowedCount ? "只优先/允许这些域名。" : "未限制允许域。")}
        ${renderSearchPolicyCard("屏蔽域", formatNumber(blockedCount), blockedCount ? "搜索结果应排除这些域名。" : "未配置屏蔽域。")}
        ${renderSearchPolicyCard("隐私", prefs.confirmBeforeSearch ? "先确认" : "直接搜索", "建议搜索前确认敏感查询。")}
      </div>
    </div>
  `;
  }

  function renderSearchToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row search-toggle-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-search-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function renderSearchProviderChoice(value, title, description, current) {
    return `<button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-search-provider="${escapeAttr(value)}"><span>${escapeHtml(title)}</span><small>${escapeHtml(description)}</small></button>`;
  }

  function renderSearchPolicyCard(title, value, description) {
    return `<section class="search-policy-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span><small>${escapeHtml(description)}</small></section>`;
  }

  function bindNetworkSearchSettingsActions() {
    $("searchSettingsForm")?.addEventListener("submit", (event) => saveSearchSettingsFromPanel(event).catch(showError));
    $("copySearchPrefsBtn")?.addEventListener("click", () => copyText(searchPrefsExport()));
    $("resetSearchPrefsBtn")?.addEventListener("click", resetSearchPreferences);
    document.querySelectorAll("[data-search-provider]").forEach((node) => {
      node.addEventListener("click", () => saveSearchPreferences({ ...currentSearchPreferences(), provider: node.dataset.searchProvider }, { notify: true }));
    });
    document.querySelectorAll("[data-search-toggle]").forEach((node) => {
      node.addEventListener("change", () => saveSearchPreferences({ ...currentSearchPreferences(), [node.dataset.searchToggle]: node.checked }, { notify: true }));
    });
  }

  async function saveSearchSettingsFromPanel(event) {
    event.preventDefault();
    saveSearchPreferences({
      ...currentSearchPreferences(),
      maxResults: Number($("searchMaxResults")?.value || defaultSearchPrefs.maxResults),
      customEndpoint: $("searchCustomEndpoint")?.value || "",
      allowedDomains: $("searchAllowedDomains")?.value || "",
      blockedDomains: $("searchBlockedDomains")?.value || "",
    }, { notify: true });
    notifyTerminal?.("[info] 网络搜索策略已保存。\n");
  }
  function renderIMGatewaySettingsContent() {
    const prefs = currentIMGatewayPreferences();
    const allowedCount = prefs.allowedOrigins ? prefs.allowedOrigins.split("\n").filter(Boolean).length : 0;
    const blockedCount = prefs.blockedSenders ? prefs.blockedSenders.split("\n").filter(Boolean).length : 0;
    const enabledEvents = [prefs.allowInboundMessages, prefs.notifyOnTaskDone, prefs.notifyOnErrors, prefs.notifyOnToolCalls].filter(Boolean).length;
    return `
    <div class="settings-live-page im-gateway-page">
      <section class="settings-hero-card im-gateway-hero-card">
        <div>
          <div class="settings-hero-kicker">IM 网关</div>
          <div class="settings-hero-title">${escapeHtml(prefs.enabled ? imGatewayChannelLabel(prefs.channel) : "网关未启用")}</div>
          <p>配置未来连接 IM、Webhook、Bot 或企业消息网关的本地策略。当前只保存浏览器偏好，不启动服务、不暴露公网端点。</p>
        </div>
        <div class="settings-action-row">
          <button id="copyIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">复制配置</button>
          <button id="resetIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.enabled ? "开启" : "关闭")}</strong><span>网关权限</span></div>
        <div><strong>${escapeHtml(imGatewayChannelLabel(prefs.channel))}</strong><span>通道</span></div>
        <div><strong>${escapeHtml(formatNumber(enabledEvents))}</strong><span>启用事件</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">安全策略</div>
            <div class="settings-provider-meta">默认要求确认和签名，避免 IM 消息直接触发本地 Agent 操作。</div>
          </div>
          <span class="settings-status-pill ${prefs.enabled ? "warn" : "muted"}">${escapeHtml(prefs.enabled ? "需要安全网关" : "仅本地预案")}</span>
        </div>
        <form id="imGatewaySettingsForm" class="settings-im-form">
          <div class="appearance-toggle-list">
            ${renderIMGatewayToggle("enabled", "启用 IM 网关策略", "只是打开本地策略开关；当前不会启动监听端口。", prefs.enabled)}
            ${renderIMGatewayToggle("inboundConfirm", "入站消息执行前确认", "建议保持开启，防止聊天消息直接触发写文件或命令。", prefs.inboundConfirm)}
            ${renderIMGatewayToggle("requireSignature", "要求签名校验", "后续 webhook endpoint 应验证签名或 token。", prefs.requireSignature)}
            ${renderIMGatewayToggle("redactSecrets", "发送前脱敏", "对 API key、token、路径等敏感内容进行脱敏。", prefs.redactSecrets)}
          </div>
          <div class="settings-provider-form-grid im-form-grid">
            <label>最大 payload
              <select id="imGatewayMaxPayload" class="settings-field">
                ${[32, 64, 128, 256].map((value) => `<option value="${value}" ${prefs.maxPayloadKB === value ? "selected" : ""}>${value} KB</option>`).join("")}
              </select>
            </label>
            <label>回调 / 网关端点
              <input id="imGatewayEndpoint" class="settings-field" value="${escapeAttr(prefs.endpointUrl)}" placeholder="https://bot.example.com/webhook" />
            </label>
            <label class="settings-form-span-2">允许来源（一行一个，可选）
              <textarea id="imGatewayAllowedOrigins" class="settings-field settings-textarea" rows="4" placeholder="slack-team-id\ndiscord-guild-id">${escapeHtml(prefs.allowedOrigins)}</textarea>
            </label>
            <label class="settings-form-span-2">屏蔽发送者（一行一个，可选）
              <textarea id="imGatewayBlockedSenders" class="settings-field settings-textarea" rows="4" placeholder="user-id@example\nspam-bot">${escapeHtml(prefs.blockedSenders)}</textarea>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit">保存网关策略</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">通道预设</div>
            <div class="settings-provider-meta">后续可接入开源 bot framework、n8n、SearXNG webhook、Mattermost/Matrix adapter 或自托管网关。</div>
          </div>
        </div>
        <div class="im-channel-grid">
          ${renderIMGatewayChannelChoice("webhook", "通用 Webhook", "适合自托管 HTTP webhook 或 n8n。", prefs.channel)}
          ${renderIMGatewayChannelChoice("discord", "Discord", "适合社区 bot 或项目频道。", prefs.channel)}
          ${renderIMGatewayChannelChoice("slack", "Slack", "适合团队工作区 slash command/event。", prefs.channel)}
          ${renderIMGatewayChannelChoice("telegram", "Telegram", "适合个人 bot 或轻量通知。", prefs.channel)}
          ${renderIMGatewayChannelChoice("lark", "飞书 / Lark", "适合企业 IM 和审批流。", prefs.channel)}
          ${renderIMGatewayChannelChoice("wecom", "企业微信", "适合国内企业机器人。", prefs.channel)}
          ${renderIMGatewayChannelChoice("custom", "自定义网关", "连接内部网关或 MCP adapter。", prefs.channel)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">事件路由</div>
            <div class="settings-provider-meta">控制哪些事件可以进入或发出 IM 网关。真实发送逻辑后续由后端/webhook adapter 接入。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderIMGatewayToggle("allowInboundMessages", "允许入站消息", "允许 IM 消息进入待确认队列。", prefs.allowInboundMessages)}
          ${renderIMGatewayToggle("notifyOnTaskDone", "任务完成通知", "Agent 完成后可发送摘要通知。", prefs.notifyOnTaskDone)}
          ${renderIMGatewayToggle("notifyOnErrors", "错误通知", "模型、工具或终端错误可发送提醒。", prefs.notifyOnErrors)}
          ${renderIMGatewayToggle("notifyOnToolCalls", "工具调用通知", "高频事件，默认关闭，适合审计环境。", prefs.notifyOnToolCalls)}
        </div>
      </section>
      <div class="im-policy-grid">
        ${renderIMGatewayPolicyCard("允许来源", formatNumber(allowedCount), allowedCount ? "只接受这些来源。" : "未限制来源。")}
        ${renderIMGatewayPolicyCard("屏蔽发送者", formatNumber(blockedCount), blockedCount ? "会拒绝这些 sender。" : "未配置屏蔽发送者。")}
        ${renderIMGatewayPolicyCard("Payload", `${formatNumber(prefs.maxPayloadKB)} KB`, "建议对长日志做摘要后再发送。")}
      </div>
    </div>
  `;
  }

  function renderIMGatewayToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row im-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-im-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function renderIMGatewayChannelChoice(value, title, description, current) {
    return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-im-channel="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
  }

  function renderIMGatewayPolicyCard(title, value, description) {
    return `
    <section class="im-policy-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </section>
  `;
  }

  function bindIMGatewaySettingsActions() {
    $("imGatewaySettingsForm")?.addEventListener("submit", (event) => saveIMGatewaySettingsFromPanel(event).catch(showError));
    $("copyIMGatewayPrefsBtn")?.addEventListener("click", () => copyText(imGatewayPrefsExport()));
    $("resetIMGatewayPrefsBtn")?.addEventListener("click", resetIMGatewayPreferences);
    document.querySelectorAll("[data-im-channel]").forEach((node) => {
      node.addEventListener("click", () => saveIMGatewayPreferences({ ...currentIMGatewayPreferences(), channel: node.dataset.imChannel }, { notify: true }));
    });
    document.querySelectorAll("[data-im-toggle]").forEach((node) => {
      node.addEventListener("change", () => saveIMGatewayPreferences({ ...currentIMGatewayPreferences(), [node.dataset.imToggle]: node.checked }, { notify: true }));
    });
  }

  async function saveIMGatewaySettingsFromPanel(event) {
    event.preventDefault();
    saveIMGatewayPreferences({
      ...currentIMGatewayPreferences(),
      maxPayloadKB: Number($("imGatewayMaxPayload")?.value || defaultIMGatewayPrefs.maxPayloadKB),
      endpointUrl: $("imGatewayEndpoint")?.value || "",
      allowedOrigins: $("imGatewayAllowedOrigins")?.value || "",
      blockedSenders: $("imGatewayBlockedSenders")?.value || "",
    }, { notify: true });
    notifyTerminal?.("[info] IM 网关策略已保存。\n");
  }
  function renderNotificationSettingsContent() {
    const prefs = currentNotificationPreferences();
    const serverSettings = state?.serverNotificationSettings || {};
    if (!state?.serverNotificationSettings && !state?.serverNotificationLoading && !state?.serverNotificationError) {
      loadServerNotificationSettings?.().catch(showError);
    }
    const enabledCount = [prefs.infoToasts, prefs.successToasts, prefs.warningToasts, prefs.errorToasts].filter(Boolean).length;
    return `
    <div class="settings-live-page notification-page">
      <section class="settings-hero-card notification-hero-card">
        <div>
          <div class="settings-hero-kicker">通知</div>
          <div class="settings-hero-title">${escapeHtml(prefs.toastEnabled ? "Toast 已启用" : "Toast 已关闭")}</div>
          <p>控制本地工作台的弹窗提醒和 UI 操作日志。偏好只保存在当前浏览器，不影响 Agent、PTY 终端和后端运行。</p>
        </div>
        <div class="settings-action-row">
          <button id="testNotificationBtn" class="settings-action-btn primary" type="button">测试通知</button>
          <button id="resetNotificationPrefsBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(prefs.toastEnabled ? "开启" : "关闭")}</strong><span>弹窗</span></div>
        <div><strong>${escapeHtml(formatNumber(enabledCount))}</strong><span>启用类型</span></div>
        <div><strong>${escapeHtml(notificationDurationLabel(prefs.duration))}</strong><span>显示时长</span></div>
      </div>
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">Webhook 任务通知</div>
            <div class="settings-provider-meta">服务端保存并发送：等待审批、任务完成、错误或中断时向外部 webhook POST 摘要。</div>
          </div>
          <span class="settings-status-pill ${serverSettings.enabled ? "ok" : "muted"}">${escapeHtml(state?.serverNotificationLoading ? "加载中" : (serverSettings.enabled ? "已启用" : "未启用"))}</span>
        </div>
        ${state?.serverNotificationError ? `<div class="settings-inline-alert">${escapeHtml(state.serverNotificationError)}</div>` : ""}
        <form id="serverNotificationSettingsForm" class="settings-im-form">
          <div class="appearance-toggle-list">
            ${renderServerNotificationToggle("enabled", "启用 Webhook 通知", "关闭后不会向外部端点发送 run 事件。", serverSettings.enabled)}
            ${renderServerNotificationToggle("notifyOnApproval", "等待审批时通知", "工具需要你批准时主动提醒。", serverSettings.notifyOnApproval !== false)}
            ${renderServerNotificationToggle("notifyOnDone", "任务完成/中断时通知", "completed、interrupted、superseded 会走这一类通知。", serverSettings.notifyOnDone !== false)}
            ${renderServerNotificationToggle("notifyOnError", "错误通知", "模型、工具或 agent loop 失败时发送。", serverSettings.notifyOnError !== false)}
          </div>
          <div class="settings-provider-form-grid im-form-grid">
            <label class="settings-form-span-2">Webhook URL
              <input id="serverNotificationWebhookUrl" class="settings-field" value="${escapeAttr(serverSettings.webhookUrl || "")}" placeholder="https://bot.example.com/webhook" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button id="refreshServerNotificationSettingsBtn" class="settings-action-btn subtle" type="button">刷新服务端设置</button>
            <button id="testServerNotificationBtn" class="settings-action-btn subtle" type="button" ${state?.serverNotificationTesting ? "disabled" : ""}>${state?.serverNotificationTesting ? "发送中…" : "发送测试 Webhook"}</button>
            <button class="settings-action-btn primary" type="submit" ${state?.serverNotificationSaving ? "disabled" : ""}>${state?.serverNotificationSaving ? "保存中…" : "保存 Webhook 设置"}</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">弹窗类型</div>
            <div class="settings-provider-meta">关闭某类 toast 后，相关操作仍会执行，只是不再弹出右上角提示。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("toastEnabled", "启用右上角 Toast", "总开关；关闭后除强制系统反馈外不再弹 toast。", prefs.toastEnabled)}
          ${renderNotificationToggle("infoToasts", "信息提示", "普通说明、复制成功和轻量操作反馈。", prefs.infoToasts)}
          ${renderNotificationToggle("successToasts", "成功提示", "保存、添加、切换等成功反馈。", prefs.successToasts)}
          ${renderNotificationToggle("warningToasts", "警告提示", "删除确认、刷新失败和需要注意的状态。", prefs.warningToasts)}
          ${renderNotificationToggle("errorToasts", "错误提示", "API 错误、校验失败和运行异常。建议保持开启。", prefs.errorToasts)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">通知时长</div>
            <div class="settings-provider-meta">影响自动消失时间；错误提示会比普通提示更久。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderNotificationDurationChoice("short", "短", "适合熟悉流程时减少干扰。", prefs.duration)}
          ${renderNotificationDurationChoice("normal", "标准", "默认节奏，兼顾可见性和不打断。", prefs.duration)}
          ${renderNotificationDurationChoice("long", "长", "适合演示或需要更久阅读提示。", prefs.duration)}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">终端提示</div>
            <div class="settings-provider-meta">控制 UI 操作提示是否写入右侧终端日志；真实 PTY 输出和命令回显不受影响。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("terminalNotices", "写入 UI 操作提示", "例如刷新统计、复制、导入凭据等 [info]/[warn]/[error] 日志。", prefs.terminalNotices)}
        </div>
      </section>
    </div>
  `;
  }

  function renderNotificationToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row notification-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-notification-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function renderServerNotificationToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row notification-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-server-notification-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function renderNotificationDurationChoice(value, title, description, current) {
    return `
    <button class="appearance-choice ${current === value ? "active" : ""}" type="button" data-notification-duration="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
  }

  function notificationDurationLabel(value) {
    if (value === "short") return "短";
    if (value === "long") return "长";
    return "标准";
  }

  function bindNotificationSettingsActions() {
    $("serverNotificationSettingsForm")?.addEventListener("submit", (event) => saveServerNotificationSettingsFromPanel(event).catch(showError));
    $("refreshServerNotificationSettingsBtn")?.addEventListener("click", () => loadServerNotificationSettings?.({ notify: true }).catch(showError));
    $("testServerNotificationBtn")?.addEventListener("click", () => testServerNotification?.().catch(showError));
    document.querySelectorAll("[data-server-notification-toggle]").forEach((node) => {
      node.addEventListener("change", () => saveServerNotificationSettingsFromPanel().catch(showError));
    });
    document.querySelectorAll("[data-notification-toggle]").forEach((node) => {
      node.addEventListener("change", () => setNotificationPreference(node.dataset.notificationToggle, node.checked));
    });
    document.querySelectorAll("[data-notification-duration]").forEach((node) => {
      node.addEventListener("click", () => setNotificationPreference("duration", node.dataset.notificationDuration));
    });
    $("testNotificationBtn")?.addEventListener("click", () => {
      showToast("这是一条测试通知。", "info", { force: true });
      notifyTerminal?.("[info] 测试通知已触发。\n");
    });
    $("resetNotificationPrefsBtn")?.addEventListener("click", resetNotificationPreferences);
  }

  async function saveServerNotificationSettingsFromPanel(event) {
    event?.preventDefault();
    const payload = {
      enabled: Boolean(document.querySelector('[data-server-notification-toggle="enabled"]')?.checked),
      notifyOnApproval: Boolean(document.querySelector('[data-server-notification-toggle="notifyOnApproval"]')?.checked),
      notifyOnDone: Boolean(document.querySelector('[data-server-notification-toggle="notifyOnDone"]')?.checked),
      notifyOnError: Boolean(document.querySelector('[data-server-notification-toggle="notifyOnError"]')?.checked),
      webhookUrl: $("serverNotificationWebhookUrl")?.value || "",
    };
    await saveServerNotificationSettings?.(payload);
  }
  function renderAppearanceSettingsContent() {
    const prefs = currentAppearancePreferences();
    return `
    <div class="settings-live-page appearance-page">
      <section class="settings-hero-card appearance-hero-card">
        <div>
          <div class="settings-hero-kicker">外观与界面</div>
          <div class="settings-hero-title">${escapeHtml(appearanceThemeLabel(prefs.theme))} · ${escapeHtml(appearanceDensityLabel(prefs.density))}</div>
          <p>这些偏好只保存在当前浏览器，不改服务端配置，适合本地工作台快速调整阅读密度和终端呈现方式。</p>
        </div>
        <div class="appearance-preview-card" aria-hidden="true">
          <div class="appearance-preview-bar"></div>
          <div class="appearance-preview-line wide"></div>
          <div class="appearance-preview-line"></div>
          <div class="appearance-preview-pill"></div>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(appearanceThemeLabel(prefs.theme))}</strong><span>主题</span></div>
        <div><strong>${escapeHtml(appearanceDensityLabel(prefs.density))}</strong><span>布局密度</span></div>
        <div><strong>${escapeHtml(prefs.terminalDefaultOpen ? "默认展开" : "默认收起")}</strong><span>终端</span></div>
      </div>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">视觉主题</div>
            <div class="settings-provider-meta">切换主工作台的深色 / 浅色变量；设置页仍保持高可读白底。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderAppearanceChoice("theme", "dark", "深色工作台", "适合长时间 coding，会保留当前默认质感。", prefs.theme === "dark")}
          ${renderAppearanceChoice("theme", "light", "浅色工作台", "适合白天演示和截图，主界面切到浅色变量。", prefs.theme === "light")}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">布局密度</div>
            <div class="settings-provider-meta">紧凑模式会压缩侧边栏、消息区和输入区间距，适合小屏或并排窗口。</div>
          </div>
        </div>
        <div class="appearance-choice-grid">
          ${renderAppearanceChoice("density", "comfortable", "舒适", "保持更宽松的行距和点击区域。", prefs.density === "comfortable")}
          ${renderAppearanceChoice("density", "compact", "紧凑", "减少留白，在同屏显示更多项目和消息。", prefs.density === "compact")}
        </div>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">界面行为</div>
            <div class="settings-provider-meta">控制启动时终端是否默认展开，以及 Agent WebSocket 事件是否写入终端日志。</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderAppearanceToggle("terminalDefaultOpen", "启动后展开终端", "关闭后，下次刷新页面会默认收起右侧终端面板。", prefs.terminalDefaultOpen)}
          ${renderAppearanceToggle("showEventLog", "显示 Agent 事件日志", "关闭后会隐藏 [event] 类型日志，但不会影响真实终端输出。", prefs.showEventLog)}
        </div>
      </section>
    </div>
  `;
  }

  function renderAppearanceChoice(field, value, title, description, active) {
    return `
    <button class="appearance-choice ${active ? "active" : ""}" type="button" data-appearance-field="${escapeAttr(field)}" data-appearance-value="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
  }

  function renderAppearanceToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-appearance-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function appearanceThemeLabel(value) {
    return value === "light" ? "浅色" : "深色";
  }

  function appearanceDensityLabel(value) {
    return value === "compact" ? "紧凑" : "舒适";
  }

  function bindAppearanceSettingsActions() {
    document.querySelectorAll("[data-appearance-field]").forEach((node) => {
      node.addEventListener("click", () => setAppearancePreference(node.dataset.appearanceField, node.dataset.appearanceValue));
    });
    document.querySelectorAll("[data-appearance-toggle]").forEach((node) => {
      node.addEventListener("change", () => setAppearancePreference(node.dataset.appearanceToggle, node.checked));
    });
  }

  return {
    bindAppearanceSettingsActions,
    bindIMGatewaySettingsActions,
    bindNetworkSearchSettingsActions,
    bindNotificationSettingsActions,
    bindProfileSettingsActions,
    renderAppearanceSettingsContent,
    renderIMGatewaySettingsContent,
    renderNetworkSearchSettingsContent,
    renderNotificationSettingsContent,
    renderProfileSettingsContent,
  };
}
