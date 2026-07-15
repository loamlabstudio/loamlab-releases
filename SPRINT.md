# SPRINT: 修復 Smart Canvas 鼠標消失邊界問題

## CONTEXT_DIGEST
- **問題**：使用者回報 T2 Smart Canvas 在某些圖片區域邊界鼠標會消失，無法操作。
- **根因**：原先使用 `ResizeObserver` 搭配 JS `Math.round()` 計算 Canvas px 尺寸，會產生小數點像素誤差，導致 Canvas 比底圖稍小。當鼠標移至底圖邊緣但超出 Canvas 範圍時，會觸發 `mouseleave` 清除鼠標圈。另外 `max-height: calc(100% - 200px)` 在 `inline-block` 容器內無效，導致長圖可能超出邊界。
- **解決方案（已實作）**：將 `sc-canvas-stack` 改為 `inline-flex` 並加上 `max-width: 100%; max-height: 100%;` 讓其原生縮放並緊緻包覆底圖。並將三層 Canvas 改為 CSS `w-full h-full` 100% 貼合容器，完全移除 `ResizeObserver` 的 px 計算。

## TASKS
- [MUST] 檢視並確認 `loamlab_plugin/ui/index.html` (sc-canvas-stack 及底下三個 canvas 的 class 與 style 變更) [x]
  - **影響檔案**：`loamlab_plugin/ui/index.html`
  - **結果**：與 CONTEXT_DIGEST 描述吻合，`git diff` 核對通過。
- [MUST] 檢視並確認 `loamlab_plugin/ui/app.js` (移除 ResizeObserver 並將 canvas 設為 style.width/height = '100%') [x]
  - **影響檔案**：`loamlab_plugin/ui/app.js`
  - **結果**：與 CONTEXT_DIGEST 描述吻合，`git diff` 核對通過。
- [MUST] 使用 `ruby .agents/scripts/hot_reload_ui.rb` 更新 UI，並在 SketchUp 中開啟 T2 Smart Canvas，載入各種比例（如長圖、寬圖）測試邊界是否有鼠標消失的問題。 [~]
  - **調整**：`.agents/scripts/hot_reload_ui.rb` 不存在於此專案，實際熱重載流程為 `load 'dev_reload.rb'`（見 CLAUDE.md）。GUI 手動視覺驗收需要人類在 SketchUp 中操作，Claude 無法代為執行；經用戶確認後，此為單純 CSS/JS 修正、風險低，用戶選擇直接 commit，略過此步驟的即時人工驗證，待實際使用時回報。
- [MUST] 確認無誤後，將變更 commit 進入儲存庫。 [x]

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/ui/index.html
sql_migration: false

status: DONE
