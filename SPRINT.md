# 核心分析 (Context Digest)
Supabase 專案的 Disk IO 預算耗盡，主要是因為後端 API (`stats.js`) 中存在大量高頻的 `transactions` 與 `feedback` 表查詢。這些查詢頻繁過濾 `transaction_type`、`created_at`、`user_email`，但資料庫中**缺少對應的索引 (Indexes)**，導致嚴重的全表掃描 (Full Table Scans)。特別是 `getPublicStats` 中的 `count: 'exact'` 結合 `ilike` 過濾，進一步加劇了 IO 負載。我們將透過新增索引與優化查詢模式來以「零成本」解決此問題。

## TASKS
- [x] TASK 1: **[MUST] 建立缺失的核心索引**
  - **影響檔案**: `loamlab_backend/supabase_setup.sql`
  - **細節**: 在 `supabase_setup.sql` 中加入以下索引的建立語法：
    - `transactions(transaction_type)` (加速種類過濾)
    - `transactions(created_at DESC)` (加速時間範圍如 `gte` 的查詢)
    - `transactions(user_email)` (加速使用者關聯查詢)
    - `feedback(type)` 與 `feedback(created_at DESC)`
  - **預期效果**: 將全表掃描轉化為索引掃描，巨幅降低 Disk IO。

- [x] TASK 2: **[MUST] 優化 `stats.js` 中的高頻統計查詢**
  - **影響檔案**: `loamlab_backend/api/stats.js`
  - **細節**: `getPublicStats` 頻繁執行 4 次 `count: 'exact'` 且夾帶 `ilike` (`noTest` / `noTestRef`)。由於這些只是公開統計數據，可以考慮簡化過濾條件（例如僅過濾 `transaction_type` 而不執行昂貴的字串 `ilike` 比對測試帳號），或者延長 Vercel Edge Cache 的時間 (從 60s 延長至 600s)，以大幅降低向 Supabase 發起請求的頻率。

- [x] TASK 3: **[NICE] 增加 `transactions` 複合索引**
  - **影響檔案**: `loamlab_backend/supabase_setup.sql`
  - **細節**: 若查詢經常同時使用 `transaction_type` 與 `created_at` (例如 `dashboard` 或 `insights`)，可建立複合索引 `CREATE INDEX idx_transactions_type_created ON transactions (transaction_type, created_at DESC)` 進一步減少 IO。

status: DONE
