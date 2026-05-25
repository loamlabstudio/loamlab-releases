# 核心問題剖析

針對用戶回報的三個登錄與顯示問題，已經找到根本原因（Root Causes）：

1. **驗證碼登錄登錄不進去**：
   - 原因：Supabase 預設發送的 OTP 驗證碼長度為 6 碼。但在前端 `loamlab_plugin/ui/app.js` 中（約 3785 行），強制擋下了 `token.length < 8` 的請求，導致點擊驗證按鈕後直接 return，連後端都沒送到。
2. **登錄後沒顯示綁定的賬號，但可以順利渲染** 以及 **重新登錄點數依然顯示 "-"**：
   - 原因 1：當用戶透過 OTP 登錄時，後端 `api/auth/otp.js` 的 `verify` 行為**沒有**將用戶當前的 IP 寫入 `users` 表的 `last_login_ip` 欄位（而 Google 登錄的 poll.js 有寫入）。
   - 原因 2：在 `api/user.js` 取點數的邏輯中，強制檢查了 `!userRow.last_login_ip`。如果是 null 或不匹配當前 IP，就會回傳 401。這導致前端 `fetchUserPoints` 失敗，UI 上的點數顯示 "-"，且因為 catch 而跳過 `updateLoginUI`（所以沒顯示綁定帳號）。
   - 矛盾點：`api/render.js` 允許 `last_login_ip` 為 null 的用戶進行渲染（為了相容舊用戶），所以用戶雖然取不到點數，卻可以順利渲染。

---

# TASKS

## 1. [x] 修正前端 OTP 驗證長度限制 [MUST]
- **影響檔案**：`loamlab_plugin/ui/app.js`、`loamlab_plugin/ui/index.html`
- **執行動作**：
  - 將 `app.js` 中 `btn-verify-otp` 事件裡的 `token.length < 8` 改為 `token.length < 6`。
  - 將 `index.html` 中 `#login-code-input` 的 `maxlength="8"` 改為 `maxlength="6"`。

## 2. [x] 補齊 OTP 登錄時的 IP Pinning 紀錄 [MUST]
- **影響檔案**：`loamlab_backend/api/auth/otp.js`
- **執行動作**：
  - 在 `verify` 成功 (拿到 `data.session` 或驗證通過) 時，獲取當前 `clientIp`（參考 `poll.js` 寫法，如 `(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress`）。
  - 使用 Supabase admin client 執行 `update({ last_login_ip: clientIp }).eq('email', email)`，確保透過驗證碼登錄的用戶也能正確綁定 IP。

## 3. [x] 放寬 api/user.js 的 IP 檢查邏輯以相容舊用戶 [MUST]
- **影響檔案**：`loamlab_backend/api/user.js`
- **執行動作**：
  - 對齊 `api/render.js` 的邏輯：僅當 `userRow.last_login_ip` 存在且不等於 `clientIp` 時才擋下。若 `last_login_ip` 為 `null` 則放行。
  - 修改 `!userRow || !userRow.last_login_ip || userRow.last_login_ip !== clientIp` 為 `if (userRow?.last_login_ip && userRow.last_login_ip !== clientIp) { ... }`。

---

status: DONE
