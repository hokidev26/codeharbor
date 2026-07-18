import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppApiPath,
  buildAuthPath,
  buildReadOnlyMessageSubmission,
  createInitialOAuthAppState,
  isAllowedAppRequestPath,
  mapAgents,
  mapCurrentUser,
  mapMessages,
  mapProjects,
  normalizeAppError,
  normalizeReadOnlySubmissionCapability,
  requestAppJSON,
  setText,
  submissionControlState,
  toDisplayText,
  transitionOAuthAppState,
} from "./oauth-app.mjs";

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (name) => headers[name.toLowerCase()] || headers[name] || "" },
    async text() {
      if (body === null || body === undefined) return "";
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

test("untrusted OAuth App text stays literal and uses textContent", () => {
  const attack = '<img src=x onerror="globalThis.pwned=1"><script>alert(1)</script>';
  let assigned = "";
  const node = {
    innerHTML: "sentinel",
    set textContent(value) { assigned = value; },
    get textContent() { return assigned; },
  };

  assert.equal(toDisplayText(attack), attack);
  assert.equal(setText(node, attack), attack);
  assert.equal(node.textContent, attack);
  assert.equal(node.innerHTML, "sentinel");

  const [message] = mapMessages({ messages: [{ id: "m1", role: "assistant", contentText: attack }] });
  assert.equal(message.content, attack);
  assert.doesNotMatch(message.content, /&lt;/);
});

test("API and auth paths encode identifiers and reject cross-origin return targets", () => {
  assert.equal(buildAppApiPath("agents", { projectId: "team/a b" }), "/app/api/projects/team%2Fa%20b/agents");
  assert.equal(
    buildAppApiPath("messages", { projectId: "project/1", agentId: "agent ?#", cursor: "next/value", limit: 500 }),
    "/app/api/projects/project%2F1/agents/agent%20%3F%23/messages?cursor=next%2Fvalue&limit=200",
  );
  assert.equal(buildAuthPath("login", { returnTo: "/app/oauth?tab=a b" }), "/app/auth/login?returnTo=%2Fapp%2Foauth%3Ftab%3Da+b");
  assert.equal(buildAuthPath("login", { returnTo: "https://evil.test/steal" }), "/app/auth/login");
  assert.equal(buildAuthPath("login", { returnTo: "//evil.test/steal" }), "/app/auth/login");
  assert.throws(() => buildAppApiPath("agents", { projectId: "" }), /projectId is required/);
  assert.equal(isAllowedAppRequestPath("/app/api/projects"), true);
  assert.equal(isAllowedAppRequestPath("/api/projects"), false);
  assert.equal(isAllowedAppRequestPath("https://evil.test/app/api/projects"), false);
});

test("data mappers normalize BFF variants without exposing credential fields", () => {
  assert.deepEqual(mapCurrentUser({ user: { sub: "u1", name: "Alice", email: "alice@example.test", accessToken: "secret" } }), {
    id: "u1",
    displayName: "Alice",
    handle: "alice@example.test",
  });
  assert.deepEqual(mapProjects({ items: [{ projectId: "p1", title: "Project", role: "viewer", archived: true, gatewayKey: "secret" }] }), [
    { id: "p1", name: "Project", role: "viewer", archived: true, pinned: false },
  ]);
  assert.deepEqual(mapAgents({ data: [{ agentId: "a1", title: "Agent", state: "idle", localToken: "secret" }] }), [
    { id: "a1", projectId: "", name: "Agent", type: "", status: "idle" },
  ]);
  assert.deepEqual(mapMessages({ messages: [{ messageId: "m1", type: "assistant", content: [{ text: "one" }, { text: "two" }] }] })[0], {
    id: "m1",
    role: "assistant",
    content: "one\ntwo",
    createdAt: "",
    completionState: "",
  });
});

test("pure state transitions clear dependent project and Agent data", () => {
  let state = createInitialOAuthAppState();
  state = transitionOAuthAppState(state, {
    type: "authenticated",
    payload: {
      authenticated: true,
      user: { id: "u1", displayName: "Alice" },
      capabilities: { readOnlyMessageSubmitAllowed: true, maxPermissionMode: "readOnly" },
    },
  });
  assert.equal(state.phase, "ready");
  assert.equal(state.authenticated, true);
  assert.equal(state.capability, true);

  state = transitionOAuthAppState(state, { type: "projects_loaded", payload: { projects: [{ id: "p1", name: "One" }] } });
  state = transitionOAuthAppState(state, { type: "project_selected", projectId: "p1" });
  state = transitionOAuthAppState(state, { type: "agents_loaded", payload: { agents: [{ id: "a1", name: "A" }] } });
  state = transitionOAuthAppState(state, { type: "agent_selected", agentId: "a1" });
  state = transitionOAuthAppState(state, { type: "messages_loaded", payload: { messages: [{ id: "m1", contentText: "hello" }] } });
  assert.equal(state.messages.length, 1);

  state = transitionOAuthAppState(state, { type: "project_selected", projectId: "p2" });
  assert.equal(state.selectedProjectId, "p2");
  assert.equal(state.selectedAgentId, "");
  assert.deepEqual(state.agents, []);
  assert.deepEqual(state.messages, []);

  state = transitionOAuthAppState(state, { type: "signed_out" });
  assert.equal(state.phase, "signed_out");
  assert.equal(state.authenticated, false);
  assert.deepEqual(state.projects, []);
});

test("read-only submission is hidden unless the server explicitly grants it", () => {
  assert.equal(normalizeReadOnlySubmissionCapability({ capabilities: {} }), false);
  assert.equal(normalizeReadOnlySubmissionCapability({ capabilities: { readOnlyMessageSubmitAllowed: true, maxPermissionMode: "write" } }), false);
  assert.equal(normalizeReadOnlySubmissionCapability({ capabilities: { readOnlyMessageSubmitAllowed: true, maxPermissionMode: "readOnly" } }), true);

  assert.deepEqual(submissionControlState({ capability: false, authenticated: true, projectId: "p", agentId: "a" }), {
    visible: false,
    disabled: true,
    reason: "服务端未启用只读任务提交",
  });
  assert.deepEqual(submissionControlState({ capability: true, authenticated: true, projectId: "p", agentId: "a" }), {
    visible: true,
    disabled: false,
    reason: "",
  });
  assert.equal(submissionControlState({ capability: true, authenticated: true, projectId: "p", agentId: "a", busy: true }).disabled, true);

  const submission = buildReadOnlyMessageSubmission("p/1", "a 1", " inspect only ");
  assert.equal(submission.path, "/app/api/projects/p%2F1/agents/a%201/messages");
  assert.deepEqual(JSON.parse(submission.options.body), { content: "inspect only" });
  assert.equal("permissionMode" in JSON.parse(submission.options.body), false);
});

test("HTTP errors normalize 401, 403, 429, 5xx, and disabled OIDC", () => {
  assert.deepEqual(normalizeAppError({ status: 401, path: "/app/api/me" }), {
    kind: "unauthenticated", status: 401, code: "", path: "/app/api/me", retryAfter: "", message: "登录已失效，请重新登录。",
  });
  assert.equal(normalizeAppError({ status: 403 }).kind, "forbidden");
  const limited = normalizeAppError({ status: 429, headers: { "Retry-After": "30" } });
  assert.equal(limited.kind, "rate_limited");
  assert.equal(limited.retryAfter, "30");
  assert.match(limited.message, /30 秒/);
  assert.equal(normalizeAppError({ status: 502, body: "upstream token secret" }).message, "服务暂时不可用，请稍后重试。");
  const disabled = normalizeAppError({ status: 503, body: { error: { code: "oidc_not_configured", message: "OIDC is not configured" } } });
  assert.equal(disabled.kind, "oidc_disabled");
  assert.doesNotMatch(disabled.message, /configured/i);
});

test("BFF fetch always uses same-origin credentials and blocks token headers", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return response(200, { projects: [] });
  };
  const payload = await requestAppJSON("/app/api/projects", {}, fetchImpl);
  assert.deepEqual(payload, { projects: [] });
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.referrerPolicy, "same-origin");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers["X-Autoto-Token"], undefined);

  await assert.rejects(
    requestAppJSON("/app/api/projects", { headers: { Authorization: "Bearer secret" } }, fetchImpl),
    /Credential headers are not accepted/,
  );
  await assert.rejects(requestAppJSON("https://evil.test/app/api/projects", {}, fetchImpl), /must stay under/);
});

test("BFF fetch throws normalized rate-limit and server errors", async () => {
  await assert.rejects(
    requestAppJSON("/app/api/projects", {}, async () => response(429, { message: "slow down" }, { "retry-after": "9" })),
    (error) => error.kind === "rate_limited" && error.retryAfter === "9",
  );
  await assert.rejects(
    requestAppJSON("/app/auth/session", {}, async () => response(503, { code: "oidc_disabled" })),
    (error) => error.kind === "oidc_disabled",
  );
});
