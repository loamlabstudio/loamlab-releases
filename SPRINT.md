# SPRINT PLAN: 解決同月重新訂閱點數分發失敗問題

## CONTEXT_DIGEST
用戶 (`hanaxyq@gmail.com`) 反應重新訂閱後只收到 175 點（舊餘額），未收到新訂閱的 2000 點。
**根本原因**：`webhook.js` 中的「月份兜底」防重複邏輯，僅用 `user_email` 和「當月第一天」作為條件。當用戶在同一個曆月內退訂並再次訂閱時，系統找到本月稍早的訂閱紀錄，誤判為重複事件而 `skipped`，導致新付款完全沒有發放點數。

## TASKS

- [x] **Task 1: 優化 Webhook 冪等性與去重邏輯 (Scoping Dedup to Subscription ID)**
  - **影響檔案**: `loamlab_backend/api/webhook.js`
  - **行動**: 
    1. 在 `payment.succeeded` 區塊，若 `data.subscription_id` 存在，將存入 DB 的 `orderId` 改為包含訂閱 ID：`const orderId = data.subscription_id ? \`${data.subscription_id}_${data.payment_id}\` : data.payment_id;`
    2. 在 `payment.succeeded` 與 `subscription.active/renewed` 區塊的「月份兜底」查詢中，增加 `.ilike('order_id', \`%${data.subscription_id}%\`)`。這樣同月內的「新訂閱」就不會被「舊訂閱」的紀錄阻塞。

- [x] **Task 2: 同步修改手動驗證與靜默修復邏輯**
  - **影響檔案**: `loamlab_backend/api/user.js`
  - **行動**: 
    1. 在 `verify_payment` 中查詢 `payment.succeeded` (近期單次付款) 時，若 `pay.subscription_id` 存在，其 `orderId` 也應對應改為 `${pay.subscription_id}_${pay.payment_id}`，確保手動補發邏輯與 Webhook 寫入邏輯的 `order_id` 格式完全一致。
    2. 檢查 `GET /api/user` 的靜默修復區塊是否也需要相應調整（目前主要透過 `subscription_id_auto`，不受 payment 影響，可維持）。

- [x] **Task 3: 撰寫補償與修復腳本給受影響用戶**
  - **影響檔案**: `loamlab_backend/scratch_fix_hana.mjs` (新建)
  - **行動**: 寫一個短小精幹的 Node.js script，使用 Supabase client 給 `hanaxyq@gmail.com` 補發缺漏的 2000 點（建立對應的 `transactions` 紀錄，標記 `order_id` 為人工補發，並更新 `users` 表的 `points` 與 `lifetime_points`），執行後確認資料正確。

status: DONE
