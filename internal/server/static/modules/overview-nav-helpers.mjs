// Small helpers used by the overview dashboard's open/navigate handlers:
// looking up an entity from the last-loaded overview payload, deferring a
// DOM focus/scroll action to the next frame, and locating+focusing an
// element by dataset value once it's rendered, plus the set of agent ids
// eligible for an "approvals" filter.
export function createOverviewNavHelpers({ state, getOverviewDashboard }) {
  function overviewEntity(collection, id) {
    return (getOverviewDashboard().getState().payload?.[collection] || []).find((item) => item.id === id) || null;
  }

  function deferOverviewDOM(callback) {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      raf(() => callback());
      return;
    }
    if (typeof globalThis.setTimeout === "function") globalThis.setTimeout(callback, 0);
    else callback();
  }

  function focusOverviewDataElement(selector, datasetName, value, { focusSelector = "" } = {}) {
    deferOverviewDOM(() => {
      const node = [...document.querySelectorAll(selector)].find((item) => item.dataset?.[datasetName] === value) || null;
      if (!node) return;
      node.scrollIntoView?.({ block: "center" });
      let focusTarget = focusSelector ? node.querySelector?.(focusSelector) : node;
      if (!focusTarget || focusTarget.disabled || typeof focusTarget.focus !== "function") {
        node.setAttribute?.("tabindex", "-1");
        focusTarget = node;
      }
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus?.();
      }
    });
  }

  function overviewApprovalAgentIds() {
    const payload = getOverviewDashboard().getState().payload || {};
    return [...new Set([
      state.agent?.id,
      ...(payload.activeRuns || []).map((item) => item.agentId),
      ...(payload.activeTasks || []).map((item) => item.agentId),
      ...(payload.recentConversations || []).map((item) => item.id),
      ...(state.navigationConversations || []).map((item) => item.agentId),
    ].map((value) => String(value || "").trim()).filter(Boolean))];
  }

  return {
    overviewEntity,
    deferOverviewDOM,
    focusOverviewDataElement,
    overviewApprovalAgentIds,
  };
}
