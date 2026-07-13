import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { normalizeSlashCommandName } from "./skills-commands.mjs";
import { skillTabs } from "./settings-data.mjs";

export function createSkillsWorkbenchController({
  state,
  bindMCPRegistryActions,
  copyText,
  createServerSkill,
  createToolPermissionRule,
  currentSkillsPreferences,
  deleteServerSkill,
  deleteToolPermissionRule,
  isMCPRegistryActionBusy,
  importServerSkill,
  loadServerSkills,
  loadServerSkillDetail,
  loadWorkflowPolicy,
  localSkillID,
  normalizeMCPServer,
  normalizeSkillCommand,
  notifyTerminal,
  previewServerSkillImport,
  renderMCPRegistryList,
  resetSkillsPreferences,
  saveSkillsPreferences,
  saveWorkflowPreferences,
  showError,
  skillsPhaseB,
  skillsPrefsExport,
  getSkillContext,
  setSkillContext,
  updateServerSkill,
  updateToolPermissionRule,
} = {}) {
  function renderSkillSettingsContent(activeKey = "commands") {
    const active = skillTabs.find((tab) => tab.key === activeKey) || skillTabs[0];
    state.activeSkillTab = active.key;
    return `
    <div class="skills-page">
      <div class="skills-tabs" role="tablist" aria-label="技能设置分类">
        ${skillTabs.map((tab) => `
          <button class="skills-tab ${tab.key === active.key ? "active" : ""}" type="button" data-skill-tab="${escapeAttr(tab.key)}" role="tab" aria-selected="${tab.key === active.key ? "true" : "false"}">
            ${escapeHtml(tab.label)}
          </button>
        `).join("")}
      </div>
      <section class="skills-tab-panel" role="tabpanel">
        ${renderSkillTabPanel(active)}
      </section>
    </div>
  `;
  }

  function renderSkillTabPanel(active) {
    if (active.key === "commands") return renderLocalCommandSkills(active);
    if (active.key === "mcp-tools") return renderLocalMCPTools(active);
    if (active.key === "tool-permissions") return renderLocalToolPolicy(active);
    return renderSkillRoadmapPanel(active);
  }

  let pendingSkillImportContent = "";
  let pendingSkillImportPreview = null;
  let localMigrationSummary = "";

  function renderLocalCommandSkills(active) {
    const phaseBMarkup = skillsPhaseB ? renderSkillsPhaseBCommands(active) : "";
    if (state.serverSkillsStatus === "idle") {
      loadServerSkills?.().catch(showError);
    }
    const localCommands = currentSkillsPreferences().commands || [];
    const serverSkills = Array.isArray(state.serverSkills) ? state.serverSkills : [];
    const loading = state.serverSkillsStatus === "loading";
    return `
    ${phaseBMarkup}
    <p class="skills-description">${escapeHtml(active.description)} 以下兼容管理入口仅操作全局作用域；服务端技能保存到 SQLite，只会展开为聊天提示词模板，不会自动执行 shell、安装软件、读取文件或改变工具权限。</p>
    <div class="skill-workbench-actions">
      <button id="refreshServerSkillsBtn" class="settings-action-btn subtle" type="button" ${loading ? "disabled" : ""}>${loading ? "刷新中" : "刷新服务端技能"}</button>
      <button id="migrateLocalSkillsBtn" class="settings-action-btn subtle" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>迁移浏览器本地模板（${localCommands.length}）</button>
    </div>
    ${state.serverSkillsError ? `<div class="settings-inline-alert">${escapeHtml(state.serverSkillsError)}</div>` : ""}
    ${localMigrationSummary ? `<div class="settings-provider-meta">${escapeHtml(localMigrationSummary)}</div>` : ""}
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">服务端 Skills</div>
          <div class="settings-provider-meta">命令大小写不敏感且唯一。blocked 永远不能启用；review 需要在启用时再次明确确认风险。</div>
        </div>
        <span class="settings-status-pill ${loading || state.serverSkillsStatus === "stale" ? "warn" : state.serverSkillsStatus === "error" ? "muted" : "ok"}">${loading ? "加载中" : state.serverSkillsStatus === "stale" ? "旧数据" : state.serverSkillsStatus === "error" ? "加载失败" : state.serverSkillsStatus === "ready" ? "已加载" : "未加载"}</span>
      </div>
      <div class="skill-command-list">
        ${loading && !serverSkills.length ? `<div class="settings-empty-card compact">正在加载服务端技能…</div>` : serverSkills.length ? serverSkills.map(renderServerSkillCard).join("") : `<div class="settings-empty-card compact">暂无服务端技能。可以创建命令或导入 SKILL.md。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">导入 SKILL.md</div>
      <div class="settings-provider-meta">仅上传本地文件内容进行无副作用预览；服务端不会接受或读取任意文件系统路径。导入默认停用。</div>
      <div class="settings-action-row settings-form-actions">
        <input id="skillImportFile" class="hidden" type="file" accept=".md,text/markdown,text/plain" />
        <button id="chooseSkillImportFileBtn" class="settings-action-btn subtle" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>选择 SKILL.md</button>
      </div>
      ${renderSkillImportPreview()}
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">新增服务端命令</div>
      <div class="settings-provider-meta">新命令会先以停用状态保存；请阅读扫描结果后再启用。</div>
      <form id="skillCommandForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>命令名<input id="skillCommandName" class="settings-field" placeholder="/explain-error" /></label>
          <label>描述<input id="skillCommandDescription" class="settings-field" placeholder="解释错误并给出修复路径" /></label>
          <label class="settings-form-span-2">提示词模板<textarea id="skillCommandPrompt" class="settings-field settings-textarea" rows="5" placeholder="请解释以下错误，指出根因并给出最小修复步骤..."></textarea></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit" ${state.serverSkillsSaving ? "disabled" : ""}>保存为停用技能</button></div>
      </form>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">浏览器本地模板兼容回退</div>
      <div class="settings-provider-meta">本地数据不会被迁移操作删除。聊天面板会服务端优先合并并自动去重；迁移完成后请手工确认服务器列表，再自行决定是否清理浏览器数据。</div>
    </section>
  `;
  }

  function renderSkillsPhaseBCommands(active) {
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    if (bucket.status === "idle") skillsPhaseB.load(context).catch(showError);
    const loading = bucket.status === "loading";
    const drawer = bucket.drawer;
    const revisions = drawer ? (bucket.revisions?.[drawer.skillId] || { items: [], status: "idle" }) : null;
    return `
      <p class="skills-description">${escapeHtml(active.description)} Skills 会按作用域隔离；相同命令由更具体的服务端 owner 覆盖，本地模板不会绕过禁用、blocked 或未确认 review 的服务端记录。</p>
      <section class="settings-provider-section highlighted skills-v2-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">服务端 Skills（Phase B）</div>
            <div class="settings-provider-meta">${escapeHtml(skillContextLabel(context))} · 快照 ${escapeHtml(String(bucket.snapshotSequence ?? "—"))}</div>
          </div>
          <div class="skill-workbench-actions">
            ${setSkillContext ? `<select id="skillsV2ScopeSelect" class="settings-field skills-scope-select" aria-label="Skills 作用域">${renderSkillScopeOptions(context.scope)}</select>` : ""}
            <button id="refreshSkillsV2Btn" class="settings-action-btn subtle" type="button" ${loading ? "disabled" : ""}>${loading ? "刷新中" : "刷新"}</button>
          </div>
        </div>
        ${bucket.error ? `<div class="settings-inline-alert">${escapeHtml(bucket.error)}</div>` : ""}
        <div class="skill-command-list">
          ${loading && !bucket.items.length ? `<div class="settings-empty-card compact">正在加载 Skills…</div>` : bucket.items.length ? bucket.items.map((skill) => renderPhaseBSkillCard(skill, context)).join("") : `<div class="settings-empty-card compact">当前作用域没有 Skills。</div>`}
        </div>
        ${bucket.nextCursor ? `<button id="loadMoreSkillsV2Btn" class="settings-action-btn subtle" type="button" ${bucket.status === "loading-more" ? "disabled" : ""}>${bucket.status === "loading-more" ? "加载中" : "加载更多"}</button>` : ""}
      </section>
      ${drawer ? renderSkillRevisionDrawer({ drawer, revisions, context }) : ""}
    `;
  }

  function renderServerSkillCard(skill) {
    const verdict = String(skill.scanVerdict || "safe");
    const verdictLabel = { safe: "安全", review: "需复核", blocked: "已阻断" }[verdict] || verdict;
    const tone = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "muted";
    const detailsLoaded = Boolean(skill.detailLoaded && String(skill.prompt || "").trim());
    const findings = Array.isArray(skill.scanFindings) ? skill.scanFindings : [];
    const findingCount = Number.isFinite(Number(skill.findingCount)) ? Number(skill.findingCount) : findings.length;
    const canEnable = verdict !== "blocked";
    const findingsMarkup = detailsLoaded
      ? (findings.length ? `<ul class="skill-findings">${findings.map((finding) => `<li><strong>${escapeHtml(finding.code || "scan")}</strong>：${escapeHtml(finding.message || "需要人工复核")}</li>`).join("")}</ul>` : `<div class="settings-provider-meta">扫描未发现需要复核的模式。</div>`)
      : `<div class="settings-provider-meta">${findingCount} 条扫描发现；加载详情后查看代码和说明。</div>`;
    return `
    <div class="skill-command-card ${skill.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(skill.command)} <span class="settings-status-pill ${skill.enabled ? "ok" : "muted"}">${skill.enabled ? "启用" : "停用"}</span> <span class="settings-status-pill ${tone}">${escapeHtml(verdictLabel)}</span></div>
        <div class="settings-provider-meta">${escapeHtml(skill.name || "未命名技能")} · ${escapeHtml(skill.description || "无描述")} · 来源 ${escapeHtml(skillSourceLabel(skill.source))}</div>
        ${findingsMarkup}
        ${detailsLoaded ? `<pre class="skill-command-prompt">${escapeHtml(skill.prompt)}</pre>` : `<div class="settings-provider-meta">${skill.detailError ? `详情加载失败：${escapeHtml(skill.detailError)}` : "详情尚未加载。"}</div>`}
      </div>
      <div class="settings-action-row">
        ${detailsLoaded ? "" : `<button class="settings-action-btn subtle" type="button" data-server-skill-detail="${escapeAttr(skill.id)}">加载详情</button>`}
        <button class="settings-action-btn subtle" type="button" data-server-skill-copy="${escapeAttr(skill.id)}">复制</button>
        <button class="settings-action-btn subtle" type="button" data-server-skill-toggle="${escapeAttr(skill.id)}" ${!canEnable || state.serverSkillsSaving ? "disabled" : ""}>${skill.enabled ? "停用" : canEnable ? "启用" : "禁止启用"}</button>
        <button class="settings-action-btn danger" type="button" data-server-skill-delete="${escapeAttr(skill.id)}" ${state.serverSkillsSaving ? "disabled" : ""}>删除</button>
      </div>
    </div>
  `;
  }

  function renderSkillImportPreview() {
    const preview = pendingSkillImportPreview;
    if (!preview) return "";
    const findings = Array.isArray(preview.scanFindings) ? preview.scanFindings : [];
    const blocked = preview.scanVerdict === "blocked";
    return `
      <div class="skill-command-card ${blocked ? "disabled" : ""}">
        <div>
          <div class="skill-command-title">预览 ${escapeHtml(preview.command || "")}&nbsp;<span class="settings-status-pill ${blocked ? "muted" : preview.scanVerdict === "review" ? "warn" : "ok"}">${escapeHtml(preview.scanVerdict || "safe")}</span></div>
          <div class="settings-provider-meta">${escapeHtml(preview.name || "")} · ${escapeHtml(preview.description || "")}</div>
          ${findings.length ? `<ul class="skill-findings">${findings.map((finding) => `<li><strong>${escapeHtml(finding.code || "scan")}</strong>：${escapeHtml(finding.message || "需要人工复核")}</li>`).join("")}</ul>` : `<div class="settings-provider-meta">扫描未发现需要复核的模式。</div>`}
        </div>
        <div class="settings-action-row"><button id="confirmSkillImportBtn" class="settings-action-btn primary" type="button" ${state.serverSkillsSaving ? "disabled" : ""}>确认导入（默认停用）</button></div>
      </div>
    `;
  }

  function skillSourceLabel(source) {
    return { manual: "手工创建", local_migration: "本地模板迁移", skill_md: "SKILL.md" }[String(source || "")] || "未知";
  }

  function renderLocalMCPTools(active) {
    const prefs = currentSkillsPreferences();
    const editingRegistryId = state.mcpRegistryEditingId || "";
    const editingRegistryServer = editingRegistryId ? state.mcpRegistryServers.find((server) => server.id === editingRegistryId) : null;
    const editingRegistryArgs = Array.isArray(editingRegistryServer?.args) ? editingRegistryServer.args.join(" ") : "";
    const registrySubmitting = editingRegistryId ? isMCPRegistryActionBusy(editingRegistryId, "update") : isMCPRegistryActionBusy("new", "create");
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">后端 MCP registry</div>
          <div class="settings-provider-meta">持久保存到 SQLite，可被 MCPListTools / MCPCallTool 通过 serverId 使用；env value 不会在 API 响应中返回。</div>
        </div>
        <button id="refreshMCPRegistryBtn" class="settings-action-btn subtle" type="button">${state.mcpRegistryLoading ? "刷新中" : "刷新 registry"}</button>
      </div>
      ${renderMCPRegistryList()}
      <form id="mcpRegistryForm" class="skill-command-form" data-mcp-registry-editing="${escapeAttr(editingRegistryId)}">
        <div class="settings-provider-title">${editingRegistryId ? "编辑后端 MCP server" : "新增后端 MCP server"}</div>
        ${editingRegistryId ? `<div class="settings-provider-meta">正在编辑 serverId: <code>${escapeHtml(editingRegistryId)}</code>。Env value 不会回显；如需修改环境变量，请重新填写 Env JSON。</div>` : ""}
        <div class="settings-provider-form-grid">
          <label>名称<input id="mcpRegistryName" class="settings-field" value="${escapeAttr(editingRegistryServer?.name || "")}" placeholder="filesystem" /></label>
          <label>启用
            <select id="mcpRegistryEnabled" class="settings-field"><option value="true" ${editingRegistryServer?.enabled === false ? "" : "selected"}>enabled</option><option value="false" ${editingRegistryServer?.enabled === false ? "selected" : ""}>disabled</option></select>
          </label>
          <label>Command<input id="mcpRegistryCommand" class="settings-field" value="${escapeAttr(editingRegistryServer?.command || "")}" placeholder="npx" /></label>
          <label>Args<input id="mcpRegistryArgs" class="settings-field" value="${escapeAttr(editingRegistryArgs)}" placeholder="@modelcontextprotocol/server-filesystem ~/projects" /></label>
          <label class="settings-form-span-2">CWD（可选）<input id="mcpRegistryCWD" class="settings-field" value="${escapeAttr(editingRegistryServer?.cwd || "")}" placeholder="/Users/me/project" /></label>
          <label class="settings-form-span-2">Env JSON（可选；响应只显示 key）
            <textarea id="mcpRegistryEnv" class="settings-field settings-textarea" rows="3" placeholder='{"TOKEN":"..."}'></textarea>
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          ${editingRegistryId ? `<button id="cancelMCPRegistryEditBtn" class="settings-action-btn subtle" type="button">取消编辑</button>` : ""}
          <button class="settings-action-btn primary" type="submit" ${registrySubmitting ? "disabled" : ""}>${registrySubmitting ? (editingRegistryId ? "更新中" : "创建中") : (editingRegistryId ? "更新后端 server" : "创建后端 server")}</button>
        </div>
      </form>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">浏览器本地 MCP server 草案</div>
      <div class="settings-provider-meta">草案仅保存在浏览器本地；点击“保存到 registry”后才会持久化到后端并可被工具调用。</div>
      <div class="skill-command-list">
        ${prefs.mcpServers.length ? prefs.mcpServers.map(renderMCPServerCard).join("") : `<div class="settings-empty-card compact">暂无 MCP server 草案。这里仅保存本地配置草稿，不会启动进程。</div>`}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-title">新增 MCP server 草案</div>
      <form id="mcpServerForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>名称<input id="mcpServerName" class="settings-field" placeholder="filesystem" /></label>
          <label>Transport<select id="mcpServerTransport" class="settings-field"><option value="stdio">stdio</option><option value="sse">sse</option><option value="http">http</option></select></label>
          <label class="settings-form-span-2">启动命令 / URL<input id="mcpServerCommand" class="settings-field" placeholder="npx @modelcontextprotocol/server-filesystem ~/projects" /></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit">添加 MCP 草案</button></div>
      </form>
    </section>
  `;
  }

  function renderMCPServerCard(server) {
    return `
    <div class="skill-command-card ${server.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(server.name || "MCP Server")} <span class="settings-status-pill ${server.enabled ? "ok" : "muted"}">${server.enabled ? "启用草案" : "停用草案"}</span></div>
        <div class="settings-provider-meta">${escapeHtml(server.transport)} · ${escapeHtml(server.command || "未填写命令")}</div>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-mcp-register="${escapeAttr(server.id)}" ${isMCPRegistryActionBusy(server.id, "register") ? "disabled" : ""}>${isMCPRegistryActionBusy(server.id, "register") ? "保存中" : "保存到 registry"}</button>
        <button class="settings-action-btn subtle" type="button" data-mcp-toggle="${escapeAttr(server.id)}">${server.enabled ? "停用" : "启用"}</button>
        <button class="settings-action-btn danger" type="button" data-mcp-delete="${escapeAttr(server.id)}">删除</button>
      </div>
    </div>
  `;
  }

  function renderLocalToolPolicy(active) {
    if (!state.workflowPreferences && !state.workflowLoading && !state.workflowError) {
      loadWorkflowPolicy?.().catch(showError);
    }
    const prefs = state.workflowPreferences || { requireConfirmationForExec: true, requireConfirmationForWrites: false, allowReadOnlyByDefault: true };
    const rules = Array.isArray(state.toolPermissionRules) ? state.toolPermissionRules : [];
    const loading = state.workflowLoading || state.toolPermissionRulesLoading;
    return `
    <p class="skills-description">${escapeHtml(active.description)} 这些策略保存到服务端 SQLite，并会影响后端 Agent 的工具决策。</p>
    <div class="skill-workbench-actions">
      <button id="refreshWorkflowPolicyBtn" class="settings-action-btn subtle" type="button">${loading ? "刷新中" : "刷新服务端策略"}</button>
    </div>
    ${state.workflowError || state.toolPermissionRulesError ? `<div class="settings-inline-alert">${escapeHtml(state.workflowError || state.toolPermissionRulesError)}</div>` : ""}
    <section class="settings-provider-section highlighted">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">服务端工作流偏好</div>
          <div class="settings-provider-meta">只展示当前真正接入 Agent 决策的偏好；“大型任务优先计划”仍是本地草案，后续接入服务端计划模式。</div>
        </div>
        <span class="settings-status-pill ${loading ? "warn" : "ok"}">${loading ? "加载中" : "已接入"}</span>
      </div>
      <div class="appearance-toggle-list">
        ${renderWorkflowPolicyToggle("requireConfirmationForExec", "执行命令前确认", "关闭后非 danger exec 默认允许；内置危险命令仍硬阻断。", prefs.requireConfirmationForExec !== false)}
        ${renderWorkflowPolicyToggle("requireConfirmationForWrites", "写入文件前确认", "开启后 Write/Edit 等写入风险工具会先进入审批。", Boolean(prefs.requireConfirmationForWrites))}
        ${renderWorkflowPolicyToggle("allowReadOnlyByDefault", "默认允许只读工具", "关闭后 Read/Glob/Grep 等只读工具在 Agent loop 中也需要审批。", prefs.allowReadOnlyByDefault !== false)}
      </div>
    </section>
    <section class="settings-provider-section">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">工具权限规则</div>
          <div class="settings-provider-meta">依次比较 priority、精确匹配字段数与安全决策；同级同精度时 deny 优先于 ask、allow。danger 与 readOnly 硬上限不会被规则绕过。</div>
        </div>
      </div>
      <div class="skill-command-list workflow-rule-list">
        ${rules.length ? rules.map(renderToolPermissionRuleCard).join("") : `<div class="settings-empty-card compact">暂无服务端工具权限规则，使用内置默认策略。</div>`}
      </div>
      <form id="toolPermissionRuleForm" class="skill-command-form workflow-rule-form">
        <div class="settings-provider-title">新增规则</div>
        <div class="settings-provider-form-grid">
          <label>权限模式<select id="toolPermissionMode" class="settings-field">${renderPermissionRuleOptions(["*", "readOnly", "acceptEdits", "bypassPermissions", "default", "dontAsk"], "acceptEdits")}</select></label>
          <label>工具名<input id="toolPermissionToolName" class="settings-field" value="Bash" placeholder="Bash 或 *" /></label>
          <label>风险<select id="toolPermissionRisk" class="settings-field">${renderPermissionRuleOptions(["read", "write", "exec", "danger", "*"], "exec")}</select></label>
          <label>决策<select id="toolPermissionDecision" class="settings-field">${renderPermissionRuleOptions(["ask", "deny", "allow"], "ask")}</select></label>
          <label>优先级<input id="toolPermissionPriority" class="settings-field" type="number" value="10" /></label>
          <label class="settings-form-span-2">说明<input id="toolPermissionDescription" class="settings-field" placeholder="例如：Bash exec 需要人工确认" /></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit" ${state.toolPermissionRulesSaving ? "disabled" : ""}>${state.toolPermissionRulesSaving ? "保存中" : "添加服务端规则"}</button></div>
      </form>
    </section>
  `;
  }

  function renderWorkflowPolicyToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row skill-policy-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-workflow-policy="${escapeAttr(field)}" ${checked ? "checked" : ""} ${state.workflowSaving ? "disabled" : ""} />
    </label>
  `;
  }

  function renderToolPermissionRuleCard(rule) {
    return `
    <div class="skill-command-card workflow-rule-card ${rule.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(rule.toolName || "*")} <span class="settings-status-pill ${rule.enabled ? "ok" : "muted"}">${rule.enabled ? "启用" : "停用"}</span></div>
        <div class="settings-provider-meta">mode ${escapeHtml(rule.mode || "*")} · risk ${escapeHtml(rule.risk || "*")} · decision ${escapeHtml(rule.decision || "ask")} · priority ${escapeHtml(String(rule.priority || 0))}</div>
        ${rule.description ? `<div class="settings-provider-meta">${escapeHtml(rule.description)}</div>` : ""}
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-tool-permission-toggle="${escapeAttr(rule.id)}" ${state.toolPermissionRulesSaving ? "disabled" : ""}>${rule.enabled ? "停用" : "启用"}</button>
        <button class="settings-action-btn danger" type="button" data-tool-permission-delete="${escapeAttr(rule.id)}" ${state.toolPermissionRulesSaving ? "disabled" : ""}>删除</button>
      </div>
    </div>
  `;
  }

  function renderPermissionRuleOptions(options, selected) {
    return options.map((option) => `<option value="${escapeAttr(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  }

  function renderSkillRoadmapPanel(active) {
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-roadmap-grid">
      ${renderSkillRoadmapCard(active.label, active.empty)}
      ${renderSkillRoadmapCard("服务端 Skills 已接入", "命令模板、SKILL.md 扫描与启用状态由服务端 SQLite 保存；浏览器本地模板仅作为兼容回退。")}
      ${renderSkillRoadmapCard("本轮边界", "Skills 只插入聊天提示词，不会自动执行脚本、安装包、读取文件或改变工具权限。")}
    </div>
  `;
  }

  function renderSkillRoadmapCard(title, description) {
    return `<section class="skill-roadmap-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></section>`;
  }

  function bindSkillTabs(activeKey = "commands") {
    const body = $("settingsContentBody");
    body.querySelectorAll("[data-skill-tab]").forEach((node) => {
      node.addEventListener("click", () => {
        state.activeSkillTab = node.dataset.skillTab;
        body.innerHTML = renderSkillSettingsContent(node.dataset.skillTab);
        bindSkillTabs(node.dataset.skillTab);
      });
    });
    bindMCPRegistryActions(body);
    $("refreshServerSkillsBtn")?.addEventListener("click", () => loadServerSkills?.({ notify: true }).catch(showError));
    $("refreshSkillsV2Btn")?.addEventListener("click", () => skillsPhaseB?.load(getSkillContext?.() || { scope: "global" }).catch(showError));
    $("loadMoreSkillsV2Btn")?.addEventListener("click", () => skillsPhaseB?.loadMore(getSkillContext?.() || { scope: "global" }).catch(showError));
    $("skillsV2ScopeSelect")?.addEventListener("change", (event) => {
      const context = getSkillContext?.() || {};
      setSkillContext?.({ ...context, scope: event.target.value });
      rerenderSkillPanel();
    });
    body.querySelectorAll("[data-skill-v2-detail]").forEach((node) => node.addEventListener("click", () => skillsPhaseB?.loadDetail(node.dataset.skillV2Detail, getSkillContext?.() || { scope: "global" }).catch(showError)));
    body.querySelectorAll("[data-skill-v2-revisions]").forEach((node) => node.addEventListener("click", () => openSkillRevisionDrawer(node.dataset.skillV2Revisions).catch(showError)));
    body.querySelectorAll("[data-skill-v2-revision-detail]").forEach((node) => node.addEventListener("click", () => openSkillRevisionDetail(node.dataset.skillV2RevisionDetail, node.dataset.skillV2RevisionId).catch(showError)));
    body.querySelectorAll("[data-skill-v2-restore]").forEach((node) => node.addEventListener("click", () => restoreSkillRevisionFromDrawer(node.dataset.skillV2Restore, node.dataset.skillV2RevisionId).catch(showError)));
    $("closeSkillRevisionDrawerBtn")?.addEventListener("click", closeSkillRevisionDrawer);
    $("migrateLocalSkillsBtn")?.addEventListener("click", () => migrateLocalSkillTemplates().catch(showError));
    $("chooseSkillImportFileBtn")?.addEventListener("click", () => $("skillImportFile")?.click());
    $("skillImportFile")?.addEventListener("change", (event) => previewSelectedSkillFile(event).catch(showError));
    $("confirmSkillImportBtn")?.addEventListener("click", () => confirmSkillImport().catch(showError));
    $("skillCommandForm")?.addEventListener("submit", (event) => addSkillCommandFromPanel(event).catch(showError));
    $("mcpServerForm")?.addEventListener("submit", (event) => addMCPServerFromPanel(event).catch(showError));
    body.querySelectorAll("[data-server-skill-detail]").forEach((node) => node.addEventListener("click", () => loadServerSkillDetail?.(node.dataset.serverSkillDetail).catch(showError)));
    body.querySelectorAll("[data-server-skill-copy]").forEach((node) => node.addEventListener("click", () => copyServerSkillPrompt(node.dataset.serverSkillCopy).catch(showError)));
    body.querySelectorAll("[data-server-skill-toggle]").forEach((node) => node.addEventListener("click", () => toggleServerSkill(node.dataset.serverSkillToggle).catch(showError)));
    body.querySelectorAll("[data-server-skill-delete]").forEach((node) => node.addEventListener("click", () => deleteServerSkillFromPanel(node.dataset.serverSkillDelete).catch(showError)));
    body.querySelectorAll("[data-mcp-toggle]").forEach((node) => node.addEventListener("click", () => toggleMCPServer(node.dataset.mcpToggle)));
    body.querySelectorAll("[data-mcp-delete]").forEach((node) => node.addEventListener("click", () => deleteMCPServer(node.dataset.mcpDelete)));
    $("refreshWorkflowPolicyBtn")?.addEventListener("click", () => loadWorkflowPolicy?.({ notify: true }).catch(showError));
    $("toolPermissionRuleForm")?.addEventListener("submit", (event) => addToolPermissionRuleFromPanel(event).catch(showError));
    body.querySelectorAll("[data-workflow-policy]").forEach((node) => node.addEventListener("change", () => saveWorkflowPreferencesFromPanel().catch(showError)));
    body.querySelectorAll("[data-tool-permission-toggle]").forEach((node) => node.addEventListener("click", () => toggleToolPermissionRule(node.dataset.toolPermissionToggle).catch(showError)));
    body.querySelectorAll("[data-tool-permission-delete]").forEach((node) => node.addEventListener("click", () => deleteToolPermissionRuleFromPanel(node.dataset.toolPermissionDelete).catch(showError)));
  }

  async function saveWorkflowPreferencesFromPanel() {
    const payload = {
      requireConfirmationForExec: Boolean(document.querySelector('[data-workflow-policy="requireConfirmationForExec"]')?.checked),
      requireConfirmationForWrites: Boolean(document.querySelector('[data-workflow-policy="requireConfirmationForWrites"]')?.checked),
      allowReadOnlyByDefault: Boolean(document.querySelector('[data-workflow-policy="allowReadOnlyByDefault"]')?.checked),
    };
    await saveWorkflowPreferences?.(payload);
    notifyTerminal?.("[info] 服务端工具权限偏好已保存。\n");
  }

  async function addToolPermissionRuleFromPanel(event) {
    event.preventDefault();
    const payload = {
      mode: $("toolPermissionMode")?.value || "*",
      toolName: $("toolPermissionToolName")?.value || "*",
      risk: $("toolPermissionRisk")?.value || "exec",
      decision: $("toolPermissionDecision")?.value || "ask",
      priority: Number($("toolPermissionPriority")?.value || 0),
      enabled: true,
      description: $("toolPermissionDescription")?.value || "",
    };
    await createToolPermissionRule?.(payload);
    notifyTerminal?.(`[info] 已添加服务端工具权限规则：${payload.toolName} ${payload.risk} ${payload.decision}\n`);
  }

  async function toggleToolPermissionRule(id) {
    const rule = (state.toolPermissionRules || []).find((item) => item.id === id);
    if (!rule) return;
    await updateToolPermissionRule?.(id, { enabled: !rule.enabled });
  }

  async function deleteToolPermissionRuleFromPanel(id) {
    if (!id) return;
    const ok = window.confirm("删除这条服务端工具权限规则？");
    if (!ok) return;
    await deleteToolPermissionRule?.(id);
  }

  function rerenderSkillPanel() {
    const body = $("settingsContentBody");
    if (!body || state.activeSettingsPanel !== "skills") return;
    body.innerHTML = renderSkillSettingsContent(state.activeSkillTab || "commands");
    bindSkillTabs(state.activeSkillTab || "commands");
  }

  async function openSkillRevisionDrawer(skillId) {
    if (!skillsPhaseB) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    bucket.drawer = { skillId, selectedRevision: null, revisionDetail: null, revisionDetailError: "" };
    rerenderSkillPanel();
    await skillsPhaseB.loadRevisions(skillId, context);
  }

  async function openSkillRevisionDetail(skillId, revisionId) {
    if (!skillsPhaseB) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    if (!bucket.drawer || bucket.drawer.skillId !== skillId) return;
    try {
      bucket.drawer.revisionDetail = await skillsPhaseB.loadRevisionDetail(skillId, revisionId, context);
      bucket.drawer.selectedRevision = revisionId;
      bucket.drawer.revisionDetailError = "";
    } catch (error) {
      bucket.drawer.revisionDetail = null;
      bucket.drawer.revisionDetailError = error?.message || String(error);
      throw error;
    } finally {
      rerenderSkillPanel();
    }
  }

  async function restoreSkillRevisionFromDrawer(skillId, revisionNo) {
    if (!skillsPhaseB || !window.confirm("恢复此修订版本？当前版本会由服务端创建新的修订记录。")) return;
    const context = getSkillContext?.() || { scope: "global" };
    const bucket = skillsPhaseB.ensureContext(context);
    const revisions = bucket.revisions?.[skillId]?.items || [];
    const revision = revisions.find((item) => String(item.revisionNo ?? item.revision) === String(revisionNo));
    if (!revision) throw new Error("技能修订版本不存在");
    const current = bucket.items.find((item) => item.id === skillId);
    await skillsPhaseB.restoreRevision(skillId, revision, context, {
      expectedUpdatedAt: current?.updatedAt,
      acknowledgeRisk: String(revision.scanVerdict || "").toLowerCase() === "review",
    });
    await skillsPhaseB.loadRevisions(skillId, context);
    rerenderSkillPanel();
  }

  function closeSkillRevisionDrawer() {
    if (!skillsPhaseB) return;
    const bucket = skillsPhaseB.ensureContext(getSkillContext?.() || { scope: "global" });
    bucket.drawer = null;
    rerenderSkillPanel();
  }

  async function previewSelectedSkillFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    if (file.size > 128 * 1024) throw new Error("SKILL.md 超过 128 KiB 上限");
    pendingSkillImportContent = await file.text();
    pendingSkillImportPreview = await previewServerSkillImport?.(pendingSkillImportContent);
    if (!pendingSkillImportPreview) throw new Error("SKILL.md 预览失败");
    rerenderSkillPanel();
  }

  async function confirmSkillImport() {
    if (!pendingSkillImportContent || !pendingSkillImportPreview) throw new Error("请先选择并预览 SKILL.md");
    const verdict = pendingSkillImportPreview.scanVerdict || "safe";
    const confirmed = window.confirm(`确认导入 ${pendingSkillImportPreview.command || "该技能"}？\n\n扫描结论：${verdict}。导入后保持停用状态，不会执行任何命令或读取文件。`);
    if (!confirmed) return;
    await importServerSkill?.(pendingSkillImportContent);
    notifyTerminal?.(`[info] 已导入 SKILL.md：${pendingSkillImportPreview.command || "skill"}（停用）\n`);
    pendingSkillImportContent = "";
    pendingSkillImportPreview = null;
    rerenderSkillPanel();
  }

  async function addSkillCommandFromPanel(event) {
    event.preventDefault();
    const payload = {
      name: $("skillCommandName")?.value || "",
      command: $("skillCommandName")?.value || "",
      description: $("skillCommandDescription")?.value || "",
      prompt: $("skillCommandPrompt")?.value || "",
      enabled: false,
      source: "manual",
    };
    if (!String(payload.command).trim() || !String(payload.prompt).trim()) throw new Error("请填写命令名和提示词模板");
    const created = await createServerSkill?.(payload);
    notifyTerminal?.(`[info] 已保存服务端技能：${created?.command || payload.command}（停用）\n`);
  }

  async function toggleServerSkill(id) {
    const skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill) return;
    if (skill.enabled) {
      await updateServerSkill?.(id, { enabled: false });
      return;
    }
    if (skill.scanVerdict === "blocked") {
      throw new Error("该技能已被服务端阻断，不能启用");
    }
    let acknowledgeRisk = false;
    if (skill.scanVerdict === "review") {
      acknowledgeRisk = window.confirm("此技能扫描结论为 review，可能包含网络、危险命令、隐藏字符或绕过审批描述。确认已阅读 findings 并仍要启用？");
      if (!acknowledgeRisk) return;
    }
    await updateServerSkill?.(id, { enabled: true, acknowledgeRisk });
  }

  async function deleteServerSkillFromPanel(id) {
    const skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill || !window.confirm(`删除服务端技能 ${skill.command}？`)) return;
    await deleteServerSkill?.(id);
  }

  async function copyServerSkillPrompt(id) {
    let skill = (state.serverSkills || []).find((item) => item.id === id);
    if (!skill) throw new Error("服务端技能不存在");
    if (!skill.detailLoaded || !String(skill.prompt || "").trim()) skill = await loadServerSkillDetail?.(id);
    if (!String(skill?.prompt || "").trim()) throw new Error("服务端技能详情不可用，不能复制提示词");
    await copyText(skill.prompt);
  }

  async function migrateLocalSkillTemplates() {
    if (state.serverSkillsStatus !== "ready" && state.serverSkillsStatus !== "stale") await loadServerSkills?.();
    const localCommands = currentSkillsPreferences().commands || [];
    const seen = new Set((state.serverSkills || [])
      .map((item) => normalizeSlashCommandName(item?.command))
      .filter(Boolean));
    let created = 0;
    let skipped = 0;
    let conflict = 0;
    for (const template of localCommands) {
      const name = String(template?.name || "").trim();
      const normalizedCommand = normalizeSlashCommandName(name);
      const prompt = String(template?.prompt || "").trim();
      if (!name || !normalizedCommand || !prompt) {
        skipped += 1;
        continue;
      }
      if (seen.has(normalizedCommand)) {
        skipped += 1;
        continue;
      }
      try {
        const saved = await createServerSkill?.({
          name,
          command: normalizedCommand,
          description: String(template.description || ""),
          prompt,
          source: "local_migration",
          enabled: false,
        }, { silent: true });
        seen.add(normalizeSlashCommandName(saved?.command || normalizedCommand));
        created += 1;
      } catch (err) {
        if (String(err?.message || err).toLowerCase().includes("exists")) conflict += 1;
        else conflict += 1;
      }
    }
    localMigrationSummary = `本地模板迁移完成：创建 ${created}，跳过 ${skipped}，冲突 ${conflict}。本地数据未删除；请手工确认服务端技能后再决定是否清理浏览器数据。`;
    notifyTerminal?.(`[info] ${localMigrationSummary}\n`);
    rerenderSkillPanel();
  }

  async function addMCPServerFromPanel(event) {
    event.preventDefault();
    const server = normalizeMCPServer({
      id: localSkillID("mcp"),
      name: $("mcpServerName")?.value || "",
      transport: $("mcpServerTransport")?.value || "stdio",
      command: $("mcpServerCommand")?.value || "",
      enabled: false,
    });
    if (!server.name || !server.command) throw new Error("请填写 MCP 名称和启动命令 / URL");
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, mcpServers: [server, ...prefs.mcpServers] }, { notify: true });
    notifyTerminal(`[info] 已添加 MCP server 草案：${server.name}\n`);
  }

  function toggleMCPServer(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({
      ...prefs,
      mcpServers: prefs.mcpServers.map((server) => server.id === id ? { ...server, enabled: !server.enabled } : server),
    }, { notify: true });
  }

  function deleteMCPServer(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, mcpServers: prefs.mcpServers.filter((server) => server.id !== id) }, { notify: true });
  }

  function setSkillPolicy(field, value) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({
      ...prefs,
      toolPolicy: { ...prefs.toolPolicy, [field]: Boolean(value) },
    }, { notify: true });
  }

  return {
    bindSkillTabs,
    renderSkillSettingsContent,
  };
}

export function skillContextLabel(context = {}) {
  const scope = String(context.scope || "global").toLowerCase();
  if (scope === "project") return `项目作用域${context.projectId ? ` · ${context.projectId}` : ""}`;
  if (scope === "workspace") return `工作线作用域${context.worklineId ? ` · ${context.worklineId}` : ""}`;
  return "全局作用域";
}

export function skillScopeShadowHint(skill, activeContext = {}) {
  const ownerScope = String(skill?.scope || skill?.ownerScope || "global").toLowerCase();
  const activeScope = String(activeContext?.scope || "global").toLowerCase();
  if (skill?.shadowedBy || skill?.shadowed) return "已被更具体作用域的服务端 Skill 覆盖";
  if (ownerScope !== activeScope) return `由${skillContextLabel({ scope: ownerScope, projectId: skill?.projectId, worklineId: skill?.worklineId })} owner 生效`;
  return "当前作用域 owner";
}

export function renderSkillScopeBadge(skill) {
  const scope = String(skill?.scope || skill?.ownerScope || "global").toLowerCase();
  const label = scope === "project" ? "项目" : scope === "workspace" ? "工作线" : "全局";
  return `<span class="skill-scope-badge skill-scope-${escapeAttr(scope)}">${escapeHtml(label)}</span>`;
}

function renderSkillScopeOptions(selected) {
  return ["global", "project", "workspace"].map((scope) => `<option value="${scope}" ${scope === selected ? "selected" : ""}>${escapeHtml(skillContextLabel({ scope }))}</option>`).join("");
}

function renderPhaseBSkillCard(skill, context) {
  const verdict = String(skill.scanVerdict || "safe").toLowerCase();
  const tone = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "muted";
  const detailLoaded = Boolean(skill.detailLoaded && String(skill.prompt || "").trim());
  return `
    <div class="skill-command-card skills-v2-card ${skill.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(skill.command || skill.name || "未命名命令")} ${renderSkillScopeBadge(skill)} <span class="settings-status-pill ${tone}">${escapeHtml(verdict)}</span></div>
        <div class="settings-provider-meta">${escapeHtml(skill.description || "无描述")} · ${escapeHtml(skillScopeShadowHint(skill, context))}</div>
        ${detailLoaded ? `<pre class="skill-command-prompt">${escapeHtml(skill.prompt)}</pre>` : skill.detailError ? `<div class="settings-inline-alert">详情加载失败，已阻断本地回退：${escapeHtml(skill.detailError)}</div>` : ""}
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-skill-v2-detail="${escapeAttr(skill.id)}">${detailLoaded ? "刷新详情" : "加载详情"}</button>
        <button class="settings-action-btn subtle" type="button" data-skill-v2-revisions="${escapeAttr(skill.id)}">修订记录</button>
      </div>
    </div>
  `;
}

export function renderSkillRevisionDrawer({ drawer, revisions = {}, context = {} } = {}) {
  const items = Array.isArray(revisions.items) ? revisions.items : [];
  const selected = drawer?.revisionDetail;
  return `
    <aside class="skill-revision-drawer" aria-label="Skills 修订记录">
      <div class="skill-revision-drawer-head"><div><strong>修订记录</strong><small>${escapeHtml(skillContextLabel(context))}</small></div><button id="closeSkillRevisionDrawerBtn" class="settings-action-btn subtle" type="button">关闭</button></div>
      ${revisions.error ? `<div class="settings-inline-alert">${escapeHtml(revisions.error)}</div>` : ""}
      <div class="skill-revision-list">
        ${revisions.status === "loading" && !items.length ? `<div class="settings-empty-card compact">正在加载修订记录…</div>` : items.length ? items.map((revision) => {
          const revisionNo = String(revision.revisionNo ?? revision.revision ?? "");
          return `<div class="skill-revision-card ${String(drawer?.selectedRevision || "") === revisionNo ? "selected" : ""}"><div><strong>${escapeHtml(revision.label || `修订 ${revisionNo}`)}</strong><small>${escapeHtml(revision.createdAt || revision.updatedAt || "")}</small></div><div class="settings-action-row"><button class="settings-action-btn subtle" type="button" data-skill-v2-revision-detail="${escapeAttr(drawer?.skillId)}" data-skill-v2-revision-id="${escapeAttr(revisionNo)}">查看</button><button class="settings-action-btn danger" type="button" data-skill-v2-restore="${escapeAttr(drawer?.skillId)}" data-skill-v2-revision-id="${escapeAttr(revisionNo)}">恢复</button></div></div>`;
        }).join("") : `<div class="settings-empty-card compact">暂无修订记录。</div>`}
      </div>
      ${selected ? `<pre class="skill-command-prompt skill-revision-detail">${escapeHtml(selected.prompt || selected.content || JSON.stringify(selected, null, 2))}</pre>` : drawer?.revisionDetailError ? `<div class="settings-inline-alert">${escapeHtml(drawer.revisionDetailError)}</div>` : ""}
    </aside>
  `;
}
