import test from "node:test";
import assert from "node:assert/strict";

import { setUILocale } from "./i18n.mjs";
import { buildMCPRegistryPayload, parseMCPCommandLine, parseMCPEnvJSON, parseMCPWords } from "./mcp-registry.mjs";
import { createMCPRegistryUIController } from "./mcp-registry-ui.mjs";

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

test("MCP validation follows the active UI locale", () => {
  setUILocale("en");
  try {
    assert.throws(() => parseMCPEnvJSON("[]"), /Environment JSON must be an object/);
    assert.throws(() => buildMCPRegistryPayload({ command: "" }), /Enter a backend MCP command/);
  } finally {
    setUILocale("zh-CN");
  }
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

test("MCP registry UI translates controls while preserving command, environment, and path values", () => {
  setUILocale("en");
  try {
    const controller = createMCPRegistryUIController({
      state: {
        activeSettingsPanel: "",
        activeSkillTab: "",
        mcpRegistryActionBusy: {},
        mcpRegistryLoaded: true,
        mcpRegistryLoading: false,
        mcpRegistryError: "",
        mcpRegistryServers: [{
          id: "server-1",
          name: "<Local MCP>",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["server.js"],
          envKeys: ["TOKEN"],
          cwd: "/tmp/demo",
        }],
        mcpRegistryTools: { "server-1": { tools: [{ name: "read_file" }] } },
      },
      currentSkillsPreferences: () => ({ mcpServers: [] }),
    });
    const html = controller.renderMCPRegistryList();
    assert.match(html, /Enabled/);
    assert.match(html, /Discover tools/);
    assert.match(html, /env: TOKEN/);
    assert.match(html, /cwd: \/tmp\/demo/);
    assert.match(html, /&lt;Local MCP&gt;/);
    assert.match(html, /settings-data-list/);
    assert.match(html, /settings-card/);
  } finally {
    setUILocale("zh-CN");
  }
});
