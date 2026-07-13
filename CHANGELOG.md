# Autoto Changelog

All notable changes to Autoto are tracked here. The project is still an experimental local-first MVP, so entries focus on user-visible behavior, security boundaries, and contributor-facing workflow changes.

## Unreleased

### Branding and compatibility

- Renamed the current product to **Autoto**. The canonical Go module and CLI are `autoto` and `cmd/autoto` / `autoto`; `cmd/codeharbor` remains a legacy compatibility shim.
- Moved default runtime state to `~/.autoto/config.json` and `~/.autoto/autoto.db`. When the canonical config is absent, a legacy `~/.codeharbor/config.json` is copied forward for compatibility.
- Made `AUTOTO_*` environment variables and `X-Autoto-*` headers canonical. Corresponding `CODEHARBOR_*`, `X-CodeHarbor-*`, and legacy remote-access cookie names remain accepted only for migration compatibility.
- Legacy compatibility actually used at runtime now warns once per process/compatibility key: the `codeharbor` CLI shim, effective `CODEHARBOR_*` or legacy-config fallback, successful legacy token/access header or cookie use, and the successful CLIProxyAPI legacy management-credential fallback report their canonical replacement. Canonical values suppress fallback warnings, invalid credentials do not warn, and logs never include token, password, cookie, API-key, or credential values.
- Defined the legacy compatibility lifecycle in `PROJECT_PLAN.md`: canonical names win, legacy aliases are compatibility reads/forwards only, removal is no earlier than v0.4.0, and every runtime surface requires at least two tagged releases of migration runway plus the documented deletion gates. The explicit response-write exception is `window.CODEHARBOR_LOCAL_TOKEN`: the server still injects it with the same value as canonical `window.AUTOTO_LOCAL_TOKEN`, and `runtime.mjs` reads it only as a fallback until first-party runtime no longer depends on it and the old-UI migration window is complete.
- Historical entries below intentionally retain pre-rename CodeHarbor terminology, endpoint names, commit messages, and other recorded facts; they are legacy history rather than current naming guidance.

### Added

- Added a frontend Run Summary card that loads completed/error/interrupted run summaries, shows tool/message/token/cost metrics, and links the review flow to the existing Git changes modal.
- Added streaming Bash tool output over Agent WebSocket events, with a live output card in the chat UI while commands run.
- Added persisted Webhook task notifications for approval, completion, interruption, superseded, and error events, including settings/test APIs and a Settings UI block. These are outbound notifications; no inbound IM Gateway is implemented.
- Added Agent stream protocol 2 with per-process stream sessions and monotonic sequences, bounded in-memory replay, explicit resync reasons, and authoritative live-snapshot recovery. Durable event persistence and cross-process/restart replay remain unimplemented.
- Added server-backed scoped and revisioned Skills with global/project/workspace CRUD, effective-skill resolution, revision history/detail, optimistic-lock restore, and snapshot-stable cursor pagination. The Settings scoped panel supports scope browsing, detail, pagination, revision history, and restore; create, SKILL.md import, enable/disable, edit, and delete UI actions remain global-only.

### Changed

- Updated the July 9 planning notes and project roadmap to reflect completed provider reliability, database migration, project instruction loading, and run tracking work.
- Added the minimal Provider capability contract (`Tools`, `Streaming`, `ImageInput`) and exposed it through provider/model metadata; Agent execution now uses declared capabilities instead of provider-name branching.
- Clarified product Phase naming: Phase B refers only to the future inbound IM Gateway. Skills closeout is limited to backend scope/effective/revision/pagination semantics and the current scoped browse/restore UI; future work is defect-only and does not imply that all scoped write operations have UI coverage.

## v0.1.0 - 2026-07-07

### Added

- Added SDK streaming for the official Anthropic Messages and OpenAI Responses providers, including text deltas and usage capture.
- Added automatic Anthropic 5m prompt-cache breakpoints for sufficiently large system/tool/message requests.
- Added Git workspace status, diff, log, and explicit-path commit APIs with a Git diff UI.
- Added backend chapter fork APIs that create Git worktrees, child chapters, and primary narrators, plus merge-check preflight and clean-worktree merge APIs that reject conflicts safely.
- Added local dogfood evidence for API-driven project creation, tool execution, Git diff review, and selected-path commit flows.
- Added model usage cost estimates backed by a small public USD-per-million-token table.
- Added `WebFetch` as a core read-only tool for public HTTP(S) documentation lookup.
- Added `WebSearch` as a core read-only tool for lightweight public web search result lookup.
- Added a stdio MCP client and `MCPListTools` / `MCPCallTool` core tools, guarded as exec-risk operations.
- Added a persisted stdio MCP server registry with CRUD APIs, `tools/list` discovery, and registered-server lookup from MCP core tools.
- Added `config.json` schema `version: 1` normalization for legacy configs.

### Security

- Added browser-originated API and WebSocket protection with a per-process local token, same-origin checks, and `Sec-Fetch-Site` handling.
- Removed the terminal WebSocket `InsecureSkipVerify` bypass.
- Restricted Git API repository resolution to the project path or configured default project directory.
- `WebFetch` rejects local, loopback, link-local, private, and unspecified hosts by default.
- MCP registry responses expose environment variable names only, while stored values remain local and are used only to launch approved stdio MCP processes.

### Changed

- Removed the unused `background_tasks` metric from the usage summary and UI until real background task execution exists, and stopped creating the unused table for new databases.
- Added edit/update/cancel support to the MCP registry UI without echoing stored environment values.
- Documented the current local security model, Git workflow boundaries, and dogfood reproduction path.
- Added CI lint/release scaffolding for `golangci-lint` and GoReleaser binary releases.
- Added an explicit `.golangci.yml` and front-end `node --test` module coverage for formatter and MCP registry parsing helpers.
- Added an end-to-end server smoke covering HTTP message submission, narrator WebSocket events, tool approval, Bash execution, tool-result feedback, and persistence.
- Continued frontend ES module extraction: `app.js` is now a small bootstrap, with main UI logic, Agent Server backend registry/modal/Admin behavior, chat sending/drafts/history/attachments/slash command behavior, chat message rendering/approval/Markdown behavior, directory chooser/browser/recent-directory behavior, shared formatters, Git workflow modal behavior, terminal preferences/settings/WebSocket behavior, API/WebSocket runtime helpers, MCP registry parsing helpers, backend MCP registry UI/actions, Settings Models/Providers UI/model helpers, Settings local preference panels rendering/actions, Settings system/storage/usage/users/about panels, Settings AI Agents/Chapters workspace panels, Settings Skills workbench rendering/actions, global shortcut/sidebar/mobile shell behavior, browser-local settings preference/backup/import behavior, DOM helpers, Settings/Skills static data, and local preference defaults split under `static/modules/`.

### Known gaps

- The Settings skills workbench can create, enable/disable, delete, and discover tools for persisted MCP registry servers; full update/edit forms and long-lived MCP sessions remain future work.
- The embedded frontend has an ES module seam, but a large remaining portion of UI feature code still lives in `app-main.mjs` and should continue being split or migrated to a framework.
- README includes a lightweight tracked GIF workflow preview; a recorded product GIF can replace it later.
