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

export function compactComposerModelLabel(value, fallback = "模型") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  let model = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  model = model
    .replace(/^claude-/i, "")
    .replace(/-(latest|\d{8})$/i, "")
    .replace(/-(\d+)-(\d+)(?=$|-)/, "-$1.$2")
    .trim();
  if (!model) return fallback;
  const anthropicFamily = model.match(/^(sonnet|opus|haiku)/i)?.[1];
  if (anthropicFamily) return anthropicFamily.toLowerCase();
  const gptFamily = model.match(/^(gpt[-_.]?\d+(?:[-_.]\d+)?)/i)?.[1];
  if (gptFamily) return gptFamily.replace(/_/g, "-");
  if (model.length <= 9) return model;
  const family = model.split("-")[0];
  if (family.length >= 4 && family.length <= 9) return family;
  return `${model.slice(0, 8)}…`;
}

export function modelOptionPresentation(value, label) {
  const rawValue = String(value || "").trim();
  const rawLabel = String(label || "").trim();
  const separator = rawValue.indexOf(":");
  const provider = separator > 0 ? rawValue.slice(0, separator).trim() : "";
  const model = separator >= 0 ? rawValue.slice(separator + 1).trim() : rawValue;
  return {
    name: rawLabel || model || rawValue || "模型",
    provider,
  };
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
  openModelSettings = () => {},
  renderProjects,
  resizeTerminal,
  showError,
  translate = (key) => key,
} = {}) {
  let settingsDialogFocusReturn = null;

  function isVisibleDialog(node) {
    if (!node || node.classList?.contains("hidden") || node.getAttribute?.("aria-hidden") === "true" || node.closest?.("[hidden], .hidden, [aria-hidden=\"true\"]")) return false;
    const view = node.ownerDocument?.defaultView || globalThis.window;
    const style = view?.getComputedStyle?.(node);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function settingsDialogHasNestedModal() {
    const dialog = $("settingsModal");
    if (!isVisibleDialog(dialog)) return false;
    return [...(dialog.querySelectorAll?.('[role="dialog"][aria-modal="true"]') || [])]
      .some((node) => node !== dialog && isVisibleDialog(node));
  }

  function focusableDialogElements(dialog) {
    if (!dialog?.querySelectorAll) return [];
    return [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => isVisibleDialog(node) && !node.closest?.(".hidden, [aria-hidden=\"true\"]"));
  }

  function focusSettingsDialogInitialTarget() {
    const dialog = $("settingsModal");
    if (!isVisibleDialog(dialog) || settingsDialogHasNestedModal()) return;
    const input = $("settingsSearchInput");
    const [first] = focusableDialogElements(dialog);
    (isVisibleDialog(input) ? input : first || dialog).focus?.();
  }

  function beginSettingsDialogFocus(trigger = document.activeElement) {
    settingsDialogFocusReturn = trigger?.isConnected === false ? null : trigger || null;
    const schedule = globalThis.queueMicrotask || ((callback) => Promise.resolve().then(callback));
    schedule(focusSettingsDialogInitialTarget);
  }

  function restoreSettingsDialogFocus() {
    const target = settingsDialogFocusReturn;
    settingsDialogFocusReturn = null;
    if (target?.isConnected !== false) target?.focus?.();
  }

  function handleSettingsDialogKeydown(event) {
    if (event.key !== "Tab" || settingsDialogHasNestedModal()) return;
    const dialog = $("settingsModal");
    if (!isVisibleDialog(dialog)) return;
    const items = focusableDialogElements(dialog);
    if (!items.length) {
      event.preventDefault();
      dialog.focus?.();
      return;
    }
    const current = document.activeElement;
    const index = items.indexOf(current);
    const next = event.shiftKey
      ? items[index <= 0 ? items.length - 1 : index - 1]
      : items[index === items.length - 1 ? 0 : index + 1];
    if (index === -1 || next) {
      event.preventDefault();
      next?.focus?.();
    }
  }

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
    if (event.defaultPrevented || event.key !== "Escape" || isComposingInput(event)) return;
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
      if (settingsDialogHasNestedModal()) return;
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
    if (!mobileViewport()) return;
    closeSidebarSettingsMenu({ restoreFocus: false });
    document.body.classList.add("mobile-sidebar-open");
    $("mobileMenuBtn")?.setAttribute("aria-expanded", "true");
    $("mobileSidebarBackdrop")?.classList.remove("hidden");
    $("sessionSidebar")?.setAttribute("aria-hidden", "false");
    $("mobileSidebarCloseBtn")?.focus();
    resizeTerminal?.();
  }

  function closeMobileSidebar(options = {}) {
    const wasOpen = document.body.classList.contains("mobile-sidebar-open");
    document.body.classList.remove("mobile-sidebar-open");
    $("mobileMenuBtn")?.setAttribute("aria-expanded", "false");
    $("mobileSidebarBackdrop")?.classList.add("hidden");
    if (mobileViewport()) $("sessionSidebar")?.setAttribute("aria-hidden", "true");
    else $("sessionSidebar")?.removeAttribute("aria-hidden");
    closeSidebarSettingsMenu({ restoreFocus: false });
    if (wasOpen && options.restoreFocus !== false) $("mobileMenuBtn")?.focus();
    resizeTerminal?.();
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

    const mobileBackdrop = document.createElement("div");
    mobileBackdrop.className = "mobile-select-sheet-backdrop hidden";
    mobileBackdrop.setAttribute("aria-hidden", "true");

    const mobileSheet = document.createElement("section");
    mobileSheet.id = "mobileComposerSelectSheet";
    mobileSheet.className = "mobile-select-sheet";
    mobileSheet.setAttribute("role", "dialog");
    mobileSheet.setAttribute("aria-modal", "true");
    mobileSheet.setAttribute("aria-labelledby", "mobileComposerSelectSheetTitle");

    const mobileHandle = document.createElement("div");
    mobileHandle.className = "mobile-select-sheet-drag-handle";
    mobileHandle.setAttribute("aria-hidden", "true");

    const mobileHeader = document.createElement("div");
    mobileHeader.className = "mobile-select-sheet-header";
    const mobileTitle = document.createElement("h2");
    mobileTitle.id = "mobileComposerSelectSheetTitle";
    mobileTitle.className = "mobile-select-sheet-title";
    const mobileClose = document.createElement("button");
    mobileClose.type = "button";
    mobileClose.className = "mobile-select-sheet-close";
    mobileClose.setAttribute("aria-label", translate("common.close"));
    mobileClose.textContent = "×";
    mobileHeader.append(mobileTitle, mobileClose);

    const mobileBody = document.createElement("div");
    mobileBody.className = "mobile-select-sheet-body";
    mobileSheet.append(mobileHandle, mobileHeader, mobileBody);
    mobileBackdrop.appendChild(mobileSheet);
    document.body.appendChild(mobileBackdrop);

    let active = null;
    let bodyOverflow = "";
    const observers = [];
    const bindings = triggers.map((trigger) => {
      const select = $(trigger.dataset.composerSelect);
      const valueNode = trigger.querySelector(".composer-select-value");
      const label = document.querySelector(`label[for="${trigger.dataset.composerSelect}"]`);
      const binding = {
        trigger,
        select,
        valueNode,
        label,
        ariaHaspopup: trigger.getAttribute("aria-haspopup") || "listbox",
      };
      const sync = () => {
        const option = select?.selectedOptions?.[0] || select?.options?.[select?.selectedIndex];
        if (valueNode && option) {
          const optionText = option.textContent?.trim() || option.value;
          valueNode.textContent = optionText;
          if (trigger.dataset.composerSelect === "modelSelect") {
            valueNode.dataset.mobileLabel = compactComposerModelLabel(option.value || option.textContent);
          }
          const fieldLabel = label?.textContent?.trim();
          trigger.setAttribute("aria-label", fieldLabel ? `${fieldLabel}：${optionText}` : optionText);
        }
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

    const mobileViewport = () => window.matchMedia?.("(max-width: 767px)")?.matches
      ?? (globalThis.innerWidth || document.documentElement.clientWidth) <= 767;
    const usesMobileSheet = (binding) => mobileViewport()
      && ["modelSelect", "reasoningEffort"].includes(binding.select.id);

    const close = ({ focus = false } = {}) => {
      if (!active) return;
      const { binding, mobile, returnFocus } = active;
      active = null;
      if (mobile) {
        mobileBackdrop.classList.add("hidden");
        mobileBackdrop.setAttribute("aria-hidden", "true");
        mobileSheet.className = "mobile-select-sheet";
        mobileBody.replaceChildren();
        document.body.style.overflow = bodyOverflow;
      } else {
        menu.classList.add("hidden");
        menu.classList.remove("composer-permission-popover");
        menu.replaceChildren();
      }
      binding.trigger.setAttribute("aria-expanded", "false");
      binding.trigger.setAttribute("aria-haspopup", binding.ariaHaspopup);
      binding.trigger.removeAttribute("aria-controls");
      if (focus && returnFocus?.isConnected !== false) returnFocus?.focus?.();
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

    const createMobileOptionButton = (binding, option, { model = false } = {}) => {
      const selected = option.value === binding.select.value;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "composer-select-option mobile-select-sheet-option";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.disabled = option.disabled;

      if (model) {
        const presentation = modelOptionPresentation(option.value, option.textContent);
        const copy = document.createElement("span");
        copy.className = "mobile-model-option-copy";
        const name = document.createElement("span");
        name.className = "mobile-model-option-name";
        name.textContent = presentation.name;
        copy.appendChild(name);
        const provider = document.createElement("span");
        provider.className = "mobile-model-option-provider";
        provider.textContent = presentation.provider || translate("chat.modelProviderFallback");
        copy.appendChild(provider);
        button.appendChild(copy);
      } else {
        const label = document.createElement("span");
        label.textContent = option.textContent?.trim() || option.value;
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

    const createMobileAction = (title, detail, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mobile-model-sheet-action";
      const copy = document.createElement("span");
      copy.className = "mobile-model-sheet-action-copy";
      const titleNode = document.createElement("span");
      titleNode.className = "mobile-model-sheet-action-title";
      titleNode.textContent = title;
      copy.appendChild(titleNode);
      if (detail) {
        const detailNode = document.createElement("span");
        detailNode.className = "mobile-model-sheet-action-detail";
        detailNode.textContent = detail;
        copy.appendChild(detailNode);
      }
      const chevron = document.createElement("span");
      chevron.className = "mobile-model-sheet-action-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      button.append(copy, chevron);
      button.addEventListener("click", handler);
      return button;
    };

    const openMobile = (binding, { returnFocus = binding.trigger } = {}) => {
      const isModel = binding.select.id === "modelSelect";
      active = { binding, mobile: true, returnFocus };
      mobileSheet.className = `mobile-select-sheet ${isModel ? "mobile-model-sheet" : "mobile-reasoning-sheet"}`;
      mobileTitle.textContent = isModel ? translate("chat.selectModel") : (binding.label?.textContent?.trim() || translate("chat.reasoningEffort"));

      const options = document.createElement("div");
      options.className = "mobile-select-sheet-options";
      options.setAttribute("role", "listbox");
      options.setAttribute("aria-label", mobileTitle.textContent);
      [...binding.select.options]
        .filter((option) => !option.hidden)
        .forEach((option) => options.appendChild(createMobileOptionButton(binding, option, { model: isModel })));
      mobileBody.replaceChildren(options);

      if (isModel) {
        const actions = document.createElement("div");
        actions.className = "mobile-model-sheet-actions";
        const reasoningBinding = bindings.find(({ select }) => select.id === "reasoningEffort");
        if (reasoningBinding) {
          const currentReasoning = reasoningBinding.select.selectedOptions?.[0]
            || reasoningBinding.select.options?.[reasoningBinding.select.selectedIndex];
          const reasoningText = currentReasoning?.textContent?.trim() || currentReasoning?.value || "";
          actions.appendChild(createMobileAction(translate("chat.reasoningEffort"), reasoningText, () => {
            const focusTarget = active?.returnFocus || binding.trigger;
            close();
            openMobile(reasoningBinding, { returnFocus: focusTarget });
          }));
        }
        actions.appendChild(createMobileAction(translate("chat.manageModels"), "", () => {
          close({ focus: true });
          openModelSettings();
        }));
        mobileBody.appendChild(actions);
      }

      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      mobileBackdrop.classList.remove("hidden");
      mobileBackdrop.setAttribute("aria-hidden", "false");
      binding.trigger.setAttribute("aria-haspopup", "dialog");
      binding.trigger.setAttribute("aria-expanded", "true");
      binding.trigger.setAttribute("aria-controls", mobileSheet.id);
      (options.querySelector('[aria-selected="true"]') || options.querySelector("button") || mobileClose).focus?.();
    };

    const open = (binding) => {
      if (active?.binding.trigger === binding.trigger) {
        close();
        return;
      }
      close();
      if (usesMobileSheet(binding)) {
        openMobile(binding);
        return;
      }
      active = { binding, mobile: false, returnFocus: binding.trigger };
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
      if (!active || active.mobile || menu.contains(event.target) || active.binding.trigger.contains(event.target)) return;
      close();
    };
    const handleDocumentKey = (event) => {
      if (event.key === "Escape" && active) {
        close({ focus: true });
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !active?.mobile) return;
      const focusable = [...mobileSheet.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")];
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      focusable[nextIndex]?.focus?.();
      event.preventDefault();
    };
    const handleBackdropClick = (event) => {
      if (event.target !== mobileBackdrop || !active?.mobile) return;
      close({ focus: true });
    };
    const handleCloseClick = () => close({ focus: true });
    const handleViewportChange = () => {
      const restoreFocus = Boolean(active?.mobile);
      close({ focus: restoreFocus });
    };
    const handleDocumentScroll = (event) => {
      if (active?.mobile && mobileSheet.contains(event.target)) return;
      close();
    };
    mobileBackdrop.addEventListener("click", handleBackdropClick);
    mobileClose.addEventListener("click", handleCloseClick);
    document.addEventListener("pointerdown", handleDocumentPointer);
    document.addEventListener("keydown", handleDocumentKey);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.addEventListener("scroll", handleDocumentScroll, true);

    return () => {
      close();
      triggerHandlers.forEach(([trigger, handler]) => trigger.removeEventListener("click", handler));
      bindings.forEach(({ select, sync }) => select.removeEventListener("change", sync));
      observers.forEach((observer) => observer.disconnect());
      mobileBackdrop.removeEventListener("click", handleBackdropClick);
      mobileClose.removeEventListener("click", handleCloseClick);
      document.removeEventListener("pointerdown", handleDocumentPointer);
      document.removeEventListener("keydown", handleDocumentKey);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("scroll", handleDocumentScroll, true);
      mobileBackdrop.remove();
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
    beginSettingsDialogFocus,
    bindComposerSelectMenus,
    bindSidebarResizer,
    closeMobileSidebar,
    closeProjectSearch,
    closeSidebarSettingsMenu,
    focusMobileSearch,
    handleDirectoryShortcutClick,
    handleGlobalEscape,
    handleSettingsDialogKeydown,
    handleSettingsSearchShortcut,
    handleSidebarSettingsMenuDocumentClick,
    openMobileSidebar,
    restoreSettingsDialogFocus,
    settingsDialogHasNestedModal,
    toggleMobileTerminal,
    toggleProjectSearch,
    toggleSidebarSettingsMenu,
  };
}
