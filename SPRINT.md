# 升級 Dodo Payments Meters 計量器

## CONTEXT_DIGEST
目前系統已使用 Dodo Payments 處理金流與訂閱，但「點數餘額 (points/lifetime_points)」與「扣點邏輯 (deduct_render_points)」仍由 Supabase 手動維護。
為簡化 Admin 管理與解決 Webhook Race Condition 痛點，需將核心計費引擎 (Ledger) 遷移至 Dodo Meters，實現用量自動計費與預付額度託管，讓 Dodo 成為餘額的唯一真實來源 (Single Source of Truth)。

## ⚠️ 執行調整說明（Claude，2026-07-12）
執行前用 WebFetch 查證 docs.dodopayments.com，發現 SPRINT 假設的端點與實際 API 不符
（`POST /meters/events` 實際是 `POST /usage-events/ingest`；`POST /customers/{id}/credits`
根本不存在，實際要先在 Dodo 後台建 Credit Entitlement 資源才有 `POST /credit-entitlements/{id}/ledger`）。
且進一步查程式碼發現：`deduct_render_points`（算圖扣點）已經是 `FOR UPDATE` 鎖列的原子操作，
真正的 race condition 其實在 `processTopup`（webhook 發點路徑）的 read-then-write，跟 Task 2/3
假設的完全不同。跟用戶確認後，執行範圍改為**風險對稱的版本**（已完成）：

1. **[DONE] 修正真正的 race condition**：新增 `apply_points_delta` 原子 RPC（`FOR UPDATE`
   鎖列，對稱於既有的 `deduct_render_points`），改寫 `lib/activate.js` 的 `processTopup`
   主帳號加點、邀請人分潤 A、回滾補償全部改用此 RPC，徹底消除 webhook 重送/手動驗證/cron
   對賬三條路徑同時打同一 email 時互相蓋掉點數的風險。**需要人工在 Supabase SQL Editor
   執行 `supabase_setup.sql` 的 Phase 34 區塊**（新函式 + `dodo_customer_id` 欄位），程式碼才會生效。
2. **[DONE] Dodo Meters 影子回報（非權威）**：新建 `lib/dodo.js`封裝 `usage-events/ingest`
   與 `customers` 查詢；`render.js` 在扣點成功後非同步回報用量到 Dodo（僅供後台可視化，
   不影響扣款/放行邏輯，失敗不拋出）。`webhook.js`/`activate.js` 開始儲存 `dodo_customer_id`。
   **Dodo 尚未 gate 算圖、Supabase 仍是唯一權威來源**——這是刻意的，避免把熱路徑綁死在
   未驗證過的外部依賴上。
3. **[DONE] 對賬腳本整理**：`loamlab_backend/` 根目錄 6 支散落腳本（`audit_vs_dodo.mjs` 等）
   全部搬進 `scripts/`，新增共用 `scripts/_env.mjs` 消除 9+ 支腳本重複的 env-loading 樣板。
   **意外發現並修復**：`check_user.mjs`、`backfill_referral_codes.mjs` 兩支腳本原本把 Supabase
   Service Role Key 明碼寫死在原始碼裡（同一把 key）。已改成從 `.env.local` 讀取，
   **建議評估是否需要在 Supabase 後台輪替這把 key**（未進 git 歷史，但曾以明碼存在檔案系統）。
4. **[跳過] Task 1 的 Dodo Customer Balance 前端顯示、Task 4 遷移腳本**：兩者都建立在
   「Dodo 是唯一真實來源」這個前提上，本次刻意不做，等影子回報跑一段時間、確認 Dodo
   Meters 資料可信後再評估要不要往下走。

## 驗收結果
- `node --check` 全數通過（activate.js / webhook.js / render.js / dodo.js / scripts/*.mjs）
- `scripts/audit_vs_dodo.mjs`、`scripts/revoke_fake_members.mjs` 對 production DB 實跑 dry-run，
  行為與重構前一致（僅搬檔+抽共用函式，未改邏輯）
- **附帶發現（非本次任務範圍，供人工複核）**：`audit_vs_dodo.mjs` 顯示 DB 有 33 個標記為會員的
  帳號，Dodo 目前僅回報 10 個 active 訂閱，其餘 23 個需要人工核實是否為已取消/漏同步。

## 尚待人工執行
- [x] Supabase SQL Editor 執行 `supabase_setup.sql` Phase 34（`apply_points_delta` 函式 + `dodo_customer_id` 欄位）— 2026-07-12 用戶已執行，並以零增量呼叫驗證 RPC 正常運作
- [ ] 評估是否輪替 Supabase Service Role Key（曾明碼寫死在已刪除的舊腳本檔案中）
- [ ] 確認後 commit + 部署（本次未自動 commit）

status: DONE
