# 漏單 404 斷線問題修復 Sprint

## CONTEXT_DIGEST
1. 根據最新截圖，Dodo Webhook 投遞失敗的原因是收到 404 Not Found，代表當前設定的 Vercel 網址不存在或路徑錯誤。
2. 這不是安全問題，而是純粹的設定/路由錯誤。因請求未觸及程式碼，故 webhook_errors 無紀錄。
3. 第一性原理：治標需找出正確的 Production 網址並替換；治本需在程式最外層捕捉並記錄 401/500 等非 404 異常，實現錯誤透明化。

## TASKS

### TASK 1: 調查正確的 API 網址 [MUST]
- **說明**：調查前端目錄（如 loamlab_plugin 或 loamlab_website）的環境變數或設定，找出目前真正活著且被前端呼叫的 Vercel 後端 API 網址 (Production Domain)。
- **影響檔案**：(純環境調查，無特定代碼修改)

### TASK 2: 強化 Webhook 最外層錯誤透明化 [NICE]
- **說明**：為防範未來網址正確但簽章錯誤 (401) 的情況，修改 webhook.js，在 erifyDodoSignature 失敗或發生全域 Exception 時，強制將錯誤寫入 webhook_errors。此任務不影響 TASK 3 執行。
- **影響檔案**：loamlab_backend/api/webhook.js

### TASK 3: 更新 Dodo Webhook 設定並驗證 [MUST]
- **說明**：依賴 TASK 1 的結果。引導用戶前往 Dodo 後台，將舊的 404 Webhook URL 替換為正確的 URL。更新後，在 Dodo 面板發送一筆測試，確保 Vercel 回傳 200 OK，完成金流閉環驗證。
- **影響檔案**：(無代碼修改，涉及 Dodo 後台設定)

status: READY_FOR_CLAUDE
