---
trigger: always_on
alwaysApply: true
---

# SPRINT
## Context Digest
- 用戶 (maggieliu@yoshin-design.com) 購買單次 200 Pts，因 Webhook 未送達且 `verify_payment` 存在攔截訂閱用戶驗證單次購買的 Bug，導致點數未入帳。
- 需要給該名用戶雙倍點數 (400 Pts) 作為補償。
- 必須排查 Dodo Payments 近期資料，確保沒有其他受害用戶（有扣款成功但系統未入帳的單次點數充值），若有則一併雙倍補償。

## TASKS
1. **[x] 修復 verify_payment 攔截邏輯**
   - **影響檔案**: `loamlab_backend/api/user.js`
   - **說明**: 移除 `if (curUser?.subscription_plan && daysSinceLast < 35)` 的攔截邏輯。因為 `reconcilePaymentsForEmail` 內部已經依賴 `processTopup` 做嚴格的冪等檢查，移除此防禦攔截才能讓有訂閱的用戶也能順利手動驗證「單次點數購買」。

2. **[x] 手動補發並給予 maggieliu 雙倍補償**
   - **影響檔案**: 無直接修改檔案（操作 DB）
   - **說明**: 寫入一筆交易紀錄並增加 400 Pts 到 `maggieliu@yoshin-design.com` 的 `lifetime_points` 餘額中（200 Pts 購買 + 200 Pts 補償），訂單號可標記為 `COMPENSATE_pay_0Niy9PtFIXXMbHFpJEWIa`。

3. **[x] 執行全站對帳腳本 (尋找其他受害者)**
   - **影響檔案**: `loamlab_backend/scripts/audit_missing_topups.mjs` (已新建)
   - **說明**: 建立一個臨時腳本，透過 Vercel 的 `DODO_API_KEY` 拉取 Dodo Payments 最近的 `payment.succeeded` 紀錄，比對資料庫 `transactions` 表，找出所有「扣款成功但未入帳」的訂單。若發現其他受害者，請同樣進行修復並給予雙倍補償。執行完畢後輸出受害者清單。
   - **結果**: 找到 3 位新受害者，其中 2 位（liuyuyun8610@gmail.com、ann.kolaw@gmail.com）已修復+雙倍補償(各 +400 pts)；第 3 位 jodichen0602@gmail.com 因 order_id 疑似先前有人手動打字誤植（`I`/`l` 一碼之差、其餘 24 碼完全相同），研判可能已補發過，暫不處理，待人工複核確認是否為同一筆付款。

## PENDING_HUMAN_REVIEW
- jodichen0602@gmail.com：Dodo payment_id `pay_0NhnImWvYJ5WlmjaLBcCH` vs DB 既有紀錄 `DODO_pay_0NhnImWvYJ5WImjaLBcCH`，只差第17碼 I/l。需人工確認是否為同一筆付款（若是，此用戶已補發過不需再處理；若確認是兩筆不同付款，需比照其他受害者補發+雙倍補償 400 pts）。

status: DONE
