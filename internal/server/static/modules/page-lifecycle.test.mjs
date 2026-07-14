import test from "node:test";
import assert from "node:assert/strict";

import { createPageLifecycleController, pageLifecycleDefaults } from "./page-lifecycle.mjs";

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

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ type, ...detail });
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("visible, pageshow, and online events merge into one 500-1000ms resume", async () => {
  const timers = new FakeTimers();
  const document = new FakeEventTarget();
  const window = new FakeEventTarget();
  const navigator = { onLine: true };
  document.visibilityState = "hidden";
  const calls = [];
  const controller = createPageLifecycleController({
    document,
    window,
    navigator,
    timers,
    mergeDelayMs: 750,
    onResume: (detail) => calls.push(detail),
  });

  assert.equal(pageLifecycleDefaults.minMergeDelayMs, 500);
  assert.equal(pageLifecycleDefaults.maxMergeDelayMs, 1000);
  document.dispatch("visibilitychange");
  assert.equal(timers.tasks.size, 0);

  document.visibilityState = "visible";
  document.dispatch("visibilitychange");
  window.dispatch("pageshow", { persisted: true });
  window.dispatch("online");
  assert.equal(timers.tasks.size, 1);
  timers.advance(749);
  await settle();
  assert.equal(calls.length, 0);
  timers.advance(1);
  await settle();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].reasons, ["visible", "pageshow", "online"]);
  assert.equal(calls[0].online, true);
  assert.equal(calls[0].visible, true);

  controller.stop();
  window.dispatch("pageshow");
  timers.advance(1000);
  await settle();
  assert.equal(calls.length, 1);
});

test("offline lifecycle signals pause and online recovery remains single-flight", async () => {
  const timers = new FakeTimers();
  const document = new FakeEventTarget();
  const window = new FakeEventTarget();
  const navigator = { onLine: false };
  document.visibilityState = "visible";
  const calls = [];
  const offline = [];
  let resolveFirst;
  const controller = createPageLifecycleController({
    document,
    window,
    navigator,
    timers,
    onOffline: (detail) => offline.push(detail),
    onResume: (detail) => {
      calls.push(detail);
      if (calls.length === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return null;
    },
  });

  document.dispatch("visibilitychange");
  window.dispatch("pageshow");
  assert.equal(timers.tasks.size, 0);
  window.dispatch("offline");
  assert.equal(offline.length, 1);

  navigator.onLine = true;
  window.dispatch("online");
  timers.advance(750);
  await settle();
  assert.equal(calls.length, 1);

  document.dispatch("visibilitychange");
  window.dispatch("pageshow");
  timers.advance(750);
  await settle();
  assert.equal(calls.length, 1);

  resolveFirst();
  await settle();
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].reasons, ["visible", "pageshow"]);
  controller.dispose();
});
