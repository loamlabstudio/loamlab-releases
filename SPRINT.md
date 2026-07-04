# SPRINT: Dodo Payments 極簡高可用架構重構

## CONTEXT_DIGEST
針對近期的「詐欺 (fraudulent)」爭議，根本原因在於目前的 `webhook.js` 與 `verify_payment` 邏輯過於臃腫：包含複雜的「按月份去重 (period deduplication)」、「fallback_order_id」以及各種條件判斷。這導致程式容易在邊界條件下拋出錯誤或漏接事件，讓用戶扣了款卻沒拿到點數。
**第一性原理**：所有交易在 Dodo 端都有一個全球唯一的 `payment_id`。我們只需要信任資料庫的 `UNIQUE(order_id)` 限制（唯一鍵約束），就能實現最完美的冪等性 (Idempotency)，徹底刪除所有多餘的狀態判斷程式碼。

## 解決策略 (KISS 原則)
1. **單一真理來源**：以 Dodo 的 `payment.succeeded` 加上 `payment_id` 為唯一標準。捨棄使用 `subscription.renewed` 來發放點數（因為續訂時 Dodo 也會發 `payment.succeeded`，處理兩次會產生競態條件與複雜的去重邏輯）。
2. **讓 Database 處理併發**：不再用 SELECT 去檢查這個月有沒有給過點數，直接 INSERT `DODO_{payment_id}`。如果重複，Supabase 會自然報錯 (`23505`)，直接 Catch 忽略即可。
3. **無腦拉取 (Dumb Pull) 取代智能修復**：用戶點擊「驗證付款」或登入時，不再去猜測訂閱是否為 active。直接向 Dodo 拉取該 email 的所有 `succeeded` payments，無腦全部嘗試 INSERT。

---

## TASKS

### [x] Task 1: 斬斷 Webhook 的複雜去重邏輯 (大幅刪減代碼)
**影響檔案**: `loamlab_backend/api/webhook.js`
**說明**: 
- **清理 `payment.succeeded`**：刪除 `nowPeriod`、`dedupPayQuery`、`isUpgrade` 這些檢查邏輯。直接將 `orderId` 設為 `DODO_${data.payment_id}` 並呼叫 `processTopup`。利用 Supabase 的 Unique Index 防止重複發放。
- **清理 `subscription.renewed` / `subscription.active`**：移除這些事件中的 `processTopup` 點數發放邏輯（保留更新 `dodo_subscription_id` 等中繼資料即可），避免與 `payment.succeeded` 職責重疊。

### [x] Task 2: 極簡化 `verify_payment` 自助同步機制
**影響檔案**: `loamlab_backend/api/user.js`
**說明**: 
- **重構 `verify_payment` API**：刪除查 `subscriptions` 並透過 period 兜底的複雜邏輯。改為：向 Dodo 請求 `payments?customer_email=...&limit=10`。篩選出 `status === 'succeeded'` 的訂單，全部呼叫 `processTopup(..., DODO_${payment_id})`。
- **自動對帳**：只要因為 Unique Index 報錯就代表已發放過，安靜忽略；若成功寫入，代表補發成功。這樣即使訂閱已被取消 (`canceled`)，只要有成功扣款的 `payment` 紀錄就能順利補發點數。

### [x] Task 3: 補齊「退款與爭議」防護網
**影響檔案**: `loamlab_backend/api/webhook.js`, `loamlab_backend/lib/activate.js` (可選)
**說明**: 
- 在 `webhook.js` 實作對 `payment.disputed` 與 `payment.refunded` 的傾聽。
- 當事件發生時，立刻將該用戶的 `points` 扣除（不足則歸零），並將 `subscription_plan` 設為 `null`，防止用戶透過爭議白嫖服務。

---
status: DONE
