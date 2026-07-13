# needtodo0712：Autoto 合併後定位審查與產品路線圖

> 本文件是 `needtodo0709` 的後繼版本，基於 2026-07-12 對倉庫的完整只讀審查（README、PROJECT_PLAN、needtodo0709、CHANGELOG、git 歷史、未提交 diff、前後端原始碼結構），以及對外部成熟專案 OpenClaw（🦞）現況的對照調研。
>
> 審查時倉庫狀態：main @ d2e8cf0（Add run review notifications and rollback checkpoints），working tree 有未提交變更（詳見 2.3）。
>
> **Phase 命名說明：**本文的 **Phase A / B / C 是產品路線**，不是 `PROJECT_PLAN.md` 中早期的工程工作流編號。產品 **Phase B 專指 IM Gateway**。截至本次事實同步，Phase A 的 Skills 收口已完成，主線回到 IM foundation；目前 IM 僅有瀏覽器本地策略草稿與服務端單向 Webhook 通知，**不存在入站 IM Gateway，也不能從 IM 派任務或審批**。

---

## 0. 一句話結論

工程底子明顯優於一般 MVP（測試、CI、migration、安全邊界都是真的），原先 Phase A 的 Skills、命名與核心可靠性工作已收口。**下一階段產品主線回到 IM foundation，但必須準確描述現況：目前只有瀏覽器本地 IM 策略草稿與服務端單向 Webhook，入站 IM Gateway 尚未實現。**

---

## 1. 產品定位判斷（合併後最重要的一節）

### 1.1 現狀：雙重人格

合併後的專案（現名 Autoto）同時具有兩種產品基因：

| 基因 | 來源 | 對應功能 |
| --- | --- | --- |
| 編碼代理工作台 | Claude Code / OpenHands 路線 | agent loop、工具審批、Git worktree/fork/merge、diff/commit、PTY 終端 |
| 個人助理閘道 | OpenClaw（龍蝦）路線 | IM Gateway 預設、Skills 工作台、Webhook 通知、remote hardening、常駐服務 |

兩種基因都繼續各自展開的話，會出現三個問題：設定面板無限膨脹（0709 已警告過）、每個方向都只做到 60 分、新使用者無法一句話理解這是什麼。

### 1.2 建議定位：兩者的交集，而不是聯集

市場空缺恰好在交集處：

- **OpenClaw**：助理與渠道生態極強（29 個渠道、ClawHub 技能市場、50 萬部署），但它不是編碼工作台——沒有 worktree 多工作線、沒有 diff 審查/顯式提交閉環、沒有 run 級回顧。
- **Claude Code / Codex CLI**：編碼能力強，但是 CLI 進程，關掉終端機就沒了；沒有常駐伺服器、沒有持久化 run 歷史、離開電腦就失聯。
- **OpenHands**：有 agent server，但偏雲端/容器編排，本地單機體驗重，且沒有 IM 控制面。

因此建議把定位收斂成一句話：

> **Autoto 是常駐在你自己機器上的本地編碼代理伺服器：目前已打通 Task → background run → approval → run summary → diff → explicit-path commit；產品 Phase B 再把派任務與審批延伸到 IM。**

關鍵推論：

1. **IM 是控制面，不是聊天產品。** 合併進來的龍蝦基因只保留「通知 + 審批 + 派任務 + 查狀態」四件事，不做通用聊天助理、不鋪渠道矩陣。
2. **編碼工作流是本體。** chapter/worktree、run、審批、diff/commit 這條鏈是所有新功能的宿主，任何不掛在這條鏈上的功能先不做。
3. **README 第一屏應該先展示已實現閉環**，而不是功能羅列。保留現有 demo 資產，但在入站 IM Gateway 真正落地前，不製造或描述「IM 審批」動圖。

### 1.3 從 OpenClaw 應該借鑑的三課

1. **渠道廣度是陷阱。** OpenClaw 鋪到 29 個渠道是因為它的本體就是渠道閘道，且有全職團隊。Autoto 應該只做 1–2 個渠道但做到閉環完整（見 Phase B）。
2. **技能生態的安全教訓。** OpenClaw 在技能市場出現隱藏指令等代理風險後，才補上 Skill Card 溯源與 SkillSpector 掃描。Autoto 的 Skills 已將服務端信任邊界、安全掃描、來源與風險確認納入收口範圍。
3. **入站控制 = 遠端執行代碼。** 一旦 IM 可以觸發 agent，威脅模型從「本機可信使用者」直接跳到「網際網路上任何拿到你 bot token 的人」。配對、簽名、白名單、審計必須先於功能上線（見 6.4）。

---

## 2. 現狀盤點（2026-07-12）

### 2.1 相比 0709 已完成的（值得肯定）

- SQLite migration 框架（`PRAGMA user_version`）已建立。
- Provider parity 已補齊，並落地 `Tools` / `Streaming` / `ImageInput` 最小 capability contract；retry/backoff 與 first-token timeout 有測試覆蓋。
- Agent WebSocket protocol 2 已提供進程內單調序列、有界記憶體 replay 與 authoritative snapshot resync；durable event log、服務重啟後與跨進程 replay 尚未實現。
- runs / run_id / RunSummary 後端 + 前端回顧卡片已接通，形成「完成 → 回顧 → 看 Git 變更 → 顯式路徑提交」入口。
- Bash 輸出流式事件 + 聊天區實時輸出卡片。
- Webhook 任務通知 MVP（審批等待、完成、錯誤/中斷/被取代）+ 設定頁保存與測試發送；這是單向出站通知，不是入站 IM Gateway。
- Skills 已服務端化並完成 global/project/workspace scope、revision/restore、effective-skill resolution 與 snapshot-stable cursor 分頁。
- `AGENTS.md` / `CLAUDE.md` 專案指令載入。
- 統一檢查入口 `make check` / `scripts/check.sh`，CI 同源。

### 2.2 規模與熱點檔案

- Go 約 19.9k 行，前端 JS/MJS 約 9.6k 行。
- 偏大的檔案（維護熱點，持續拆分對象）：
  - `internal/server/static/styles.css` 4430 行
  - `internal/server/static/modules/app-main.mjs` 1940 行
  - `internal/agent/loop.go` 1752 行
  - `internal/db/db.go` 1350 行
  - `internal/server/static/modules/model-provider-settings.mjs` 998 行

### 2.3 原審查時半成品（後續已收口）

2026-07-12 審查時列出的服務端工作流偏好、工具權限規則、checkpoint/rollback、Skills 服務端化與命名重構，均屬當時工作樹快照，不再是現在的未提交待辦。後續 AI 不應依據本節重新建立同一批工作。

本次同步後的未完成產品能力是 **入站 IM Gateway**；現有服務端 Webhook 只向外 POST run/approval 摘要，不接收 IM 訊息、命令、審批或新任務。

### 2.4 原審查時的倉庫衛生建議（歷史快照）

- 空目錄：`internal/auth`、`internal/narrator`、`internal/project` —— 三個月沒放內容就刪掉，需要時再建。
- 空目錄 `.narrafork/`：舊專案殘留，確認無用後刪除並加入 `.gitignore`。
- 規劃文件散落：`PROJECT_PLAN.md`（部分「待做」實際已完成）、`needtodo0709`（歷史審查記錄）、`CHANGELOG.md` 三者有漂移。建議：
  - `PROJECT_PLAN.md` 只保留「架構現狀 + 已完成能力」的事實描述，砍掉過時的待辦勾選框。
  - 規劃/審查類文件統一收進 `docs/plans/`（`needtodo0709`、本文件都移入，repo 根目錄只留 README/CHANGELOG 等標準文件），並給 `needtodo0709` 補 `.md` 副檔名。
  - 未來待辦只維護在最新一份 plan 文件 + GitHub Issues，避免三處同步。

---

## 3. 合併債務：命名重構（已完成，legacy 進入遷移期）

規範名稱已收斂為 **Autoto / Agent / Workline**，規範入口為 `autoto`、`AUTOTO_*`、`X-Autoto-*`、`/api/agents`、`/api/worklines` 與 `/ws/agent`。

舊 CodeHarbor、Narrator、Chapter 名稱只保留在兼容讀取、路由別名、舊 CLI shim、migration 與歷史記錄中。新的文件、設定、整合與客戶端不得再寫入舊名。兼容面的唯一移除規則以 `PROJECT_PLAN.md` 的 **Legacy compatibility lifecycle** 為準：最早 v0.4.0、至少兩個 tagged release 遷移窗口，且必須滿足刪除門檻。

---

## 4. 「配置已展示但未生效」清單（no-op 風險收斂)

0709 已點名此風險，合併後更需要一次性盤點。原則：**每個設定面板要嘛接到服務端真實行為，要嘛明確標示 experimental/local-only，不允許第三種狀態。**

| 面板 | 現狀 | 處置建議 |
| --- | --- | --- |
| IM Gateway | 瀏覽器本地策略草稿；另有服務端單向 Webhook 通知；無入站渠道 | 產品 Phase B 才實作真實入站 Gateway；在此之前持續明示「策略草稿，不接收入站訊息」 |
| Network Search 策略 | 偏好在瀏覽器，WebSearch/WebFetch 工具在服務端 | 把 provider 預設、result limit、domain 規則下沉到服務端配置並讓工具真正讀取 |
| Skills | 已服務端化，具 global/project/workspace scope、revision/restore、snapshot cursor 與安全掃描 | 已收口；除缺陷修復外不再佔用產品主線 |
| 通知偏好 | toast 類偏好在瀏覽器；Webhook 已服務端化 | 可接受，標註清楚哪部分是本地顯示偏好 |
| Profile / Appearance | 純瀏覽器偏好 | 合理，保持 |

---

## 5. Phase A：收尾與地基（已收口）

Phase A 是產品路線的地基階段，目前已完成：

- 服務端工作流偏好與工具權限規則；
- run-scoped Git checkpoint / rollback；
- Autoto / Agent / Workline 規範命名與 legacy compatibility；
- Agent stream protocol 2、有界記憶體 replay、snapshot resync；
- Provider `Tools` / `Streaming` / `ImageInput` 最小能力契約；
- Skills 服務端化、安全掃描、global/project/workspace scope、revision/restore 與 snapshot cursor。

Skills 至此收口。後續除安全缺陷、資料一致性或真實使用問題外，不再把 Skills 擴展當成產品主線；主線回到產品 Phase B 的 IM foundation。

---

## 6. Phase B（產品含義唯一）：IM Gateway（尚未實現）

本文與後續產品文件中的 **Phase B 只表示 IM Gateway**，不包含 Skills、搜尋、Workline UI 或其他一般增強。目前只有本地 IM 策略草稿與服務端單向 Webhook；以下全部是待實現的產品目標，不是現有能力。

目標閉環：

```txt
agent 在家裡的機器上跑
  → run 進入 waiting_approval
  → IM 推送「等你審批：Bash: npm test」
  → 你在 IM 回覆 /approve
  → 工具執行、run 完成
  → IM 推送 run summary（工具數、檔案數、+/- 統計、成本）
  → 附連結回 Web UI 審查 diff、一鍵提交
```

### 6.1 只選一個渠道起步

| 候選 | 優點 | 缺點 | 建議 |
| --- | --- | --- | --- |
| **Telegram** | Bot API 最簡單免審核、長輪詢可不開公網入站、個人開發者摩擦最低 | 團隊場景弱 | **首選** |
| Slack | 團隊場景強、Block Kit 審批按鈕體驗好 | 需要建 app/審批、事件回調要公網 URL | 第二個做 |
| Discord | 社群強 | 個人助理場景不如 TG 自然 | 之後 |
| Lark / 企業微信 / LINE | 特定市場 | 各自的企業認證與回調要求高 | 有真實需求再做 |

Telegram 用 long polling 的關鍵優勢：**本機不需要暴露任何入站端口**，與 Autoto「本地優先」的安全模型天然一致。

### 6.2 架構：Channel Adapter 介面

新增 `internal/channels/`：

```go
type Channel interface {
    Name() string
    Start(ctx context.Context, inbox chan<- InboundMessage) error
    Send(ctx context.Context, msg OutboundMessage) error
    Capabilities() ChannelCapabilities // buttons? markdown? threads?
}
```

- 出站事件源：復用現有 Webhook 通知的觸發點（waiting_approval / completed / error / interrupted / superseded），channel 只是另一種 sink。
- 入站命令進入統一的 command router，與渠道解耦。
- 訊息模板集中管理（審批卡、summary 卡），渠道按 capabilities 降級渲染（有按鈕用按鈕，沒按鈕用 `/approve <id>` 文字指令）。

### 6.3 入站命令文法（第一版就這六個，不做自由聊天）

```txt
/status                 當前活躍 run 與等待審批數
/runs [n]               最近 n 個 run 摘要
/approve <toolCallId>   批准等待中的工具
/deny <toolCallId> [原因]
/task <專案名> <指令>    建立新 run（可先不做，見下）
/diff <runId>           該 run 的檔案級 diff 統計
```

- 第一版可以先只做 `/status` `/approve` `/deny` + 出站通知，即可閉環。
- `/task`（從 IM 派新任務）安全影響最大，放在閉環驗證穩定之後，且預設關閉。

### 6.4 安全設計（先於功能，不可妥協）

1. **顯式總開關**：未來以規範 `AUTOTO_IM_INBOUND=true` 才處理任何入站；預設只出站通知。此變數與入站處理目前都尚未實現。
2. **裝置配對**:本地 Web UI 生成一次性配對碼 → 使用者私聊發給 bot → 綁定該 chat_id 寫入 DB。未配對的 chat 一律忽略且不回覆（避免探測）。
3. **帳號白名單**：配對之外再校驗 user id 白名單；群聊預設不響應。
4. **權限天花板**：來自 IM 的審批不能批准 `danger` 風險；IM 永遠不能切換 permission mode、不能啟用 `bypassPermissions`、不能開終端。
5. **Webhook 型渠道（Slack 等）**：HMAC 簽名 + 時間戳 + 5 分鐘重放窗口。
6. **出站脫敏**：復用現有 redaction 偏好，通知內容不含 API key、完整命令輸出、絕對路徑細節；summary 用統計代替原文。
7. **審計**：新表 `channel_events`（方向、渠道、chat/user、命令、結果、run/toolCall 關聯、時間），設定頁可查最近事件。
8. **限流**：每 chat 每分鐘命令數上限；連續失敗配對嘗試鎖定。
9. **威脅模型文件**：`SECURITY.md` 增補「IM 入站」一節，明確「bot token 洩漏 = 你的審批面被接管」的告知與輪換指引。

### 6.5 通知可靠性收尾（0709 遺留）

- 通知歷史表 + 設定頁最近 N 條與失敗原因。
- 失敗重試隊列（指數退避、上限次數），失敗不阻塞 agent loop（現有原則保持）。
- 每專案/每 agent 的通知路由規則（哪些事件 → 哪個渠道）。

### 6.6 Phase B 驗收

成本預算、FTS5 會話搜尋與 Workline 可視化仍可作為一般產品 backlog，但**不屬於 Phase B**，不得用它們稀釋或替代 IM Gateway 驗收。

- [ ] 手機上收到審批通知 → 回 `/approve` → 電腦上工具繼續執行 → 收到 summary → 點連結回 UI 提交，全程不碰電腦鍵盤（提交除外）。
- [ ] 未配對 chat 發任何命令：無響應、有審計記錄。
- [ ] bot token 換新後舊配對失效流程可用。
- [ ] 通知失敗可在設定頁看到原因並重試。

---

## 7. Phase C（3–6 個月）：發揮 worktree 架構的獨特性

### 7.1 Review Workline（差異化招牌功能）

讓一個 agent 寫、另一個 agent 審：

- `POST /api/worklines/{id}/review`：以目標分支為基準取 diff，spawn 一個唯讀 reviewer agent（`readOnly` 模式 + 專用 system prompt），產出結構化 review：`[{file, line, severity, finding, suggestion}]`。
- UI：merge-check 旁邊出現「AI Review」，結果以檔案分組卡片呈現，可一鍵把 finding 轉為新 run 的修復任務。
- 可選自動化：run 完成後自動觸發輕量 review，summary 卡片附「發現 N 個問題」。
- 這是 CLI agent 結構上做不到、OpenClaw 沒有場景做的功能，適合作為對外宣傳的主打。

### 7.2 AI 解 merge conflict

- `merge` 遇衝突時（現在是 abort + 409），提供「讓 agent 嘗試解決」：在臨時 worktree 裡給 agent 衝突檔案 + 兩側意圖（各自 run summary 作為上下文），產出解決方案 → 人審 diff → 確認才真正 merge。
- 邊界延續現有 Git 路徑限制；失敗就乾淨 abort，不留半合併狀態。

### 7.3 排程背景任務（吃到「常駐」紅利）

- 新表 `schedules`：`cron_expr, project_id, prompt, permission_mode(限 readOnly/acceptEdits), enabled, last_run_id`。
- 調度器 goroutine：到點建立 run，防重疊（上次未完成則跳過並通知）。
- 典型場景：每晚跑測試並報告失敗、每週依賴升級草稿分支、每天 issue 分類。結果走 Phase B 的 IM 通知，兩個 Phase 在此匯合。
- 護欄：排程任務永不 `bypassPermissions`；預算檢查照常生效。

### 7.4 Branch push 與 PR 草稿

- 顯式確認後 push 當前 workline 分支（永不 force、永不動 main），生成 PR 草稿（GitHub token 配置後走 API，或檢測 `gh` CLI）。
- run summary 直接作為 PR body 初稿，打通「回顧 → PR」。

### 7.5 任務佇列

- 目前 agent busy 時的新訊息處理策略升級為顯式佇列：`queued` run 依序執行，UI/IM 可看隊列、可取消排隊中的 run。

### 7.6 Plan Mode 閉環（0709 遺留）

- 明確 `plan` 權限模式：只允許 read 風險工具，system prompt 要求先產出計畫；UI「批准計畫並開始執行」按鈕原地切回 acceptEdits 繼續同一 run 上下文。

### 7.7 Skills 維護邊界

Skills 的 scope、revision、restore、snapshot cursor 與安全掃描已收口。Phase C 不再預設擴張技能市場；只有真實安全樣本、兼容缺陷或使用回饋才驅動後續調整。

### 7.8 其他中型項

- **MCP 長連接會話池**：stdio session 保活 + idle TTL + 崩潰重啟，消除每次 initialize 開銷。
- **Provider capability metadata 浮出 UI**：復用既有 `Tools` / `Streaming` / `ImageInput` 契約，讓模型下拉顯示能力，避免把不支援能力誤判成 Agent 故障。
- **首次啟動三步引導**：配 key → 驗證模型（真打一次請求）→ 建第一個專案。目前配置面複雜度已經需要這個了。
- **子代理（sub-agent）**：agent 可 spawn 限定範圍的子 run 並回收摘要。與 workline 架構天然契合，但依賴佇列與成本護欄先就緒，放本 Phase 末。

---

## 8. 功能優先級總表

| 功能 | 優先級 | 難度 | Phase | 一句話 MVP |
| --- | --- | --- | --- | --- |
| 工具權限規則表 | 完成 | — | A | 服務端偏好、規則與命中決策已落地 |
| Checkpoint / Rollback | 完成 | — | A | run-scoped checkpoint 與保守 rollback 已落地 |
| Skills scope/revision/restore/cursor | 完成 | — | A | scoped、revisioned、snapshot-stable Skills 已收口 |
| Autoto / Agent / Workline 命名 | 完成 | — | A | 規範名落地，legacy 進入遷移 lifecycle |
| 文件收斂 + README 定位改寫 | P1 | 低 | A 收尾 | 一份 roadmap、一句真實定位 |
| Telegram/單一渠道入站審批閉環 | P1 | 中 | B | /status /approve /deny + 配對；目前未實現 |
| 通知歷史 + 重試隊列 | P1 | 低中 | B | 失敗可見可重試 |
| IM 派新任務 /task | P2 | 中 | B 末 | 預設關閉的顯式開關 |
| 成本預算與告警 | P2 | 低 | C/一般 backlog | 專案預算 80%/100% 兩檔 |
| FTS5 會話搜尋 | P2 | 低中 | C/一般 backlog | Cmd+K 搜歷史訊息 |
| Worklines 可視化面板 | P2 | 中 | C | 樹 + fork/merge-check/merge 入口 |
| AI Review Workline | P1* | 中高 | C | 唯讀 reviewer agent + 結構化 findings |
| AI 解 merge conflict | P2 | 高 | C | 臨時 worktree 內解衝突 + 人審 |
| 排程背景任務 | P2 | 中 | C | cron + 防重疊 + IM 通知 |
| Branch push + PR 草稿 | P2 | 中 | C | 顯式確認、summary 作 PR body |
| 任務佇列 | P2 | 中 | C | queued run 順序執行 |
| Plan Mode 閉環 | P2 | 低中 | C | plan 模式 + 批准後原地繼續 |
| MCP 會話池 | P3 | 中 | C | 保活 + TTL |
| 首次啟動引導 | P2 | 低 | C | 三步向導 |
| 子代理 | P3 | 高 | C末 | 範圍受限子 run |

\* Review Workline 標 P1 是產品重要性；工程順序仍在 C，因為依賴 A/B 的地基。

## 9. 明確不建議做的事（維持 0709 結論並加強）

1. 繼續新增 Settings 面板與 browser-local 偏好——先讓現有的全部「真實生效或標示清楚」。
2. 前端全量 React/Vite 重寫——繼續按功能邊界拆 ES module；`styles.css` 超 4400 行可先按面板拆檔。
3. 渠道矩陣（>2 個 IM 渠道）——那是 OpenClaw 的本體戰場，不是你的。
4. 多使用者/團隊協作、雲同步、帳號體系——單人單機價值還沒榨乾。
5. 技能市場/分享平台——先做匯入相容與安全展示，市場是生態階段的事。
6. 通用聊天助理化（讓 IM 端自由聊天）——會把定位重新拖回雙重人格。

## 10. 接續執行順序

1. 完成本輪文件事實同步與 legacy lifecycle 收口。
2. 維持 Skills 收口狀態，不再追加無真實需求的 scope/revision 複雜度。
3. 產品主線回到 IM foundation：先定義 channel boundary、配對、審計、限流與權限天花板。
4. 只選一個渠道做入站 `/status` / `/approve` / `/deny` 閉環。
5. 閉環穩定後才評估預設關閉的 `/task`；在此之前不得把 IM 入站寫成已實現。

## 11. 核心產品判斷（本文件唯一需要記住的話)

> **Autoto 現在已完成「Task → background run → approval → run summary → diff → explicit-path commit」的本地閉環。產品 Phase B 的唯一任務，是在安全邊界先行的前提下把派任務、審批與狀態查詢延伸到 IM；目前這個入站 Gateway 尚未實現。**

## 附錄：外部對照資料

- OpenClaw GitHub：https://github.com/openclaw/openclaw （29 渠道、ClawHub、約 50 萬部署）
- OpenClaw Docs（Gateway/Workspace/Agent 架構、配對與審批模式）：https://docs.openclaw.ai/
- OpenClaw 技能安全（Skill Card / SkillSpector，2026-06 起）：https://en.wikipedia.org/wiki/OpenClaw
