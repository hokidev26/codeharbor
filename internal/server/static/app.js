(() => {
  const bootLocale = () => {
    try {
      for (const key of ["autoto.regional", "codeharbor.regional"]) {
        const saved = JSON.parse(globalThis.localStorage?.getItem?.(key) || "null");
        const locale = String(saved?.locale ?? saved?.language ?? saved?.lang ?? "").toLowerCase();
        if (locale === "zh-tw" || locale === "zh-hant" || locale.startsWith("zh-hant-") || locale === "zh-hk" || locale === "zh-mo") return "zh-TW";
        if (locale === "zh" || locale === "zh-cn" || locale === "zh-hans" || locale.startsWith("zh-hans-") || locale === "zh-sg") return "zh-CN";
        if (locale.startsWith("en")) return "en";
      }
    } catch {}
    return "zh-CN";
  };

  const showBootError = (error) => {
    console.error("Failed to load Autoto frontend", error);
    const message = error && error.message ? error.message : String(error || "unknown error");
    const target = document.getElementById("messages") || document.body;
    if (target) {
      const card = document.createElement("div");
      card.className = "empty-workspace-card";
      const title = document.createElement("div");
      title.className = "empty-workspace-title";
      title.textContent = {
        "zh-CN": "前端加载失败",
        "zh-TW": "前端載入失敗",
        en: "Frontend failed to load",
      }[bootLocale()];
      const text = document.createElement("div");
      text.className = "empty-workspace-text";
      text.textContent = message;
      card.append(title, text);
      target.prepend(card);
    }
  };

  import("./modules/app-main.mjs?v=legacy-ui-1-settings-dock-1-rail-1-about-1-i18n-static-2-conversation-fig2-1-scroll-skills-1-market-layout-1-native-codex-3-provider-console-1-compact-composer-5-custom-select-1-right-toolbar-1-sidebar-resize-2-permission-panel-1-mobile-header-composer-1-fast-mode-1-throughput-1-usage-history-1").catch(showBootError);
})();
