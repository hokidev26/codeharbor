import test from "node:test";
import assert from "node:assert/strict";

import {
  addRecentConversation,
  buildNavigationView,
  createNavigationRefreshController,
  createNavigationTargetId,
  navigationAgentStatusClass,
  navigationRefreshDefaults,
  normalizeNavigationPayload,
  normalizeRecentConversations,
  renderNavigationHTML,
  renderRecentConversationsHTML,
  resolveInitialNavigationTarget,
} from "./conversation-navigation.mjs";
import { localPreferenceBackupKeys, recentConversationsKey } from "./preferences-data.mjs";

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.tasks = [];
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.push({ id, callback, delay });
    return id;
  }

  clearTimeout(id) {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  }

  async runNext() {
    const task = this.tasks.shift();
    assert.ok(task, "expected a scheduled navigation refresh");
    task.callback();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    return task;
  }

  nextDelay() {
    return this.tasks[0]?.delay;
  }
}

const payload = {
  projects: [
    { id: "p1", name: "Alpha", gitPath: "/work/alpha", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "p2", name: "Beta", gitPath: "/work/beta" },
    { id: "invalid" },
  ],
  conversations: [
    {
      projectId: "p1", projectName: "Alpha", projectPath: "/work/alpha", projectUpdatedAt: "2026-01-01T00:00:00Z",
      worklineId: "w1", worklineTitle: "Feature login", worklineRole: "primary", worklineBranch: "feat/login", worklineUpdatedAt: "2026-01-02T00:00:00Z",
      agentId: "a1", agentTitle: "Planner", agentType: "primary", agentStatus: "idle", model: "claude-sonnet", permissionMode: "acceptEdits",
      cwd: "/work/alpha", messageCount: "12", lastActivityAt: "2026-01-03T00:00:00Z",
    },
    {
      projectId: "p1", projectName: "Alpha", projectPath: "/work/alpha",
      worklineId: "w2", worklineTitle: "Docs", worklineBranch: "docs",
      agentId: "a2", agentTitle: "Writer", model: "gpt-5", messageCount: -2,
    },
    {
      projectId: "p2", projectName: "Beta", projectPath: "/work/beta",
      worklineId: "w3", worklineTitle: "Release", agentId: "a3", agentTitle: "Verifier", model: "gemini-pro", messageCount: 4,
    },
    { projectId: "p1", worklineId: "", agentId: "bad" },
  ],
};

test("normalizeNavigationPayload normalizes the backend contract and target ids", () => {
  const normalized = normalizeNavigationPayload(payload);
  assert.equal(normalized.projects.length, 3);
  assert.equal(normalized.projects[2].name, "invalid");
  assert.equal(normalized.conversations.length, 3);
  assert.equal(normalized.conversations[0].agentId, "a1");
  assert.equal(normalized.conversations[0].messageCount, 12);
  assert.equal(normalized.conversations[1].messageCount, 4);
  assert.equal(normalized.conversations[2].messageCount, 0);
  assert.equal(normalized.conversations[0].targetId, createNavigationTargetId({ projectId: "p1", worklineId: "w1", agentId: "a1" }));
});

test("navigation status classes remain safe for live agent state styling", () => {
  assert.equal(navigationAgentStatusClass("RUNNING"), "running");
  assert.equal(navigationAgentStatusClass("agent error"), "agent-error");
  assert.equal(navigationAgentStatusClass(`\"><script>`), "script");
  assert.equal(navigationAgentStatusClass(""), "idle");
});

test("navigation refresh runs immediately on demand and pauses network work while hidden", async () => {
  const timers = new FakeTimers();
  const reasons = [];
  let visible = true;
  const controller = createNavigationRefreshController({
    timers,
    intervalMs: navigationRefreshDefaults.intervalMs,
    shouldRefresh: () => visible,
    refresh: ({ reason }) => reasons.push(reason),
  });

  assert.equal(controller.intervalMs, 2000);
  assert.equal(controller.start(), true);
  assert.equal(timers.nextDelay(), 2000);
  assert.equal(controller.request("agent.started"), true);
  assert.equal(timers.nextDelay(), 0);
  await timers.runNext();
  assert.deepEqual(reasons, ["agent.started"]);
  assert.equal(timers.nextDelay(), 2000);

  visible = false;
  await timers.runNext();
  assert.deepEqual(reasons, ["agent.started"]);
  assert.equal(timers.nextDelay(), 2000);

  visible = true;
  controller.request("visible");
  await timers.runNext();
  assert.deepEqual(reasons, ["agent.started", "visible"]);
  assert.equal(controller.stop(), true);
  assert.equal(timers.tasks.length, 0);
});

test("project groups contain every conversation once and preserve recent ordering", () => {
  const duplicatedPayload = {
    ...payload,
    conversations: [payload.conversations[1], ...payload.conversations, payload.conversations[0]],
  };
  const normalized = normalizeNavigationPayload(duplicatedPayload);
  const all = buildNavigationView(duplicatedPayload, { mode: "all" });

  assert.equal(normalized.conversations.length, 3);
  assert.deepEqual(all.groups.find((group) => group.project.id === "p1").conversations.map((item) => item.agentId), ["a1", "a2"]);
  const html = renderNavigationHTML(all, { activeProjectId: "p1", activeAgentId: "a2" });
  assert.match(html, /data-navigation-project-group="p1" data-conversation-count="2"/);
  assert.equal((html.match(/data-navigation-target="p1::w1::a1"/g) || []).length, 1);
  assert.equal((html.match(/data-navigation-target="p1::w2::a2"/g) || []).length, 1);
  assert.match(html, /navigation-conversation-row nested active/);
  assert.match(html, /project-card-top"><span class="project-kind-badge">PROJECT<\/span><span class="project-name">Alpha<\/span><span class="project-agent-count"[^>]*>AGENT 2<\/span>/);
  assert.match(html, /navigation-conversation-row nested[^\"]*status-idle/);
  assert.match(html, /data-agent-status="idle"/);
  assert.match(html, /navigation-conversation-meta" title="feat\/login · claude-sonnet · idle ·/);
  assert.doesNotMatch(html, /navigation-breadcrumb/);
});

test("buildNavigationView supports all, projects, and conversations modes", () => {
  const all = buildNavigationView(payload, { mode: "all" });
  assert.equal(all.groups.length, 3);
  assert.deepEqual(all.groups[0].conversations.map((item) => item.agentId), ["a1", "a2"]);
  assert.equal(all.projects.length, 3);
  assert.deepEqual(all.conversations, []);

  const projects = buildNavigationView(payload, { mode: "projects" });
  assert.deepEqual(projects.projects.map((item) => item.id), ["p1", "p2", "invalid"]);
  assert.equal(projects.groups.length, 3);
  assert.deepEqual(projects.groups[0].conversations.map((item) => item.agentId), ["a1", "a2"]);
  assert.match(renderNavigationHTML(projects), /data-navigation-project-group="p1" data-conversation-count="2"/);

  const conversations = buildNavigationView(payload, { mode: "conversations" });
  assert.deepEqual(conversations.conversations.map((item) => item.agentId), ["a1", "a3", "a2"]);
  assert.deepEqual(conversations.projects, []);
});

test("task navigation keeps project and agent context without exposing project creation", () => {
  const taskHTML = renderNavigationHTML(buildNavigationView(payload, { mode: "projects" }), { taskContext: true });
  const taskEmptyHTML = renderNavigationHTML(buildNavigationView({}, { mode: "projects" }), { taskContext: true });
  const conversationEmptyHTML = renderNavigationHTML(buildNavigationView({}, { mode: "projects" }));

  assert.match(taskHTML, /data-navigation-context="tasks"/);
  assert.match(taskHTML, /navigation-conversation-row nested task-context/);
  assert.doesNotMatch(taskHTML, /12 (?:条消息|條訊息|messages)/);
  assert.match(taskEmptyHTML, /data-task-project-boundary="true"/);
  assert.match(taskEmptyHTML, /data-primary-workbench-target="conversation"/);
  assert.doesNotMatch(taskEmptyHTML, /data-open-directory-shortcut/);
  assert.match(conversationEmptyHTML, /data-open-directory-shortcut="new"/);
});

test("navigation search matches project path, workline, agent title, and model", () => {
  assert.deepEqual(buildNavigationView(payload, { mode: "projects", query: "/work/beta" }).projects.map((item) => item.id), ["p2"]);
  assert.deepEqual(buildNavigationView(payload, { mode: "conversations", query: "Feature login" }).conversations.map((item) => item.agentId), ["a1"]);
  assert.deepEqual(buildNavigationView(payload, { mode: "conversations", query: "Writer" }).conversations.map((item) => item.agentId), ["a2"]);
  assert.deepEqual(buildNavigationView(payload, { mode: "conversations", query: "gemini-pro" }).conversations.map((item) => item.agentId), ["a3"]);

  const grouped = buildNavigationView(payload, { mode: "all", query: "Docs" });
  assert.equal(grouped.groups.length, 1);
  assert.deepEqual(grouped.groups[0].conversations.map((item) => item.agentId), ["a2"]);
});

test("recent conversations deduplicate newest targets and truncate to eight", () => {
  const targets = Array.from({ length: 10 }, (_, index) => ({ projectId: `p${index}`, worklineId: `w${index}`, agentId: `a${index}` }));
  let recent = targets.reduceRight((items, target, index) => addRecentConversation(items, target, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`), []);
  assert.equal(recent.length, 8);

  recent = addRecentConversation(recent, targets[3], "2026-02-01T00:00:00Z");
  assert.equal(recent.length, 8);
  assert.equal(recent[0].targetId, createNavigationTargetId(targets[3]));
  assert.equal(recent.filter((item) => item.targetId === recent[0].targetId).length, 1);
  assert.deepEqual(normalizeRecentConversations([recent[0], recent[0], { targetId: "bad" }]), [recent[0]]);
});

test("initial navigation restores the newest valid recent conversation before backend fallback", () => {
  const conversations = normalizeNavigationPayload(payload).conversations;
  const targetA = conversations.find((conversation) => conversation.agentId === "a1").targetId;
  const targetB = conversations.find((conversation) => conversation.agentId === "a3").targetId;

  assert.equal(resolveInitialNavigationTarget([
    { targetId: "missing::workline::agent", openedAt: "2026-03-02T00:00:00Z" },
    { targetId: targetB, openedAt: "2026-03-01T00:00:00Z" },
    { targetId: targetA, openedAt: "2026-02-01T00:00:00Z" },
  ], conversations), targetB);
  assert.equal(resolveInitialNavigationTarget([], conversations), conversations[0].targetId);
  assert.equal(resolveInitialNavigationTarget([], []), "");
});

test("global recent conversations do not duplicate project-grouped conversations", () => {
  const normalized = normalizeNavigationPayload(payload);
  const recent = normalized.conversations.map((conversation) => ({
    targetId: conversation.targetId,
    openedAt: "2026-02-01T00:00:00Z",
  }));
  const html = renderRecentConversationsHTML(recent, normalized.conversations, "a1");

  assert.doesNotMatch(html, /recent-conversation-item/);
  assert.match(html, /data-recent-conversations-deduplicated="true"/);
  assert.match(html, /data-deduplicated-count="3"/);
});

test("recent conversations are registered in local preference backups", () => {
  assert.ok(localPreferenceBackupKeys.some((entry) => entry.key === recentConversationsKey && entry.type === "json"));
});

test("navigation rendering escapes all dynamic text and attributes", () => {
  const malicious = '"><img src=x onerror="boom">';
  const maliciousPayload = {
    projects: [{ id: malicious, name: `<script>alert("project")</script>`, gitPath: malicious }],
    conversations: [{
      projectId: malicious, projectName: malicious, projectPath: malicious,
      worklineId: "work", worklineTitle: `<b>workline</b>`,
      agentId: "agent", agentTitle: `<img src=x onerror="agent">`, model: `<svg onload="model">`, messageCount: 1,
    }],
  };
  const normalized = normalizeNavigationPayload(maliciousPayload);
  const html = renderNavigationHTML(buildNavigationView(maliciousPayload, { mode: "all" }), {
    activeProjectId: malicious,
    activeAgentId: "agent",
  });
  const recentHtml = renderRecentConversationsHTML([
    { targetId: normalized.conversations[0].targetId, openedAt: "2026-01-01T00:00:00Z" },
  ], normalized.conversations);

  assert.doesNotMatch(`${html}${recentHtml}`, /<script>|<img src=x|<svg onload|<b>/);
  assert.match(html, /class="project-kind-badge">PROJECT<\/span>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;project&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;agent&quot;&gt;/);
  assert.doesNotMatch(recentHtml, /recent-conversation-item|<img/);
  assert.match(recentHtml, /data-recent-conversations-deduplicated="true"/);
});
