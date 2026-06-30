# SPRINT: T1 批量渲染參考圖請求組裝邏輯優化

## CONTEXT_DIGEST
- 目標：解決 T1 批量渲染中，使用參考圖時第一張圖生成較快、後續圖片參考到 SketchUp 光感的問題。
- 原因：當前邏輯在有參考圖時，仍將後續場景（Scene 1..N）放入 `@@deferred_sends` 佇列，直到全部場景截圖完成後才並行發送，導致時間不同步與潛在狀態覆蓋。
- 方案：調整 `main.rb` 內的發送條件，當使用者提供明確的參考圖（`user_style_ref_url`）時，無需依賴 Anti-Collage 流程，所有場景在截圖當下直接發送至後端。

## TASKS
1. **[MUST] 調整請求分發條件（直接發送模式）**
   - **影響檔案**：`loamlab_plugin/main.rb`
   - 描述：在 `batch_export_scenes` 方法內（約 1883 行），修改發送判斷邏輯。宣告變數 `has_explicit_style = !user_style_ref_url.to_s.strip.empty?`，並將原本的 `if index == 0 || total_count == 1` 修改為 `if index == 0 || total_count == 1 || has_explicit_style`，讓帶有參考圖的場景都能即時發起 API 請求。

2. **[MUST] 確保狀態重置與 Anti-Collage 回調安全**
   - **影響檔案**：`loamlab_plugin/main.rb`
   - 描述：確認在即時發送模式下，回應處理區塊（`_s0_req.start` 內）的 `@@deferred_sends.empty?` 檢查邏輯依然安全。確保只有在無參考圖且存在延遲佇列時，才會觸發 `window.generateStyleReference` 或 `fire_deferred_renders`。

3. **[NICE] 清理冗餘的並行發送排程邏輯**
   - **影響檔案**：`loamlab_plugin/main.rb`
   - 描述：由於有參考圖的請求已被移至截圖時立即送出，`queue.empty?` 區塊內（約 1766 行）針對 `!user_style_ref_url.to_s.strip.empty?` 的 stagger 發送機制（`UI.start_timer(i * 2.0)`）已成為冗餘代碼，應將其註解或移除以保持程式碼簡潔。

status: DONE
