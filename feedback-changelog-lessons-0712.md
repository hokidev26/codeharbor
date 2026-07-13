# 外部更新日誌經驗 × Autoto 現況對照報告

> 原始日期：2026-07-12
> 落地複核：2026-07-13
> 輸入：GPT 對某相似專案更新日誌的八項工程原則總結
> 方法：逐項對照目前工作樹中的實際程式碼、遷移與測試
> 姊妹文件：`needtodo0712.md`
>
> 名稱說明：專案現名為 **Autoto**；舊 CodeHarbor 名稱只保留在兼容介面或歷史記錄中。領域模型維持 **Agent / Workline**。

---

## 0. 最新結論

原始報告列出的近期高收益項目已基本收口：

- **4.1 至 4.6 全部完成。**
- **4.7 WebSocket 單調序列與 catch-up 按設計延後到 IM Gateway Phase B。**
- 原始報告中的 P1/P2 程式碼缺口已沒有未完成項。
- 完整 Provider capability matrix、Skills scope、revision 回復與分頁仍明確不做；它們是需求觸發項，不是目前欠債。
- 四條工程規範與快取七問已正式寫入 `CONTRIBUTING.md`，架構摘要已寫入 `docs/ARCHITECTURE.md`。

## 1. 八項原則最新狀態

| # | 原則 | 最新狀態 | 落地結果 |
| --- | --- | --- | --- |
| 1.1 | 派生資料由可信後端重算 | ✅ 完成 | Skill hash、scanner verdict、風險確認與正規化均由服務端產生；SQLite CHECK 約束提供最深層 fail-closed 防線。 |
| 1.2 | 兼容性能力契約 | ⏸ 需求觸發 | 目前只有少量 Provider，尚無真實能力分歧需要矩陣。現行規範禁止在業務層按 Provider 名稱特判；第一次出現真實分歧時再加入最小 capability。 |
| 1.3 | 異步操作的代次、取消、超時、回退 | ✅ 當前範圍完成 | Skills 前端已有 `serverSkillsLoadSeq` 與陳舊結果丟棄；Provider first-token timeout、retry/backoff 已有測試。WebSocket catch-up 另列 Phase B。 |
| 1.4 | 事務原子性與 CAS | ✅ 完成 | Run 啟動、終態與中斷轉換使用前置狀態條件及 `RowsAffected`；Skill 更新使用 `updated_at` 樂觀鎖並回傳 409。 |
| 1.5 | 快取邊界、版本與失效 | ✅ 完成目前所需 | Skills 已加入 `scanner_version`，啟動只重掃版本或安全中繼資料不一致的候選；損壞列 fail-closed。快取審查清單已文件化。 |
| 1.6 | 摘要列表與詳情懶加載 | ✅ 完成 | `GET /api/skills` 回傳摘要，不含 prompt/findings 全文；`GET /api/skills/{id}` 回傳完整詳情，前端按需補載。 |
| 1.7 | 狀態機優先於布林組合 | ✅ 完成 | Skills 載入使用 `idle/loading/ready/stale/error`，刷新失敗且保留舊資料時明確進入 `stale`。 |
| 1.8 | 註冊能力與啟用策略分離 | ✅ 完成 | Skill 導入預設停用；blocked 永不可啟用；review 需綁定當前 content hash 的顯式確認；MCP 註冊與 enabled 亦分離。 |

## 2. 已完成的具體落地項

### 2.1 Run 狀態轉換 CAS

`internal/db/db.go` 已將 Run 轉換拆成帶前置狀態的更新：

- `pending -> running`
- `pending/running -> completed|error|interrupted|superseded`
- 每次更新均檢查 `RowsAffected`；不合法或競爭失敗時回傳 conflict。

這消除了「手動中斷與自然完成互相覆蓋」的原始風險。

### 2.2 Skill scanner version 與增量重掃

已完成：

- `skills.scanner_version` schema 與 migration；
- `internal/skills.ScannerVersion` 常數；
- 啟動時先掃描摘要中繼資料，只載入真正需要重掃的完整 prompt；
- scanner 版本、hash、verdict、findings 或欄位損壞時重算；
- 異常列停用並記錄 audit，而不是阻止服務啟動；
- CAS 保證啟動重掃不覆蓋較新的使用者更新。

### 2.3 Skills 前端 loadSeq 與狀態枚舉

已完成：

- `serverSkillsLoadSeq` 阻止陳舊請求覆蓋新結果；
- `serverSkillsStatus` 使用 `idle/loading/ready/stale/error`；
- 初次失敗為 `error`，已有資料的刷新失敗為 `stale`；
- UI 明確顯示「載入中／舊資料／載入失敗／已載入」；
- Node 測試覆蓋順序競爭和 stale/error 分支。

### 2.4 Skill 輕量 audit log

已完成 `skill_audit_events`：

- 記錄 `create/update/enable/disable/delete`；
- 保存 actor、skill ID、content hash、verdict、finding codes、風險確認時間；
- 不保存 prompt 或 scanner 訊息全文；
- audit 與 Skill mutation 位於同一交易；audit 寫入失敗時 mutation 回滾；
- scanner revalidation 也會留下安全相關 audit。

### 2.5 Skill 樂觀鎖與 409

已完成：

- API 要求 `expectedUpdatedAt`；
- Store 使用 `WHERE id = ? AND updated_at = ?`；
- 陳舊更新回傳 409；
- 前端只在真正的 optimistic-lock 409 時重新載入列表並提示使用者；
- 兩個客戶端競爭更新已有 DB、HTTP 與前端測試。

### 2.6 Skills 摘要列表與詳情 API

已完成：

- `ListSkillSummaries` 不讀取或回傳完整 prompt；
- `GET /api/skills/{id}` 提供詳情；
- 前端對 enabled/需要顯示詳情的 Skill 進行有限並發 hydration；
- 詳情載入失敗採 fail-closed，不允許本地模板繞過服務端保留命令；
- HTTP 與 Node 測試確認列表沒有 `prompt` / `scanFindings` 全文。

## 3. 已固化的工程規範

以下規範已寫入 `CONTRIBUTING.md`，並在 `docs/ARCHITECTURE.md` 提供架構摘要：

1. **不變量儘量下沉**：安全派生欄位由可信後端重算，能使用 DB CHECK 就不只依賴 handler。
2. **狀態轉換一律 CAS**：使用預期狀態或版本條件，並檢查 `RowsAffected`。
3. **交易生命週期保持封閉**：交易內只使用 `tx`；提交前不啟動未等待 goroutine，也不對外廣播成功。
4. **異步 UI 請求一律使用 seq**：陳舊結果丟棄；多布林狀態改用顯式枚舉。
5. **業務層禁止 Provider 名稱特判**：能力契約只在真實分歧出現時最小化加入。

快取新增前必須回答：

- 快取的來源與結果是什麼；
- 容量如何限制；
- 何時過期；
- 哪個 schema/scanner/model/algorithm 版本使其失效；
- 權限、身份、content hash 或 policy 如何使其失效；
- 快取失敗是 fail-open、fail-closed 還是回到權威重算；
- 是否包含 credentials、prompt、私有路徑或其他 secrets。

## 4. 落地清單最新狀態

| # | 項目 | 原優先級 | 最新狀態 |
| --- | --- | --- | --- |
| 4.1 | `UpdateRunStatus` 前置狀態守衛與合法轉換 | P1 | ✅ 完成 |
| 4.2 | `scanner_version` 與增量重掃 | P1 | ✅ 完成 |
| 4.3 | Skills loadSeq + status enum | P2 | ✅ 完成 |
| 4.4 | Skills 輕量 audit log | P2 | ✅ 完成 |
| 4.5 | Skill `updated_at` 樂觀鎖與 409 | P2 | ✅ 完成 |
| 4.6 | Skills 列表瘦身與詳情 endpoint | P3 | ✅ 完成 |
| 4.7 | WebSocket 單調序列與 catch-up | P3 / Phase B | ⏸ 按設計延後 |

## 5. 明確延後或排除的項目

### 5.1 WebSocket sequence + catch-up

目前 Agent WebSocket 是即時傳輸，不是 durable event log。Agent 事件持久化、cursor 與 replay 已明確移除，避免在需求尚未成立時維護第二套消息模型。

只有在 IM Gateway 或其他外部任務／審批通道上線前，以下條件成立時才啟動此項：

- 瀏覽器外也能發起任務或批准工具；
- 斷線重連可能造成審批錯對象或遺失關鍵終態；
- 已先定義 event retention、entity version、權限失效與重放上限。

屆時應另立設計，不直接恢復已刪除的早期 `agent_events` 草稿。

### 5.2 Provider capability contract

目前不建立完整八欄矩陣。觸發條件是：

- 第四個以上 Provider 帶來真實能力分歧；
- 業務層第一次需要 Provider 名稱特判；
- Agent backend 的 streaming/tool/image/reasoning 能力開始不一致。

觸發後只加入真實需要的最小欄位，例如 `SupportsTools`、`SupportsStreaming`。

### 5.3 其他排除項

以下仍不是當前待辦：

- Skills global/project/workspace scope；
- 完整 revision 與舊版本恢復；
- Skills 分頁或 cursor；
- 為尚不存在的 Provider 差異預建能力矩陣。

## 6. 驗收證據

本輪收口已通過：

- `make check`；
- `go test -race ./internal/agent ./internal/server`；
- Skills DB migration、scanner revalidation、audit rollback、CAS conflict 測試；
- Skills HTTP summary/detail、風險確認與 optimistic-lock 測試；
- Skills Node load sequence、stale/error、detail hydration 與 fail-closed 測試；
- Agent/Workline 命名、Autoto 品牌與兼容遷移的全量回歸。

## 7. 最終判斷

這份報告的高收益程式碼建議已完成；剩餘項目不是遺漏，而是有明確觸發條件的延後設計。

後續如果 Phase B 啟動，應優先重新評估 WebSocket durable sequence/catch-up；如果 Provider 開始出現真實能力分歧，再加入最小 capability contract。除此之外，不應因為原則清單看起來完整，就提前增加 scope、revision 或分頁複雜度。
