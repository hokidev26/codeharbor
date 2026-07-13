# Autoto Security Policy

Autoto is an experimental local-first MVP for trusted local development environments. Do not expose it directly to untrusted networks. The canonical executable is `./autoto`; `./codeharbor` remains only as a legacy compatibility shim.

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
- Telegram bot tokens or Home Assistant access tokens
- Access tokens or private keys

Autoto stores its default config at `~/.autoto/config.json` and its database at `~/.autoto/autoto.db`. On first use, a legacy `~/.codeharbor/config.json` is copied into the canonical config location when it exists; review that copied configuration before sharing it. The repository `.gitignore` excludes common local secret and runtime files, but you should still inspect commits before pushing.

Telegram and Home Assistant connection metadata must reference secrets as `env:VARIABLE_NAME`; plaintext connection tokens are rejected. Public integration responses expose only whether a logical secret field is configured, never the environment-variable name or resolved value. If a Telegram bot token may have leaked, rotate it and pair again: token revision changes revoke stale pairings. Also revoke any affected pairing explicitly from the local UI/API. If a Home Assistant token may have leaked, rotate the referenced environment value and disable/delete or restart/retest the connection as appropriate; Home Assistant does not use channel pairings.

## Legacy compatibility and deprecation logs

Canonical Autoto inputs always take precedence when canonical and legacy forms are both present. Until removal, old CodeHarbor names are accepted only for compatibility reads, one-time migration, or route/header/cookie aliases; new configuration, responses, examples, and clients must write canonical Autoto names.

Deprecation warnings may record that a successfully used legacy command, fallback, credential alias class, or its canonical replacement was selected, but they must never record token, password, cookie, Authorization header, API key, MCP environment value, or other secret values. Warnings are deduplicated once per process or compatibility key so repeated requests do not amplify sensitive operational metadata; invalid credentials and canonical-preferred paths do not emit legacy-use warnings.

The removal schedule and gates are defined only in `PROJECT_PLAN.md`: no runtime legacy surface is removed before v0.4.0 or before at least two tagged releases of migration runway.

## Current security boundaries

- Autoto is intended for local use. The embedded UI is served by the same local Go service.
- Telegram is the only inbound channel. Runtime ingress uses Bot API `getUpdates` long polling only; Autoto does not expose a Telegram webhook receiver. Slack and Discord are not implemented.
- Telegram accepts private-chat `/pair <code>`, `/status`, `/approve <toolCallId>` with fixed one-time `allow_once` semantics, and `/deny <toolCallId> [reason]`. There is no `/task`, free-form assistant chat, permission-mode command, or terminal command. The literal command is `/approve`; there is no separate `/approve-once` spelling.
- Pairing codes are short-lived and stored only as hashes. Active pairings bind a Telegram chat/user, Agent, connection, and bot-credential revision. Unpaired commands and failed pairing attempts produce no Telegram response; accepted updates and denials are persisted as channel events/audit records. Repeated pairing failures lock the pending pairing, and paired chats are rate-limited.
- Telegram update IDs and offsets are persisted transactionally as channel events/cursors, so restart replay is idempotent for the same connection. This channel durability is separate from Agent WebSocket replay, which remains process-local and in-memory.
- Telegram approval is never a privilege escalation: it can only apply a one-time decision to an existing pending tool call and cannot approve `danger` risk. It cannot change permission modes, enable `bypassPermissions`, open a terminal, create a task/run, or control a device.
- Browser-originated API calls must pass a per-process local token injected into the UI; cross-site `Origin` requests are rejected, and `Sec-Fetch-Site: cross-site` is rejected even when `Origin` is absent.
- `X-Autoto-Token` is the canonical browser API and WebSocket token header. `X-CodeHarbor-Token` is accepted only for legacy-client compatibility; WebSocket clients may also provide the local token through the `token` query parameter.
- The local token is a browser cross-site protection, not a multi-user authentication system. A process or user that can read the local UI response on the same machine can also obtain the token.
- Requests whose `Host` is not loopback, requests carrying remote forwarding headers such as `X-Forwarded-Host`, `Forwarded`, `X-Forwarded-For`, `CF-Connecting-IP`, or `Cf-Ray`, or any request while `security.exposed` / `AUTOTO_EXPOSED=true` is active, enter remote hardening mode. `CODEHARBOR_EXPOSED` remains a legacy fallback, but `AUTOTO_EXPOSED` takes precedence when both are set.
- Remote hardening requires `AUTOTO_ACCESS_PASSWORD` before serving the UI or API and caps permission modes at `acceptEdits` by disabling `bypassPermissions`. `CODEHARBOR_ACCESS_PASSWORD` is accepted only as a legacy fallback; `AUTOTO_ACCESS_PASSWORD` wins when both are set.
- Remote hardening disables the interactive PTY terminal by default. Enable it only with `AUTOTO_REMOTE_TERMINAL=true` after putting the instance behind a trusted edge authentication layer. `CODEHARBOR_REMOTE_TERMINAL` is the legacy fallback.
- Remote access cookies are process-local, expire after 24 hours, rotate on restart, and can be cleared from the UI logout action. The canonical cookie is `autoto_remote_access`; the legacy `codeharbor_remote_access` cookie is accepted and cleared for compatibility. API clients may send `Authorization: Bearer $AUTOTO_ACCESS_PASSWORD` or the canonical `X-Autoto-Access: $AUTOTO_ACCESS_PASSWORD`; `X-CodeHarbor-Access` remains a legacy header alias.
- Schedule definitions accept only `readOnly` or `acceptEdits`. The selected mode is persisted as a run permission cap and cannot widen the Agent's current permission. If the Agent already has a pending/running manual run, the schedule is recorded as skipped; it does not cancel or replace that run.
- Notification deliveries are persisted with deduplication, leases, bounded exponential backoff, attempt counts, latest failure metadata, and terminal `delivered`/`dead` states. Webhook/Telegram delivery failures do not block the Agent loop. Stored payloads and errors are bounded and redacted, but operators should still treat notification history as sensitive operational metadata.
- Home Assistant connections must use loopback, `.local`, link-local, or private-network hosts. Redirects are disabled so the bearer token cannot be forwarded to another host. State/entity listing is read-only and exposes only whitelisted scalar attributes.
- Home Assistant state changes are not a generic service-call proxy. Only the fixed action catalog is accepted, inputs reject unknown fields/templates/secret keys, and execution requires an unchanged canonical action. A request expires quickly, the Web UI asks for two confirmations, and final approval must come directly from loopback without forwarding headers.
- Unknown or critical device actions are hard-blocked before a request is created. This includes door unlock, alarm, script/automation trigger, shell command, camera snapshot, notify, and unlisted services. IM cannot create, approve, deny, or execute device actions. Generic IoT/camera control and cloud monitoring are not implemented.
- Git status/diff/log/commit and workline workflow APIs reject repositories outside the current project path, configured default project directory, or an Autoto-created workline worktree under `.autoto-worktrees`.
- `Read`, `Write`, `Edit`, `Glob`, and `Grep` hard-block or omit sensitive paths such as `.env*`, credentials/secrets, common private keys, and `.git`. Symlink escapes are also rejected. Bash and stdio MCP are not covered by that filename filter; they are permission-gated but remain powerful local code execution.
- MCP registry entries can launch local stdio processes; registry API responses expose environment variable names only, not stored values.
- Backend API keys are stored locally and are never returned by API responses; responses expose only whether a key is configured.
- The monitoring snapshot aggregates local runtime/database counters. It is not a hosted or cloud monitoring system and should remain available only to trusted local users.

## Remote tunnel checklist

Do not expose a raw `localhost:7788` URL to the public Internet without an authentication layer.

Recommended personal setup:

1. Configure Cloudflare Tunnel as a named tunnel, not a temporary `trycloudflare.com` URL.
2. In Cloudflare Zero Trust, create a self-hosted Access application for the tunnel hostname.
3. Add an Access policy that only allows your email, identity provider group, or one-time PIN identity.
4. Start Autoto in explicit exposed mode with a second local password gate:

   ```sh
   AUTOTO_EXPOSED=true AUTOTO_ACCESS_PASSWORD='use-a-long-random-password' ./autoto
   ```

5. Confirm the UI header shows `隧道收紧`. In this mode `bypassPermissions` and the interactive terminal are unavailable by default; use `acceptEdits` plus approvals for Bash.
6. Only if you explicitly need a remote shell, restart with `AUTOTO_REMOTE_TERMINAL=true ./autoto` after confirming Cloudflare Access or another edge authentication layer is active.

Cloudflare's current dashboard flow is documented in their official Zero Trust docs for creating a remote tunnel and adding a self-hosted Access application:

- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

## Known hardening work

Planned security improvements include:

- Real login sessions and per-user authorization scopes before exposing Autoto to other users or networks
- Optional encryption for locally stored backend API keys and MCP environment values
- Broader audit/search/retention controls for automation, channel, and notification history
- More granular tool approval and stronger shell/MCP containment; sensitive-path filtering alone does not sandbox executable tools
- Broader test coverage for filesystem, shell, integration-network, and restart-recovery boundaries
- Security review before adding `/task`, Slack/Discord, any generic IoT adapter, camera actions, door unlock, or cloud monitoring; these remain unimplemented
