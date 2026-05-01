# SPRINT: KOL 權限與客製化折扣碼修正

## CONTEXT_DIGEST
目標：修正前一版過度開放的 KOL 邏輯。使用者不應該人人都是 KOL，且 KOL 折扣碼應可由管理員自訂。
同時，Vercel 的 Dodopayments Webhook Secret 已正確設定，請 Claude 忽略環境變數的修改建議，不要去動它。

## TASKS

### TASK 1: 資料庫增加 KOL 權限標記 [MUST]
**描述**：在 `users` 表格中新增 `is_kol` (BOOLEAN DEFAULT false)。未來只有 `is_kol = true` 的使用者，才算是大使。管理員會直接進 Supabase 手動將目標使用者設為 `is_kol = true`，並手動將其 `referral_code` 更改為客製化字串（如 `JOHN10`），不使用系統隨機產生的 6 碼。
**影響檔案**：
- `loamlab_backend/supabase_setup.sql` (加入 ALTER TABLE 指令)

### TASK 2: 前端面板顯示邏輯修正 [MUST]
**依賴**：完成 TASK 1
**描述**：在 Plugin 前端，獲取使用者資料時，判斷 `is_kol` 狀態。
若為 `false`，則**隱藏**「您的專屬推薦碼」與 KOL 面板相關功能。一般使用者只能看到「輸入大使折扣碼」的欄位，不能隨便當 KOL 散播代碼。
**影響檔案**：
- `loamlab_plugin/ui/app.js` 或相關 UI 檔案
- `loamlab_backend/api/user.js` (回傳 `is_kol` 欄位)

### TASK 3: 折扣碼綁定邏輯修正 [MUST]
**依賴**：完成 TASK 2
**描述**：粉絲輸入折扣碼 (APPLY) 時，後端必須驗證該代碼所屬的帳號是否具備 `is_kol = true` 權限。若無權限或是無效代碼，則回傳錯誤。同時，須防止使用者輸入「自己」的代碼（自我推薦）。
**影響檔案**：
- `loamlab_backend/api/user.js` (或負責處理綁定/APPLY的 API)

### TASK 4: 忽略 Webhook 設定變更與強化防漏綁定 [MUST]
**描述**：現有的 `DODO_WEBHOOK_SECRET` 已經是可運作的亂碼格式，請**不要**要求修改任何環境變數。
**防漏綁定邏輯**：在 Webhook 收到付款成功通知時，除了檢查資料庫原有的 `referred_by` 外，**必須讀取 Dodopayments payload 中是否有被套用的 discount_code**。若有，優先反查該代碼對應的 KOL，並在當下將該使用者補上永久綁定。這樣就算使用者繞過插件直接在結帳網頁輸入折扣碼，也能精準分潤給 KOL。
**影響檔案**：
- `loamlab_backend/api/webhook.js`

### TASK 5: 實作 KOL 專屬進度面板 (Dashboard) [MUST]
**描述**：前一次 Sprint 遺漏了大使自己看進度的功能。請實作 `/api/kol/dashboard.js` API，透過 `is_kol` 與 `referral_code` 查詢該 KOL 邀請的總付費人數、當前階梯 (5%, 10%, 15%)、以及距離下一階的進度。
**資安要求**：API 絕對不可回傳粉絲 Email 或個資，僅可回傳聚合數據（總人數、收益額），並嚴格校驗請求者的 `is_kol` 狀態。
**遊戲化體驗**：在前端 `loamlab_plugin/ui/index.html` 的邀請彈窗中，若使用者是 KOL，需加入視覺化的進度條（例：「距離下一階梯 10% 分潤只差 4 人！」）與動態收益卡片，利用榮譽徽章與數據增長感營造推廣成癮性。
**影響檔案**：
- `loamlab_backend/api/kol/dashboard.js` (新建)
- `loamlab_plugin/ui/index.html` (加入進度條與數據 UI)
- `loamlab_plugin/ui/app.js` (串接 API 並渲染畫面)

status: DONE
