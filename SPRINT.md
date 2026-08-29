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

## RELEASE_GATE
release_type: feature
verified_diff:
  - loamlab_backend/api/render.js
  - loamlab_backend/api/stats.js
  - loamlab_backend/lib/systemConfig.js
  - loamlab_backend/lib/defaultPrompts.js
  - loamlab_backend/public/admin.html
  - loamlab_backend/api/version.js
  - loamlab_plugin/main.rb
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - SPRINT.md
sql_migration: false   # T2 複用既有 system_config_log（supabase_setup.sql Phase 33），無新 Phase

status: DONE
