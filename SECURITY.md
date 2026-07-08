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
- The local token is a browser cross-site protection, not a multi-user authentication system. A process or user that can read the local UI response on the same machine can also obtain the token.
- Requests whose `Host` is not loopback, requests carrying remote forwarding headers such as `X-Forwarded-Host`, `Forwarded`, `X-Forwarded-For`, `CF-Connecting-IP`, or `Cf-Ray`, or any request while `security.exposed` / `CODEHARBOR_EXPOSED=true` is active, enter remote hardening mode. Remote hardening requires the shared `CODEHARBOR_ACCESS_PASSWORD` gate before serving the UI/API and caps permission modes at `acceptEdits` by disabling `bypassPermissions`.
- Remote hardening disables the interactive PTY terminal by default. Only enable it with `CODEHARBOR_REMOTE_TERMINAL=true` after putting the instance behind a trusted edge authentication layer.
- Remote access cookies are process-local, expire after 24 hours, rotate on restart, and can be cleared from the UI logout action. API clients may also send `Authorization: Bearer $CODEHARBOR_ACCESS_PASSWORD` or `X-CodeHarbor-Access: $CODEHARBOR_ACCESS_PASSWORD`.
- Git status/diff/log/commit and chapter workflow APIs reject repositories outside the current project path, configured default project directory, or CodeHarbor-created chapter worktree.
- Tools can interact with the local filesystem within configured working directories.
- Bash and stdio MCP execution are permission-gated but remain powerful local code execution.
- MCP registry entries can launch local stdio processes; registry API responses expose environment variable names only, not stored values.
- Backend API keys are stored locally and are never returned by API responses; responses expose only whether a key is configured.

## Remote tunnel checklist

Do not expose a raw `localhost:7788` URL to the public Internet without an authentication layer.

Recommended personal setup:

1. Configure Cloudflare Tunnel as a named tunnel, not a temporary `trycloudflare.com` URL.
2. In Cloudflare Zero Trust, create a self-hosted Access application for the tunnel hostname.
3. Add an Access policy that only allows your email, identity provider group, or one-time PIN identity.
4. Start CodeHarbor in explicit exposed mode with a second local password gate:

   ```sh
   CODEHARBOR_EXPOSED=true CODEHARBOR_ACCESS_PASSWORD='use-a-long-random-password' ./codeharbor
   ```

5. Confirm the UI header shows `隧道收紧`. In this mode `bypassPermissions` and the interactive terminal are unavailable by default; use `acceptEdits` plus approvals for Bash.
6. Only if you explicitly need a remote shell, restart with `CODEHARBOR_REMOTE_TERMINAL=true` after confirming Cloudflare Access or another edge authentication layer is active.

Cloudflare's current dashboard flow is documented in their official Zero Trust docs for creating a remote tunnel and adding a self-hosted Access application:

- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

## Known hardening work

Planned security improvements include:

- Real login sessions, per-user authorization scopes, and audit trails before exposing CodeHarbor to other users or networks
- Optional encryption for locally stored backend API keys and MCP environment values
- A formal migration system for future schema changes
- More granular tool approval and audit trails
- Broader test coverage for filesystem and shell boundary behavior
