# Sprint Plan: 訂閱方案同步與點數紀錄修復

## CONTEXT_DIGEST
- **問題現象**：用戶 `alen3388@gmail.com` 先訂閱 Studio (9000點)，隨即降級訂閱 Pro (2000點)。UI 歷史紀錄顯示 +9000, +2000, +2000，但實際帳號點數未增加 (因防護機制阻擋)，且 DB 方案卡在 `studio`，而 Dodo 真實訂閱為 `PRO` (`sub_0Nlvw2vX1wqeq92Mh4jlz`)。
- **根本原因 1**：`processTopup` 為了冪等性，在發點前就將預期點數寫入 `transactions` 表，若後續因方案降級防護 (`isOverridingLowerTier`) 未實際發放點數，交易紀錄與餘額便產生脫鉤。
- **根本原因 2**：降級防護 (`shouldUpdatePlan = false`) 阻止了低階方案寫入 DB，但又將 `dodo_subscription_id` 更新為新的低階訂閱並取消了高階訂閱，導致 DB 與金流狀態不一致。
- **真實狀態**：用戶最新真實付費且存活的訂閱是 `PRO` 方案 (`sub_0Nlvw2vX1wqeq92Mh4jlz`)。

## TASKS

### 1. [x] 修復降級訂閱狀態不一致問題 [MUST]
- **說明**：在 `processTopup` 中，若發現是一筆「新的」訂閱付款（與目前 DB 中的 `dodo_subscription_id` 不同），且我們會取消舊訂閱，則不應套用「忽略低階方案更新」的防護。因為舊高階訂閱已作廢，必須讓新訂閱的方案 (如 Pro) 生效，否則會造成 DB 是 Studio 但真實訂閱是 Pro 的狀態錯亂。
- **影響檔案**：`loamlab_backend/lib/activate.js`

### 2. [x] 修復交易紀錄與實際點數脫鉤問題 [MUST]
- **說明**：`transactions` 的 `amount` 在一開始寫入時為 `pointsToAdd`，但在 `isOverridingLowerTier` 發生時（點數未實際發放），必須更新該筆 `transactions` 的 `amount` 為 0，或插入一筆補償紀錄，確保前端歷史明細與真實加點數量一致。
- **影響檔案**：`loamlab_backend/lib/activate.js`

### 3. [x] 修復金額驗證的幣別錯位漏洞 [NICE]
- **說明**：`amountPaidCents` 可能為在地貨幣（如台幣），而從 `fetchDodoSubscriptionInfo` 取回的 `expectedAmountCents` 通常為美元美分。兩者直接比較會讓非美金的支付繞過洗點防禦。需改用結算幣別 (settlement_amount) 進行同幣別比對，或在 webhook 中精準比對。
- **影響檔案**：`loamlab_backend/lib/activate.js`, `loamlab_backend/api/webhook.js`
- **⚠️ 執行時調整（已用 Dodo 官方 API 文件查證）**：原本假設方向是反的。`recurring_pre_tax_amount`（expectedAmountCents 來源）實際上跟 `total_amount` 同屬「結帳當下幣別」，`settlement_amount` 才是「商戶結算幣別」（adaptive pricing 下可能跟前者不同幣別）。改用 settlement_amount 比對反而會製造幣別不一致漏洞。實際修法：`amountPaidCents` 只用 `total_amount`，缺失就視為拿不到（交由既有「兩者缺一跳過驗證」邏輯處理），不再退回 settlement_amount 硬湊。

### 4. [x] 撰寫資料修復腳本 (Fix Script) [MUST]
- **說明**：寫一支腳本對 `alen3388@gmail.com` 進行狀態修復：將其 `subscription_plan` 修正為 `pro`，並根據其實際花費與未獲得的點數給予補償或修正 `transactions` 顯示。
- **影響檔案**：`loamlab_backend/scripts/fix_alen3388_subscription.mjs` (新建)
- **執行結果**（已用戶確認後套用於正式庫）：`subscription_plan: studio→pro`、`points: 8415→2000`（比照 Task 1 修好後 use-it-or-lose-it 應有結果）、2 筆未實際發點的交易 `amount` 訂正為 0。已重新查詢驗證生效。

status: DONE
