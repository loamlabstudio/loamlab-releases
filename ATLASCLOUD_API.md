# AtlasCloud Nano Banana 2 API 說明書

> 適用場景：LoamLab 渲染插件後端擴充、替換或補強 Coze Workflow 的圖像生成能力
> 文件建立：2026-03-24

---

## 一、平台概覽

| 項目 | 內容 |
|---|---|
| 平台名稱 | Atlas Cloud |
| 模型數量 | 300+ AI 模型（圖像/視頻/LLM/音頻） |
| 統一入口 | 所有模型共用一組 API Key + Endpoint |
| OpenAI 相容 | 是，可直接替換 OpenAI SDK |
| 計費方式 | 按使用計費（圖像/張，視頻/秒） |
| 新用戶福利 | $1 免費額度 + 首次儲值 25% 獎勵 |
| 帳戶管理 | https://console.atlascloud.ai |

---

## 二、認證方式

```
Authorization: Bearer {API_KEY}
```

- API Base（圖像/視頻）：`https://api.atlascloud.ai/api/v1`
- API Base（LLM）：`https://api.atlascloud.ai/v1`
- API Key 只顯示一次，丟失需重建

---

## 三、Nano Banana 2 模型能力

### 3-A. Text-to-Image（文生圖）

**Model ID：** `google/nano-banana-2/text-to-image`

**特色：**
- 原生 4K 輸出（非插值）
- 4-8 秒生成（比 Pro 版快 3-5 倍）
- 精準文字渲染（海報、標題可用）
- 複雜多角色構圖

**參數表：**

| 參數 | 必填 | 類型 | 可選值 | 說明 |
|---|---|---|---|---|
| `model` | ✅ | string | - | 固定填 model ID |
| `prompt` | ✅ | string | - | 圖像描述 |
| `aspect_ratio` | 否 | string | 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | 寬高比 |
| `resolution` | 否 | string | `1k`（預設）, `2k`, `4k` | 輸出解析度 |
| `output_format` | 否 | string | `png`（預設）, `jpeg` | 輸出格式 |

**定價（Atlas Cloud 折扣後）：**

| 解析度 | 原價 | Atlas 價格 |
|---|---|---|
| 1K | $0.080/張 | $0.072/張 |
| 2K | $0.120/張 | $0.108/張 |
| 4K | $0.160/張 | $0.144/張 |

**請求範例：**
```json
POST https://api.atlascloud.ai/api/v1/model/generateImage
{
  "model": "google/nano-banana-2/text-to-image",
  "prompt": "A modern interior design with warm lighting, SketchUp architectural render style",
  "aspect_ratio": "16:9",
  "resolution": "2k",
  "output_format": "jpeg"
}
```

**回應結構：**
```json
{
  "status": "success",
  "data": {
    "id": "prediction_id",
    "image_url": "https://...",
    "image_base64": "..."
  }
}
```

---

### 3-B. Image Edit（圖生圖／編輯）

**Model ID：** `google/nano-banana-2/edit`

**特色：**
- 自然語言驅動圖像修改
- 最多 14 張參考圖像
- 風格遷移、結構修改
- 內容感知修復

**參數表：**

| 參數 | 必填 | 類型 | 可選值 | 說明 |
|---|---|---|---|---|
| `model` | ✅ | string | - | 固定填 model ID |
| `images` | ✅ | array | URL 或 Base64 | 核心參數：可傳入 1~14 張圖（見 3-C 進階應用） |
| `prompt` | ✅ | string | - | 編輯與風格融合指令 |
| `aspect_ratio` | 否 | string | 同上 | 輸出寬高比 |
| `resolution` | 否 | string | `1k`, `2k`, `4k` | 輸出解析度 |
| `output_format` | 否 | string | `png`, `jpeg` | 輸出格式 |

**定價：** 與 Text-to-Image 相同

**請求範例：**
```json
POST https://api.atlascloud.ai/api/v1/model/generateImage
{
  "model": "google/nano-banana-2/edit",
  "images": ["https://example.com/sketchup_screenshot.jpg"],
  "prompt": "Apply cinematic color grading, enhance architectural lighting, add realistic shadows",
  "resolution": "2k",
  "aspect_ratio": "16:9",
  "output_format": "jpeg"
}
```

---

### 3-C. 能力邊界拓展：多圖融合與風格遷移 (Style Transfer)

**核心突破點：**
Nano-Banana-2 的 `images` 參數設計為 Array 格式（支援 1~14 張），這打破了傳統「單圖生圖」的限制，可實現高階的 **ControlNet + IP-Adapter (風格墊圖)** 混合效果。

**實戰應用情境：**
藉由陣列順序與 Prompt 配合，系統能辨識「場景主體」與「風格參考」，實現「**以圖一的 3D 結構，套用圖二的真實世界材質與氛圍**」。

**1. 空間風格遷移 (Spatial Style Transfer)**
- `images[0]`：SketchUp 白模截圖（維護幾何形體、深度、透視限制）。
- `images[1]`：一張真實的極簡風或工業風照片（提供光影、色彩配置、材質肌理參考）。
- **Prompt 範例**："Render the first image's spatial structure utilizing the exact lighting, materials, and overall mood of the second reference image. Photorealistic architectural visualization."

**2. 指定物件替換與融合 (Fusion & Replacement)**
- 若用戶想要更換沙發，且手邊有特定家具目錄的照片：
- `images[0]`：主場景圖 (包含占位沙發)
- `images[1]`：目標沙發圖/材質圖
- **Prompt 範例**："Replace the proxy sofa in the main scene with the precise furniture style and texture shown in the second image. Harmonize lighting."

**多圖輸入 Payload 範例：**
```json
POST https://api.atlascloud.ai/api/v1/model/generateImage
{
  "model": "google/nano-banana-2/edit",
  "images": [
    "data:image/jpeg;base64,...(SU_白模_Base64)...",
    "https://example.com/target_style_reference.jpg"
  ],
  "prompt": "Apply the warm lighting, concrete textures, and styling from the second image onto the 3D geometry of the first image.",
  "resolution": "2k",
  "output_format": "jpeg"
}
```

> **UI 落地方向 (Roadmap Phase 1 伏筆)**：
> 介面右側的「參數設定」區，目前有一項未被啟用的 `<input id="swap-reference-url">`。後端 `render.js` 收到後，將主畫面排在 `images[0]`，該參考圖排在 `images[1]` 一併發送 API，即可零成本實現「一鍵風格/材質複製」。

---

## 四、同平台其他圖像模型（備用選項）

| 模型 | Model ID | 速度 | 價格/張 | 最適場景 |
|---|---|---|---|---|
| Flux 2 Pro | `black-forest-labs/flux-2-pro/text-to-image` | ~3s | $0.03-0.05 | 批量生成、電商 |
| Imagen 4 Ultra | `google/imagen4-ultra/text-to-image` | ~8s | $0.04-0.08 | 超高品質單圖 |
| Ideogram v3 | `ideogram/ideogram-v3/text-to-image` | ~4s | $0.03-0.05 | 含文字圖像、海報 |

---

## 五、視頻生成能力（擴展參考）

### 視頻端點
```
POST https://api.atlascloud.ai/api/v1/model/generateVideo
GET  https://api.atlascloud.ai/api/v1/model/prediction/{request_id}  ← 輪詢狀態
```

### 主要視頻模型

| 模型 | Model ID | 最長時長 | 解析度 | Atlas 價格 | 特色 |
|---|---|---|---|---|---|
| Veo 3.1 | `google/veo3.1/image-to-video` | 8s | 4K | $0.09/s | 原生音頻，角色一致 |
| Kling v3 Pro | `kuaishou/kling-v3.0-pro/image-to-video` | 15s | 4K 60fps | $0.204/s | 多語言唇形同步 |
| Seedance 2.0 | `alibaba/seedance-2.0/text-to-video` | 15s | 4K | $0.022/s | 最低價，多模態輸入 |
| Wan 2.6 | `alibaba/wan-2.6/image-to-video` | 15s | - | $0.018/s | 含音樂生成，最便宜 |

---

## 六、與現有 LoamLab 渲染流程的整合路線

### 現狀
```
SU Plugin → base64 JPEG → Vercel render.js → Coze Workflow API → SSE 回流 → Plugin
```

### AtlasCloud 落地方式

**方案 A：補強（Coze 失效時 Fallback）**
```
render.js：
  try Coze → 若失敗 → fallback to AtlasCloud Nano Banana 2 Edit
  - images: [sketchup_base64]
  - prompt: 用戶 style prompt
  - resolution: 對應 1K/2K/4K 扣點邏輯不變
```

**方案 B：平行模型選項（用戶可選）**
```
Plugin UI 新增「渲染引擎」下拉：
  - LoamLab AI（Coze）
  - AtlasCloud Fast（Nano Banana 2）
render.js 依參數 engine 路由到不同 API
```

**方案 C：直接替換 Coze**
```
整個 Coze Workflow 以 AtlasCloud Edit 替代
- 輸入：SU 截圖 Base64
- prompt："{user_style}, architectural visualization, photorealistic"
- resolution：依前端傳入 1k/2k/4k
- 回傳：image_url 直接顯示（不再需要 SSE 串流）
```

### 關鍵差異對比

| 項目 | 現有 Coze | AtlasCloud |
|---|---|---|
| 回應方式 | SSE 串流 | 同步 JSON 或輪詢 |
| 扣點時機 | 渲染前扣、失敗退款 | 可不變，API 費用另算 |
| 圖片上傳 | Base64 POST | Base64 或 URL 均可 |
| 失敗退款 | 現有邏輯保留 | 若 API 回 error，觸發現有退款流程 |
| 圖片 Hosting | freeimage.host / ImgBB | AtlasCloud 直接回傳 URL |

---

## 七、後端整合代碼骨架（Node.js）

```javascript
// loamlab_backend/api/atlascloud.js
const ATLASCLOUD_API_KEY = process.env.ATLASCLOUD_API_KEY;
const BASE_URL = 'https://api.atlascloud.ai/api/v1';

async function generateWithNanoBanana2(base64Image, prompt, resolution = '2k') {
  const resolutionMap = { '1K': '1k', '2K': '2k', '4K': '4k' };

  const response = await fetch(`${BASE_URL}/model/generateImage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ATLASCLOUD_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/nano-banana-2/edit',
      images: [`data:image/jpeg;base64,${base64Image}`],
      prompt: prompt,
      resolution: resolutionMap[resolution] || '2k',
      aspect_ratio: '16:9',
      output_format: 'jpeg'
    })
  });

  if (!response.ok) {
    throw new Error(`AtlasCloud API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data.image_url; // 直接返回 URL，不需要 freeimage.host
}

module.exports = { generateWithNanoBanana2 };
```

---

## 八、提示詞工程指引（建築/室內渲染場景）

**針對 SketchUp 場景的推薦 Prompt 結構：**
```
"[風格關鍵詞], architectural visualization, photorealistic rendering,
[光線描述], [材質描述], high quality, professional architectural photo"
```

**範例：**
```
"Modern minimalist interior, architectural visualization, photorealistic rendering,
warm afternoon sunlight through large windows, concrete and wood textures,
high quality, professional architectural photo, 8K detail"
```

**7 層公式（適用圖生圖）：**

| 層級 | 類型 | 範例 |
|---|---|---|
| 1 | 攝像機/鏡頭 | `Wide angle`, `Eye-level shot`, `Isometric view` |
| 2 | 主體 | 建築物、室內空間描述 |
| 3 | 動作/狀態 | `at golden hour`, `under overcast sky` |
| 4 | 環境 | `urban setting`, `forest backdrop` |
| 5 | 光線 | `natural daylight`, `warm artificial lighting` |
| 6 | 風格 | `photorealistic`, `cinematic`, `architectural photography style` |
| 7 | 品質 | `4K`, `highly detailed`, `professional` |

---

## 八-B、遮罩 / Inpainting 能力評估

### Nano Banana 2 是否支援遮罩？

**不支援。** Nano Banana 2（T2I + Edit）均無原生 mask/inpainting 端點。
目前 `inpaint.js` 改用 **Fal.ai** 處理遮罩需求，這是正確的分工。

### 遮罩功能替代方案對比

| 方案 | 平台 | 端點形式 | 遮罩類型 | 費用 | 適合場景 |
|------|------|---------|---------|------|---------|
| **Fal.ai**（現有）| Fal.ai | REST 同步 | 用戶上傳 PNG mask | 按圖計費 | 已整合，穩定 |
| **Vertex AI Imagen 3**| Google Cloud | REST 同步 | 用戶上傳 / 自動前景/背景/語義 | $0.02/張 inpaint | 最高品質 |
| **Gemini 2.5 Flash**| Google AI Studio | generateContent | 無原生 mask，用文字指令 | 免費額度較大 | 粗粒度編輯 |

### Vertex AI Imagen 3 Inpainting（最推薦替換選項）

```
POST https://REGION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/REGION
     /publishers/google/models/imagen-3.0-capability-001:predict
```

**mask 類型（`maskMode`）：**
- `MASK_MODE_USER_PROVIDED`：用戶自畫黑白 mask（黑=保留，白=替換）
- `MASK_MODE_FOREGROUND`：自動偵測前景
- `MASK_MODE_BACKGROUND`：自動偵測背景
- `MASK_MODE_SEMANTIC`：語義分割（可指定「牆」「地板」「沙發」）

**請求範例：**
```json
{
  "instances": [{
    "prompt": "Replace the wall with white marble texture",
    "image": { "bytesBase64Encoded": "<SCENE_BASE64>" },
    "mask": {
      "image": { "bytesBase64Encoded": "<MASK_BASE64>" },
      "maskMode": { "maskType": "MASK_MODE_USER_PROVIDED" },
      "maskDilation": 0.02
    }
  }],
  "parameters": {
    "editMode": "EDIT_MODE_INPAINT_INSERTION",
    "sampleCount": 1,
    "baseSteps": 50
  }
}
```

**回應：**
```json
{
  "predictions": [
    { "bytesBase64Encoded": "<RESULT_BASE64>", "mimeType": "image/png" }
  ]
}
```

**費用：** $0.02/張（inpaint），$0.003/張（upscale）
**認證：** 需 Google Cloud Service Account（非 AI Studio API Key）

---

## 九、注意事項

1. **Base64 格式**：傳入時需加前綴 `data:image/jpeg;base64,...`（或直接用 URL）
2. **回應格式**：非 SSE，為同步 JSON（與現有 Coze SSE 架構不同，若整合需調整 `coze_api.rb`）
3. **環境變數**：需新增 `ATLASCLOUD_API_KEY` 到 `loamlab_backend/.env.local`
4. **定價校準**：AtlasCloud 2K 圖 = $0.108，若替換 Coze 需重新評估點數扣費標準
5. **圖片 hosting**：AtlasCloud 直接回傳 URL，不需再走 freeimage.host / ImgBB 流程

---

## 十、文件來源

- 官方文檔：https://www.atlascloud.ai/docs
- 模型目錄：https://www.atlascloud.ai/models
- 帳戶管理：https://console.atlascloud.ai
- 技術部落格：https://www.atlascloud.ai/blog/guides
