import { $ } from "./dom.mjs";

export const sidebarWidthPreferenceKey = "autoto.ui.sessionSidebarWidth";
export const defaultSidebarWidth = 296;
export const minSidebarWidth = 220;
export const maxSidebarWidth = 420;
export const permissionMenuPrimaryValues = Object.freeze(["default", "acceptEdits", "bypassPermissions"]);
export const permissionMenuSecondaryValues = Object.freeze(["readOnly", "dontAsk"]);

export function orderPermissionMenuOptions(options = []) {
  const remaining = new Map([...options].map((option) => [option.value, option]));
  const ordered = [];
  [...permissionMenuPrimaryValues, ...permissionMenuSecondaryValues].forEach((value) => {
    const option = remaining.get(value);
    if (!option) return;
    ordered.push(option);
    remaining.delete(value);
  });
  remaining.forEach((option) => ordered.push(option));
  return ordered;
}

const permissionMenuIconMarkup = Object.freeze({
  default: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.5 7.8-7 10-4.5-2.2-7-5.5-7-10V6z"></path><path d="M9.5 12h5"></path></svg>',
  acceptEdits: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 5.3 4 4"></path><path d="M5 19h4l9.7-9.7a2.8 2.8 0 0 0-4-4L5 15z"></path><path d="M13 7 17 11"></path></svg>',
  bypassPermissions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.5 7.8-7 10-4.5-2.2-7-5.5-7-10V6z"></path><path d="m8.5 8.5 7 7"></path><path d="m15.5 8.5-7 7"></path></svg>',
  readOnly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
  dontAsk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V10"></path><path d="M11 10V5.5a1.5 1.5 0 0 1 3 0V10"></path><path d="M14 10V7a1.5 1.5 0 0 1 3 0v5"></path><path d="M8 10.5 6.7 9.2a1.7 1.7 0 0 0-2.4 2.4l4.2 5.1A5 5 0 0 0 12.4 19H14a5 5 0 0 0 5-5v-3.5a1.5 1.5 0 0 0-3 0"></path></svg>',
});

export function normalizeSidebarWidth(value, fallback = defaultSidebarWidth) {
  const parsed = Number.parseFloat(value);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : defaultSidebarWidth;
  if (!Number.isFinite(parsed)) return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(normalizedFallback)));
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(parsed)));
}

export function sidebarWidthFromPointer(clientX, sidebarLeft) {
  return normalizeSidebarWidth(Number(clientX) - Number(sidebarLeft));
}

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
  translate = (key) => key,
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
      ? (state.agent?.cwd || state.project?.gitPath || "")
      : "";
    const mobileViewport = window.matchMedia?.("(max-width: 760px)")?.matches;
    if (document.body.classList.contains("mobile-sidebar-open")) closeMobileSidebar();
    openDirectoryChooser(path, { trigger, preferNative: !mobileViewport }).catch(showError);
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

  function bindComposerSelectMenus() {
    const triggers = [...(document.querySelectorAll?.("[data-composer-select]") || [])];
    if (!triggers.length) return () => {};

    const menu = document.createElement("div");
    menu.id = "composerSelectPopover";
    menu.className = "composer-select-popover hidden";
    menu.setAttribute("role", "listbox");
    document.body.appendChild(menu);

    let active = null;
    const observers = [];
    const bindings = triggers.map((trigger) => {
      const select = $(trigger.dataset.composerSelect);
      const valueNode = trigger.querySelector(".composer-select-value");
      const label = document.querySelector(`label[for="${trigger.dataset.composerSelect}"]`);
      const binding = { trigger, select, valueNode, label };
      const sync = () => {
        const option = select?.selectedOptions?.[0] || select?.options?.[select?.selectedIndex];
        if (valueNode && option) valueNode.textContent = option.textContent?.trim() || option.value;
        trigger.disabled = Boolean(select?.disabled);
      };
      binding.sync = sync;
      sync();
      select?.addEventListener("change", sync);
      if (select && globalThis.MutationObserver) {
        const observer = new MutationObserver(sync);
        observer.observe(select, { childList: true, subtree: true, attributes: true });
        observers.push(observer);
      }
      return binding;
    }).filter(({ select }) => select);

    const close = ({ focus = false } = {}) => {
      if (!active) return;
      const trigger = active.trigger;
      active = null;
      menu.classList.add("hidden");
      menu.classList.remove("composer-permission-popover");
      menu.replaceChildren();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-controls");
      if (focus) trigger.focus();
    };

    const choose = (binding, option) => {
      binding.select.value = option.value;
      const EventConstructor = binding.select.ownerDocument?.defaultView?.Event || globalThis.Event;
      binding.select.dispatchEvent(new EventConstructor("change", { bubbles: true }));
      close({ focus: true });
    };

    const createOptionButton = (binding, option, { permission = false } = {}) => {
      const selected = option.value === binding.select.value;
      const button = document.createElement("button");
      button.type = "button";
      button.className = permission ? "composer-select-option composer-permission-option" : "composer-select-option";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.disabled = option.disabled;

      const label = document.createElement("span");
      label.textContent = option.textContent?.trim() || option.value;
      if (permission) {
        const main = document.createElement("span");
        main.className = "composer-permission-option-main";
        const icon = document.createElement("span");
        icon.className = "composer-permission-option-icon";
        icon.innerHTML = permissionMenuIconMarkup[option.value] || permissionMenuIconMarkup.default;
        main.append(icon, label);
        button.appendChild(main);
      } else {
        button.appendChild(label);
      }

      const check = document.createElement("span");
      check.className = "composer-select-option-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = selected ? "✓" : "";
      button.appendChild(check);
      button.addEventListener("click", () => choose(binding, option));
      return button;
    };

    const appendPermissionSafetyStatus = () => {
      const divider = document.createElement("div");
      divider.className = "composer-permission-divider";
      divider.setAttribute("aria-hidden", "true");

      const status = document.createElement("div");
      status.className = "composer-permission-safety-status";
      status.setAttribute("role", "note");
      const icon = document.createElement("span");
      icon.className = "composer-permission-option-icon composer-permission-safety-icon";
      icon.innerHTML = permissionMenuIconMarkup.default;
      const label = document.createElement("span");
      label.className = "composer-permission-safety-label";
      label.textContent = translate("chat.permissionGuard");
      const state = document.createElement("span");
      state.className = "composer-permission-safety-state";
      state.textContent = translate("workspaceSettings.enabled");
      status.append(icon, label, state);
      menu.append(divider, status);
    };

    const appendPermissionOptions = (binding) => {
      const options = orderPermissionMenuOptions([...binding.select.options].filter((option) => !option.hidden));
      const primary = options.filter((option) => permissionMenuPrimaryValues.includes(option.value));
      const secondary = options.filter((option) => !permissionMenuPrimaryValues.includes(option.value));
      primary.forEach((option) => menu.appendChild(createOptionButton(binding, option, { permission: true })));
      appendPermissionSafetyStatus();
      if (secondary.length) {
        const divider = document.createElement("div");
        divider.className = "composer-permission-divider";
        divider.setAttribute("aria-hidden", "true");
        menu.appendChild(divider);
        secondary.forEach((option) => menu.appendChild(createOptionButton(binding, option, { permission: true })));
      }
    };

    const positionMenu = (trigger) => {
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth;
      const selectId = trigger.dataset.composerSelect;
      const minimumWidth = selectId === "modelSelect" ? 260 : selectId === "permissionMode" ? 228 : 190;
      const desiredWidth = Math.max(rect.width, minimumWidth);
      const width = Math.min(desiredWidth, viewportWidth - 16);
      const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
      menu.style.bottom = `${Math.max(8, (globalThis.innerHeight || document.documentElement.clientHeight) - rect.top + 6)}px`;
    };

    const open = (binding) => {
      if (active?.trigger === binding.trigger) {
        close();
        return;
      }
      close();
      active = binding;
      const isPermissionMenu = binding.select.id === "permissionMode";
      menu.classList.toggle("composer-permission-popover", isPermissionMenu);
      const heading = document.createElement("div");
      heading.className = "composer-select-popover-title";
      heading.textContent = binding.label?.textContent?.trim() || binding.select.title || "";
      menu.appendChild(heading);
      if (isPermissionMenu) {
        appendPermissionOptions(binding);
      } else {
        [...binding.select.options]
          .filter((option) => !option.hidden)
          .forEach((option) => menu.appendChild(createOptionButton(binding, option)));
      }
      menu.classList.remove("hidden");
      positionMenu(binding.trigger);
      binding.trigger.setAttribute("aria-expanded", "true");
      binding.trigger.setAttribute("aria-controls", menu.id);
      menu.querySelector('[aria-selected="true"]')?.focus();
    };

    const triggerHandlers = bindings.map((binding) => {
      const handler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        open(binding);
      };
      binding.trigger.addEventListener("click", handler);
      return [binding.trigger, handler];
    });
    const handleDocumentPointer = (event) => {
      if (!active || menu.contains(event.target) || active.trigger.contains(event.target)) return;
      close();
    };
    const handleDocumentKey = (event) => {
      if (event.key === "Escape" && active) {
        close({ focus: true });
        event.preventDefault();
      }
    };
    const handleViewportChange = () => close();
    document.addEventListener("pointerdown", handleDocumentPointer);
    document.addEventListener("keydown", handleDocumentKey);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      close();
      triggerHandlers.forEach(([trigger, handler]) => trigger.removeEventListener("click", handler));
      bindings.forEach(({ select, sync }) => select.removeEventListener("change", sync));
      observers.forEach((observer) => observer.disconnect());
      document.removeEventListener("pointerdown", handleDocumentPointer);
      document.removeEventListener("keydown", handleDocumentKey);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      menu.remove();
    };
  }

  function bindSidebarResizer({ storage = globalThis.localStorage } = {}) {
    const shell = $("appShell");
    const sidebar = document.querySelector?.(".sidebar");
    const separator = $("sidebarResizeHandle");
    if (!shell || !sidebar || !separator) return () => {};

    let width = defaultSidebarWidth;
    let dragging = false;

    const persist = () => {
      try {
        storage?.setItem(sidebarWidthPreferenceKey, String(width));
      } catch {
        // Browser storage is optional; layout resizing still works in memory.
      }
    };
    const apply = (nextWidth, { save = false } = {}) => {
      width = normalizeSidebarWidth(nextWidth);
      shell.style.setProperty("--session-sidebar-width", `${width}px`);
      separator.setAttribute("aria-valuenow", String(width));
      if (save) persist();
      globalThis.requestAnimationFrame?.(() => resizeTerminal?.());
      return width;
    };
    try {
      width = normalizeSidebarWidth(storage?.getItem(sidebarWidthPreferenceKey));
    } catch {
      width = defaultSidebarWidth;
    }
    apply(width);

    const desktopLayout = () => !window.matchMedia?.("(max-width: 767px)")?.matches;
    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      separator.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-resizing");
      separator.releasePointerCapture?.(event?.pointerId);
      persist();
    };
    const handlePointerMove = (event) => {
      if (!dragging) return;
      apply(sidebarWidthFromPointer(event.clientX, sidebar.getBoundingClientRect().left));
      event.preventDefault();
    };
    const handlePointerDown = (event) => {
      if (!desktopLayout() || (event.button !== undefined && event.button !== 0)) return;
      dragging = true;
      separator.classList.add("is-dragging");
      document.body.classList.add("sidebar-resizing");
      separator.setPointerCapture?.(event.pointerId);
      handlePointerMove(event);
    };
    const handleKeyDown = (event) => {
      if (!desktopLayout()) return;
      const step = event.shiftKey ? 24 : 8;
      let nextWidth;
      if (event.key === "ArrowLeft") nextWidth = width - step;
      else if (event.key === "ArrowRight") nextWidth = width + step;
      else if (event.key === "Home") nextWidth = minSidebarWidth;
      else if (event.key === "End") nextWidth = maxSidebarWidth;
      else return;
      apply(nextWidth, { save: true });
      event.preventDefault();
    };
    const resetWidth = () => apply(defaultSidebarWidth, { save: true });

    separator.addEventListener("pointerdown", handlePointerDown);
    separator.addEventListener("keydown", handleKeyDown);
    separator.addEventListener("dblclick", resetWidth);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      finishDrag();
      separator.removeEventListener("pointerdown", handlePointerDown);
      separator.removeEventListener("keydown", handleKeyDown);
      separator.removeEventListener("dblclick", resetWidth);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }

  return {
    bindComposerSelectMenus,
    bindSidebarResizer,
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
