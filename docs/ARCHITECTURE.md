# CodeHarbor Architecture Guide

This guide is a contributor-facing map of how a request flows through the local CodeHarbor MVP. For roadmap detail, see `PROJECT_PLAN.md`; for operational security boundaries, see `SECURITY.md`.

## High-level shape

CodeHarbor is a single local Go service with an embedded browser UI, SQLite persistence, provider adapters, and tool execution inside a bounded project workspace.

```text
Browser UI
  | HTTP /api/* + WebSocket /ws/*
  v
internal/server
  | validates local token, Origin/Sec-Fetch-Site, route params, and path boundaries
  v
internal/agent Runner + EventHub
  | persists messages/tool calls and streams events
  +--> internal/providers Provider.Generate
  |      OpenAI official, Anthropic official, OpenAI-compatible, CLIProxyAPI preset
  |
  +--> internal/tools Tool.Execute
         Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, MCPListTools, MCPCallTool
  v
internal/db SQLite store
```

## Request and event flow

### 1. Browser boot

1. `internal/server/ui.go` serves `/` and the embedded static assets.
2. The page receives a per-process local token as a JS bootstrap value and as a local cookie.
3. `internal/server/static/app.js` attaches `X-CodeHarbor-Token` to API calls and includes the same token on WebSocket URLs.

### 2. Local request guard

1. `internal/server/server.go` builds the chi router and wraps browser-originated API routes with `localRequestGuard`.
2. `internal/server/security.go` rejects cross-site browser requests using `Origin`, rejects `Sec-Fetch-Site: cross-site` even when `Origin` is absent, and requires the local token for browser-originated API requests.
3. `internal/server/ws.go` and `internal/server/terminal.go` apply the WebSocket-specific same-origin and token checks before accepting upgrades.

The guard is intended to prevent a random web page from driving the local agent through `http://localhost:7788` while the user is browsing. It is not a replacement for real multi-user authentication: any local process or user that can read the served UI can also read the bootstrap token. Before exposing CodeHarbor beyond a trusted local loopback workflow, add login sessions, scoped authorization, audit trails, and stronger secret storage.

### 3. Chat message submission

1. `POST /api/narrators/{id}/messages` is handled in `internal/server/narrator.go`.
2. The handler validates the narrator and request payload, stores the user message, then starts or resumes the agent runner.
3. The UI listens on `/ws/narrator` for `message.created`, `tool.call.*`, `run.*`, and error events.

### 4. Agent loop

1. `internal/agent/loop.go` loads narrator, project, chapter, and message history from `internal/db`.
2. It compacts older context when needed and builds a `providers.GenerateRequest` containing system prompt, messages, and tool schemas.
3. The selected provider streams `providers.Event` values back to the runner.
4. Assistant text and tool requests are persisted as messages/tool calls, then published through the event hub.

### 5. Provider adapters

Provider implementations live in `internal/providers` and all satisfy the same interface:

```go
type Provider interface {
    Name() string
    ListModels(context.Context) ([]string, error)
    Generate(context.Context, GenerateRequest) (<-chan Event, error)
}
```

Current adapters include:

- Anthropic official Messages API with SDK streaming and automatic 5m prompt-cache breakpoints for sufficiently large requests.
- OpenAI official Responses API with SDK streaming.
- OpenAI-compatible Chat Completions APIs, including the CLIProxyAPI preset.

Provider code is responsible for translating CodeHarbor's normalized message/tool representation into each upstream API shape and translating upstream deltas back into normalized events.

### 6. Tool execution and approval

Tools live in `internal/tools` and implement:

```go
type Tool interface {
    Name() string
    Description() string
    Schema() any
    Risk(json.RawMessage) Risk
    Execute(context.Context, Call, Env) (Result, error)
}
```

The runner checks each tool risk against the narrator permission mode:

- Safe read-only tools can run in less restrictive modes.
- Riskier tools such as `Write`, `Edit`, `Bash`, and stdio MCP tools may pause for approval.
- Approval decisions are posted to `POST /api/narrators/{id}/tool-calls/{toolUseId}/approval` and are sent back to the model as tool results.

Tool path handling should stay bounded to the narrator working directory or explicitly configured project boundary. Network tools must keep local/private host protections by default.

The stdio MCP client lives in `internal/mcp`. `MCPListTools` starts a configured stdio server, performs `initialize` + `tools/list`, and returns discovered tool metadata. `MCPCallTool` starts a configured stdio server, performs `initialize` + `tools/call`, and formats text content results. Both tools accept direct stdio config or a persisted `serverId` from the MCP registry. They remain `exec` risk because they launch local processes and should stay approval-gated until a finer-grained MCP policy layer exists.

### 7. MCP server registry

MCP registry handlers live in `internal/server/mcp_servers.go`:

- `GET /api/mcp/servers` lists persisted stdio MCP server entries with environment variable names only.
- `POST /api/mcp/servers`, `PATCH /api/mcp/servers/{id}`, and `DELETE /api/mcp/servers/{id}` manage local stdio server launch configuration.
- `GET /api/mcp/servers/{id}/tools` starts the registered server long enough to run `initialize` + `tools/list`, then closes it.

Registry entries are stored in SQLite `mcp_servers`. Environment variable values are local launch secrets: they are stored for process execution but are not returned by API responses. Settings → Skills → MCP can create, enable/disable, delete, and run `tools/list` discovery for registered servers. The current implementation starts a fresh stdio process per discovery or tool call; long-lived pooled MCP sessions are future work.

### 8. Git workflow

Git handlers live in `internal/server/git.go`:

- `GET /api/narrators/{id}/git/status`
- `GET /api/narrators/{id}/git/diff`
- `GET /api/narrators/{id}/git/log`
- `POST /api/narrators/{id}/git/commit`

Important invariants:

- Repository roots must resolve under the project Git path or the configured default project directory.
- Commits require an explicit `paths` list.
- The API must not silently push, amend, reset, clean, force, or stage the whole worktree.
- Unborn repositories without `HEAD` should degrade gracefully for diff/status flows.

Chapter workflow handlers live in `internal/server/chapter_workflow.go`:

- `POST /api/chapters/{id}/fork` creates a sibling Git worktree, a child chapter, and a primary narrator whose `cwd` points at that worktree.
- `GET /api/chapters/{id}/merge-check` creates a temporary detached worktree for the target head and runs a non-committing merge preflight to report conflicts without touching the real target worktree.
- `POST /api/chapters/{id}/merge` requires clean source and target worktrees, runs a no-ff merge in the target worktree, aborts and returns conflicts on merge failure, and persists merge metadata on success.

These handlers reuse the Git boundary model: repositories must stay within the project path, configured default project directory, or a CodeHarbor-created chapter worktree. Future AI conflict-resolution code should keep the same invariant.

## Persistence model

`internal/db` owns schema creation and store methods. Main entities are:

- `projects`: local workspaces.
- `chapters`: worklines, including root chapters plus fork/worktree/merge metadata.
- `narrators`: agent persona/runtime configuration for a chapter.
- `messages`: user, assistant, and tool-result transcript entries.
- `tool_calls`: pending/completed/denied tool execution records.
- `api_requests`: provider usage, latency, and estimated cost source data.
- `agent_backends`: Agent Server integration registry entries.
- `mcp_servers`: stdio MCP server registry entries used by APIs and MCP core tools.

Schema changes should include migrations or backward-compatible normalization, plus tests that cover existing config/database state where practical.

## Frontend layout

The current UI is served from `internal/server/static/index.html` and `internal/server/ui.go`. `internal/server/static/app.js` is now a tiny compatibility bootstrap that dynamically loads ES modules without a build step. The legacy UI logic lives in `internal/server/static/modules/app-main.mjs`; Agent Server backend registry/modal/Agent Admin behavior lives in `internal/server/static/modules/backend-registry.mjs`; chat sending/drafts/history/attachments/slash commands live in `internal/server/static/modules/chat-composer.mjs`; chat message rendering/approval/Markdown behavior lives in `internal/server/static/modules/chat-rendering.mjs`; directory chooser/browser/recent-directory/path formatting behavior lives in `internal/server/static/modules/directory-browser.mjs`; shared number/size/money/time formatters live in `internal/server/static/modules/formatters.mjs`; Git status/diff/log/commit modal behavior lives in `internal/server/static/modules/git-workflow.mjs`; terminal preferences/settings/WebSocket behavior lives in `internal/server/static/modules/terminal.mjs`; shared API/token/WebSocket helpers live in `internal/server/static/modules/runtime.mjs`; MCP registry form parsing helpers live in `internal/server/static/modules/mcp-registry.mjs`; backend MCP registry UI/actions live in `internal/server/static/modules/mcp-registry-ui.mjs`; Settings Models/Providers UI and model-selection helpers live in `internal/server/static/modules/model-provider-settings.mjs`; Settings local preference panels (Profile/Network Search/IM Gateway/Notifications/Appearance) rendering/actions live in `internal/server/static/modules/local-preferences-settings.mjs`; Settings system/storage/usage/users/about panels live in `internal/server/static/modules/system-settings.mjs`; Settings AI Agents/Chapters workspace panels live in `internal/server/static/modules/workspace-settings.mjs`; Settings Skills workbench rendering/actions live in `internal/server/static/modules/skills-workbench.mjs`; global shortcut/sidebar/mobile shell/project-search behavior lives in `internal/server/static/modules/ui-shell.mjs`; browser-local settings preference normalization, backup, and import behavior lives in `internal/server/static/modules/settings-preferences.mjs`; basic DOM/query/escaping/button helpers live in `internal/server/static/modules/dom.mjs`; static Settings/Skills navigation data lives in `internal/server/static/modules/settings-data.mjs`; and localStorage keys/default preference data live in `internal/server/static/modules/preferences-data.mjs`.

When adding frontend features, keep extracting stable seams out of `app-main.mjs` before adding more monolithic state:

- settings panels
- chat/rendering
- Git panel
- terminal panel
- API/WebSocket client helpers

The roadmap target remains either incremental ES modules without a build step or a full React/Vite migration.

## Validation checklist

Before submitting changes, run the unified local check:

```bash
make check
```

If `make` is unavailable, run `./scripts/check.sh` directly. The script verifies Go formatting without rewriting files, runs Go tests/vet/build, checks embedded JavaScript syntax, and runs embedded JavaScript tests. Use `make fmt` to apply Go formatting.

CI runs the same check script and additionally runs `golangci-lint`. The server package includes an end-to-end smoke for HTTP message submission, narrator WebSocket events, approval routing, Bash execution, provider feedback, and persistence. Release tags matching `v*` trigger GoReleaser to build macOS, Linux, and Windows archives.
