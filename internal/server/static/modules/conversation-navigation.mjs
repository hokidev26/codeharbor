const navigationModes = new Set(["all", "projects", "conversations"]);

function text(value) {
  return String(value ?? "").trim();
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
    worklineId,
    worklineTitle: text(value.worklineTitle) || worklineId,
    worklineRole: text(value.worklineRole),
    worklineBranch: text(value.worklineBranch),
    worklineUpdatedAt: timestamp(value.worklineUpdatedAt),
    agentId,
    agentTitle: text(value.agentTitle) || agentId,
    agentType: text(value.agentType),
    agentStatus: text(value.agentStatus),
    model: text(value.model),
    permissionMode: text(value.permissionMode),
    cwd: text(value.cwd),
    messageCount: Math.max(0, Number.isFinite(Number(value.messageCount)) ? Math.trunc(Number(value.messageCount)) : 0),
    lastActivityAt: timestamp(value.lastActivityAt),
  };
  return { ...conversation, targetId: createNavigationTargetId(conversation) };
}

function compareRecent(left, right) {
  const leftTime = Date.parse(left.lastActivityAt || left.worklineUpdatedAt || left.projectUpdatedAt || "") || 0;
  const rightTime = Date.parse(right.lastActivityAt || right.worklineUpdatedAt || right.projectUpdatedAt || "") || 0;
  return rightTime - leftTime || left.agentTitle.localeCompare(right.agentTitle);
}

export function normalizeNavigationPayload(payload = {}) {
  const projects = (Array.isArray(payload.projects) ? payload.projects : [])
    .map(normalizeProject)
    .filter(Boolean);
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = (Array.isArray(payload.conversations) ? payload.conversations : [])
    .map(normalizeConversation)
    .filter(Boolean)
    .sort(compareRecent);

  conversations.forEach((conversation) => {
    if (projectIds.has(conversation.projectId)) return;
    projectIds.add(conversation.projectId);
    projects.push(normalizeProject({
      id: conversation.projectId,
      name: conversation.projectName,
      gitPath: conversation.projectPath,
      updatedAt: conversation.projectUpdatedAt,
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
  const conversations = normalized.conversations.filter((conversation) => conversationMatchesSearch(conversation, query));
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
    groups: mode === "all" ? groups : [],
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

export function addRecentConversation(recent, target, openedAt = new Date().toISOString(), limit = 8) {
  const targetId = typeof target === "string" ? parseNavigationTargetId(target)?.targetId : createNavigationTargetId(target);
  if (!parseNavigationTargetId(targetId)) return normalizeRecentConversations(recent, limit);
  return normalizeRecentConversations([
    { targetId, openedAt: timestamp(openedAt) || new Date().toISOString() },
    ...normalizeRecentConversations(recent, Number.MAX_SAFE_INTEGER).filter((entry) => entry.targetId !== targetId),
  ], limit);
}

function renderProject(project, activeProjectId) {
  const active = project.id === activeProjectId;
  const path = project.gitPath || project.id;
  return `
    <button class="project-card navigation-project-row ${active ? "active" : ""}" type="button" data-project-id="${escapeNavigationHtml(project.id)}">
      <span class="project-active-dot" aria-hidden="true"></span>
      <span class="project-card-main">
        <span class="project-card-top"><span class="project-name">${escapeNavigationHtml(project.name)}</span></span>
        <span class="project-path" title="${escapeNavigationHtml(path)}">${escapeNavigationHtml(path)}</span>
      </span>
    </button>`;
}

function renderConversation(conversation, activeAgentId, nested = false) {
  const active = conversation.agentId === activeAgentId;
  const breadcrumb = [conversation.projectName, conversation.worklineTitle].filter(Boolean).join(" / ");
  const meta = [conversation.model, conversation.agentStatus, `${conversation.messageCount} 条消息`].filter(Boolean).join(" · ");
  return `
    <button class="navigation-conversation-row ${nested ? "nested" : ""} ${active ? "active" : ""}" type="button" data-navigation-target="${escapeNavigationHtml(conversation.targetId)}">
      <span class="navigation-agent-icon" aria-hidden="true">☻</span>
      <span class="navigation-conversation-main">
        <span class="navigation-conversation-title">${escapeNavigationHtml(conversation.agentTitle)}</span>
        <span class="navigation-breadcrumb" title="${escapeNavigationHtml(breadcrumb)}">${escapeNavigationHtml(breadcrumb)}</span>
        <span class="navigation-conversation-meta">${escapeNavigationHtml(meta)}</span>
      </span>
    </button>`;
}

export function renderNavigationHTML(view = {}, options = {}) {
  const mode = navigationModes.has(view.mode) ? view.mode : "all";
  const activeProjectId = text(options.activeProjectId);
  const activeAgentId = text(options.activeAgentId);
  let html = "";
  if (mode === "all") {
    html = (view.groups || []).map((group) => `
      <section class="navigation-project-group">
        ${renderProject(group.project, activeProjectId)}
        ${group.conversations.map((conversation) => renderConversation(conversation, activeAgentId, true)).join("")}
      </section>`).join("");
  } else if (mode === "projects") {
    html = (view.projects || []).map((project) => renderProject(project, activeProjectId)).join("");
  } else {
    html = (view.conversations || []).map((conversation) => renderConversation(conversation, activeAgentId)).join("");
  }
  if (html) return html;
  if (view.query) return `<div class="empty-list">没有匹配“${escapeNavigationHtml(view.query)}”的结果。</div>`;
  if (!view.totalProjectCount) {
    return `
      <button class="project-card project-card-empty" type="button" data-open-directory-shortcut="new">
        <span class="project-card-main">
          <span class="project-name">选择资料夹开始</span>
          <span class="project-path">点击 AI 代理右侧 ＋ 或中间按钮</span>
        </span>
      </button>`;
  }
  return `<div class="empty-list">${mode === "conversations" ? "暂无 Agent 会话。" : "暂无可用项目。"}</div>`;
}

export function renderRecentConversationsHTML(recent, conversations, activeAgentId = "") {
  const byTarget = new Map((Array.isArray(conversations) ? conversations : []).map((conversation) => [conversation.targetId, conversation]));
  const rows = normalizeRecentConversations(recent).flatMap((entry) => {
    const conversation = byTarget.get(entry.targetId);
    if (!conversation) return [];
    const breadcrumb = [conversation.projectName, conversation.worklineTitle].filter(Boolean).join(" / ");
    return [`
      <button class="recent-item recent-conversation-item ${conversation.agentId === activeAgentId ? "active" : ""}" type="button" data-navigation-target="${escapeNavigationHtml(entry.targetId)}">
        <span>${escapeNavigationHtml(conversation.agentTitle)}</span>
        <small title="${escapeNavigationHtml(breadcrumb)}">${escapeNavigationHtml(breadcrumb)}</small>
      </button>`];
  });
  return rows.join("") || `<div class="recent-empty">暂无最近会话</div>`;
}
