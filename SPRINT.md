# SPRINT: Seedream v5.0 Pro Edit Model Testing in T1

## CONTEXT_DIGEST
用戶需要在 T1 測試新模型 `Seedream v5.0 Pro Edit`，並且要在 admin 後台管理切換。
切換模型時，出圖比例必須與現有架構保持一致（T1/T3 固定為 3:2，T2 依 aspectRatio 參數決定）。
需修改前端管理介面選項，及後端 API 的 Model Adapter 邏輯以正確映射參數。

## TASKS

### TASK 1: 在 Admin 介面新增 Seedream 模型選項 [MUST] [x]
**影響檔案**: `loamlab_backend/public/admin.html`
- 描述：在 `admin.html` 的 `model-t1`、`model-t2`、`model-t3` 下拉選單中，新增一個 `<option value="seedream/v5.0-pro-edit">Seedream v5.0 Pro Edit</option>`。
- 說明：可讓管理員於後台即時切換至此新模型。為保證完整性，T1/T2/T3 下拉列表皆同步新增，但預期重點測試在 T1。

### TASK 2: 後端新增 Seedream 的 Model Adapter [MUST] [x]
**影響檔案**: `loamlab_backend/api/render.js`
- 描述：在 `MODEL_ADAPTERS` 物件中新增對應 `seedream` 的 key。
- 說明：配置與 `google/nano-banana` 一致的長寬比邏輯：`aspect_ratio: activeTool === 2 ? (aspectRatio || '16:9') : '3:2'`，以確保切換至 Seedream 模型時，出圖比例維持不變。其餘參數如 `resolution`、`images` 及 `prompt` 亦依據 API 要求正確轉發。

status: DONE

## RELEASE_GATE
release_type: feature
verified_diff:
  - loamlab_backend/api/render.js
  - loamlab_backend/public/admin.html
  - loamlab_backend/api/stats.js
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/main.rb
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
sql_migration: false
