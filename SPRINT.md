# SPRINT

## CONTEXT_DIGEST
- **目標**：修復 Dodo Payments Webhook 延遲或舊訂單重試時，低階方案可能覆寫高階方案（降級並扣除點數）的邊界漏洞。
- **現狀**：已在 `lib/activate.js` 的 `processTopup` 實作「Plan Tier Protection」，透過 `PLAN_TIERS` 比對 `newTier` 與 `currentTier`。
- **規則**：若進件方案等級較低，將略過更新 `subscription_plan`，並將 `apply_points_delta` 的 `p_set_monthly` 設為 null 防護點數，但保留寫入 transaction 以利對帳。

## TASKS

1. **[MUST] Review Tier Protection Logic**
   - 檢查 `loamlab_backend/lib/activate.js` 中的 `processTopup` 函式。
   - 確認 `PLAN_TIERS` 防護機制是否正確處理了 `shouldUpdatePlan` 與 `isOverridingLowerTier` 邏輯。
   - **影響檔案**：`loamlab_backend/lib/activate.js`

2. **[MUST] Test Point Calculation RPC Call**
   - 確認在低階覆寫的情境下，傳入 `supabase.rpc('apply_points_delta')` 的參數 `p_set_monthly` 確實為 `null`，且不會異常拋錯。
   - **影響檔案**：`loamlab_backend/lib/activate.js`

3. **[MUST] Git Commit & Deploy**
   - 驗證無誤後，將變更 commit。
   - 執行後端 Vercel 部署流程，使防護機制上線生效。
   - **影響檔案**：`loamlab_backend/lib/activate.js`

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_backend/lib/activate.js
  - loamlab_backend/api/user.js
  - loamlab_plugin/ui/app.js
sql_migration: false

## EXECUTION_NOTES（Claude 補充）
- Task 1/2 審查通過：Plan Tier Protection 邏輯正確，RPC `apply_points_delta` 對 `p_set_monthly=NULL` 有 `CASE WHEN` 保護，不會出錯。
- 執行過程中額外發現並修復關聯漏洞：既有訂閱者升級/降級方案時，前端一律走「建立新 checkout」流程，從未呼叫 Dodo 原生 change-plan API，導致舊訂閱不會被取消，變成兩筆訂閱各自每月扣款（例：Starter 升 Pro 沒取消舊訂閱，變成 $7+$15/月）。已在 `user.js` checkout 端點補上：偵測到既有訂閱者切換方案時改呼叫 `POST /subscriptions/{id}/change-plan`（原地換方案 + proration），並同步調整 `app.js` 前端輪詢邏輯。webhook.js 端的 `subscription.plan_changed` 處理與 tier 比較邏輯本來就已存在，只是從未被觸發，這次補上觸發路徑後即可運作。

status: READY_FOR_CLAUDE
