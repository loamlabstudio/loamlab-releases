# SPRINT

## CONTEXT_DIGEST
1. 插件點擊付費出現 404 (`error/not-found`)，主因是 Dodo API 呼叫失敗後降級至 `fallbackUrl`，而該 URL 使用了已棄用的路徑格式 (`/buy/${productId}`)。
2. 網站的付費按鈕寫死了舊的 Dodo 結帳連結（使用 `?variant_id=` 和 `discount_code=LOAM_BETA_30`），且未與後端共用動態生成邏輯（無法整合 KOL 推薦與動態折扣）。
3. 目標是修復插件的降級 URL 格式、確保 Dodo API `discount_code` 參數正確，並將網站的付費牆架構優化，統一透過後端 API 或一致的 URL 參數來獲取結帳連結。

## TASKS

1. **[x] 修復後端 Checkout API 與降級 URL 格式** `[MUST]`
   - **影響檔案**：`loamlab_backend/api/user.js`
   - **說明**：將 `fallbackUrl` 從舊版的 `/buy/${productId}?quantity=...` 修改為正確的 Query 參數格式（例如 `/buy?product_id=${productId}&quantity=${qty}&customer_email=${email}`），並一併附上折扣碼 `discount_code=${finalDiscount}`。同時檢查 Dodo API `checkouts` 的 payload 格式，確保 `discount_code` 或 `discount_codes` 傳遞無誤，防止 API 因折扣碼報錯。支援讓 `email` 成為選填，以便網站未登入也能使用此 API 產生連結。

2. **[x] 同步網站付費牆並統一架構** `[MUST]` (依賴 Task 1)
   - **影響檔案**：`loamlab_website/src/app/page.tsx`, `loamlab_backend/api/user.js`
   - **說明**：將網站的定價方案按鈕改為呼叫後端 `/api/user?action=checkout` 來動態獲取付費連結。這將確保網站與插件統一折扣碼 (`LOAM_BETA_30` 或環境變數)，並讓網站能無縫支援未來的 KOL 歸因邏輯。需在前端處理 API 請求狀態並處理重新導向。

status: DONE
