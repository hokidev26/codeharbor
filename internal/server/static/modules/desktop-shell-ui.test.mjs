import test from "node:test";
import assert from "node:assert/strict";
import {
  installDesktopDeepLinkRouter,
  parseDesktopHash,
} from "./desktop-shell-ui.mjs";

test("parseDesktopHash maps shell targets", () => {
  assert.deepEqual(parseDesktopHash("#settings=remote-access"), {
    kind: "settings",
    panel: "remote-access",
  });
  assert.deepEqual(parseDesktopHash("#agent=abc"), { kind: "agent", id: "abc" });
  assert.deepEqual(parseDesktopHash("#project=p1"), { kind: "project", id: "p1" });
  assert.deepEqual(parseDesktopHash("#conversation=c1"), { kind: "conversation", id: "c1" });
  assert.deepEqual(parseDesktopHash("#settings"), { kind: "settings", panel: "providers" });
  assert.equal(parseDesktopHash(""), null);
  assert.equal(parseDesktopHash("#"), null);
});

test("installDesktopDeepLinkRouter dispatches openSettings", () => {
  const previous = globalThis.window;
  const previousLocation = globalThis.location;
  const listeners = new Map();
  const calls = [];
  globalThis.window = {
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  globalThis.location = { hash: "#settings=remote-access" };
  globalThis.queueMicrotask = (fn) => fn();
  try {
    const dispose = installDesktopDeepLinkRouter({
      openSettings: (panel) => calls.push(["settings", panel]),
      openAgent: (id) => calls.push(["agent", id]),
    });
    assert.deepEqual(calls, [["settings", "remote-access"]]);
    globalThis.location.hash = "#agent=x";
    listeners.get("hashchange")?.();
    assert.deepEqual(calls[1], ["agent", "x"]);
    dispose();
  } finally {
    globalThis.window = previous;
    globalThis.location = previousLocation;
    delete globalThis.queueMicrotask;
  }
});
