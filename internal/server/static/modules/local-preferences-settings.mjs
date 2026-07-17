import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { formatNumber } from "./formatters.mjs";
import { resolveUILocale, t } from "./i18n.mjs?v=apple-theme-1";
import { defaultIMGatewayPrefs, defaultSearchPrefs } from "./preferences-data.mjs?v=apple-theme-1";

export function createLocalPreferencesSettingsController({
  state,
  copyText,
  currentAppearancePreferences,
  currentIMGatewayPreferences,
  currentNotificationPreferences,
  currentProfilePreferences,
  currentRegionalPreferences,
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
  saveRegionalPreferences,
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
      <section class="settings-hero-card profile-hero-card settings-page-section settings-card">
        <div class="profile-hero-main settings-card-header">
          <div class="profile-avatar-preview">${escapeHtml(profile.avatarInitials)}</div>
          <div>
            <div class="settings-hero-kicker">${escapeHtml(t("profile.heroKicker"))}</div>
            <div class="settings-hero-title settings-card-title">${escapeHtml(profileDisplayName())}</div>
            <p class="settings-card-description">${escapeHtml(profile.roleLabel)} · ${escapeHtml(profile.workspaceLabel)}</p>
          </div>
        </div>
        <div class="settings-action-row settings-toolbar">
          <button id="resetProfilePrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("profile.reset"))}</button>
        </div>
      </section>
      <div class="settings-status-strip settings-stat-grid">
        <div class="settings-stat-card"><strong>${escapeHtml(profile.avatarInitials)}</strong><span>${escapeHtml(t("profile.avatarInitials"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(gitConfigured ? t("profile.filled") : t("profile.notFilled"))}</strong><span>${escapeHtml(t("profile.gitIdentity"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(t("profile.localBrowser"))}</strong><span>${escapeHtml(t("profile.saveLocation"))}</span></div>
      </div>
      <section class="settings-provider-section highlighted settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("profile.displaySectionTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("profile.displaySectionMeta"))}</div>
          </div>
        </div>
        <form id="profileSettingsForm" class="settings-profile-form settings-card-content">
          <div class="settings-provider-form-grid settings-form-grid">
            <label class="settings-form-field">${escapeHtml(t("profile.displayName"))}
              <input id="profileDisplayName" class="settings-field" value="${escapeAttr(profile.displayName)}" placeholder="${escapeAttr(t("profile.displayNamePlaceholder"))}" />
            </label>
            <label class="settings-form-field">${escapeHtml(t("profile.avatarInitialsLabel"))}
              <input id="profileAvatarInitials" class="settings-field" value="${escapeAttr(profile.avatarInitials)}" placeholder="${escapeAttr(t("profile.avatarInitialsPlaceholder"))}" maxlength="4" />
            </label>
            <label class="settings-form-field">${escapeHtml(t("profile.roleLabel"))}
              <input id="profileRoleLabel" class="settings-field" value="${escapeAttr(profile.roleLabel)}" placeholder="${escapeAttr(t("profile.roleLabelPlaceholder"))}" />
            </label>
            <label class="settings-form-field">${escapeHtml(t("profile.workspaceLabel"))}
              <input id="profileWorkspaceLabel" class="settings-field" value="${escapeAttr(profile.workspaceLabel)}" placeholder="${escapeAttr(t("profile.workspaceLabelPlaceholder"))}" />
            </label>
            <label class="settings-form-field">${escapeHtml(t("profile.gitName"))}
              <input id="profileGitName" class="settings-field" value="${escapeAttr(profile.gitName)}" placeholder="${escapeAttr(t("profile.gitNamePlaceholder"))}" />
            </label>
            <label class="settings-form-field">${escapeHtml(t("profile.gitEmail"))}
              <input id="profileGitEmail" class="settings-field" value="${escapeAttr(profile.gitEmail)}" placeholder="${escapeAttr(t("profile.gitEmailPlaceholder"))}" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions settings-card-footer settings-inline-actions">
            <button id="copyProfileGitEnvBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("profile.copyGit"))}</button>
            <button class="settings-action-btn primary" type="submit">${escapeHtml(t("profile.save"))}</button>
          </div>
        </form>
      </section>
      <div class="profile-info-grid">
        ${renderProfileInfoCard(t("profile.infoLocalTitle"), t("profile.infoLocalDesc"))}
        ${renderProfileInfoCard(t("profile.infoGitTitle"), gitConfigured ? t("profile.infoGitDescReady") : t("profile.infoGitDescEmpty"))}
        ${renderProfileInfoCard(t("profile.infoAccountTitle"), t("profile.infoAccountDesc"))}
      </div>
    </div>
  `;
  }

  function renderProfileInfoCard(title, description) {
    return `
    <section class="profile-info-card settings-card settings-card-content">
      <strong class="settings-card-title">${escapeHtml(title)}</strong>
      <span class="settings-card-description">${escapeHtml(description)}</span>
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
    notifyTerminal?.(`[info] ${t("profile.savedTerminal")}\n`);
  }
  function renderNetworkSearchSettingsContent() {
    const prefs = currentSearchPreferences();
    const allowedCount = prefs.allowedDomains ? prefs.allowedDomains.split("\n").filter(Boolean).length : 0;
    const blockedCount = prefs.blockedDomains ? prefs.blockedDomains.split("\n").filter(Boolean).length : 0;
    return `
    <div class="settings-live-page compact-settings-page network-search-page">
      <header class="compact-settings-header">
        <div class="compact-settings-heading">
          <div class="settings-hero-kicker">${escapeHtml(t("networkSearch.heroKicker"))}</div>
          <h1>${escapeHtml(prefs.enabled ? t("networkSearch.strategyTitle") : t("networkSearch.disabledTitle"))}</h1>
          <p>${escapeHtml(t("networkSearch.heroDescription"))}</p>
        </div>
        <div class="compact-settings-header-actions">
          <button id="copySearchPrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("networkSearch.copyConfig"))}</button>
          <button id="resetSearchPrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("networkSearch.reset"))}</button>
        </div>
      </header>
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy">
          <h3>${escapeHtml(t("networkSearch.strategyTitle"))}</h3>
          <p>${escapeHtml(t("networkSearch.strategyMeta"))}</p>
        </div>
        <form id="searchSettingsForm" class="compact-settings-section-controls">
          <div class="compact-settings-switch-list">
            ${renderSearchToggle("enabled", t("networkSearch.enabled"), t("networkSearch.enabledDesc"), prefs.enabled)}
            ${renderSearchToggle("confirmBeforeSearch", t("networkSearch.confirmBeforeSearch"), t("networkSearch.confirmBeforeSearchDesc"), prefs.confirmBeforeSearch)}
            ${renderSearchToggle("safeSearch", t("networkSearch.safeSearch"), t("networkSearch.safeSearchDesc"), prefs.safeSearch)}
            ${renderSearchToggle("preferGitHub", t("networkSearch.preferGitHub"), t("networkSearch.preferGitHubDesc"), prefs.preferGitHub)}
          </div>
          <div class="compact-settings-grid two-column">
            <label class="settings-form-field">${escapeHtml(t("networkSearch.providersTitle"))}
              <select id="searchProviderSelect" class="settings-field">
                ${[["duckduckgo", "providerDuckDuckGo"], ["brave", "providerBrave"], ["tavily", "providerTavily"], ["searxng", "providerSearXNG"], ["custom", "providerCustom"]].map(([value, key]) => `<option value="${value}" ${prefs.provider === value ? "selected" : ""}>${escapeHtml(t(`networkSearch.${key}`))}</option>`).join("")}
              </select>
            </label>
            <label class="settings-form-field">${escapeHtml(t("networkSearch.maxResultsLabel"))}
              <select id="searchMaxResults" class="settings-field">
                ${[3, 5, 10, 20].map((value) => `<option value="${value}" ${prefs.maxResults === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            ${prefs.provider === "custom" ? `<label class="settings-form-field full-width">${escapeHtml(t("networkSearch.customEndpoint"))}<input id="searchCustomEndpoint" class="settings-field" value="${escapeAttr(prefs.customEndpoint)}" placeholder="${escapeAttr(t("networkSearch.customEndpointPlaceholder"))}" /></label>` : ""}
            <label class="settings-form-field">${escapeHtml(t("networkSearch.allowedDomains"))} <span class="compact-settings-field-meta">${escapeHtml(formatNumber(allowedCount))}</span>
              <textarea id="searchAllowedDomains" class="settings-field settings-textarea" rows="4" placeholder="${escapeAttr(t("networkSearch.allowedDomainsPlaceholder"))}">${escapeHtml(prefs.allowedDomains)}</textarea>
            </label>
            <label class="settings-form-field">${escapeHtml(t("networkSearch.blockedDomains"))} <span class="compact-settings-field-meta">${escapeHtml(formatNumber(blockedCount))}</span>
              <textarea id="searchBlockedDomains" class="settings-field settings-textarea" rows="4" placeholder="${escapeAttr(t("networkSearch.blockedDomainsPlaceholder"))}">${escapeHtml(prefs.blockedDomains)}</textarea>
            </label>
          </div>
          <div class="compact-settings-footer">
            <button class="settings-action-btn primary" type="submit">${escapeHtml(t("networkSearch.saveStrategy"))}</button>
          </div>
        </form>
      </section>
    </div>
  `;
  }

  function renderSearchToggle(field, title, description, checked) {
    return `
    <label class="compact-settings-switch-row settings-switch-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-search-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function bindNetworkSearchSettingsActions() {
    $("searchSettingsForm")?.addEventListener("submit", (event) => saveSearchSettingsFromPanel(event).catch(showError));
    $("copySearchPrefsBtn")?.addEventListener("click", () => copyText(searchPrefsExport()));
    $("resetSearchPrefsBtn")?.addEventListener("click", resetSearchPreferences);
    $("searchProviderSelect")?.addEventListener("change", (event) => saveSearchPreferences({ ...currentSearchPreferences(), provider: event.currentTarget.value }, { notify: true }));
    document.querySelectorAll("[data-search-toggle]").forEach((node) => {
      node.addEventListener("change", () => saveSearchPreferences({ ...currentSearchPreferences(), [node.dataset.searchToggle]: node.checked }, { notify: true }));
    });
  }

  async function saveSearchSettingsFromPanel(event) {
    event.preventDefault();
    const current = currentSearchPreferences();
    saveSearchPreferences({
      ...current,
      provider: $("searchProviderSelect")?.value || current.provider || defaultSearchPrefs.provider,
      maxResults: Number($("searchMaxResults")?.value || defaultSearchPrefs.maxResults),
      customEndpoint: $("searchCustomEndpoint")?.value || "",
      allowedDomains: $("searchAllowedDomains")?.value || "",
      blockedDomains: $("searchBlockedDomains")?.value || "",
    }, { notify: true });
    notifyTerminal?.(`[info] ${t("networkSearch.savedTerminal")}\n`);
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
          <div class="settings-hero-kicker">${escapeHtml(t("imGateway.heroKicker"))}</div>
          <div class="settings-hero-title">${escapeHtml(prefs.enabled ? imGatewayChannelLabel(prefs.channel) : t("imGateway.disabledTitle"))}</div>
          <p>${escapeHtml(t("imGateway.heroDescription"))}</p>
        </div>
        <div class="settings-action-row settings-toolbar">
          <button id="copyIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("imGateway.copyConfig"))}</button>
          <button id="resetIMGatewayPrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("imGateway.reset"))}</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div class="settings-stat-card"><strong>${escapeHtml(prefs.enabled ? t("imGateway.on") : t("imGateway.off"))}</strong><span>${escapeHtml(t("imGateway.permission"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(imGatewayChannelLabel(prefs.channel))}</strong><span>${escapeHtml(t("imGateway.channel"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(formatNumber(enabledEvents))}</strong><span>${escapeHtml(t("imGateway.enabledEvents"))}</span></div>
      </div>
      <section class="settings-provider-section highlighted settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("imGateway.securityTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("imGateway.securityMeta"))}</div>
          </div>
          <span class="settings-status-pill settings-badge ${prefs.enabled ? "warn" : "muted"}">${escapeHtml(prefs.enabled ? t("imGateway.needsSecureGateway") : t("imGateway.localPlanOnly"))}</span>
        </div>
        <form id="imGatewaySettingsForm" class="settings-im-form">
          <div class="appearance-toggle-list">
            ${renderIMGatewayToggle("enabled", t("imGateway.enabled"), t("imGateway.enabledDesc"), prefs.enabled)}
            ${renderIMGatewayToggle("inboundConfirm", t("imGateway.inboundConfirm"), t("imGateway.inboundConfirmDesc"), prefs.inboundConfirm)}
            ${renderIMGatewayToggle("requireSignature", t("imGateway.requireSignature"), t("imGateway.requireSignatureDesc"), prefs.requireSignature)}
            ${renderIMGatewayToggle("redactSecrets", t("imGateway.redactSecrets"), t("imGateway.redactSecretsDesc"), prefs.redactSecrets)}
          </div>
          <div class="settings-provider-form-grid settings-form-grid im-form-grid">
            <label class="settings-form-field">${escapeHtml(t("imGateway.maxPayload"))}
              <select id="imGatewayMaxPayload" class="settings-field">
                ${[32, 64, 128, 256].map((value) => `<option value="${value}" ${prefs.maxPayloadKB === value ? "selected" : ""}>${value} KB</option>`).join("")}
              </select>
            </label>
            <label class="settings-form-field">${escapeHtml(t("imGateway.endpoint"))}
              <input id="imGatewayEndpoint" class="settings-field" value="${escapeAttr(prefs.endpointUrl)}" placeholder="${escapeAttr(t("imGateway.endpointPlaceholder"))}" />
            </label>
            <label class="settings-form-span-2 settings-form-field">${escapeHtml(t("imGateway.allowedOrigins"))}
              <textarea id="imGatewayAllowedOrigins" class="settings-field settings-textarea" rows="4" placeholder="${escapeAttr(t("imGateway.allowedOriginsPlaceholder"))}">${escapeHtml(prefs.allowedOrigins)}</textarea>
            </label>
            <label class="settings-form-span-2 settings-form-field">${escapeHtml(t("imGateway.blockedSenders"))}
              <textarea id="imGatewayBlockedSenders" class="settings-field settings-textarea" rows="4" placeholder="${escapeAttr(t("imGateway.blockedSendersPlaceholder"))}">${escapeHtml(prefs.blockedSenders)}</textarea>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions settings-card-footer settings-inline-actions">
            <button class="settings-action-btn primary" type="submit">${escapeHtml(t("imGateway.saveStrategy"))}</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("imGateway.channelsTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("imGateway.channelsMeta"))}</div>
          </div>
        </div>
        <div class="im-channel-grid">
          ${renderIMGatewayChannelChoice("webhook", t("imGateway.channelWebhook"), t("imGateway.channelWebhookDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("discord", t("imGateway.channelDiscord"), t("imGateway.channelDiscordDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("slack", t("imGateway.channelSlack"), t("imGateway.channelSlackDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("telegram", t("imGateway.channelTelegram"), t("imGateway.channelTelegramDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("lark", t("imGateway.channelLark"), t("imGateway.channelLarkDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("wecom", t("imGateway.channelWecom"), t("imGateway.channelWecomDesc"), prefs.channel)}
          ${renderIMGatewayChannelChoice("custom", t("imGateway.channelCustom"), t("imGateway.channelCustomDesc"), prefs.channel)}
        </div>
      </section>
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("imGateway.eventsTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("imGateway.eventsMeta"))}</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderIMGatewayToggle("allowInboundMessages", t("imGateway.allowInboundMessages"), t("imGateway.allowInboundMessagesDesc"), prefs.allowInboundMessages)}
          ${renderIMGatewayToggle("notifyOnTaskDone", t("imGateway.notifyOnTaskDone"), t("imGateway.notifyOnTaskDoneDesc"), prefs.notifyOnTaskDone)}
          ${renderIMGatewayToggle("notifyOnErrors", t("imGateway.notifyOnErrors"), t("imGateway.notifyOnErrorsDesc"), prefs.notifyOnErrors)}
          ${renderIMGatewayToggle("notifyOnToolCalls", t("imGateway.notifyOnToolCalls"), t("imGateway.notifyOnToolCallsDesc"), prefs.notifyOnToolCalls)}
        </div>
      </section>
      <div class="im-policy-grid">
        ${renderIMGatewayPolicyCard(t("imGateway.policyAllowedOrigins"), formatNumber(allowedCount), allowedCount ? t("imGateway.policyAllowedSet") : t("imGateway.policyAllowedEmpty"))}
        ${renderIMGatewayPolicyCard(t("imGateway.policyBlockedSenders"), formatNumber(blockedCount), blockedCount ? t("imGateway.policyBlockedSet") : t("imGateway.policyBlockedEmpty"))}
        ${renderIMGatewayPolicyCard(t("imGateway.policyPayload"), `${formatNumber(prefs.maxPayloadKB)} KB`, t("imGateway.policyPayloadHint"))}
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
    notifyTerminal?.(`[info] ${t("imGateway.savedTerminal")}\n`);
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
      <section class="settings-hero-card notification-hero-card settings-page-section settings-card">
        <div>
          <div class="settings-hero-kicker">${escapeHtml(t("notification.heroKicker"))}</div>
          <div class="settings-hero-title settings-card-title">${escapeHtml(prefs.toastEnabled ? t("notification.toastEnabledTitle") : t("notification.toastDisabledTitle"))}</div>
          <p class="settings-card-description">${escapeHtml(t("notification.heroDescription"))}</p>
        </div>
        <div class="settings-action-row settings-toolbar">
          <button id="testNotificationBtn" class="settings-action-btn primary" type="button">${escapeHtml(t("notification.test"))}</button>
          <button id="resetNotificationPrefsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("notification.reset"))}</button>
        </div>
      </section>
      <div class="settings-status-strip settings-stat-grid">
        <div class="settings-stat-card"><strong>${escapeHtml(prefs.toastEnabled ? t("notification.on") : t("notification.off"))}</strong><span>${escapeHtml(t("notification.toasts"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(formatNumber(enabledCount))}</strong><span>${escapeHtml(t("notification.enabledTypes"))}</span></div>
        <div class="settings-stat-card"><strong>${escapeHtml(notificationDurationLabel(prefs.duration))}</strong><span>${escapeHtml(t("notification.duration"))}</span></div>
      </div>
      <section class="settings-provider-section highlighted settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("notification.webhookTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("notification.webhookMeta"))}</div>
          </div>
          <span class="settings-status-pill settings-badge ${serverSettings.enabled ? "ok" : "muted"}">${escapeHtml(state?.serverNotificationLoading ? t("notification.loading") : (serverSettings.enabled ? t("notification.enabledStatus") : t("notification.disabledStatus")))}</span>
        </div>
        ${state?.serverNotificationError ? `<div class="settings-inline-alert settings-alert" role="alert">${escapeHtml(state.serverNotificationError)}</div>` : ""}
        <form id="serverNotificationSettingsForm" class="settings-im-form settings-card-content">
          <div class="appearance-toggle-list">
            ${renderServerNotificationToggle("enabled", t("notification.enableWebhook"), t("notification.enableWebhookDesc"), serverSettings.enabled)}
            ${renderServerNotificationToggle("notifyOnApproval", t("notification.notifyOnApproval"), t("notification.notifyOnApprovalDesc"), serverSettings.notifyOnApproval !== false)}
            ${renderServerNotificationToggle("notifyOnDone", t("notification.notifyOnDone"), t("notification.notifyOnDoneDesc"), serverSettings.notifyOnDone !== false)}
            ${renderServerNotificationToggle("notifyOnError", t("notification.notifyOnError"), t("notification.notifyOnErrorDesc"), serverSettings.notifyOnError !== false)}
          </div>
          <div class="settings-provider-form-grid settings-form-grid im-form-grid">
            <label class="settings-form-span-2 settings-form-field">${escapeHtml(t("notification.webhookUrl"))}
              <input id="serverNotificationWebhookUrl" class="settings-field" value="${escapeAttr(serverSettings.webhookUrl || "")}" placeholder="${escapeAttr(t("notification.webhookUrlPlaceholder"))}" />
            </label>
          </div>
          <div class="settings-action-row settings-form-actions settings-card-footer settings-inline-actions">
            <button id="refreshServerNotificationSettingsBtn" class="settings-action-btn subtle" type="button">${escapeHtml(t("notification.refreshServer"))}</button>
            <button id="testServerNotificationBtn" class="settings-action-btn subtle" type="button" ${state?.serverNotificationTesting ? "disabled" : ""}>${escapeHtml(state?.serverNotificationTesting ? t("notification.sending") : t("notification.sendTestWebhook"))}</button>
            <button class="settings-action-btn primary" type="submit" ${state?.serverNotificationSaving ? "disabled" : ""}>${escapeHtml(state?.serverNotificationSaving ? t("notification.saving") : t("notification.saveWebhook"))}</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("notification.toastTypesTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("notification.toastTypesMeta"))}</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("toastEnabled", t("notification.toastEnabled"), t("notification.toastEnabledDesc"), prefs.toastEnabled)}
          ${renderNotificationToggle("infoToasts", t("notification.infoToasts"), t("notification.infoToastsDesc"), prefs.infoToasts)}
          ${renderNotificationToggle("successToasts", t("notification.successToasts"), t("notification.successToastsDesc"), prefs.successToasts)}
          ${renderNotificationToggle("warningToasts", t("notification.warningToasts"), t("notification.warningToastsDesc"), prefs.warningToasts)}
          ${renderNotificationToggle("errorToasts", t("notification.errorToasts"), t("notification.errorToastsDesc"), prefs.errorToasts)}
        </div>
      </section>
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("notification.durationTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("notification.durationMeta"))}</div>
          </div>
        </div>
        <div class="appearance-choice-grid settings-choice-grid" role="radiogroup">
          ${renderNotificationDurationChoice("short", t("notification.durationShort"), t("notification.durationShortDesc"), prefs.duration)}
          ${renderNotificationDurationChoice("normal", t("notification.durationNormal"), t("notification.durationNormalDesc"), prefs.duration)}
          ${renderNotificationDurationChoice("long", t("notification.durationLong"), t("notification.durationLongDesc"), prefs.duration)}
        </div>
      </section>
      <section class="settings-provider-section settings-page-section settings-card">
        <div class="settings-provider-section-head settings-card-header">
          <div>
            <div class="settings-provider-title settings-card-title">${escapeHtml(t("notification.terminalTitle"))}</div>
            <div class="settings-provider-meta settings-card-description">${escapeHtml(t("notification.terminalMeta"))}</div>
          </div>
        </div>
        <div class="appearance-toggle-list">
          ${renderNotificationToggle("terminalNotices", t("notification.terminalNotices"), t("notification.terminalNoticesDesc"), prefs.terminalNotices)}
        </div>
      </section>
    </div>
  `;
  }

  function renderNotificationToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row notification-toggle-row settings-switch-row">
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
    <label class="appearance-toggle-row notification-toggle-row settings-switch-row">
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
    <button class="appearance-choice settings-choice-card ${current === value ? "active" : ""}" type="button" role="radio" aria-checked="${current === value}" data-notification-duration="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
  }

  function notificationDurationLabel(value) {
    if (value === "short") return t("notification.durationShort");
    if (value === "long") return t("notification.durationLong");
    return t("notification.durationNormal");
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
      showToast(t("notification.testToast"), "info", { force: true });
      notifyTerminal?.(`[info] ${t("notification.testTerminal")}\n`);
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
    const regional = currentRegionalPreferences?.() || { locale: "auto", timezone: "auto" };
    const uiLocale = resolveUILocale(regional.locale);
    return `
    <div class="settings-live-page compact-settings-page appearance-page">
      <header class="compact-settings-header">
        <div class="compact-settings-heading">
          <div class="settings-hero-kicker">${escapeHtml(t("appearance.heroKicker"))}</div>
          <h1>${escapeHtml(appearanceThemeLabel(prefs.themePreset))} · ${escapeHtml(appearanceDensityLabel(prefs.density))}</h1>
          <p>${escapeHtml(t("appearance.heroDescription"))}</p>
        </div>
      </header>
      <section class="compact-settings-section appearance-language-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("appearance.languageTitle"))}</h2><p>${escapeHtml(t("appearance.languageMeta"))}</p></div>
        <div class="compact-settings-section-controls"><label class="settings-form-field compact-settings-field" for="appearanceLanguageSelect"><span>${escapeHtml(t("language.label"))}</span><select id="appearanceLanguageSelect" class="settings-field"><option value="zh-TW" ${uiLocale === "zh-TW" ? "selected" : ""}>${escapeHtml(t("language.traditionalChinese"))}</option><option value="zh-CN" ${uiLocale === "zh-CN" ? "selected" : ""}>${escapeHtml(t("language.simplifiedChinese"))}</option><option value="en-US" ${uiLocale === "en" ? "selected" : ""}>${escapeHtml(t("language.english"))}</option></select><small>${escapeHtml(t("language.description"))}</small></label></div>
      </section>
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("appearance.themeSectionTitle"))}</h2><p>${escapeHtml(t("appearance.themeSectionMeta"))}</p></div>
        <div class="compact-settings-section-controls"><div class="appearance-theme-grid compact-settings-choice-grid four-column" role="radiogroup" aria-label="${escapeAttr(t("appearance.themeSectionTitle"))}">${renderThemePresetChoice("light", t("appearance.themeLight"), t("appearance.themeLightDesc"), prefs.themePreset === "light")}${renderThemePresetChoice("dark", t("appearance.themeDark"), t("appearance.themeDarkDesc"), prefs.themePreset === "dark")}${renderThemePresetChoice("cyber", t("appearance.themeCyber"), t("appearance.themeCyberDesc"), prefs.themePreset === "cyber")}${renderThemePresetChoice("cream", t("appearance.themeCream"), t("appearance.themeCreamDesc"), prefs.themePreset === "cream")}${renderThemePresetChoice("apple", t("appearance.themeApple"), t("appearance.themeAppleDesc"), prefs.themePreset === "apple")}</div></div>
      </section>
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("appearance.densitySectionTitle"))}</h2><p>${escapeHtml(t("appearance.densitySectionMeta"))}</p></div>
        <div class="compact-settings-section-controls"><div class="appearance-choice-grid compact-settings-choice-grid two-column" role="radiogroup">${renderAppearanceChoice("density", "comfortable", t("appearance.densityComfortable"), t("appearance.densityComfortableDesc"), prefs.density === "comfortable")}${renderAppearanceChoice("density", "compact", t("appearance.densityCompact"), t("appearance.densityCompactDesc"), prefs.density === "compact")}</div></div>
      </section>
      <section class="compact-settings-section">
        <div class="compact-settings-section-copy"><h2>${escapeHtml(t("appearance.behaviorTitle"))}</h2><p>${escapeHtml(t("appearance.behaviorMeta"))}</p></div>
        <div class="compact-settings-section-controls compact-settings-switch-list">${renderAppearanceToggle("terminalDefaultOpen", t("appearance.terminalDefaultOpen"), t("appearance.terminalDefaultOpenDesc"), prefs.terminalDefaultOpen)}${renderAppearanceToggle("showEventLog", t("appearance.showEventLog"), t("appearance.showEventLogDesc"), prefs.showEventLog)}</div>
      </section>
    </div>
  `;
  }

  function renderAppearanceChoice(field, value, title, description, active) {
    return `
    <button class="appearance-choice settings-choice-card ${active ? "active" : ""}" type="button" role="radio" aria-checked="${active}" data-appearance-field="${escapeAttr(field)}" data-appearance-value="${escapeAttr(value)}">
      <span>${escapeHtml(title)}</span>
      <small>${escapeHtml(description)}</small>
    </button>
  `;
  }

  function renderThemePresetChoice(value, title, description, active) {
    return `
    <button class="appearance-choice appearance-theme-choice settings-choice-card ${active ? "active" : ""}" type="button" role="radio" aria-checked="${active}" data-appearance-field="themePreset" data-appearance-value="${escapeAttr(value)}">
      <span class="theme-preset-preview theme-preset-preview-${escapeAttr(value)}" aria-hidden="true"><i></i><b></b><em></em></span>
      <span class="appearance-theme-choice-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
    </button>
  `;
  }

  function renderAppearanceToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row settings-switch-row">
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <input type="checkbox" data-appearance-toggle="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function appearanceThemeLabel(value) {
    return {
      light: t("appearance.themeLightLabel"),
      dark: t("appearance.themeDarkLabel"),
      cyber: t("appearance.themeCyberLabel"),
      cream: t("appearance.themeCreamLabel"),
      apple: t("appearance.themeAppleLabel"),
    }[value] || t("appearance.themeLightLabel");
  }

  function appearanceDensityLabel(value) {
    return value === "compact" ? t("appearance.densityCompactLabel") : t("appearance.densityComfortableLabel");
  }

  function bindAppearanceSettingsActions() {
    $("appearanceLanguageSelect")?.addEventListener("change", (event) => {
      saveRegionalPreferences?.({
        ...(currentRegionalPreferences?.() || { timezone: "auto" }),
        locale: event.currentTarget.value,
      }, { notify: true });
      globalThis.setTimeout?.(() => globalThis.location?.reload?.(), 80);
    });
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
