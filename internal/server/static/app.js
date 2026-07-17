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

  import("./modules/app-main.mjs?v=legacy-ui-1-settings-dock-1-rail-1-about-1-i18n-static-2-conversation-fig2-1-scroll-skills-1-market-layout-1-native-codex-3-provider-console-1-compact-composer-5-custom-select-1-right-toolbar-1-sidebar-resize-2-permission-panel-1-mobile-header-composer-1-fast-mode-1-throughput-1-usage-history-1-workbench-2-rail-compact-1-message-editing-1-message-thread-1-mode-boundaries-1-settings-shadcn-1-tool-activity-1-folder-picker-remote-2-provider-model-discovery-1-conversation-switch-1-user-message-fit-1-plan-mode-2-background-tasks-2-remote-access-1-mobile-short-labels-1-task-toolbar-2-provider-account-wide-1-model-compact-1-codex-export-1-settings-flat-1-aggregates-1-user-message-left-1-workbench-header-1-mobile-toolbar-right-3-icon-rail-1-codex-import-open-1-terminal-actions-compact-1-users-panel-removed-1-remote-control-full-1-about-brand-license-1-security-banner-hidden-1-workbench-title-edit-1-provider-create-page-1-codex-browser-login-1").catch(showBootError);
})();
