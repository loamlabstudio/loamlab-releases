# CONTEXT_DIGEST
當前金流架構使用 Dodo Payments 的 `change-plan` API 處理升降級，引發了嚴重的業務邏輯與安全性事故。
事故根因：`change-plan` 會產生「補差價 (Proration)」的畸零付款，這類 Webhook Payload 的 `product_cart` 為空，且金額不可預測。我們後端的 `processTopup` 邏輯存在嚴重漏洞：只要 `metadata` 帶有 `planKey: STUDIO` 且付款成功，就會「無條件強制覆寫當月點數為 9000」，這導致用戶只要花 1 美元的補差價，就能無限次將點數洗回 9000 滿血狀態。
**重構第一性原理**：徹底廢棄所有「按比例補差價」與「依賴單一訂閱變更」的邏輯。用戶每次購買/升級方案，都必須走全新的 `/checkouts` 流程並支付全額，以當天作為新計費週期的第一天。同時，後端必須嚴格校驗付款金額與點數的對應關係。所有受害者（包含 alen3388 與 weiweichen0717）已完成手動補發與致歉，接下來必須從源頭重構。

# TASKS

1. **[MUST] 廢除 `change-plan` 補差價邏輯，改為全額新訂閱**
   - 描述：修改 Checkout API。當既有訂閱者購買新方案時，**嚴禁**呼叫 Dodo 的 `change-plan` API。改為像全新用戶一樣，直接產生全新的 `/checkouts` 連結。這會讓用戶支付全額，並建立一個擁有完整 30 天週期的新訂閱 (Subscription)。
   - 影響檔案：`loamlab_backend/api/user.js`

2. **[MUST] 新訂閱生效時，自動取消所有舊訂閱**
   - 描述：當 Webhook 處理 `subscription.active` 或 `payment.succeeded` 時，若成功發放點數，需檢查該用戶在資料庫中是否有「與新訂閱 ID 不同」的舊活躍訂閱 (`users.dodo_subscription_id`)。若有，必須主動呼叫 Dodo API 將舊訂閱取消，確保用戶不會被雙重扣款，並將資料庫的 `dodo_subscription_id` 更新為最新訂閱。
   - 影響檔案：`loamlab_backend/api/webhook.js`, `loamlab_backend/lib/activate.js`

3. **[MUST] 強化 `processTopup` 金額驗證與點數疊加邏輯**
   - 描述：這是防禦洗點的核心。在 `processTopup` 發放點數前，**必須校驗實付金額** (`amount_usd_cents`)。若金額異常（例如低於該方案定價的 80% 或為 0），則拋出錯誤並記錄到 `webhook_errors`。
   - 同時，修改 `apply_points_delta` 的呼叫方式：若是新訂閱取代舊訂閱，剩餘的點數應該如何處理？基於第一性原理，建議直接「疊加」或「覆寫」，請設計一個不易出錯的點數發放邏輯，避免再次發生洗點。
   - 影響檔案：`loamlab_backend/lib/activate.js`

4. **[MUST] 移除前端的補差價提示與依賴**
   - 描述：前端介面如果出現「按比例退款」、「補差價」等字眼，需全面清除。文案應改為：「升級將立即以新方案重新計費並發放全額點數，舊方案將自動取消」。確保用戶的預期與後端第一性原理一致。
   - 影響檔案：`loamlab_plugin/ui/` (搜尋 Upgrade 或 Billing 相關組件)

status: DONE

# COMPLETION_NOTES (2026-07-22, Claude)
- **[1]** `user.js` checkout：移除 Dodo `change-plan`/proration 分支，既有訂閱者一律走 `/checkouts` 全額新訂閱。
- **[2]** `webhook.js` + `activate.js`：payment.succeeded 發點成功後，若存在「不同的」舊 `dodo_subscription_id`，呼叫新增的 `cancelDodoSubscription()`（`PATCH /subscriptions/{id}` status=cancelled）立即取消舊訂閱，防雙重扣款。
- **[3]** `activate.js` `processTopup`：新增 `amountPaidCents` 參數，並在後續一輪追加優化中**完全移除猜測性比例門檻**，改為直接比對 Dodo 官方記錄的真實訂閱金額：
  - **第一版（已淘汰）**：`MIN_PAYMENT_RATIO`（=0.4）× 內部價格表 `PLAN_PRICES_CENTS`，靠猜「正常折扣後至少會付多少比例」設下限。問題：數字是猜的，且對深度未知的 KOL 折扣無感知。
  - **第二版（現行）**：新增共用函式 `fetchDodoSubscriptionInfo()`（`activate.js`），訂閱付款一律呼叫 Dodo `GET /subscriptions/{id}` 取得 `recurring_pre_tax_amount`——這是 Dodo 自己鎖定的「這筆訂閱真實金額」，已內含任何折扣碼，不需要我方猜比例。`webhook.js` 對 `payment.succeeded`（帶 `subscription_id`）強制查此值，查不到就回 500 讓 Dodo 重試，絕不在未驗證金額前發點；查得到則與實付金額比對，僅留 `AMOUNT_TOLERANCE = 0.9` 吸收稅金/捨入誤差（不再是折扣容忍）。`reconcilePaymentsForEmail`（補發用 cron/手動對帳路徑）比照辦理，共用同一函式，不維護兩套邏輯。
  - `PLAN_PRICES_CENTS` 保留但降級為「記帳 fallback」（僅 LS 舊路徑等完全查不到真實金額時，估算交易紀錄顯示金額），**已不參與洗點防禦驗證**。
  - **[未涵蓋]** LemonSqueezy（LS）webhook 路徑本身未套用任何金額驗證（`amountPaidCents` 恆為 null → 略過檢查）；已與用戶確認 LS 目前無實際使用（`app.js` `CURRENT_PAYMENT_PLATFORM = 'DODO'` 鎖死，新結帳不會走 LS），故此次不處理，留待 LS 真正停用/移除時一併清理。
- **[4]** `ui/app.js` + `i18n.js`：移除 `planChanged` 分支；既有訂閱者升級顯示新文案「升級將立即以新方案重新計費並發放全額點數，舊方案將自動取消」（新 i18n key `upgrade_full_rebill_note`，6 語系齊全）。
- 驗證：4 支後端/前端檔 `node --check` 通過（app.js/i18n.js 因 bash mount 對超大檔截斷無法在沙箱驗證，已用 Read 工具確認結構完整＋localized key 齊全；ESLint 於 Windows build_rbz.ps1 實際把關）。
- 未執行 build/publish（非「發佈更新」指令）。
