# SPRINT: UI Rendering & Display Scaling Bug Fixes

## CONTEXT_DIGEST
部分用戶在使用 SketchUp 外掛時，UI 視窗（`UI::HtmlDialog`）沒有填滿，且被擠壓至左上角，透出 SketchUp 灰色背景；Modal 遮罩亦被異常裁切。
此為典型的 Windows DPI 縮放 (Display Scaling) 在 SketchUp CEF 瀏覽器中的 viewport 計算誤差。雖然已經初步將 `html, body` 設為 `100%`，但仍需全面檢查其他依賴 viewport 單位的地方（如 `w-screen`, `h-screen`, `inset-0`）並確保 Ruby 端的視窗設定穩固。

## TASKS

1. **[x] [MUST] 審查並徹底移除依賴 Viewport (vw/vh) 的佈局**
   - 描述：檢查 `index.html` 內是否還有殘留的 `w-screen`、`h-screen` 或 `100vw`/`100vh`。全面替換為 `100%`（如 `w-full`, `h-full`），以避免 DPI 縮放下的計算誤差。
   - **影響檔案**：`loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js` (若有動態操作)

2. **[x] [MUST] 修正 Modal 的遮罩覆蓋邏輯**
   - 描述：檢查所有彈窗（包含 Login Modal、Referral Modal 等）使用的 `fixed inset-0`。確保其父層為 viewport 且不受縮放影響，或者改以 JavaScript 動態取得實體寬高，確保遮罩完全覆蓋黑邊。
   - **影響檔案**：`loamlab_plugin/ui/index.html`

3. **[x] [NICE] 設定 Meta Viewport 禁止縮放**
   - 描述：將 `<meta name="viewport" content="...">` 調整為 `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`，進一步減少系統縮放干擾。
   - **影響檔案**：`loamlab_plugin/ui/index.html`

4. **[x] [NICE] Ruby 端 HtmlDialog 背景色與 DPI 相容性檢查**
   - 描述：在 `main.rb` 中創建 `UI::HtmlDialog` 時，若 SketchUp 支援設定背景色，可嘗試預設為深色，以防萬一破版時不會透出突兀的 SketchUp 視圖；並確認是否有 DPI scaling 相關的已知屬性。
   - **影響檔案**：`loamlab_plugin/main.rb`

status: DONE
