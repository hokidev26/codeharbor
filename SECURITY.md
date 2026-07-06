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
- Access tokens or private keys

The repository `.gitignore` excludes common local secret and runtime files, but you should still inspect commits before pushing.

## Current security boundaries

- CodeHarbor is intended for local use.
- The embedded UI is served by the same local Go service.
- Tools can interact with the local filesystem within configured working directories.
- Bash execution is permission-gated but remains powerful local code execution.
- Backend API keys are stored locally and are never returned by API responses; responses expose only whether a key is configured.

## Known hardening work

Planned security improvements include:

- Stronger local-origin and host checks
- Optional encryption for locally stored backend API keys
- A formal migration system for future schema changes
- More granular tool approval and audit trails
- Broader test coverage for filesystem and shell boundary behavior
