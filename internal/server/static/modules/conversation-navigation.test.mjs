import test from "node:test";
import assert from "node:assert/strict";

import {
  addRecentConversation,
  buildNavigationView,
  createNavigationTargetId,
  normalizeNavigationPayload,
  normalizeRecentConversations,
  renderNavigationHTML,
  renderRecentConversationsHTML,
} from "./conversation-navigation.mjs";
import { localPreferenceBackupKeys, recentConversationsKey } from "./preferences-data.mjs";

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

test("buildNavigationView supports all, projects, and conversations modes", () => {
  const all = buildNavigationView(payload, { mode: "all" });
  assert.equal(all.groups.length, 3);
  assert.deepEqual(all.groups[0].conversations.map((item) => item.agentId), ["a1", "a2"]);
  assert.equal(all.projects.length, 3);
  assert.deepEqual(all.conversations, []);

  const projects = buildNavigationView(payload, { mode: "projects" });
  assert.deepEqual(projects.projects.map((item) => item.id), ["p1", "p2", "invalid"]);
  assert.deepEqual(projects.groups, []);

  const conversations = buildNavigationView(payload, { mode: "conversations" });
  assert.deepEqual(conversations.conversations.map((item) => item.agentId), ["a1", "a3", "a2"]);
  assert.deepEqual(conversations.projects, []);
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
  assert.match(html, /&lt;script&gt;alert\(&quot;project&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;agent&quot;&gt;/);
  assert.match(recentHtml, /&quot;&gt;&lt;img src=x onerror=&quot;boom&quot;&gt;/);
});
