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
 */
export function parseDesktopHash(hashLike = globalThis.location?.hash || "") {
  const raw = String(hashLike || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const eq = raw.indexOf("=");
  const key = (eq >= 0 ? raw.slice(0, eq) : raw).toLowerCase();
  const value = eq >= 0 ? decodeURIComponent(raw.slice(eq + 1)) : "";
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

/**
 * Wire hash + CustomEvent('autoto:deeplink') handlers once.
 * handlers: { openSettings(panel), openAgent(id), openProject(id), openConversation(id) }
 */
export function installDesktopDeepLinkRouter(handlers = {}) {
  if (typeof globalThis.window === "undefined") return () => {};
  const apply = (hash) => {
    const parsed = parseDesktopHash(hash);
    if (!parsed) return;
    try {
      if (parsed.kind === "settings") handlers.openSettings?.(parsed.panel);
      else if (parsed.kind === "agent") handlers.openAgent?.(parsed.id);
      else if (parsed.kind === "project") handlers.openProject?.(parsed.id);
      else if (parsed.kind === "conversation") handlers.openConversation?.(parsed.id);
    } catch {
      // navigation helpers may throw before boot completes
    }
  };
  const onHash = () => apply(globalThis.location?.hash || "");
  const onEvent = (event) => {
    // Shell may set hash then emit; re-read hash.
    onHash();
    if (event?.detail) {
      // detail is raw autoto:// URL — hash already applied by shell JS
    }
  };
  globalThis.window.addEventListener("hashchange", onHash);
  globalThis.window.addEventListener("autoto:deeplink", onEvent);
  // Initial hash after first paint (avoid double-call when queueMicrotask exists).
  if (typeof globalThis.queueMicrotask === "function") globalThis.queueMicrotask(onHash);
  else onHash();
  return () => {
    globalThis.window.removeEventListener("hashchange", onHash);
    globalThis.window.removeEventListener("autoto:deeplink", onEvent);
  };
}

export { isDesktopShell };
