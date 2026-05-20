# CONTEXT_DIGEST
T4 (SmartCanvas) 工具的統計數據未能在管理後台正常顯示。
經查明，`render.js` 中的 T4 (360全景) 請求扣點後未向 `transactions` 及 `render_history` 寫入紀錄。
另外 `stats.js` 過濾條件僅包含 `['RENDER_1K', 'RENDER_2K', 'RENDER_4K']`，遺漏了 T4。
目標是將 T4 加入交易紀錄（`transaction_type: 'RENDER_360'`）並讓後台統計能識別並顯示 T4 工具。

# TASKS

## TASK 1: 寫入 T4 交易與渲染紀錄 [MUST]
- **影響檔案**: `loamlab_backend/api/render.js`
- **描述**: 在 `init_360_upload`、`init_360_single_upload`、`upload_360` 及 `finalize_360_upload` 的點數扣除成功區塊中，新增邏輯將交易寫入 `transactions` 表 (使用 `transaction_type: 'RENDER_360'`, `metadata: { resolution: '360', tool_id: 4 }`)。同時寫入對應的 `render_history` 紀錄以保留歷史數據。

## TASK 2: 更新後台統計過濾條件 [MUST]
- **影響檔案**: `loamlab_backend/api/stats.js`
- **描述**: 在所有查詢 `transactions` 的陣列過濾條件中（如計算儀表板活躍度與工具占比處），將 `['RENDER_1K','RENDER_2K','RENDER_4K']` 替換並擴充為 `['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360']`。依賴於 TASK 1 已完成。

## TASK 3: 測試與驗證 [NICE]
- **影響檔案**: 無
- **描述**: 驗證新增的 T4 全景圖上傳流程是否正常扣點與寫入 DB，並透過呼叫 `/api/stats` API 確保 T4 的 `tool_id: 4` 會正確顯示在 `tool_breakdown` 結果中。

## TASK 4: 統計 T4 本地功能 (單機匯出) [MUST]
- **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_backend/api/render.js`
- **描述**: 在 `app.js` 中的 `handle360LocalExport` 增加對後端 API 的非同步請求 (`action: 'track_360_local'`)。並在 `render.js` 實作該端點，寫入 `amount: 0` 且 `transaction_type: 'RENDER_360'` 的交易紀錄，確保單機功能也有被統計。

status: DONE
