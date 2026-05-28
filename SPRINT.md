# SPRINT: 修復 SketchUp 插件登入卡死與 UI 破版問題

## CONTEXT_DIGEST
- 用戶回報 SketchUp 中點擊 Google 登入無跳轉，且登入畫面巨型 Logo 破版。
- 肇因為 Tailwind CDN 載入失敗（或被牆），同步加載卡死了後續 `app.js` 執行，導致按鈕失效。
- 且舊版 Chromium 於 `file://` 下呼叫 `crypto.randomUUID()` 具拋錯風險，中斷了跳轉流程。
- 前置修復已完成，此 Sprint 用於最終審閱、代碼清理與發佈準備。

## TASKS

1. **[x] 審閱 Tailwind CDN 異步載入與防破版邏輯**
   - 確認 CDN 標籤已改為 `async` 且具備 fallback (`unpkg`)。
   - 確認 Logo 已加上 Inline Style (`width: 32px; height: 32px;`) 防止無 CSS 時撐破畫面。
   - **影響檔案**：`loamlab_plugin/ui/index.html`

2. **[x] 審閱 CSS 核心備援與隱藏邏輯**
   - 確認 `.hidden` 被正確標記為 `display: none !important;` 以防被覆蓋。
   - 確認加入 `.w-8`, `.h-8`, `.opacity-0` 等關鍵備援類別。
   - **影響檔案**：`loamlab_plugin/ui/assets/style.css`

3. **[x] 審閱 OAuth UUID 降級容錯機制**
   - 檢查 `startOAuthFlow()`，確保 `window.crypto` 生成 UUID 的邏輯被 `try...catch` 妥善包覆，若失敗自動降級至 `Math.random`。
   - **影響檔案**：`loamlab_plugin/ui/app.js`

status: DONE
