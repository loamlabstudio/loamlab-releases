# Sprint Plan: 解決工具1參考圖空間結構干擾 & 工具2圖片比例變形問題

## CONTEXT_DIGEST
1. 用戶反映使用「工具1」參考圖時，AI 會將參考圖的空間結構融合進來。解決方案是在前端對參考圖進行強烈的「高斯模糊」處理。
2. 用戶反映「工具2」渲染輸出的比例與原圖不一致。經查為 `render.js` 中的模型適配器 (`google/nano-banana`) 強制加上 `aspect_ratio: '16:9'` 參數所致，需在工具2的情境下移除此限制，保留原圖比例。

## TASKS

### 1. 實作影像高斯模糊處理函數 [MUST]
- **影響檔案**: `loamlab_plugin/ui/app.js`
- **任務描述**: 
  1. 在 `app.js` 中新增一個非同步函數 `blurImageForStyleReference(url, blurRadius = 40)`。
  2. 設定 `img.crossOrigin = 'Anonymous'`，將圖片繪製至 `<canvas>` 並使用 `ctx.filter = blur`。
  3. 導出模糊後的 Base64。若載入失敗則回傳原始 URL。

### 2. 工具1：渲染請求前套用模糊處理 [MUST]
- **影響檔案**: `loamlab_plugin/ui/app.js`
- **任務描述**: 
  1. 在送出 Payload 前，若為 `currentActiveTool === 1` 且有 `_tool1StyleRefUrl`，則 await `blurImageForStyleReference`。
  2. 用模糊 Base64 取代原 URL 送出給後端。

### 3. 工具2：修復後端渲染比例強制 16:9 變形問題 [MUST]
- **影響檔案**: `loamlab_backend/api/render.js`
- **任務描述**: 
  1. 修改 `buildAtlasReqBody` 函式簽名，接收 `activeTool` 作為參數。
  2. 修改 `MODEL_ADAPTERS['google/nano-banana']` 適配器函式，使其能根據 `activeTool` 動態調整參數。
  3. 當 `activeTool === 2` (Furniture Swap / 編輯模式) 時，在回傳的 payload 中 **不要** 強制加上 `aspect_ratio: '16:9'`，讓 AI 引擎能維持輸入影像的原始比例進行渲染。

status: DONE
