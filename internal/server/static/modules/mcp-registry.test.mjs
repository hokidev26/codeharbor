import test from "node:test";
import assert from "node:assert/strict";

import { buildMCPRegistryPayload, parseMCPCommandLine, parseMCPEnvJSON, parseMCPWords } from "./mcp-registry.mjs";

test("parseMCPWords handles simple shell-like quoted words", () => {
  assert.deepEqual(parseMCPWords("npx '@scope/server fs' \"~/projects demo\""), ["npx", "@scope/server fs", "~/projects demo"]);
  assert.deepEqual(parseMCPWords("   "), []);
});

test("parseMCPCommandLine splits command and args", () => {
  assert.deepEqual(parseMCPCommandLine("node server.js --stdio"), { command: "node", args: ["server.js", "--stdio"] });
  assert.deepEqual(parseMCPCommandLine(""), { command: "", args: [] });
});

test("parseMCPEnvJSON accepts object values and drops empty keys", () => {
  assert.deepEqual(parseMCPEnvJSON('{"TOKEN":"secret","":"ignored"}'), { TOKEN: "secret" });
  assert.deepEqual(parseMCPEnvJSON(""), {});
  assert.throws(() => parseMCPEnvJSON("[]"), /必须是对象/);
  assert.throws(() => parseMCPEnvJSON("not json"), /格式无效/);
});

test("buildMCPRegistryPayload normalizes registry form values", () => {
  assert.deepEqual(buildMCPRegistryPayload({
    name: "",
    command: " npx ",
    argsText: "@modelcontextprotocol/server-filesystem ~/projects",
    cwd: " /tmp/demo ",
    envText: '{"TOKEN":"secret"}',
    enabled: false,
  }), {
    name: "npx",
    transport: "stdio",
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem", "~/projects"],
    cwd: "/tmp/demo",
    env: { TOKEN: "secret" },
    enabled: false,
  });
  assert.throws(() => buildMCPRegistryPayload({ command: "" }), /请填写后端 MCP command/);
});
