# Autoto Changelog

All notable changes to Autoto are tracked here. The project is still an experimental local-first MVP, so entries focus on user-visible behavior, security boundaries, and contributor-facing workflow changes.

## Unreleased

### Branding and compatibility

- Renamed the current product to **Autoto**. The canonical Go module and CLI are `autoto` and `cmd/autoto` / `autoto`; `cmd/codeharbor` remains a legacy compatibility shim.
- Moved default runtime state to `~/.autoto/config.json` and `~/.autoto/autoto.db`. When the canonical config is absent, a legacy `~/.codeharbor/config.json` is copied forward for compatibility.
- Made `AUTOTO_*` environment variables and `X-Autoto-*` headers canonical. Corresponding `CODEHARBOR_*`, `X-CodeHarbor-*`, and legacy remote-access cookie names remain accepted only for migration compatibility.
- Historical entries below intentionally retain pre-rename CodeHarbor terminology, endpoint names, commit messages, and other recorded facts; they are legacy history rather than current naming guidance.

### Added

- Added a native `gemini-interactions` provider with SSE streaming, image input, function calling, reasoning effort, internal thought-signature replay, schema sanitization, and `x-goog-api-key` redaction.
- Added local account sessions, Unicode/case-folded handles, per-user Agent drafts, handle suggestions, and immutable message corrections with retained or newly uploaded attachments.
- Added a provider/model-driven setup wizard, live assistant streaming cards, clipboard attachments, localized Unicode-safe draft limits, and Agent reasoning controls.
- Added persistent Run/ToolCall lifecycle timestamps, lightweight tool-call previews, and an active Run summary endpoint.
- Added a frontend Run Summary card that loads completed/error/interrupted run summaries, shows tool/message/token/cost metrics, and links the review flow to the existing Git changes modal.
- Added streaming Bash tool output over Agent WebSocket events, with a live output card in the chat UI while commands run.
- Added persisted Webhook task notifications for approval, completion, interruption, superseded, and error events, including settings/test APIs and a Settings UI block.

### Changed

- Model discovery now reports whether models were remotely discovered or fallback-only, and the setup wizard accepts any registered provider with usable models.
- Run summaries no longer load complete tool inputs/outputs; full details remain available from the tool-call detail APIs.
- Browser-local drafts remain an unauthenticated compatibility fallback, while logged-in users use versioned private server drafts.
- Updated the July 9 planning notes and project roadmap to reflect completed provider reliability, database migration, project instruction loading, and run tracking work.

### Security

- Hardened tool and filesystem path resolution against symlink escapes, bounded file/DOCX/Git fingerprint work, and restricted remote root-directory browsing.
- Hardened attachment filenames and MIME detection, explicitly cleans multipart temporary files, defaults downloads to attachment, and only inlines validated safe images with `nosniff`.

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
