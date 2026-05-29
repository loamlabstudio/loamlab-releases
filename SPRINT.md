# SPRINT.md

## CONTEXT_DIGEST
本階段任務的核心目的是**確保因 Dodo Payments API 缺陷（忽略查詢參數）導致的越權問題得到徹底的防護與災後復原**，同時修復 Vercel Serverless 環境下的異步執行漏洞。
目前 Antigravity 已完成：
1. 修復 `api/user.js` 的 `GET /subscriptions` 漏洞，加入嚴格的 `email` 防線。
2. 扣除 8 位免費免費用戶被異常賦予的訂閱權益與點數。
3. 發現 `lib/activate.js` 寫入 `dodo_subscription_id` 時缺少 `await`，導致真實買家取得點數但 ID 為 `null`，進而引發後續的錯亂，已修正此程式碼。

## TASKS

- [x] **審查 Dodo API 防禦機制與異步漏洞**
  - 已部署：email 所有權防線、feedback.insert await 修復、activate.js 23505 競爭條件處理
- [x] **還原真實買家的遺失 ID**
  - 4 位買家 sub_id 已透過 restore_subscription_ids.mjs 補回
- [x] **清除幽靈會員（13 個）**
  - 歷史 4 個 + 當日 8 個 + testsprite_dodo2 = 13 個帳號清除
- [x] **新增 cron 防護（stats.js）**
  - payment_sweep（DB付款証明，dodo_subscription_id IS NULL 安全過濾）
  - dodo_reconcile（Dodo API sub_id 比對，繞過 email 過濾 bug）
- [x] **修復 renewal 用戶無法自動修復**
  - auto-repair 條件從 !last_topup_at 改為 daysSinceLast > 29，覆蓋月訂閱 webhook 失敗後 renewal 場景

status: DONE
