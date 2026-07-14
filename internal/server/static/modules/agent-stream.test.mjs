import test from "node:test";
import assert from "node:assert/strict";

import {
  agentStreamDefaults,
  buildAgentLiveSnapshotPath,
  buildAgentStreamPath,
  buildAgentStreamStatePath,
  createAgentStreamController,
  fullJitterDelay,
} from "./agent-stream.mjs";

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, at: this.now + Number(delay || 0) });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  message(frame) {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  serverClose() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
}

function snapshot(session, sequence, extra = {}) {
  return {
    protocol: 2,
    agent: { id: "agent-1" },
    messages: [],
    pendingApprovals: [],
    stream: { streamSession: session, latestSequence: sequence },
    ...extra,
  };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("agent stream paths and full-jitter defaults follow the recovery contract", () => {
  assert.equal(buildAgentStreamPath("agent/1"), "/ws/agent?id=agent%2F1&protocol=2");
  assert.equal(buildAgentStreamPath("agent/1", { streamSession: "session-a", sequence: 7 }), "/ws/agent?id=agent%2F1&protocol=2&streamSession=session-a&after=7");
  assert.equal(buildAgentStreamStatePath("agent/1"), "/api/v2/agents/agent%2F1/stream-state");
  assert.equal(buildAgentLiveSnapshotPath("agent/1", 12), "/api/v2/agents/agent%2F1/live-snapshot?afterExecutionGeneration=12");
  assert.equal(agentStreamDefaults.reconnectBaseMs, 500);
  assert.equal(agentStreamDefaults.reconnectCapMs, 30000);
  assert.equal(fullJitterDelay(0, { random: () => 0.5 }), 250);
  assert.equal(fullJitterDelay(20, { random: () => 0.5 }), 15000);
});

test("agent stream applies ordered events once and snapshots on a sequence gap", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  const snapshots = [
    snapshot("session-a", 2),
    snapshot("session-b", 10, { messages: [{ id: "m-1" }] }),
  ];
  const appliedSnapshots = [];
  const events = [];
  const controller = createAgentStreamController({
    api: async () => snapshots.shift(),
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    onSnapshot: (value) => appliedSnapshots.push(value.stream.streamSession),
    onEvent: (event) => events.push(event.sequence),
  });

  await controller.connect("agent-1");
  const first = FakeWebSocket.instances[0];
  assert.match(first.url, /streamSession=session-a/);
  assert.match(first.url, /after=2/);
  first.message({ type: "connected", protocol: 2, streamSession: "session-a", latestSequence: 2, resume: "live" });
  first.message({ type: "message.created", protocol: 2, streamSession: "session-a", sequence: 3, agentId: "agent-1" });
  first.message({ type: "message.created", protocol: 2, streamSession: "session-a", sequence: 3, agentId: "agent-1" });
  first.message({ type: "message.created", protocol: 2, streamSession: "session-a", sequence: 5, agentId: "agent-1" });
  await settle();
  await settle();

  assert.deepEqual(events, [3]);
  assert.deepEqual(appliedSnapshots, ["session-a", "session-b"]);
  assert.deepEqual(controller.cursor(), { streamSession: "session-b", sequence: 10 });
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(first.closed, true);
  controller.disconnect();
});

test("short connections retain retry pressure until stable traffic", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  const retryDelays = [];
  const controller = createAgentStreamController({
    api: async () => snapshot("session-a", 0),
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    random: () => 0.5,
    reconnectBaseMs: 100,
    reconnectCapMs: 1000,
    onStatus: (detail) => {
      if (detail.retryInMs !== undefined) retryDelays.push(detail.retryInMs);
    },
  });

  await controller.connect("agent-1");
  const first = FakeWebSocket.instances[0];
  first.message({ type: "connected", protocol: 2, streamSession: "session-a" });
  await settle();
  first.serverClose();
  assert.equal(controller.retryAttempt(), 1);
  timers.advance(50);

  const second = FakeWebSocket.instances[1];
  second.message({ type: "connected", protocol: 2, streamSession: "session-a" });
  await settle();
  second.serverClose();
  assert.equal(controller.retryAttempt(), 2);
  timers.advance(100);

  const third = FakeWebSocket.instances[2];
  third.message({ type: "connected", protocol: 2, streamSession: "session-a" });
  third.message({ type: "message.created", protocol: 2, streamSession: "session-a", sequence: 1, agentId: "agent-1" });
  await settle();
  await settle();
  assert.equal(controller.retryAttempt(), 0);
  third.serverClose();

  assert.deepEqual(retryDelays, [50, 100, 50]);
  controller.disconnect();
});

test("a connection must remain healthy for ten seconds before retry pressure clears", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  const controller = createAgentStreamController({
    api: async () => snapshot("session-a", 0),
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    random: () => 0.5,
    reconnectBaseMs: 100,
  });

  await controller.connect("agent-1");
  FakeWebSocket.instances[0].serverClose();
  assert.equal(controller.retryAttempt(), 1);
  timers.advance(50);
  FakeWebSocket.instances[1].message({ type: "connected", protocol: 2, streamSession: "session-a" });
  await settle();

  timers.advance(9999);
  assert.equal(controller.retryAttempt(), 1);
  timers.advance(1);
  assert.equal(controller.retryAttempt(), 0);
  controller.disconnect();
});

test("offline reconnect pauses and concurrent online resume preserves the cursor", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  const navigator = { onLine: true };
  const apiCalls = [];
  let resolveState;
  const controller = createAgentStreamController({
    api: async (path) => {
      apiCalls.push(path);
      if (path.includes("live-snapshot")) return snapshot("session-a", 5, { executionGeneration: 4 });
      return new Promise((resolve) => { resolveState = resolve; });
    },
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    navigator,
    getExecutionCheckpoint: () => 4,
  });

  await controller.connect("agent-1");
  const first = FakeWebSocket.instances[0];
  first.message({ type: "connected", protocol: 2, streamSession: "session-a" });
  first.message({ type: "message.created", protocol: 2, streamSession: "session-a", sequence: 6, agentId: "agent-1" });
  await settle();
  await settle();
  assert.deepEqual(controller.cursor(), { streamSession: "session-a", sequence: 6 });

  navigator.onLine = false;
  first.serverClose();
  assert.equal(timers.tasks.size, 0);
  assert.equal(FakeWebSocket.instances.length, 1);

  navigator.onLine = true;
  const firstResume = controller.resume({ reason: "online" });
  const secondResume = controller.resume({ reason: "pageshow" });
  await settle();
  assert.equal(apiCalls.filter((path) => path.endsWith("/stream-state")).length, 1);
  resolveState({ protocol: 2, stream: { streamSession: "session-a", latestSequence: 9 }, executionGeneration: 4 });
  await Promise.all([firstResume, secondResume]);

  assert.equal(apiCalls.filter((path) => path.includes("live-snapshot")).length, 1);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.match(FakeWebSocket.instances[1].url, /streamSession=session-a/);
  assert.match(FakeWebSocket.instances[1].url, /after=6(?:&|$)/);
  assert.deepEqual(controller.cursor(), { streamSession: "session-a", sequence: 6 });
  controller.disconnect();
});

test("resume accepts 304 semantics and snapshots only on a session mismatch", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  const apiCalls = [];
  let streamStateCalls = 0;
  const snapshots = [
    snapshot("session-a", 3),
    snapshot("session-b", 8, { executionGeneration: 7 }),
  ];
  const controller = createAgentStreamController({
    api: async (path) => {
      apiCalls.push(path);
      if (path.includes("live-snapshot")) return snapshots.shift();
      streamStateCalls += 1;
      if (streamStateCalls === 1) return { notModified: true };
      if (streamStateCalls === 2) {
        const notModified = new Error("not modified");
        notModified.status = 304;
        throw notModified;
      }
      return { protocol: 2, stream: { streamSession: "session-b", latestSequence: 8 }, executionGeneration: 7 };
    },
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    getExecutionCheckpoint: () => 7,
  });

  await controller.connect("agent-1");
  const originalSocket = FakeWebSocket.instances[0];
  await controller.resume();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(originalSocket.closed, false);

  await controller.resume();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(originalSocket.closed, false);

  await controller.resume();
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(originalSocket.closed, true);
  assert.deepEqual(controller.cursor(), { streamSession: "session-b", sequence: 8 });
  assert.equal(apiCalls.filter((path) => path.includes("live-snapshot")).length, 2);
  assert.ok(apiCalls.every((path) => !path.includes("live-snapshot") || path.endsWith("afterExecutionGeneration=7")));
  controller.disconnect();
});

test("a stream-state failure falls back to a checkpointed live snapshot", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  let snapshotCalls = 0;
  const errors = [];
  const controller = createAgentStreamController({
    api: (path) => {
      if (path.endsWith("/stream-state")) throw new Error("state unavailable");
      snapshotCalls += 1;
      return snapshot(snapshotCalls === 1 ? "session-a" : "session-b", snapshotCalls === 1 ? 2 : 9);
    },
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    getExecutionCheckpoint: () => 11,
    onError: (error) => errors.push(error.message),
  });

  await controller.connect("agent-1");
  await controller.resume();

  assert.equal(snapshotCalls, 2);
  assert.deepEqual(controller.cursor(), { streamSession: "session-b", sequence: 9 });
  assert.deepEqual(errors, ["state unavailable"]);
  assert.match(FakeWebSocket.instances[1].url, /after=9(?:&|$)/);
  controller.disconnect();
});

test("agent stream handles explicit resync_required with an authoritative snapshot", async () => {
  FakeWebSocket.instances = [];
  const timers = new FakeTimers();
  let snapshotCall = 0;
  const reasons = [];
  const controller = createAgentStreamController({
    api: async () => {
      snapshotCall += 1;
      return snapshot(`session-${snapshotCall}`, snapshotCall * 4);
    },
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    timers,
    onSnapshot: (_snapshot, detail) => reasons.push(detail.reason),
  });

  await controller.connect("agent-1");
  FakeWebSocket.instances[0].message({ type: "resync_required", protocol: 2, streamSession: "session-1", reason: "cursor_expired" });
  await settle();
  await settle();

  assert.equal(snapshotCall, 2);
  assert.deepEqual(reasons, ["initial", "cursor_expired"]);
  assert.deepEqual(controller.cursor(), { streamSession: "session-2", sequence: 8 });
  controller.disconnect();
});
