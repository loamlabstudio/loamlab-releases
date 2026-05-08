# SPRINT: KOL 系統邊界邏輯與追蹤漏洞修復

## CONTEXT_DIGEST
目前 KOL 系統存在三大邏輯斷層：1. Webhook 未處理新用戶，導致買家未註冊直接結帳時，KOL 拿不到分潤與首單點數。2. Webhook 漏接退款事件，15 天冷卻期形同虛設。3. 網站分享連結 `?ref=` 寫在 LocalStorage，導致 SketchUp 開啟預設瀏覽器直接打 `/api/auth/login` 時無法讀取，追蹤完全斷鏈。

## TASKS

### 1. [x] 修復 Webhook 新用戶歸因與點數漏發
*   **影響檔案**：`loamlab_backend/api/webhook.js`
*   **說明**：重構 `processTopup` 流程。將取得或建立用戶的邏輯移至最前方；確保**無論新舊用戶**，只要結帳時帶有 KOL 折扣碼，都能正確寫入 `referred_by`。並保證新用戶也能觸發首單「邀請人得300、被邀人得100」的點數派發邏輯。

### 2. [x] 實作 Webhook 退款事件攔截 (防惡意退款)
*   **影響檔案**：`loamlab_backend/api/webhook.js`
*   **說明**：新增監聽金流退款事件（Dodopayments: `payment.refunded` 等，LemonSqueezy 對應退款事件）。當發生退款時，尋找 `kol_ledger` 中對應的 `transaction_id` (通常為 `fullOrderId`)，將該筆佣金紀錄的 `status` 更新為 `cancelled`。

### 3. [x] 修復 KOL 專屬連結自動綁定斷鏈
*   **影響檔案**：`loamlab_backend/public/index.html`、`loamlab_backend/public/auth-bridge.html`、`loamlab_backend/api/auth/login.js`
*   **說明**：將前端網頁攔截 `?ref=` 並存入 `localStorage` 的寫法，改為同時寫入 HTTP Cookie (`loamlab_kol_ref`, max-age=30天, path=/)。在 `login.js` 中新增解析 `req.headers.cookie` 的邏輯，讓後端登入 API 能順利讀取邀請碼並寫入 `auth_sessions.kol_ref`，恢復點擊連結即自動綁定的體驗。

status: DONE
