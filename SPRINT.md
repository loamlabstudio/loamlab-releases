# Smart Canvas 交互邏輯重構 Sprint

## CONTEXT_DIGEST
為了徹底解決 T2 (Smart Canvas) AI 生成不受控的問題，我們將從第一性原理出發重構交互模型。棄用「隱式遮罩 + 文字 Prompt」的拼湊方式，改為讓用戶直接在畫布上進行「白板式標註」（畫線/圈選並直接放置文字）。插件端將負責把底圖、手繪筆觸與文字標籤組合成一張直觀的「信息圖 (Information Map)」，並將此信息圖與乾淨的原圖一併發送給 AI，確保 AI 能 100% 理解修改位置與意圖。

## TASKS

- [x] **Task 1: 重構 Smart Canvas 狀態與工具列**
  - **描述**: 移除舊版的像素遮罩 (regions/masks) 邏輯。在膠囊工具列新增「文字標註工具 (Text Tool)」，允許用戶點擊畫布輸入文字。更新狀態管理以記錄標註座標、筆觸與文字內容。
  - **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
  - **調整**: 與用戶對齊後取消獨立「文字工具」按鈕；改為「畫完一個筆觸放開滑鼠即自動彈出文字輸入框」（沿用既有但原本從未被呼叫的 `_scShowLabelPopup`），體驗更符合「白板標註」直覺。工具列精簡為「標註筆＋橡皮擦」兩顆。

- [x] **Task 2: 實作畫布上的文字與標註渲染**
  - **描述**: 當用戶確認輸入文字後，透過 Canvas API (`fillText` 及繪製背景色塊) 將文字直接繪製於標註圖層，確保其在畫面上清晰可見。
  - **影響檔案**: `loamlab_plugin/ui/app.js`
  - **調整**: 依用戶指示，區域本身不再使用半透明色塊填色，改為「與文字同色的線框」；文字則以圓角深色膠囊＋同色描邊＋連接線／錨點的專業設計標註風格呈現（`_scDrawLabelPill`），字級與線寬依底圖解析度（1K/2K/4K）自動縮放。

- [x] **Task 3: 重寫信息圖組裝與 API 請求邏輯**
  - **描述**: 徹底改寫 `_scCreateAnnotatedComposite`，將底圖、筆觸層與文字標註層完美疊合，匯出一張完整的「信息圖」。更新 `executeSmartSwap` 負載，將信息圖作為 `base_image`，並將原圖作為 `original_image_b64` 雙圖發送。
  - **影響檔案**: `loamlab_plugin/ui/app.js`
  - **調整**: 確認 `original_image_b64`／`base_image`／`prompt`／`ref_images` 欄位 render.js 早已支援，無需改動後端；composite 內容改為畫線框＋文字標籤。

- [x] **Task 4: 移除舊有魔術棒與填充算法冗餘代碼**
  - **描述**: 由於不再依賴精確的像素級遮罩，可安全移除 `_scBfsFill`、`_scDilateMask`、Sobel 邊緣運算及右側過於複雜的區域列表，極大化精簡代碼並提升效能。
  - **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
  - **調整**: 從 NICE 提升為必做——移除魔術棒/填充後，`_scComputeEdgeMap`/`_scFloodFill`/`_scBfsFill`/`_scDilateMask`/`_scMaskArrayToCanvas`/`_scHighlightByColor`/`_scBuildMaskFromColor`/`_scSampleBaseColor`（含未使用的 channel canvas 與 Sobel 邊緣圖）本來就要整包刪除，非額外工程。已同步更新 6 語言 i18n 字串（`locales/*.json` → `sync_i18n.js` 重新編譯）。

**驗收**: 以 Playwright 對 `index.html` 進行端對端驅動測試 — 確認工具列僅剩「標註筆/橡皮擦」、拖曳畫圓後自動彈出文字框、確認後畫布出現線框＋專業風格文字標籤、`_scCreateAnnotatedComposite()` 正確產出信息圖。無新增 console 錯誤（既有 2 個錯誤與本次改動無關）。

status: DONE

## RELEASE_GATE
release_type: feature
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/ui/index.html
  - loamlab_plugin/ui/i18n.js
  - loamlab_plugin/ui/locales/zh-TW.json
  - loamlab_plugin/ui/locales/en-US.json
  - loamlab_plugin/ui/locales/zh-CN.json
  - loamlab_plugin/ui/locales/es-ES.json
  - loamlab_plugin/ui/locales/pt-BR.json
  - loamlab_plugin/ui/locales/ja-JP.json
  - loamlab_backend/public/i18n.js
  - loamlab_backend/api/render.js
  - FEATURE_FLAGS.md
sql_migration: false
