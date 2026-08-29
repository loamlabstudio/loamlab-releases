# Sprint Plan: 處理 Admin 提示詞 Batch Layer 留白邏輯與部署

## CONTEXT_DIGEST
Admin 介面中的 Batch Layer（Image Roles 與 Style Consistency）原本在輸入框留白時，會自動 fallback 到 `defaultPrompts.js` 的英文預設值。
用戶希望「留白就保持空白」，不要強制塞入預設值。目前已在 `api/render.js` 中修改 `buildNodesModePrompt`，改用 `!== undefined` 判斷，允許空字串並過濾空屬性，但尚未部署至正式環境。

## TASKS
1. **[MUST] 驗證並完善留白邏輯**
   - 檢閱 `loamlab_backend/api/render.js` 中的 `buildNodesModePrompt` 函數。
   - 確認當 `batchNodes` 中的 `img1_key`, `forbidden` 等值為空字串 `""` 時，對應的約束條件會從最終發送給 AI 的提示詞（JSON）中自動剔除。
   - **影響檔案**: `loamlab_backend/api/render.js`

2. **[MUST] 部署與發布更新**
   - 確認程式碼無誤後，將變更 commit 並推送到 GitHub，或是透過 Vercel CLI 進行部署，確保線上 Admin 面板的「↻ 重整」預覽與實際渲染能套用新邏輯。
   - **影響檔案**: `loamlab_backend/api/render.js` (Git Commit)

## 執行結果（Claude）

- **T1 留白邏輯**：驗證後發現缺口——原本 `if (key || value)` 只有 key、value 都空才剔除；admin 只清空「值」但保留固定標籤時，會留下 `"標籤": ""`。已改為「以值為準」：值空（`""`）→ 整條從 JSON 剔除；只有從未設定（`undefined`）才 fallback 預設；標籤被清空時退回預設標籤避免空字串 key。四情境行為模擬（全預設 / 清值 / 清整條 / 自訂值）皆正確。
- **T2 發佈**：與同批未部署的「Prompt as Code 強化 sprint」（commit `981fcee`）+ Smart Canvas 膠囊同步修復（commit `7f37321`）一起，用戶選擇「一次到位：publish 同時推後端 + 插件」。版本 `1.4.68 → 1.4.69`。

## 執行結果（Claude，v1.4.70）

發完 v1.4.69 後，用戶回報兩件事，一併處理（非留白 sprint 本體，記錄於此避免另開檔案）：
- **渲染歷史「重用設定」按鈕**：查 git blame，此按鈕自 2026-04 從未被任何 commit 動過——用戶之前的移除只在熱重載裡改、未 commit，打包 v1.4.69 時從 git 版 `app.js` 出的所以又出現。用戶確認刪除：移除按鈕與死函式 `applyHistorySettings`，pick 模式 hover 遮罩改為僅該模式下渲染。
- **T1 渲染送出變慢**：第一性原理盤點 `_handleRender` 序列 await，找到三處可砍且零行為變更：①T1/T3 base64 截圖先前會上傳 Supabase Storage 換簽名 URL，下方組 `atlasImages` 又把它下載回來轉回 base64（AtlasCloud 最終收到的還是同一份 base64）——直接略過 Storage 這段；②`SYSTEM_PROMPTS`/`MODEL_CONFIG`/`SYSTEM_ENGINE_CONFIG`/`SYSTEM_T1_NODES` 四個獨立 `getConfig` 從序列 await 併成 `Promise.allSettled`；③移除每次都跑、每次都因 bucket 已存在而靜默失敗的 `createBucket`。合計每次 T1 送出前省約 1.5–2.5 秒。commit `9a9ddd7`，用戶已驗收通過。

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_backend/api/render.js
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
sql_migration: false

status: DONE
