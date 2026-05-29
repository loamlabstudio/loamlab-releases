# Sprint Plan: Fix Render Deduction via Strict Fetch Timeout & RPC Refund

## CONTEXT_DIGEST
用戶回報 SpaceReform 渲染失敗且遭吞點。經深入邊界測試與防禦性分析，確認根本原因並非輪詢耗盡，而是 Node.js 原生 `fetch` 缺乏超時機制。當 AtlasCloud 壅塞時，`fetch` 永遠卡死，導致 300s 後被 Vercel 強制中止，無法進入 `catch` 區塊退款。且現有 `update` 退款寫法存在 Race Condition 隱患。現採用極簡但嚴密的保命機制進行修復。

## TASKS
- [x] **防禦 Fetch 卡死 (加入 AbortSignal)**
  **影響檔案**: `loamlab_backend/api/render.js`
  在所有向 AtlasCloud 發送的 `fetch` 請求（包含 `generateImage` 和 `pollUrl`）中，加入 `signal: AbortSignal.timeout(280000)`。確保在 Vercel 的 300s 強殺極限前，主動拋出超時錯誤並進入 `catch` 區塊。
- [x] **放寬安全輪詢次數**
  **影響檔案**: `loamlab_backend/api/render.js`
  既然已具備 280s 的全局安全網，將原本的輪詢次數從 `40` (約 120s) 提高至 `80` (約 240s)，讓複雜的 4K 渲染有足夠時間完成，降低不必要的失敗率。
- [x] **重構退款邏輯 (修復 Race Condition)**
  **影響檔案**: `loamlab_backend/api/render.js`
  已在 commit 4396dd8 完成，兩個退款路徑均使用 `supabase.rpc('deduct_render_points', ...)`。

status: DONE
