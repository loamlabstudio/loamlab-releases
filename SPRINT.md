# Sprint Plan: 大使邀請碼顯示與比對邏輯優化

## CONTEXT_DIGEST
用戶希望大使在前端看見的專屬邀請碼，優先以 `dodo_discount_code` 為主。
為了確保一般用戶輸入大使分享的 `dodo_discount_code` 時能成功綁定，後端的綁定 API 與 Webhook 歸因邏輯必須一併擴充，支援查詢與比對 `dodo_discount_code` 欄位，確保前後端邏輯一致。

## TASKS

### 1. [MUST] 後端資訊回傳擴充：優先傳遞 dodo_discount_code
**影響檔案**: `loamlab_backend/api/user.js`
- 在 GET 路由查詢 `users` 時，於 `select` 中加入 `dodo_discount_code` 欄位。
- 檢查用戶若為 `is_kol` 或 `is_partner` 且 `dodo_discount_code` 有值，則該值即為 `display_code`；否則 `display_code` 為 `referral_code`。
- 回傳 JSON 中新增或直接取代 `referral_code` 欄位，將值傳遞給前端。

### 2. [MUST] 後端綁定 API：支援雙代碼比對
**影響檔案**: `loamlab_backend/api/user.js`
- 在處理 POST 綁定邀請碼時，尋找 `inviter` 的邏輯需改為：匹配傳入的代碼等於 `referral_code` **或者**等於 `dodo_discount_code`。
- 保持英文字母不分大小寫（全轉大寫）的比對一致性。

### 3. [MUST] Webhook 歸因 API：支援雙代碼比對
**影響檔案**: `loamlab_backend/api/webhook.js`
- 在 `processTopup` 中尋找 `kolByCode` 時，將查詢條件擴充為支援匹配 `referral_code` **或者** `dodo_discount_code`。

### 4. [MUST] 前端接收顯示調整
**影響檔案**: `loamlab_plugin/ui/app.js`
- 修改 `_doFetchUserPoints` 處理後端回傳資料的邏輯，確保將優先取得的代碼（`dodo_discount_code` 或 `referral_code`）正確傳遞給 `updateLoginUI`。
- 確保 `domMyCode.textContent` 正確顯示該代碼。

### 5. [MUST] 測試與發佈新版
**影響檔案**: `loamlab_plugin/version.json` (或相關打包腳本)
- 更新版本號。
- 執行發佈流程（包含後端部署指令與插件打包）。

status: DONE
