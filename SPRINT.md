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

status: READY_FOR_CLAUDE
