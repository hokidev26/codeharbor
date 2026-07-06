# Contributing

Thanks for your interest in CodeHarbor. The project is an early local-first Go MVP, so small focused changes are preferred.

## Development setup

Run the app locally:

```bash
go run ./cmd/codeharbor
```

Open:

```text
http://localhost:7788
```

## Project layout

```text
cmd/codeharbor        Application entrypoint
internal/config       Defaults and config loading
internal/db           SQLite schema and persistence
internal/agent        Agent runner and event hub
internal/providers    Model provider integrations
internal/tools        Core coding tools
internal/server       HTTP, WebSocket, static UI, backend registry
```

## Before submitting changes

Run:

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
go build ./...
node --check internal/server/static/app.js
```

## Commit hygiene

- Keep commits focused.
- Do not commit local build outputs such as `/codeharbor`.
- Do not commit `.env`, local databases, config files with credentials, or API keys.
- Update `PROJECT_PLAN.md` or `README.md` when behavior changes.

## Testing guidance

Prefer tests that do not require external model providers. Use fakes or `httptest.Server` for provider and HTTP behavior where possible.

Useful areas for coverage:

- Config loading and secret persistence behavior
- SQLite store behavior
- Tool path boundaries and risk classification
- Agent loop behavior with fake providers
- HTTP handler behavior
- Backend registry health checks
