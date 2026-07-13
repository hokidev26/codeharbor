export class SettingsPanelRegistry {
  constructor() {
    this.panels = new Map();
  }

  register(key, definition = {}) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) throw new TypeError("Settings panel key must not be empty");
    if (this.panels.has(normalizedKey)) throw new Error(`Settings panel already registered: ${normalizedKey}`);
    if (typeof definition?.render !== "function") throw new TypeError(`Settings panel render must be a function: ${normalizedKey}`);
    if (definition.bind != null && typeof definition.bind !== "function") {
      throw new TypeError(`Settings panel bind must be a function: ${normalizedKey}`);
    }

    const panel = Object.freeze({
      render: definition.render,
      ...(definition.bind ? { bind: definition.bind } : {}),
    });
    this.panels.set(normalizedKey, panel);
    return this;
  }

  resolve(key) {
    return this.panels.get(String(key ?? "").trim());
  }
}

export function createSettingsPanelRegistry() {
  return new SettingsPanelRegistry();
}
