import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { skillTabs } from "./settings-data.mjs";

export function createSkillsWorkbenchController({
  state,
  bindMCPRegistryActions,
  copyText,
  currentSkillsPreferences,
  isMCPRegistryActionBusy,
  localSkillID,
  normalizeMCPServer,
  normalizeSkillCommand,
  notifyTerminal,
  renderMCPRegistryList,
  resetSkillsPreferences,
  saveSkillsPreferences,
  showError,
  skillsPrefsExport,
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

  function renderLocalCommandSkills(active) {
    const prefs = currentSkillsPreferences();
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-workbench-actions">
      <button id="copySkillsConfigBtn" class="settings-action-btn subtle" type="button">复制技能 JSON</button>
      <button id="resetSkillsConfigBtn" class="settings-action-btn subtle" type="button">恢复默认</button>
    </div>
    <div class="skill-command-list">
      ${prefs.commands.length ? prefs.commands.map(renderSkillCommandCard).join("") : `<div class="settings-empty-card compact">暂无本地命令模板。</div>`}
    </div>
    <section class="settings-provider-section">
      <div class="settings-provider-title">新增命令模板</div>
      <form id="skillCommandForm" class="skill-command-form">
        <div class="settings-provider-form-grid">
          <label>命令名<input id="skillCommandName" class="settings-field" placeholder="/explain-error" /></label>
          <label>描述<input id="skillCommandDescription" class="settings-field" placeholder="解释错误并给出修复路径" /></label>
          <label class="settings-form-span-2">提示词模板<textarea id="skillCommandPrompt" class="settings-field settings-textarea" rows="5" placeholder="请解释以下错误，指出根因并给出最小修复步骤..."></textarea></label>
        </div>
        <div class="settings-action-row settings-form-actions"><button class="settings-action-btn primary" type="submit">添加命令</button></div>
      </form>
    </section>
  `;
  }

  function renderSkillCommandCard(command) {
    return `
    <div class="skill-command-card ${command.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(command.name)} <span class="settings-status-pill ${command.enabled ? "ok" : "muted"}">${command.enabled ? "启用" : "停用"}</span></div>
        <div class="settings-provider-meta">${escapeHtml(command.description || "无描述")}</div>
        <pre class="skill-command-prompt">${escapeHtml(command.prompt)}</pre>
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-skill-copy-command="${escapeAttr(command.id)}">复制</button>
        <button class="settings-action-btn subtle" type="button" data-skill-toggle-command="${escapeAttr(command.id)}">${command.enabled ? "停用" : "启用"}</button>
        <button class="settings-action-btn danger" type="button" data-skill-delete-command="${escapeAttr(command.id)}">删除</button>
      </div>
    </div>
  `;
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
    const policy = currentSkillsPreferences().toolPolicy;
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="appearance-toggle-list">
      ${renderSkillPolicyToggle("requireConfirmationForExec", "执行命令前确认", "Bash/exec 类动作建议保持确认。", policy.requireConfirmationForExec)}
      ${renderSkillPolicyToggle("requireConfirmationForWrites", "写入文件前确认", "对 Write/Edit 等动作增加人工确认提醒。", policy.requireConfirmationForWrites)}
      ${renderSkillPolicyToggle("allowReadOnlyByDefault", "默认允许只读工具", "Read/Glob/Grep 等低风险工具默认可用。", policy.allowReadOnlyByDefault)}
      ${renderSkillPolicyToggle("preferPlanForLargeTasks", "大型任务优先计划", "多文件/架构变化先进入计划模式。", policy.preferPlanForLargeTasks)}
    </div>
  `;
  }

  function renderSkillPolicyToggle(field, title, description, checked) {
    return `
    <label class="appearance-toggle-row skill-policy-row">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" data-skill-policy="${escapeAttr(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
  }

  function renderSkillRoadmapPanel(active) {
    return `
    <p class="skills-description">${escapeHtml(active.description)}</p>
    <div class="skill-roadmap-grid">
      ${renderSkillRoadmapCard(active.label, active.empty)}
      ${renderSkillRoadmapCard("本地优先", "当前先保存浏览器本地草案；MCP 草案可保存到后端 registry。")}
      ${renderSkillRoadmapCard("后续接入", "继续完善 registry 编辑、hook runner、子代理模板和权限策略 API。")}
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
    $("copySkillsConfigBtn")?.addEventListener("click", () => copyText(skillsPrefsExport()));
    $("resetSkillsConfigBtn")?.addEventListener("click", resetSkillsPreferences);
    $("skillCommandForm")?.addEventListener("submit", (event) => addSkillCommandFromPanel(event).catch(showError));
    $("mcpServerForm")?.addEventListener("submit", (event) => addMCPServerFromPanel(event).catch(showError));
    body.querySelectorAll("[data-skill-copy-command]").forEach((node) => node.addEventListener("click", () => copySkillCommandPrompt(node.dataset.skillCopyCommand).catch(showError)));
    body.querySelectorAll("[data-skill-toggle-command]").forEach((node) => node.addEventListener("click", () => toggleSkillCommand(node.dataset.skillToggleCommand)));
    body.querySelectorAll("[data-skill-delete-command]").forEach((node) => node.addEventListener("click", () => deleteSkillCommand(node.dataset.skillDeleteCommand)));
    body.querySelectorAll("[data-mcp-toggle]").forEach((node) => node.addEventListener("click", () => toggleMCPServer(node.dataset.mcpToggle)));
    body.querySelectorAll("[data-mcp-delete]").forEach((node) => node.addEventListener("click", () => deleteMCPServer(node.dataset.mcpDelete)));
    body.querySelectorAll("[data-skill-policy]").forEach((node) => node.addEventListener("change", () => setSkillPolicy(node.dataset.skillPolicy, node.checked)));
  }

  async function addSkillCommandFromPanel(event) {
    event.preventDefault();
    const command = normalizeSkillCommand({
      id: localSkillID("cmd"),
      name: $("skillCommandName")?.value || "",
      description: $("skillCommandDescription")?.value || "",
      prompt: $("skillCommandPrompt")?.value || "",
      enabled: true,
    });
    if (!command.name || !command.prompt) throw new Error("请填写命令名和提示词模板");
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, commands: [command, ...prefs.commands] }, { notify: true });
    notifyTerminal(`[info] 已添加本地命令模板：${command.name}\n`);
  }

  function toggleSkillCommand(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({
      ...prefs,
      commands: prefs.commands.map((command) => command.id === id ? { ...command, enabled: !command.enabled } : command),
    }, { notify: true });
  }

  function deleteSkillCommand(id) {
    const prefs = currentSkillsPreferences();
    saveSkillsPreferences({ ...prefs, commands: prefs.commands.filter((command) => command.id !== id) }, { notify: true });
  }

  async function copySkillCommandPrompt(id) {
    const command = currentSkillsPreferences().commands.find((item) => item.id === id);
    if (!command) throw new Error("命令模板不存在");
    await copyText(command.prompt);
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
