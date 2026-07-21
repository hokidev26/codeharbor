# internal/server 熱點 Handler 瘦身評估（Task #9）

日期：2026-07-21 · 分支基準：`maint/structure-split` @ `4209cb9`

本文件是「評估與方案」，**不含程式碼改動**。它為 `internal/server` 的五個熱點檔案提供
一份分階段、可回退、逐 commit 的瘦身路線，延續 db.go / loop.go / model-provider-settings /
styles.css 的「純搬移、零行為變更」原則。

## 核心原則

- **檔案多不是問題，Handler 職責過載才是。** `internal/server` 有 120 個檔案很正常；真正的
  債是個別 Handler 檔把 HTTP plumbing 與大量純業務邏輯混在一起。
- **Handler 只做四件事**：鑑權 → 解析請求 → 呼叫 service/純函數 → 寫回應。純業務邏輯抽到
  同套件的專職檔（Phase 1），未來再視情況升級為 `internal/` 子套件（Phase 2）。
- **不做一次性目錄大重排。** 只有當形成明確的單向依賴後才新建子套件。
- **安全校驗絕不因拆分而上移到前端，也不得弱化 guard 鏈。**
- 每個 commit：`gofmt` 乾淨、`go test -race ./internal/server` 通過、`make check` 通過、
  HTTP 路徑/狀態碼/JSON 欄位/權限決策/脫敏規則零變更。

## 與 Wails 分支的排程注意

當前 `feature/wails-desktop-shell-foundation` 未提交的工作**有動到** `internal/server/server.go`、
`fs.go`、`ui.go`、新增 `desktop_shell.go`。但本文列的五個熱點檔（`agent.go`、`provider_config.go`、
`provider_auth.go`、`git.go`、`security.go`）**目前 Wails 皆未觸碰**，因此 Phase 1 拆分現在就能在
maint 上安全進行、與 Wails 無衝突。`security.go` 若日後 Wails 要加桌面/遠端鑑權面，需協調。

---

## Phase 1：同套件檔案拆分（低風險，建議現在做）

依「價值高 / 風險低」排序。標★者為純函數區塊，零 Handler 耦合、最容易且最該先做。

### ★ 1. agent.go（1,742 行）→ 抽出 activity 投影

| 目標檔 | 內容（約略行區） | 行數 |
|---|---|---|
| `agent_activity_projection.go` | `projectActivityToolCall`、`boundedActivityInput/Output/Meta`、`boundedActivityInputValue`、`addBoundedActivityInputField`、`truncateActivityString`、`activityStringThatFits`、`allowedActivityMetaKey`、`marshalBoundedActivityOutput`、`activityPermissionDecision`（~1060–1445） | ~385 |
| `agent_live_snapshot.go` | `buildWorkState`、`getAgentLiveSnapshot`、`publicLiveSnapshot*`、`liveSnapshotChildrenForRequest`、`continuationSnapshot`、`recentBackgroundTasks`（~114–440） | ~330 |
| `agent_context.go` | `getAgentContext`、`patchAgentContextPreferences`、`clearAgentContext`、`compactAgentContext`、`publishContextUpdated`、`agentContextStatusForRequest`（~492–650） | ~160 |

`agent_activity_projection.go` 是全套件最乾淨的抽取目標：一組純函數，把工具呼叫的 input/output/meta
做上限與脫敏投影供 API 回應用，完全不碰 `*Server`。**第一刀就切它。**
拆後 agent.go 約 900 行，只剩 agent CRUD + message/tool handlers。

### ★ 2. provider_auth.go（1,257 行）→ 抽出 auth-import 與管理客戶端

| 目標檔 | 內容 | 行數 |
|---|---|---|
| `provider_auth_import.go` | `buildProviderAuth*Plan`、`normalizeCodexAuthAccount`、全部 `authImport*` helper（~579–1011） | ~430 |
| `cliproxy_management.go` | `cliProxyAPIManagementRequest`、`providerManagementRequest`、`dial*`、`*LoopbackIPs`、`parse*URL`、`*BaseURL`、`*ManagementKey*`、`friendly*Error`（~1018–1250） | ~230 |

`provider_auth_import.go` 同樣是純解析/正規化，測試性極高。`cliproxy_management.go` 是一個含
loopback/SSRF 防護的網路管理客戶端，本質獨立。拆後 provider_auth.go 約 600 行。

### 3. provider_config.go（1,626 行）→ 分離組態組裝 / 註冊表 / 密鑰交易

| 目標檔 | 內容 | 行數 |
|---|---|---|
| `provider_config_builder.go` | `providerConfigFromUpdateRequest`、`validateProviderConfigRequest`、`providerProxySettings`、`providerHeadersFromRequest`、header/name/profile 驗證（純轉換） | ~350 |
| `provider_registry.go` | `registerProvider`、`unregisterProvider`、`refreshProviderDefault`、`ensureProviderDefaultAfterMutation`、`upsert/rename/removeServerProvider`、`renameProviderModelReference(s)` | ~250 |
| `provider_secrets_txn.go` | `prepareProviderTransportSecrets`、`rollback/commitProviderSecretKinds`、`providerProxyAuthSecret`、`providerRequestHeadersSecret`、`providerTransportSecretMutationRequired` | ~200 |

拆後 update/patch/delete/test 四個 handler 變薄（`updateProviderConfig` 現約 227 行，抽走組裝與
密鑰交易後可顯著縮短）。provider_config.go 約 700 行。

### 4. git.go（1,141 行）→ 分離 rollback / 執行解析 / commit 路徑校驗

| 目標檔 | 內容 | 行數 |
|---|---|---|
| `git_rollback.go` | `rollbackRun(Preview)`、`buildRollbackPlan`、`failRollbackAfterClaim`、`rollbackCheckpointStateReason`、`gitRollbackPreview`、`verifyRunGitChanges`、`restoreRunGitChanges`、`removeScopedRunFile`、`gitRunIndexFingerprint`（~242–560） | ~320 |
| `git_commit_paths.go` | `cleanGitCommitPaths`、`validateGitCommitSelection`、`expandGitCommitPaths`、路徑比對、`isSensitiveGitPath`、`pathWithin`、`canonicalPath`（~653–902） | ~250 |
| `git_exec.go` | `runGitCommand`、`limitedBuffer`、`parseGitPorcelain/Numstat/Log`、`gitDiffArgs`、數值/UTF8 helper（~914–1134） | ~220 |

`isSensitiveGitPath` / `pathWithin` 屬安全邊界，拆時純搬移、不改判斷。拆後 git.go 約 500 行。

### 5. security.go（1,118 行）→ 按關注點拆，最低優先、最高謹慎

| 目標檔 | 內容 |
|---|---|
| `security_guard.go` | token 生成/驗證、`localRequestGuard`、`sensitiveLocalTokenGuard`、`fullRemoteAccessGuard`、WebSocket 校驗（~42–224） |
| `security_origin.go` | `sameOrigin*`、`requestScheme`、forwarded scheme/IP 解析、origin targets（~226–416） |
| `security_remote_access.go` | 遠端登入/登出/gate、失敗鎖定（record/clear/prune/trim）、鎖定訊息（~416–774） |

**警語**：這是整個服務的安全核心（SSRF、DNS-rebinding、origin、lockout）。只做純搬移，
**不得**把任何檢查移到前端、不得改變 guard 掛載順序、不得放寬常數時間比較或 forwarded-header
信任邏輯。建議放在 Phase 1 最後，且獨立小 commit、逐一 `go test -race`。

---

## Phase 2：升級為 `internal/` 子套件（日後，選做）

只有 Phase 1 落地、且證明依賴為單向（不回指 `*Server`）後才做。候選：

- **`internal/activity`**：agent 的 activity 投影是純函數，可整包上移，供 server 與未來 CLI 共用。
- **`internal/providerauth`**：auth-import plan 建構（`buildProviderAuth*Plan` + `authImport*`）純解析，
  適合成為獨立領域套件並附完整單元測試。
- **git 輸出解析**：`parseGitPorcelainStatus/Numstat/Log` 等可能更適合併入既有的
  `internal/gitsnapshot`，而非留在 server。

不建議把含 `*Server` 狀態或 config/DB 相依的部分（provider registry、secrets txn、remote-access
lockout）貿然升級——它們與 Server 生命週期綁定，留在 `internal/server` 內分檔即可。

---

## 預估效果（Phase 1 完成後）

| 檔案 | 現狀 | 目標 | 抽出 |
|---|---|---|---|
| agent.go | 1,742 | ~900 | activity 385 + snapshot 330 + context 160 |
| provider_config.go | 1,626 | ~700 | builder 350 + registry 250 + secrets 200 |
| provider_auth.go | 1,257 | ~600 | import 430 + mgmt-client 230 |
| git.go | 1,141 | ~500 | rollback 320 + commit-paths 250 + exec 220 |
| security.go | 1,118 | ~3 × ~380 | 按關注點拆 |

全部五檔降到 ~900 行以下，且純業務/安全邏輯獲得獨立、可測試、可回退的邊界。

## 建議執行順序

1. `agent_activity_projection.go`（最乾淨，先切證明流程）
2. `provider_auth_import.go`
3. `git_exec.go` + `git_commit_paths.go` + `git_rollback.go`
4. `provider_config_builder.go` + `provider_registry.go` + `provider_secrets_txn.go`
5. `agent_live_snapshot.go` + `agent_context.go`
6. `security.go` 三分（最後，逐一小 commit）

每步一個 commit，訊息形如 `refactor(server): extract activity tool-call projection`，
每步 `go test -race ./internal/server` + `make check` 通過才進下一步。
