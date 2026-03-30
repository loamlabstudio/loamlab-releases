# Google AI Studio / Gemini API 說明書

> 評估目的：為 LoamLab 後端尋找 Coze Workflow 的替換或補強選項
> 最後更新：2026-03-26

---

## 一、平台架構總覽

Google 圖像 AI 分為**兩條產品線**，使用不同認證系統：

| 產品線 | 入口 | 認證 | 遮罩支援 | 適合場景 |
|--------|------|------|---------|---------|
| **Gemini API（AI Studio）** | `generativelanguage.googleapis.com` | API Key（簡單）| ❌ 無 | 文生圖、對話式編輯 |
| **Vertex AI Imagen** | `aiplatform.googleapis.com` | Service Account（複雜）| ✅ 全功能 | Inpainting、Outpainting、物件移除 |

> **LoamLab 建議分工**：Gemini API 做主力渲染備援，Vertex AI Imagen 做 inpainting（替換現有 Fal.ai）

---

## 二、Gemini API（AI Studio）

### 2-A. 可用圖像生成模型

| 模型 ID | 別名 | 速度 | 特色 |
|---------|------|------|------|
| `gemini-2.5-flash-image` | Nano Banana 2 Flash | 快 | 最佳性價比，大量生產 |
| `gemini-3-pro-image-preview` | Nano Banana Pro | 慢 | 最高品質，複雜場景 |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | 快+思考 | Thinking Mode，可開關 |

### 2-B. 認證

```
X-Goog-Api-Key: {GEMINI_API_KEY}
```
或
```
Authorization: Bearer {GEMINI_API_KEY}
```

API Key 在 [Google AI Studio](https://aistudio.google.com) 免費申請，無需信用卡。

### 2-C. 端點

```
POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent
```

### 2-D. 文字→圖像請求格式

```json
{
  "contents": [{
    "parts": [
      { "text": "Modern minimalist living room, architectural visualization, photorealistic, warm lighting" }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9"
    }
  }
}
```

### 2-E. 圖像→圖像（對話式編輯）

```json
{
  "contents": [{
    "parts": [
      {
        "inlineData": {
          "mimeType": "image/jpeg",
          "data": "<SKETCHUP_BASE64>"
        }
      },
      { "text": "Add warm afternoon sunlight, enhance material textures, make photorealistic" }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

### 2-F. 回應格式

```json
{
  "candidates": [{
    "content": {
      "parts": [
        { "text": "Here is the rendered image..." },
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "<RESULT_BASE64>"
          }
        }
      ]
    }
  }]
}
```

> 注意：輸出固定為 Base64 PNG（含 SynthID 水印），需自行上傳到 freeimage.host / ImgBB

### 2-G. 進階參數

| 參數 | 位置 | 說明 |
|------|------|------|
| `aspectRatio` | `imageConfig` | `"1:1"` `"16:9"` `"9:16"` `"4:3"` `"3:4"` |
| `thinkingLevel` | `thinkingConfig` | `"minimal"` / `"high"`（僅 3.1 Flash）|
| 多參考圖 | `parts[]` 多個 `inlineData` | 最多 14 張 |

### 2-H. 免費額度（2026-03）

| 模型 | 免費 RPM | 免費 RPD | 計費價格 |
|------|---------|---------|---------|
| gemini-2.5-flash-image | ~10 | ~500 | 按 token 計費 |
| gemini-3-pro-image-preview | 限制更嚴 | ~50 | 較貴 |

> AI Studio 免費額度適合開發測試，**生產環境建議開啟計費帳號**。

---

## 三、Vertex AI Imagen 3（Inpainting 專用）

### 3-A. 支援功能

| 功能 | 端點參數 | 說明 |
|------|---------|------|
| 插入物件（Inpaint Insertion） | `EDIT_MODE_INPAINT_INSERTION` | 在 mask 區域加入新物件 |
| 移除物件（Inpaint Removal） | `EDIT_MODE_INPAINT_REMOVAL` | 消除 mask 區域內容 |
| 背景替換 | `MASK_MODE_BACKGROUND` | 自動偵測背景並替換 |
| 前景去除 | `MASK_MODE_FOREGROUND` | 消除前景物件 |
| 語義分割 | `MASK_MODE_SEMANTIC` | 指定類別（牆/地板/天花板）|

### 3-B. 端點

```
POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}
     /locations/{REGION}/publishers/google/models/imagen-3.0-capability-001:predict
```

認證：需 Google Cloud **Service Account JSON Key**（比 AI Studio 複雜）

### 3-C. Inpainting 完整請求

```json
{
  "instances": [{
    "prompt": "White marble wall with subtle veining",
    "image": {
      "bytesBase64Encoded": "<SCENE_BASE64_JPEG>"
    },
    "mask": {
      "image": {
        "bytesBase64Encoded": "<MASK_BASE64_PNG>"
      },
      "maskMode": {
        "maskType": "MASK_MODE_USER_PROVIDED"
      },
      "maskDilation": 0.02
    }
  }],
  "parameters": {
    "editMode": "EDIT_MODE_INPAINT_INSERTION",
    "sampleCount": 1,
    "baseSteps": 50,
    "guidance_scale": 60
  }
}
```

**Mask 格式規則：**
- 黑色（#000000）= 保留原圖
- 白色（#FFFFFF）= 替換此區域
- PNG 格式，尺寸需與原圖一致

### 3-D. 定價

| 功能 | 費用 |
|------|------|
| Inpainting / Outpainting | $0.02 / 張 |
| Image Upscaling | $0.003 / 張 |
| 文生圖（Imagen 3） | $0.04 / 張 |

### 3-E. 認證設置（Node.js）

```bash
npm install @google-cloud/aiplatform
```

```javascript
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

const client = new PredictionServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  // 或使用 credentials 物件傳入 service account JSON
});
```

環境變數：`GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`

---

## 四、與 LoamLab 現有架構的落地方式

### 方案一：Gemini API 作為 Coze Fallback（低改動成本）

```
render.js 現有流程（不變）
    ↓ 若 Coze 失敗
fallback: 呼叫 Gemini API
  - model: gemini-2.5-flash-image
  - input: SU 截圖 Base64 + style prompt
  - output: Base64 PNG → 上傳 freeimage.host → 回傳 URL
```

**代碼骨架（加在 render.js）：**

```javascript
async function fallbackToGemini(base64Image, prompt) {
  const API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: `${prompt}, architectural visualization, photorealistic` }
        ]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' }
      }
    })
  });

  const data = await response.json();
  const imgPart = data.candidates[0].content.parts.find(p => p.inlineData);
  return imgPart.inlineData.data; // Base64 PNG
}
```

### 方案二：Vertex AI Imagen 替換 Fal.ai Inpainting

```
inpaint.js 現有流程（Fal.ai）
    ↓ 替換為
Vertex AI Imagen 3 EDIT_MODE_INPAINT_INSERTION
  - baseImage: rendered_image Base64
  - maskImage: 用戶繪製的 mask PNG Base64
  - prompt: "用戶描述想要的材質/物件"
  - 費用：$0.02/張（比 Fal.ai 更穩定）
```

### 方案三：分工組合（推薦）

| 功能 | 現有方案 | 建議替換 |
|------|---------|---------|
| 主力 T2I 渲染 | Coze（Nano Banana 2）| 不變，Gemini 作 fallback |
| Inpainting | Fal.ai | 評估替換為 Vertex AI Imagen 3 |
| 超高解析度 | 無 | Vertex AI Imagen Upscale $0.003/張 |

---

## 五、環境變數清單（新增項）

| 變數 | 用途 | 備註 |
|------|------|------|
| `GEMINI_API_KEY` | Gemini API 認證 | AI Studio 免費申請 |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI 認證 | Service Account JSON 路徑 |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI 專案 ID | GCP 控制台取得 |
| `VERTEX_AI_REGION` | Vertex AI 區域 | 建議 `us-central1` |

加入 `loamlab_backend/.env.local`。

---

## 六、遮罩功能決策建議

```
用戶想「局部修改渲染圖的某個區域」？
    ↓
是否需要精確 pixel-level 遮罩？
  ├── 是 → Vertex AI Imagen 3 inpaint（$0.02/張，最精確）
  └── 否 → Gemini API + 文字指令（免費額度，適合模糊描述）

用戶想「整張風格重繪」？
  └── Nano Banana 2 Edit（現有 Coze 流程，保持不變）
```

---

## 七、參考文件

- [Gemini API Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Vertex AI Imagen Inpainting](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-insert-objects)
- [Vertex AI Remove Objects](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-remove-objects)
- [Firebase AI Logic Image Editing Overview](https://firebase.google.com/docs/ai-logic/edit-images-imagen-overview)
- [Gemini Models List](https://ai.google.dev/gemini-api/docs/models)
