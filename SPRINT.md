# SPRINT PLAN: 數據版塊第一性重建與收尾 (Analytics Revamp)

## CONTEXT_DIGEST
**第一性原理要求**：業務系統(發送點數)與財務系統(法幣金流、供應商扣款)必須徹底物理隔離。
**已解決問題 (前置作業已完成)**：
1. **營收虛高與退款盲區**：我們已建立 `payments` 表。
2. **隱沒成本與失敗重試耗損**：已擴充 `gpu_jobs/render_history` 追蹤欄位，且在 `render.js` 已實作攔截 AtlasCloud 官方 `cost` 並 `× 2`（雙倍緩衝包含手續費與退款風險）。
3. **效能癱瘓 (60秒輪詢 IO 危機)**：已建 `daily_metrics` 表與 `cron_daily_metrics` 腳本，改為 T+1 結算。
**交付給 Claude 的特殊指令**：實作以下任務時，請你必須從第一性原理出發，**再次審視全域架構，若發現我們（開發者與 Antigravity）未顧慮到的潛在資料風險或決策盲點，請立即提出並修補**。

## TASKS

### TASK 1: 前端 Admin 看板斷捨離與 KPI 重建 [MUST] — [x] DONE
- **要解決的問題**: 目前前端充斥 ARPU、錯誤率等雜訊，且舊邏輯導致「未扣點數就不算活躍」，無法真實反映產品狀況。
- **任務描述**: 徹底清理 `loamlab_backend/public/admin.html` 的頂部圖表，只保留/改為這 4 個直擊心臟的指標：
  1. **營業額 (Revenue)**：讀取 `daily_metrics`。
  2. **雙倍成本估算 (Cost)**：讀取 `daily_metrics`。
  3. **淨利 (Profit)**：Revenue - Cost。
  4. **昨日活人 (DAU)**：讀取 `daily_metrics` (基於 `users.last_active_at`)。
  請隱藏所有不精準的漏斗分析與次要區塊。
- **影響檔案**: `loamlab_backend/public/admin.html`

### TASK 2: 金流 Webhook 獨立寫入 `payments` 表 [MUST] — [x] DONE
- **要解決的問題**: 目前的 Webhook 只負責給用戶發點數，導致財務報表與真實進帳脫鉤，退刷也無從查考。
- **任務描述**: 攔截成功付款與退款事件，除原有的加點邏輯外，必須將真實付款資訊單獨寫入 `payments` 表。
- **欄位需求**: `id` (UUID), `user_email` (TEXT), `order_id` (TEXT UNIQUE), `amount_usd_cents` (INTEGER), `status` (TEXT: 'paid'|'refunded'|'chargeback'), `payment_method` (TEXT), `created_at`。
- **影響檔案**: `loamlab_backend/api/webhook.js`

### TASK 3: 前端 API 對接與歷史遷移腳本收尾 [NICE] — [x] DONE
- **要解決的問題**: 前端修改後需要對應的 API 配合；舊資料需要平滑過渡。
- **任務描述**: 審視 `stats.js` 確保 `dashboard` API 返回的 JSON 結構能完美對齊 TASK 1 的需求。若有需要，幫忙執行/驗證 `migrate.js` 確保歷史金流過渡至 `payments`。
- **影響檔案**: `loamlab_backend/api/stats.js`, `admin.html`
- **依賴**: MUST 任務之後執行。
- **調整**：`migrate.js` 專案裡不存在，視為無需執行（舊 topup 交易本來就是點數流水，不是真實金流，沒有可遷移的歷史 `payments` 資料）。

### TASK 4: Vercel Cron 排程設定 [NICE] — [x] DONE
- **要解決的問題**: 讓 `daily_metrics` 自動運作，確保前端永遠秒開。
- **任務描述**: 設定每日自動呼叫 `cron_daily_metrics`。
- **影響檔案**: `loamlab_backend/vercel.json`
- **調整**：Vercel Hobby plan cron 已有 2 條排程（上限），未新增第 3 條 vercel.json cron，改為讓 `cron_daily_metrics()` 搭便車跑在既有的 `scan_render_anomalies`（每日 01:30 UTC）尾端執行，避免部署失敗風險。

## 執行摘要（Claude，2026-08-28）
- 額外修補兩個會讓本 Sprint 心血直接歸零的資料斷點：`users.last_active_at` 建了但沒人寫入（DAU 永遠 0）→ 補到 `lib/verifyIdentity.js` 的唯一身份解析入口；`render.js` 算出雙倍成本但沒存進 `render_history.provider_cost_usd_cents`（Cost KPI 永遠 0）→ 兩個出圖路徑都補上寫入。
- 部署前實測發現 `supabase_setup.sql` Phase 37 只有 3 張新表被執行過，`last_active_at`/`provider_cost_usd_cents` 兩個欄位尚未跑到正式 DB——已請用戶手動執行後才 commit，避免 `render_history` insert 整筆失敗。

status: DONE
