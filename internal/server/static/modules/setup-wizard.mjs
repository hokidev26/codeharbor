import { $, escapeAttr, escapeHtml, setButtonBusy } from "./dom.mjs";

export function discoverSetupModels(catalog = {}) {
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  return providers.flatMap((provider) => {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    const discovered = provider?.discovered !== false && (!provider?.error || provider?.available === true);
    if (!discovered) return [];
    return models
      .map((model) => String(model || "").trim())
      .filter(Boolean)
      .map((model) => ({
        provider: String(provider?.name || "").trim(),
        type: String(provider?.type || "").trim(),
        model,
        value: `${String(provider?.name || "").trim()}:${model}`,
        configured: provider?.configured !== false,
        capabilities: provider?.capabilities || {},
        error: String(provider?.error || ""),
      }))
      .filter((item) => item.provider);
  });
}

export function createSetupWizardController({
  state,
  loadModelCatalog,
  loadSettings,
  openSettingsModal,
  renderModelOptions,
  setPreferredModel,
  showToast,
} = {}) {
  function closeSetupWizard() {
    $("setupWizardModal")?.classList.add("hidden");
  }

  function renderSetupWizard() {
    const list = $("setupWizardModels");
    if (!list) return;
    const models = discoverSetupModels(state.modelCatalog);
    if (!models.length) {
      list.innerHTML = `
        <div class="setup-wizard-empty">
          <strong>没有发现可用模型</strong>
          <span>请先配置任意 Provider；向导不会依赖固定厂商列表。</span>
          <button class="settings-action-btn primary" type="button" data-setup-open-providers>打开 Provider 设置</button>
        </div>
      `;
      list.querySelector("[data-setup-open-providers]")?.addEventListener("click", () => {
        closeSetupWizard();
        openSettingsModal?.("providers");
      });
      return;
    }
    list.innerHTML = models.map((item) => `
      <button class="setup-wizard-model" type="button" data-setup-model="${escapeAttr(item.value)}" ${item.configured ? "" : "disabled"}>
        <span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.type || "provider")}</small></span>
        <span class="settings-status-pill ${item.error ? "warn" : "ok"}">${escapeHtml(item.error ? "需处理" : "可用")}</span>
      </button>
    `).join("");
    list.querySelectorAll("[data-setup-model]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.setupModel || "";
        if (!value) return;
        setPreferredModel?.(value);
        renderModelOptions?.();
        closeSetupWizard();
        showToast?.(`已选择模型 ${value}。`, "success");
      });
    });
  }

  async function refreshSetupWizard() {
    const button = $("setupWizardRefreshBtn");
    setButtonBusy(button, true, "刷新中");
    try {
      await loadSettings?.();
      await loadModelCatalog?.();
      renderSetupWizard();
    } finally {
      setButtonBusy(button, false, "刷新中");
    }
  }

  async function openSetupWizard() {
    $("setupWizardModal")?.classList.remove("hidden");
    await refreshSetupWizard();
  }

  function bindSetupWizardActions() {
    $("setupWizardCloseBtn")?.addEventListener("click", closeSetupWizard);
    $("setupWizardCancelBtn")?.addEventListener("click", closeSetupWizard);
    $("setupWizardRefreshBtn")?.addEventListener("click", () => refreshSetupWizard().catch((error) => showToast?.(error?.message || String(error), "error", { force: true })));
    $("setupWizardModal")?.addEventListener("click", (event) => {
      if (event.target?.id === "setupWizardModal") closeSetupWizard();
    });
  }

  return { bindSetupWizardActions, closeSetupWizard, openSetupWizard, refreshSetupWizard, renderSetupWizard };
}
