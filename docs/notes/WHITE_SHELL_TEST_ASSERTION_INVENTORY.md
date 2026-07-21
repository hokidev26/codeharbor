# white-shell.test.mjs 源碼斷言盤點（app-main.mjs 解鎖用）

日期：2026-07-21 · 基準：`9072b1f`

`white-shell.test.mjs`（1,912 行）對 `app-main.mjs`（3,806 行）做了 **186 條源碼文字斷言**。
其中一部分把函數「本體」釘死在 app-main.mjs 內，使該檔無法繼續瘦身（#7 拆分止步於 3,806 行）。
本文件是逐條分類結果，作為改寫工作的依據。

## 分類總表

| 類別 | 條數 | 處置 |
|---|---:|---|
| cache-stamp（`import ... ?v=xxx` 版本戳） | 19 | **保留為源碼斷言** |
| wiring pin（進入點裝配片段） | 111 | **原則保留**，僅在裝配本身搬移時同步更新 |
| negative guard（`doesNotMatch`，防功能重新引入） | 17 | **保留**，但搬移後須注意「真空成立」風險 |
| body pin（釘死函數實作本體） | 39 | **改寫為行為測試** |
| 合計 | 186 | |

### 為什麼 cache-stamp 與 wiring pin 該留

- cache-stamp 驗證的就是「import 字串帶了正確的快取失效戳」，這在本質上只能用源碼檢查，沒有行為等價物。
- app-main.mjs 的正當職責就是進入點：imports + 狀態 + controller 裝配 + bootstrap。
  斷言「它有把 X controller 接起來」是合理的契約測試，不算過度約束。

### negative guard 的隱藏風險

`assert.doesNotMatch(appMain, /X/)` 在程式碼被搬到別的模組後會**真空成立**——測試照樣綠，
但保護已經消失。改寫時每遇到一條 negative guard，必須確認：
該 guard 想擋的東西是否仍在新位置被擋住？若否，須在新模組的測試補回等價斷言。

## body pin 釘死的函數（28 個，全在 app-main.mjs）

以 `indexOf("function X")` 切片（16）或內聯 `/function X\(...\)[\s\S]*?/` 正則（18）釘死，去重後 28 個：

| 叢集 | 函數 | 白箱斷言數 |
|---|---|---:|
| **subagent 卡片** | `subagentCardIdentity`、`captureSubagentCardViewState`、`restoreSubagentCardViewState`、`subagentToolActivity`、`replaceSubagentCard`、`refreshSubagentCardsPreservingUI`、`scheduleSubagentCardRefresh`、`loadBackgroundTasksForAgent`、`navigateToSubagentAgent`、`navigateToSubagentRun`、`performSubagentCardAction`、`bindSubagentCardActions` | 26 |
| **settings shell** | `enterSettingsShell`、`exitSettingsShell`、`renderSettingsNav`、`updateSettingsSearchQuery` | 19 + 15 |
| **workbench 切換** | `applyPrimaryWorkbench`、`switchPrimaryWorkbench`、`renderWorkbenchHeaderIdentity` | 19 |
| **overview 導覽** | `openOverviewDashboard`、`openOverviewSchedules`、`openOverviewTask`、`leaveOverviewForMobile` | 17 |
| **navigation 建立/選取** | `navigationCreateTarget`、`createNavigationItem`、`beginNavigationSelection`、`selectProject`、`selectNavigationConversation`、`markMessageViewportBusy` | 16 + 18 |
| **agent 進入** | `enterAgent`、`showModelSetupNotice` | 併入 subagent 區塊 |
| **其他** | `syncProjectOperationContext`、`signalAppReady`、`openConversationDetails` | 分散 |

## 這些斷言實際保護的行為（不可流失）

以 subagent 卡片叢集為例，26 條斷言保護的是**真正的正確性性質**，不是排版：

1. 卡片身分必須用 `(runId, toolUseId)`，**不得用 index**（重排時身分才不會錯亂）——
   有一條 `doesNotMatch(...subagentCardIdentity 本體..., /String(index)|cardIndex/)` 專門擋這個。
2. 刷新流程**不得輪詢子工具呼叫**（`doesNotMatch(refreshBody, /loadRunSummary|tool-calls|loadTask/)`）——
   這是整個測試命名「without polling child tool calls」的核心。
3. 刷新原因白名單**不得包含 `task.output`／`output-loaded`**（避免輸出串流造成刷新風暴）。
4. 選取序號守衛：`expectedSelectionSeq !== state.projectSelectSeq` 時丟棄過期刷新（切換 Agent 後不誤刷）。
5. 檢視狀態保存/還原：details 開合狀態、狀態變更時首個 detail 不強制還原、焦點以
   `preventScroll` 還原、找不到按鈕則退回 `summary`。
6. 全部卡片就地替換成功才走快路徑，否則整段重繪並保捲軸。

**結論：這些斷言的「意圖」全部值得保留，問題只在「實作方式」用了源碼文字比對。**
改寫成行為測試後保護力會更強——現行寫法只要有人改動格式就會誤報，
而真正的行為回歸（例如把身分改成 index 但寫法繞過正則）反而抓不到。

## 改寫策略

每個叢集兩步走，各自獨立 commit：

1. **抽出模組**：把叢集函數搬進 `<cluster>.mjs`，依賴以工廠參數注入（`createXController({ state, ... })`）。
   注意 `backgroundTasks` ↔ `scheduleSubagentCardRefresh` 這類循環依賴要用 getter 注入。
2. **改寫斷言**：在新的 `<cluster>.test.mjs` 用手搓 fake DOM 驅動模組，
   以行為結果斷言上表的每一條性質；同步從 white-shell.test.mjs 移除已被取代的源碼斷言，
   保留 cache-stamp 與跨模組（chat-rendering / background-tasks）斷言。

驗收：測試總數不得減少、`make check` 全過、每條被移除的源碼斷言都能在新測試找到對應的行為斷言。

---

## 執行結果（2026-07-21 完成）

六輪改寫完成，app-main.mjs 3,806 → 3,522 行，前端測試 523 → 565。

| 叢集 | 手法 | 新測試檔 |
|---|---|---|
| subagent 卡片 | 整組抽出 `subagent-cards.mjs`（依賴注入，背景任務用 getter 解循環） | `subagent-cards.test.mjs` |
| 設定殼層停靠 | 反轉注入方向，session 與 enter/exit 移入 `settings-shell-helpers.mjs` | `settings-shell-docking.test.mjs` |
| workbench 可見性 | 只抽純決策 `primaryWorkbenchLayout`，DOM 編排留在進入點 | `workbench-layout.test.mjs` |
| overview 導覽 | if-chain 改為 `overviewNavigationRoute` 路由表 | `overview-navigation.test.mjs` |
| navigation 建立目標 | 抽 `navigation-create.mjs`（target 與 label 綁在一起） | `navigation-create.test.mjs` |
| 設定搜尋落點 | 命名為 `nextFilteredSettingsKey` | `settings-search-focus.test.mjs` |

### 修正：原本的「解鎖 1,500 行」預期是錯的

盤點時假設源碼釘死是 app-main.mjs 無法瘦身的主因。**實測推翻了這點**：
全部被釘死的函數合計僅約 400 行，即使全部解除，app-main.mjs 也只能降到約 3,220 行。
其餘約 1,700 行在 60+ 個**從未被釘死**的函數、52 個 controller 裝配區塊與 64 個 import——
那些一直都可以自由重構，與本測試無關。

因此本輪的價值不在行數，而在**測試品質**。原斷言只驗證原始碼長相，例如設定殼層那組
只檢查元素 id 字串出現在源碼中，從未驗證元素真的被隱藏、更沒驗證離開時被還原。

### 剩餘未改寫者（約 295 行，23 個函數）

`enterAgent`、`renderSettingsNav`、`renderWorkbenchHeaderIdentity`、`syncProjectOperationContext`、
`openOverview*`、`selectProject`、`selectNavigationConversation` 等，多為重編排邏輯：
外部協作者常達 15–20 個，抽出後注入清單會比邏輯本身還長，屬於「搬移耦合」而非「建立邊界」。
其中 `associationKey`、`getTaskByParentTool`、`clearRunSummary`、`renderLiveAssistantCard`
四個根本不在 app-main.mjs，是對其他模組的跨檔源碼檢查。

**建議**：純決策已採收完畢，此處停止。若日後仍要讓 app-main.mjs 大幅瘦身，
應處理的是那 52 個 controller 裝配區塊，那是獨立的架構工作，與本測試無關。
