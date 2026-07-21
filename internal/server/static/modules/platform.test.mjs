import test from "node:test";
import assert from "node:assert/strict";
import {
  alert,
  confirm,
  createConfirmAction,
  installDesktopShellDialogs,
  isDesktopShell,
  pickDirectory,
  pickFile,
  resetPlatformDialogs,
  setPlatformDialogs,
} from "./platform.mjs";

test("platform confirm defaults to window.confirm", async () => {
  resetPlatformDialogs();
  let seen = "";
  const previous = globalThis.window;
  globalThis.window = {
    confirm(message) {
      seen = message;
      return true;
    },
  };
  try {
    assert.equal(await confirm("delete?"), true);
    assert.equal(seen, "delete?");
  } finally {
    globalThis.window = previous;
    resetPlatformDialogs();
  }
});

test("platform dialogs can be swapped for desktop shells", async () => {
  resetPlatformDialogs();
  const calls = [];
  setPlatformDialogs({
    confirm: async (message) => {
      calls.push(["confirm", message]);
      return false;
    },
    alert: async (message) => {
      calls.push(["alert", message]);
    },
  });
  try {
    assert.equal(await confirm("sure"), false);
    await alert("done");
    assert.deepEqual(calls, [
      ["confirm", "sure"],
      ["alert", "done"],
    ]);
  } finally {
    resetPlatformDialogs();
  }
});

test("createConfirmAction wraps platform confirm", async () => {
  resetPlatformDialogs();
  setPlatformDialogs({ confirm: async () => true });
  try {
    const confirmAction = createConfirmAction();
    assert.equal(await confirmAction("ok"), true);
  } finally {
    resetPlatformDialogs();
  }
});

test("isDesktopShell reads host markers", () => {
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    assert.equal(isDesktopShell(), false);
    globalThis.window.AUTOTO_DESKTOP_SHELL = true;
    assert.equal(isDesktopShell(), true);
  } finally {
    globalThis.window = previous;
  }
});

test("installDesktopShellDialogs posts to shell endpoints", async () => {
  resetPlatformDialogs();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const posts = [];
  globalThis.window = {
    AUTOTO_DESKTOP_SHELL: true,
    AUTOTO_LOCAL_TOKEN: "tok-test",
    confirm() {
      throw new Error("browser confirm should not run");
    },
  };
  globalThis.fetch = async (path, init) => {
    posts.push({ path, init });
    if (String(path).includes("/confirm")) {
      return {
        ok: true,
        async json() {
          return { ok: true, accepted: true };
        },
      };
    }
    if (String(path).includes("/open-directory")) {
      return {
        ok: true,
        async json() {
          return { ok: true, canceled: false, path: "/tmp/proj" };
        },
      };
    }
    if (String(path).includes("/open-file")) {
      return {
        ok: true,
        async json() {
          return { ok: true, canceled: false, path: "/tmp/a.json" };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  };
  try {
    assert.equal(installDesktopShellDialogs(), true);
    assert.equal(await confirm("wipe?"), true);
    await alert("done");
    const dir = await pickDirectory({ title: "Folder", defaultPath: "/tmp" });
    assert.equal(dir.path, "/tmp/proj");
    const file = await pickFile({ title: "File", filters: [{ name: "JSON", pattern: "*.json" }] });
    assert.equal(file.path, "/tmp/a.json");
    assert.equal(posts.length, 4);
    assert.equal(posts[0].path, "/api/desktop/dialog/confirm");
    assert.equal(posts[0].init.headers["X-Autoto-Token"], "tok-test");
    assert.equal(posts[1].path, "/api/desktop/dialog/alert");
    assert.equal(posts[2].path, "/api/desktop/dialog/open-directory");
    assert.equal(posts[3].path, "/api/desktop/dialog/open-file");
    const body = JSON.parse(posts[0].init.body);
    assert.equal(body.message, "wipe?");
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    resetPlatformDialogs();
  }
});
