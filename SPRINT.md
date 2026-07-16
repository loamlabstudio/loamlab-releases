# SPRINT: T2 Smart Canvas 綜合體驗修復與優化

## CONTEXT_DIGEST
本 SPRINT 包含三個重要的 T2 模組修復與優化：
1. **邊界與偏移 Bug 修復**：舊版使用 JS `ResizeObserver` + `Math.round()` 同步 Canvas 尺寸，小數點誤差會被等比放大，導致「鼠標在邊界消失」以及「送出的線框位置偏移」。已全面改用 CSS 原生 `w-full h-full` 與 `inline-flex` 完美包覆解決。
2. **AI 去色干擾優化**：AI 常把彩色線框當成塗色指令（殘留螢光色）。已將 `_scCreateAnnotatedComposite` 邏輯改為「內外分離」：使用者預覽維持彩色，送交 AI 時 (`bakeRefTags=true`) 自動轉為「純白線框＋黑暈」。
3. **介面精簡**：移除 T2 生成結果卡片上的 EXTRACT 按鈕，精簡操作流程。

## TASKS
- [x] 使用者需在 SketchUp 重新載入外掛（執行 `ruby .agents/scripts/hot_reload_ui.rb`），進入 T2 畫圖測試。
- [x] 確認滑鼠移動到圖片邊緣時，座標與鼠標不再消失或偏移。（測試回報：偏移已消失；另發現「部分圖片局部區域鼠標消失」的殘留問題，已用 JS 精確算 stack px 尺寸取代 CSS shrink-to-fit 修復，詳見 v1.4.62 commit）
- [x] 確認預覽圖維持彩色線框，且生成的結果圖不再殘留螢光色線條（實際送出為黑白圖）。
- [x] 確認 T2 結果卡片（SWAPPED）上的 EXTRACT 按鈕已消失。
- [x] 已檢視 `loamlab_plugin/ui/index.html` 與 `loamlab_plugin/ui/app.js` 相關變更，並將所有變更 commit 進入儲存庫（1b7fd39 fix + d8668f3 版本號）。

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/ui/index.html
sql_migration: false

## 已發布
v1.4.62（2026-07-16）：三項修復已 build + publish 上線，用戶可透過自動更新取得。

status: DONE
