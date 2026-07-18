import { appearanceThemeForPreset, normalizeAppearanceThemePreset } from "./preferences-data.mjs";

const packageThemeIDPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const themeStylesheetLinkID = "autotoThemeStylesheet";

function safeThemeURL(value) {
  const path = String(value || "").trim();
  return path.startsWith("/themes/") ? path : "";
}

export function normalizeThemeRecord(value = {}) {
  const id = String(value.id || "").trim().toLowerCase();
  const stylesheetUrl = safeThemeURL(value.stylesheetUrl || value.cssUrl);
  if (id.length > 63 || !packageThemeIDPattern.test(id) || !stylesheetUrl) return null;
  const source = value.source === "local" ? "local" : "bundled";
  const revision = String(value.revision || "").trim().slice(0, 128);
  return {
    id,
    name: String(value.name || id).trim().slice(0, 120) || id,
    version: String(value.version || "").trim().slice(0, 64),
    description: String(value.description || "").trim().slice(0, 500),
    author: String(value.author || "").trim().slice(0, 120),
    colorScheme: value.colorScheme === "dark" ? "dark" : "light",
    source,
    revision,
    stylesheetUrl,
    previewUrl: safeThemeURL(value.previewUrl),
    deletable: source === "local" && value.deletable !== false,
  };
}

export function normalizeThemeCatalog(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.themes;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows.reduce((themes, row) => {
    const theme = normalizeThemeRecord(row);
    if (!theme || seen.has(theme.id)) return themes;
    seen.add(theme.id);
    themes.push(theme);
    return themes;
  }, []);
}

function presetFromPreferences(prefs = {}) {
  return normalizeAppearanceThemePreset(prefs.themePreset)
    || normalizeAppearanceThemePreset(prefs.themeRef?.id)
    || "light";
}

function fallbackThemeTranslation(key, values = {}) {
  const messages = {
    "appearance.themeMissing": `Theme ${values.id || ""} is missing. Autoto is temporarily using the base palette.`,
    "appearance.themeChooseFile": "Choose an Autoto theme package first.",
    "appearance.themeNotFound": `Theme ${values.id || ""} was not found.`,
    "appearance.themeBundledDeleteDenied": "Bundled themes cannot be deleted.",
    "appearance.themeEnvironmentUnsupported": "This environment cannot load theme stylesheets.",
    "appearance.themeLoadTimeout": "Theme stylesheet loading timed out.",
    "appearance.themeRequestFailed": "Theme stylesheet request failed.",
    "appearance.themeLoadFailed": `Theme ${values.name || ""} failed to load: ${values.error || ""}`,
  };
  return messages[key] || key;
}

export function setThemePageContext(value, documentRef = globalThis.document) {
  const body = documentRef?.body;
  if (!body?.dataset) return;
  const context = String(value || "").trim();
  if (context) body.dataset.themePage = context;
  else delete body.dataset.themePage;
}

export class ThemeManager {
  constructor({
    api,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
    showToast,
    translate,
    loadTimeoutMs = 8000,
  } = {}) {
    if (typeof api !== "function") throw new TypeError("ThemeManager requires an api function");
    this.api = api;
    this.document = documentRef;
    this.window = windowRef || globalThis;
    this.showToast = showToast;
    this.translate = typeof translate === "function" ? translate : fallbackThemeTranslation;
    this.loadTimeoutMs = loadTimeoutMs;
    this.listeners = new Set();
    this.preferenceAdapter = null;
    this.catalogPromise = null;
    this.catalogSequence = 0;
    this.stylesheetSequence = 0;
    this.missingNoticeID = "";
    this.state = {
      status: "idle",
      themes: [],
      error: "",
      activeThemeID: "",
      activeRevision: "",
      missingThemeID: "",
      importing: false,
      deletingThemeID: "",
    };
  }

  setPreferenceAdapter({ currentAppearancePreferences, saveAppearancePreferences } = {}) {
    this.preferenceAdapter = {
      currentAppearancePreferences,
      saveAppearancePreferences,
    };
  }

  snapshot() {
    return {
      ...this.state,
      themes: this.state.themes.map((theme) => ({ ...theme })),
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async loadCatalog({ force = false } = {}) {
    if (!force && this.catalogPromise) return this.catalogPromise;
    if (!force && this.state.status === "ready") return this.state.themes;
    const sequence = ++this.catalogSequence;
    this.updateState({ status: "loading", error: "" });
    const request = this.api("/api/themes")
      .then((payload) => {
        const themes = normalizeThemeCatalog(payload);
        if (sequence === this.catalogSequence) {
          this.updateState({ status: "ready", themes, error: "" });
        }
        return themes;
      })
      .catch((error) => {
        if (sequence === this.catalogSequence) {
          this.updateState({ status: "error", error: String(error?.message || error || "Theme catalog failed") });
        }
        throw error;
      })
      .finally(() => {
        if (this.catalogPromise === request) this.catalogPromise = null;
      });
    this.catalogPromise = request;
    return request;
  }

  findTheme(id) {
    const normalized = String(id || "").trim().toLowerCase();
    return this.state.themes.find((theme) => theme.id === normalized) || null;
  }

  async initialize(prefs) {
    try {
      await this.loadCatalog();
    } catch {
      this.applyPresetFallback(presetFromPreferences(prefs));
      return false;
    }
    return this.applyPreference(prefs, { notifyMissing: false });
  }

  async applyPreference(prefs = {}, { notifyMissing = true } = {}) {
    if (prefs.themeRef?.kind !== "package") {
      this.applyPresetFallback(presetFromPreferences(prefs));
      return true;
    }
    if (this.state.status === "idle" || this.state.status === "error") {
      try {
        await this.loadCatalog({ force: this.state.status === "error" });
      } catch {
        this.applyPresetFallback(presetFromPreferences(prefs));
        return false;
      }
    } else if (this.state.status === "loading" && this.catalogPromise) {
      try {
        await this.catalogPromise;
      } catch {
        this.applyPresetFallback(presetFromPreferences(prefs));
        return false;
      }
    }
    const theme = this.findTheme(prefs.themeRef.id);
    if (!theme) {
      const missingThemeID = String(prefs.themeRef.id || "").trim();
      this.applyPresetFallback(presetFromPreferences(prefs), { missingThemeID });
      if (notifyMissing && missingThemeID && this.missingNoticeID !== missingThemeID) {
        this.missingNoticeID = missingThemeID;
        this.showToast?.(this.translate("appearance.themeMissing", { id: missingThemeID }), "warn");
      }
      return false;
    }
    try {
      const applied = await this.loadThemeStylesheet(theme);
      if (!applied) return false;
      this.missingNoticeID = "";
      return true;
    } catch (error) {
      this.applyPresetFallback(presetFromPreferences(prefs), { missingThemeID: theme.id });
      if (notifyMissing) this.showToast?.(this.translate("appearance.themeLoadFailed", { name: theme.name, error: String(error?.message || error) }), "error");
      return false;
    }
  }

  async activateTheme(id) {
    if (this.state.status !== "ready") await this.loadCatalog({ force: this.state.status === "error" });
    const theme = this.findTheme(id);
    if (!theme) throw new Error(this.translate("appearance.themeNotFound", { id }));
    const applied = await this.loadThemeStylesheet(theme);
    if (!applied) return null;
    const current = this.preferenceAdapter?.currentAppearancePreferences?.() || {};
    this.preferenceAdapter?.saveAppearancePreferences?.({
      ...current,
      themeRef: {
        kind: "package",
        id: theme.id,
        revision: theme.revision,
        colorScheme: theme.colorScheme,
      },
      themePreset: theme.colorScheme,
      theme: theme.colorScheme,
    }, { notify: true });
    return theme;
  }

  async importTheme(file, { replace = false } = {}) {
    if (!file) throw new Error(this.translate("appearance.themeChooseFile"));
    const form = new FormData();
    form.set("file", file);
    if (replace) form.set("replace", "true");
    this.updateState({ importing: true, error: "" });
    try {
      const result = await this.api("/api/themes/import", { method: "POST", body: form });
      await this.loadCatalog({ force: true });
      return result?.theme || result;
    } finally {
      this.updateState({ importing: false });
    }
  }

  async deleteTheme(id) {
    const theme = this.findTheme(id);
    if (!theme) throw new Error(this.translate("appearance.themeNotFound", { id }));
    if (!theme.deletable) throw new Error(this.translate("appearance.themeBundledDeleteDenied"));
    this.updateState({ deletingThemeID: theme.id, error: "" });
    try {
      await this.api(`/api/themes/${encodeURIComponent(theme.id)}`, { method: "DELETE" });
      const current = this.preferenceAdapter?.currentAppearancePreferences?.() || {};
      if (current.themeRef?.kind === "package" && current.themeRef.id === theme.id) {
        this.preferenceAdapter?.saveAppearancePreferences?.({
          ...current,
          themeRef: { kind: "preset", id: "light" },
          themePreset: "light",
          theme: "light",
        }, { notify: true });
      }
      await this.loadCatalog({ force: true });
    } finally {
      this.updateState({ deletingThemeID: "" });
    }
  }

  applyPresetFallback(preset = "light", { missingThemeID = "" } = {}) {
    this.stylesheetSequence += 1;
    const normalizedPreset = normalizeAppearanceThemePreset(preset) || "light";
    const body = this.document?.body;
    if (body?.dataset) {
      body.dataset.themePreset = normalizedPreset;
      delete body.dataset.autotoTheme;
      delete body.dataset.themeRevision;
      delete body.dataset.themeSource;
    }
    body?.classList?.toggle?.("theme-light", true);
    body?.classList?.toggle?.("theme-dark", appearanceThemeForPreset(normalizedPreset) === "dark");
    const currentLink = this.document?.getElementById?.(themeStylesheetLinkID);
    currentLink?.remove?.();
    this.updateState({
      activeThemeID: "",
      activeRevision: "",
      missingThemeID,
    });
  }

  async loadThemeStylesheet(theme) {
    if (this.state.activeThemeID === theme.id
      && this.state.activeRevision === theme.revision
      && this.document?.getElementById?.(themeStylesheetLinkID)) {
      return true;
    }
    const sequence = ++this.stylesheetSequence;
    const link = this.document?.createElement?.("link");
    if (!link) throw new Error(this.translate("appearance.themeEnvironmentUnsupported"));
    link.rel = "stylesheet";
    link.href = theme.stylesheetUrl;
    link.dataset.autotoThemeCandidate = theme.id;
    const currentLink = this.document.getElementById?.(themeStylesheetLinkID);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.window?.clearTimeout?.(timeout);
        link.onload = null;
        link.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const timeout = this.window?.setTimeout?.(
        () => finish(new Error(this.translate("appearance.themeLoadTimeout"))),
        this.loadTimeoutMs,
      );
      link.onload = () => finish();
      link.onerror = () => finish(new Error(this.translate("appearance.themeRequestFailed")));
      this.document.head?.appendChild?.(link);
    }).catch((error) => {
      link.remove?.();
      throw error;
    });
    if (sequence !== this.stylesheetSequence) {
      link.remove?.();
      return false;
    }
    currentLink?.remove?.();
    link.id = themeStylesheetLinkID;
    delete link.dataset.autotoThemeCandidate;
    const body = this.document.body;
    if (body?.dataset) {
      body.dataset.autotoTheme = theme.id;
      body.dataset.themeRevision = theme.revision;
      body.dataset.themeSource = theme.source;
      body.dataset.themePreset = theme.colorScheme;
    }
    body?.classList?.toggle?.("theme-light", true);
    body?.classList?.toggle?.("theme-dark", theme.colorScheme === "dark");
    this.updateState({
      status: "ready",
      activeThemeID: theme.id,
      activeRevision: theme.revision,
      missingThemeID: "",
      error: "",
    });
    return true;
  }
}

export function createThemeManager(options) {
  return new ThemeManager(options);
}
