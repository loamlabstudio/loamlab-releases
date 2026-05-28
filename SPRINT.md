# SPRINT

## CONTEXT_DIGEST
- **根因分析**：舊版 SketchUp CEF 無法執行 Tailwind CDN 中的現代 JavaScript (ES2020+) 語法，導致樣式引擎解析失敗。這不僅造成介面嚴重破版（如圖1所示），也連帶導致依賴 `.hidden` 類名控制的登入狀態與 Modal 邏輯失效。
- **解決方案**：全面棄用客戶端動態編譯（Tailwind CDN），改用 Tailwind CLI 靜態編譯完整的 `style.css` 隨外掛一起發布，確保所有 SketchUp 版本的相容性並恢復介面功能。

## TASKS

### 1. [MUST] 初始化 Tailwind CLI 並編譯靜態 CSS
- **影響檔案**: `loamlab_plugin/ui/tailwind.config.js` (若為v3), `loamlab_plugin/ui/assets/input.css`, `loamlab_plugin/ui/package.json`
- **描述**:
  - 在 `loamlab_plugin/ui/` 初始化 Tailwind 專案設定，指定掃描 `content: ["./*.html", "./*.js", "./**/*.js"]`。
  - 建立入口樣式檔 `assets/input.css`，並載入 Tailwind 基礎指令。
  - 於 `package.json` 新增 `build:css` 與 `watch:css` scripts。
  - 執行編譯，產出完整的 `assets/style.css`（覆蓋現有殘缺的 fallback 樣式）。

### 2. [MUST] 更新 HTML 移除 Tailwind CDN
- **影響檔案**: `loamlab_plugin/ui/index.html`
- **描述**:
  - 徹底移除 `<script src="https://unpkg.com/tailwindcss-cdn@3.4.13/tailwindcss.js" ...></script>` 標籤。
  - 確保 `<link rel="stylesheet" href="./assets/style.css">` 為唯一且主要的樣式載入點。
  - 檢查 HTML 原本定義在行內的 `tailwind.config = {...}` 是否已正確遷移至本地專案設定檔中。

### 3. [NICE] 驗證登入與 UI 狀態切換邏輯
- **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
- **描述**:
  - 檢查 `app.js` 內是否有動態拼接字串產生的 Tailwind class (例如 `text-${color}-500`)，若有則需寫明完整類名或加入 safelist。
  - 確保編譯後，未登入與已登入的狀態顯示（點數餘額、Log In 按鈕）、Modal 開關（如 OTP 視窗）皆能透過靜態的 `.hidden` 類名正確運作，完全恢復如圖2的正常介面。

status: DONE
