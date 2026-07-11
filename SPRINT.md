# Implementation Plan, Task List and Thought in Chinese

**CONTEXT_DIGEST**:
- 舊版 SketchUp (CEF/Chrome < 65) 不支援 `AbortController`，導致用戶點擊「管理/取消訂閱」時直接觸發 ReferenceError 崩潰。
- Tailwind 的任意值背景 `bg-[#hex]` 會編譯為現代化 `rgb(R G B / var)` 語法，這在舊版 CEF 中會失效，導致模態框背景完全透明且與 3D 視圖重疊。
- 目前的 `window.onerror` 僅用 `alert()` 提示，並未將崩潰日誌回傳至伺服器，導致官方無法觀測到舊版客戶端的嚴重報錯。

**TASKS**:
- [x] **Task 1: 實作 AbortController Polyfill**
  - **影響檔案**: `loamlab_plugin/ui/index.html`
  - **描述**: 在全域環境注入輕量級的 `AbortController` polyfill，確保在舊版 CEF 中調用 `fetch` 與取消訂閱 API 時不會因 `AbortController is not defined` 而報錯中斷。
  - **實作說明**: 單一入口注入於 `<head>` 最前面（app.js 載入前），涵蓋 app.js 內全部 5 處 `new AbortController()` 呼叫點，包含螢幕截圖中崩潰的 `_cfConfirmCancel`（app.js:2808）。
- [x] **Task 2: 修復 Modal 背景透明與漸層失效 (CSS 相容性)**
  - **影響檔案**: `loamlab_plugin/ui/index.html`
  - **描述**: 將所有關鍵 Modal（如 `pricing-modal`, `cancel-flow-modal`, `login-modal`）及其內部方案卡片的 `bg-[#hex]`，透過內聯樣式 `style="background-color: #hex;"` 進行覆蓋。針對 PRO 方案的漸層，請補充實色背景作為 fallback，以防舊版瀏覽器整塊變透明。
  - **實作說明**: 已確認編譯後 CSS 使用現代 `rgb(R G B / var)` 語法（舊版 CEF 不支援），共修復 7 處：login-modal-content、pricing-modal-content、Starter/Pro/Studio 三張方案卡、Top-up 面板、cancel-flow-content。
- [x] **Task 3: 修復 Flex Gap 導致的佈局重疊**
  - **影響檔案**: `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js`
  - **描述**: 舊版 Chrome 不支援 Flexbox 的 `gap` 屬性。請檢查 `pricing-modal` 等核心介面，將依賴 `flex gap-x` 的關鍵排版（特別是垂直堆疊的卡片內容與按鈕組）改用 Tailwind 的 `space-x-x` 或 `space-y-x` (利用 margin 實現)，以確保在舊版中不會擠在一起。
  - **實作說明**: index.html 內 2 處靜態 Tailwind `gap` 改為 `space-y`；另發現 app.js 的 `_cfRenderStep1/_cfRenderStep2`（取消訂閱彈窗，即螢幕截圖崩潰所在）以內聯 `style="display:flex;gap:8px"` 動態產生按鈕，一併改為 margin-based 間距。
- [x] **Task 4: 前端異常自動上報機制 (Telemetry)**
  - **影響檔案**: `loamlab_plugin/ui/index.html`
  - **描述**: 修改 `<head>` 中的 `window.onerror`，在跳出 `alert()` 的同時，使用 `fetch` 將錯誤訊息 (msg, line, stack) 與當前版本靜默發送至 `https://loamlab-camera.vercel.app/api/feedback`（標記 `type: "bug"`），以便未來能從後台觀測到此類用戶的客戶端崩潰狀況。
  - **實作說明**: 已確認後端 `api/feedback.js` 端點與 payload 格式相容（type/content/metadata）；fetch 包在 try/catch + .catch 中避免上報失敗造成遞迴錯誤。

**驗收**: ESLint (`npm run lint`) 通過，`node -c app.js` 語法檢查通過。後端修復已於部署時單獨透過 `vercel --prod` 上線並經冒煙測試確認；本次為插件端 (.rbz) 正式發布。

## RELEASE_GATE
release_type: feature
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/ui/index.html
  - loamlab_backend/api/user.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
sql_migration: false

status: DONE
