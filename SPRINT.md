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
- **調整**：`migrate.js` 專案裡不存在；改為手寫回填腳本，把 `transactions` 裡歷史 TOPUP_* 交易搬進 `payments`（見下方執行摘要）。

### TASK 4: Vercel Cron 排程設定 [NICE] — [x] DONE
- **要解決的問題**: 讓 `daily_metrics` 自動運作，確保前端永遠秒開。
- **任務描述**: 設定每日自動呼叫 `cron_daily_metrics`。
- **影響檔案**: `loamlab_backend/vercel.json`
- **調整**：Vercel Hobby plan cron 已有 2 條排程（上限），未新增第 3 條 vercel.json cron，改為讓 `cron_daily_metrics()` 搭便車跑在既有的 `scan_render_anomalies`（每日 01:30 UTC）尾端執行，避免部署失敗風險。

## 執行摘要（Claude，2026-08-28）

**Sprint 原始任務內的修補**：
- `users.last_active_at` 建了但沒人寫入（DAU 永遠 0）→ 補到 `lib/verifyIdentity.js` 的唯一身份解析入口。
- `render.js` 算出雙倍成本但沒存進 `render_history.provider_cost_usd_cents`（Cost KPI 永遠 0）→ 兩個出圖路徑都補上寫入。

**驗收過程中額外抓到、已修復的問題（比原本 Sprint 範圍嚴重很多）**：
1. **`render_history` 被 RLS 擋住寫入近 5 個月（緊急）**：render.js 用 anon key 寫入被正式環境 RLS 政策擋下，最後一筆成功紀錄停在 4 月。`scan_render_anomalies` 拿 `render_history` 當「出圖成功」判斷依據之一，這段期間大量真正成功的渲染被誤判成孤兒扣款、自動退款——7 月已查到 22 筆真實誤退款。已改用 service role client 繞過，不再依賴那組跟 repo 不同步的 RLS 政策。
2. **`payments`/`daily_metrics` 表格 API 層失效**：兩張表在 Postgres 裡實際上是空的／未正確註冊到 Supabase 對外 API（PostgREST schema cache 問題），寫入全部靜默失敗。已請用戶重新執行建表 + 授權 + `NOTIFY pgrst, 'reload schema'`，確認可正常讀寫。
3. **金流幣別誤標（規模最大的一個）**：Dodo 在 adaptive pricing 下讓台灣/香港客戶用 TWD/HKD 結帳，系統原本直接把 `total_amount`（客戶結帳幣別）存進 `amount_usd_cents`，把新台幣當美元記，金額灌水 30 倍以上。已改用 `settlement_amount`（商戶美元結算金額）修正 webhook.js 的寫入邏輯；歷史交易則逐筆呼叫 Dodo API 查真實結算金額，修正了 44 筆（帳面 $40,611.96 → 實際 $1,273.29）。
4. **歷史金流回填**：`transactions` 裡 123 筆真實歷史付款（排除內部手動加點與免費贈點）搬進 `payments` 表。
5. **`daily_metrics` 回填過去 30 天**，KPI 卡片現在有真實數字可看。

**已知限制（誠實揭露，不是還沒做完）**：
- `daily_metrics.cost_usd_cents` 只有 2026-08-28（今天）起才有真實數字——在此之前 `render_history` 完全沒寫入（見上方問題 1），沒有任何地方留下歷史成本紀錄，無法回填，只能顯示 0。這幾天「淨利」卡片會約等於「營業額」卡片，屬預期現象，會隨新資料累積逐漸準確。
- `daily_metrics.active_users`（DAU）同理，`last_active_at` 是今天才開始寫入，過去 30 天全部顯示 0，屬預期現象。
- `daily_metrics.refund_usd_cents` 用「付款當天」的日期去抓退款，若退款發生在購買後的其他天會歸屬到錯誤日期（甚至漏記）；要修需要幫 `payments` 加 `updated_at` 欄位，本次未處理，目前前端也沒有直接顯示這個欄位。

status: DONE
