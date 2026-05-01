# SPRINT: KOL 循環分潤系統與即時面板

## CONTEXT_DIGEST
目標：基於現有 Supabase + Dodopayments 架構，實作輕量化的 KOL 階梯式分潤系統，無需依賴 Make.com。
核心邏輯：首單永久綁定（Discount Code 優先於 Cookie），每次 Webhook 成功付款時即時計算 KOL 當前階梯（1-50人5%、51-100人10%、>100人15%），並寫入 `kol_ledger`（快照機制），支援 T+15 結算防刷。

## TASKS

### TASK 1: Supabase 資料庫 Schema 擴充 [MUST] ✅
**描述**：建立分潤帳本資料表，用於記錄每筆訂單的抽成快照。階梯等級將由系統動態計算（依據 `users.referred_by` 關聯的付費人數），無須額外維護 tracker 表以求最簡架構。
**需新增資料表/欄位**：
- 新增表 `kol_ledger`：
  - `id` (UUID, PK)
  - `kol_code` (TEXT) - 對應推廣者的 referral_code
  - `buyer_email` (TEXT) - 購買者 email
  - `transaction_id` (TEXT) - 對應金流單號
  - `amount_paid` (INTEGER) - 實付金額
  - `commission_rate` (NUMERIC) - 快照比例 (0.05, 0.10, 0.15)
  - `commission_amount` (INTEGER) - 應付分潤金
  - `status` (TEXT) - 狀態預設 'pending' (進入T+15冷卻期)
  - `created_at` (TIMESTAMPTZ)
**影響檔案**：
- `loamlab_backend/supabase_setup.sql`

### TASK 2: 歸因綁定與折扣碼優先邏輯 [MUST] ✅
**依賴**：完成 TASK 1
**描述**：實作歸因邏輯。前端記錄 30 天 Cookie/LocalStorage 的 referral_code。在發起付款 (Checkout) 時，若使用者輸入了專屬折扣碼，則該折扣碼優先級高於 Cookie。第一筆訂單成立時，將該代碼寫入購買者的 `users.referred_by` 完成永久綁定。
**影響檔案**：
- `loamlab_plugin/ui/app.js` 或相關結帳前端程式
- `loamlab_backend/api/dodopayments/checkout.js` (或相應結帳 API)

### TASK 3: 金流 Webhook 分潤快照與防刷機制 [MUST] ✅
**依賴**：完成 TASK 2
**描述**：修改 Dodopayments Webhook 處理續費與新付款。當收到付款成功通知時：
1. 查詢購買者的 `referred_by`。
2. 若有 KOL，查詢該 KOL 當下的總邀請付費人數，判定 Tier (1-50: 5%, 51-100: 10%, >100: 15%)。
3. 建立分潤快照，寫入 `kol_ledger` (狀態: pending)。
此機制天然支援終身循環（只要續費就觸發）且不會回溯修改舊帳本。
**影響檔案**：
- `loamlab_backend/api/dodopayments/webhook.js` (或現有 Webhook 處理檔案)

### TASK 4: KOL 即時反饋面板 (Dashboard) API [MUST] ✅
**依賴**：完成 TASK 3
**描述**：實作 KOL 後台所需的資料 API。回傳資料包含：累積邀請付費人數、目前所在 Tier、距離下一 Tier 所需人數進度條資料、待結算獎金 (pending)、可提領獎金 (cleared，超過 T+15 天的 pending 轉化)。
**影響檔案**：
- `loamlab_backend/api/kol/dashboard.js` (新建)

### TASK 5: 後台對帳匯出與結算處理腳本 [NICE] ✅
**依賴**：完成 TASK 4
**描述**：提供一個給管理員使用的 API 或簡易腳本，能篩選出 `created_at` 超過 15 天且狀態為 `pending` 的 `kol_ledger` 紀錄，將其轉為 `ready_to_pay`，並可匯出成 CSV/Excel 供人工 PayPal/匯款放款。
**影響檔案**：
- `loamlab_backend/api/admin/kol_payout.js` (新建)

status: DONE
