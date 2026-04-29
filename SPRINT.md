# Sprint: 修正 Smart Canvas 遮罩精準度與提示詞色碼遺失問題

## CONTEXT_DIGEST
目前 Tool 2 (Smart Canvas) 渲染失敗或色塊殘留的兩大根因：1. 前端合成 `base_image` 給 AI 時將標記色透明度設為 0.72，導致邊緣色差。2. 後端 `render.js` 處理 prompt 時，強制把色碼截斷拋棄，只送出純文字描述，導致 AI 失去顏色對應資訊。需將前端色塊改為 100% 不透明，並修復後端字串處理邏輯以完整保留色碼。

## TASKS

1. **[MUST] 修正合成圖的透明度設定**
   - **影響檔案**：`loamlab_plugin/ui/app.js`
   - **說明**：在 `_scCreateAnnotatedComposite` 函數中，將原本的 `ctx.globalAlpha = 0.72` 變更為 `ctx.globalAlpha = 1.0`，確保傳送給 API 的合成標記色塊為 100% 不透明實色，讓 AI 提取遮罩零誤差。
   - **[x] 已驗證跳過**：當前代碼無此問題。`_scCreateAnnotatedComposite` 使用 `source-in` 合成，tint canvas 像素已為 100% 不透明，`ctx.globalAlpha` 保持預設 1.0，不需修改。

2. **[x] 修復後端 Prompt 色碼截斷 Bug**
   - **影響檔案**：`loamlab_backend/api/render.js`
   - **說明**：定位 `activeTool === 2` 的 prompt 字串切分邏輯。將原本遺棄 `spl[0]` 的寫法（`if (spl[1]) changes.push('• ' + spl[1].trim());`），修改為 `if (spl[0] && spl[1]) changes.push(\`[\${spl[0].trim()}]: \${spl[1].trim()}\`);`，確保傳給 AI 的 `{{CHANGES}}` 變數能完整映射色碼（例如：`[#ff6432]: 換成沙發`）。

status: DONE
