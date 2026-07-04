# SPRINT: 第一性原理重構訂閱狀態同步架構

## CONTEXT_DIGEST
目前系統的 `subscription_plan` 與退訂意圖脫鉤。若用戶透過 Dodo Customer Portal 退訂，Dodo 發送的是 `subscription.updated` Webhook，但後端只處理升降級，遺漏了 `cancel_at_period_end` 狀態。這導致「已退訂但週期未滿」與「正常活躍」的帳號在 Supabase 無法區分，且若錯失最終的 `cancelled` 事件將導致永久發放免費 Pro 權限。我們需要基於第一性原理（金流平台為單一真相來源）全面接管 `subscription.updated` 的所有生命週期狀態。

## TASKS

### TASK 1: 重構 `subscription.updated` 狀態攔截 [MUST] [DONE]
**影響檔案**: `loamlab_backend/api/webhook.js`
**說明**: 
擴充 `subscription.updated` 處理邏輯，除了升降級外，必須完整解析訂閱狀態的變化。
1. 若 payload 中的 `status === 'canceled'` 或 `status === 'expired'`，應直接呼叫 `processCancellation(customerEmail, 'DODO')` 終止訂閱。
2. 否則，讀取 payload 中的 `cancel_at_period_end` 或 `cancel_at_next_billing_date` 欄位（根據 Dodo API 文件）。
3. 將該 boolean 值動態寫入 `updateFields.cancel_pending`，確保無論是退訂還是「撤回退訂」，都能與 Dodo Portal 即時同步。

### TASK 2: 防禦性狀態校正與容錯處理 [MUST] [DONE]
**影響檔案**: `loamlab_backend/api/webhook.js`, `loamlab_backend/api/user.js`
**說明**: 
1. **Webhook.js**: 確保 `updateFields` 能夠一次性原子更新 `subscription_plan` (升降級)、`next_plan` 與 `cancel_pending`，避免資料庫競態。
2. **User.js (Auto-repair)**: 檢查自動補發邏輯 (`limit=3` 查詢 Dodo 訂閱時)，確保它不會把 `cancel_pending = true` 但仍在活躍期內的訂閱誤判為需要重新激活，維持現有 `sub.status === 'active'` 的嚴格過濾。

### TASK 3: LemonSqueezy `subscription_updated` 補齊 [NICE] [DONE]
**影響檔案**: `loamlab_backend/api/webhook.js`
**說明**: 
若 LemonSqueezy 也有發送 `subscription_updated`，應同步補上對 `ends_at` 或狀態變更的檢查，確保無論從哪個支付渠道退訂，狀態同步機制都能保持一致。

status: DONE
