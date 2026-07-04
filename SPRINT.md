# SPRINT

## CONTEXT_DIGEST
- 目標：開發「行銷貼文自動生成」小工具，消除用戶將渲染參數手動轉譯為中英雙語貼文的繁瑣步驟。
- 現況：渲染參數存在於前端 `t1NodesData` 與對應的隱藏輸入框中，且 `optionsData` 已包含部分選項的中英雙語對照標籤。
- 方案：基於第一性原理，最少步驟的作法是直接從當前選取狀態讀取參數，透過映射字典自動組裝成雙語模板（含 Hashtag）。依據用戶要求，此功能**僅限開發者 (DEV) 使用**，將與現有 `share-modal` 結合（或放置於 DEV 專屬區塊），實現一鍵生成。

## TASKS

1. **[MUST][DONE] 實作核心：雙語貼文生成邏輯**
   - **影響檔案**：`loamlab_plugin/ui/app.js`
   - **實作**：`generateBilingualPostText()`，遍歷 `t1NodesData` 的 `meta/scene_lighting/materials/photography` 四組節點（跳過 `rendering` 精度組，對文案無意義），讀取各節點目前選取值（`#t1-node-{id}` hidden input），透過 `optionsData` 對應出 zh-TW / en-US 標籤，組成中文段落 + 英文段落 + 自動去重 Hashtags。

2. **[MUST][DONE] 介面整合：DEV 限定的一鍵生成按鈕與預覽**
   - **影響檔案**：`loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js`
   - **實作**：於 `share-customize-body` 內 `#share-input-content` 下方新增 `#btn-auto-generate-post`，沿用既有 `.dev-only-tool` class（已綁定 DEV/USER 視角切換，不需另外偵測 debug 參數）。點擊呼叫 `window.handleAutoGeneratePost()`，寫入 `#share-input-content` 並 dispatch `input` 事件，觸發既有監聽器同步刷新 `#share-text-content` 完整貼文預覽。

3. **[NICE][DONE] 翻譯補齊與體驗優化**
   - **影響檔案**：`loamlab_plugin/ui/locales/*.json`（6 語言）, `i18n.js`（經 `sync_i18n.js` 重新編譯）
   - **實作**：新增 `share_btn_auto_generate` / `share_btn_auto_generate_done` / `toast_no_render_params` 三組 key，6 語言皆補齊翻譯（非僅 zh-TW）。點擊生成後按鈕文字短暫變為「✓ 已生成」，1.5 秒後還原。

status: DONE
