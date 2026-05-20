# SPRINT: Fix Login Polling and OTP Email Template

## CONTEXT_DIGEST
Users reported that the OTP email contains 8 digits but the text says "6 位數". Additionally, users logging in via Google see "Login Successful" in the browser, but the plugin fails to detect the login state and remains stuck or asks for OTP. This is likely caused by SketchUp's embedded Chromium browser caching the polling GET request, and a mismatch in Supabase email template settings.

## TASKS

1. **Update Supabase Email Template (Admin Panel required)**
   - **影響檔案**: N/A (Supabase Dashboard)
   - **優先級**: [MUST]
   - **說明**: 請登入 Supabase 控制台，進入 **Authentication -> Email Templates -> Magic Link / OTP**。將原先硬編碼的「6 位數驗證碼」修改為支援雙語且不限定位數的通用文案，例如：「請在 SketchUp 插件面板中輸入以下驗證碼： / Please enter the following verification code in the SketchUp plugin:」。同時確認 Auth Providers 中的 Token length 設定（目前為 8 碼）。

2. **Fix Google Login Polling Cache Issue**
   - **影響檔案**: `loamlab_plugin/ui/app.js`
   - **優先級**: [MUST]
   - **說明**: 在 `app.js` 中 `startOAuthFlow` 的輪詢邏輯 (大約 3675 行)，`fetch` `/api/auth/poll` 時加上防快取的時間戳記參數（例如 `&t=${Date.now()}`）。這能解決 SketchUp 內建瀏覽器對 GET 請求的激進快取問題，確保 Google 登入成功後，狀態能正確同步回插件，避免軟體卡在登入畫面而讓用戶誤以為需要切換回驗證碼登入。

3. **Enhance OTP Error Handling & UI**
   - **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
   - **優先級**: [NICE]
   - **說明**: 檢查 `app.js` 處理 `/api/auth/otp?action=verify` 的錯誤回傳 (`statusMsg.textContent = data.msg`)，確保報錯文字支援多語言（例如遇到 "Invalid or expired code" 時提供對應翻譯），並確認 `login-code-input` 的 `maxlength` 為 8 且排版置中對齊。

status: DONE
