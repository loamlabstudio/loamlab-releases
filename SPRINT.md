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
- **狀態**：⏳ 待用戶手動操作（Dodo 無公開 API 可管理 webhook URL，只能在後台點）

---

## 執行備註（Claude 評估後調整，2026-08-18）

- **TASK1 完成**：正確的 Production Webhook 網址是 `https://loamlab-camera.vercel.app/api/webhook`
  （GET 測試回 405 = 端點存活，只是不接受 GET）。`loamlab-camera-backend.vercel.app` 會 307 轉址、
  `loamlabcamera.vercel.app` 也存活但屬行銷站網域，均不建議用於 Webhook。
- **TASK2 完成**：`webhook.js` 簽章驗證失敗（401）與最外層 catch 的未預期例外（500）現在都會寫入
  `webhook_errors` 表（先前只有 `processTopup` 內部拋錯才會記錄）。已通過 `check_cjs.ps1`，
  commit `0a4cc8d`，已 `vercel --prod` 部署到 production 並驗證端點存活。
- **TASK3 部分完成**：實際查發現不是網址設錯，而是 Dodo 後台重複掛了 3 個 webhook 端點（1 個
  404 死網址、1 個 307 轉址、1 個是真正對的 `loamlab-camera.vercel.app`）。真正卡住那筆真實付款
  （`evt_0NldQoXD14054EZtCGka9`）的根因其實是 `@supabase/supabase-js` 升版後 `.catch()` 全面斷裂
  （見下方追加項），不是 URL 問題。**尚未完成**：Dodo 後台那 2 個死端點還沒刪，需要用戶手動操作。

## 追加：真正根因與第一性原理重構（2026-08-18 同日追加）

- 診斷出 TASK3 那筆卡住的付款真正原因：`webhook.js`/`user.js` 共 12 處 `supabase.from(...).catch(...)`
  寫法因套件升版斷裂，同步拋錯導致真實付款處理到一半崩潰、點數從未發放。已修復並部署（commit 2fb8966）。
- 應用戶要求，順勢對點數/金流系統做第一性原理全面重構並部署（commit b3a10ad）：
  `processTopup` 改 claim-first 防雙重入帳、全面移除 LemonSqueezy、`config.js` 新增 `PLAN_DEFS`
  唯一真理來源、`deduct_render_points` 退款一律進永久點數。SQL Phase 36 已由用戶手動執行。

status: WAITING_FOR_USER（① 用戶需去 Dodo 後台刪除 2 個死 webhook 端點、確認重新發送那筆卡住付款成功；
② 其餘程式碼與 SQL 修復均已完成部署）
