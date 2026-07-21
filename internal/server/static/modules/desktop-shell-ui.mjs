/**
 * Desktop-shell UI helpers (loopback-only APIs).
 * Safe no-ops / empty state when not running inside AUTOTO_DESKTOP_SHELL
 * or when the host returns 404 (CLI/browser).
 */

import { isDesktopShell } from "./platform.mjs";

function localAPIToken() {
  return String(globalThis.window?.AUTOTO_LOCAL_TOKEN || "").trim();
}

async function desktopFetch(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const token = localAPIToken();
  if (token) headers["X-Autoto-Token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404) {
    const err = new Error("desktop shell API unavailable");
    err.status = 404;
    throw err;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(text || `desktop API HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function getAutostartStatus() {
  return desktopFetch("/api/desktop/autostart");
}

export async function enableAutostart() {
  return desktopFetch("/api/desktop/autostart", { method: "POST" });
}

export async function disableAutostart() {
  return desktopFetch("/api/desktop/autostart", { method: "DELETE" });
}

export async function getPendingDesktopUpdate() {
  return desktopFetch("/api/desktop/update/pending");
}

export async function stageDesktopUpdate({ sourcePath, version, sha256 } = {}) {
  return desktopFetch("/api/desktop/update/stage", {
    method: "POST",
    body: {
      sourcePath: String(sourcePath || ""),
      version: String(version || ""),
      sha256: String(sha256 || ""),
    },
  });
}

export async function clearPendingDesktopUpdate() {
  return desktopFetch("/api/desktop/update/pending", { method: "DELETE" });
}

/**
 * Parse location.hash fragments produced by the desktop shell deep-link bridge.
 * Supported:
 *   #settings
 *   #settings=remote-access
 *   #agent=<id>
 *   #project=<id>
 *   #conversation=<id>
 *   #chat | #terminal | #details | #browser | #settings (view)
 */
export function parseDesktopHash(hashLike = globalThis.location?.hash || "") {
  const raw = String(hashLike || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const eq = raw.indexOf("=");
  const key = (eq >= 0 ? raw.slice(0, eq) : raw).toLowerCase();
  let value = "";
  if (eq >= 0) {
    try {
      value = decodeURIComponent(raw.slice(eq + 1));
    } catch {
      return null;
    }
  }
  switch (key) {
    case "settings":
      return { kind: "settings", panel: value || "providers" };
    case "agent":
      return value ? { kind: "agent", id: value } : null;
    case "project":
      return value ? { kind: "project", id: value } : null;
    case "conversation":
      return value ? { kind: "conversation", id: value } : null;
    default:
      // open?view=chat style becomes #chat
      if (key && !value) return { kind: "view", view: key };
      return null;
  }
}

let activeDispose = null;
let lastAppliedKey = "";

function dispatchParsed(parsed, handlers = {}) {
  if (!parsed) return;
  try {
    if (parsed.kind === "settings") handlers.openSettings?.(parsed.panel);
    else if (parsed.kind === "agent") handlers.openAgent?.(parsed.id);
    else if (parsed.kind === "project") handlers.openProject?.(parsed.id);
    else if (parsed.kind === "conversation") handlers.openConversation?.(parsed.id);
    else if (parsed.kind === "view") handlers.openView?.(parsed.view);
  } catch {
    // navigation helpers may throw before boot completes
  }
}

/**
 * Wire hash + CustomEvent('autoto:deeplink') handlers once (idempotent).
 * handlers: { openSettings, openAgent, openProject, openConversation, openView }
 */
export function installDesktopDeepLinkRouter(handlers = {}) {
  if (typeof globalThis.window === "undefined") return () => {};
  // Replace previous installation so refresh/auth re-init cannot stack listeners.
  if (typeof activeDispose === "function") {
    activeDispose();
    activeDispose = null;
  }

  const applyHash = (hash, { force = false } = {}) => {
    const key = `hash:${String(hash || "")}`;
    if (!force && key === lastAppliedKey) return;
    const parsed = parseDesktopHash(hash);
    if (!parsed) return;
    lastAppliedKey = key;
    dispatchParsed(parsed, handlers);
  };

  const onHash = () => applyHash(globalThis.location?.hash || "");
  const onEvent = (event) => {
    // Prefer the current hash (shell usually sets it). If hash is empty but
    // detail is present, parse the raw autoto:// URL's target fragment.
    const hash = globalThis.location?.hash || "";
    if (hash) {
      applyHash(hash, { force: true });
      return;
    }
    const detail = String(event?.detail || "");
    if (!detail) return;
    // Best-effort: extract #fragment from detail target if shell only emitted event.
    const hashIdx = detail.indexOf("#");
    if (hashIdx >= 0) applyHash(detail.slice(hashIdx), { force: true });
  };

  globalThis.window.addEventListener("hashchange", onHash);
  globalThis.window.addEventListener("autoto:deeplink", onEvent);
  if (typeof globalThis.queueMicrotask === "function") globalThis.queueMicrotask(onHash);
  else onHash();

  const dispose = () => {
    globalThis.window.removeEventListener("hashchange", onHash);
    globalThis.window.removeEventListener("autoto:deeplink", onEvent);
    if (activeDispose === dispose) activeDispose = null;
  };
  activeDispose = dispose;
  return dispose;
}

export { isDesktopShell };
