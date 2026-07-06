# FEATURE_FLAGS.md
# ⚠️ AGENTS: 執行任何 release 前 MUST 讀此檔。pre_release_check.ps1 會機器解析本表。

## Status 定義

| Status | 意義 | release 行為 |
|--------|------|-------------|
| `wip` | 開發中，代碼存在但未完成/未測試 | **BLOCK** — 不得進入 release package |
| `dev-only` | 代碼已在 main，UI 被 gate 鎖住，刻意不對外開放 | **WARN** — 確認 gate 仍有效即可 release |
| `ready` | 功能完整已測試，等待下次 release | ALLOW |
| `released` | 已上線 | 無限制 |

---

## Feature Registry

| Feature | Status | BLOCKED_FILES | Release Criteria | Notes |
|---------|--------|---------------|-----------------|-------|
| `dunning_process` | `released` | — | — | v1.4.50 上線；supabase Phase 28 migration 需確認已執行 |
| `loam_recipes` | `wip` | — | 見下方「跨分支 WIP」說明，merge 前必須重新評估 | 2026-07-04 查證：main 分支上乾淨、無殘留代碼。真正的 WIP 代碼在 **dev 分支** commit `0342c52`（"wip: Arcade Recipe System — in-progress, not for release"），涵蓋 app.js / i18n.js / index.html / render.js / user.js / supabase_setup.sql。（先前版本本表誤植 commit `703df94`，該 commit 實際是無關的截圖路徑修復，已更正）|
| `system_bundles` | `wip` | — | 僅插件端 UI 未做；後端已上線不受影響 | 2026-07-04 查證：`loamlab_backend/api/stats.js` 的 `get_bundles`/`set_bundles` 是 main 分支 v1.4.9（commit `462087e`）就上線的穩定代碼，**非 WIP**，之前標註「尚未開始實作」不準確。`index.html:812` 的 `#bundle-bar` 是刻意留的 `hidden` placeholder，無任何 JS 綁定，無誤觸風險。只有插件端 Bundle Bar 互動與 admin UI 尚未實作，main 分支目前沒有需要 block 的檔案 |
| `dev_marketing_post_tool` | `dev-only` | — | 隨時可跟任何 release 一起帶上，不需要每次停下來確認 | 使用者本人在 `main` 分支持續本地試驗的個人開發者工具（行銷貼文產生器：`app.js` 的 `generateBilingualPostText`/`togglePostTemplateEdit`/`savePostTemplate`/`previewAutoGeneratePost`/`handleAutoGeneratePost`，`index.html` 對應的 `dev-template-*` 區塊），全部包在 `.dev-only-tool` class（`hidden`，僅 dev build 顯示）之下，公開版看不到。2026-07-05 起：agent 看到這幾個函式/區塊在 diff 裡持續變動屬正常，直接視為安全一起 commit/release，不用暫停詢問 |
| `smart_canvas_v2_annotation` | `released` | — | — | v1.4.54 上線。2026-07-06：SmartCanvas（T2）互動模型從「像素遮罩/魔術棒」重構為「白板式標註」（點擊多節點平滑閉合曲線 + 自動彈出文字標籤），完整改動在獨立分支 `feature/smartcanvas-annotation`（未經過 `dev`，因 `dev` 當時已嚴重分歧、風險過高改走獨立分支）。過程中依真人熱重載截圖修復：① AI 輸出色塊污染——`executeSmartSwap` 原本把 colorHex 當識別碼寫進 prompt 文字，改成 `Region N` 純數字/文字標籤，同步修正 `render.js` 對應的 `Zone Color (HEX)` 誤標文字（先測試方案一：只拿掉文字色碼，composite 視覺仍保留彩色線框；若日後仍出現色塊污染，程式碼已預留切換成方案二——composite 也改中性白線框+編號）；②`_scHandlePaste` 用 `focusedRegionIdx || fallback` 導致區域1（index 0）被當假值，無法貼參考圖到第一個區域，改用明確 null/undefined 判斷（SketchUp WebView 為 ES2019，不能用 `??`）|

---

## ⚠️ 跨分支 WIP（BLOCKED_FILES 機制管不到的情況）

`pre_release_check.ps1` 的 BLOCKED_FILES 檢查只比對 **main 分支自己的 git diff**，管不到還沒 merge 進來的 `dev` 分支內容。`loam_recipes` 就是這種情況：main 現在很乾淨，風險只會在「執行 `git merge dev` 進 main」那一刻出現。

另外，BLOCKED_FILES 本身也不適合拿來擋 `app.js`/`user.js`/`render.js` 這種被大量功能共用的核心檔案——如果整個檔案被列進 BLOCKED_FILES，會連帶擋下所有跟 WIP 無關、剛好也改到同一支檔案的正常 release（例如同時在修的付費 bug）。這是這個檢查機制的天生限制，不是設定錯誤，不要試圖用「列出整支檔案」硬解。

**因此，任何 agent 要執行 `git checkout main; git merge dev` 之前，除了跑 `pre_release_check.ps1`，還必須額外手動確認：**
1. 讀這份表格裡每個 `wip`/`dev-only` 項目的 Notes，逐一確認 dev 分支上對應的功能是否真的做完了
2. 如果沒做完，用 `git cherry-pick` 只挑乾淨、已完成的 commit 進 main，不要整支 dev 分支一次 merge 進去

---

## 規則（Agent Instructions）

1. **開始任何 release 流程前**：讀此檔，確認無 `wip` 功能的 BLOCKED_FILES 出現在 `git diff`；BLOCKED_FILES 只保護「main 自己的 diff」，跨分支風險見上方「⚠️ 跨分支 WIP」章節
2. **新增 WIP 功能時**：同一個 commit 必須同步更新此表（status=`wip`）。只有在功能是**獨立新檔案**時才填 BLOCKED_FILES；若功能改的是共用核心檔案（app.js/user.js/render.js 等），BLOCKED_FILES 留空，改成在 Notes 寫清楚「代碼在哪個分支/commit，merge 前要人工核實」
3. **功能開發完成**：更新 status 為 `ready`，清空 BLOCKED_FILES（填 `—`）
4. **功能上線後**：更新 status 為 `released`，在 Notes 記錄版本號
5. `pre_release_check.ps1` 自動機器解析本表，agent 不需要手動判斷 BLOCKED_FILES 是否在 diff 裡；但**跨分支風險永遠需要人工確認**，機器檢查不到
