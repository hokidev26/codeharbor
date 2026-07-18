import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";
import { t } from "./i18n.mjs";
import { api } from "./runtime.mjs";

export function createBackendRegistryController({
  state,
  showError,
  showToast,
  updateSidebarAccountSummary,
} = {}) {
  async function loadBackends({ checkHealth = true } = {}) {
    const seq = ++state.backendLoadSeq;
    const button = $("refreshAgentBackendsBtn");
    setButtonBusy(button, true, t("backend.refreshing"));
    try {
      const backends = await api("/api/backends");
      if (seq !== state.backendLoadSeq) return;
      state.backends = Array.isArray(backends) ? backends : [];
      if (!state.backends.some((backend) => backend.id === state.backendHealth?.backendId)) state.backendHealth = null;
      renderBackendsList();
      if (checkHealth) await refreshActiveBackendHealth();
      if (seq !== state.backendLoadSeq) return;
    } catch (err) {
      if (seq === state.backendLoadSeq) throw err;
    } finally {
      if (seq === state.backendLoadSeq) setButtonBusy(button, false, t("backend.refreshing"));
    }
  }

  function activeBackend() {
    return state.backends.find((backend) => backend.active) || state.backends[0] || null;
  }

  function renderBackendPanel() {
    const backend = activeBackend();
    const name = $("activeBackendName");
    if (name) name.textContent = backend ? `${backend.name} · ${backend.baseUrl}` : t("backend.notConfigured");
    updateSidebarAccountSummary?.();
    if (!backend) setBackendHealthBadge(false, t("backend.notConfigured"));
  }

  function setBackendHealthBadge(ok, text) {
    const badge = $("backendHealthBadge");
    if (badge) {
      badge.textContent = text;
      badge.classList.toggle("ok", ok);
      badge.classList.toggle("err", !ok);
    }
    const dot = $("sidebarBackendDot");
    if (dot) {
      dot.classList.toggle("ok", ok);
      dot.classList.toggle("err", !ok);
      dot.title = text;
    }
  }

  async function refreshActiveBackendHealth() {
    const backend = activeBackend();
    if (!backend) return;
    const seq = ++state.backendHealthSeq;
    setBackendHealthBadge(false, t("backend.checking"));
    try {
      const health = await api(`/api/backends/${backend.id}/health`);
      if (seq !== state.backendHealthSeq || activeBackend()?.id !== backend.id) return;
      state.backendHealth = health;
      setBackendHealthBadge(health.ok, health.status || t(health.ok ? "backend.online" : "backend.offline"));
      renderBackendsList();
    } catch (err) {
      if (seq !== state.backendHealthSeq || activeBackend()?.id !== backend.id) return;
      state.backendHealth = { backendId: backend.id, ok: false, status: t("backend.error"), error: err.message };
      setBackendHealthBadge(false, t("backend.error"));
      renderBackendsList();
    }
  }

  function openBackendsModal() {
    $("backendsModal").classList.remove("hidden");
    renderBackendsList();
  }

  function closeBackendsModal() {
    $("backendsModal").classList.add("hidden");
  }

  function backendActionKey(id, action) {
    return `${action}:${id}`;
  }

  function isBackendActionBusy(id, action = "") {
    const busy = state.backendActionBusy || {};
    if (action) return Boolean(busy[backendActionKey(id, action)]);
    return ["test", "activate", "delete"].some((item) => busy[backendActionKey(id, item)]);
  }

  function setBackendActionBusy(id, action, busy) {
    if (!id || !action) return;
    const key = backendActionKey(id, action);
    if (busy) state.backendActionBusy = { ...(state.backendActionBusy || {}), [key]: true };
    else {
      const next = { ...(state.backendActionBusy || {}) };
      delete next[key];
      state.backendActionBusy = next;
    }
    renderBackendsList();
  }

  function renderBackendActionButton({ backendId, action, dataAttr, label, busyLabel, className = "" }) {
    const ownBusy = isBackendActionBusy(backendId, action);
    const disabled = isBackendActionBusy(backendId);
    return `<button class="${className}" type="button" data-${dataAttr}="${escapeAttr(backendId)}" ${disabled ? "disabled" : ""} ${ownBusy ? 'aria-busy="true"' : ""}>${escapeHtml(ownBusy ? busyLabel : label)}</button>`;
  }

  function renderBackendsList() {
    const el = $("backendsList");
    if (!el) return;
    if (!state.backends.length) {
      el.innerHTML = `<div class="empty-list settings-empty-state">${escapeHtml(t("backend.emptyList"))}</div>`;
      return;
    }
    el.innerHTML = state.backends.map((backend) => {
      const health = state.backendHealth?.backendId === backend.id ? state.backendHealth : null;
      const healthText = health ? (health.status || t(health.ok ? "backend.online" : "backend.offline")) : t("backend.notChecked");
      const pendingDelete = state.backendDeleteConfirmId === backend.id;
      return `
      <div class="backend-card settings-data-row ${backend.active ? "active" : ""} ${pendingDelete ? "confirm-delete" : ""}">
        <div class="backend-card-main">
          <div class="backend-card-title">${escapeHtml(backend.name)} ${backend.active ? `<span class='mini-tag settings-badge'>${escapeHtml(t("backend.active"))}</span>` : ""}</div>
          <div class="backend-card-url">${escapeHtml(backend.baseUrl)}</div>
          <div class="backend-card-meta">${escapeHtml(backend.kind)} · ${escapeHtml(t(backend.apiKeyConfigured ? "backend.apiKeyConfigured" : "backend.noApiKey"))} · ${escapeHtml(healthText)}</div>
        </div>
        <div class="backend-card-actions settings-inline-actions">
          ${renderBackendActionButton({ backendId: backend.id, action: "test", dataAttr: "backend-test", label: t("backend.test"), busyLabel: t("backend.testing"), className: "ghost-btn mini" })}
          ${backend.active ? "" : renderBackendActionButton({ backendId: backend.id, action: "activate", dataAttr: "backend-activate", label: t("backend.setCurrent"), busyLabel: t("backend.switching"), className: "ghost-btn mini" })}
          ${renderBackendActionButton({ backendId: backend.id, action: "delete", dataAttr: "backend-delete", label: t(pendingDelete ? "backend.confirmDelete" : "backend.delete"), busyLabel: t("backend.deleting"), className: `ghost-btn mini danger ${pendingDelete ? "confirm" : ""}` })}
        </div>
      </div>
    `;
    }).join("");
    el.querySelectorAll("[data-backend-test]").forEach((node) => {
      node.addEventListener("click", () => testBackend(node.dataset.backendTest).catch(showError));
    });
    el.querySelectorAll("[data-backend-activate]").forEach((node) => {
      node.addEventListener("click", () => activateBackend(node.dataset.backendActivate).catch(showError));
    });
    el.querySelectorAll("[data-backend-delete]").forEach((node) => {
      node.addEventListener("click", () => requestDeleteBackend(node.dataset.backendDelete).catch(showError));
    });
  }

  function setBackendFormSubmitting(form, submitting) {
    const button = form?.querySelector("[data-backend-submit]");
    if (!button) return;
    if (submitting) {
      if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
      button.textContent = t("backend.adding");
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      return;
    }
    button.textContent = button.dataset.originalLabel || t("backend.add");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    delete button.dataset.originalLabel;
  }

  function resetBackendForm() {
    if ($("backendName")) $("backendName").value = "";
    if ($("backendKind")) $("backendKind").value = "local";
    if ($("backendBaseUrl")) $("backendBaseUrl").value = "";
    if ($("backendApiKey")) $("backendApiKey").value = "";
  }

  async function saveBackend(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form?.querySelector("[data-backend-submit]");
    if (submitButton?.disabled) return;
    const payload = {
      name: $("backendName").value.trim(),
      kind: $("backendKind").value,
      baseUrl: $("backendBaseUrl").value.trim(),
      apiKey: $("backendApiKey").value.trim(),
      active: state.backends.length === 0,
    };
    if (!payload.baseUrl) throw new Error(t("backend.urlRequired"));
    setBackendFormSubmitting(form, true);
    try {
      await api("/api/backends", { method: "POST", body: JSON.stringify(payload) });
      state.backendDeleteConfirmId = "";
      resetBackendForm();
      showToast?.(t("backend.added"), "success");
      await loadBackends();
    } finally {
      setBackendFormSubmitting(form, false);
    }
  }

  async function activateBackend(id) {
    if (!id || isBackendActionBusy(id)) return;
    setBackendActionBusy(id, "activate", true);
    try {
      state.backendHealthSeq++;
      await api(`/api/backends/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
      state.backendDeleteConfirmId = "";
      showToast?.(t("backend.activated"), "success");
      await loadBackends();
    } finally {
      setBackendActionBusy(id, "activate", false);
    }
  }

  async function requestDeleteBackend(id) {
    if (!id || isBackendActionBusy(id)) return;
    if (state.backendDeleteConfirmId !== id) {
      state.backendDeleteConfirmId = id;
      renderBackendsList();
      showToast?.(t("backend.deleteConfirmHint"), "warn");
      return;
    }
    await deleteBackend(id);
  }

  async function deleteBackend(id) {
    if (!id || isBackendActionBusy(id)) return;
    setBackendActionBusy(id, "delete", true);
    try {
      state.backendHealthSeq++;
      await api(`/api/backends/${id}`, { method: "DELETE" });
      state.backendDeleteConfirmId = "";
      if (state.backendHealth?.backendId === id) state.backendHealth = null;
      showToast?.(t("backend.deleted"), "success");
      await loadBackends();
    } finally {
      setBackendActionBusy(id, "delete", false);
    }
  }

  async function testBackend(id) {
    if (!id || isBackendActionBusy(id)) return;
    setBackendActionBusy(id, "test", true);
    try {
      const seq = ++state.backendHealthSeq;
      const health = await api(`/api/backends/${id}/health`);
      if (seq !== state.backendHealthSeq) return;
      state.backendHealth = health;
      if (activeBackend()?.id === id) setBackendHealthBadge(health.ok, health.status || t(health.ok ? "backend.online" : "backend.offline"));
      renderBackendsList();
    } finally {
      setBackendActionBusy(id, "test", false);
    }
  }

  return {
    closeBackendsModal,
    loadBackends,
    openBackendsModal,
    renderBackendPanel,
    resetBackendForm,
    saveBackend,
  };
}
