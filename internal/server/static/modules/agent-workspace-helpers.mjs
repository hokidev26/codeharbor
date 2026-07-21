import { $ } from "./dom.mjs";
import { t } from "./i18n.mjs";
import { appMainT as am } from "./messages-app-main-extra.mjs";

// Small, mostly independent helpers around the agent transport connection
// badge, chat attachment classification, the terminal dock toggle, and
// opening the task-workspace board for a given agent.
export function createAgentWorkspaceHelpers({
  state,
  getAgentStream,
  getBackgroundTasks,
  getTaskWorkspace,
  getSpecBoard,
  getProjectKanban,
  closeWorkspace,
  toggleTerminal,
  notifyTerminal,
  projectOperationContextActive,
  closeConversationDetails,
  renderConversationDetails,
  updateRuntimeStatusButton,
  renderWorkbenchShell,
  loadProjects,
  selectNavigationConversation,
}) {
  function setComposerConnectionStatus(text, ok = false) {
    const label = $("composerStatusText");
    const dot = $("composerStatusDot");
    if (label) label.textContent = text;
    if (dot) dot.classList.toggle("ok", ok);
  }

  function connectWS() {
    if (!state.agent?.id || state.remoteAccessFailClosed) return;
    getAgentStream().connect(state.agent.id).catch((error) => {
      if (state.agent?.id) notifyTerminal(`[warn] ${am("agentLiveSnapshotFailed", { message: error?.message || error })}\n`);
    });
  }

  function updateAgentStreamStatus(detail = {}) {
    const badge = $("wsBadge");
    const streamStatus = detail.status || "idle";
    state.agentStreamStatus = streamStatus;
    if (streamStatus === "resyncing") {
      state.workState = null;
      if ($("appShell")?.classList.contains("details-open")) renderConversationDetails();
    }
    const labels = {
      idle: ["ws idle", t("workspace.main.idle"), false],
      syncing: ["ws syncing", t("workspace.main.syncing"), false],
      resyncing: ["ws resync", t("workspace.main.recovering"), false],
      connecting: ["ws connecting", t("workspace.main.connecting"), false],
      reconnecting: ["ws reconnecting", t("workspace.main.reconnecting"), false],
      connected: [detail.resume === "replayed" ? "ws replayed" : "ws connected", t("workspace.main.connected"), true],
      offline: ["ws offline", t("workspace.main.offline"), false],
    };
    const [badgeText, composerText, ok] = labels[streamStatus] || labels.offline;
    if (badge) {
      badge.textContent = badgeText;
      badge.classList.toggle("ok", ok);
    }
    setComposerConnectionStatus(composerText, ok);
    updateRuntimeStatusButton();
    renderWorkbenchShell();
  }

  function attachmentKind(file) {
    const type = String(file?.type || "").toLowerCase();
    const name = String(file?.name || "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (name.endsWith(".docx") || type.includes("wordprocessingml.document")) return "docx";
    if (type.startsWith("text/") || /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|ya?ml|toml|ini|env|go|js|jsx|ts|tsx|css|html?|py|rb|rs|java|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|swift|kt|kts|dart|vue|svelte)$/i.test(name)) return "text";
    return "binary";
  }

  function attachmentIcon(kind) {
    if (kind === "image") return "🖼";
    if (kind === "pdf") return "PDF";
    if (kind === "docx") return "DOC";
    if (kind === "text") return "TXT";
    return "FILE";
  }

  function toggleTerminalDock(collapsed) {
    if (!projectOperationContextActive()) return false;
    if (collapsed !== true) {
      getBackgroundTasks().closeTray("terminal-open");
      closeConversationDetails();
      if (state.workspaceOpen && state.workspaceTab === "preview") closeWorkspace();
    }
    toggleTerminal(collapsed);
  }

  async function openTaskWorkspaceAgent(agent, project) {
    const agentId = String(agent?.id || "").trim();
    const projectId = String(project?.id || agent?.projectId || "").trim();
    if (!agentId || !projectId) return;
    let target = state.navigationConversations.find((conversation) => conversation.projectId === projectId && conversation.agentId === agentId);
    if (!target) {
      await loadProjects({ autoEnter: false, reason: "task-workspace-agent" });
      target = state.navigationConversations.find((conversation) => conversation.projectId === projectId && conversation.agentId === agentId);
    }
    if (!target) throw new Error(t("taskWorkspace.selectAgentFirst"));
    await selectNavigationConversation(target.targetId, { preserveSidebar: true, selectionKind: "project" });
    getTaskWorkspace().setContext({ projectId, agentId, scope: "agent" });
    await getSpecBoard().load();
    getProjectKanban().render();
  }

  return {
    setComposerConnectionStatus,
    connectWS,
    updateAgentStreamStatus,
    attachmentKind,
    attachmentIcon,
    toggleTerminalDock,
    openTaskWorkspaceAgent,
  };
}
