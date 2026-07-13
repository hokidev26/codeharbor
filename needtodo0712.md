# needtodo0712：CodeHarbor 合併後定位審查與詳細路線圖

> 本文件是 `needtodo0709` 的後繼版本，基於 2026-07-12 對倉庫的完整只讀審查（README、PROJECT_PLAN、needtodo0709、CHANGELOG、git 歷史、未提交 diff、前後端原始碼結構），以及對外部成熟專案 OpenClaw（🦞）現況的對照調研。
>
> 審查時倉庫狀態：main @ d2e8cf0（Add run review notifications and rollback checkpoints），working tree 有未提交變更（詳見 2.3）。

---

## 0. 一句話結論

工程底子明顯優於一般 MVP（測試、CI、migration、安全邊界都是真的），needtodo0709 的 P0 幾乎全部落地，執行力沒有問題。**當前最大的風險不是技術，而是合併兩個專案之後的「產品定位分裂」與隨之而來的命名/文件/半成品債務。** 下一階段應該：先收尾、再定位、然後把「IM 派任務閉環」做成唯一的差異化主線。

---

## 1. 產品定位判斷（合併後最重要的一節）

### 1.1 現狀：雙重人格

合併後的 CodeHarbor 同時具有兩種產品基因：

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

> **CodeHarbor 是常駐在你自己機器上的編碼代理伺服器：你從瀏覽器或 IM 派任務，agent 在 Git worktree 裡後台執行；需要決策時主動找你審批；完成後給你變更回顧；你審查 diff 後一鍵提交。**

關鍵推論：

1. **IM 是控制面，不是聊天產品。** 合併進來的龍蝦基因只保留「通知 + 審批 + 派任務 + 查狀態」四件事，不做通用聊天助理、不鋪渠道矩陣。
2. **編碼工作流是本體。** chapter/worktree、run、審批、diff/commit 這條鏈是所有新功能的宿主，任何不掛在這條鏈上的功能先不做。
3. **README 第一屏應該改寫成上面那句話**，而不是目前的功能羅列。定位句 + 一張「IM 審批 → diff 回顧 → 提交」的動圖，勝過 40 條 feature bullet。

### 1.3 從 OpenClaw 應該借鑑的三課

1. **渠道廣度是陷阱。** OpenClaw 鋪到 29 個渠道是因為它的本體就是渠道閘道，且有全職團隊。CodeHarbor 應該只做 1–2 個渠道但做到閉環完整（見 Phase B）。
2. **技能生態的安全教訓。** OpenClaw 在技能市場出現隱藏指令等代理風險後，才補上 Skill Card 溯源與 SkillSpector 掃描。CodeHarbor 的 Skills 在服務端化與支援匯入時，第一天就要有「啟用前完整展示內容 + exec 風險標記 + 來源記錄」（見 5.3、7.7）。
3. **入站控制 = 遠端執行代碼。** 一旦 IM 可以觸發 agent，威脅模型從「本機可信使用者」直接跳到「網際網路上任何拿到你 bot token 的人」。配對、簽名、白名單、審計必須先於功能上線（見 6.4）。

---

## 2. 現狀盤點（2026-07-12）

### 2.1 相比 0709 已完成的（值得肯定）

- SQLite migration 框架（`PRAGMA user_version`）已建立。
- Provider parity：OpenAI official / OpenAI-compatible 的 tools 與 streaming 方向已補齊，retry/backoff 與 first token timeout 有測試覆蓋。
- runs / run_id / RunSummary 後端 + 前端回顧卡片已接通，形成「完成 → 回顧 → 看 Git 變更 → 提交」入口。
- Bash 輸出流式事件 + 聊天區實時輸出卡片。
- Webhook 任務通知 MVP（審批等待、完成、錯誤/中斷/被取代）+ 設定頁保存與測試發送。
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

### 2.3 未提交的半成品（P0，先收尾）

Working tree 目前有：

- 新檔案 `internal/server/workflow.go` + `workflow_test.go`：服務端工作流偏好（exec/write 確認、預設唯讀）與工具權限規則表（mode/toolName/risk/decision/priority/enabled）的 CRUD。
- 相應的 `db.go` / `migrations.go` / `schema.go` / `loop.go` / `server.go` / 前端 skills-workbench、app-main、styles 修改，共約 1137 行新增。

這正是 0709 計畫裡「工具權限規則表與服務端化工作流偏好」項。**建議本週內完成收尾並提交**，收尾清單：

- [ ] 規則匹配順序與衝突語意寫進代碼註釋與文件（priority 相同時誰贏、`*` 與精確匹配誰優先、deny 是否一票否決）。
- [ ] loop.go 中權限判定路徑補上規則命中日誌（排查「為什麼這個工具被拒」必需）。
- [ ] migration 補舊庫升級測試（規則表不存在 → 補建；重複 Open 冪等）。
- [ ] 前端規則編輯 UI 至少支持啟停與刪除，暫不做拖拽排序。
- [ ] `make check` 全綠後提交，commit message 建議 `Add server-side workflow preferences and tool permission rules`。

### 2.4 倉庫衛生殘留

- 空目錄：`internal/auth`、`internal/narrator`、`internal/project` —— 三個月沒放內容就刪掉，需要時再建。
- 空目錄 `.narrafork/`：舊專案殘留，確認無用後刪除並加入 `.gitignore`。
- 規劃文件散落：`PROJECT_PLAN.md`（部分「待做」實際已完成）、`needtodo0709`（歷史審查記錄）、`CHANGELOG.md` 三者有漂移。建議：
  - `PROJECT_PLAN.md` 只保留「架構現狀 + 已完成能力」的事實描述，砍掉過時的待辦勾選框。
  - 規劃/審查類文件統一收進 `docs/plans/`（`needtodo0709`、本文件都移入，repo 根目錄只留 README/CHANGELOG 等標準文件），並給 `needtodo0709` 補 `.md` 副檔名。
  - 未來待辦只維護在最新一份 plan 文件 + GitHub Issues，避免三處同步。

---

## 3. 合併債務：命名重構（narrator / chapter）

### 3.1 問題

`narrator`（敘事者）、`chapter`（章節）、`.narrafork` 來自舊專案的敘事隱喻。對一個編碼代理工具：

- 新使用者第一次看到 `POST /api/narrators/{id}/messages` 無法建立正確心智模型；
- 貢獻者讀 `docs/ARCHITECTURE.md` 需要一張額外的名詞對照表；
- 所有對外文件、UI 文案、API、DB 表名都在持續累積這個隱喻的沉沒成本。

**現在是最後的低成本改名視窗**：尚無外部使用者、無公開 API 相容性包袱、migration 框架剛好已就緒。

### 3.2 建議映射

| 現名 | 建議新名 | 理由 |
| --- | --- | --- |
| narrator | **agent**（或 session） | 與 agent loop、AI Agents 設定頁自然對齊 |
| chapter | **workline**（或 branch-session） | 專案裡已在用「工作線/workline」描述它；比 branch 多了「含 worktree 與衍生會話」的含義 |
| project | project | 不變 |
| run | run | 不變 |

### 3.3 執行方式（建議一次到位，不做長期雙名）

1. 一個獨立 PR 完成：DB migration（`ALTER TABLE ... RENAME TO`，`user_version` +1）→ Go 包/型別/欄位 → API 路由 → 前端模組與文案 → 文件。
2. API 舊路由保留 302/別名**一個版本**即可（自己是唯一使用者的話甚至可以不留）。
3. migration 測試：舊庫（narrators 表）打開後自動改名且資料完整；冪等。
4. 估計工作量 1–2 天，大部分是機械替換 + 全量跑 `make check`。
5. 若決定不改名，也要做一件事：在 README 與 ARCHITECTURE 開頭放置名詞對照表，把成本顯性化。

---

## 4. 「配置已展示但未生效」清單（no-op 風險收斂)

0709 已點名此風險，合併後更需要一次性盤點。原則：**每個設定面板要嘛接到服務端真實行為，要嘛明確標示 experimental/local-only，不允許第三種狀態。**

| 面板 | 現狀 | 處置建議 |
| --- | --- | --- |
| IM Gateway | 純 localStorage 偏好，無服務端能力 | Phase B 服務端化為真實渠道；在此之前面板頂部加「尚未生效，僅為策略草稿」標示 |
| Network Search 策略 | 偏好在瀏覽器，WebSearch/WebFetch 工具在服務端 | 把 provider 預設、result limit、domain 規則下沉到服務端配置並讓工具真正讀取 |
| Skills | localStorage 草稿 + 後端 MCP registry 已接 | Phase A 服務端化（見 5.3） |
| 通知偏好 | toast 類偏好在瀏覽器；Webhook 已服務端化 | 可接受，標註清楚哪部分是本地顯示偏好 |
| Profile / Appearance | 純瀏覽器偏好 | 合理，保持 |

---

## 5. Phase A（1–2 週）：收尾與地基

目標：清空半成品與合併債務，讓後續兩個 Phase 站在乾淨的地基上。

### 5.1 提交工具權限規則表（見 2.3，P0）

### 5.2 Checkpoint / Rollback（0709 排定的下一項，P1）

設計建議：

- **記錄點**：每個 run 開始時記錄 `runs.base_head`（若尚未有此欄位則補 migration）。worktree 乾淨 → 只記 HEAD；worktree 髒 → 用 `git stash create`（不動 worktree）拿到 snapshot commit，把 object 存到 `refs/codeharbor/checkpoints/<runId>`，含 untracked（`git stash create` 不含 untracked，需要 `git add -A --intent-to-add` 前置或改用臨時 index 方案；MVP 可先明確聲明「僅回滾已跟蹤檔案」）。
- **回滾 API**：`POST /api/runs/{id}/rollback`，語意 = 把 run 觸碰的已跟蹤檔案恢復到 base 狀態。實作用 `git restore --source=<checkpoint>` 於顯式檔案列表，**不用** `git reset --hard`，維持「不偷偷執行破壞性 Git 命令」原則。
- **UI**：run summary 卡片上出現「回滾此輪變更」按鈕，點擊後彈確認框，明確列出將被恢復的檔案與「未提交的其他改動不受影響/會受影響」的準確描述。
- **邊界**：跨 run 交錯修改同一檔案時，回滾提示衝突並拒絕，讓使用者走 Git modal 手動處理。第一版寧可保守拒絕，不做聰明合併。
- **驗收**：e2e 覆蓋「run 寫入兩個檔案 → rollback → 檔案內容回到 base、其他檔案不動、`refs/codeharbor/*` 清理」。

### 5.3 Skills 服務端化（P1）

- 新表 `skills`：`id, name, description, kind(slash|prompt|mcp-draft), content, enabled, source(local|imported), created_at, updated_at`。
- CRUD API + 前端從服務端讀寫；提供一次性「從 localStorage 匯入」遷移按鈕，保留 JSON 匯出。
- **相容 SKILL.md 格式**：支援匯入 Anthropic 風格的 skill 目錄（frontmatter name/description + 正文），為未來生態相容鋪路。
- **安全底線（OpenClaw 教訓）**：匯入的 skill 啟用前必須完整展示原文；掃描並標記含「執行命令、讀取憑證、外送資料」語意的段落（第一版用關鍵詞規則即可）；記錄來源。

### 5.4 命名重構（見第 3 節，建議排在本 Phase，趁 DB 還小）

### 5.5 文件收斂與 README 改寫（見 2.4、1.2）

### 5.6 Phase A 驗收清單

- [ ] working tree 乾淨，`make check` 綠。
- [ ] 任一 run 可一鍵回滾且有測試。
- [ ] skills 存在 SQLite，換瀏覽器不丟。
- [ ] 全倉庫 `grep -ri narrator` 只剩 migration 歷史與 CHANGELOG。
- [ ] README 第一屏是定位句，not 功能羅列。

---

## 6. Phase B（1–2 個月）：IM 派任務閉環——合併的真正價值所在

這是整個合併動作應該兌現的產品差異化。目標閉環：

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

Telegram 用 long polling 的關鍵優勢：**本機不需要暴露任何入站端口**，與 CodeHarbor「本地優先」的安全模型天然一致。

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

1. **顯式總開關**：`CODEHARBOR_IM_INBOUND=true` 才處理任何入站；預設只出站通知。
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

### 6.6 成本預算與告警（P2 → 本 Phase 順手做）

- `projects.budget_usd` + run 級成本累計（`api_requests` 已有 usage/cost 基礎）。
- 80% 預算 → 通知警告；100% → 暫停 run 並要求顯式繼續（IM 上就能回覆繼續，正好吃到閉環紅利）。
- 未知模型成本估 0 的現狀要在 UI 標註「估算不含未知模型」。

### 6.7 會話全文搜尋（P2）

- SQLite FTS5 虛表對 message content 建索引（migration + 觸發器同步）。
- `GET /api/search?q=...` + 前端 Cmd+K 全局搜索，結果跳轉到對應 agent/message。
- 長期使用後找回「上次那個 bug 是怎麼修的」，是常駐伺服器相對 CLI 的隱性優勢，值得早做。

### 6.8 Chapters/Worklines 可視化面板（P2）

- 側欄樹：workline 層級、分支名、worktree 乾淨度、ahead/behind、最近 run 狀態。
- 行內操作：fork / merge-check / merge，複用現有 API。
- 這是把「別人沒有的架構能力」變成「使用者看得見的功能」的關鍵一步。

### 6.9 Phase B 驗收

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

### 7.7 技能生態與掃描

- SKILL.md 匯入（5.3）之上：技能啟用歷史、來源指紋、更新 diff 展示；掃描規則持續補充（對照 OpenClaw SkillSpector 的公開風險分類）。

### 7.8 其他中型項

- **MCP 長連接會話池**：stdio session 保活 + idle TTL + 崩潰重啟，消除每次 initialize 開銷。
- **Provider capability 標記浮出 UI**：模型下拉直接顯示 tools/streaming/vision 支援，避免「選了不支援 tools 的模型還以為 agent 壞了」。
- **首次啟動三步引導**：配 key → 驗證模型（真打一次請求）→ 建第一個專案。目前配置面複雜度已經需要這個了。
- **子代理（sub-agent）**：agent 可 spawn 限定範圍的子 run 並回收摘要。與 workline 架構天然契合，但依賴佇列與成本護欄先就緒，放本 Phase 末。

---

## 8. 功能優先級總表

| 功能 | 優先級 | 難度 | Phase | 一句話 MVP |
| --- | --- | --- | --- | --- |
| 工具權限規則表收尾提交 | P0 | 低 | A | working tree 乾淨、測試綠 |
| Checkpoint / Rollback | P1 | 中 | A | run summary 卡一鍵回滾已跟蹤檔案 |
| Skills 服務端化 + SKILL.md 匯入 | P1 | 中 | A | skills 表 + 遷移按鈕 + 啟用前展示 |
| narrator/chapter 改名 | P1 | 低中 | A | 一個 PR + migration + 測試 |
| 文件收斂 + README 定位改寫 | P1 | 低 | A | 一份 roadmap、一句定位 |
| Telegram 出站通知 + 審批閉環 | P1 | 中 | B | /status /approve /deny + 配對 |
| 通知歷史 + 重試隊列 | P1 | 低中 | B | 失敗可見可重試 |
| 成本預算與告警 | P2 | 低 | B | 專案預算 80%/100% 兩檔 |
| FTS5 會話搜尋 | P2 | 低中 | B | Cmd+K 搜歷史訊息 |
| Worklines 可視化面板 | P2 | 中 | B | 樹 + fork/merge-check/merge 入口 |
| IM 派新任務 /task | P2 | 中 | B末 | 預設關閉的顯式開關 |
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

## 10. 建議執行順序（0712 起第一週）

1. 收尾並提交 workflow 權限規則（2.3 清單）。
2. 刪空目錄、`.narrafork`，規劃文件移入 `docs/plans/`。
3. 做出改名決定（建議：改），排一個獨立 PR。
4. Checkpoint/Rollback 後端 + summary 卡按鈕。
5. Skills 服務端化 migration 與 CRUD。
6. README 第一屏改寫定位句。
7. 有餘力：Telegram 出站通知 spike（long polling + 配對碼原型），為 Phase B 探路。

## 11. 核心產品判斷（本文件唯一需要記住的話)

> 0709 的判斷依然成立且因合併而更清晰：**「派任務 → 後台執行 → 主動提醒 → 審批 → 回顧 → 一鍵提交」是唯一主線。這次合併的全部意義，是讓「提醒與審批」離開瀏覽器、跟著你的手機走；龍蝦專案的其他部分（渠道矩陣、通用助理、技能市場）都不要跟。做深這一條線，CodeHarbor 就是市場上沒有的東西：OpenClaw 管不了代碼，Claude Code 離不開終端機，而你兩邊都在。**

## 附錄：外部對照資料

- OpenClaw GitHub：https://github.com/openclaw/openclaw （29 渠道、ClawHub、約 50 萬部署）
- OpenClaw Docs（Gateway/Workspace/Agent 架構、配對與審批模式）：https://docs.openclaw.ai/
- OpenClaw 技能安全（Skill Card / SkillSpector，2026-06 起）：https://en.wikipedia.org/wiki/OpenClaw
