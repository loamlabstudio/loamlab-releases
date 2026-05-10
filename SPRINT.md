# Implementation Plan

## CONTEXT_DIGEST
- **Issue 1**: 工具 4 批量出圖時 SketchUp 畫面與介面會白屏凍結，直到出圖結束才恢復。原因為 Ruby 在主執行緒使用同步的 `each` 迴圈連續拍攝高解析度切片，導致 UI 無法重繪。
- **Issue 2**: 工具 4 介面仍殘留「上傳 IG」與「進階渲染設定」區塊，干擾極簡體驗。
- **Issue 3**: 工具 4「雲端連結」上傳報錯 `FUNCTION_PAYLOAD_TOO_LARGE`。原因是將 6 張高畫質 Base64 塞入同一個 JSON 傳送至 Edge Function，超過了 2MB/4MB 的 Payload 上限。
- **Issue 4 (New)**: T4 目前的 360 出圖畫面太過灰暗，缺乏 Admin 後台的統一管控機制。

## TASKS

### Phase 6: 工具 4 性能與邊界錯誤修復
- **影響檔案**: `loamlab_plugin/main.rb`, `loamlab_plugin/ui/app.js`
- **優先級**: [MUST]
- **任務描述**:
  1. **修復出圖白屏凍結 (非同步拍攝)**: 在 `main.rb` 的 `export_360_local` 與 `export_360_cloud` 中，將原本同步的場景與視角切換迴圈 (`scenes.each`, `face_configs.each`)，改寫為基於 `UI.start_timer(0.05, false)` 的遞迴列隊 (Queue) 處理模式。這樣能讓 SketchUp 引擎在每張截圖之間喘息並重繪畫面，徹底解決白屏與凍結問題。
  2. **隱藏多餘 UI 區塊**: 在 `app.js` 的 `_switchTool(toolId)` 中，針對 Tool 4 確保隱藏「上傳 IG / 社群」區塊以及「進階渲染設定」的 `<details>` 區塊，維持畫面極簡。
  3. **繞過 Payload 限制 (直接上傳 Storage)**: 
     - 改變「雲端連結」的上傳策略：不要再將 Base64 塞入 JSON 打給 Edge Function (`process-tool-action`)。
     - 改由 `main.rb` 在擷取單張圖片後，**直接使用 `Net::HTTP::Put` (或 Post) 將檔案二進制 (Binary) 上傳至 Supabase Storage 的 Bucket** (`/storage/v1/object/panoramas/{folder}/{file}`)。
     - 當該場景的所有切片圖與 `index.html` 都分別上傳完成後，最後再打一個非常輕量的 JSON (只包含已上傳的路徑或 ID) 給 Edge Function 進行「扣除 5 點」與「寫入資料庫記錄」的動作。這樣就能完美避開 Function 的 Payload 限制。

### Phase 7: 新增 T4 出圖樣式 Admin 統一管控功能
- **影響檔案**: `loamlab_backend/public/admin.html`, `loamlab_plugin/ui/app.js`, `loamlab_plugin/main.rb`
- **優先級**: [MUST]
- **任務描述**:
  1. **優化後台 Admin 介面**: 修改 `admin.html` 中的「T4 360 專屬樣式設定」。
     - **移除**「天空 / 地面」(DrawHorizon, DrawGround, DrawSky) 等不必要的設定。
     - 僅保留陰影相關設定（Light, Dark, UseSunForAllShading, DisplayShadows）。
  2. **前端接收設定並傳遞**: 在 `app.js` 啟動時取得 API 回傳的 `_t4_force_style`。觸發 Tool 4 匯出時，將這組設定傳給 Ruby。
  3. **Ruby 端實作「附加覆蓋 (Patch Override)」**: 在 `main.rb` 的 `export_cubemap_360` 中，**絕對不要全部重置或覆蓋**使用者的樣式。
     - 取得目前的 `shadow_info` 與 `rendering_options`。
     - **只針對**前端傳入的 `t4_force_style` 字典裡的 Key 進行修改（例如只改 Light 和 Dark）。
     - 其餘所有沒有在字典裡的屬性（如天空、邊線等），全部**保持使用者當前畫面的原樣**。截圖完成後，再將修改過的那幾個屬性還原。這樣就能完美實現「把我們的樣式附加在用戶現用的樣式上面」。

status: DONE
