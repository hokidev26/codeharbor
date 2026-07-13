const localAPIToken = String(window.AUTOTO_LOCAL_TOKEN || "").trim()
  || String(window.CODEHARBOR_LOCAL_TOKEN || "").trim();

export function withLocalToken(path) {
  if (!localAPIToken) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set("token", localAPIToken);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function webSocketURL(path) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${withLocalToken(path)}`;
}

export async function api(path, options = {}) {
  const baseHeaders = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const headers = localAPIToken ? { ...baseHeaders, "X-Autoto-Token": localAPIToken } : baseHeaders;
  const res = await fetch(path, {
    ...options,
    headers,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const fallback = `${res.status} ${res.statusText}`;
    const message = typeof body === "string" ? body : (body?.error || body?.message || fallback);
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body ?? {};
}
