# Changelog

All notable changes to CodeHarbor are tracked here. The project is still an experimental local-first MVP, so entries focus on user-visible behavior, security boundaries, and contributor-facing workflow changes.

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

- Removed the unused `background_tasks` metric from the usage summary and UI until real background task execution exists.
- Documented the current local security model, Git workflow boundaries, and dogfood reproduction path.
- Added CI lint/release scaffolding for `golangci-lint` and GoReleaser binary releases.
- Added an end-to-end server smoke covering HTTP message submission, narrator WebSocket events, tool approval, Bash execution, tool-result feedback, and persistence.
- Continued frontend ES module extraction: `app.js` is now a small bootstrap, with main UI logic, Agent Server backend registry/modal/Admin behavior, chat sending/drafts/history/attachments/slash command behavior, chat message rendering/approval/Markdown behavior, directory chooser/browser/recent-directory behavior, shared formatters, Git workflow modal behavior, terminal preferences/settings/WebSocket behavior, API/WebSocket runtime helpers, MCP registry parsing helpers, backend MCP registry UI/actions, Settings Models/Providers UI/model helpers, Settings local preference panels rendering/actions, Settings system/storage/usage/users/about panels, Settings AI Agents/Chapters workspace panels, Settings Skills workbench rendering/actions, global shortcut/sidebar/mobile shell behavior, browser-local settings preference/backup/import behavior, DOM helpers, Settings/Skills static data, and local preference defaults split under `static/modules/`.

### Known gaps

- The Settings skills workbench can create, enable/disable, delete, and discover tools for persisted MCP registry servers; full update/edit forms and long-lived MCP sessions remain future work.
- The embedded frontend has an ES module seam, but a large remaining portion of UI feature code still lives in `app-main.mjs` and should continue being split or migrated to a framework.
- README includes a lightweight tracked GIF workflow preview; a recorded product GIF can replace it later.
