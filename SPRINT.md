# Implementation Plan

## CONTEXT_DIGEST
經過嚴格檢查與第一性原理分析，確認點擊渲染後「點數有扣、後台出圖但視窗閃退」的根源在於 SketchUp Ruby API 的兩個致命雷區：
1. **C++ 層崩潰 (Flash Crash)**：`main.rb` 的 `restore_render_keys` 方法中，殘留了對 `model.pages.each { p.update(...) }` 的迴圈操作。這個操作在渲染完成後瞬間執行，會觸發 SU2023 已知的批量場景更新崩潰。
2. **主執行緒阻塞 (UI Freeze/Crash)**：`auto_save_render` 和 `save_image` 中使用了同步的 `URI.open(url).read` 來下載圖片，這會徹底卡死 SketchUp 主執行緒，在網路稍慢或多次請求時，容易被系統判定為無回應而閃退。

## TASKS
- [MUST] 移除危險的批量場景更新迴圈
  - **影響檔案**: `loamlab_plugin/main.rb`
  - **描述**: 在 `restore_render_keys` 方法中，徹底移除 `model.pages.each` 與 `p.update` 的相關程式碼。樣式的還原只需針對全域的 `RenderingOptions` 和 `ShadowInfo` 進行即可，不需要也不應該強制覆寫所有場景的設定檔。
- [MUST] 將圖片下載重構為非阻塞異步架構 (Async Download)
  - **影響檔案**: `loamlab_plugin/main.rb`
  - **描述**: 在 `auto_save_render` 與 `save_image` 兩個 callback 中，移除所有 `require 'open-uri'` 和 `URI.open(url)` 的同步下載代碼。全面改寫為 `Sketchup::Http::Request.new(url, Sketchup::Http::GET)` 搭配 `set_download_path(full_path)` 來處理非同步下載，並將成功後的邏輯（如寫入 `cloud_index` 或彈出提示）移至 request block 內。

status: DONE
