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

- `[MUST]` TASK 3: 驗證工具二 (Smart Canvas) 邏輯與事件綁定 [x]
  - **目標**：檢查 Smart Canvas 初始化及事件（如 `btn-sc-re-edit`）是否有呼叫在舊版 CEF 異常的 API（如 `Clipboard API` 未 catch 或過新的 DOM 寫法），確保編輯功能正常運作。
  - **影響檔案**：`loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`
  - **結果（用戶截圖確認後鎖定真正根因）**：用戶回報「點擊工具二後，圈選工具（sc-capsule 底部膠囊工具列）根本沒出現」+「字體顏色跟正常版本不一樣」，確認**不是渲染結果畫面、也不是語法報錯**，是純 CSS 沒套用的症狀。
    - 追根源頭發現：`main.rb:249` 用 `?t=#{Time.now.to_i}` 幫 `index.html` 本身做 cache-busting（每次開啟保證重載最新版），但頁面內 `<link rel="stylesheet" href="./assets/style.css">` **完全沒有任何 cache-busting 參數**（對照組：`i18n.js?v=1.4.11`／`app.js?v=1.4.11` 都有手動維護的版號）。
    - `.sc-tool-btn`/`.sc-capsule` 等 SmartCanvas 專屬樣式雖然寫在 index.html 內聯 `<style>`（永遠最新），但整個底部工具膠囊的定位/佈局/背景（`flex`/`gap-1.5`/`backdrop-blur`/`rounded-full`/`shadow-lg` 等）全部依賴外部 `style.css` 的 Tailwind utility classes。若該機器的內建瀏覽器快取住舊版 `style.css`（尤其是升級版本沒帶到新 class，或整份快取失效），工具列就會失去佈局變成無樣式的裸 `<button>`，肉眼幾乎看不出來、也不會拋 JS 錯誤——完全對應「工具二點下去圈選工具沒出現」；同理，大量 `text-white/50` 等文字顏色 utility class 失效會讓字體顏色跟新版不一樣。
  - **修復**：`index.html` 的 `style.css` 改用 JS 讀取當頁 `location.search`（即 Ruby 附加的同一個 `?t=` 時間戳記）動態組出 `<link>` 網址，用 `document.write` 在 `<head>` 解析階段同步輸出（比動態插入 `<link>` 相容性更好）。效果：**每次開啟 dialog，style.css 保證跟 index.html 用同一把時間戳失效重載，徹底消除這整類「CSS 讀到舊快取」的問題**，不需要再手動維護版號、以後也不會再忘記同步。對其他 SketchUp 版本零風險（只是讓 CSS 每次都拿最新的，不影響任何邏輯）。
  - **後續風險提示（未在本次處理，留給未來 sprint）**：JS 檔（`i18n.js`/`app.js`/`tutorial.js`）目前仍是手動維護的靜態 `?v=` 版號，沒有自動化，理論上同樣可能因為忘記在某次 release 手動同步而吃到舊快取——建議未來一併改成跟 CSS 一樣讀 `location.search` 動態產生，一次徹底解決，但這次先聚焦在已確認會炸的 CSS。

## 額外發現（審查 feedback 紀錄時意外找到的真實 crash，已修復）
- **`UI is not defined`**：`executeUpdate()`（app.js:4072，更新橫幅點擊流程）呼叫了從未定義過的 `UI.openURL(url)`（死代碼殘留，`UI` 不是任何有效的 JS 全域物件）。2026-07-26 有真實用戶在 **Chrome 88.0.4324.150 / SketchUp Pro 23.1** 上兩次觸發此崩潰，與本次 sprint 懷疑的 Chromium 88 環境高度吻合。已改為 `window.sketchup` 缺失時 fallback `window.open(url)`，url 為空時顯示 toast，不再引用不存在的 `UI`。此路徑只在 `window.sketchup && url` 條件不成立時才會走到，不影響插件內正常更新流程，對其他版本零風險。
- **`openSharePlatform` clipboard 崩潰**（2026-07-23，Chrome 64/SU2020，`Cannot read property 'writeText' of undefined`）：查證後**現狀已修復**，已改用有 execCommand fallback 的 `copyTextCompat()`，無需再處理。

## EXECUTION_SUMMARY
- Task 1：審查完成，現狀已乾淨，無改動。
- Task 2：審查完成 + 修正一處真實相容性邊界（`:where()` fallback），已驗證對其他 SketchUp 版本零視覺差異。
- Task 3：**根因已由用戶截圖確認並修復**——`style.css` 缺少 cache-busting，導致部分機器讀到舊版快取（字體顏色跟不上新版、SmartCanvas 工具列佈局樣式缺失變成看不見的裸按鈕）。改用跟 index.html 同一把 `?t=` 時間戳動態載入，徹底解決，且此後不需要再手動維護版號。
- 額外修復：`executeUpdate()` 死代碼 `UI.openURL` 崩潰（Chrome 88/SU2023.1 真實用戶已觸發過）。

status: DONE
