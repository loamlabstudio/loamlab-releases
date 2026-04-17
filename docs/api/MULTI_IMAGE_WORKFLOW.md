# 雙圖輸入 (風格遷移) 核心工作流模板

> **用途**：作為未來在 Coze、ComfyUI 或自行封裝 API 的標準「雙圖融合」處理邏輯藍圖。
> **核心技術**：**ControlNet (管控空間幾何)** + **IP-Adapter (提取並轉移風格)**

---

## 一、基礎工作流架構 (The Pipeline)

無論底層是部署於自建 GPU 還是透過 Coze 組合 Plugin，要實現「以圖一的結構套用圖二風格」的完美效果，必須拆分以下四個核心節點：

### 節點 1：大腦輸入端 (Input Node)
- **Image A (Base Structure)**: SketchUp 的截圖/白模。
- **Image B (Style Reference)**: 目標風格的照片 (如真實世界的高級客廳)。
- **Prompt**: (可選/補充) 例："A modern living room, highly detailed, photorealistic."

### 節點 2：結構約束 (ControlNet Layer)
- **輸入**: Image A
- **處理器 (Preprocessor)**: 
  - 建議使用 `Canny` (邊緣檢測) 或 `Depth` (深度圖)。對於室內設計，`MLSD` (直線檢測) 效果最佳。
- **作用**: 提取 SU 截圖的 3D 空間與家具輪廓，確保生成的圖片**不會改變家具位置與透視**。

### 節點 3：風格提取 (IP-Adapter Layer)
- **輸入**: Image B
- **處理器**: `CLIP Vision` 模型。
- **作用**: 讀取參考圖的「色彩、光影氛圍、材質紋理 (如布料或木紋)」，並將這個**視覺特徵轉化為 Token** 餵給主模型，**而不受限於文字 Prompt 的匱乏**。

### 節點 4：融合生成 (Generation Node / KSampler)
- **輸入**: 主模型 (如 Flux 或 FLUX-dev) + 來自 ControlNet 的空間約束 + 來自 IP-Adapter 的風格特徵 + 補充文字 Prompt。
- **輸出 (Output)**: 最終渲染圖。

---

## 二、在 Coze 中的實踐策略

目前 Coze 的原生「文字生圖」節點多半是單向的。要在 Coze 中還原上述流程，有兩種典型建構方式：

### 方案 A：使用高級出圖外掛 (Plugins)
尋找 Coze 內建支援「Image Prompt」與「ControlNet / Edge Detection」的強力 Plugin (如一些社群開發的 SDXL 或 Leonardo 插件)。
- **工作流排線**：
  1. `Start` 節點接收 `image_url` 與 `style_url`。
  2. 將這兩個 URL 分別 Map 到外掛的 `init_image` (或 `controlnet_image`) 以及 `image_prompt` (或 `ip_adapter_image`) 欄位。
  3. 輸出回傳 `result_url`。

### 方案 B：寫腳本呼叫自有 API (如 AtlasCloud)
若 Coze 內沒有完美的插件，可以在 Coze 內部放一個 `Code Node` (Node.js/Python 腳本)，負責把兩張圖打包成 AtlasCloud 的 JSON 格式並使用 `fetch` 呼叫。

```javascript
// Coze 腳本節點範例
async function main(args) {
    const base_image = args.input.base_image;
    const style_image = args.input.style_image;
    
    // 將兩張圖打包成 API 要求的陣列格式（根據 AtlasCloud 規範）
    const payload = {
        model: "google/nano-banana-2/edit",
        images: [base_image, style_image], // [0] 是主結構, [1] 是風格參考
        prompt: args.input.prompt + ", strictly follow the lighting and material style of the second image."
    };
    
    // ... 呼叫 API ...
    return { output_url: result_url };
}
```

---

## 三、關鍵參數調優 (Tuning Guide)

若未來自行微調這個工作流的參數，請遵守以下黃金法則：

1. **結構權重 (ControlNet Weight)**: `0.75 - 0.9` 
   - 設太低：沙發位置會跑掉。
   - 設太高 (1.0)：圖片會顯得太像 CG，失去真實感。
2. **風格權重 (IP-Adapter Weight)**: `0.5 - 0.7`
   - 設太高：會把參考圖裡的「具體物件（例如一個人）」也硬生生印到你的場景裡（變成風格污染）。我們只要它的氛圍，不要它的實體。
3. **降噪強度 (Denoising Strength)**: `0.8 - 0.9` (在 Image-to-Image 中)
   - 必須夠高，AI 才有空間重新繪製逼真的材質；但有 ControlNet 鎖住輪廓，所以不會變形。
