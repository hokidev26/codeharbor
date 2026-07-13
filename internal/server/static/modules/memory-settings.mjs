import { $, escapeAttr, escapeHtml } from "./dom.mjs";

export function parseMemoryKeywords(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,\n\r]+/);
  const seen = new Set();
  return values.flatMap((entry) => String(entry ?? "").split(/[,\n\r]+/))
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

export function normalizeMemoryPayload(input = {}, { partial = false } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const payload = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  if (!partial || has("content")) payload.content = String(source.content ?? "").trim();
  if (!partial || has("keywords")) payload.keywords = parseMemoryKeywords(source.keywords);
  if (!partial || has("pinned")) payload.pinned = Boolean(source.pinned);
  if (partial && has("archived")) payload.archived = Boolean(source.archived);
  return payload;
}

export function normalizeMemoryItem(item = {}) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: String(source.id ?? ""),
    content: String(source.content ?? ""),
    keywords: parseMemoryKeywords(source.keywords),
    pinned: Boolean(source.pinned),
    archived: Boolean(source.archived ?? source.archivedAt),
    createdAt: String(source.createdAt ?? ""),
    updatedAt: String(source.updatedAt ?? ""),
  };
}

function memoryKeywordsText(keywords) {
  return parseMemoryKeywords(keywords).join(", ");
}

function renderMemoryStatus(item) {
  const badges = [];
  if (item.pinned) badges.push('<span class="settings-status-pill ok">已置顶</span>');
  if (item.archived) badges.push('<span class="settings-status-pill muted">已归档</span>');
  if (!badges.length) badges.push('<span class="settings-status-pill">普通</span>');
  return badges.join(" ");
}

export function renderMemoryItem(value, { saving = false } = {}) {
  const item = normalizeMemoryItem(value);
  const disabled = saving ? " disabled" : "";
  const timestamp = item.updatedAt || item.createdAt;
  return `
    <section class="settings-provider-section${item.archived ? " collapsed" : ""}" data-memory-card="${escapeAttr(item.id)}">
      <div class="settings-provider-section-head">
        <div>
          <div class="settings-provider-title">${escapeHtml(item.content || "空记忆")}</div>
          <div class="settings-provider-meta">${escapeHtml(timestamp ? `最近更新：${timestamp}` : `记忆 ID：${item.id || "未知"}`)}</div>
        </div>
        <div class="settings-action-row">${renderMemoryStatus(item)}</div>
      </div>
      <form class="settings-provider-config-form" data-memory-edit-form="${escapeAttr(item.id)}">
        <div class="settings-provider-form-grid">
          <label class="settings-form-span-2">记忆内容
            <textarea class="settings-field settings-textarea" rows="3" data-memory-content required${disabled}>${escapeHtml(item.content)}</textarea>
          </label>
          <label class="settings-form-span-2">关键词（逗号或换行分隔）
            <textarea class="settings-field settings-textarea" rows="2" data-memory-keywords placeholder="项目名, 技术栈, 偏好"${disabled}>${escapeHtml(memoryKeywordsText(item.keywords))}</textarea>
          </label>
        </div>
        <div class="settings-action-row settings-form-actions">
          <button class="settings-action-btn primary" type="submit"${disabled}>保存修改</button>
          <button class="settings-action-btn subtle" type="button" data-memory-pin="${escapeAttr(item.id)}"${disabled}>${item.pinned ? "取消置顶" : "置顶"}</button>
          <button class="settings-action-btn subtle" type="button" data-memory-archive="${escapeAttr(item.id)}"${disabled}>${item.archived ? "恢复" : "归档"}</button>
          <button class="settings-action-btn danger" type="button" data-memory-delete="${escapeAttr(item.id)}"${disabled}>删除</button>
        </div>
      </form>
    </section>
  `;
}

export function renderMemorySettingsContent(value = {}) {
  const state = {
    loading: Boolean(value.loading),
    error: String(value.error ?? ""),
    items: Array.isArray(value.items) ? value.items.map(normalizeMemoryItem) : [],
    query: String(value.query ?? ""),
    includeArchived: Boolean(value.includeArchived),
    saving: Boolean(value.saving),
  };
  const pinnedCount = state.items.filter((item) => item.pinned).length;
  const archivedCount = state.items.filter((item) => item.archived).length;
  const disabled = state.saving ? " disabled" : "";
  let list = "";
  if (state.loading) {
    list = '<div class="settings-empty-card">正在加载记忆…</div>';
  } else if (!state.items.length) {
    list = `<div class="settings-empty-card">${escapeHtml(state.query ? `没有匹配“${state.query}”的记忆。` : "还没有记忆，先在上方新增一条。")}</div>`;
  } else {
    list = state.items.map((item) => renderMemoryItem(item, { saving: state.saving })).join("");
  }

  return `
    <div class="settings-live-page memory-settings-page">
      <section class="settings-hero-card">
        <div>
          <div class="settings-hero-kicker">长期记忆</div>
          <div class="settings-hero-title">让重要上下文跨会话保留</div>
          <p>只有设置关键词的记忆会被动注入，每个 Agent 只注入一次</p>
        </div>
        <div class="settings-action-row">
          <button id="refreshMemoriesBtn" class="settings-action-btn subtle" type="button"${disabled}>刷新</button>
        </div>
      </section>
      <div class="settings-status-strip">
        <div><strong>${escapeHtml(String(state.items.length))}</strong><span>当前结果</span></div>
        <div><strong>${escapeHtml(String(pinnedCount))}</strong><span>已置顶</span></div>
        <div><strong>${escapeHtml(String(archivedCount))}</strong><span>已归档</span></div>
      </div>
      ${state.error ? `<div class="settings-inline-alert">${escapeHtml(state.error)}</div>` : ""}
      <section class="settings-provider-section highlighted">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">搜索记忆</div>
            <div class="settings-provider-meta">按内容或关键词筛选，并可选择包含已归档记忆。</div>
          </div>
        </div>
        <form id="memorySearchForm" class="settings-provider-config-form">
          <div class="settings-provider-form-grid">
            <label>搜索
              <input id="memorySearchInput" class="settings-field" value="${escapeAttr(state.query)}" placeholder="输入内容或关键词"${disabled} />
            </label>
            <label class="settings-checkbox-field">
              <input id="memoryIncludeArchived" type="checkbox" ${state.includeArchived ? "checked" : ""}${disabled} />
              <span>显示已归档记忆</span>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit"${disabled}>搜索</button>
            <button id="clearMemorySearchBtn" class="settings-action-btn subtle" type="button"${disabled}>清除</button>
          </div>
        </form>
      </section>
      <section class="settings-provider-section">
        <div class="settings-provider-section-head">
          <div>
            <div class="settings-provider-title">新增记忆</div>
            <div class="settings-provider-meta">内容会长期保存；至少设置一个关键词后，记忆才会在匹配时被动注入。</div>
          </div>
        </div>
        <form id="createMemoryForm" class="settings-provider-config-form">
          <div class="settings-provider-form-grid">
            <label class="settings-form-span-2">记忆内容
              <textarea id="newMemoryContent" class="settings-field settings-textarea" rows="3" required placeholder="例如：这个项目统一使用 pnpm。"${disabled}></textarea>
            </label>
            <label>关键词（逗号或换行分隔）
              <textarea id="newMemoryKeywords" class="settings-field settings-textarea" rows="2" placeholder="项目名, pnpm"${disabled}></textarea>
            </label>
            <label class="settings-checkbox-field">
              <input id="newMemoryPinned" type="checkbox"${disabled} />
              <span>创建后置顶</span>
            </label>
          </div>
          <div class="settings-action-row settings-form-actions">
            <button class="settings-action-btn primary" type="submit"${disabled}>${state.saving ? "保存中…" : "新增记忆"}</button>
          </div>
        </form>
      </section>
      <div class="settings-provider-cards">${list}</div>
    </div>
  `;
}

export function createMemorySettingsController({
  request,
  onChange,
  showError,
  showToast,
  confirmDelete,
} = {}) {
  if (typeof request !== "function") throw new TypeError("Memory settings request must be a function");
  const state = {
    loading: false,
    error: "",
    items: [],
    query: "",
    includeArchived: false,
    saving: false,
    requestSeq: 0,
  };
  let loaded = false;

  function emit() {
    onChange?.(getState());
  }

  function getState() {
    return {
      loading: state.loading,
      error: state.error,
      items: state.items.map((item) => ({ ...item, keywords: [...item.keywords] })),
      query: state.query,
      includeArchived: state.includeArchived,
      saving: state.saving,
      requestSeq: state.requestSeq,
    };
  }

  function setError(error) {
    state.error = error?.message || String(error || "请求失败");
    showError?.(error instanceof Error ? error : new Error(state.error));
  }

  async function load({ query = state.query, includeArchived = state.includeArchived } = {}) {
    state.query = String(query ?? "").slice(0, 200);
    state.includeArchived = Boolean(includeArchived);
    const seq = ++state.requestSeq;
    state.loading = true;
    state.error = "";
    emit();
    const params = new URLSearchParams({
      q: state.query,
      includeArchived: String(state.includeArchived),
    });
    try {
      const result = await request(`/api/memories?${params.toString()}`);
      if (seq !== state.requestSeq) return false;
      state.items = Array.isArray(result) ? result.map(normalizeMemoryItem) : [];
      state.error = "";
      loaded = true;
      return true;
    } catch (error) {
      if (seq !== state.requestSeq) return false;
      state.items = [];
      loaded = true;
      setError(error);
      return false;
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        emit();
      }
    }
  }

  async function runMutation(path, options, successMessage) {
    if (state.saving) return false;
    state.saving = true;
    state.error = "";
    state.requestSeq += 1;
    emit();
    try {
      await request(path, options);
      showToast?.(successMessage, "success");
      await load();
      return true;
    } catch (error) {
      setError(error);
      return false;
    } finally {
      state.saving = false;
      emit();
    }
  }

  async function create(input) {
    const payload = normalizeMemoryPayload(input);
    if (!payload.content) {
      const error = new Error("记忆内容不能为空");
      setError(error);
      emit();
      return false;
    }
    return runMutation("/api/memories", {
      method: "POST",
      body: JSON.stringify(payload),
    }, "记忆已新增。");
  }

  async function update(id, input) {
    const memoryID = String(id ?? "");
    const payload = normalizeMemoryPayload(input, { partial: true });
    if (Object.prototype.hasOwnProperty.call(payload, "content") && !payload.content) {
      const error = new Error("记忆内容不能为空");
      setError(error);
      emit();
      return false;
    }
    return runMutation(`/api/memories/${encodeURIComponent(memoryID)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, "记忆已更新。");
  }

  async function remove(id) {
    const memoryID = String(id ?? "");
    const confirm = confirmDelete || ((message) => typeof window === "undefined" || window.confirm(message));
    if (!confirm("确定删除这条记忆？此操作不可撤销。")) return false;
    return runMutation(`/api/memories/${encodeURIComponent(memoryID)}`, {
      method: "DELETE",
    }, "记忆已删除。");
  }

  function itemByID(id) {
    const memoryID = String(id ?? "");
    return state.items.find((item) => item.id === memoryID);
  }

  function bind() {
    $("memorySearchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      load({ query: $("memorySearchInput")?.value || "" });
    });
    $("clearMemorySearchBtn")?.addEventListener("click", () => load({ query: "" }));
    $("memoryIncludeArchived")?.addEventListener("change", (event) => load({ includeArchived: event.currentTarget.checked }));
    $("refreshMemoriesBtn")?.addEventListener("click", () => load());
    $("createMemoryForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      create({
        content: $("newMemoryContent")?.value || "",
        keywords: $("newMemoryKeywords")?.value || "",
        pinned: Boolean($("newMemoryPinned")?.checked),
      });
    });
    document.querySelectorAll("[data-memory-edit-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        update(form.dataset.memoryEditForm, {
          content: form.querySelector("[data-memory-content]")?.value || "",
          keywords: form.querySelector("[data-memory-keywords]")?.value || "",
        });
      });
    });
    document.querySelectorAll("[data-memory-pin]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = itemByID(button.dataset.memoryPin);
        if (item) update(item.id, { pinned: !item.pinned });
      });
    });
    document.querySelectorAll("[data-memory-archive]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = itemByID(button.dataset.memoryArchive);
        if (item) update(item.id, { archived: !item.archived });
      });
    });
    document.querySelectorAll("[data-memory-delete]").forEach((button) => {
      button.addEventListener("click", () => remove(button.dataset.memoryDelete));
    });
    if (!loaded && !state.loading) load();
  }

  return {
    bind,
    create,
    getState,
    load,
    remove,
    render: () => renderMemorySettingsContent(state),
    update,
  };
}
