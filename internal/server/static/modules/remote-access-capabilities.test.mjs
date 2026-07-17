import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRemoteAccessFailClosed,
  directoryBrowserScope,
  filesystemScope,
  fullAccessAllowed,
  nativeDirectoryPickerAllowedFor,
  remoteAccessContext,
  terminalAccessAllowed,
} from "./remote-access-capabilities.mjs";

test("capabilities take priority for restricted and full access modes", () => {
  const restricted = {
    remoteAccess: { capabilities: { maxPermissionMode: "acceptEdits", terminalAllowed: false, filesystemScope: "project" } },
    runtimeSummary: { security: { bypassPermissionsAllowed: true, remoteTerminalAllowed: true } },
  };
  const full = { remoteAccess: { capabilities: { maxPermissionMode: "bypassPermissions", terminalAllowed: true, filesystemScope: "host" } } };

  assert.equal(fullAccessAllowed(restricted), false);
  assert.equal(terminalAccessAllowed(restricted), false);
  assert.equal(filesystemScope(restricted), "restricted");
  assert.equal(directoryBrowserScope(restricted), "default-projects");
  assert.equal(fullAccessAllowed(full), true);
  assert.equal(terminalAccessAllowed(full), true);
  assert.equal(filesystemScope(full), "full");
  assert.equal(directoryBrowserScope(full), "host");
});

test("legacy runtime security is a safe fallback when capabilities are unavailable", () => {
  const restricted = { runtimeSummary: { security: { remoteAccessRequired: true, bypassPermissionsAllowed: false, remoteTerminalAllowed: false } } };
  const local = { runtimeSummary: { security: { remoteAccessRequired: false, bypassPermissionsAllowed: true, remoteTerminalAllowed: true } } };

  assert.equal(fullAccessAllowed(restricted), false);
  assert.equal(terminalAccessAllowed(restricted), false);
  assert.equal(directoryBrowserScope(restricted), "default-projects");
  assert.equal(fullAccessAllowed(local), true);
  assert.equal(terminalAccessAllowed(local), true);
  assert.equal(directoryBrowserScope(local), "host");
});

test("native picker needs capability, loopback address, and macOS", () => {
  const state = { remoteAccess: { capabilities: { nativePickerAllowed: true } } };
  const loopback = { hostname: "127.0.0.1" };

  assert.equal(nativeDirectoryPickerAllowedFor(state, loopback, "MacIntel"), true);
  assert.equal(nativeDirectoryPickerAllowedFor(state, { hostname: "example.test" }, "MacIntel"), false);
  assert.equal(nativeDirectoryPickerAllowedFor(state, loopback, "Win32"), false);
  assert.equal(nativeDirectoryPickerAllowedFor({}, loopback, "MacIntel"), false);
});

test("missing capability data fails closed on remote locations", () => {
  const remoteLocation = { hostname: "remote.example.test" };
  const loopback = { hostname: "localhost" };

  assert.equal(remoteAccessContext({}, remoteLocation), true);
  assert.equal(fullAccessAllowed({}, remoteLocation), false);
  assert.equal(terminalAccessAllowed({}, remoteLocation), false);
  assert.equal(filesystemScope({}, remoteLocation), "restricted");
  assert.equal(fullAccessAllowed({}, loopback), true);
  assert.equal(terminalAccessAllowed({}, loopback), true);
  assert.equal(filesystemScope({}, loopback), "full");
});

test("a non-loopback page cannot be downgraded to local by stale session data", () => {
  const state = {
    remoteAccess: { session: { remote: false, authenticated: true, mode: "local" } },
    runtimeSummary: { security: { currentRequestRemote: false, remoteAccessRequired: false } },
  };
  assert.equal(remoteAccessContext(state, { hostname: "remote.example.test" }), true);
  assert.equal(remoteAccessContext(state, { hostname: "localhost" }), false);
});

test("authorization failure overrides stale full capabilities", () => {
  const state = {
    remoteAccess: {
      session: { remote: true, authenticated: true, mode: "full", expiresAt: "2026-07-17T00:00:00Z" },
      capabilities: { maxPermissionMode: "bypassPermissions", terminalAllowed: true, filesystemScope: "host", nativePickerAllowed: false, securityAdminAllowed: false },
    },
    runtimeSummary: { security: { remoteAccessRequired: true, bypassPermissionsAllowed: true, remoteTerminalAllowed: true } },
  };

  applyRemoteAccessFailClosed(state, { status: 403 });
  assert.equal(state.remoteAccess.session.authenticated, true);
  assert.equal(state.remoteAccess.session.mode, "restricted");
  assert.equal(fullAccessAllowed(state), false);
  assert.equal(terminalAccessAllowed(state), false);
  assert.equal(filesystemScope(state), "restricted");
  assert.equal(state.runtimeSummary.security.bypassPermissionsAllowed, false);

  applyRemoteAccessFailClosed(state, { status: 401 });
  assert.equal(state.remoteAccess.session.authenticated, false);
  assert.equal(state.remoteAccess.session.expiresAt, "");
});
