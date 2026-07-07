# CodeHarbor

CodeHarbor is a local-first Go MVP for an AI coding agent server. It ships as a single Go service with SQLite persistence, provider abstractions, core coding tools, WebSocket events, a PTY terminal bridge, an Agent Server backend registry, and a simple embedded web UI.

The project is currently an experimental MVP. It is intended for local development and iteration, not for untrusted multi-user or production deployments.

## Features

- Local HTTP server with embedded HTML/CSS/JS UI
- SQLite persistence for projects, chapters, narrators, messages, tool calls, and backend registry entries
- Provider abstraction for:
  - OpenAI official Responses API
  - Anthropic official Messages API
  - OpenAI-compatible Chat Completions APIs
  - CLIProxyAPI local OpenAI-compatible preset
- Core tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
- WebSocket agent event stream: `/ws/narrator` with Settings → AI Agents current narrator controls for model, permission mode, and working directory
- Settings → Chapters & Containers project workline view backed by existing project chapter and narrator APIs
- Interactive PTY terminal WebSocket: `/ws/terminal` with Settings → Terminal management controls and browser-local retention/focus preferences
- Filesystem browse/preview/mkdir APIs
- Agent Server backend registry with sidebar and Settings → Agent Admin management UI for compatible OpenHands Agent Server endpoints
- Settings modal search/filter with keyboard focus shortcut for quickly locating growing product configuration panels
- Chat message copy actions for exporting individual messages and the current conversation as Markdown
- Browser-local chat draft autosave/restore per narrator, including migration through local preference backups
- Browser-local prompt history for the chat composer, with empty-input ↑/↓ recall and migration through local preference backups
- Chat composer slash command palette backed by enabled local Skills command templates
- Browser-local Settings → Profile preferences for display identity, avatar initials, workspace label, and Git identity helpers
- Browser-local Settings → Network Search policy preferences for provider presets, result limits, confirmation, and domain rules
- Browser-local Settings → IM Gateway integration policy preferences for webhook/bot presets, confirmation, signatures, redaction, and event routing
- Browser-local Settings → Skills workbench for slash command templates, MCP server drafts, tool policy notes, and JSON export
- Browser-local Settings → Notifications preferences for toast categories, display duration, and UI terminal notices
- Browser-local Settings → Appearance preferences for theme, density, terminal default visibility, and agent event log display
- Runtime summary endpoint and Settings → Servers/System + Runtime panels for process, Go runtime, paths, and agent limits
- Settings → Users read-only auth status panel backed by `/api/auth/status`
- Local storage summary endpoint and Settings → Storage panel for config, database, home, and project directory footprint
- Local usage summary endpoint and Settings → Usage panel for projects, messages, tool calls, model requests, backends, and background tasks
- Settings → About dependency license panel backed by the development-time `/api/licenses` endpoint
- Settings → About browser-local preferences backup/import for migrating profile, skills, chat drafts, prompt history, search, IM, notification, appearance, terminal, recent directory, model, and relay protocol settings

## Requirements

- Go 1.26 or newer, as declared in `go.mod`
- SQLite is provided through the pure-Go `modernc.org/sqlite` driver
- Node.js is optional and only used for `node --check internal/server/static/app.js` during validation

## Quick start

```bash
go run ./cmd/codeharbor
```

Then open:

```text
http://localhost:7788
```

Default paths:

```text
Config:   ~/.codeharbor/config.json
Database: ~/.codeharbor/codeharbor.db
Projects: ~/projects
```

You can pass a custom config path:

```bash
go run ./cmd/codeharbor --config /path/to/config.json
```

## Configuration

On first run, CodeHarbor creates a local config file if it does not exist. Runtime secrets can be supplied through environment variables.

Agent model environment variables:

```text
CODEHARBOR_DEFAULT_MODEL
CODEHARBOR_SUMMARY_MODEL
```

Provider environment variables:

```text
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
OPENAI_BASE_URL
OPENAI_COMPATIBLE_BASE_URL
OPENAI_COMPATIBLE_API_KEY
OPENAI_COMPATIBLE_MODEL
CLIPROXYAPI_BASE_URL
CLIPROXYAPI_API_KEY
CLIPROXYAPI_MODEL
CLIPROXYAPI_MANAGEMENT_KEY
CLIPROXYAPI_BIN
CLIPROXYAPI_CONFIG
```

### CLIProxyAPI preset

CodeHarbor includes a built-in `cliproxyapi` provider profile for local [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) instances:

```text
Provider: cliproxyapi
Type:     openai-compatible
Base URL: http://127.0.0.1:8317/v1
Model:    gpt-5.5
```

Start CLIProxyAPI, then use **Settings → Providers → Codex 凭证 + 中转站** inside CodeHarbor. Codex now uses credential import only: paste a Codex auth JSON, refresh token list, or token/account rows and import them directly into CLIProxyAPI; CodeHarbor refreshes CLIProxyAPI auth files and `/v1/models` afterwards. The same page also includes an embedded relay/provider form for API Key, Base URL, protocol selection, and default model. Saving the form updates CodeHarbor's runtime provider registry immediately and persists non-secret provider settings to `config.json`; API keys are intentionally not written to disk. You can pick a preferred model before creating a project, and CodeHarbor will use it for the new narrator. To make new projects use the preset by default, start CodeHarbor with `CODEHARBOR_DEFAULT_MODEL=cliproxyapi:gpt-5.5`. If your CLIProxyAPI config enables client `api-keys`, export `CLIPROXYAPI_API_KEY` before starting CodeHarbor. You can override the local endpoint or fallback model with `CLIPROXYAPI_BASE_URL` and `CLIPROXYAPI_MODEL`. CodeHarbor uses `CLIPROXYAPI_MANAGEMENT_KEY` for local management API calls; local previews default to `codeharbor-local`.

Agent Server backend seed variables:

```text
CODEHARBOR_AGENT_BACKEND_URL
CODEHARBOR_AGENT_BACKEND_NAME
CODEHARBOR_AGENT_BACKEND_KIND
CODEHARBOR_AGENT_BACKEND_API_KEY
OPENHANDS_AGENT_SERVER_URL
OPENHANDS_SESSION_API_KEY
AGENT_SERVER_URL
AGENT_SERVER_API_KEY
```

If a backend URL is configured, CodeHarbor seeds the backend registry on first startup. Local backends use `X-Session-API-Key`; cloud backends use `Authorization: Bearer ...`.

## API overview

Core routes include:

```text
GET  /api/health
GET  /api/auth/status
GET  /api/settings
GET  /api/models
GET  /api/licenses
GET  /api/runtime/summary
GET  /api/storage/summary
GET  /api/usage/summary

PUT  /api/providers/{name}/config

GET  /api/providers/cliproxyapi/auth-files
POST /api/providers/cliproxyapi/auth-files/import

GET    /api/backends
POST   /api/backends
GET    /api/backends/{id}
PATCH  /api/backends/{id}
DELETE /api/backends/{id}
POST   /api/backends/{id}/activate
GET    /api/backends/{id}/health

GET  /api/projects
POST /api/projects
GET  /api/projects/{id}
GET  /api/projects/{id}/chapters

GET  /api/chapters/{id}
GET  /api/chapters/{id}/narrators

GET   /api/narrators/{id}
PATCH /api/narrators/{id}/cwd
PATCH /api/narrators/{id}/model
PATCH /api/narrators/{id}/permission-mode
GET   /api/narrators/{id}/messages
POST  /api/narrators/{id}/messages
GET   /api/narrators/{id}/tools
POST  /api/narrators/{id}/tool-calls
GET   /api/narrators/{id}/tool-calls/{toolUseId}

GET  /api/fs/browse?path=...
GET  /api/fs/directories?path=...
GET  /api/fs/preview?path=...
POST /api/fs/mkdir

GET  /ws/narrator?id={narratorId}
GET  /ws/terminal?narratorId={narratorId}
```

## Validation

Before committing changes, run:

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
go build ./...
node --check internal/server/static/app.js
```

## Security notes

CodeHarbor is a local development MVP.

- Do not commit `.env`, local config files, SQLite databases, or API keys.
- The embedded UI and APIs are intended for trusted local use.
- Tools can read and write local files within their configured working directories.
- Bash execution is intentionally restricted by permission mode, but it should still be treated as powerful local code execution.
- Backend API keys are not returned by the public API; responses only include `apiKeyConfigured`.
- Runtime and storage summary APIs intentionally expose local paths and process diagnostics, so keep the service bound to trusted local users.

See `SECURITY.md` for reporting and operational guidance.

## Third-party notices

See `THIRD_PARTY_NOTICES.md` for the initial direct dependency notice. It is a development aid and not legal advice. Before formal distribution, regenerate a complete transitive dependency notice with a license scanner such as `go-licenses`.

## Roadmap

See `PROJECT_PLAN.md` for the current implementation plan, known limitations, and next milestones.

## License

CodeHarbor is licensed under the MIT License. See `LICENSE`.
