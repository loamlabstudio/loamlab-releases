# LoamLab SU Plugin Fix Sprint

## CONTEXT_DIGEST
- 修正 CEF 瀏覽器自動深色模式引起的前端反色與白底異常
- 修正 Email 大小寫敏感與 KOL Dashboard 缺失邀請碼補發問題
- 修正 Smart Canvas 邊界點選失效與參考圖 Prompt 翻譯破壞格式 Bug
- 修正工具一與工具二出圖比例與畫素精度不對齊問題

## TASKS
- [x] **CEF 自動深色模式反色修正** `[MUST]`
   - **影響檔案**：`loamlab_plugin/ui/index.html`
   - **描述**：將 HTML 檔首 `color-scheme` metadata 改為 `only dark`，並在 CSS `:root` 中設定 `color-scheme: only dark !important;` 以防 CEF 強制反色。

- [x] **邀請碼及 Email 大小寫規範化** `[MUST]`
   - **影響檔案**：`loamlab_backend/api/user.js`
   - **描述**：統一將輸入的 email 轉為小寫並 trim。在 `kol_dashboard` 路由中加入當 `referral_code` 為 null 時自動補發邀請碼的邏輯。

- [x] **Smart Canvas 選取與翻譯格式修正** `[MUST]`
   - **影響檔案**：`loamlab_plugin/ui/app.js`, `loamlab_backend/api/render.js`
   - **描述**：在 `app.js` 的 `_scFloodFill` 中移除點擊在 Sobel 邊線上直接返回空遮罩的限制。在 `render.js` 中重構 Tool 2 prompt 的翻譯邏輯，分開提取顏色代碼與後綴，只翻譯純文字描述。

- [x] **工具一與工具二出圖比例與畫素對齊** `[MUST]`
   - **影響檔案**：`loamlab_plugin/ui/app.js`
   - **描述**：修改 `SmartCanvas` 將邏輯尺寸 `canvasW` / `canvasH` 設為底圖的原始寬高 `naturalWidth` / `naturalHeight`，而 CSS 顯示寬高設定為排版尺寸，確保選取像素精度與比例 100% 對齊。

- [x] **SU 2020+ 相容性修正**（Claude 補充）
   - **影響檔案**：`loamlab_plugin/ui/app.js`
   - **描述**：將 `String.prototype.replaceAll`（Chrome 85+）替換為 `split().join()`，確保 SketchUp 2020 的 CEF（~Chromium 76）不會報錯。

status: DONE
