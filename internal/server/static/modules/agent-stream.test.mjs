import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentStreamPath, createAgentStreamController } from "./agent-stream.mjs";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  message(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  serverClose() {
    this.onclose?.({});
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("agent stream resume URL includes protocol, session, and sequence", () => {
  assert.equal(buildAgentStreamPath("agent/1"), "/ws/agent?id=agent%2F1&protocol=2");
  assert.equal(buildAgentStreamPath("agent/1", { streamSession: "session-a", sequence: 7 }), "/ws/agent?id=agent%2F1&protocol=2&streamSession=session-a&after=7");
});

test("agent stream applies ordered events once and snapshots on a sequence gap", async () => {
  FakeWebSocket.instances = [];
  const snapshots = [
    { protocol: 2, agent: { id: "agent-1" }, messages: [], pendingApprovals: [], stream: { streamSession: "session-a", latestSequence: 2 } },
    { protocol: 2, agent: { id: "agent-1" }, messages: [{ id: "m-1" }], pendingApprovals: [], stream: { streamSession: "session-b", latestSequence: 10 } },
  ];
  const appliedSnapshots = [];
  const events = [];
  const controller = createAgentStreamController({
    api: async () => snapshots.shift(),
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    onSnapshot: (snapshot) => appliedSnapshots.push(snapshot.stream.streamSession),
    onEvent: (event) => events.push(event.sequence),
    reconnectBaseMs: 1,
    reconnectMaxMs: 1,
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

test("agent stream handles explicit resync_required with an authoritative snapshot", async () => {
  FakeWebSocket.instances = [];
  let snapshotCall = 0;
  const reasons = [];
  const controller = createAgentStreamController({
    api: async () => {
      snapshotCall += 1;
      return {
        protocol: 2,
        agent: { id: "agent-2" },
        messages: [],
        pendingApprovals: [],
        stream: { streamSession: `session-${snapshotCall}`, latestSequence: snapshotCall * 4 },
      };
    },
    webSocketURL: (path) => `ws://example.test${path}`,
    WebSocketImpl: FakeWebSocket,
    onSnapshot: (_snapshot, detail) => reasons.push(detail.reason),
    reconnectBaseMs: 1,
    reconnectMaxMs: 1,
  });

  await controller.connect("agent-2");
  FakeWebSocket.instances[0].message({ type: "resync_required", protocol: 2, streamSession: "session-1", reason: "cursor_expired" });
  await settle();
  await settle();

  assert.equal(snapshotCall, 2);
  assert.deepEqual(reasons, ["initial", "cursor_expired"]);
  assert.deepEqual(controller.cursor(), { streamSession: "session-2", sequence: 8 });
  controller.disconnect();
});
