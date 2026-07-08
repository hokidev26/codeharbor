# Security Policy

CodeHarbor is currently an experimental local-first MVP. It is designed for trusted local development environments and should not be exposed directly to untrusted networks.

## Reporting a vulnerability

If you find a security issue, please report it privately to the repository owner instead of opening a public issue with exploit details.

Include:

- A clear description of the issue
- Steps to reproduce
- Affected commit or version
- Expected and actual behavior
- Any relevant logs with secrets removed

## Secret handling

Do not commit:

- `.env` or `.env.*`
- Local config files containing credentials
- SQLite databases
- Provider API keys
- Agent Server backend API keys
- MCP server environment values or tokens
- Access tokens or private keys

The repository `.gitignore` excludes common local secret and runtime files, but you should still inspect commits before pushing.

## Current security boundaries

- CodeHarbor is intended for local use.
- The embedded UI is served by the same local Go service.
- Browser-originated API calls must pass a per-process local token injected into the UI; cross-site `Origin` requests are rejected, and `Sec-Fetch-Site: cross-site` is rejected even when `Origin` is absent.
- WebSocket upgrades require the same local token and same-origin checks before the connection is accepted.
- Git status/diff/log/commit and chapter workflow APIs reject repositories outside the current project path, configured default project directory, or CodeHarbor-created chapter worktree.
- Tools can interact with the local filesystem within configured working directories.
- Bash and stdio MCP execution are permission-gated but remain powerful local code execution.
- MCP registry entries can launch local stdio processes; registry API responses expose environment variable names only, not stored values.
- Backend API keys are stored locally and are never returned by API responses; responses expose only whether a key is configured.

## Known hardening work

Planned security improvements include:

- Optional encryption for locally stored backend API keys and MCP environment values
- A formal migration system for future schema changes
- More granular tool approval and audit trails
- Broader test coverage for filesystem and shell boundary behavior
