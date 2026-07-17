import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { t } from "./i18n.mjs?v=remote-control-full-1";
import { applyRemoteAccessFailClosed, fullAccessAllowed, remoteAccessContext } from "./remote-access-capabilities.mjs";

const endpoint = "/api/security/remote-access";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizeRemoteAccess(value = {}) {
  const source = objectValue(value);
  const credential = objectValue(source.credential);
  const policy = objectValue(source.policy);
  const session = objectValue(source.session);
  const capabilities = objectValue(source.capabilities);
  const sessionMode = textValue(session.mode, "local");
  const revision = Number(policy.revision);
  return {
    credential: {
      configured: Boolean(credential.configured),
      source: textValue(credential.source, "none"),
    },
    policy: {
      allowFullAccess: Boolean(policy.allowFullAccess),
      defaultMode: ["restricted", "full"].includes(textValue(policy.defaultMode)) ? textValue(policy.defaultMode) : "restricted",
      allowRemoteNativePicker: Boolean(policy.allowRemoteNativePicker),
      revision: Number.isSafeInteger(revision) && revision >= 1 ? revision : 0,
    },
    session: {
      remote: Boolean(session.remote),
      authenticated: Boolean(session.authenticated),
      mode: ["restricted", "full", "local"].includes(sessionMode) ? sessionMode : "restricted",
      expiresAt: textValue(session.expiresAt),
    },
    capabilities: {
      maxPermissionMode: textValue(capabilities.maxPermissionMode, "acceptEdits"),
      terminalAllowed: Boolean(capabilities.terminalAllowed),
      filesystemScope: ["host", "full"].includes(textValue(capabilities.filesystemScope).toLowerCase()) ? "full" : "restricted",
      nativePickerAllowed: Boolean(capabilities.nativePickerAllowed),
      securityAdminAllowed: Boolean(capabilities.securityAdminAllowed),
    },
  };
}

function hasAuthoritativeRemoteAccessState(value) {
  const source = objectValue(value);
  const session = objectValue(source.session);
  const capabilities = objectValue(source.capabilities);
  return typeof session.remote === "boolean"
    && typeof session.authenticated === "boolean"
    && typeof session.mode === "string"
    && typeof capabilities.maxPermissionMode === "string"
    && typeof capabilities.terminalAllowed === "boolean"
    && typeof capabilities.filesystemScope === "string"
    && typeof capabilities.nativePickerAllowed === "boolean"
    && typeof capabilities.securityAdminAllowed === "boolean";
}

export function isEnvironmentCredential(source) {
  const value = String(source || "").trim().toLowerCase();
  return value === "environment" || value === "env";
}

export function policyPayload(access, draft, currentPassword = "") {
  const normalizedAccess = normalizeRemoteAccess(access);
  const normalizedDraft = objectValue(draft);
  const defaultMode = normalizedDraft.defaultMode === "full" ? "full" : "restricted";
  const payload = {
    allowFullAccess: defaultMode === "full",
    defaultMode,
    allowRemoteNativePicker: Boolean(normalizedDraft.allowRemoteNativePicker),
    revision: normalizedAccess.policy.revision,
  };
  const password = String(currentPassword || "");
  if (password) payload.currentPassword = password;
  return payload;
}

export function passwordPayload(strategy, password = "", currentPassword = "") {
  const normalizedStrategy = strategy === "custom" ? "custom" : "generate";
  const payload = { strategy: normalizedStrategy };
  if (normalizedStrategy === "custom") payload.password = String(password || "");
  const current = String(currentPassword || "");
  if (current) payload.currentPassword = current;
  return payload;
}

export function createRemoteAccessSettingsController({
  state,
  request,
  copyText,
  onChange,
  showError,
  showToast,
}) {
  let generatedPassword = "";
  let remoteSessionRevoked = false;
  let loadSequence = 0;
  let authorizationEpoch = 0;

  const rt = (key, params = {}) => t(`remoteAccess.${key}`, params);

  function access() {
    return normalizeRemoteAccess(state?.remoteAccess || {});
  }

  function requiresCurrentPassword() {
    const session = access().session;
    return Boolean(session.remote && session.authenticated);
  }

  function invalidateRemoteSessionIfNeeded(wasRemote) {
    if (!wasRemote) return;
    const current = access();
    remoteSessionRevoked = true;
    state.remoteAccessFailClosed = true;
    state.remoteAccess = normalizeRemoteAccess({
      ...current,
      session: { ...current.session, authenticated: false, expiresAt: "" },
      capabilities: {
        maxPermissionMode: "acceptEdits",
        terminalAllowed: false,
        filesystemScope: "project",
        nativePickerAllowed: false,
        securityAdminAllowed: false,
      },
    });
  }

  function invalidatePendingLoads({ status } = {}) {
    authorizationEpoch += 1;
    if (Number(status) === 401) remoteSessionRevoked = true;
    return authorizationEpoch;
  }

  async function load() {
    const sequence = ++loadSequence;
    const startedAuthorizationEpoch = authorizationEpoch;
    state.remoteAccessLoading = true;
    state.remoteAccessError = "";
    const remoteBeforeLoad = remoteAccessContext(state);
    const current = () => sequence === loadSequence && startedAuthorizationEpoch === authorizationEpoch;
    try {
      const result = await request(endpoint);
      if (!current()) return state.remoteAccess;
      state.remoteAccess = normalizeRemoteAccess(result);
      if (hasAuthoritativeRemoteAccessState(result)) {
        state.remoteAccessFailClosed = false;
        remoteSessionRevoked = false;
      } else if (remoteBeforeLoad || state.remoteAccess.session.remote) {
        applyRemoteAccessFailClosed(state);
      }
      return state.remoteAccess;
    } catch (err) {
      if (!current()) throw err;
      state.remoteAccessError = err?.message || String(err);
      // A local-token failure is not evidence that localhost became a remote
      // session. Only a context already known to be remote may synthesize the
      // conservative remote capability set.
      if (remoteBeforeLoad) {
        applyRemoteAccessFailClosed(state, { status: err?.status });
        remoteSessionRevoked = err?.status === 401;
      }
      throw err;
    } finally {
      if (sequence === loadSequence) {
        state.remoteAccessLoading = false;
        onChange?.(state.remoteAccess);
      }
    }
  }

  async function savePolicy(draft, currentPassword = "") {
    const current = access();
    const result = await request(`${endpoint}/policy`, {
      method: "PATCH",
      body: JSON.stringify(policyPayload(current, draft, currentPassword)),
    });
    state.remoteAccess = normalizeRemoteAccess({ ...current, policy: result });
    generatedPassword = "";
    invalidateRemoteSessionIfNeeded(current.session.remote);
    showToast?.(rt("policySaved"));
    onChange?.(state.remoteAccess);
    return state.remoteAccess;
  }

  async function updatePassword(strategy, password = "", currentPassword = "") {
    const current = access();
    const result = await request(`${endpoint}/password`, {
      method: "PUT",
      body: JSON.stringify(passwordPayload(strategy, password, currentPassword)),
    });
    generatedPassword = strategy === "generate" ? textValue(result?.generatedPassword) : "";
    state.remoteAccess = normalizeRemoteAccess({
      ...current,
      credential: result?.credential || { configured: true, source: "config" },
      policy: { ...current.policy, revision: result?.revision || current.policy.revision },
    });
    invalidateRemoteSessionIfNeeded(current.session.remote);
    showToast?.(rt(strategy === "generate" ? "passwordGenerated" : "passwordUpdated"));
    onChange?.(state.remoteAccess);
    return { access: state.remoteAccess, generatedPassword };
  }

  function currentPasswordField(id) {
    if (!requiresCurrentPassword() || !access().capabilities.securityAdminAllowed) return "";
    return `<label class="settings-form-field remote-access-current-password">${escapeHtml(rt("currentPassword"))}<input id="${escapeAttr(id)}" class="settings-field" type="password" autocomplete="current-password" required placeholder="${escapeAttr(rt("currentPasswordPlaceholder"))}" /><small>${escapeHtml(rt("currentPasswordHint"))}</small></label>`;
  }

  function capabilityValue(value) {
    return value ? rt("allowed") : rt("blocked");
  }

  function sessionModeLabel(mode) {
    if (mode === "full") return rt("full");
    if (mode === "restricted") return rt("restricted");
    return rt("local");
  }

  function render() {
    const value = access();
    const environmentCredential = isEnvironmentCredential(value.credential.source);
    const fullAllowed = fullAccessAllowed(state);
    const securityAdminAllowed = value.capabilities.securityAdminAllowed;
    if (!state?.remoteAccess && state?.remoteAccessLoading) {
      return `<div class="settings-empty-card settings-empty-state">${escapeHtml(rt("loading"))}</div>`;
    }
    return `
      <div class="settings-live-page remote-access-page">
        <section class="settings-hero-card settings-page-section settings-card remote-access-hero">
          <div class="settings-card-header">
            <div>
              <div class="settings-hero-kicker">${escapeHtml(rt("session"))}</div>
              <div class="settings-hero-title settings-card-title">${escapeHtml(value.session.remote ? rt("remote") : rt("local"))}</div>
              <p class="settings-card-description" data-settings-help-copy>${escapeHtml(rt("description"))}</p>
            </div>
            <span class="settings-status-pill settings-badge ${value.session.authenticated ? "ok" : "warn"}">${escapeHtml(value.session.authenticated ? rt("authenticated") : rt("unauthenticated"))}</span>
          </div>
          <div class="settings-action-row settings-card-footer"><button id="refreshRemoteAccessBtn" class="settings-action-btn subtle" type="button">${escapeHtml(rt("refresh"))}</button></div>
        </section>
        ${remoteSessionRevoked ? `<div class="settings-inline-alert settings-alert" role="status"><span>${escapeHtml(rt("sessionRevoked"))}</span> <a class="settings-action-btn subtle" href="/auth/remote-access">${escapeHtml(rt("signInAgain"))}</a></div>` : ""}
        ${state?.remoteAccessError ? `<div class="settings-inline-alert settings-alert" role="alert">${escapeHtml(state.remoteAccessError)}</div>` : ""}
        ${!securityAdminAllowed ? `<div class="settings-inline-alert settings-alert" role="status">${escapeHtml(rt("localOnlyNotice"))}</div>` : ""}
        <div class="remote-access-summary-grid settings-stat-grid">
          <div class="settings-stat-card"><strong>${escapeHtml(sessionModeLabel(value.session.mode))}</strong><span>${escapeHtml(rt("mode"))}</span></div>
          <div class="settings-stat-card"><strong>${escapeHtml(value.credential.configured ? rt("configured") : rt("notConfigured"))}</strong><span>${escapeHtml(rt("credential"))}</span></div>
          <div class="settings-stat-card"><strong>${escapeHtml(value.credential.source)}</strong><span>${escapeHtml(rt("source"))}</span></div>
          <div class="settings-stat-card"><strong>${escapeHtml(value.session.expiresAt || rt("never"))}</strong><span>${escapeHtml(rt("expiresAt"))}</span></div>
        </div>
        <section class="settings-provider-section settings-page-section settings-card">
          <div class="settings-provider-section-head settings-card-header"><div><div class="settings-provider-title settings-card-title">${escapeHtml(rt("policy"))}</div><div class="settings-provider-meta settings-card-description" data-settings-help-copy>${escapeHtml(rt("allowFullAccessHint"))}</div></div></div>
          <form id="remoteAccessPolicyForm" class="settings-card-content remote-access-policy-form">
            <div class="settings-provider-form-grid settings-form-grid">
              <label class="settings-form-field">${escapeHtml(rt("defaultMode"))}<select id="remoteAccessDefaultMode" class="settings-field" ${securityAdminAllowed ? "" : "disabled"}><option value="restricted" ${value.policy.defaultMode === "restricted" ? "selected" : ""}>${escapeHtml(rt("restricted"))}</option><option value="full" ${value.policy.defaultMode === "full" ? "selected" : ""} ${fullAllowed && securityAdminAllowed ? "" : "disabled"}>${escapeHtml(rt("full"))}</option></select><small${fullAllowed ? " data-settings-help-copy" : ""}>${escapeHtml(fullAllowed ? rt("allowFullAccessHint") : rt("fullModeUnavailable"))}</small></label>
              <label class="settings-check-row"><input id="remoteAccessNativePicker" type="checkbox" ${value.policy.allowRemoteNativePicker ? "checked" : ""} ${securityAdminAllowed ? "" : "disabled"} /><span><strong>${escapeHtml(rt("nativePicker"))}</strong><small data-settings-help-copy>${escapeHtml(rt("nativePickerHint"))}</small></span></label>
              ${currentPasswordField("remoteAccessPolicyCurrentPassword")}
            </div>
            <div class="settings-action-row settings-card-footer"><span class="settings-provider-meta">${escapeHtml(`${rt("revision")}: ${value.policy.revision || "—"}`)}</span><button class="settings-action-btn primary" type="submit" data-remote-policy-submit ${securityAdminAllowed ? "" : "disabled"}>${escapeHtml(rt("savePolicy"))}</button></div>
          </form>
        </section>
        <section class="settings-provider-section settings-page-section settings-card">
          <div class="settings-provider-section-head settings-card-header"><div><div class="settings-provider-title settings-card-title">${escapeHtml(rt("credential"))}</div><div class="settings-provider-meta settings-card-description">${escapeHtml(`${rt("source")}: ${value.credential.source}`)}</div></div></div>
          ${environmentCredential ? `<div class="settings-inline-alert settings-alert" role="status">${escapeHtml(rt("environmentReadonly"))}</div>` : `
            <div class="remote-access-password-grid settings-card-content">
              <form id="remoteAccessGeneratePasswordForm" class="remote-access-password-form"><strong>${escapeHtml(rt("generatePassword"))}</strong>${currentPasswordField("remoteAccessGenerateCurrentPassword")}<button class="settings-action-btn subtle" type="submit" data-remote-generate-submit ${securityAdminAllowed ? "" : "disabled"}>${escapeHtml(rt("generatePassword"))}</button></form>
              <form id="remoteAccessCustomPasswordForm" class="remote-access-password-form"><label class="settings-form-field">${escapeHtml(rt("customPassword"))}<input id="remoteAccessCustomPassword" class="settings-field" type="password" autocomplete="new-password" required ${securityAdminAllowed ? "" : "disabled"} placeholder="${escapeAttr(rt("customPasswordPlaceholder"))}" /></label>${currentPasswordField("remoteAccessCustomCurrentPassword")}<button class="settings-action-btn primary" type="submit" data-remote-custom-submit ${securityAdminAllowed ? "" : "disabled"}>${escapeHtml(rt("updatePassword"))}</button></form>
            </div>`}
          ${generatedPassword ? `<div class="remote-access-generated settings-inline-alert" role="status"><strong>${escapeHtml(rt("generatedPassword"))}</strong><code>${escapeHtml(generatedPassword)}</code><span>${escapeHtml(rt("generatedPasswordHint"))}</span><button id="copyGeneratedRemotePasswordBtn" class="settings-action-btn subtle" type="button">${escapeHtml(rt("copyPassword"))}</button></div>` : ""}
        </section>
        <section class="settings-provider-section settings-page-section settings-card">
          <div class="settings-provider-section-head settings-card-header"><div><div class="settings-provider-title settings-card-title">${escapeHtml(rt("capabilities"))}</div></div></div>
          <div class="runtime-kv-list settings-data-list settings-card-content">
            <div><span>${escapeHtml(rt("maxPermissionMode"))}</span><strong>${escapeHtml(value.capabilities.maxPermissionMode)}</strong></div>
            <div><span>${escapeHtml(rt("terminalAllowed"))}</span><strong>${escapeHtml(capabilityValue(value.capabilities.terminalAllowed))}</strong></div>
            <div><span>${escapeHtml(rt("filesystemScope"))}</span><strong>${escapeHtml(value.capabilities.filesystemScope)}</strong></div>
            <div><span>${escapeHtml(rt("nativePickerAllowed"))}</span><strong>${escapeHtml(capabilityValue(value.capabilities.nativePickerAllowed))}</strong></div>
            <div><span>${escapeHtml(rt("securityAdminAllowed"))}</span><strong>${escapeHtml(capabilityValue(value.capabilities.securityAdminAllowed))}</strong></div>
          </div>
        </section>
      </div>`;
  }

  async function submitPolicy(form) {
    const defaultMode = $("remoteAccessDefaultMode")?.value === "full" ? "full" : "restricted";
    await savePolicy({
      defaultMode,
      allowRemoteNativePicker: Boolean($("remoteAccessNativePicker")?.checked),
    }, $("remoteAccessPolicyCurrentPassword")?.value || "");
  }

  function bind() {
    $("refreshRemoteAccessBtn")?.addEventListener("click", async (event) => {
      setButtonBusy(event.currentTarget, true);
      try {
        await load();
        showToast?.(rt("refreshed"));
      } catch (err) {
        showError?.(err);
      } finally {
        setButtonBusy(event.currentTarget, false);
      }
    });
    $("remoteAccessPolicyForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("[data-remote-policy-submit]");
      setButtonBusy(button, true);
      try {
        await submitPolicy(event.currentTarget);
      } catch (err) {
        showError?.(err);
      } finally {
        setButtonBusy(button, false);
      }
    });
    $("remoteAccessGeneratePasswordForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("[data-remote-generate-submit]");
      setButtonBusy(button, true);
      try {
        await updatePassword("generate", "", $("remoteAccessGenerateCurrentPassword")?.value || "");
      } catch (err) {
        showError?.(err);
      } finally {
        setButtonBusy(button, false);
      }
    });
    $("remoteAccessCustomPasswordForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("[data-remote-custom-submit]");
      setButtonBusy(button, true);
      try {
        await updatePassword("custom", $("remoteAccessCustomPassword")?.value || "", $("remoteAccessCustomCurrentPassword")?.value || "");
      } catch (err) {
        showError?.(err);
      } finally {
        setButtonBusy(button, false);
      }
    });
    $("copyGeneratedRemotePasswordBtn")?.addEventListener("click", async () => {
      if (!generatedPassword) return;
      try {
        await copyText?.(generatedPassword);
        generatedPassword = "";
        showToast?.(rt("passwordCopied"));
        onChange?.(state.remoteAccess);
      } catch (err) {
        showError?.(err);
      }
    });
  }

  function consumeGeneratedPassword() {
    const value = generatedPassword;
    generatedPassword = "";
    return value;
  }

  function generatedPasswordValue() {
    return generatedPassword;
  }

  return {
    bind,
    consumeGeneratedPassword,
    generatedPasswordValue,
    invalidatePendingLoads,
    load,
    render,
    requiresCurrentPassword,
    savePolicy,
    updatePassword,
  };
}
