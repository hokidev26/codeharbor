import {
  automationLimits,
  buildSchedulePayload,
  normalizeSchedule,
  normalizeScheduleRun,
  schedulePresets,
} from "./automation-control.mjs";
import { escapeAttr, escapeHtml } from "./dom.mjs";
import { formatDuration, formatTimestamp as formatRegionalTimestamp } from "./formatters.mjs";
import { currentUILocale } from "./i18n.mjs";
import { t } from "./messages-automation.mjs";

const CONVERSATION_LIMIT = 200;
const MODES = new Set(["view", "create"]);
const WORKSPACE_TEXT = Object.freeze({
  "zh-CN": {
    title: "排程工作区", search: "搜索排程", searchPlaceholder: "名称、任务、表达式或关联对话", newSchedule: "新建排程",
    noResults: "没有匹配的排程。", selectSchedule: "请选择一个排程。", linkedConversation: "关联对话", missingConversation: "未找到关联对话",
    openConversation: "打开关联对话", editSchedule: "编辑排程", createSchedule: "创建排程", save: "保存更改", saving: "保存中…", saved: "排程已更新。", cancel: "取消",
    recentRuns: "最近运行历史", refreshHistory: "刷新历史", loadFailed: "排程加载失败", enabled: "已启用", disabled: "已停用", lastRun: "上次运行", lastOutcome: "上次结果", notAvailable: "—",
  },
  "zh-TW": {
    title: "排程工作區", search: "搜尋排程", searchPlaceholder: "名稱、任務、表達式或關聯對話", newSchedule: "新增排程",
    noResults: "沒有符合的排程。", selectSchedule: "請選擇一個排程。", linkedConversation: "關聯對話", missingConversation: "找不到關聯對話",
    openConversation: "開啟關聯對話", editSchedule: "編輯排程", createSchedule: "建立排程", save: "儲存變更", saving: "儲存中…", saved: "排程已更新。", cancel: "取消",
    recentRuns: "最近執行歷史", refreshHistory: "重新整理歷史", loadFailed: "排程載入失敗", enabled: "已啟用", disabled: "已停用", lastRun: "上次執行", lastOutcome: "上次結果", notAvailable: "—",
  },
  en: {
    title: "Schedule workspace", search: "Search schedules", searchPlaceholder: "Name, task, expression, or linked conversation", newSchedule: "New schedule",
    noResults: "No matching schedules.", selectSchedule: "Select a schedule.", linkedConversation: "Linked conversation", missingConversation: "Linked conversation unavailable",
    openConversation: "Open linked conversation", editSchedule: "Edit schedule", createSchedule: "Create schedule", save: "Save changes", saving: "Saving…", saved: "Schedule updated.", cancel: "Cancel",
    recentRuns: "Recent run history", refreshHistory: "Refresh history", loadFailed: "Failed to load schedules", enabled: "Enabled", disabled: "Disabled", lastRun: "Last run", lastOutcome: "Last result", notAvailable: "—",
  },
});

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeRead(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function boundedText(value, limit = 240) {
  try {
    return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, limit);
  } catch {
    return "";
  }
}

function text(name, params = {}) {
  const catalog = WORKSPACE_TEXT[currentUILocale()] || WORKSPACE_TEXT.en;
  return boundedText(catalog[name] || name, 1000).replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => boundedText(params[key], 300));
}

function normalizeOneSchedule(value) {
  try {
    return normalizeSchedule(value);
  } catch {
    return normalizeSchedule({});
  }
}

function listResult(value, keys, limit) {
  if (Array.isArray(value)) return value.slice(0, limit);
  const source = objectValue(value);
  for (const key of keys) {
    const candidate = safeRead(source, key);
    if (Array.isArray(candidate)) return candidate.slice(0, limit);
  }
  const data = safeRead(source, "data");
  return data && data !== value ? listResult(data, keys, limit) : [];
}

function safeTimestamp(value, options = {}) {
  const formatter = typeof options.formatTimestamp === "function" ? options.formatTimestamp : formatRegionalTimestamp;
  try {
    return boundedText(formatter(value, {
      emptyFallback: t("automation.timestamp.empty"),
      invalidFallback: t("automation.timestamp.invalid"),
    }), 240);
  } catch {
    return boundedText(value, 80) || t("automation.timestamp.empty");
  }
}

function conversationLabel(conversation) {
  if (!conversation) return "";
  return [conversation.title || conversation.agentId, conversation.projectName].filter(Boolean).join(" · ");
}

function conversationMap(value) {
  return new Map(normalizeScheduleConversations(value).map((item) => [item.agentId, item]));
}

function normalizedSchedules(value) {
  return listResult(value, ["schedules", "items"], automationLimits.schedules).map(normalizeOneSchedule);
}

function errorMessage(error) {
  return boundedText(error?.message || error || t("automation.validation.requestFailed"), 1200);
}

function scheduleFromResult(result, fallback = {}) {
  const source = objectValue(result);
  const candidate = safeRead(source, "schedule") ?? safeRead(source, "item") ?? safeRead(source, "data") ?? source;
  const normalized = normalizeOneSchedule({ ...objectValue(fallback), ...objectValue(candidate) });
  return normalized.id ? normalized : null;
}

function cloneHistory(history) {
  return Object.fromEntries(Object.entries(history).map(([id, entry]) => [id, {
    loaded: Boolean(entry.loaded),
    loading: Boolean(entry.loading),
    error: boundedText(entry.error, 1200),
    runs: (Array.isArray(entry.runs) ? entry.runs : []).slice(0, automationLimits.scheduleRuns).map((run) => ({ ...normalizeScheduleRun(run) })),
  }]));
}

export function normalizeScheduleConversations(value) {
  const input = Array.isArray(value) ? value : listResult(value, ["conversations", "items"], CONVERSATION_LIMIT);
  const result = [];
  const seen = new Set();
  for (let index = 0; index < input.length && result.length < CONVERSATION_LIMIT; index += 1) {
    const source = objectValue(input[index]);
    const agentId = boundedText(safeRead(source, "agentId") ?? safeRead(source, "id"), 160);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    result.push({
      agentId,
      title: boundedText(safeRead(source, "agentTitle") ?? safeRead(source, "title") ?? safeRead(source, "worklineTitle") ?? agentId, 240) || agentId,
      projectName: boundedText(safeRead(source, "projectName") ?? safeRead(source, "projectTitle"), 200),
      targetId: boundedText(safeRead(source, "targetId"), 600),
    });
  }
  return result;
}

export function filterScheduleWorkspaceItems(schedules, conversations, query) {
  const items = normalizedSchedules(schedules);
  const needle = boundedText(query, 300).toLocaleLowerCase();
  if (!needle) return items;
  const byAgent = conversationMap(conversations);
  return items.filter((schedule) => {
    const conversation = byAgent.get(schedule.agentId);
    return [
      schedule.name,
      schedule.prompt,
      schedule.expression,
      schedule.agentId,
      conversation?.title,
      conversation?.projectName,
    ].some((value) => boundedText(value, 8000).toLocaleLowerCase().includes(needle));
  });
}

export function renderScheduleNavigationHTML(state = {}, options = {}) {
  const source = objectValue(state);
  const conversations = normalizeScheduleConversations(options.conversations);
  const byAgent = new Map(conversations.map((item) => [item.agentId, item]));
  const schedules = filterScheduleWorkspaceItems(source.schedules, conversations, source.query);
  const selectedId = boundedText(source.selectedScheduleId, 160);
  const loading = Boolean(source.loading) && !Boolean(source.loaded);
  const error = boundedText(source.error || safeRead(source.errors, "load"), 1200);
  let content = "";
  if (loading) {
    content = `<div class="schedule-workspace-state settings-empty-state settings-skeleton" aria-busy="true">${escapeHtml(t("automation.section.loading"))}</div>`;
  } else if (error && !normalizedSchedules(source.schedules).length) {
    content = `<div class="schedule-workspace-state settings-alert" role="alert"><strong>${escapeHtml(text("loadFailed"))}</strong><span>${escapeHtml(error)}</span></div>`;
  } else if (!schedules.length) {
    content = `<div class="schedule-workspace-state settings-empty-state">${escapeHtml(source.query ? text("noResults") : t("automation.schedule.empty"))}</div>`;
  } else {
    content = schedules.map((schedule) => {
      const linked = byAgent.get(schedule.agentId);
      const active = schedule.id && schedule.id === selectedId;
      const status = schedule.enabled ? text("enabled") : text("disabled");
      return `<button class="schedule-navigation-item settings-data-list-row${active ? " active" : ""}${schedule.enabled ? " enabled" : " disabled"}" type="button" data-schedule-navigation="${escapeAttr(schedule.id)}" aria-pressed="${active ? "true" : "false"}">
        <span class="schedule-navigation-heading"><strong>${escapeHtml(schedule.name || t("automation.defaults.unnamedSchedule"))}</strong><em>${escapeHtml(status)}</em></span>
        <small>${escapeHtml(t("automation.schedule.nextRun"))}: ${escapeHtml(safeTimestamp(schedule.nextRunAt, options))}</small>
        <small>${escapeHtml(text("linkedConversation"))}: ${escapeHtml(conversationLabel(linked) || schedule.agentId || text("missingConversation"))}</small>
      </button>`;
    }).join("");
  }
  return `<div class="schedule-workspace-navigation" aria-label="${escapeAttr(text("title"))}">
    <span class="sr-only">${escapeHtml(text("title"))}</span>
    ${error && normalizedSchedules(source.schedules).length ? `<div class="settings-alert" role="alert">${escapeHtml(error)}</div>` : ""}
    <div class="schedule-navigation-list settings-data-list">${content}</div>
  </div>`;
}

function selectOptions(values, selected) {
  return values.map((value) => `<option value="${escapeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function conversationOptions(conversations, selectedAgentId) {
  const items = normalizeScheduleConversations(conversations);
  if (selectedAgentId && !items.some((item) => item.agentId === selectedAgentId)) {
    items.unshift({ agentId: selectedAgentId, title: selectedAgentId, projectName: "", targetId: "" });
  }
  return items.map((item) => `<option value="${escapeAttr(item.agentId)}"${item.agentId === selectedAgentId ? " selected" : ""}>${escapeHtml(conversationLabel(item) || item.agentId)}</option>`).join("");
}

function renderScheduleForm(schedule, conversations, { create = false, busy = false } = {}) {
  const item = normalizeOneSchedule(schedule);
  const title = create ? text("createSchedule") : text("editSchedule");
  const submitLabel = busy ? text("saving") : create ? t("automation.buttons.createSchedule") : text("save");
  return `<form class="schedule-workspace-form automation-form settings-form-grid" data-schedule-form data-schedule-form-mode="${create ? "create" : "edit"}"${item.id ? ` data-schedule-id="${escapeAttr(item.id)}"` : ""}>
    <div class="settings-card-header span-2"><h3>${escapeHtml(title)}</h3></div>
    <label>${escapeHtml(t("automation.schedule.name"))}<input name="name" maxlength="120" value="${escapeAttr(item.name)}" placeholder="${escapeAttr(t("automation.schedule.namePlaceholder"))}" /></label>
    <label>${escapeHtml(text("linkedConversation"))}<select name="agentId" required>${conversationOptions(conversations, item.agentId)}</select></label>
    <label>${escapeHtml(t("automation.schedule.preset"))}<select name="preset" data-schedule-preset><option value="">${escapeHtml(t("automation.schedule.custom"))}</option>${selectOptions(schedulePresets, schedulePresets.includes(item.expression) ? item.expression : "")}</select></label>
    <label>${escapeHtml(t("automation.schedule.expression"))}<input name="expression" maxlength="256" value="${escapeAttr(item.expression)}" placeholder="${escapeAttr(t("automation.schedule.expressionPlaceholder"))}" required /></label>
    <label>${escapeHtml(t("automation.schedule.timezone"))}<input name="timezone" maxlength="128" value="${escapeAttr(item.timezone || "UTC")}" placeholder="${escapeAttr(t("automation.schedule.timezonePlaceholder"))}" required /></label>
    <label>${escapeHtml(t("automation.schedule.permission"))}<select name="permissionMode">${selectOptions(["readOnly", "acceptEdits"], item.permissionMode)}</select></label>
    <label>${escapeHtml(t("automation.schedule.environment"))}<select name="environmentMode">${selectOptions(["workline", "standalone"], item.environmentMode)}</select></label>
    <label>${escapeHtml(t("automation.schedule.narrator"))}<select name="narratorMode">${selectOptions(["reuse", "new"], item.narratorMode)}</select></label>
    <label class="span-2">${escapeHtml(t("automation.schedule.prompt"))}<textarea name="prompt" rows="6" maxlength="8000" placeholder="${escapeAttr(t("automation.schedule.promptPlaceholder"))}" required>${escapeHtml(item.prompt)}</textarea></label>
    <div class="automation-form-actions settings-inline-actions span-2"><button class="automation-btn primary" type="submit"${busy ? " disabled aria-busy=\"true\"" : ""}>${escapeHtml(submitLabel)}</button>${create ? `<button class="automation-btn subtle" type="button" data-schedule-cancel>${escapeHtml(text("cancel"))}</button>` : ""}</div>
  </form>`;
}

function renderHistory(scheduleId, history, options) {
  const entry = objectValue(history);
  if (entry.loading) return `<div class="settings-empty-state settings-skeleton" aria-busy="true">${escapeHtml(t("automation.section.loadingHistory"))}</div>`;
  if (entry.error) return `<div class="settings-alert" role="alert">${escapeHtml(entry.error)}</div>`;
  if (!entry.loaded) return `<div class="settings-empty-state">${escapeHtml(t("automation.section.selectHistory"))}</div>`;
  const runs = (Array.isArray(entry.runs) ? entry.runs : []).slice(0, automationLimits.scheduleRuns).map(normalizeScheduleRun);
  if (!runs.length) return `<div class="settings-empty-state">${escapeHtml(t("automation.section.noHistory"))}</div>`;
  return `<div class="schedule-run-list settings-data-list">${runs.map((run) => `<article class="schedule-run-item settings-data-list-row" data-schedule-run-id="${escapeAttr(run.id)}"><div><strong>${escapeHtml(run.status)}</strong><small>${escapeHtml(run.triggerType)}</small></div><span>${escapeHtml(safeTimestamp(run.createdAt, options))}</span><span>${escapeHtml(formatDuration(run.durationMs))}</span></article>`).join("")}</div>`;
}

export function renderScheduleWorkspace(state = {}, options = {}) {
  const source = objectValue(state);
  const schedules = normalizedSchedules(source.schedules);
  const conversations = normalizeScheduleConversations(options.conversations);
  const mode = MODES.has(source.mode) ? source.mode : "view";
  const selectedId = boundedText(source.selectedScheduleId, 160);
  const selected = schedules.find((item) => item.id === selectedId) || null;
  const loading = Boolean(source.loading) && !Boolean(source.loaded);
  const error = boundedText(source.error || safeRead(source.errors, "load"), 1200);
  const busy = objectValue(source.busy);
  let workspaceState = "detail";
  let content = "";
  if (loading) {
    workspaceState = "loading";
    content = `<div class="schedule-workspace-state settings-empty-state settings-skeleton" aria-busy="true">${escapeHtml(t("automation.section.loading"))}</div>`;
  } else if (error && !schedules.length && mode !== "create") {
    workspaceState = "error";
    content = `<div class="schedule-workspace-state settings-alert" role="alert"><strong>${escapeHtml(text("loadFailed"))}</strong><span>${escapeHtml(error)}</span></div>`;
  } else if (mode === "create") {
    workspaceState = "create";
    const defaultAgentId = boundedText(options.activeAgentId, 160) || conversations[0]?.agentId || "";
    content = renderScheduleForm({ agentId: defaultAgentId, timezone: "UTC", permissionMode: "readOnly", environmentMode: "workline", narratorMode: "reuse", enabled: true }, conversations, { create: true, busy: Boolean(busy.save) });
  } else if (!schedules.length) {
    workspaceState = "empty";
    content = `<div class="schedule-workspace-state settings-empty-state"><p>${escapeHtml(t("automation.schedule.empty"))}</p><button class="automation-btn primary" type="button" data-schedule-create>${escapeHtml(text("newSchedule"))}</button></div>`;
  } else if (!selected) {
    workspaceState = "empty";
    content = `<div class="schedule-workspace-state settings-empty-state">${escapeHtml(text("selectSchedule"))}</div>`;
  } else {
    const linked = conversations.find((item) => item.agentId === selected.agentId);
    const itemBusy = Boolean(busy[`schedule:${selected.id}`]);
    const history = safeRead(source.history, selected.id) || {};
    content = `<article class="schedule-workspace-detail">
      <header class="schedule-detail-header settings-card-header"><div><span>${escapeHtml(selected.enabled ? text("enabled") : text("disabled"))}</span><h2>${escapeHtml(selected.name || t("automation.defaults.unnamedSchedule"))}</h2><p>${escapeHtml(text("linkedConversation"))}: ${escapeHtml(conversationLabel(linked) || selected.agentId || text("missingConversation"))}</p></div>
        <div class="automation-actions settings-inline-actions"><button class="automation-btn subtle" type="button" data-schedule-toggle="${escapeAttr(selected.id)}" data-enabled="${selected.enabled ? "true" : "false"}"${itemBusy ? " disabled" : ""}>${escapeHtml(t(selected.enabled ? "automation.buttons.disable" : "automation.buttons.enable"))}</button><button class="automation-btn primary" type="button" data-schedule-run="${escapeAttr(selected.id)}"${itemBusy ? " disabled" : ""}>${escapeHtml(t("automation.buttons.runNow"))}</button><button class="automation-btn danger destructive" type="button" data-schedule-delete="${escapeAttr(selected.id)}"${itemBusy ? " disabled" : ""}>${escapeHtml(t("automation.buttons.delete"))}</button>${selected.agentId ? `<button class="automation-btn subtle" type="button" data-schedule-open-conversation="${escapeAttr(selected.agentId)}">${escapeHtml(text("openConversation"))}</button>` : ""}</div>
      </header>
      ${selected.lastError ? `<div class="settings-alert" role="alert">${escapeHtml(selected.lastError)}</div>` : ""}
      <dl class="automation-kv"><div><dt>${escapeHtml(t("automation.schedule.nextRun"))}</dt><dd>${escapeHtml(safeTimestamp(selected.nextRunAt, options))}</dd></div><div><dt>${escapeHtml(text("lastRun"))}</dt><dd>${escapeHtml(safeTimestamp(selected.lastRunAt, options))}</dd></div><div><dt>${escapeHtml(text("lastOutcome"))}</dt><dd>${escapeHtml(selected.lastOutcome || text("notAvailable"))}</dd></div><div><dt>${escapeHtml(t("automation.schedule.expression"))}</dt><dd>${escapeHtml(selected.expression)}</dd></div><div><dt>${escapeHtml(t("automation.schedule.timezone"))}</dt><dd>${escapeHtml(selected.timezone)}</dd></div><div><dt>${escapeHtml(t("automation.schedule.permission"))}</dt><dd>${escapeHtml(selected.permissionMode)}</dd></div></dl>
      ${renderScheduleForm(selected, conversations, { busy: Boolean(busy.save) })}
      <section class="schedule-history settings-card"><header class="settings-card-header"><h3>${escapeHtml(text("recentRuns"))}</h3><button class="automation-btn subtle" type="button" data-schedule-history="${escapeAttr(selected.id)}"${history.loading ? " disabled" : ""}>${escapeHtml(text("refreshHistory"))}</button></header>${renderHistory(selected.id, history, options)}</section>
    </article>`;
  }
  const saveError = boundedText(safeRead(source.errors, "save") || safeRead(source.errors, "action"), 1200);
  return `<section class="schedule-workspace settings-page-section" data-schedule-workspace="${escapeAttr(selectedId)}" data-schedule-workspace-state="${workspaceState}" aria-busy="${Boolean(source.loading) || Boolean(busy.save) ? "true" : "false"}">${saveError ? `<div class="settings-alert" role="alert">${escapeHtml(saveError)}</div>` : ""}${content}</section>`;
}

export function createScheduleWorkspaceController({
  request,
  onChange,
  showError,
  showToast,
  confirmAction,
  formatTimestamp,
  now = () => Date.now(),
} = {}) {
  if (typeof request !== "function") throw new TypeError("Schedule workspace request must be a function");
  const confirm = confirmAction || ((message) => typeof globalThis.confirm === "function" && globalThis.confirm(message));
  const state = {
    loaded: false,
    loading: false,
    error: "",
    schedules: [],
    selectedScheduleId: "",
    mode: "view",
    query: "",
    busy: {},
    errors: {},
    history: {},
    loadSeq: 0,
  };
  const historyRequests = new Map();
  const boundRoots = new WeakSet();

  function currentTime() {
    try {
      return typeof now === "function" ? now() : Date.now();
    } catch {
      return Date.now();
    }
  }

  function invalidateLoad() {
    state.loadSeq += 1;
    state.loading = false;
  }

  function getState() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      error: state.error,
      schedules: state.schedules.map((item) => ({ ...item })),
      selectedScheduleId: state.selectedScheduleId,
      mode: state.mode,
      query: state.query,
      busy: { ...state.busy },
      errors: { ...state.errors },
      history: cloneHistory(state.history),
      loadSeq: state.loadSeq,
      now: currentTime(),
    };
  }

  function emit() {
    try {
      onChange?.(getState());
    } catch {
      // Rendering callbacks are external; controller state remains authoritative.
    }
  }

  function report(section, error) {
    const message = errorMessage(error);
    state.errors[section] = message;
    if (section === "load") state.error = message;
    try {
      showError?.(error instanceof Error ? error : new Error(message));
    } catch {
      // Error reporters must not break workspace actions.
    }
  }

  function clearError(section) {
    delete state.errors[section];
    if (section === "load") state.error = "";
  }

  function toast(message) {
    try {
      showToast?.(message, "success", { force: true });
    } catch {
      // Toasts are optional presentation details.
    }
  }

  function selectAfterLoad(preferredId = "") {
    if (preferredId && state.schedules.some((item) => item.id === preferredId)) state.selectedScheduleId = preferredId;
    else if (!state.schedules.some((item) => item.id === state.selectedScheduleId)) state.selectedScheduleId = state.schedules[0]?.id || "";
  }

  async function load(options = {}) {
    const seq = ++state.loadSeq;
    state.loading = true;
    clearError("load");
    emit();
    try {
      const result = await request("/api/schedules");
      if (seq !== state.loadSeq) return false;
      state.schedules = normalizedSchedules(result);
      state.loaded = true;
      state.loading = false;
      selectAfterLoad(boundedText(options.preferredId, 160));
      emit();
      if (options.autoHistory !== false && state.mode === "view" && state.selectedScheduleId) void loadHistory(state.selectedScheduleId);
      return true;
    } catch (error) {
      if (seq !== state.loadSeq) return false;
      state.loading = false;
      state.loaded = true;
      report("load", error);
      emit();
      return false;
    }
  }

  async function select(id, options = {}) {
    const scheduleId = boundedText(id, 160);
    if (!state.schedules.some((item) => item.id === scheduleId)) return false;
    state.selectedScheduleId = scheduleId;
    state.mode = "view";
    emit();
    if (options.loadHistory === false) return true;
    const entry = state.history[scheduleId];
    if (entry?.loaded) return true;
    return loadHistory(scheduleId);
  }

  function startCreate() {
    state.mode = "create";
    state.selectedScheduleId = "";
    clearError("save");
    emit();
    return true;
  }

  function setQuery(query) {
    state.query = boundedText(query, 300);
    emit();
    return state.query;
  }

  function upsertSchedule(schedule) {
    state.schedules = [schedule, ...state.schedules.filter((item) => item.id !== schedule.id)].slice(0, automationLimits.schedules);
  }

  async function save(input = {}) {
    if (state.busy.save) return false;
    const editingId = state.mode === "create" ? "" : boundedText(input.id || state.selectedScheduleId, 160);
    const existing = state.schedules.find((item) => item.id === editingId);
    let payload;
    try {
      payload = buildSchedulePayload({ ...input, enabled: editingId ? existing?.enabled ?? true : input.enabled });
    } catch (error) {
      report("save", error);
      emit();
      return false;
    }
    invalidateLoad();
    state.busy.save = true;
    clearError("save");
    emit();
    try {
      const path = editingId ? `/api/schedules/${encodeURIComponent(editingId)}` : "/api/schedules";
      const result = await request(path, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      const returned = scheduleFromResult(result, { ...payload, id: editingId });
      if (returned) {
        upsertSchedule(returned);
        state.selectedScheduleId = returned.id;
      } else {
        await load({ autoHistory: false, preferredId: editingId });
        const match = state.schedules.find((item) => editingId ? item.id === editingId : item.name === payload.name && item.agentId === payload.agentId && item.expression === payload.expression);
        state.selectedScheduleId = match?.id || state.selectedScheduleId;
      }
      state.mode = "view";
      toast(editingId ? text("saved") : t("automation.toast.scheduleCreated"));
      if (state.selectedScheduleId) void loadHistory(state.selectedScheduleId, { force: true });
      return true;
    } catch (error) {
      report("save", error);
      return false;
    } finally {
      delete state.busy.save;
      emit();
    }
  }

  async function toggle(id, enabled) {
    const scheduleId = boundedText(id || state.selectedScheduleId, 160);
    const schedule = state.schedules.find((item) => item.id === scheduleId);
    if (!schedule || state.busy[`schedule:${scheduleId}`]) return false;
    const nextEnabled = enabled === undefined ? !schedule.enabled : Boolean(enabled);
    invalidateLoad();
    state.busy[`schedule:${scheduleId}`] = true;
    clearError("action");
    emit();
    try {
      const result = await request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: "PATCH", body: JSON.stringify({ enabled: nextEnabled }) });
      const returned = scheduleFromResult(result, { ...schedule, enabled: nextEnabled, status: nextEnabled ? "enabled" : "disabled" });
      upsertSchedule(returned || normalizeOneSchedule({ ...schedule, enabled: nextEnabled, status: nextEnabled ? "enabled" : "disabled" }));
      state.selectedScheduleId = scheduleId;
      toast(t(nextEnabled ? "automation.toast.scheduleEnabled" : "automation.toast.scheduleDisabled"));
      return true;
    } catch (error) {
      report("action", error);
      return false;
    } finally {
      delete state.busy[`schedule:${scheduleId}`];
      emit();
    }
  }

  async function run(id) {
    const scheduleId = boundedText(id || state.selectedScheduleId, 160);
    if (!scheduleId || state.busy[`schedule:${scheduleId}`]) return false;
    state.busy[`schedule:${scheduleId}`] = true;
    clearError("action");
    emit();
    try {
      await request(`/api/schedules/${encodeURIComponent(scheduleId)}/run`, { method: "POST" });
      toast(t("automation.toast.scheduleRunRequested"));
      void loadHistory(scheduleId, { force: true });
      return true;
    } catch (error) {
      report("action", error);
      return false;
    } finally {
      delete state.busy[`schedule:${scheduleId}`];
      emit();
    }
  }

  async function deleteSchedule(id) {
    const scheduleId = boundedText(id || state.selectedScheduleId, 160);
    if (!scheduleId || state.busy[`schedule:${scheduleId}`]) return false;
    if (!await confirm(t("automation.confirm.deleteSchedule"))) return false;
    invalidateLoad();
    state.busy[`schedule:${scheduleId}`] = true;
    clearError("action");
    emit();
    try {
      await request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" });
      state.schedules = state.schedules.filter((item) => item.id !== scheduleId);
      delete state.history[scheduleId];
      historyRequests.delete(scheduleId);
      state.selectedScheduleId = state.schedules[0]?.id || "";
      state.mode = "view";
      toast(t("automation.toast.scheduleDeleted"));
      if (state.selectedScheduleId) void loadHistory(state.selectedScheduleId);
      return true;
    } catch (error) {
      report("action", error);
      return false;
    } finally {
      delete state.busy[`schedule:${scheduleId}`];
      emit();
    }
  }

  function loadHistory(id, options = {}) {
    const scheduleId = boundedText(id || state.selectedScheduleId, 160);
    if (!scheduleId) return Promise.resolve(false);
    if (historyRequests.has(scheduleId)) return historyRequests.get(scheduleId);
    if (state.history[scheduleId]?.loaded && !options.force) return Promise.resolve(true);
    state.history[scheduleId] = { ...(state.history[scheduleId] || {}), loaded: false, loading: true, error: "", runs: state.history[scheduleId]?.runs || [] };
    emit();
    const current = (async () => {
      try {
        const result = await request(`/api/schedules/${encodeURIComponent(scheduleId)}/runs?limit=${automationLimits.scheduleRuns}`);
        state.history[scheduleId] = {
          loaded: true,
          loading: false,
          error: "",
          runs: listResult(result, ["runs", "items"], automationLimits.scheduleRuns).map(normalizeScheduleRun),
        };
        return true;
      } catch (error) {
        state.history[scheduleId] = { loaded: true, loading: false, error: errorMessage(error), runs: [] };
        try {
          showError?.(error);
        } catch {
          // Optional reporter.
        }
        return false;
      } finally {
        historyRequests.delete(scheduleId);
        emit();
      }
    })();
    historyRequests.set(scheduleId, current);
    return current;
  }

  function renderNavigation(options = {}) {
    return renderScheduleNavigationHTML(getState(), { ...options, formatTimestamp: options.formatTimestamp || formatTimestamp });
  }

  function render(options = {}) {
    return renderScheduleWorkspace(getState(), { ...options, formatTimestamp: options.formatTimestamp || formatTimestamp });
  }

  function fieldValue(form, name) {
    try {
      const control = form?.elements?.namedItem?.(name) || form?.querySelector?.(`[name="${name}"]`);
      return control?.value ?? "";
    } catch {
      return "";
    }
  }

  function bind(root, options = {}) {
    if (!root || typeof root.addEventListener !== "function" || boundRoots.has(root)) return false;
    root.addEventListener("click", (event) => {
      const trigger = event?.target?.closest?.("[data-schedule-navigation],[data-schedule-create],[data-schedule-cancel],[data-schedule-toggle],[data-schedule-run],[data-schedule-delete],[data-schedule-history],[data-schedule-open-conversation]");
      if (!trigger || (typeof root.contains === "function" && !root.contains(trigger))) return;
      event.preventDefault?.();
      if (trigger.hasAttribute?.("data-schedule-create") || trigger.dataset?.scheduleCreate !== undefined) startCreate();
      else if (trigger.hasAttribute?.("data-schedule-cancel") || trigger.dataset?.scheduleCancel !== undefined) {
        state.mode = "view";
        state.selectedScheduleId = state.schedules[0]?.id || "";
        emit();
      } else if (trigger.dataset?.scheduleNavigation !== undefined) void select(trigger.dataset.scheduleNavigation);
      else if (trigger.dataset?.scheduleToggle !== undefined) void toggle(trigger.dataset.scheduleToggle, trigger.dataset.enabled !== "true");
      else if (trigger.dataset?.scheduleRun !== undefined) void run(trigger.dataset.scheduleRun);
      else if (trigger.dataset?.scheduleDelete !== undefined) void deleteSchedule(trigger.dataset.scheduleDelete);
      else if (trigger.dataset?.scheduleHistory !== undefined) void loadHistory(trigger.dataset.scheduleHistory, { force: true });
      else if (trigger.dataset?.scheduleOpenConversation !== undefined) {
        try {
          options.onOpenConversation?.(boundedText(trigger.dataset.scheduleOpenConversation, 160));
        } catch (error) {
          try { showError?.(error); } catch { /* Optional reporter. */ }
        }
      }
    });
    root.addEventListener("input", (event) => {
      if (event?.target?.matches?.("[data-schedule-query]")) setQuery(event.target.value);
    });
    root.addEventListener("change", (event) => {
      if (!event?.target?.matches?.("[data-schedule-preset]") || !event.target.value) return;
      const form = event.target.closest?.("[data-schedule-form]");
      const expression = form?.elements?.namedItem?.("expression") || form?.querySelector?.('[name="expression"]');
      if (expression) expression.value = event.target.value;
    });
    root.addEventListener("submit", (event) => {
      const form = event?.target?.matches?.("[data-schedule-form]") ? event.target : event?.target?.closest?.("[data-schedule-form]");
      if (!form) return;
      event.preventDefault?.();
      void save({
        id: boundedText(form.dataset?.scheduleId, 160),
        name: fieldValue(form, "name"),
        agentId: fieldValue(form, "agentId"),
        expression: fieldValue(form, "expression"),
        timezone: fieldValue(form, "timezone"),
        permissionMode: fieldValue(form, "permissionMode"),
        environmentMode: fieldValue(form, "environmentMode"),
        narratorMode: fieldValue(form, "narratorMode"),
        prompt: fieldValue(form, "prompt"),
      });
    });
    boundRoots.add(root);
    return true;
  }

  return {
    bind,
    delete: deleteSchedule,
    getState,
    load,
    loadHistory,
    render,
    renderNavigation,
    run,
    save,
    select,
    setQuery,
    startCreate,
    toggle,
  };
}
