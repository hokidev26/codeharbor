const SKILL_SCOPES = new Set(["global", "project", "workspace"]);

export function normalizeSkillScope(scope) {
  const value = String(scope || "global").trim().toLowerCase();
  return SKILL_SCOPES.has(value) ? value : "global";
}

// Context keys deliberately include the owning ID. This prevents a response
// for one project/workline being rendered after the user switches context.
export function normalizeSkillContext(context = {}) {
  const scope = normalizeSkillScope(context.scope);
  const projectId = String(context.projectId || "").trim();
  const worklineId = String(context.worklineId || "").trim();
  if (scope === "project") return { scope, projectId, worklineId: "" };
  if (scope === "workspace") return { scope, projectId: "", worklineId };
  return { scope: "global", projectId: "", worklineId: "" };
}

export function skillContextKey(context) {
  const normalized = normalizeSkillContext(context);
  if (normalized.scope === "project") return `project:${normalized.projectId || "none"}`;
  if (normalized.scope === "workspace") return `workspace:${normalized.worklineId || "none"}`;
  return "global";
}

export function skillContextQuery(context, extra = {}) {
  const normalized = normalizeSkillContext(context);
  const params = new URLSearchParams({ scope: normalized.scope });
  if (normalized.scope === "project" && normalized.projectId) params.set("projectId", normalized.projectId);
  if (normalized.scope === "workspace" && normalized.worklineId) params.set("worklineId", normalized.worklineId);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") params.set(key, String(value));
  });
  return params;
}

export function buildSkillsV2URL(context, { cursor = "", limit } = {}) {
  const params = skillContextQuery(context, { cursor, limit });
  return `/api/v2/skills?${params.toString()}`;
}

export function buildSkillDetailV2URL(id, context) {
  return `/api/v2/skills/${encodeURIComponent(id)}?${skillContextQuery(context).toString()}`;
}

export function buildSkillRevisionsV2URL(id, context, { cursor = "", limit } = {}) {
  const params = skillContextQuery(context, { cursor, limit });
  return `/api/v2/skills/${encodeURIComponent(id)}/revisions?${params.toString()}`;
}

export function buildSkillRevisionDetailV2URL(id, revisionId, context) {
  return `/api/v2/skills/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}?${skillContextQuery(context).toString()}`;
}

export function buildSkillRevisionRestoreV2URL(id, revisionId, context) {
  return `/api/v2/skills/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore?${skillContextQuery(context).toString()}`;
}

export function buildEffectiveSkillsV2URL(agentId, context) {
  return `/api/v2/agents/${encodeURIComponent(agentId)}/skills/effective?${skillContextQuery(context).toString()}`;
}

export function normalizeSkillsPage(response = {}) {
  const source = Array.isArray(response) ? { items: response } : (response || {});
  return {
    items: Array.isArray(source.items) ? source.items : [],
    nextCursor: String(source.nextCursor || ""),
    snapshotSequence: source.snapshotSequence ?? null,
  };
}

export function createSkillRestorePayload(revision, { expectedUpdatedAt, acknowledgeRisk = false } = {}) {
  const revisionNo = Number(revision?.revisionNo ?? revision?.revision);
  if (!Number.isSafeInteger(revisionNo) || revisionNo < 1) throw new Error("技能修订版本缺失，不能恢复");
  const updatedAt = String(expectedUpdatedAt || "").trim();
  if (!updatedAt) throw new Error("技能当前版本时间戳缺失，不能安全恢复");
  return { revisionNo, expectedUpdatedAt: updatedAt, acknowledgeRisk: Boolean(acknowledgeRisk) };
}

export function loadServerSkillsWithFallback(load, previousSkills = [], { hadServerData = false } = {}) {
  const previous = Array.isArray(previousSkills) ? previousSkills : [];
  return Promise.resolve().then(load).then((skills) => ({ skills: Array.isArray(skills) ? skills : [], status: "ready", error: "" })).catch((err) => ({
    skills: previous,
    status: hadServerData || previous.length ? "stale" : "error",
    error: err?.message || String(err),
  }));
}

// Returns false for a stale completion, making state writes safe when callers
// deliberately issue a newer refresh before an earlier request resolves.
export function applyServerSkillsLoadResult(state, seq, result) {
  if (seq !== state.serverSkillsLoadSeq) return false;
  state.serverSkills = Array.isArray(result?.skills) ? result.skills : [];
  state.serverSkillsStatus = result?.status || "error";
  state.serverSkillsError = result?.error || "";
  return true;
}

export function isOptimisticSkillConflict(error) {
  const detail = String(error?.body?.error || error?.message || "");
  return error?.status === 409 && /updated by another client/i.test(detail);
}

export async function hydrateServerSkillSummaries(summaries, loadDetail, concurrency = 4) {
  const items = Array.isArray(summaries) ? summaries.map((item) => ({ ...item, detailLoaded: false })) : [];
  const enabledIndexes = items.map((item, index) => item?.enabled ? index : -1).filter((index) => index >= 0);
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), enabledIndexes.length);
  let next = 0;
  async function worker() {
    while (next < enabledIndexes.length) {
      const index = enabledIndexes[next++];
      const summary = items[index];
      try {
        const detail = await loadDetail(summary.id);
        items[index] = { ...summary, ...detail, detailLoaded: true, detailError: "" };
      } catch (err) {
        // Retain the authoritative command shadow so it still reserves its
        // name, but intentionally omit the prompt to fail closed.
        items[index] = { ...summary, detailLoaded: false, detailError: err?.message || String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return items;
}

function phaseBRoot(state) {
  if (!state.skillsV2 || typeof state.skillsV2 !== "object") state.skillsV2 = { contexts: {}, effective: {} };
  if (!state.skillsV2.contexts || typeof state.skillsV2.contexts !== "object") state.skillsV2.contexts = {};
  if (!state.skillsV2.effective || typeof state.skillsV2.effective !== "object") state.skillsV2.effective = {};
  return state.skillsV2;
}

export function ensureSkillsContextState(state, context) {
  const root = phaseBRoot(state);
  const normalized = normalizeSkillContext(context);
  const key = skillContextKey(normalized);
  if (!root.contexts[key]) {
    root.contexts[key] = {
      context: normalized, items: [], nextCursor: "", snapshotSequence: null,
      status: "idle", error: "", requestSequence: 0, revisions: {}, drawer: null,
    };
  }
  return root.contexts[key];
}

// A reusable v2 controller. It is intentionally independent from app-main so
// callers can choose their own renderer while retaining context isolation and
// fail-closed detail semantics.
export function createSkillsPhaseBController({ state = {}, api, getContext = () => ({}), pageSize = 50, onChange } = {}) {
  if (typeof api !== "function") throw new Error("createSkillsPhaseBController requires api");
  const changed = () => onChange?.();
  const currentContext = (override) => normalizeSkillContext(override || getContext() || {});

  async function load(contextOverride, { append = false } = {}) {
    const context = currentContext(contextOverride);
    const bucket = ensureSkillsContextState(state, context);
    const cursor = append ? bucket.nextCursor : "";
    if (append && !cursor) return bucket;
    const requestSequence = ++bucket.requestSequence;
    bucket.status = append ? "loading-more" : "loading";
    bucket.error = "";
    changed();
    try {
      const page = normalizeSkillsPage(await api(buildSkillsV2URL(context, { cursor, limit: pageSize })));
      // A scope switch / newer refresh cannot write into the active bucket.
      if (requestSequence !== bucket.requestSequence || skillContextKey(bucket.context) !== skillContextKey(context)) return bucket;
      bucket.items = append ? [...bucket.items, ...page.items] : page.items;
      bucket.nextCursor = page.nextCursor;
      bucket.snapshotSequence = page.snapshotSequence;
      bucket.status = "ready";
      bucket.error = "";
    } catch (error) {
      if (requestSequence === bucket.requestSequence) {
        bucket.status = bucket.items.length ? "stale" : "error";
        bucket.error = error?.message || String(error);
      }
      throw error;
    } finally {
      changed();
    }
    return bucket;
  }

  async function loadMore(context) { return load(context, { append: true }); }

  async function loadDetail(id, contextOverride) {
    const context = currentContext(contextOverride);
    const bucket = ensureSkillsContextState(state, context);
    const index = bucket.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("服务端技能不存在");
    const before = bucket.items[index];
    try {
      const detail = await api(buildSkillDetailV2URL(id, context));
      const latestIndex = bucket.items.findIndex((item) => item.id === id);
      if (latestIndex >= 0) bucket.items[latestIndex] = { ...bucket.items[latestIndex], ...detail, detailLoaded: true, detailError: "" };
      changed();
      return bucket.items[latestIndex];
    } catch (error) {
      // Do not retain a previously loaded prompt after a failed v2 detail
      // refresh. The authoritative item still shadows local command names.
      const latestIndex = bucket.items.findIndex((item) => item.id === id);
      if (latestIndex >= 0) {
        const { prompt, ...summary } = bucket.items[latestIndex];
        bucket.items[latestIndex] = { ...summary, ...before, prompt: undefined, detailLoaded: false, detailError: error?.message || String(error) };
      }
      changed();
      throw error;
    }
  }

  async function loadRevisions(id, contextOverride, { append = false } = {}) {
    const context = currentContext(contextOverride);
    const bucket = ensureSkillsContextState(state, context);
    const revisionState = bucket.revisions[id] || { items: [], nextCursor: "", snapshotSequence: null, status: "idle", error: "", requestSequence: 0 };
    bucket.revisions[id] = revisionState;
    const cursor = append ? revisionState.nextCursor : "";
    if (append && !cursor) return revisionState;
    const requestSequence = ++revisionState.requestSequence;
    revisionState.status = append ? "loading-more" : "loading";
    revisionState.error = "";
    changed();
    try {
      const page = normalizeSkillsPage(await api(buildSkillRevisionsV2URL(id, context, { cursor, limit: pageSize })));
      if (requestSequence !== revisionState.requestSequence) return revisionState;
      revisionState.items = append ? [...revisionState.items, ...page.items] : page.items;
      revisionState.nextCursor = page.nextCursor;
      revisionState.snapshotSequence = page.snapshotSequence;
      revisionState.status = "ready";
    } catch (error) {
      if (requestSequence === revisionState.requestSequence) {
        revisionState.status = revisionState.items.length ? "stale" : "error";
        revisionState.error = error?.message || String(error);
      }
      throw error;
    } finally {
      changed();
    }
    return revisionState;
  }

  async function loadRevisionDetail(id, revisionId, contextOverride) {
    const context = currentContext(contextOverride);
    return api(buildSkillRevisionDetailV2URL(id, revisionId, context));
  }

  async function restoreRevision(id, revision, contextOverride, options = {}) {
    const context = currentContext(contextOverride);
    const bucket = ensureSkillsContextState(state, context);
    const payload = createSkillRestorePayload(revision, {
      expectedUpdatedAt: options.expectedUpdatedAt,
      acknowledgeRisk: options.acknowledgeRisk,
    });
    const restored = await api(buildSkillRevisionRestoreV2URL(id, payload.revisionNo, context), {
      method: "POST", body: JSON.stringify(payload),
    });
    const index = bucket.items.findIndex((item) => item.id === id);
    if (index >= 0) bucket.items[index] = { ...bucket.items[index], ...restored, detailLoaded: true, detailError: "" };
    changed();
    return restored;
  }

  async function loadEffective(agentId, contextOverride) {
    const context = currentContext(contextOverride);
    const key = `${String(agentId || "")}:${skillContextKey(context)}`;
    const root = phaseBRoot(state);
    const previous = root.effective[key] || { items: [], status: "idle", error: "", requestSequence: 0 };
    root.effective[key] = previous;
    const requestSequence = ++previous.requestSequence;
    previous.status = "loading";
    previous.error = "";
    changed();
    try {
      const response = await api(buildEffectiveSkillsV2URL(agentId, context));
      if (requestSequence === previous.requestSequence) {
        previous.items = normalizeSkillsPage(response).items;
        previous.status = "ready";
      }
      return previous.items;
    } catch (error) {
      if (requestSequence === previous.requestSequence) {
        previous.status = previous.items.length ? "stale" : "error";
        previous.error = error?.message || String(error);
      }
      throw error;
    } finally {
      changed();
    }
  }

  return { ensureContext: (context) => ensureSkillsContextState(state, currentContext(context)), load, loadMore, loadDetail, loadRevisions, loadRevisionDetail, restoreRevision, loadEffective };
}
