import { $ } from "./dom.mjs";

export function elementVisible(id) {
  const node = $(id);
  return Boolean(node && !node.classList.contains("hidden"));
}

export function isComposingInput(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

export function createUIShellController({
  state,
  clearSettingsSearchQuery,
  closeBackendsModal,
  closeDirectoryModal,
  closeSettingsModal,
  focusSettingsSearchInput,
  normalizedSettingsSearchQuery,
  openDirectoryChooser,
  renderProjects,
  resizeTerminal,
  showError,
} = {}) {
  function sidebarSettingsMenuOpen() {
    const menu = $("sidebarSettingsMenu");
    return Boolean(menu && !menu.classList.contains("hidden"));
  }

  function setSidebarSettingsMenuOpen(open) {
    const menu = $("sidebarSettingsMenu");
    const button = $("sidebarAccountBtn");
    if (!menu) return;
    menu.classList.toggle("hidden", !open);
    button?.setAttribute("aria-expanded", open ? "true" : "false");
    button?.classList.toggle("open", open);
  }

  function toggleSidebarSettingsMenu() {
    setSidebarSettingsMenuOpen(!sidebarSettingsMenuOpen());
  }

  function closeSidebarSettingsMenu() {
    setSidebarSettingsMenuOpen(false);
  }

  function handleSidebarSettingsMenuDocumentClick(event) {
    if (!sidebarSettingsMenuOpen()) return;
    if (event.target.closest?.(".sidebar-footer")) return;
    closeSidebarSettingsMenu();
  }

  function handleDirectoryShortcutClick(event) {
    const trigger = event.target.closest?.("[data-open-directory-shortcut]");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const path = trigger.dataset.openDirectoryShortcut === "current"
      ? (state.narrator?.cwd || state.project?.gitPath || "")
      : "";
    openDirectoryChooser(path, { trigger }).catch(showError);
  }

  function handleGlobalEscape(event) {
    if (event.key !== "Escape" || isComposingInput(event)) return;
    if (sidebarSettingsMenuOpen()) {
      closeSidebarSettingsMenu();
      event.preventDefault();
      return;
    }
    if (elementVisible("folderModal")) {
      closeDirectoryModal();
      event.preventDefault();
      return;
    }
    if (elementVisible("backendsModal")) {
      closeBackendsModal();
      event.preventDefault();
      return;
    }
    if (elementVisible("settingsModal")) {
      if (normalizedSettingsSearchQuery()) {
        clearSettingsSearchQuery({ focus: document.activeElement?.id === "settingsSearchInput" });
        event.preventDefault();
        return;
      }
      closeSettingsModal();
      event.preventDefault();
    }
  }

  function handleSettingsSearchShortcut(event) {
    if (!elementVisible("settingsModal") || isComposingInput(event)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      focusSettingsSearchInput({ select: true });
      event.preventDefault();
    }
  }

  function openMobileSidebar() {
    document.body.classList.add("mobile-sidebar-open");
  }

  function closeMobileSidebar() {
    closeSidebarSettingsMenu();
    document.body.classList.remove("mobile-sidebar-open");
  }

  function toggleMobileTerminal() {
    document.body.classList.toggle("mobile-terminal-open");
    if (document.body.classList.contains("mobile-terminal-open")) {
      $("terminalOutput").focus();
      resizeTerminal();
    }
  }

  function openProjectSearch({ focus = true } = {}) {
    $("projectSearchWrap")?.classList.remove("hidden");
    $("projectSearchToggleBtn")?.classList.add("active");
    if (focus) setTimeout(() => $("projectSearch")?.focus(), 30);
  }

  function closeProjectSearch({ clear = false } = {}) {
    if (clear) {
      state.projectQuery = "";
      if ($("projectSearch")) $("projectSearch").value = "";
      renderProjects();
    }
    $("projectSearchWrap")?.classList.add("hidden");
    $("projectSearchToggleBtn")?.classList.remove("active");
  }

  function toggleProjectSearch() {
    const wrap = $("projectSearchWrap");
    if (!wrap || wrap.classList.contains("hidden")) openProjectSearch();
    else closeProjectSearch({ clear: !state.projectQuery.trim() });
  }

  function focusMobileSearch() {
    openMobileSidebar();
    setTimeout(() => openProjectSearch(), 160);
  }

  return {
    closeMobileSidebar,
    closeProjectSearch,
    closeSidebarSettingsMenu,
    focusMobileSearch,
    handleDirectoryShortcutClick,
    handleGlobalEscape,
    handleSettingsSearchShortcut,
    handleSidebarSettingsMenuDocumentClick,
    openMobileSidebar,
    toggleMobileTerminal,
    toggleProjectSearch,
    toggleSidebarSettingsMenu,
  };
}
