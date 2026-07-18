# Sprint Plan: 綁定自定義 Node 至使用者帳號

## CONTEXT_DIGEST
目前使用者的自定義節點 (`userChips`) 僅儲存於前端 `localStorage`。由於 SketchUp 內建瀏覽器核心常在重啟時清空快取，導致自定義節點遺失，並觸發過濾機制將已選取的自訂值也一併清除。為提供一致的使用者體驗，必須將 `userChips` 儲存至資料庫並與使用者帳號綁定。

## TASKS

### 1. [x] [MUST] 更新 DB Schema 新增 `user_chips` 欄位
- **任務描述**：在 Supabase 的 `users` 資料表新增欄位，用來儲存使用者的自定義節點。
  - 新增欄位名：`user_chips`
  - 類型：`JSONB`
  - 預設值：`'{}'::jsonb`
- **影響檔案**：`loamlab_backend/supabase_setup.sql`

### 2. [x] [MUST] 實作後端同步 API
- **任務描述**：在後端實作讀取與寫入 `user_chips` 的介面（建議加在 `api/stats.js` 或相關 API 中）。
  - 新增 API 邏輯（如 `action=save_user_chips`）：接收前端傳來的 JSON 並更新至 `users` 表的 `user_chips` 欄位。
  - 新增 API 邏輯（如 `action=get_user_chips`）：讀取使用者的 `user_chips` 並回傳給前端。
- **影響檔案**：`loamlab_backend/api/stats.js` (或負責處理帳號的對應檔案)

### 3. [x] [MUST] 前端實作雲端同步邏輯
- **任務描述**：
  - 在 `app.js` 實作 `_pushUserChipsToServer()` 與 `syncUserChipsFromServer()`。
  - 當使用者登入或初始化取得 `user_email` 後，呼叫 `syncUserChipsFromServer()` 載入綁定的自定義節點，更新本地 `loamlab_user_chips` 並呼叫 `renderT1Nodes()` 重繪 UI。
  - 修改現有的 `saveUserChip` 與 `removeUserChip` 函式，在更新 `localStorage` 後同步呼叫 `_pushUserChipsToServer()`，確保資料即時上雲。
- **影響檔案**：`loamlab_plugin/ui/app.js`

status: DONE
