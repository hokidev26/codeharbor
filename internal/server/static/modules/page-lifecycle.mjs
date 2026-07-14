export const pageLifecycleDefaults = Object.freeze({
  mergeDelayMs: 750,
  minMergeDelayMs: 500,
  maxMergeDelayMs: 1000,
});

function timerFunctions(timers) {
  const source = timers || globalThis;
  const set = typeof source?.setTimeout === "function" ? source.setTimeout.bind(source) : globalThis.setTimeout.bind(globalThis);
  const clear = typeof source?.clearTimeout === "function" ? source.clearTimeout.bind(source) : globalThis.clearTimeout.bind(globalThis);
  return { setTimeout: set, clearTimeout: clear };
}

function boundedMergeDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return pageLifecycleDefaults.mergeDelayMs;
  return Math.max(pageLifecycleDefaults.minMergeDelayMs, Math.min(pageLifecycleDefaults.maxMergeDelayMs, delay));
}

function addListener(target, type, listener) {
  target?.addEventListener?.(type, listener);
}

function removeListener(target, type, listener) {
  target?.removeEventListener?.(type, listener);
}

export function createPageLifecycleController({
  onResume,
  onOffline,
  onError,
  document: documentImpl = globalThis.document,
  window: windowImpl = globalThis.window,
  navigator: navigatorImpl = globalThis.navigator,
  timers = globalThis,
  mergeDelayMs = pageLifecycleDefaults.mergeDelayMs,
  autoStart = true,
} = {}) {
  if (typeof onResume !== "function") throw new Error("createPageLifecycleController requires onResume");

  const timer = timerFunctions(timers);
  const delay = boundedMergeDelay(mergeDelayMs);
  const pendingReasons = new Set();
  let started = false;
  let scheduledTimer = null;
  let activePromise = null;

  const online = () => navigatorImpl?.onLine !== false;
  const visible = () => {
    if (!documentImpl) return true;
    if (typeof documentImpl.visibilityState === "string") return documentImpl.visibilityState === "visible";
    return documentImpl.hidden !== true;
  };

  function clearScheduled() {
    if (scheduledTimer !== null) {
      timer.clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  }

  function finishActive(operation) {
    if (activePromise !== operation) return;
    activePromise = null;
    if (pendingReasons.size > 0 && online()) runPending();
  }

  function runPending() {
    scheduledTimer = null;
    if (!online()) {
      pendingReasons.clear();
      return Promise.resolve(null);
    }
    if (activePromise) return activePromise;
    if (pendingReasons.size === 0) return Promise.resolve(null);

    const reasons = [...pendingReasons];
    pendingReasons.clear();
    const detail = {
      reason: reasons[0] || "lifecycle_resume",
      reasons,
      online: true,
      visible: visible(),
    };
    const operation = Promise.resolve()
      .then(() => onResume(detail))
      .catch((error) => {
        onError?.(error);
        return null;
      });
    activePromise = operation;
    operation.finally(() => finishActive(operation));
    return operation;
  }

  function schedule(reason = "lifecycle_resume") {
    pendingReasons.add(String(reason || "lifecycle_resume"));
    if (!online()) {
      clearScheduled();
      pendingReasons.clear();
      return false;
    }
    if (scheduledTimer === null) {
      scheduledTimer = timer.setTimeout(runPending, delay);
    }
    return true;
  }

  function handleVisibilityChange() {
    if (visible()) schedule("visible");
  }

  function handlePageShow() {
    schedule("pageshow");
  }

  function handleOnline() {
    schedule("online");
  }

  function handleOffline() {
    clearScheduled();
    pendingReasons.clear();
    onOffline?.({ reason: "offline", online: false, visible: visible() });
  }

  function start() {
    if (started) return false;
    started = true;
    addListener(documentImpl, "visibilitychange", handleVisibilityChange);
    addListener(windowImpl, "pageshow", handlePageShow);
    addListener(windowImpl, "online", handleOnline);
    addListener(windowImpl, "offline", handleOffline);
    return true;
  }

  function stop() {
    if (!started) return false;
    started = false;
    removeListener(documentImpl, "visibilitychange", handleVisibilityChange);
    removeListener(windowImpl, "pageshow", handlePageShow);
    removeListener(windowImpl, "online", handleOnline);
    removeListener(windowImpl, "offline", handleOffline);
    clearScheduled();
    pendingReasons.clear();
    return true;
  }

  async function flush() {
    clearScheduled();
    await runPending();
    while (activePromise) await activePromise;
  }

  if (autoStart) start();

  return {
    start,
    stop,
    dispose: stop,
    schedule,
    requestResume: schedule,
    flush,
    isStarted: () => started,
    pendingReasons: () => [...pendingReasons],
  };
}

export const createPageLifecycleResumeController = createPageLifecycleController;
