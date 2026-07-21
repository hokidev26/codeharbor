import { $ } from "./dom.mjs";
import { terminalAccessAllowed } from "./remote-access-capabilities.mjs";

// Small, mostly independent helpers: whether the current navigation
// selection is a fully-scoped project+agent workspace, the global rail
// active-target toggle, terminal socket reuse check + authorized-agent
// transport restore, and the empty-workspace placeholder.
export function createWorkspaceContextHelpers({
  state,
  renderEmptyWorkspaceCard,
  syncThemePageContext,
  getBackgroundTasks,
  connectWS,
  getConnectTerminal,
}) {
  function projectOperationContextActive() {
    return state.navigationSelectionKind === "project" && Boolean(state.project?.id && state.agent?.id);
  }

  function setGlobalRailActive(target = "conversation") {
    document.querySelectorAll("[data-global-rail-target]").forEach((node) => {
      const active = node.dataset.globalRailTarget === target;
      node.classList.toggle("active", active);
      node.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function terminalSocketUsable(socket = state.terminalWS) {
    if (!socket) return false;
    const readyState = Number(socket.readyState);
    return !Number.isFinite(readyState) || readyState === 0 || readyState === 1;
  }

  function restoreAuthorizedAgentTransports() {
    if (state.remoteAccessFailClosed || !state.agent?.id || state.agentStreamStatus !== "idle") return false;
    getBackgroundTasks().setAgent(state.agent.id);
    connectWS();
    if (projectOperationContextActive() && terminalAccessAllowed(state) && !terminalSocketUsable()) getConnectTerminal()();
    return true;
  }

  function showEmptyWorkspaceState(options = {}) {
    const el = $("messages");
    if (!el) return;
    const busy = options.busy === true;
    syncThemePageContext();
    el.classList.add("empty");
    el.innerHTML = renderEmptyWorkspaceCard(options);
    if (busy) {
      el.setAttribute("aria-busy", "true");
      el.dataset.initialChatState = "loading";
    } else {
      el.removeAttribute("aria-busy");
      delete el.dataset.initialChatState;
    }
  }

  return {
    projectOperationContextActive,
    setGlobalRailActive,
    terminalSocketUsable,
    restoreAuthorizedAgentTransports,
    showEmptyWorkspaceState,
  };
}
