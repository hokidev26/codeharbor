import { escapeHtml } from "./dom.mjs";

export const settingsHelpCopySelector = "[data-settings-help-copy]";

export function normalizeSettingsHelpText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nodeText(node) {
  return normalizeSettingsHelpText(node?.textContent);
}

function isFormControl(node) {
  return ["INPUT", "SELECT", "TEXTAREA", "OPTION", "BUTTON", "CODE", "PRE"].includes(String(node?.tagName || "").toUpperCase());
}

function usableTitle(node, copyNode) {
  if (!node || node === copyNode || node.contains?.(copyNode) || node.matches?.(settingsHelpCopySelector) || isFormControl(node)) return "";
  return nodeText(node);
}

function previousTitle(node) {
  let candidate = node?.previousElementSibling || null;
  while (candidate) {
    const text = usableTitle(candidate, node);
    if (text) return text;
    candidate = candidate.previousElementSibling;
  }
  return "";
}

function childTitle(container, copyNode) {
  if (!container?.querySelector) return "";
  const selectors = [
    "[data-settings-help-heading]",
    "h1",
    "h2",
    "h3",
    "h4",
    ".settings-card-title",
    ".settings-provider-title",
    ".settings-hero-title",
    ".compact-settings-field > span",
    "legend",
    "strong",
  ];
  for (const selector of selectors) {
    const candidate = container.querySelector(selector);
    const text = usableTitle(candidate, copyNode);
    if (text) return text;
  }
  return "";
}

export function settingsHelpTitleForNode(node) {
  const explicit = normalizeSettingsHelpText(node?.getAttribute?.("data-settings-help-title"));
  if (explicit) return explicit;

  const siblingTitle = previousTitle(node);
  if (siblingTitle) return siblingTitle;

  const parent = node?.parentElement || null;
  const parentTitle = childTitle(parent, node);
  if (parentTitle) return parentTitle;

  const owner = node?.closest?.("label, button, section, article, fieldset, .settings-card, .settings-page-section, .compact-settings-section, .settings-data-row");
  const ownerTitle = childTitle(owner, node);
  if (ownerTitle) return ownerTitle;

  return "";
}

export function normalizeSettingsHelpEntries(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = normalizeSettingsHelpText(entry?.text);
    if (!text) continue;
    let title = normalizeSettingsHelpText(entry?.title);
    if (title === text) title = "";
    const identity = `${title}\u0000${text}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ title, text });
  }
  return result;
}

export function collectSettingsHelpEntries(root) {
  if (!root?.querySelectorAll) return [];
  const entries = [...root.querySelectorAll(settingsHelpCopySelector)].map((node) => ({
    title: settingsHelpTitleForNode(node),
    text: nodeText(node),
  }));
  return normalizeSettingsHelpEntries(entries);
}

export function renderSettingsHelpContent({ overview = "", entries = [], labels = {} } = {}) {
  const normalizedOverview = normalizeSettingsHelpText(overview);
  const normalizedEntries = normalizeSettingsHelpEntries(entries);
  const overviewMarkup = normalizedOverview
    ? `<section class="settings-help-overview"><h3>${escapeHtml(labels.overview || "Overview")}</h3><p>${escapeHtml(normalizedOverview)}</p></section>`
    : "";
  const detailsMarkup = normalizedEntries.length
    ? `<div class="settings-help-list">${normalizedEntries.map((entry) => `<section class="settings-help-entry">${entry.title ? `<h3>${escapeHtml(entry.title)}</h3>` : ""}<p>${escapeHtml(entry.text)}</p></section>`).join("")}</div>`
    : `<div class="settings-help-empty">${escapeHtml(labels.empty || "No additional details are available for this page.")}</div>`;
  return `${overviewMarkup}${detailsMarkup}`;
}

export function createSettingsHelpController({
  getRoot,
  trigger,
  panel,
  title,
  body,
  closeButton,
  backdrop,
  translate = (key) => key,
} = {}) {
  let context = { key: "", label: "", overview: "" };
  let focusReturn = null;

  function isOpen() {
    return Boolean(panel && !panel.classList.contains("hidden"));
  }

  function labels() {
    return {
      overview: translate("settings.pageHelp.overview"),
      empty: translate("settings.pageHelp.empty"),
    };
  }

  function render() {
    if (title) title.textContent = context.label || translate("settings.dialogTitle");
    if (body) {
      const root = typeof getRoot === "function" ? getRoot() : getRoot;
      body.innerHTML = renderSettingsHelpContent({
        overview: context.overview,
        entries: collectSettingsHelpEntries(root),
        labels: labels(),
      });
    }
  }

  function sync(next = {}) {
    context = {
      key: normalizeSettingsHelpText(next.key),
      label: normalizeSettingsHelpText(next.label),
      overview: normalizeSettingsHelpText(next.overview),
    };
    if (isOpen()) render();
  }

  function open() {
    if (!panel || !trigger) return false;
    focusReturn = globalThis.document?.activeElement || trigger;
    render();
    panel.classList.remove("hidden");
    panel.setAttribute("aria-hidden", "false");
    backdrop?.classList.remove("hidden");
    backdrop?.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    const schedule = globalThis.queueMicrotask || ((callback) => Promise.resolve().then(callback));
    schedule(() => panel.focus?.());
    return true;
  }

  function close({ restoreFocus = true } = {}) {
    if (!panel) return false;
    const wasOpen = isOpen();
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    backdrop?.classList.add("hidden");
    backdrop?.setAttribute("aria-hidden", "true");
    trigger?.setAttribute("aria-expanded", "false");
    const target = focusReturn || trigger;
    focusReturn = null;
    if (wasOpen && restoreFocus && target?.isConnected !== false) target?.focus?.();
    return wasOpen;
  }

  function handleKeydown(event) {
    if (!isOpen() || event?.key !== "Escape") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    close();
    return true;
  }

  function bind() {
    trigger?.addEventListener?.("click", () => isOpen() ? close() : open());
    closeButton?.addEventListener?.("click", () => close());
    backdrop?.addEventListener?.("click", () => close());
  }

  return { bind, close, handleKeydown, isOpen, open, render, sync };
}
