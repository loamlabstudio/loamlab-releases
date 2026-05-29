# Sprint Plan: Fix Render Deduction & Refund Race Condition

## CONTEXT_DIGEST
用戶回報 SpaceReform 渲染失敗但仍遭扣點（共計 6 次，90 點）。經查 `render_history` 無紀錄，確認為 Vercel 執行緒 Timeout 遭強制中止，未進入 `catch` 區塊退款。且現有 `catch` 區塊退款邏輯使用 `update({ points: user.points })` 會造成 Race Condition 覆蓋。已透過 DB 腳本手動補償 90 點至該帳戶。

## TASKS
- [MUST] **重構退款邏輯 (修復 Race Condition)**
  **影響檔案**: `loamlab_backend/api/render.js`
  將 `_handleRender` 以及所有異常捕捉（catch）區塊內的 `update({ points: user.points })` 退款寫法，全面替換為原子操作 `supabase.rpc('deduct_render_points', { p_email: userEmail, p_cost: -cost })`，避免覆蓋算圖期間的點數變更。
- [MUST] **優化 AtlasCloud Polling Timeout 處理**
  **影響檔案**: `loamlab_backend/api/render.js`
  在 Polling 迴圈中加入嚴格的總時間與超時控制（例如限制在 Vercel 函數 timeout 前 10 秒結束），若超時則主動 `throw new Error('timeout')`，以確保進程能順利進入 `catch` 區塊執行退款，避免被 Vercel 直接 SIGKILL 而吞掉點數。

status: DONE
