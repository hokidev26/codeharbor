import test from "node:test";
import assert from "node:assert/strict";

import { renderSkillRevisionDrawer, renderSkillScopeBadge, skillContextLabel, skillScopeShadowHint } from "./skills-workbench.mjs";

test("scope labels, badges, and owner shadow hints describe v2 ownership", () => {
  assert.equal(skillContextLabel({ scope: "global" }), "全局作用域");
  assert.equal(skillContextLabel({ scope: "project", projectId: "p-1" }), "项目作用域 · p-1");
  assert.match(renderSkillScopeBadge({ scope: "workspace" }), /工作线/);
  assert.equal(skillScopeShadowHint({ scope: "global" }, { scope: "workspace", worklineId: "w-1" }), "由全局作用域 owner 生效");
  assert.equal(skillScopeShadowHint({ shadowedBy: "workspace" }, { scope: "global" }), "已被更具体作用域的服务端 Skill 覆盖");
});

test("revision drawer renders revision actions and selected detail safely", () => {
  const markup = renderSkillRevisionDrawer({
    context: { scope: "project", projectId: "p-1" },
    drawer: { skillId: "s-1", selectedRevision: "2", revisionDetail: { prompt: "reviewed prompt" } },
    revisions: { items: [{ revisionNo: 2, label: "修订 2", createdAt: "2025-01-01" }], status: "ready" },
  });
  assert.match(markup, /data-skill-v2-restore="s-1"/);
  assert.match(markup, /data-skill-v2-revision-id="2"/);
  assert.match(markup, /reviewed prompt/);
  assert.match(markup, /项目作用域/);
});
