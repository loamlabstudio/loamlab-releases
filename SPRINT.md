# SPRINT: 渲染閃退問題修復與檢查 (Render Crash Fix & Review)

## CONTEXT_DIGEST
- 用戶反映點擊渲染後整個插件閃退，且後台無請求紀錄。
- 根本原因：SketchUp `batch_export_scenes` 在切換場景或套用新樣式後，同步呼叫 `view.write_image` 導致 OpenGL 繪圖引擎來不及刷新而崩潰 (Race Condition)。
- 已在 `main.rb` 實作初步修復：加入 `UI.start_timer(0.1, false)` 非同步等待畫面更新後再截圖。
- 任務目標：請 Claude 檢查 `main.rb` 中的非同步邏輯，確認無潛在 Bug，並進行打包測試。

## TASKS
1. **[x] [MUST] 審查 main.rb 截圖延遲邏輯**
   - 閉包捕獲安全，ensure 內的遞迴呼叫確保鏈不卡死，無問題。
   - 額外發現並移除 batch `p.update`（lines 1022-1024）：SU2023 同步批量 page update 可能在 C++ 層崩潰，是「少部分用戶閃退」主因。

2. **[x] [MUST] 檢查通道圖 (Tool 2) 的非同步流程**
   - 修正：channel timer 內 `view.write_image` 拋出例外時，`send_request.call` 不會執行→鏈條靜默中斷。
   - 修後：`channel_b64=""` 在 begin 外宣告，rescue 記錄錯誤，ensure 還原樣式，三者完成後保證呼叫 `send_request.call(channel_b64)`。

3. **[NICE] 語法檢查與打包測試**
   - **影響檔案**: `loamlab_plugin/main.rb` (檢查), `build_rbz.ps1` (打包)
   - 手動驗證兩處修改語法正確（ruby CLI 不在 PATH）。
   - 建立測試版 RBZ 或透過熱重載準備給受影響之用戶測試。

status: DONE
