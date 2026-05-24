# Sprint Plan: T1 渲染 AO 參數型別修正

## CONTEXT_DIGEST
T1 渲染預先套用的 Ambient Occlusion (AO) 參數未生效。經查為前端 `admin.html` 傳遞的距離與強度數值（例如 `2`），在 Ruby 端 `JSON.parse` 後變為 Integer。但 SketchUp API 嚴格要求 `AmbientOcclusionDistance` 與 `AmbientOcclusionIntensity` 必須是 Float。這導致 API 賦值時靜默引發 TypeError 而失效。

## TASKS
- [x] 驗證 `loamlab_plugin/main.rb` 中的 `apply_force_style_override` 與 `safe_set_render_keys`，確保 `AmbientOcclusionDistance` 與 `AmbientOcclusionIntensity` 已正確轉換為 `.to_f`。若代碼中已包含修正，則直接進入下一步。
  **影響檔案**: `loamlab_plugin/main.rb`
- [x] 將修改後的檔案進行 git add 與 git commit，完成本次修復的提交，確保代碼庫狀態更新。
  **影響檔案**: `loamlab_plugin/main.rb`

status: DONE
