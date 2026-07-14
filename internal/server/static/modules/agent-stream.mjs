const AGENT_STREAM_PROTOCOL = 2;

export const agentStreamDefaults = Object.freeze({
  reconnectBaseMs: 500,
  reconnectCapMs: 30000,
  stableConnectionMs: 10000,
});

function normalizedSequence(value) {
  if (value === null || value === undefined || value === "") return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function normalizedGeneration(value) {
  if (value === null || value === undefined || value === "") return null;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

function normalizedDuration(value, fallback) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : fallback;
}

function timerFunctions(timers) {
  const source = timers || globalThis;
  const set = typeof source?.setTimeout === "function" ? source.setTimeout.bind(source) : globalThis.setTimeout.bind(globalThis);
  const clear = typeof source?.clearTimeout === "function" ? source.clearTimeout.bind(source) : globalThis.clearTimeout.bind(globalThis);
  return { setTimeout: set, clearTimeout: clear };
}

function randomValue(random) {
  let value;
  try {
    value = typeof random === "function" ? random() : random?.random?.();
  } catch {
    value = 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

export function fullJitterDelay(attempt, {
  baseMs = agentStreamDefaults.reconnectBaseMs,
  capMs = agentStreamDefaults.reconnectCapMs,
  random = Math.random,
} = {}) {
  const base = normalizedDuration(baseMs, agentStreamDefaults.reconnectBaseMs);
  const cap = normalizedDuration(capMs, agentStreamDefaults.reconnectCapMs);
  const exponent = Math.max(0, Math.min(52, Number.isSafeInteger(attempt) ? attempt : 0));
  const ceiling = Math.min(cap, base * (2 ** exponent));
  return Math.floor(ceiling * randomValue(random));
}

export function buildAgentStreamPath(agentId, cursor = {}) {
  const params = new URLSearchParams({ id: String(agentId || ""), protocol: String(AGENT_STREAM_PROTOCOL) });
  const streamSession = String(cursor.streamSession || "").trim();
  const sequence = normalizedSequence(cursor.sequence);
  if (streamSession && sequence !== null) {
    params.set("streamSession", streamSession);
    params.set("after", String(sequence));
  }
  return `/ws/agent?${params.toString()}`;
}

export function buildAgentStreamStatePath(agentId) {
  return `/api/v2/agents/${encodeURIComponent(String(agentId || ""))}/stream-state`;
}

export function buildAgentLiveSnapshotPath(agentId, afterExecutionGeneration = 0) {
  const path = `/api/v2/agents/${encodeURIComponent(String(agentId || ""))}/live-snapshot`;
  const generation = normalizedGeneration(afterExecutionGeneration);
  if (generation === null) return path;
  return `${path}?${new URLSearchParams({ afterExecutionGeneration: String(generation) }).toString()}`;
}

function notModifiedResponse(value) {
  return Boolean(value?.notModified)
    || Number(value?.status) === 304
    || Number(value?.statusCode) === 304;
}

function streamStatePayload(value) {
  if (!value || typeof value !== "object") return {};
  if (value.changed && typeof value.changed === "object") return value.changed;
  if (value.state && typeof value.state === "object") return value.state;
  return value;
}

function normalizeStreamState(value, localCursor, executionCheckpoint) {
  if (notModifiedResponse(value)) {
    return { changed: false, notModified: true, protocol: null, streamSession: "", latestSequence: null, executionGeneration: null };
  }
  const payload = streamStatePayload(value);
  const stream = payload.stream && typeof payload.stream === "object" ? payload.stream : payload;
  const streamSession = String(stream.streamSession || payload.streamSession || "").trim();
  const latestSequence = normalizedSequence(stream.latestSequence ?? payload.latestSequence);
  const executionGeneration = normalizedGeneration(
    payload.executionGeneration
      ?? payload.latestExecutionGeneration
      ?? payload.checkpoint?.executionGeneration,
  );
  const explicitChanged = typeof value?.changed === "boolean"
    ? value.changed
    : (typeof payload.changed === "boolean" ? payload.changed : null);
  const sessionChanged = Boolean(streamSession && localCursor.streamSession && streamSession !== localCursor.streamSession);
  const sequenceChanged = latestSequence !== null && latestSequence !== localCursor.sequence;
  const executionChanged = executionGeneration !== null && executionGeneration !== executionCheckpoint;
  const hasComparableState = Boolean(streamSession) || latestSequence !== null || executionGeneration !== null;
  return {
    changed: explicitChanged ?? (hasComparableState ? (sessionChanged || sequenceChanged || executionChanged) : true),
    notModified: false,
    protocol: normalizedSequence(payload.protocol),
    streamSession,
    latestSequence,
    executionGeneration,
  };
}

export function createAgentStreamController({
  api,
  webSocketURL,
  WebSocketImpl = globalThis.WebSocket,
  onEvent,
  onSnapshot,
  onStatus,
  onError,
  getExecutionCheckpoint,
  executionCheckpoint,
  reconnectBaseMs = agentStreamDefaults.reconnectBaseMs,
  reconnectCapMs = agentStreamDefaults.reconnectCapMs,
  reconnectMaxMs,
  stableConnectionMs = agentStreamDefaults.stableConnectionMs,
  timers = globalThis,
  random = Math.random,
  navigator: navigatorImpl = globalThis.navigator,
} = {}) {
  if (typeof api !== "function") throw new Error("createAgentStreamController requires api");
  if (typeof webSocketURL !== "function") throw new Error("createAgentStreamController requires webSocketURL");
  if (typeof WebSocketImpl !== "function") throw new Error("createAgentStreamController requires WebSocket");

  const timer = timerFunctions(timers);
  const checkpointProvider = typeof getExecutionCheckpoint === "function"
    ? getExecutionCheckpoint
    : (typeof executionCheckpoint === "function" ? executionCheckpoint : () => 0);
  const retryBase = normalizedDuration(reconnectBaseMs, agentStreamDefaults.reconnectBaseMs);
  const retryCap = normalizedDuration(reconnectMaxMs ?? reconnectCapMs, agentStreamDefaults.reconnectCapMs);
  const stableMs = normalizedDuration(stableConnectionMs, agentStreamDefaults.stableConnectionMs);

  let agentId = "";
  let epoch = 0;
  let socket = null;
  let retryTimer = null;
  let stableTimer = null;
  let retryAttempt = 0;
  let stopped = true;
  let recoveryPromise = null;
  let recoveryToken = null;
  let resumePromise = null;
  let resumeToken = null;
  let cursor = { streamSession: "", sequence: 0 };

  const current = (expectedEpoch, expectedAgentId = agentId) => !stopped && epoch === expectedEpoch && agentId === expectedAgentId;
  const status = (value, detail = {}) => onStatus?.({ status: value, agentId, cursor: { ...cursor }, ...detail });
  const online = () => navigatorImpl?.onLine !== false;

  function executionGenerationCheckpoint(expectedAgentId = agentId) {
    let value = 0;
    try {
      value = checkpointProvider(expectedAgentId);
    } catch (error) {
      onError?.(error);
    }
    if (value && typeof value === "object") {
      value = value.executionGeneration ?? value.generation ?? value.checkpoint;
    }
    return normalizedGeneration(value) ?? 0;
  }

  function clearRetry() {
    if (retryTimer !== null) {
      timer.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function clearStableTimer() {
    if (stableTimer !== null) {
      timer.clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function closeCurrentSocket() {
    clearStableTimer();
    const currentSocket = socket;
    socket = null;
    if (!currentSocket) return;
    try { currentSocket.close(); } catch {}
  }

  function socketUsable(candidate = socket) {
    if (!candidate || candidate.closed === true) return false;
    const readyState = Number(candidate.readyState);
    return !Number.isFinite(readyState) || readyState === 0 || readyState === 1;
  }

  function pauseForOffline(expectedEpoch, reason = "browser_offline") {
    if (!current(expectedEpoch)) return;
    clearRetry();
    closeCurrentSocket();
    status("offline", { reason, paused: true });
  }

  function markConnectionStable(expectedEpoch, expectedSocket, reason) {
    if (!current(expectedEpoch) || socket !== expectedSocket) return;
    const becameStable = stableTimer !== null || retryAttempt !== 0;
    clearStableTimer();
    retryAttempt = 0;
    if (becameStable) status("connected", { reason, stable: true });
  }

  function armStableConnection(expectedEpoch, expectedSocket) {
    clearStableTimer();
    stableTimer = timer.setTimeout(() => {
      markConnectionStable(expectedEpoch, expectedSocket, "stable_connection");
    }, stableMs);
  }

  function scheduleReconnect(expectedEpoch, { snapshot = false, reason = "connection_closed" } = {}) {
    if (!current(expectedEpoch) || retryTimer !== null) return;
    if (!online()) {
      pauseForOffline(expectedEpoch);
      return;
    }
    const delay = fullJitterDelay(retryAttempt, { baseMs: retryBase, capMs: retryCap, random });
    retryAttempt += 1;
    status(snapshot ? "resyncing" : "reconnecting", { reason, retryInMs: delay, retryAttempt });
    retryTimer = timer.setTimeout(() => {
      retryTimer = null;
      if (!current(expectedEpoch)) return;
      if (!online()) {
        pauseForOffline(expectedEpoch);
        return;
      }
      const operation = snapshot ? recoverFromSnapshot(expectedEpoch, reason) : openSocket(expectedEpoch);
      Promise.resolve(operation).catch((error) => onError?.(error));
    }, delay);
  }

  async function recoverFromSnapshot(expectedEpoch, reason = "snapshot_required") {
    if (!current(expectedEpoch)) return null;
    if (!online()) {
      pauseForOffline(expectedEpoch);
      return null;
    }
    if (recoveryPromise) return recoveryPromise;
    clearRetry();
    closeCurrentSocket();
    status(reason === "initial" ? "syncing" : "resyncing", { reason });
    const expectedAgentId = agentId;
    const token = {};
    recoveryToken = token;
    const afterExecutionGeneration = executionGenerationCheckpoint(expectedAgentId);
    const operation = (async () => {
      try {
        const snapshot = await Promise.resolve().then(() => api(
          buildAgentLiveSnapshotPath(expectedAgentId, afterExecutionGeneration),
          { method: "GET" },
        ));
        if (!current(expectedEpoch, expectedAgentId)) return null;
        if (!online()) {
          pauseForOffline(expectedEpoch);
          return null;
        }
        if (Number(snapshot?.protocol) !== AGENT_STREAM_PROTOCOL) throw new Error("agent live snapshot protocol mismatch");
        const streamSession = String(snapshot?.stream?.streamSession || "").trim();
        const sequence = normalizedSequence(snapshot?.stream?.latestSequence);
        if (!streamSession || sequence === null) throw new Error("agent live snapshot watermark is invalid");
        await onSnapshot?.(snapshot, {
          reason,
          source: reason === "initial" ? "initial" : "snapshot",
          afterExecutionGeneration,
        });
        if (!current(expectedEpoch, expectedAgentId)) return null;
        cursor = { streamSession, sequence };
        openSocket(expectedEpoch);
        return snapshot;
      } catch (error) {
        if (current(expectedEpoch, expectedAgentId)) {
          status("offline", { reason, error: error?.message || String(error) });
          scheduleReconnect(expectedEpoch, { snapshot: true, reason });
        }
        throw error;
      } finally {
        if (recoveryToken === token) {
          recoveryToken = null;
          recoveryPromise = null;
        }
      }
    })();
    recoveryPromise = operation;
    return operation;
  }

  function requestSnapshot(expectedEpoch, reason) {
    if (!current(expectedEpoch)) return;
    closeCurrentSocket();
    Promise.resolve(recoverFromSnapshot(expectedEpoch, reason)).catch((error) => onError?.(error));
  }

  async function processMessage(raw, expectedEpoch, expectedSocket) {
    if (!current(expectedEpoch) || socket !== expectedSocket) return;
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      throw new Error("agent websocket returned malformed JSON");
    }
    if (frame?.type === "connected") {
      if (Number(frame.protocol) !== AGENT_STREAM_PROTOCOL) {
        requestSnapshot(expectedEpoch, "protocol_mismatch");
        return;
      }
      const streamSession = String(frame.streamSession || "").trim();
      if (!streamSession || streamSession !== cursor.streamSession) {
        requestSnapshot(expectedEpoch, "session_mismatch");
        return;
      }
      status("connected", { resume: frame.resume || "live", stable: false });
      armStableConnection(expectedEpoch, expectedSocket);
      return;
    }
    if (frame?.type === "resync_required") {
      requestSnapshot(expectedEpoch, frame.reason || "snapshot_required");
      return;
    }
    if (Number(frame?.protocol) !== AGENT_STREAM_PROTOCOL || String(frame?.streamSession || "") !== cursor.streamSession) {
      requestSnapshot(expectedEpoch, "session_mismatch");
      return;
    }
    const sequence = normalizedSequence(frame.sequence);
    if (sequence === null || sequence === 0) {
      requestSnapshot(expectedEpoch, "invalid_sequence");
      return;
    }
    if (sequence <= cursor.sequence) return;
    if (sequence !== cursor.sequence + 1) {
      requestSnapshot(expectedEpoch, "sequence_gap");
      return;
    }
    await onEvent?.(frame, { source: "live" });
    if (current(expectedEpoch) && socket === expectedSocket) {
      cursor = { ...cursor, sequence };
      markConnectionStable(expectedEpoch, expectedSocket, "stable_traffic");
    }
  }

  function openSocket(expectedEpoch) {
    if (!current(expectedEpoch)) return null;
    if (!online()) {
      pauseForOffline(expectedEpoch);
      return null;
    }
    clearRetry();
    closeCurrentSocket();
    status("connecting");
    let nextSocket;
    try {
      nextSocket = new WebSocketImpl(webSocketURL(buildAgentStreamPath(agentId, cursor)));
    } catch (error) {
      status("offline", { error: error?.message || String(error) });
      scheduleReconnect(expectedEpoch);
      throw error;
    }
    socket = nextSocket;
    let messageQueue = Promise.resolve();
    nextSocket.onmessage = (message) => {
      messageQueue = messageQueue
        .then(() => processMessage(message.data, expectedEpoch, nextSocket))
        .catch((error) => {
          onError?.(error);
          requestSnapshot(expectedEpoch, "message_processing_failed");
        });
    };
    nextSocket.onerror = () => {
      if (current(expectedEpoch) && socket === nextSocket) status("offline", { reason: "socket_error" });
    };
    nextSocket.onclose = () => {
      if (!current(expectedEpoch) || socket !== nextSocket) return;
      clearStableTimer();
      socket = null;
      scheduleReconnect(expectedEpoch);
    };
    return nextSocket;
  }

  async function connect(nextAgentId) {
    const normalizedAgentId = String(nextAgentId || "").trim();
    if (!normalizedAgentId) {
      disconnect();
      return null;
    }
    stopped = false;
    epoch += 1;
    agentId = normalizedAgentId;
    cursor = { streamSession: "", sequence: 0 };
    retryAttempt = 0;
    recoveryPromise = null;
    recoveryToken = null;
    resumePromise = null;
    resumeToken = null;
    clearRetry();
    closeCurrentSocket();
    if (!online()) {
      pauseForOffline(epoch);
      return null;
    }
    return recoverFromSnapshot(epoch, "initial");
  }

  function resume(detail = {}) {
    if (stopped || !agentId) return Promise.resolve(null);
    const expectedEpoch = epoch;
    const expectedAgentId = agentId;
    const reason = typeof detail === "string" ? detail : (detail?.reason || "lifecycle_resume");
    if (!online()) {
      pauseForOffline(expectedEpoch);
      return Promise.resolve(null);
    }
    if (recoveryPromise) return recoveryPromise;
    if (resumePromise) return resumePromise;

    const token = {};
    resumeToken = token;
    const operation = (async () => {
      try {
        clearRetry();
        status("reconnecting", { reason, checkingState: true });
        const checkpoint = executionGenerationCheckpoint(expectedAgentId);
        let response;
        try {
          response = await Promise.resolve().then(() => api(
            buildAgentStreamStatePath(expectedAgentId),
            { method: "GET", allowNotModified: true },
          ));
        } catch (error) {
          if (notModifiedResponse(error)) {
            response = { notModified: true };
          } else {
            if (!current(expectedEpoch, expectedAgentId)) return null;
            if (!online()) {
              pauseForOffline(expectedEpoch);
              return null;
            }
            onError?.(error);
            return recoverFromSnapshot(expectedEpoch, "stream_state_failed");
          }
        }
        if (!current(expectedEpoch, expectedAgentId)) return null;
        if (!online()) {
          pauseForOffline(expectedEpoch);
          return null;
        }

        const state = normalizeStreamState(response, cursor, checkpoint);
        if (state.protocol !== null && state.protocol !== AGENT_STREAM_PROTOCOL) {
          return recoverFromSnapshot(expectedEpoch, "stream_state_protocol_mismatch");
        }
        if (!cursor.streamSession || (state.streamSession && state.streamSession !== cursor.streamSession)) {
          return recoverFromSnapshot(expectedEpoch, "resume_session_mismatch");
        }
        if (state.changed || !socketUsable()) {
          try {
            openSocket(expectedEpoch);
          } catch {
            clearRetry();
            return recoverFromSnapshot(expectedEpoch, "resume_reconnect_failed");
          }
        } else {
          status("connected", { reason, resume: "unchanged" });
        }
        return state;
      } finally {
        if (resumeToken === token) {
          resumeToken = null;
          resumePromise = null;
        }
      }
    })();
    resumePromise = operation;
    return operation;
  }

  function pause(reason = "browser_offline") {
    if (stopped || !agentId) return false;
    clearRetry();
    closeCurrentSocket();
    status("offline", { reason, paused: true });
    return true;
  }

  function disconnect() {
    stopped = true;
    epoch += 1;
    clearRetry();
    closeCurrentSocket();
    recoveryPromise = null;
    recoveryToken = null;
    resumePromise = null;
    resumeToken = null;
    agentId = "";
    cursor = { streamSession: "", sequence: 0 };
    retryAttempt = 0;
    status("idle");
  }

  return {
    connect,
    resume,
    pause,
    disconnect,
    cursor: () => ({ ...cursor }),
    currentAgentId: () => agentId,
    retryAttempt: () => retryAttempt,
  };
}
