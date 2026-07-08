export function parseMCPWords(commandLine) {
  const matches = String(commandLine || "").trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) return part.slice(1, -1);
    return part;
  }).filter(Boolean);
}

export function parseMCPCommandLine(commandLine) {
  const parts = parseMCPWords(commandLine);
  return { command: parts[0] || "", args: parts.slice(1) };
}

export function parseMCPEnvJSON(envText) {
  const trimmed = String(envText || "").trim();
  if (!trimmed) return {};
  let env = {};
  try {
    env = JSON.parse(trimmed);
  } catch {
    throw new Error("env JSON 格式无效，请填写对象，例如 {\"TOKEN\":\"...\"}");
  }
  if (!env || Array.isArray(env) || typeof env !== "object") throw new Error("env JSON 必须是对象");
  return Object.fromEntries(Object.entries(env).filter(([key]) => String(key || "").trim() !== ""));
}

export function buildMCPRegistryPayload({ name, command, argsText, cwd, envText, enabled }) {
  const cleanCommand = String(command || "").trim();
  if (!cleanCommand) throw new Error("请填写后端 MCP command");
  return {
    name: String(name || "").trim() || cleanCommand,
    transport: "stdio",
    command: cleanCommand,
    args: parseMCPWords(argsText),
    cwd: String(cwd || "").trim(),
    env: parseMCPEnvJSON(envText),
    enabled: Boolean(enabled),
  };
}
