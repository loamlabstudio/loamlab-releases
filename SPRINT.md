# SPRINT: 修復相機比例變更導致的通道圖遮罩問題

## CONTEXT_DIGEST
近期更新將 T1/T2 出圖比例統一鎖定為 3:2 (`view.camera.aspect_ratio = 1.5`)，主圖依此比例正確輸出，但後續生成 Tool 2 的通道圖 (channel image) 時，代碼中仍寫死輸出解析度為 1280x720 (16:9)。這導致 SketchUp 在輸出通道圖時，為了在 16:9 的圖片中維持 3:2 的相機比例，自動在圖片兩側加入了黑邊/灰邊（即 Safe Frame 攝像框遮擋）。AI 後端接收到帶有黑邊的通道圖後，將其誤認為遮罩，導致最終渲染結果出現異常的裁切或遮罩感。

## TASKS

### 1. [x] 修復 `batch_export_scenes` 中的通道圖解析度 [MUST]
- **影響檔案**: `loamlab_plugin/main.rb`
- **說明**: 將 Tool 2 生成通道圖時的 `view.write_image(channel_path, 1280, 720, false)` 改為使用與主圖相同的 `capture_w` 和 `capture_h`。確保通道圖與主圖維持完全相同的解析度與比例 (3:2)，避免 SketchUp 補償產生 Safe Frame 黑邊。

### 2. [x] 同步修正其他寫死 1280x720 的截圖方法 [MUST]
- **影響檔案**: `loamlab_plugin/main.rb`
- **說明**: 檢查並修正 `loamlab_generate_seg_map` 與 `get_preview_base64` 方法。將其中寫死的 `1280, 720` 替換為符合 3:2 比例的數值（如 `1536, 1024` 或 `1200, 800`），確保在任何相機鎖定比例下，獲取的預覽圖或語意分割圖都不會出現因比例不符而產生的遮罩黑邊。

status: DONE

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/main.rb
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
sql_migration: false
