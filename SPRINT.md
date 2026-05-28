# SPRINT: 優化退訂機制與原因反饋

## CONTEXT_DIGEST
當前系統中 `api/user.js` 的退訂 API 在 `PATCH` (取消於期末) 失敗時，會自動 fallback 到 `DELETE`，導致 Dodo Payments 立即終止訂閱並作廢用戶當月剩餘權益。這會引發用戶客訴。
目標：1) 移除或加上強烈防護條件來限制 `DELETE` 的觸發；2) 收集用戶退訂原因，並寫入 Supabase 供 Admin 後台審閱（建議存入既有的 `feedback` 表）。

## TASKS

1. **[x] 移除或防護高風險的 DELETE 退訂行為**
   - 描述：修改後端退訂 API。當 `cancel_at_next_billing_date` 的 `PATCH` 請求失敗時，**不可**自動觸發 `DELETE`。如果 `PATCH` 失敗，應直接 fallback 產生 Dodo Customer Portal URL 讓用戶自行處理，或僅在請求明確帶有 `force_immediate: true` 參數時才執行 `DELETE`。
   - **影響檔案**：`loamlab_backend/api/user.js`

2. **[x] 後端實作退訂原因寫入機制**
   - 描述：在 `cancel_subscription` endpoint 接收前端傳來的 `reason` 參數。如果收到原因，將其 INSERT 到現有的 `feedback` 資料表中。
   - 資料庫操作說明：不需新增欄位，直接使用 `feedback` 表，寫入 `type = 'unsubscribe_reason'`，並將具體原因放入 `content` 或 `metadata` 欄位中，關聯該用戶的 `user_email`。
   - **影響檔案**：`loamlab_backend/api/user.js`

3. **[x] 前端退訂流程新增「原因收集」對話框**
   - 描述：在用戶點擊「退訂」時，先彈出一個簡單的對話框或選項，詢問退訂原因（例如：暫時用不到、太貴、渲染效果不滿意等），將用戶選擇或輸入的原因與退訂請求一併發送給後端的 `cancel_subscription`。
   - **影響檔案**：前端外掛對應的 JS 或 HTML UI 檔案（視前端實作而定，可能是 `public/app.js` 或對應的 React 元件）

4. **[x] Admin 後台顯示退訂反饋**
   - 描述：在 `stats.js` 的 `feedback` endpoint 查詢邏輯中，確保 `unsubscribe_reason` 類型的反饋能夠被正確撈出並顯示在 Admin 面板，方便管理員查閱。
   - **影響檔案**：`loamlab_backend/api/stats.js`, `loamlab_backend/public/admin.html`

status: DONE
