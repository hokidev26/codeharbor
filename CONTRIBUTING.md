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
docs/ARCHITECTURE.md  Contributor guide to request, agent, provider, and tool flow
```

Start with `docs/ARCHITECTURE.md` when changing cross-cutting behavior such as API routing, WebSocket events, provider streaming, tool execution, Git workflow, or persistence.

## Before submitting changes

Run the unified local check:

```bash
make check
```

If `make` is unavailable, run `./scripts/check.sh` directly. The check script verifies Go formatting without rewriting files, runs Go tests/vet/build, checks embedded JavaScript syntax, and runs embedded JavaScript tests. Use `make fmt` to apply Go formatting.

CI runs the same check script and also runs `golangci-lint`; keep warnings fixed before opening a pull request. Tagged releases are packaged by GoReleaser through `.github/workflows/release.yml`.

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
