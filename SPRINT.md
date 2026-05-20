# Sprint Plan: 解決舊版 SketchUp 插件 SyntaxError 崩潰問題

**CONTEXT_DIGEST**
舊版 SketchUp 內建的 Chromium 瀏覽器（CEF 版本過舊）不支援 ES2020 的語法，例如可選串連（Optional Chaining `?.`）與空值合併運算子（Nullish Coalescing `??`）。這導致 UI 載入時拋出 `SyntaxError: Unexpected token .` 並顯示白畫面。為了修復此問題並防止未來再次發生，我們需要替換這些語法，並導入 ESLint 強制限制程式碼相容 ES2019 標準，最後將語法檢查整合進打包流程中。

## TASKS

- [MUST] **替換所有 ES2020 不相容語法**
  - 將 UI 程式碼中所有的 `?.` 與 `??` 替換為傳統的邏輯判斷（如 `&&`、`||`、三元運算子或明確的 `null`/`undefined` 檢查）。
  - **影響檔案**: `loamlab_plugin/ui/app.js`

- [MUST] **導入 ESLint 並強制 ES2019 語法檢查**
  - 在 `loamlab_plugin/ui` 目錄安裝 `eslint`。
  - 新增 `.eslintrc.json` 且設定 `"parserOptions": { "ecmaVersion": 2019 }`，確保未來開發者若使用 `?.` 或 `??` 會在 Lint 階段報錯。
  - 在 `package.json` 加入 `"lint": "eslint ."` 指令。
  - **影響檔案**: `loamlab_plugin/ui/package.json`, `loamlab_plugin/ui/.eslintrc.json` (新增檔案)

- [MUST] **將 Lint 檢查整合至 RBZ 打包流程**
  - 修改打包與發布腳本，在封裝成 `.rbz` 之前，先進入 `loamlab_plugin/ui` 執行 `npm run lint`。若語法檢查失敗則中止打包，確保不相容的語法絕對不會被發布出去。
  - **影響檔案**: `build_rbz.ps1`, `release.ps1`

status: DONE
