import { escapeAttr, escapeHtml } from "./dom.mjs";

export const automationLimits = Object.freeze({
  schedules: 100,
  deliveries: 60,
  connections: 40,
  pairings: 80,
  devices: 200,
  deviceActions: 60,
  auditEvents: 50,
  activity: 40,
});

export const legacyIMDraftKeys = Object.freeze(["autoto.imGateway", "codeharbor.imGateway"]);
const ENV_REFERENCE_PATTERN = /^env:[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_PERMISSION_MODES = new Set(["readOnly", "acceptEdits"]);
const HOME_ASSISTANT_KINDS = new Set(["home_assistant", "home-assistant", "homeassistant", "ha"]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedText(value, limit = 240) {
  return String(value ?? "").trim().slice(0, limit);
}

function boundedNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedList(payload, keys, limit) {
  if (Array.isArray(payload)) return payload.slice(0, limit);
  const source = objectValue(payload);
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key].slice(0, limit);
  }
  if (source.data && source.data !== payload) return boundedList(source.data, keys, limit);
  return [];
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    if (["false", "0", "off", "disabled"].includes(value.toLowerCase())) return false;
    if (["true", "1", "on", "enabled"].includes(value.toLowerCase())) return true;
  }
  return Boolean(value);
}

function normalizeKind(value) {
  const kind = boundedText(value, 48).toLowerCase();
  if (HOME_ASSISTANT_KINDS.has(kind)) return "home-assistant";
  return kind;
}

function normalizeRisk(value) {
  const risk = boundedText(value, 24).toLowerCase();
  if (["critical", "high", "medium", "low", "blocked"].includes(risk)) return risk;
  if (risk === "danger") return "high";
  if (["warning", "warn"].includes(risk)) return "medium";
  return "low";
}

function normalizeStatus(value, fallback = "unknown") {
  return boundedText(value || fallback, 48).toLowerCase().replace(/\s+/g, "_");
}

function firstText(...values) {
  for (const value of values) {
    const text = boundedText(value, 800);
    if (text) return text;
  }
  return "";
}

function compactJSON(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\b(token|secret|password|api[-_ ]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .slice(0, 1200);
}

export function normalizeEnvReference(value, { required = true, label = "凭据" } = {}) {
  const reference = boundedText(value, 160);
  if (!reference && !required) return "";
  if (!ENV_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`${label}只能填写 env:变量名 引用，禁止输入 token 或 secret 明文`);
  }
  return reference;
}

export function normalizeSchedule(value = {}) {
  const source = objectValue(value);
  return {
    id: boundedText(source.id ?? source.scheduleId, 160),
    name: boundedText(source.name ?? source.title, 120),
    expression: firstText(source.expression, source.cronExpr, source.cron, source.schedule),
    timezone: boundedText(source.timezone, 128) || "UTC",
    agentId: boundedText(source.agentId ?? source.projectId ?? source.workspaceId, 160),
    prompt: boundedText(source.prompt ?? source.task ?? source.message, 8000),
    permissionMode: SAFE_PERMISSION_MODES.has(source.permissionMode) ? source.permissionMode : "readOnly",
    enabled: booleanValue(source.enabled, normalizeStatus(source.status) === "enabled"),
    status: normalizeStatus(source.status, source.enabled === false ? "disabled" : "ready"),
    nextRunAt: boundedText(source.nextRunAt ?? source.nextAt, 80),
    lastRunAt: boundedText(source.lastRunAt ?? source.lastTriggeredAt, 80),
    lastRunId: boundedText(source.lastRunId, 160),
    lastOutcome: normalizeStatus(source.lastOutcome, ""),
    lastError: redactSensitiveText(source.lastError ?? source.error),
  };
}

export function normalizeDelivery(value = {}) {
  const source = objectValue(value);
  return {
    id: boundedText(source.id ?? source.deliveryId, 160),
    channel: boundedText(source.channel ?? source.sinkType ?? source.connectionKind ?? source.kind, 80),
    event: boundedText(source.event ?? source.eventType ?? source.kind, 120),
    status: normalizeStatus(source.status, source.deliveredAt ? "delivered" : "pending"),
    attempts: boundedNumber(source.attempts ?? source.attemptCount, 0),
    error: redactSensitiveText(source.error ?? source.lastError),
    createdAt: boundedText(source.createdAt ?? source.queuedAt, 80),
    deliveredAt: boundedText(source.deliveredAt ?? source.sentAt, 80),
  };
}

export function normalizeConnection(value = {}) {
  const source = objectValue(value);
  const config = objectValue(source.config);
  const secretConfigured = objectValue(source.secretConfigured);
  const kind = normalizeKind(source.kind ?? source.type ?? source.provider);
  const enabled = booleanValue(source.enabled, true);
  return {
    id: boundedText(source.id ?? source.connectionId, 160),
    kind,
    name: boundedText(source.name ?? source.label ?? (kind === "telegram" ? "Telegram" : "Home Assistant"), 160),
    enabled,
    status: normalizeStatus(source.status, enabled ? "enabled" : "disabled"),
    endpoint: boundedText(source.endpoint ?? source.baseUrl ?? source.url ?? config.baseUrl ?? config.url, 400),
    credentialConfigured: booleanValue(source.credentialConfigured, kind === "telegram" ? Boolean(secretConfigured.botToken) : Boolean(secretConfigured.accessToken)),
    lastTestedAt: boundedText(source.lastTestedAt ?? source.testedAt, 80),
    lastError: redactSensitiveText(source.lastError ?? source.error),
  };
}

export function normalizePairing(value = {}) {
  const source = objectValue(value);
  return {
    id: boundedText(source.id ?? source.pairingId, 160),
    connectionId: boundedText(source.connectionId, 160),
    agentId: boundedText(source.agentId, 160),
    channelUser: boundedText(source.channelUser ?? source.username ?? source.chatId ?? source.externalId, 180),
    status: normalizeStatus(source.status, source.revokedAt ? "revoked" : "active"),
    pairedAt: boundedText(source.pairedAt ?? source.createdAt, 80),
    revokedAt: boundedText(source.revokedAt, 80),
  };
}

export function normalizePairingCode(value = {}) {
  const source = objectValue(value);
  return {
    code: boundedText(source.code ?? source.pairingCode, 160),
    connectionId: boundedText(source.connectionId, 160),
    agentId: boundedText(source.agentId, 160),
    expiresAt: boundedText(source.expiresAt ?? source.expiry, 80),
  };
}

export function normalizeDevice(value = {}) {
  const source = objectValue(value);
  const attributes = objectValue(source.attributes);
  const entityId = boundedText(source.entityId ?? source.id ?? source.deviceId, 220);
  return {
    id: entityId,
    entityId,
    name: boundedText(source.name ?? source.friendlyName ?? attributes.friendly_name ?? entityId, 220),
    domain: boundedText(source.domain ?? entityId.split(".")[0], 80),
    state: boundedText(source.state ?? source.value ?? "unknown", 160),
    available: booleanValue(source.available, source.state !== "unavailable"),
    readOnly: booleanValue(source.readOnly, true),
    updatedAt: boundedText(source.updatedAt ?? source.lastChanged ?? source.lastUpdated, 80),
  };
}

export function normalizeDeviceAction(value = {}) {
  const source = objectValue(value);
  return {
    id: boundedText(source.id ?? source.actionId, 160),
    connectionId: boundedText(source.connectionId, 160),
    entityId: boundedText(source.entityId ?? source.deviceId, 220),
    domain: boundedText(source.domain, 80),
    service: boundedText(source.service ?? source.action, 160),
    risk: normalizeRisk(source.risk ?? source.riskLevel),
    status: normalizeStatus(source.status, "pending"),
    expiresAt: boundedText(source.expiresAt ?? source.expiry, 80),
    requestedAt: boundedText(source.requestedAt ?? source.createdAt, 80),
    error: redactSensitiveText(source.error ?? source.lastError),
  };
}

export function normalizeAuditEvent(value = {}) {
  const source = objectValue(value);
  const action = boundedText(source.action ?? source.type ?? source.event, 160);
  const category = boundedText(source.category, 80);
  return {
    id: boundedText(source.id ?? source.eventId, 160),
    type: [category, action].filter(Boolean).join(" / "),
    actor: boundedText(source.actor ?? source.source ?? source.principal, 160),
    result: normalizeStatus(source.outcome ?? source.result ?? source.status, "recorded"),
    risk: normalizeRisk(source.risk),
    summary: redactSensitiveText(source.summary ?? source.message ?? source.detail ?? compactJSON(source.details)),
    createdAt: boundedText(source.createdAt ?? source.timestamp ?? source.occurredAt, 80),
  };
}

export function normalizeMonitoringSnapshot(value = {}) {
  const source = objectValue(value);
  const counts = objectValue(source.counts);
  const schedules = boundedList(source, ["schedules"], automationLimits.schedules).map(normalizeSchedule);
  const deliveries = boundedList(source, ["deliveries", "notifications"], automationLimits.deliveries).map(normalizeDelivery);
  const connections = boundedList(source, ["connections", "channels"], automationLimits.connections).map(normalizeConnection);
  const devices = boundedList(source, ["devices", "entities"], automationLimits.devices).map(normalizeDevice);
  const deviceActions = boundedList(source, ["deviceActions", "pendingDeviceActions", "actions"], automationLimits.deviceActions).map(normalizeDeviceAction);
  const runs = objectValue(source.runs);
  const approvals = objectValue(source.approvals);
  const scheduleStats = objectValue(source.schedules);
  const notificationStats = objectValue(source.notifications);
  const channelStats = objectValue(source.channels);
  const deviceStats = objectValue(source.devices);
  return {
    activeRuns: boundedNumber(source.activeRuns ?? counts.activeRuns ?? runs.active ?? runs.running, 0),
    pendingApprovals: boundedNumber(source.pendingApprovals ?? counts.pendingApprovals ?? approvals.pending, 0),
    scheduleCount: boundedNumber(source.scheduleCount ?? counts.schedules ?? scheduleStats.total, schedules.length),
    notificationCount: boundedNumber(source.notificationCount ?? counts.notifications ?? notificationStats.total, deliveries.length),
    channelCount: boundedNumber(source.channelCount ?? counts.channels ?? channelStats.total ?? channelStats.connections, connections.length),
    deviceCount: boundedNumber(source.deviceCount ?? counts.devices ?? deviceStats.total, devices.length),
    capturedAt: boundedText(source.capturedAt ?? source.createdAt, 80),
    deviceActions,
  };
}

export function normalizeAutomationSnapshot(value = {}) {
  const source = objectValue(value);
  return {
    schedules: boundedList(source.schedules ?? source, ["schedules", "items"], automationLimits.schedules).map(normalizeSchedule),
    deliveries: boundedList(source.deliveries ?? source.notifications ?? source, ["deliveries", "notifications", "items"], automationLimits.deliveries).map(normalizeDelivery),
    connections: boundedList(source.connections ?? source, ["connections", "items"], automationLimits.connections).map(normalizeConnection),
    pairings: boundedList(source.pairings ?? source, ["pairings", "items"], automationLimits.pairings).map(normalizePairing),
    devices: boundedList(source.devices ?? source, ["devices", "entities", "items"], automationLimits.devices).map(normalizeDevice),
    auditEvents: boundedList(source.auditEvents ?? source.audit ?? source, ["events", "auditEvents", "items"], automationLimits.auditEvents).map(normalizeAuditEvent),
    monitoring: normalizeMonitoringSnapshot(source.monitoring ?? source.snapshot ?? {}),
  };
}

export function buildSchedulePayload(input = {}) {
  const source = objectValue(input);
  const expression = boundedText(source.expression ?? source.cronExpr ?? source.cron, 256);
  const timezone = boundedText(source.timezone, 128) || "UTC";
  const agentId = boundedText(source.agentId ?? source.projectId, 128);
  const prompt = boundedText(source.prompt, 8000);
  if (!expression) throw new Error("Cron 表达式不能为空");
  if (!agentId) throw new Error("Agent ID 不能为空");
  if (!prompt) throw new Error("排程任务内容不能为空");
  const permissionMode = SAFE_PERMISSION_MODES.has(source.permissionMode) ? source.permissionMode : "readOnly";
  return {
    name: boundedText(source.name, 120) || "未命名排程",
    agentId,
    expression,
    timezone,
    prompt,
    permissionMode,
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : true,
  };
}

export function buildConnectionPayload(input = {}) {
  const source = objectValue(input);
  const kind = normalizeKind(source.kind);
  if (!new Set(["telegram", "home-assistant"]).has(kind)) throw new Error("只支持 Telegram 或 Home Assistant 连接");
  const credentialRef = normalizeEnvReference(source.credentialRef, {
    label: kind === "telegram" ? "Bot token" : "Access token",
  });
  const payload = {
    kind,
    name: boundedText(source.name, 160) || (kind === "telegram" ? "Telegram" : "Home Assistant"),
    enabled: true,
    endpoint: "",
    settings: {},
    secretRefs: kind === "telegram" ? { botToken: credentialRef } : { accessToken: credentialRef },
  };
  if (kind === "home-assistant") {
    payload.endpoint = boundedText(source.endpoint ?? source.baseUrl, 400).replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(payload.endpoint)) throw new Error("Home Assistant URL 必须使用 http:// 或 https://");
  }
  return payload;
}

export function buildPairingCodePayload(input = {}) {
  const source = objectValue(input);
  const connectionId = boundedText(source.connectionId, 160);
  const agentId = boundedText(source.agentId, 160);
  if (!connectionId || !agentId) throw new Error("生成配对码需要 connectionId 与 agentId");
  return { connectionId, agentId };
}

export function parseDeviceParameters(value) {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error("设备动作参数必须是有效 JSON 对象");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("设备动作参数必须是 JSON 对象");
  return parsed;
}

export function buildDeviceActionPayload(input = {}) {
  const source = objectValue(input);
  const connectionId = boundedText(source.connectionId, 128);
  const entityId = boundedText(source.entityId ?? source.deviceId, 255);
  const domain = boundedText(source.domain ?? entityId.split(".")[0], 64);
  const service = boundedText(source.service ?? source.action, 64);
  if (!connectionId || !entityId || !domain || !service) throw new Error("设备动作需要连接、实体、domain 与 service");
  const inputPayload = parseDeviceParameters(source.input ?? source.parameters);
  return {
    connectionId,
    domain,
    service,
    input: { ...inputPayload, entity_id: entityId },
  };
}

export function readLegacyIMDraft(storage = globalThis.localStorage) {
  for (const key of legacyIMDraftKeys) {
    try {
      const raw = storage?.getItem?.(key);
      if (raw == null) continue;
      let channel = "";
      try {
        channel = boundedText(JSON.parse(raw)?.channel, 80);
      } catch {}
      return { present: true, key, channel, authoritative: false, status: "disabled" };
    } catch {}
  }
  return { present: false, key: "", channel: "", authoritative: false, status: "disabled" };
}

export function isDeviceActionExpired(action, now = Date.now()) {
  const expiresAt = Date.parse(normalizeDeviceAction(action).expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Number(now);
}

export async function requireLocalDoubleConfirmation(confirmAction, messages = []) {
  const confirm = typeof confirmAction === "function" ? confirmAction : () => false;
  const [first, second] = messages;
  if (!await confirm(first || "确认从本地控制台发起此危险操作？")) return false;
  if (!await confirm(second || "最终确认：此操作可能改变真实设备状态，仍要继续？")) return false;
  return true;
}

function statusLabel(status) {
  return ({
    active: "有效",
    approved: "已批准",
    connected: "已连接",
    delivered: "已投递",
    disabled: "已停用",
    denied: "已拒绝",
    enabled: "已启用",
    expired: "已过期",
    failed: "失败",
    healthy: "正常",
    pending: "待本地审批",
    pending_approval: "待本地审批",
    queued: "排队中",
    inflight: "投递中",
    retry_wait: "等待重试",
    dead: "重试耗尽",
    executing: "执行中",
    ready: "就绪",
    revoked: "已撤销",
    running: "运行中",
    succeeded: "成功",
    success: "成功",
    unknown: "未知",
  })[status] || status || "未知";
}

function statusTone(status) {
  if (["active", "approved", "connected", "delivered", "enabled", "healthy", "ready", "succeeded", "success"].includes(status)) return "ok";
  if (["failed", "denied", "expired", "revoked", "dead"].includes(status)) return "danger";
  if (["pending", "pending_approval", "queued", "inflight", "retry_wait", "running", "executing"].includes(status)) return "warn";
  return "muted";
}

function kindLabel(kind) {
  return ({ telegram: "Telegram", "home-assistant": "Home Assistant" })[kind] || kind || "未知渠道";
}

function formatTimestamp(value) {
  const text = boundedText(value, 80);
  if (!text) return "—";
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return text;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function renderStatusPill(status) {
  const normalized = normalizeStatus(status);
  return `<span class="automation-status ${statusTone(normalized)}">${escapeHtml(statusLabel(normalized))}</span>`;
}

function renderSectionState({ loading = false, error = "", empty = false, emptyText = "暂无数据" } = {}) {
  if (loading) return '<div class="automation-empty" aria-busy="true">正在加载…</div>';
  if (error) return `<div class="automation-inline-error" role="alert">${escapeHtml(redactSensitiveText(error))}</div>`;
  if (empty) return `<div class="automation-empty">${escapeHtml(emptyText)}</div>`;
  return "";
}

function renderMetric(label, value, tone = "") {
  return `<div class="automation-metric ${escapeAttr(tone)}"><strong>${escapeHtml(String(boundedNumber(value)))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderScheduleCard(value, busy = {}) {
  const schedule = normalizeSchedule(value);
  const actionBusy = Boolean(busy[`schedule:${schedule.id}`]);
  const disabled = actionBusy ? " disabled" : "";
  return `
    <article class="automation-card" data-schedule-card="${escapeAttr(schedule.id)}">
      <div class="automation-card-head">
        <div><strong>${escapeHtml(schedule.name || schedule.id || "未命名排程")}</strong><small>${escapeHtml(`${schedule.expression || "未配置 Cron"} · ${schedule.timezone}`)}</small></div>
        ${renderStatusPill(schedule.enabled ? "enabled" : "disabled")}
      </div>
      <p class="automation-card-copy">${escapeHtml(schedule.prompt || "未提供任务内容")}</p>
      <dl class="automation-kv"><div><dt>Agent</dt><dd>${escapeHtml(schedule.agentId || "—")}</dd></div><div><dt>权限</dt><dd>${escapeHtml(schedule.permissionMode)}</dd></div><div><dt>下次运行</dt><dd>${escapeHtml(formatTimestamp(schedule.nextRunAt))}</dd></div></dl>
      ${schedule.lastError ? `<div class="automation-inline-error">${escapeHtml(schedule.lastError)}</div>` : ""}
      <div class="automation-actions">
        <button class="automation-btn subtle" type="button" data-schedule-toggle="${escapeAttr(schedule.id)}" data-enabled="${schedule.enabled ? "true" : "false"}"${disabled}>${schedule.enabled ? "停用" : "启用"}</button>
        <button class="automation-btn primary" type="button" data-schedule-run="${escapeAttr(schedule.id)}"${disabled}>立即运行</button>
        <button class="automation-btn danger" type="button" data-schedule-delete="${escapeAttr(schedule.id)}"${disabled}>删除</button>
      </div>
    </article>`;
}

function renderConnectionCard(value, busy = {}) {
  const connection = normalizeConnection(value);
  const actionBusy = Boolean(busy[`connection:${connection.id}`]);
  const disabled = actionBusy ? " disabled" : "";
  const credential = connection.credentialConfigured ? "环境变量凭据：已配置（引用目标与 secret 均不回显）" : "环境变量凭据：未配置";
  return `
    <article class="automation-card" data-connection-card="${escapeAttr(connection.id)}">
      <div class="automation-card-head">
        <div><strong>${escapeHtml(connection.name || kindLabel(connection.kind))}</strong><small>${escapeHtml(kindLabel(connection.kind))}</small></div>
        ${renderStatusPill(connection.enabled ? connection.status : "disabled")}
      </div>
      ${connection.endpoint ? `<p class="automation-card-copy mono">${escapeHtml(connection.endpoint)}</p>` : ""}
      <p class="automation-secret-note">${escapeHtml(credential)}</p>
      ${connection.lastError ? `<div class="automation-inline-error">${escapeHtml(connection.lastError)}</div>` : ""}
      <div class="automation-actions">
        <button class="automation-btn subtle" type="button" data-connection-toggle="${escapeAttr(connection.id)}" data-enabled="${connection.enabled ? "true" : "false"}"${disabled}>${connection.enabled ? "停用" : "启用"}</button>
        <button class="automation-btn subtle" type="button" data-connection-test="${escapeAttr(connection.id)}"${disabled}>测试连接</button>
        <button class="automation-btn danger" type="button" data-connection-delete="${escapeAttr(connection.id)}"${disabled}>删除</button>
      </div>
    </article>`;
}

function renderPairingCard(value, busy = {}) {
  const pairing = normalizePairing(value);
  const actionBusy = Boolean(busy[`pairing:${pairing.id}`]);
  return `
    <article class="automation-row-card">
      <div><strong>${escapeHtml(pairing.channelUser || pairing.agentId || pairing.id || "未知配对")}</strong><small>Agent ${escapeHtml(pairing.agentId || "—")} · ${escapeHtml(formatTimestamp(pairing.pairedAt))}</small></div>
      <div class="automation-actions compact">${renderStatusPill(pairing.status)}${pairing.status !== "revoked" ? `<button class="automation-btn danger" type="button" data-pairing-revoke="${escapeAttr(pairing.id)}"${actionBusy ? " disabled" : ""}>撤销</button>` : ""}</div>
    </article>`;
}

function renderDeliveryRow(value, busy = {}) {
  const delivery = normalizeDelivery(value);
  const retryable = ["failed", "error", "dead", "dead_letter"].includes(delivery.status);
  return `
    <article class="automation-row-card">
      <div><strong>${escapeHtml(delivery.event || "通知")}</strong><small>${escapeHtml(delivery.channel || "未知渠道")} · 尝试 ${escapeHtml(String(delivery.attempts))} 次 · ${escapeHtml(formatTimestamp(delivery.deliveredAt || delivery.createdAt))}</small>${delivery.error ? `<em>${escapeHtml(delivery.error)}</em>` : ""}</div>
      <div class="automation-actions compact">${renderStatusPill(delivery.status)}${retryable ? `<button class="automation-btn subtle" type="button" data-delivery-retry="${escapeAttr(delivery.id)}"${busy[`delivery:${delivery.id}`] ? " disabled" : ""}>重试</button>` : ""}</div>
    </article>`;
}

function renderDeviceRow(value) {
  const device = normalizeDevice(value);
  return `
    <article class="automation-device-row">
      <div><strong>${escapeHtml(device.name || device.entityId)}</strong><small class="mono">${escapeHtml(device.entityId)}</small></div>
      <span>${escapeHtml(device.state)}</span>
      <span class="automation-readonly">只读</span>
    </article>`;
}

function renderDeviceAction(value, busy = {}, now = Date.now()) {
  const action = normalizeDeviceAction(value);
  const expired = isDeviceActionExpired(action, now);
  const pending = ["pending", "pending_approval"].includes(action.status) && !expired;
  const status = expired && ["pending", "pending_approval", "approved"].includes(action.status) ? "expired" : action.status;
  const actionBusy = Boolean(busy[`device-action:${action.id}`]);
  const riskLabel = ({ critical: "极高风险", high: "高风险", medium: "中风险", low: "低风险", blocked: "已阻止" })[action.risk] || action.risk;
  return `
    <article class="automation-card ${["critical", "high", "blocked"].includes(action.risk) ? "danger-zone" : ""}">
      <div class="automation-card-head"><div><strong>${escapeHtml([action.domain, action.service].filter(Boolean).join(".") || "设备动作")}</strong><small class="mono">${escapeHtml(action.entityId || "未知实体")}</small></div>${renderStatusPill(status)}</div>
      <dl class="automation-kv"><div><dt>风险</dt><dd>${escapeHtml(riskLabel)}</dd></div><div><dt>过期</dt><dd>${escapeHtml(formatTimestamp(action.expiresAt))}</dd></div></dl>
      ${action.error ? `<div class="automation-inline-error">${escapeHtml(action.error)}</div>` : ""}
      ${pending ? `<div class="automation-actions"><button class="automation-btn danger" type="button" data-device-action-approve="${escapeAttr(action.id)}"${actionBusy ? " disabled" : ""}>本地双确认批准</button><button class="automation-btn subtle" type="button" data-device-action-deny="${escapeAttr(action.id)}"${actionBusy ? " disabled" : ""}>拒绝</button></div>` : ""}
    </article>`;
}

function renderAuditRow(value) {
  const event = normalizeAuditEvent(value);
  return `
    <article class="automation-audit-row">
      <time>${escapeHtml(formatTimestamp(event.createdAt))}</time>
      <div><strong>${escapeHtml(event.type || "事件")}</strong><small>${escapeHtml(event.actor || "system")}${event.summary ? ` · ${escapeHtml(event.summary)}` : ""}</small></div>
      ${renderStatusPill(event.result)}
    </article>`;
}

function renderActivityRow(value) {
  const source = objectValue(value);
  return `<li><time>${escapeHtml(formatTimestamp(source.at))}</time><span>${escapeHtml(redactSensitiveText(source.message))}</span></li>`;
}

function connectionOptions(connections, kind, selected = "") {
  return connections.filter((item) => item.kind === kind).map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name || item.id)}</option>`).join("");
}

export function renderAutomationControl(value = {}) {
  const source = objectValue(value);
  const schedules = (Array.isArray(source.schedules) ? source.schedules : []).slice(0, automationLimits.schedules).map(normalizeSchedule);
  const deliveries = (Array.isArray(source.deliveries) ? source.deliveries : []).slice(0, automationLimits.deliveries).map(normalizeDelivery);
  const connections = (Array.isArray(source.connections) ? source.connections : []).slice(0, automationLimits.connections).map(normalizeConnection);
  const pairings = (Array.isArray(source.pairings) ? source.pairings : []).slice(0, automationLimits.pairings).map(normalizePairing);
  const devices = (Array.isArray(source.devices) ? source.devices : []).slice(0, automationLimits.devices).map(normalizeDevice);
  const deviceActions = (Array.isArray(source.deviceActions) ? source.deviceActions : []).slice(0, automationLimits.deviceActions).map(normalizeDeviceAction);
  const auditEvents = (Array.isArray(source.auditEvents) ? source.auditEvents : []).slice(0, automationLimits.auditEvents).map(normalizeAuditEvent);
  const activity = (Array.isArray(source.activity) ? source.activity : []).slice(-automationLimits.activity);
  const monitoring = normalizeMonitoringSnapshot(source.monitoring);
  const errors = objectValue(source.errors);
  const busy = objectValue(source.busy);
  const loading = Boolean(source.loading);
  const loaded = Boolean(source.loaded);
  const selectedConnectionId = boundedText(source.selectedConnectionId, 160);
  const legacyDraft = objectValue(source.legacyDraft);
  const pairingCode = normalizePairingCode(source.latestPairingCode);
  const telegramConnections = connections.filter((item) => item.kind === "telegram");
  const homeAssistantConnections = connections.filter((item) => item.kind === "home-assistant");
  const scheduleState = renderSectionState({ loading: loading && !loaded, error: errors.schedules, empty: !schedules.length, emptyText: "暂无排程，先创建一个受限权限任务。" });
  const deliveryState = renderSectionState({ loading: loading && !loaded, error: errors.deliveries, empty: !deliveries.length, emptyText: "暂无通知投递记录。" });
  const connectionState = renderSectionState({ loading: loading && !loaded, error: errors.connections, empty: !connections.length, emptyText: "暂无真实连接；旧 localStorage 草稿不会被视为运行中。" });
  const pairingState = renderSectionState({ loading: loading && !loaded, error: errors.pairings, empty: !pairings.length, emptyText: "暂无已配对会话。" });
  const deviceState = renderSectionState({ loading: Boolean(source.devicesLoading), error: errors.devices, empty: !devices.length, emptyText: homeAssistantConnections.length ? "该连接没有可读实体。" : "先创建 Home Assistant 连接。" });
  const actionState = renderSectionState({ error: errors.deviceActions, empty: !deviceActions.length, emptyText: "暂无设备动作请求。" });
  const auditState = renderSectionState({ loading: loading && !loaded, error: errors.auditEvents, empty: !auditEvents.length, emptyText: "暂无审计事件。" });

  return `
    <div id="automationControlPage" class="automation-control-page" data-authority="server-api">
      <section class="automation-hero">
        <div>
          <div class="settings-hero-kicker">P2–P3 管理控制台</div>
          <h2>渠道、排程与家电</h2>
          <p>运行状态只以后端 API 为准。Telegram 仅接收环境变量引用；危险设备动作只能在本地 Web UI 双确认，IM 永远不能触发。</p>
        </div>
        <div class="automation-actions">
          <button id="refreshAutomationControlBtn" class="automation-btn primary" type="button"${loading ? " disabled" : ""}>${loading ? "刷新中…" : "刷新全部"}</button>
        </div>
      </section>
      <div class="automation-safety" role="note"><strong>明确安全边界</strong><span>排程权限仅限 readOnly / acceptEdits；不接受 token 明文；设备动作会改变真实环境，必须两次本地确认，并显示风险和过期时间。</span></div>
      ${legacyDraft.present ? `<div class="automation-migration" role="status"><strong>旧草稿已停用</strong><span>检测到 ${escapeHtml(legacyDraft.key || "localStorage")} 中的旧 IM 配置${legacyDraft.channel ? `（${escapeHtml(legacyDraft.channel)}）` : ""}。它只用于迁移提示，不会启动渠道、排程或设备，也绝不计入运行状态。</span></div>` : ""}
      ${errors.global ? `<div class="automation-inline-error" role="alert">${escapeHtml(redactSensitiveText(errors.global))}</div>` : ""}

      <section class="automation-metrics" aria-label="自动化监控快照">
        ${renderMetric("Active runs", monitoring.activeRuns, monitoring.activeRuns ? "active" : "")}
        ${renderMetric("Pending approvals", monitoring.pendingApprovals, monitoring.pendingApprovals ? "warn" : "")}
        ${renderMetric("Schedules", monitoring.scheduleCount || schedules.length)}
        ${renderMetric("Notifications", monitoring.notificationCount || deliveries.length)}
        ${renderMetric("Channels", monitoring.channelCount || connections.length)}
        ${renderMetric("Devices", monitoring.deviceCount || devices.length)}
      </section>

      <div class="automation-section-grid">
        <section class="automation-section span-2">
          <div class="automation-section-head"><div><span>排程</span><h3>受限权限后台任务</h3><p>Cron 到点或手动立即运行；危险的 bypassPermissions 不在此提供。</p></div>${errors.monitoring ? `<small class="error">${escapeHtml(redactSensitiveText(errors.monitoring))}</small>` : ""}</div>
          <form id="createScheduleForm" class="automation-form">
            <label>名称<input id="scheduleNameInput" maxlength="120" placeholder="每晚测试" required /></label>
            <label>Cron 表达式<input id="scheduleExpressionInput" maxlength="256" placeholder="0 2 * * *" required /></label>
            <label>Agent ID<input id="scheduleAgentInput" maxlength="128" placeholder="agent-id" required /></label>
            <label>时区<input id="scheduleTimezoneInput" maxlength="128" value="UTC" placeholder="Asia/Shanghai" required /></label>
            <label>权限<select id="schedulePermissionInput"><option value="readOnly">readOnly</option><option value="acceptEdits">acceptEdits</option></select></label>
            <label class="span-2">任务内容<textarea id="schedulePromptInput" rows="3" maxlength="8000" placeholder="运行测试并汇总失败；不要修改文件。" required></textarea></label>
            <div class="automation-form-actions span-2"><button class="automation-btn primary" type="submit"${busy["schedule:create"] ? " disabled" : ""}>${busy["schedule:create"] ? "创建中…" : "创建排程"}</button></div>
          </form>
          <div class="automation-card-grid">${scheduleState || schedules.map((item) => renderScheduleCard(item, busy)).join("")}</div>
        </section>

        <section class="automation-section">
          <div class="automation-section-head"><div><span>通知</span><h3>投递历史</h3><p>失败可见、原因脱敏，并可显式重试。</p></div></div>
          <div class="automation-list">${deliveryState || deliveries.map((item) => renderDeliveryRow(item, busy)).join("")}</div>
        </section>

        <section class="automation-section">
          <div class="automation-section-head"><div><span>Telegram</span><h3>渠道连接</h3><p>只填写 env: 引用；页面不保存也不回显 token 明文。</p></div></div>
          <form id="createTelegramConnectionForm" class="automation-form compact">
            <label>名称<input id="telegramNameInput" maxlength="160" placeholder="个人 Telegram" /></label>
            <label>Bot token 环境变量引用<input id="telegramCredentialInput" maxlength="160" placeholder="env:AUTOTO_TELEGRAM_BOT_TOKEN" autocomplete="off" required /></label>
            <div class="automation-form-actions"><button class="automation-btn primary" type="submit"${busy["connection:create:telegram"] ? " disabled" : ""}>创建 Telegram 连接</button></div>
          </form>
          <div class="automation-card-grid single">${connectionState || telegramConnections.map((item) => renderConnectionCard(item, busy)).join("") || '<div class="automation-empty">暂无 Telegram 连接。</div>'}</div>
        </section>

        <section class="automation-section">
          <div class="automation-section-head"><div><span>配对</span><h3>一次性配对码</h3><p>未配对 chat 不应获得响应；撤销后立即失效。</p></div></div>
          <form id="createPairingCodeForm" class="automation-form compact">
            <label>Telegram 连接<select id="pairingConnectionInput" required><option value="">选择连接</option>${connectionOptions(connections, "telegram")}</select></label>
            <label>Agent ID<input id="pairingAgentInput" maxlength="160" placeholder="agent-id" required /></label>
            <div class="automation-form-actions"><button class="automation-btn primary" type="submit"${busy["pairing:create"] ? " disabled" : ""}>生成配对码</button></div>
          </form>
          ${pairingCode.code ? `<div class="automation-pairing-code"><span>一次性配对码</span><strong>${escapeHtml(pairingCode.code)}</strong><small>过期：${escapeHtml(formatTimestamp(pairingCode.expiresAt))}</small></div>` : ""}
          <div class="automation-list">${pairingState || pairings.map((item) => renderPairingCard(item, busy)).join("")}</div>
        </section>

        <section class="automation-section span-2">
          <div class="automation-section-head"><div><span>Home Assistant</span><h3>家电连接与只读实体</h3><p>实体列表只读展示；Access token 仅允许 env: 引用。</p></div></div>
          <form id="createHomeAssistantConnectionForm" class="automation-form">
            <label>名称<input id="homeAssistantNameInput" maxlength="160" placeholder="Home Assistant" /></label>
            <label>Base URL<input id="homeAssistantUrlInput" maxlength="400" placeholder="http://homeassistant.local:8123" required /></label>
            <label class="span-2">Access token 环境变量引用<input id="homeAssistantCredentialInput" maxlength="160" placeholder="env:AUTOTO_HOME_ASSISTANT_TOKEN" autocomplete="off" required /></label>
            <div class="automation-form-actions span-2"><button class="automation-btn primary" type="submit"${busy["connection:create:home-assistant"] ? " disabled" : ""}>创建 Home Assistant 连接</button></div>
          </form>
          <div class="automation-card-grid">${homeAssistantConnections.length ? homeAssistantConnections.map((item) => renderConnectionCard(item, busy)).join("") : '<div class="automation-empty">暂无 Home Assistant 连接。</div>'}</div>
          <div class="automation-device-toolbar"><label>查看连接<select id="deviceConnectionSelect"><option value="">选择 Home Assistant 连接</option>${connectionOptions(connections, "home-assistant", selectedConnectionId)}</select></label><span>最多显示 ${automationLimits.devices} 个实体，DOM 有界。</span></div>
          <div class="automation-device-list">${deviceState || devices.map(renderDeviceRow).join("")}</div>
        </section>

        <section class="automation-section span-2 danger-section">
          <div class="automation-section-head"><div><span>真实世界动作</span><h3>设备动作请求与本地审批</h3><p>无法从 IM 发起。提交和危险批准均需本地双确认；过期请求不能批准。</p></div><span class="automation-danger-badge">高风险边界</span></div>
          <form id="createDeviceActionForm" class="automation-form">
            <label>Home Assistant 连接<select id="deviceActionConnectionInput" required><option value="">选择连接</option>${connectionOptions(connections, "home-assistant", selectedConnectionId)}</select></label>
            <label>实体 ID<input id="deviceActionEntityInput" maxlength="255" placeholder="light.living_room" required /></label>
            <label>Service<input id="deviceActionServiceInput" maxlength="64" placeholder="turn_off" required /></label>
            <label>附加 input JSON<input id="deviceActionInput" maxlength="1200" placeholder='{"brightness": 0}' /></label>
            <div class="automation-form-actions span-2"><button class="automation-btn danger" type="submit"${busy["device-action:create"] ? " disabled" : ""}>本地双确认并请求</button></div>
          </form>
          <div class="automation-card-grid">${actionState || deviceActions.map((item) => renderDeviceAction(item, busy, source.now)).join("")}</div>
        </section>

        <section class="automation-section span-2">
          <div class="automation-section-head"><div><span>审计</span><h3>最近 50 条事件</h3><p>动态内容转义、敏感片段脱敏；不会无界追加日志。</p></div></div>
          <div class="automation-audit-list">${auditState || auditEvents.map(renderAuditRow).join("")}</div>
          ${activity.length ? `<details class="automation-activity"><summary>本页操作记录（最近 ${escapeHtml(String(activity.length))} 条）</summary><ol>${activity.map(renderActivityRow).join("")}</ol></details>` : ""}
        </section>
      </div>
    </div>`;
}

export function createAutomationControlController({
  request,
  onChange,
  showError,
  showToast,
  storage = globalThis.localStorage,
  confirmAction,
  now = () => Date.now(),
} = {}) {
  if (typeof request !== "function") throw new TypeError("Automation control request must be a function");
  const confirm = confirmAction || ((message) => typeof window !== "undefined" && window.confirm(message));
  const state = {
    loaded: false,
    loading: false,
    devicesLoading: false,
    schedules: [],
    deliveries: [],
    connections: [],
    pairings: [],
    devices: [],
    deviceActions: [],
    auditEvents: [],
    monitoring: normalizeMonitoringSnapshot({}),
    errors: {},
    busy: {},
    selectedConnectionId: "",
    latestPairingCode: null,
    legacyDraft: readLegacyIMDraft(storage),
    activity: [],
    loadSeq: 0,
    deviceSeq: 0,
  };

  function getState() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      devicesLoading: state.devicesLoading,
      schedules: state.schedules.map((item) => ({ ...item })),
      deliveries: state.deliveries.map((item) => ({ ...item })),
      connections: state.connections.map((item) => ({ ...item })),
      pairings: state.pairings.map((item) => ({ ...item })),
      devices: state.devices.map((item) => ({ ...item })),
      deviceActions: state.deviceActions.map((item) => ({ ...item })),
      auditEvents: state.auditEvents.map((item) => ({ ...item })),
      monitoring: { ...state.monitoring, deviceActions: state.monitoring.deviceActions.map((item) => ({ ...item })) },
      errors: { ...state.errors },
      busy: { ...state.busy },
      selectedConnectionId: state.selectedConnectionId,
      latestPairingCode: state.latestPairingCode ? { ...state.latestPairingCode } : null,
      legacyDraft: { ...state.legacyDraft },
      activity: state.activity.map((item) => ({ ...item })),
      now: now(),
      loadSeq: state.loadSeq,
      deviceSeq: state.deviceSeq,
    };
  }

  function emit() {
    onChange?.(getState());
  }

  function addActivity(message) {
    state.activity.push({ at: new Date(now()).toISOString(), message: redactSensitiveText(message) });
    if (state.activity.length > automationLimits.activity) state.activity.splice(0, state.activity.length - automationLimits.activity);
  }

  function setError(section, error, { notify = true } = {}) {
    const message = redactSensitiveText(error?.message || error || "请求失败");
    state.errors[section] = message;
    addActivity(`${section}：${message}`);
    if (notify) showError?.(new Error(message));
  }

  function clearError(section) {
    if (state.errors[section]) delete state.errors[section];
  }

  function collectionResult(result, keys, limit, normalize) {
    return boundedList(result, keys, limit).map(normalize);
  }

  async function load() {
    const seq = ++state.loadSeq;
    state.deviceSeq += 1;
    state.loading = true;
    state.errors = {};
    emit();
    const requests = [
      ["schedules", "/api/schedules"],
      ["deliveries", "/api/notifications/deliveries"],
      ["connections", "/api/integrations/connections"],
      ["pairings", "/api/channels/pairings"],
      ["monitoring", "/api/monitoring/snapshot"],
      ["auditEvents", "/api/audit/events?limit=50"],
    ];
    const results = await Promise.allSettled(requests.map(([, path]) => request(path)));
    if (seq !== state.loadSeq) return false;
    results.forEach((result, index) => {
      const [section] = requests[index];
      if (result.status === "rejected") {
        setError(section, result.reason, { notify: false });
        return;
      }
      clearError(section);
      if (section === "schedules") state.schedules = collectionResult(result.value, ["schedules", "items"], automationLimits.schedules, normalizeSchedule);
      if (section === "deliveries") state.deliveries = collectionResult(result.value, ["deliveries", "notifications", "items"], automationLimits.deliveries, normalizeDelivery);
      if (section === "connections") state.connections = collectionResult(result.value, ["connections", "items"], automationLimits.connections, normalizeConnection);
      if (section === "pairings") state.pairings = collectionResult(result.value, ["pairings", "items"], automationLimits.pairings, normalizePairing);
      if (section === "monitoring") {
        state.monitoring = normalizeMonitoringSnapshot(result.value);
        state.deviceActions = state.monitoring.deviceActions;
      }
      if (section === "auditEvents") state.auditEvents = collectionResult(result.value, ["events", "auditEvents", "items"], automationLimits.auditEvents, normalizeAuditEvent);
    });
    const homeAssistantConnections = state.connections.filter((item) => item.kind === "home-assistant");
    if (!homeAssistantConnections.some((item) => item.id === state.selectedConnectionId)) {
      state.selectedConnectionId = homeAssistantConnections[0]?.id || "";
    }
    if (state.selectedConnectionId) {
      state.devicesLoading = true;
      emit();
      try {
        const devicesResult = await request(`/api/devices?connectionId=${encodeURIComponent(state.selectedConnectionId)}`);
        if (seq !== state.loadSeq) return false;
        state.devices = collectionResult(devicesResult, ["devices", "entities", "items"], automationLimits.devices, normalizeDevice);
        clearError("devices");
      } catch (error) {
        if (seq !== state.loadSeq) return false;
        state.devices = [];
        setError("devices", error, { notify: false });
      } finally {
        if (seq === state.loadSeq) state.devicesLoading = false;
      }
    } else {
      state.devices = [];
      state.devicesLoading = false;
    }
    if (seq !== state.loadSeq) return false;
    state.loaded = true;
    state.loading = false;
    addActivity("已刷新渠道、排程、设备、通知、监控与审计数据");
    emit();
    return true;
  }

  async function loadDevices(connectionId) {
    const id = boundedText(connectionId, 160);
    state.selectedConnectionId = id;
    const seq = ++state.deviceSeq;
    state.devicesLoading = true;
    clearError("devices");
    emit();
    if (!id) {
      state.devices = [];
      state.devicesLoading = false;
      emit();
      return true;
    }
    try {
      const result = await request(`/api/devices?connectionId=${encodeURIComponent(id)}`);
      if (seq !== state.deviceSeq) return false;
      state.devices = collectionResult(result, ["devices", "entities", "items"], automationLimits.devices, normalizeDevice);
      return true;
    } catch (error) {
      if (seq !== state.deviceSeq) return false;
      state.devices = [];
      setError("devices", error);
      return false;
    } finally {
      if (seq === state.deviceSeq) {
        state.devicesLoading = false;
        emit();
      }
    }
  }

  async function mutate({ key, section, path, options, success, reload = true, onResult }) {
    if (state.busy[key]) return false;
    state.loadSeq += 1;
    state.busy[key] = true;
    clearError(section);
    emit();
    try {
      const result = await request(path, options);
      onResult?.(result);
      addActivity(success);
      showToast?.(success, "success", { force: true });
      if (reload) await load();
      return true;
    } catch (error) {
      setError(section, error);
      return false;
    } finally {
      delete state.busy[key];
      emit();
    }
  }

  async function createSchedule(input) {
    let payload;
    try {
      payload = buildSchedulePayload(input);
    } catch (error) {
      setError("schedules", error);
      emit();
      return false;
    }
    return mutate({
      key: "schedule:create",
      section: "schedules",
      path: "/api/schedules",
      options: { method: "POST", body: JSON.stringify(payload) },
      success: "排程已创建。",
    });
  }

  function toggleSchedule(id, enabled) {
    const scheduleId = boundedText(id, 160);
    return mutate({
      key: `schedule:${scheduleId}`,
      section: "schedules",
      path: `/api/schedules/${encodeURIComponent(scheduleId)}`,
      options: { method: "PATCH", body: JSON.stringify({ enabled: Boolean(enabled) }) },
      success: enabled ? "排程已启用。" : "排程已停用。",
    });
  }

  function runSchedule(id) {
    const scheduleId = boundedText(id, 160);
    return mutate({
      key: `schedule:${scheduleId}`,
      section: "schedules",
      path: `/api/schedules/${encodeURIComponent(scheduleId)}/run`,
      options: { method: "POST" },
      success: "已请求立即运行排程。",
    });
  }

  async function deleteSchedule(id) {
    const scheduleId = boundedText(id, 160);
    if (!await confirm("确定删除此排程？此操作不可撤销。")) return false;
    return mutate({
      key: `schedule:${scheduleId}`,
      section: "schedules",
      path: `/api/schedules/${encodeURIComponent(scheduleId)}`,
      options: { method: "DELETE" },
      success: "排程已删除。",
    });
  }

  function retryDelivery(id) {
    const deliveryId = boundedText(id, 160);
    return mutate({
      key: `delivery:${deliveryId}`,
      section: "deliveries",
      path: `/api/notifications/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      options: { method: "POST" },
      success: "通知已加入重试。",
    });
  }

  async function createConnection(input) {
    let payload;
    try {
      payload = buildConnectionPayload(input);
    } catch (error) {
      setError("connections", error);
      emit();
      return false;
    }
    return mutate({
      key: `connection:create:${payload.kind}`,
      section: "connections",
      path: "/api/integrations/connections",
      options: { method: "POST", body: JSON.stringify(payload) },
      success: `${kindLabel(payload.kind)} 连接已创建；secret 未回显。`,
    });
  }

  function toggleConnection(id, enabled) {
    const connectionId = boundedText(id, 160);
    return mutate({
      key: `connection:${connectionId}`,
      section: "connections",
      path: `/api/integrations/connections/${encodeURIComponent(connectionId)}`,
      options: { method: "PATCH", body: JSON.stringify({ enabled: Boolean(enabled) }) },
      success: enabled ? "连接已启用。" : "连接已停用。",
    });
  }

  function testConnection(id) {
    const connectionId = boundedText(id, 160);
    return mutate({
      key: `connection:${connectionId}`,
      section: "connections",
      path: `/api/integrations/connections/${encodeURIComponent(connectionId)}/test`,
      options: { method: "POST" },
      success: "连接测试已完成。",
    });
  }

  async function deleteConnection(id) {
    const connectionId = boundedText(id, 160);
    if (!await confirm("删除连接会停止其通知、配对或设备访问。确定继续？")) return false;
    return mutate({
      key: `connection:${connectionId}`,
      section: "connections",
      path: `/api/integrations/connections/${encodeURIComponent(connectionId)}`,
      options: { method: "DELETE" },
      success: "连接已删除。",
    });
  }

  async function createPairingCode(input) {
    let payload;
    try {
      payload = buildPairingCodePayload(input);
    } catch (error) {
      setError("pairings", error);
      emit();
      return false;
    }
    return mutate({
      key: "pairing:create",
      section: "pairings",
      path: "/api/channels/pairing-codes",
      options: { method: "POST", body: JSON.stringify(payload) },
      success: "一次性配对码已生成。",
      onResult: (result) => { state.latestPairingCode = normalizePairingCode({ ...objectValue(result), ...payload }); },
    });
  }

  async function revokePairing(id) {
    const pairingId = boundedText(id, 160);
    if (!await confirm("确定撤销此渠道配对？撤销后该会话不能再审批。")) return false;
    return mutate({
      key: `pairing:${pairingId}`,
      section: "pairings",
      path: `/api/channels/pairings/${encodeURIComponent(pairingId)}/revoke`,
      options: { method: "POST" },
      success: "渠道配对已撤销。",
    });
  }

  async function requestDeviceAction(input) {
    let payload;
    try {
      payload = buildDeviceActionPayload(input);
    } catch (error) {
      setError("deviceActions", error);
      emit();
      return false;
    }
    const confirmed = await requireLocalDoubleConfirmation(confirm, [
      `设备动作只能从本地 Web UI 发起，IM 无法触发。确认请求 ${payload.input.entity_id} → ${payload.domain}.${payload.service}？`,
      "最终确认：此动作可能改变真实设备状态。请核对实体、service 和 input 后再继续。",
    ]);
    if (!confirmed) return false;
    return mutate({
      key: "device-action:create",
      section: "deviceActions",
      path: "/api/device-actions",
      options: { method: "POST", body: JSON.stringify(payload) },
      success: "设备动作请求已提交，等待本地审批或执行结果。",
      reload: false,
      onResult: (result) => {
        const normalized = normalizeDeviceAction({ entityId: payload.input.entity_id, ...payload, ...objectValue(result) });
        state.deviceActions = [normalized, ...state.deviceActions.filter((item) => item.id !== normalized.id)].slice(0, automationLimits.deviceActions);
      },
    });
  }

  async function approveDeviceAction(id) {
    const actionId = boundedText(id, 160);
    const action = state.deviceActions.find((item) => item.id === actionId);
    if (!action) return false;
    if (isDeviceActionExpired(action, now())) {
      setError("deviceActions", new Error("设备动作请求已过期，不能批准"));
      emit();
      return false;
    }
    const confirmed = await requireLocalDoubleConfirmation(confirm, [
      `仅本地 Web UI 可批准。确认批准 ${action.entityId} → ${action.domain}.${action.service}？`,
      `最终确认：风险等级为 ${action.risk}，过期时间 ${action.expiresAt || "未知"}。仍要执行？`,
    ]);
    if (!confirmed) return false;
    return mutate({
      key: `device-action:${actionId}`,
      section: "deviceActions",
      path: `/api/device-actions/${encodeURIComponent(actionId)}/approve`,
      options: { method: "POST" },
      success: "设备动作已在本地批准。",
    });
  }

  async function denyDeviceAction(id) {
    const actionId = boundedText(id, 160);
    if (!await confirm("确定拒绝此设备动作请求？")) return false;
    return mutate({
      key: `device-action:${actionId}`,
      section: "deviceActions",
      path: `/api/device-actions/${encodeURIComponent(actionId)}/deny`,
      options: { method: "POST" },
      success: "设备动作已拒绝。",
    });
  }

  function bind() {
    if (typeof document === "undefined") return;
    const root = document.getElementById("automationControlPage");
    if (!root) return;
    const byId = (id) => root.querySelector(`#${id}`);
    byId("refreshAutomationControlBtn")?.addEventListener("click", () => load());
    byId("createScheduleForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createSchedule({
        name: byId("scheduleNameInput")?.value,
        expression: byId("scheduleExpressionInput")?.value,
        agentId: byId("scheduleAgentInput")?.value,
        timezone: byId("scheduleTimezoneInput")?.value,
        permissionMode: byId("schedulePermissionInput")?.value,
        prompt: byId("schedulePromptInput")?.value,
      });
    });
    byId("createTelegramConnectionForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createConnection({ kind: "telegram", name: byId("telegramNameInput")?.value, credentialRef: byId("telegramCredentialInput")?.value });
    });
    byId("createHomeAssistantConnectionForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createConnection({ kind: "home-assistant", name: byId("homeAssistantNameInput")?.value, endpoint: byId("homeAssistantUrlInput")?.value, credentialRef: byId("homeAssistantCredentialInput")?.value });
    });
    byId("createPairingCodeForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createPairingCode({ connectionId: byId("pairingConnectionInput")?.value, agentId: byId("pairingAgentInput")?.value });
    });
    byId("deviceConnectionSelect")?.addEventListener("change", (event) => loadDevices(event.currentTarget.value));
    byId("createDeviceActionForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      requestDeviceAction({
        connectionId: byId("deviceActionConnectionInput")?.value,
        entityId: byId("deviceActionEntityInput")?.value,
        service: byId("deviceActionServiceInput")?.value,
        input: byId("deviceActionInput")?.value,
      });
    });
    root.querySelectorAll("[data-schedule-toggle]").forEach((button) => button.addEventListener("click", () => toggleSchedule(button.dataset.scheduleToggle, button.dataset.enabled !== "true")));
    root.querySelectorAll("[data-schedule-run]").forEach((button) => button.addEventListener("click", () => runSchedule(button.dataset.scheduleRun)));
    root.querySelectorAll("[data-schedule-delete]").forEach((button) => button.addEventListener("click", () => deleteSchedule(button.dataset.scheduleDelete)));
    root.querySelectorAll("[data-delivery-retry]").forEach((button) => button.addEventListener("click", () => retryDelivery(button.dataset.deliveryRetry)));
    root.querySelectorAll("[data-connection-toggle]").forEach((button) => button.addEventListener("click", () => toggleConnection(button.dataset.connectionToggle, button.dataset.enabled !== "true")));
    root.querySelectorAll("[data-connection-test]").forEach((button) => button.addEventListener("click", () => testConnection(button.dataset.connectionTest)));
    root.querySelectorAll("[data-connection-delete]").forEach((button) => button.addEventListener("click", () => deleteConnection(button.dataset.connectionDelete)));
    root.querySelectorAll("[data-pairing-revoke]").forEach((button) => button.addEventListener("click", () => revokePairing(button.dataset.pairingRevoke)));
    root.querySelectorAll("[data-device-action-approve]").forEach((button) => button.addEventListener("click", () => approveDeviceAction(button.dataset.deviceActionApprove)));
    root.querySelectorAll("[data-device-action-deny]").forEach((button) => button.addEventListener("click", () => denyDeviceAction(button.dataset.deviceActionDeny)));
    if (!state.loaded && !state.loading) load();
  }

  return {
    approveDeviceAction,
    bind,
    createConnection,
    createPairingCode,
    createSchedule,
    deleteConnection,
    deleteSchedule,
    denyDeviceAction,
    getState,
    load,
    loadDevices,
    render: () => renderAutomationControl(getState()),
    requestDeviceAction,
    retryDelivery,
    revokePairing,
    runSchedule,
    testConnection,
    toggleConnection,
    toggleSchedule,
  };
}
