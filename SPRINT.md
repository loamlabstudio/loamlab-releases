# CONTEXT_DIGEST
經過深度分析，`lifetime_points` (永久點數) 暴增的根本原因在於 `lib/activate.js` 中的 `processTopup` 發放邏輯錯誤：目前無論是「訂閱」還是「單次購買」，系統都會將點數加進 `lifetime_points`。更嚴重的是，訂閱不僅會覆寫 `points` (月費額度)，還同時累加到 `lifetime_points`；單次購買也同時加到這兩個欄位。這導致用戶獲得雙倍點數，且訂閱用戶每個月都會累積大量不會過期的永久點數。此外，退款 (`clawbackPoints`) 目前只扣 `points`，未扣 `lifetime_points`，成為白嫖漏洞。

# IMPLEMENTATION_PLAN
1. **修復點數發放邏輯 (`lib/activate.js`)**：
   區分 `isSubscription`。若是訂閱，只覆寫 `points`，不動 `lifetime_points`（除了 referral bonus）；若是單次購買，只累加 `lifetime_points`，不動 `points`。
2. **修復退款防護網 (`api/webhook.js`)**：
   升級 `clawbackPoints`，退款時應如同 `deduct_render_points` 般，優先扣除 `points`，若不足則繼續扣除 `lifetime_points`，確保惡意退款者無法保留永久點數。
3. **優化數據統計 (`api/stats.js`)**：
   過去誤將 `lifetime_points` 作為「歷史總獲取點數」來衡量高價值用戶 (Whale)，但它是會被消耗的餘額。應改用計算歷史購買總量或關聯 `transactions` 來判定。
4. **數據修復腳本 (Migration Script)**：
   撰寫獨立腳本，掃描所有用戶的 `transactions`，根據正確發放邏輯重新計算並修正目前溢發的 `lifetime_points`。

# TASKS
- [x] TASK 1: 修正點數發放與防雙重發放漏洞
  - **影響檔案**: `loamlab_backend/lib/activate.js`
  - 描述: 修改 `updatePayload` 計算邏輯。訂閱時 `points = pointsToAdd` 且 `lifetime_points` 不增加 `pointsToAdd`；單次購買時 `points` 保持不變，`lifetime_points += pointsToAdd`。

- [x] TASK 2: 修正退款機制 (Clawback) 的扣點邏輯
  - **影響檔案**: `loamlab_backend/api/webhook.js`
  - 描述: 修改 `clawbackPoints`，計算扣除時需同時從 `points` 與 `lifetime_points` 扣除。可以模擬 RPC 的雙層扣款邏輯，確保永久點數也能被正確追回並防堵漏洞。

- [x] TASK 3: 修正後台統計判定邏輯
  - **影響檔案**: `loamlab_backend/api/stats.js`
  - 描述: 修改判斷「高價值用戶 (Whale)」及 KOL 的邏輯，移除直接使用 `lifetime_points > 500` 的判斷，改用 `created_at` 排序或更合理的歷史統計邏輯，避免誤判。
  - 實際調整：改用 `transactions` 表歷史累計購買點數（TOPUP_SINGLE + TOPUP_SUBSCRIPTION 加總）取代會隨消費遞減的 `lifetime_points`，範圍限定 `getTier`/`highValue`/`kolList` 三處判斷，未動列表排序。

- [x] TASK 4: 撰寫點數校正腳本
  - **影響檔案**: `loamlab_backend/scripts/fix_lifetime_points.mjs` (新建)
  - 描述: 寫一個 Node.js 腳本，從 `transactions` 表統計每位用戶歷史應得的永久點數 (TOPUP_SINGLE + 推薦獎勵等)，若當前 `lifetime_points` 異常大於此合理值，則安全下修，以恢復點數經濟平衡。
  - 執行結果：dry-run 確認 405 位用戶中 35 人異常，`--apply` 已於正式 Supabase 執行修正，合計下修 11,953 點，修正後複查異常數為 0。

status: DONE
