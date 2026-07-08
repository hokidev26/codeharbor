import { $, escapeAttr, escapeHtml } from "./dom.mjs";
import { buildMCPRegistryPayload, parseMCPCommandLine } from "./mcp-registry.mjs";
import { api } from "./runtime.mjs";

export function createMCPRegistryUIController({
  state,
  copyText,
  currentSkillsPreferences,
  refreshActiveSettingsPanel,
  showError,
  showToast,
} = {}) {
  function shouldRefreshMCPRegistryPanel() {
    return state.activeSettingsPanel === "skills" && state.activeSkillTab === "mcp-tools";
  }

  async function loadMCPRegistryServers({ force = false } = {}) {
    if (!force && state.mcpRegistryLoaded) return;
    const seq = ++state.mcpRegistrySeq;
    state.mcpRegistryLoading = true;
    state.mcpRegistryError = "";
    if (shouldRefreshMCPRegistryPanel()) refreshActiveSettingsPanel?.();
    try {
      const servers = await api("/api/mcp/servers");
      if (seq !== state.mcpRegistrySeq) return;
      state.mcpRegistryServers = Array.isArray(servers) ? servers : [];
      state.mcpRegistryLoaded = true;
    } catch (err) {
      if (seq !== state.mcpRegistrySeq) return;
      state.mcpRegistryError = err.message || String(err);
    } finally {
      if (seq === state.mcpRegistrySeq) {
        state.mcpRegistryLoading = false;
        if (shouldRefreshMCPRegistryPanel()) refreshActiveSettingsPanel?.();
      }
    }
  }

  function mcpRegistryActionKey(id, action) {
    return `${action}:${id}`;
  }

  function isMCPRegistryActionBusy(id, action) {
    return Boolean(state.mcpRegistryActionBusy?.[mcpRegistryActionKey(id, action)]);
  }

  function setMCPRegistryActionBusy(id, action, busy) {
    const key = mcpRegistryActionKey(id, action);
    if (busy) state.mcpRegistryActionBusy = { ...(state.mcpRegistryActionBusy || {}), [key]: true };
    else {
      const next = { ...(state.mcpRegistryActionBusy || {}) };
      delete next[key];
      state.mcpRegistryActionBusy = next;
    }
    if (shouldRefreshMCPRegistryPanel()) refreshActiveSettingsPanel?.();
  }

  async function discoverMCPRegistryTools(id) {
    if (!id) return;
    setMCPRegistryActionBusy(id, "tools", true);
    try {
      const result = await api(`/api/mcp/servers/${id}/tools`);
      state.mcpRegistryTools = { ...(state.mcpRegistryTools || {}), [id]: result };
      if (shouldRefreshMCPRegistryPanel()) refreshActiveSettingsPanel?.();
      showToast?.(`已发现 ${result.count || 0} 个 MCP 工具。`, "success");
    } finally {
      setMCPRegistryActionBusy(id, "tools", false);
    }
  }

  async function createMCPRegistryServerFromPanel(event) {
    event.preventDefault();
    const payload = readMCPRegistryFormPayload();
    setMCPRegistryActionBusy("new", "create", true);
    try {
      await api("/api/mcp/servers", { method: "POST", body: JSON.stringify(payload) });
      clearMCPRegistryForm();
      state.mcpRegistryLoaded = false;
      await loadMCPRegistryServers({ force: true });
      showToast?.("已创建后端 MCP server。", "success");
    } finally {
      setMCPRegistryActionBusy("new", "create", false);
    }
  }

  function readMCPRegistryFormPayload() {
    return buildMCPRegistryPayload({
      name: $("mcpRegistryName")?.value || "",
      command: $("mcpRegistryCommand")?.value || "",
      argsText: $("mcpRegistryArgs")?.value || "",
      cwd: $("mcpRegistryCWD")?.value || "",
      envText: $("mcpRegistryEnv")?.value || "",
      enabled: String($("mcpRegistryEnabled")?.value || "true") !== "false",
    });
  }

  function clearMCPRegistryForm() {
    ["mcpRegistryName", "mcpRegistryCommand", "mcpRegistryArgs", "mcpRegistryCWD", "mcpRegistryEnv"].forEach((id) => {
      const node = $(id);
      if (node) node.value = "";
    });
    const enabled = $("mcpRegistryEnabled");
    if (enabled) enabled.value = "true";
  }

  async function toggleMCPRegistryServer(id) {
    const server = state.mcpRegistryServers.find((item) => item.id === id);
    if (!server) throw new Error("MCP server 不存在");
    setMCPRegistryActionBusy(id, "toggle", true);
    try {
      await api(`/api/mcp/servers/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: !server.enabled }) });
      await loadMCPRegistryServers({ force: true });
    } finally {
      setMCPRegistryActionBusy(id, "toggle", false);
    }
  }

  async function deleteMCPRegistryServer(id) {
    const server = state.mcpRegistryServers.find((item) => item.id === id);
    if (!server) throw new Error("MCP server 不存在");
    if (!window.confirm(`删除 MCP server ${server.name || id}？`)) return;
    setMCPRegistryActionBusy(id, "delete", true);
    try {
      await api(`/api/mcp/servers/${id}`, { method: "DELETE" });
      const nextTools = { ...(state.mcpRegistryTools || {}) };
      delete nextTools[id];
      state.mcpRegistryTools = nextTools;
      await loadMCPRegistryServers({ force: true });
      showToast?.("已删除后端 MCP server。", "success");
    } finally {
      setMCPRegistryActionBusy(id, "delete", false);
    }
  }

  async function registerMCPDraftServer(id) {
    const draft = currentSkillsPreferences().mcpServers.find((server) => server.id === id);
    if (!draft) throw new Error("MCP 草案不存在");
    const parsed = parseMCPCommandLine(draft.command);
    if (!parsed.command) throw new Error("MCP 草案缺少启动命令");
    setMCPRegistryActionBusy(id, "register", true);
    try {
      await api("/api/mcp/servers", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name || parsed.command,
          transport: "stdio",
          command: parsed.command,
          args: parsed.args,
          enabled: Boolean(draft.enabled),
        }),
      });
      state.mcpRegistryLoaded = false;
      await loadMCPRegistryServers({ force: true });
      showToast?.("已保存到后端 MCP registry。", "success");
    } finally {
      setMCPRegistryActionBusy(id, "register", false);
    }
  }

  function renderMCPRegistryList() {
    if (state.mcpRegistryLoading && !state.mcpRegistryLoaded) return `<div class="settings-empty-card compact">正在加载后端 MCP registry...</div>`;
    if (state.mcpRegistryError) return `<div class="settings-empty-card compact danger">MCP registry 加载失败：${escapeHtml(state.mcpRegistryError)}</div>`;
    if (!state.mcpRegistryServers.length) return `<div class="settings-empty-card compact">后端 registry 暂无 MCP server。可先添加浏览器本地草案，再保存到 registry。</div>`;
    return `<div class="skill-command-list">${state.mcpRegistryServers.map(renderMCPRegistryServerCard).join("")}</div>`;
  }

  function renderMCPRegistryServerCard(server) {
    const tools = state.mcpRegistryTools?.[server.id];
    const discovering = isMCPRegistryActionBusy(server.id, "tools");
    const toggling = isMCPRegistryActionBusy(server.id, "toggle");
    const deleting = isMCPRegistryActionBusy(server.id, "delete");
    const status = server.enabled ? "enabled" : "disabled";
    const args = Array.isArray(server.args) && server.args.length ? ` ${server.args.join(" ")}` : "";
    const envText = Array.isArray(server.envKeys) && server.envKeys.length ? `env: ${server.envKeys.join(", ")}` : "env: none";
    return `
    <div class="skill-command-card ${server.enabled ? "" : "disabled"}">
      <div>
        <div class="skill-command-title">${escapeHtml(server.name || "MCP Server")} <span class="settings-status-pill ${server.enabled ? "ok" : "muted"}">${escapeHtml(status)}</span></div>
        <div class="settings-provider-meta">serverId: <code>${escapeHtml(server.id)}</code></div>
        <div class="settings-provider-meta">${escapeHtml(server.transport || "stdio")} · ${escapeHtml((server.command || "") + args)}</div>
        <div class="settings-provider-meta">${escapeHtml(envText)}${server.cwd ? ` · cwd: ${escapeHtml(server.cwd)}` : ""}</div>
        ${tools ? renderMCPRegistryToolsResult(tools) : ""}
      </div>
      <div class="settings-action-row">
        <button class="settings-action-btn subtle" type="button" data-mcp-registry-tools="${escapeAttr(server.id)}" ${discovering || !server.enabled ? "disabled" : ""}>${discovering ? "发现中" : "发现工具"}</button>
        <button class="settings-action-btn subtle" type="button" data-mcp-registry-toggle="${escapeAttr(server.id)}" ${toggling || deleting ? "disabled" : ""}>${toggling ? "切换中" : (server.enabled ? "停用" : "启用")}</button>
        <button class="settings-action-btn subtle" type="button" data-mcp-registry-copy="${escapeAttr(server.id)}">复制 serverId</button>
        <button class="settings-action-btn danger" type="button" data-mcp-registry-delete="${escapeAttr(server.id)}" ${deleting ? "disabled" : ""}>${deleting ? "删除中" : "删除"}</button>
      </div>
    </div>
  `;
  }

  function renderMCPRegistryToolsResult(result) {
    const tools = Array.isArray(result.tools) ? result.tools : [];
    if (!tools.length) return `<div class="settings-provider-meta">tools/list：没有返回工具。</div>`;
    return `
    <div class="settings-empty-card compact">
      <strong>tools/list · ${tools.length}</strong>
      <div class="settings-provider-meta">${tools.map((tool) => escapeHtml(tool.name || "unnamed")).join(" · ")}</div>
    </div>
  `;
  }

  function bindMCPRegistryActions(body = $("settingsContentBody")) {
    if (state.activeSkillTab === "mcp-tools" && !state.mcpRegistryLoaded && !state.mcpRegistryLoading) loadMCPRegistryServers().catch(showError);
    $("mcpRegistryForm")?.addEventListener("submit", (event) => createMCPRegistryServerFromPanel(event).catch(showError));
    $("refreshMCPRegistryBtn")?.addEventListener("click", () => loadMCPRegistryServers({ force: true }).catch(showError));
    body?.querySelectorAll("[data-mcp-register]").forEach((node) => node.addEventListener("click", () => registerMCPDraftServer(node.dataset.mcpRegister).catch(showError)));
    body?.querySelectorAll("[data-mcp-registry-tools]").forEach((node) => node.addEventListener("click", () => discoverMCPRegistryTools(node.dataset.mcpRegistryTools).catch(showError)));
    body?.querySelectorAll("[data-mcp-registry-toggle]").forEach((node) => node.addEventListener("click", () => toggleMCPRegistryServer(node.dataset.mcpRegistryToggle).catch(showError)));
    body?.querySelectorAll("[data-mcp-registry-copy]").forEach((node) => node.addEventListener("click", () => copyText(node.dataset.mcpRegistryCopy)));
    body?.querySelectorAll("[data-mcp-registry-delete]").forEach((node) => node.addEventListener("click", () => deleteMCPRegistryServer(node.dataset.mcpRegistryDelete).catch(showError)));
  }

  return {
    bindMCPRegistryActions,
    isMCPRegistryActionBusy,
    loadMCPRegistryServers,
    renderMCPRegistryList,
  };
}
