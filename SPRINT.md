# Sprint Plan: 修正自動發放點數與 Lifetime Points 雙重累加問題

## CONTEXT_DIGEST
用戶反映新帳號會自動獲得 `points: 60` 以及 `lifetime_points: 60`，導致總點數異常。經查核 codebase，發現 `api/user.js`、`api/render.js` 與 `api/auth/google-callback.js` 中有寫死的 `points: 60` 初始發放邏輯，同時部分扣款或同步邏輯（如 `sync_dodo_subscriptions` 和 360 上傳）錯誤地修改或同步累加了 `lifetime_points`。

## TASKS

### 1. 統一並重構新註冊贈點邏輯 [MUST] [x]
- **說明**：將散落於各 API 的硬編碼 `points: 60` 重構，改為使用環境變數或共用設定 `INITIAL_POINTS`。明確註冊時 `lifetime_points` 應為 0，避免因為 API response 中的加總邏輯 (`data.points + data.lifetime_points`) 造成前端數字錯亂。
- **影響檔案**：
  - `api/user.js` (約 552 行)
  - `api/render.js` (約 501 行)
  - `api/auth/google-callback.js` (約 134 行)

### 2. 修正訂閱同步 `sync_dodo_subscriptions` 雙倍點數 Bug [MUST] [x]
- **說明**：`api/user.js` 在修復遺漏訂閱（Fallback）時，錯誤地將訂閱的月結算點數 (`planCfg.points`) 同時加給 `points` 與 `lifetime_points`（如 `lifetime_points: (user.lifetime_points || 0) + planCfg.points`）。這會導致點數虛增，應該只將訂閱點數賦予 `points`。
- **影響檔案**：
  - `api/user.js` (約 824-835 行)

### 3. 修正 360 全景扣款異常邏輯 [NICE] [x]
- **說明**：在 `api/render.js` 中 `upload_360` 的扣款邏輯，錯誤地將 `COST_360` 加到 `lifetime_points` (`lifetime_points: (user.lifetime_points || 0) + COST_360`)，而非正確扣除。需修改為瀑布式扣除邏輯（先扣 `points`，不足再扣 `lifetime_points`）。
- **依賴**：無，但可與 Task 1 同步處理以確保點數系統健全。
- **影響檔案**：
  - `api/user.js`
  - `api/render.js` (約 416 行)

status: DONE
