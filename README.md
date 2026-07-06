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
- Core tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
- WebSocket agent event stream: `/ws/narrator`
- Interactive PTY terminal WebSocket: `/ws/terminal`
- Filesystem browse/preview/mkdir APIs
- Agent Server backend registry with health checks for compatible OpenHands Agent Server endpoints
- Development-time dependency license endpoint: `/api/licenses`

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
```

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
GET  /api/licenses

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

See `SECURITY.md` for reporting and operational guidance.

## Third-party notices

See `THIRD_PARTY_NOTICES.md` for the initial direct dependency notice. It is a development aid and not legal advice. Before formal distribution, regenerate a complete transitive dependency notice with a license scanner such as `go-licenses`.

## Roadmap

See `PROJECT_PLAN.md` for the current implementation plan, known limitations, and next milestones.

## License

CodeHarbor is licensed under the MIT License. See `LICENSE`.
