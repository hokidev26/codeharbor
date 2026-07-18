import { t } from "./i18n.mjs";

const navigationModes = new Set(["all", "projects", "conversations"]);

export const navigationRefreshDefaults = Object.freeze({
  intervalMs: 2000,
  minIntervalMs: 250,
});

function navigationRefreshTimerFunctions(timers) {
  const source = timers || globalThis;
  return {
    setTimeout: (typeof source?.setTimeout === "function" ? source.setTimeout : globalThis.setTimeout).bind(source),
    clearTimeout: (typeof source?.clearTimeout === "function" ? source.clearTimeout : globalThis.clearTimeout).bind(source),
  };
}

export function createNavigationRefreshController({
  refresh,
  shouldRefresh = () => true,
  onError,
  timers = globalThis,
  intervalMs = navigationRefreshDefaults.intervalMs,
  autoStart = false,
} = {}) {
  if (typeof refresh !== "function") throw new Error("createNavigationRefreshController requires refresh");
  const timer = navigationRefreshTimerFunctions(timers);
  const interval = Math.max(navigationRefreshDefaults.minIntervalMs, Number(intervalMs) || navigationRefreshDefaults.intervalMs);
  let started = false;
  let timerId = null;
  let scheduledReason = "interval";
  let inFlight = null;
  let pendingReason = "";

  function clearScheduled() {
    if (timerId === null) return;
    timer.clearTimeout(timerId);
    timerId = null;
  }

  function schedule(delay = interval, reason = "interval") {
    if (!started) return false;
    clearScheduled();
    scheduledReason = String(reason || "interval");
    timerId = timer.setTimeout(() => {
      timerId = null;
      run(scheduledReason);
    }, Math.max(0, Number(delay) || 0));
    return true;
  }

  function finish(operation) {
    if (inFlight !== operation) return;
    inFlight = null;
    if (!started) return;
    const nextReason = pendingReason;
    pendingReason = "";
    schedule(nextReason ? 0 : interval, nextReason || "interval");
  }

  function run(reason = "interval") {
    if (!started) return Promise.resolve(null);
    if (inFlight) {
      pendingReason = String(reason || "pending");
      return inFlight;
    }
    let allowed = false;
    try {
      allowed = shouldRefresh() !== false;
    } catch (error) {
      onError?.(error);
    }
    if (!allowed) {
      schedule(interval, "interval");
      return Promise.resolve(null);
    }
    const operation = Promise.resolve()
      .then(() => refresh({ reason: String(reason || "interval") }))
      .catch((error) => {
        onError?.(error);
        return null;
      })
      .finally(() => finish(operation));
    inFlight = operation;
    return operation;
  }

  function start({ immediate = false } = {}) {
    if (started) return false;
    started = true;
    schedule(immediate ? 0 : interval, immediate ? "start" : "interval");
    return true;
  }

  function request(reason = "manual") {
    if (!started) return false;
    if (inFlight) {
      pendingReason = String(reason || "manual");
      return true;
    }
    return schedule(0, reason);
  }

  function stop() {
    if (!started) return false;
    started = false;
    clearScheduled();
    pendingReason = "";
    return true;
  }

  async function flush() {
    if (!started) return null;
    clearScheduled();
    await run("flush");
    while (inFlight) await inFlight;
    return null;
  }

  if (autoStart) start();

  return {
    start,
    stop,
    dispose: stop,
    request,
    refreshNow: request,
    flush,
    isStarted: () => started,
    isRefreshing: () => inFlight !== null,
    intervalMs: interval,
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function compactDisplayPath(value) {
  return text(value)
    .replace(/^\/Users\/[^/]+(?=\/)/, "~")
    .replace(/^\/home\/[^/]+(?=\/)/, "~");
}

function timestamp(value) {
  const normalized = text(value);
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : "";
}

export function escapeNavigationHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createNavigationTargetId(value = {}) {
  return [value.projectId, value.worklineId, value.agentId]
    .map((part) => encodeURIComponent(text(part)))
    .join("::");
}

export function parseNavigationTargetId(targetId) {
  const parts = text(targetId).split("::");
  if (parts.length !== 3) return null;
  try {
    const [projectId, worklineId, agentId] = parts.map((part) => decodeURIComponent(part));
    if (!projectId || !worklineId || !agentId) return null;
    return { projectId, worklineId, agentId, targetId: createNavigationTargetId({ projectId, worklineId, agentId }) };
  } catch {
    return null;
  }
}

function normalizeProject(value = {}) {
  const id = text(value.id || value.projectId);
  if (!id) return null;
  const gitPath = text(value.gitPath || value.projectPath || value.path);
  return {
    ...value,
    id,
    name: text(value.name || value.projectName) || gitPath || id,
    gitPath,
    updatedAt: timestamp(value.updatedAt || value.projectUpdatedAt),
    pinned: booleanValue(value.pinned || value.projectPinned),
    archivedAt: timestamp(value.archivedAt || value.projectArchivedAt),
  };
}

function normalizeConversation(value = {}) {
  const projectId = text(value.projectId);
  const worklineId = text(value.worklineId);
  const agentId = text(value.agentId);
  if (!projectId || !worklineId || !agentId) return null;
  const conversation = {
    projectId,
    projectName: text(value.projectName) || projectId,
    projectPath: text(value.projectPath),
    projectUpdatedAt: timestamp(value.projectUpdatedAt),
    projectPinned: booleanValue(value.projectPinned),
    projectArchivedAt: timestamp(value.projectArchivedAt),
    worklineId,
    worklineTitle: text(value.worklineTitle) || worklineId,
    worklineRole: text(value.worklineRole),
    worklineBranch: text(value.worklineBranch),
    worklineUpdatedAt: timestamp(value.worklineUpdatedAt),
    agentId,
    agentTitle: text(value.agentTitle) || agentId,
    agentType: text(value.agentType),
    agentStatus: text(value.agentStatus),
    agentPinned: booleanValue(value.agentPinned),
    agentArchivedAt: timestamp(value.agentArchivedAt),
    model: text(value.model),
    permissionMode: text(value.permissionMode),
    cwd: text(value.cwd),
    messageCount: Math.max(0, Number.isFinite(Number(value.messageCount)) ? Math.trunc(Number(value.messageCount)) : 0),
    lastActivityAt: timestamp(value.lastActivityAt),
  };
  return { ...conversation, targetId: createNavigationTargetId(conversation) };
}

function conversationActivity(value) {
  return Date.parse(value.lastActivityAt || value.worklineUpdatedAt || value.projectUpdatedAt || "") || 0;
}

function compareRecent(left, right) {
  const leftArchived = left.projectArchivedAt || left.agentArchivedAt ? 1 : 0;
  const rightArchived = right.projectArchivedAt || right.agentArchivedAt ? 1 : 0;
  const leftProjectPinned = left.projectPinned ? 1 : 0;
  const rightProjectPinned = right.projectPinned ? 1 : 0;
  const leftAgentPinned = left.agentPinned ? 1 : 0;
  const rightAgentPinned = right.agentPinned ? 1 : 0;
  return leftArchived - rightArchived
    || rightProjectPinned - leftProjectPinned
    || rightAgentPinned - leftAgentPinned
    || conversationActivity(right) - conversationActivity(left)
    || left.agentTitle.localeCompare(right.agentTitle);
}

function compareConversationList(left, right) {
  const leftArchived = left.projectArchivedAt || left.agentArchivedAt ? 1 : 0;
  const rightArchived = right.projectArchivedAt || right.agentArchivedAt ? 1 : 0;
  const leftPinned = left.agentPinned ? 1 : 0;
  const rightPinned = right.agentPinned ? 1 : 0;
  return leftArchived - rightArchived
    || rightPinned - leftPinned
    || conversationActivity(right) - conversationActivity(left)
    || left.agentTitle.localeCompare(right.agentTitle);
}

export function normalizeNavigationPayload(payload = {}) {
  const projects = (Array.isArray(payload.projects) ? payload.projects : [])
    .map(normalizeProject)
    .filter(Boolean);
  const projectIds = new Set(projects.map((project) => project.id));
  const seenConversationTargets = new Set();
  const conversations = (Array.isArray(payload.conversations) ? payload.conversations : [])
    .map(normalizeConversation)
    .filter(Boolean)
    .sort(compareRecent)
    .filter((conversation) => {
      if (seenConversationTargets.has(conversation.targetId)) return false;
      seenConversationTargets.add(conversation.targetId);
      return true;
    });

  conversations.forEach((conversation) => {
    if (projectIds.has(conversation.projectId)) return;
    projectIds.add(conversation.projectId);
    projects.push(normalizeProject({
      id: conversation.projectId,
      name: conversation.projectName,
      gitPath: conversation.projectPath,
      updatedAt: conversation.projectUpdatedAt,
      pinned: conversation.projectPinned,
      archivedAt: conversation.projectArchivedAt,
    }));
  });

  return { projects, conversations };
}

function normalizedQuery(query) {
  return text(query).toLocaleLowerCase();
}

function includesQuery(values, query) {
  if (!query) return true;
  return values.some((value) => text(value).toLocaleLowerCase().includes(query));
}

export function conversationMatchesSearch(conversation, query) {
  return includesQuery([
    conversation.projectName,
    conversation.projectPath,
    conversation.worklineTitle,
    conversation.worklineRole,
    conversation.worklineBranch,
    conversation.agentTitle,
    conversation.model,
  ], normalizedQuery(query));
}

export function projectMatchesSearch(project, conversations, query) {
  const normalized = normalizedQuery(query);
  if (!normalized) return true;
  return includesQuery([project.name, project.gitPath], normalized)
    || conversations.some((conversation) => conversation.projectId === project.id && conversationMatchesSearch(conversation, normalized));
}

export function buildNavigationView(payload = {}, options = {}) {
  const normalized = normalizeNavigationPayload(payload);
  const mode = navigationModes.has(options.mode) ? options.mode : "all";
  const query = normalizedQuery(options.query);
  const conversationsByProject = new Map();
  normalized.conversations.forEach((conversation) => {
    const items = conversationsByProject.get(conversation.projectId) || [];
    items.push(conversation);
    conversationsByProject.set(conversation.projectId, items);
  });

  const projects = normalized.projects.filter((project) => projectMatchesSearch(project, normalized.conversations, query));
  const conversations = normalized.conversations
    .filter((conversation) => conversationMatchesSearch(conversation, query))
    .sort(compareConversationList);
  const groups = projects.map((project) => {
    const projectConversations = conversationsByProject.get(project.id) || [];
    const projectOwnMatch = includesQuery([project.name, project.gitPath], query);
    return {
      project,
      conversations: !query || projectOwnMatch
        ? projectConversations
        : projectConversations.filter((conversation) => conversationMatchesSearch(conversation, query)),
    };
  });

  return {
    mode,
    query,
    totalProjectCount: normalized.projects.length,
    totalConversationCount: normalized.conversations.length,
    projects: mode === "conversations" ? [] : projects,
    conversations: mode === "conversations" ? conversations : [],
    groups: mode === "conversations" ? [] : groups,
  };
}

export function normalizeRecentConversations(value, limit = 8) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  return items.flatMap((entry) => {
    const parsed = parseNavigationTargetId(typeof entry === "string" ? entry : entry?.targetId);
    if (!parsed || seen.has(parsed.targetId)) return [];
    seen.add(parsed.targetId);
    const openedAt = timestamp(typeof entry === "object" ? (entry.openedAt || entry.lastOpenedAt) : "");
    return [{ targetId: parsed.targetId, openedAt }];
  }).slice(0, Math.max(0, limit));
}

export function resolveInitialNavigationTarget(recent, conversations) {
  const knownTargets = new Set((Array.isArray(conversations) ? conversations : [])
    .map((conversation) => text(conversation?.targetId))
    .filter((targetId) => parseNavigationTargetId(targetId)));
  const recentMatch = normalizeRecentConversations(recent)
    .find((entry) => knownTargets.has(entry.targetId));
  if (recentMatch) return recentMatch.targetId;
  return (Array.isArray(conversations) ? conversations : [])
    .map((conversation) => text(conversation?.targetId))
    .find((targetId) => knownTargets.has(targetId)) || "";
}

export function addRecentConversation(recent, target, openedAt = new Date().toISOString(), limit = 8) {
  const targetId = typeof target === "string" ? parseNavigationTargetId(target)?.targetId : createNavigationTargetId(target);
  if (!parseNavigationTargetId(targetId)) return normalizeRecentConversations(recent, limit);
  return normalizeRecentConversations([
    { targetId, openedAt: timestamp(openedAt) || new Date().toISOString() },
    ...normalizeRecentConversations(recent, Number.MAX_SAFE_INTEGER).filter((entry) => entry.targetId !== targetId),
  ], limit);
}

export function navigationAgentStatusClass(value) {
  return text(value).toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "idle";
}

function navigationStateMarkup({ pinned = false, archivedAt = "" } = {}) {
  const marks = [];
  if (pinned) {
    marks.push(`<span class="navigation-state-badge pinned" title="${escapeNavigationHtml(t("shell.pinned"))}" aria-label="${escapeNavigationHtml(t("shell.pinned"))}">P</span>`);
  }
  if (archivedAt) {
    marks.push(`<span class="navigation-state-badge archived" title="${escapeNavigationHtml(t("shell.archived"))}" aria-label="${escapeNavigationHtml(t("shell.archived"))}">A</span>`);
  }
  return marks.join("");
}

function navigationMoreTrigger(kind, id) {
  const label = t("shell.navigationActions");
  return `<button class="navigation-row-actions" type="button" data-navigation-menu-trigger data-navigation-kind="${escapeNavigationHtml(kind)}" data-navigation-id="${escapeNavigationHtml(id)}" aria-haspopup="menu" aria-label="${escapeNavigationHtml(label)}" title="${escapeNavigationHtml(label)}">…</button>`;
}

function renderProject(project, activeProjectId, options = {}) {
  const active = project.id === activeProjectId;
  const path = project.gitPath || project.id;
  const displayPath = compactDisplayPath(path);
  const counts = options.taskCounts?.[project.id] || {};
  const activeTasks = Number(counts.todo || 0) + Number(counts.doing || 0) + Number(counts.blocked || 0);
  const taskMeta = options.taskContext
    ? `<span class="project-task-counts"><span>${escapeNavigationHtml(String(activeTasks))}</span>${Number(counts.blocked || 0) ? `<span class="blocked">${escapeNavigationHtml(String(counts.blocked))}</span>` : ""}</span>`
    : "";
  const stateClass = `${project.pinned ? "pinned " : ""}${project.archivedAt ? "archived " : ""}`;
  const stateMeta = navigationStateMarkup({ pinned: project.pinned, archivedAt: project.archivedAt });
  const icon = `<svg viewBox="0 0 20 20"><path d="M5 4.5h10a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2H9l-4 2.5V14a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"></path></svg>`;
  return `
    <div class="navigation-conversation-row navigation-project-row ${options.taskContext ? "task-context " : ""}${active ? "active " : ""}${stateClass}" role="button" tabindex="0" data-project-id="${escapeNavigationHtml(project.id)}" data-navigation-kind="project" data-navigation-id="${escapeNavigationHtml(project.id)}" data-navigation-context="${options.taskContext ? "tasks" : "conversation"}">
      <span class="navigation-agent-icon" aria-hidden="true">${icon}</span>
      <span class="navigation-conversation-main">
        <span class="navigation-conversation-title navigation-project-title"><span class="project-kind-badge">PROJECT</span><span class="project-name">${escapeNavigationHtml(project.name)}</span>${stateMeta}</span>
        <span class="navigation-conversation-meta project-path" title="${escapeNavigationHtml(path)}">${escapeNavigationHtml(displayPath)}</span>
      </span>
      ${taskMeta}
      ${navigationMoreTrigger("project", project.id)}
    </div>`;
}

function renderConversation(conversation, activeAgentId, nested = false, options = {}) {
  const active = conversation.agentId === activeAgentId;
  const taskContext = options.taskContext === true;
  const statusClass = navigationAgentStatusClass(conversation.agentStatus);
  const worklineContext = conversation.worklineBranch || conversation.worklineTitle;
  const projectContext = compactDisplayPath(conversation.projectPath) || conversation.projectName;
  const context = nested
    ? worklineContext
    : [projectContext, worklineContext].filter((value, index, items) => value && items.indexOf(value) === index).join(" / ");
  const metaParts = [context, conversation.model, conversation.agentStatus];
  if (!taskContext) metaParts.push(t("workspace.navigation.messageCount", { count: conversation.messageCount }));
  const meta = metaParts.filter(Boolean).join(" · ");
  const stateClass = `${conversation.agentPinned ? "pinned " : ""}${conversation.agentArchivedAt ? "archived " : ""}`;
  const stateMeta = navigationStateMarkup({ pinned: conversation.agentPinned, archivedAt: conversation.agentArchivedAt });
  const icon = taskContext
    ? `<svg viewBox="0 0 20 20"><circle cx="10" cy="6.5" r="3"></circle><path d="M4.5 17c.7-3.5 2.5-5.2 5.5-5.2s4.8 1.7 5.5 5.2"></path></svg>`
    : `<svg viewBox="0 0 20 20"><path d="M5 4.5h10a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2H9l-4 2.5V14a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"></path></svg>`;
  return `
    <div class="navigation-conversation-row ${nested ? "nested " : ""}${taskContext ? "task-context " : ""}${active ? "active " : ""}status-${statusClass} ${stateClass}" role="button" tabindex="0" data-navigation-target="${escapeNavigationHtml(conversation.targetId)}" data-navigation-kind="conversation" data-navigation-id="${escapeNavigationHtml(conversation.agentId)}" data-agent-status="${escapeNavigationHtml(conversation.agentStatus || "idle")}" data-navigation-context="${taskContext ? "tasks" : "conversation"}">
      <span class="navigation-agent-icon" aria-hidden="true">${icon}</span>
      <span class="navigation-conversation-main">
        <span class="navigation-conversation-title"><span class="navigation-title-text">${escapeNavigationHtml(conversation.agentTitle)}</span>${stateMeta}</span>
        <span class="navigation-conversation-meta" title="${escapeNavigationHtml(meta)}">${escapeNavigationHtml(meta)}</span>
      </span>
      ${navigationMoreTrigger("conversation", conversation.agentId)}
    </div>`;
}

export function renderNavigationHTML(view = {}, options = {}) {
  const mode = navigationModes.has(view.mode) ? view.mode : "all";
  const activeProjectId = text(options.activeProjectId);
  const activeAgentId = text(options.activeAgentId);
  const taskContext = options.taskContext === true;
  let html = "";
  if (taskContext) {
    html = (view.projects || []).map((project) => renderProject(project, activeProjectId, { taskContext: true, taskCounts: options.taskCounts })).join("");
  } else if (mode === "all") {
    html = (view.groups || []).map((group) => `
      <section class="navigation-project-group" data-navigation-project-group="${escapeNavigationHtml(group.project.id)}" data-conversation-count="${escapeNavigationHtml(String(group.conversations.length))}" data-navigation-context="conversation">
        ${renderProject(group.project, activeProjectId)}
        <div class="navigation-project-conversations" data-project-conversations="${escapeNavigationHtml(group.project.id)}">
          ${group.conversations.map((conversation) => renderConversation(conversation, activeAgentId, true)).join("")}
        </div>
      </section>`).join("");
  } else if (mode === "projects") {
    html = (view.projects || []).map((project) => renderProject(project, activeProjectId)).join("");
  } else {
    html = (view.conversations || []).map((conversation) => renderConversation(conversation, activeAgentId, false, { taskContext })).join("");
  }
  if (html) return html;
  if (view.query) return `<div class="empty-list">${escapeNavigationHtml(t("workspace.navigation.noResults", { query: view.query }))}</div>`;
  if (!view.totalProjectCount && taskContext) {
    return `<div class="navigation-boundary-empty" data-task-project-boundary="true">
      <strong>${escapeNavigationHtml(t("workbench.noProjectsTitle"))}</strong>
      <span>${escapeNavigationHtml(t("workbench.noProjectsDescription"))}</span>
      <button type="button" data-primary-workbench-target="conversation">${escapeNavigationHtml(t("workbench.goToConversation"))}</button>
    </div>`;
  }
  if (!view.totalProjectCount) {
    return `
      <button class="project-card project-card-empty" type="button" data-open-directory-shortcut="new">
        <span class="project-card-main">
          <span class="project-name">${escapeNavigationHtml(t("workspace.navigation.chooseFolder"))}</span>
          <span class="project-path">${escapeNavigationHtml(t("workspace.navigation.chooseFolderHint"))}</span>
        </span>
      </button>`;
  }
  return `<div class="empty-list">${escapeNavigationHtml(mode === "conversations" ? t("workspace.navigation.noConversations") : t("workspace.navigation.noProjects"))}</div>`;
}

export function renderRecentConversationsHTML(recent, conversations, activeAgentId = "") {
  const groupedTargets = new Set((Array.isArray(conversations) ? conversations : [])
    .map((conversation) => text(conversation?.targetId))
    .filter(Boolean));
  const duplicateCount = normalizeRecentConversations(recent)
    .filter((entry) => groupedTargets.has(entry.targetId)).length;
  // Project groups are the canonical location for every known conversation.
  // The legacy recent container stays present for app-main compatibility, but it
  // no longer repeats rows that are already available beneath their projects.
  return `<div class="recent-empty recent-conversations-deduplicated" data-recent-conversations-deduplicated="true" data-deduplicated-count="${escapeNavigationHtml(String(duplicateCount))}">${escapeNavigationHtml(t("workspace.navigation.noRecentConversations"))}</div>`;
}
