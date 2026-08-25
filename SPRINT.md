# Sprint Plan: 解決 SketchUp 2021 (Chromium 88) 介面與工具二失效問題

## CONTEXT_DIGEST
用戶回報在 SketchUp 2021 中遇到「介面字體變色」及「工具二的編輯工具無法被使用」。SU 2021 內建瀏覽器核心為 Chromium 88。
**核心問題**：需解決舊版內核導致的 UI 渲染異常與功能腳本中斷。
**潛在風險與判斷失誤可能性**：
1. 若非單純 ES2022+ 語法報錯，可能是特定 SketchUp 2021 版的 Ruby-JS 橋接 (HtmlDialog) 限制，或載入時序問題導致 DOM 尚未準備好。
2. 字體變色若不是 CSS 語法不相容，可能是作業系統（如 Windows 高對比模式）或 SU 強制樣式覆蓋，需確保樣式的 Fallback 與權重夠高。
3. 降級語法時需注意避免破壞現有新版邏輯，切勿盲目替換。

## TASKS

- `[MUST]` TASK 1: 全面盤點與修復 JS 語法相容性問題 [x]
  - **目標**：掃描 `app.js`，尋找並替換 Chromium 88 不支援的語法（如 `Array.prototype.at`、`structuredClone`、`Object.hasOwn`、`Array.prototype.findLast` 等）。
  - **影響檔案**：`loamlab_plugin/ui/app.js`
  - **結果**：全文掃描 `app.js`/`i18n.js`/`tutorial.js`，無 ES2021+/ES2022+ 語法（`.at()`、`structuredClone`、`Object.hasOwn`、`findLast`、`replaceAll`、`?.`、`??`、private class field 等皆為 0 命中）。歷史 commit（`833e901`／`ed3e148`）已先行修過 `??` 運算子與 SU2022 clipboard 問題，現狀已乾淨，本次無需改動。

- `[MUST]` TASK 2: 檢查 CSS 顏色與樣式相容性 [x]
  - **目標**：確認 Tailwind CSS 或自訂樣式中，是否使用了 Chromium 88 不支援的語法 (如 `color-mix`)，並進行 fallback 或修改，解決「介面字體變色」的問題。
  - **影響檔案**：`loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/tailwind.config.js`
  - **結果**：編譯後 `style.css` 無 `oklch`/`color-mix`/`light-dark()`/`:has()` 等新語法（Tailwind 3.4，非 v4 oklch 預設值）。但發現 Tailwind Preflight 用了 `:where()`，該語法**剛好在 Chrome 88 才支援**，若 SU2021 核心低於此版號會整條規則被丟棄。已在 `index.html` 追加等效純選擇器 fallback（`abbr[title]` / `button,input[type=...]` / `[hidden]:not(...)`），宣告與原規則完全相同，新版瀏覽器同時命中也不影響視覺，無回歸風險。
  - **⚠️ 判斷調整**：`:where()` 影響的是底線/按鈕外觀重置/`[hidden]` 顯示，不直接控制文字顏色，**不確定是否為「字體變色」的真正根因**，僅是审查中發現的真實相容性邊界風險，已一併修正。

- `[MUST]` TASK 3: 驗證工具二 (Smart Canvas) 邏輯與事件綁定 [~]
  - **目標**：檢查 Smart Canvas 初始化及事件（如 `btn-sc-re-edit`）是否有呼叫在舊版 CEF 異常的 API（如 `Clipboard API` 未 catch 或過新的 DOM 寫法），確保編輯功能正常運作。
  - **影響檔案**：`loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
  - **結果**：逐一審查 `navigator.clipboard`（皆有 `if (navigator.clipboard)` 防護或 try/catch 包裹，並有 execCommand fallback）、`ResizeObserver`（已有 `typeof ResizeObserver === 'undefined'` 防護）、`btn-sc-re-edit` 綁定於 `DOMContentLoaded`，且該按鈕在 `index.html` 是靜態存在（非動態插入），時序上不會綁定失敗。**程式碼審查未找到會導致「工具二無法使用」的明確成因**，未強行做無根據的修改。
  - **待辦**：查了後端 `feedback` 表全部 334 筆紀錄（含 `window.onerror` 自動上報），User-Agent 完全沒有 `SketchUp Pro/21.x`，內容關鍵字（字體/變色/工具二/smart canvas/編輯工具）也 0 命中——代表這次回報**沒有**經過自動錯誤上報管道，可能是口頭/客服轉達，或症狀本身不會拋出 JS 錯誤（如按鈕被蓋住、純視覺異常）。需要用戶提供截圖或操作步驟才能鎖定成因，不宜再盲猜。

## 額外發現（審查 feedback 紀錄時意外找到的真實 crash，已修復）
- **`UI is not defined`**：`executeUpdate()`（app.js:4072，更新橫幅點擊流程）呼叫了從未定義過的 `UI.openURL(url)`（死代碼殘留，`UI` 不是任何有效的 JS 全域物件）。2026-07-26 有真實用戶在 **Chrome 88.0.4324.150 / SketchUp Pro 23.1** 上兩次觸發此崩潰，與本次 sprint 懷疑的 Chromium 88 環境高度吻合。已改為 `window.sketchup` 缺失時 fallback `window.open(url)`，url 為空時顯示 toast，不再引用不存在的 `UI`。此路徑只在 `window.sketchup && url` 條件不成立時才會走到，不影響插件內正常更新流程，對其他版本零風險。
- **`openSharePlatform` clipboard 崩潰**（2026-07-23，Chrome 64/SU2020，`Cannot read property 'writeText' of undefined`）：查證後**現狀已修復**，已改用有 execCommand fallback 的 `copyTextCompat()`，無需再處理。

## EXECUTION_SUMMARY
- Task 1：審查完成，現狀已乾淨，無改動。
- Task 2：審查完成 + 修正一處真實相容性邊界（`:where()` fallback），已驗證對其他 SketchUp 版本零視覺差異（純選擇器宣告與原規則完全相同）。
- Task 3：審查完成，未找到「工具二」層級的明確 bug；但查 feedback telemetry 時意外抓到並修復一個真實存在、已有用戶觸發過的 Chrome 88 崩潰（`UI is not defined`）。「介面字體變色」/「工具二無法使用」本身無自動回報紀錄，根因仍需用戶提供截圖或步驟才能繼續。

status: PARTIAL_NEEDS_REPRO
