# SPRINT.md

## CONTEXT_DIGEST
- **確認訂閱機制**：透過檢查 `webhook.js`，系統目前整合了 LemonSqueezy 與 Dodo Payments，**確實是自動續約（Auto-renew）的機制**。
- **業界防流失策略 (Churn Prevention)**：優秀的 SaaS 系統不會讓用戶「一鍵無感取消」，而是導入「動態挽留流程 (Cancel Flow)」：詢問原因 $\rightarrow$ 給予針對性優惠（如打折或暫停） $\rightarrow$ 真的不要才確認取消。

## TASKS
1. **[MUST] 建立自訂的動態退訂流程介面 (Cancel Flow UI)**
   - 說明：在 `loamlab_website` (或會員中心) 攔截原本直接導向付款平台 (LS/Dodo) Portal 的取消按鈕。建立三步流程：(1) 詢問取消原因（如：太貴、太少用）；(2) 根據原因顯示動態挽留方案（太貴 $\rightarrow$ 專屬折扣碼；太少用 $\rightarrow$ 提議「暫停訂閱 1~3 個月」）；(3) 堅持取消才放行。
   - **影響檔案**：`loamlab_website/src/app/billing/cancel/page.tsx` (新建)

2. **[MUST] 實作後端挽留方案 API (Save Offer API)**
   - 說明：新增後端端點以處理用戶接受的挽留方案。利用 LemonSqueezy / Dodo 的 API，在用戶同意時自動對其訂閱套用折扣，或變更為暫停狀態 (Pause Subscription)，避免直接流失。
   - **影響檔案**：`loamlab_backend/api/user.js` (或獨立出 `billing.js`)

3. **[NICE] 失敗扣款的挽救信件 (Dunning Emails)**
   - 說明：在 `webhook.js` 監聽扣款失敗 (Payment Failed) 事件，並觸發友善的提醒信件（「您的信用卡扣款失敗，請更新以保留點數與方案」），這通常能挽回 30%~50% 的非自願退訂。
   - **影響檔案**：`loamlab_backend/api/webhook.js`, `loamlab_backend/api/stats.js` (信件發送邏輯)

status: DONE
