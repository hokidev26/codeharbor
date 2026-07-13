const AGENT_STREAM_PROTOCOL = 2;

function normalizedSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
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

export function createAgentStreamController({
  api,
  webSocketURL,
  WebSocketImpl = globalThis.WebSocket,
  onEvent,
  onSnapshot,
  onStatus,
  onError,
  reconnectBaseMs = 250,
  reconnectMaxMs = 5000,
} = {}) {
  if (typeof api !== "function") throw new Error("createAgentStreamController requires api");
  if (typeof webSocketURL !== "function") throw new Error("createAgentStreamController requires webSocketURL");
  if (typeof WebSocketImpl !== "function") throw new Error("createAgentStreamController requires WebSocket");

  let agentId = "";
  let epoch = 0;
  let socket = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let stopped = true;
  let recoveryPromise = null;
  let recoveryToken = null;
  let cursor = { streamSession: "", sequence: 0 };

  const current = (expectedEpoch, expectedAgentId = agentId) => !stopped && epoch === expectedEpoch && agentId === expectedAgentId;
  const status = (value, detail = {}) => onStatus?.({ status: value, agentId, cursor: { ...cursor }, ...detail });

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function closeCurrentSocket() {
    const currentSocket = socket;
    socket = null;
    if (!currentSocket) return;
    try { currentSocket.close(); } catch {}
  }

  function scheduleReconnect(expectedEpoch, { snapshot = false, reason = "connection_closed" } = {}) {
    if (!current(expectedEpoch) || retryTimer !== null) return;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** Math.min(retryAttempt, 5)));
    retryAttempt += 1;
    status(snapshot ? "resyncing" : "reconnecting", { reason, retryInMs: delay });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!current(expectedEpoch)) return;
      const operation = snapshot ? recoverFromSnapshot(expectedEpoch, reason) : openSocket(expectedEpoch);
      Promise.resolve(operation).catch((error) => onError?.(error));
    }, delay);
  }

  async function recoverFromSnapshot(expectedEpoch, reason = "snapshot_required") {
    if (!current(expectedEpoch)) return null;
    if (recoveryPromise) return recoveryPromise;
    closeCurrentSocket();
    status(reason === "initial" ? "syncing" : "resyncing", { reason });
    const expectedAgentId = agentId;
    const token = {};
    recoveryToken = token;
    const operation = (async () => {
      try {
        const snapshot = await api(`/api/v2/agents/${encodeURIComponent(expectedAgentId)}/live-snapshot`);
        if (!current(expectedEpoch, expectedAgentId)) return null;
        if (Number(snapshot?.protocol) !== AGENT_STREAM_PROTOCOL) throw new Error("agent live snapshot protocol mismatch");
        const streamSession = String(snapshot?.stream?.streamSession || "").trim();
        const sequence = normalizedSequence(snapshot?.stream?.latestSequence);
        if (!streamSession || sequence === null) throw new Error("agent live snapshot watermark is invalid");
        await onSnapshot?.(snapshot, { reason });
        if (!current(expectedEpoch, expectedAgentId)) return null;
        cursor = { streamSession, sequence };
        retryAttempt = 0;
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
      retryAttempt = 0;
      status("connected", { resume: frame.resume || "live" });
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
    await onEvent?.(frame);
    if (current(expectedEpoch) && socket === expectedSocket) cursor = { ...cursor, sequence };
  }

  function openSocket(expectedEpoch) {
    if (!current(expectedEpoch)) return null;
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
    clearRetry();
    closeCurrentSocket();
    return recoverFromSnapshot(epoch, "initial");
  }

  function disconnect() {
    stopped = true;
    epoch += 1;
    clearRetry();
    closeCurrentSocket();
    recoveryPromise = null;
    recoveryToken = null;
    agentId = "";
    cursor = { streamSession: "", sequence: 0 };
    retryAttempt = 0;
    status("idle");
  }

  return {
    connect,
    disconnect,
    cursor: () => ({ ...cursor }),
    currentAgentId: () => agentId,
  };
}
