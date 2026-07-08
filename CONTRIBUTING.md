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

Run:

```bash
gofmt -w ./cmd ./internal
go test ./...
go vet ./...
go build ./...
node --check internal/server/static/app.js
node --check internal/server/static/modules/app-main.mjs
node --check internal/server/static/modules/backend-registry.mjs
node --check internal/server/static/modules/chat-composer.mjs
node --check internal/server/static/modules/chat-rendering.mjs
node --check internal/server/static/modules/directory-browser.mjs
node --check internal/server/static/modules/formatters.mjs
node --check internal/server/static/modules/git-workflow.mjs
node --check internal/server/static/modules/terminal.mjs
node --check internal/server/static/modules/runtime.mjs
node --check internal/server/static/modules/mcp-registry.mjs
node --check internal/server/static/modules/mcp-registry-ui.mjs
node --check internal/server/static/modules/model-provider-settings.mjs
node --check internal/server/static/modules/local-preferences-settings.mjs
node --check internal/server/static/modules/system-settings.mjs
node --check internal/server/static/modules/workspace-settings.mjs
node --check internal/server/static/modules/skills-workbench.mjs
node --check internal/server/static/modules/ui-shell.mjs
node --check internal/server/static/modules/settings-preferences.mjs
node --check internal/server/static/modules/dom.mjs
node --check internal/server/static/modules/settings-data.mjs
node --check internal/server/static/modules/preferences-data.mjs
```

CI also runs `golangci-lint`; keep warnings fixed before opening a pull request. Tagged releases are packaged by GoReleaser through `.github/workflows/release.yml`.

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
