# LoamLab Suite: Beta 迭代技術實作計畫

本計畫旨在為 **[Roadmap 2.3](file:///c:/Users/qingwen/.gemini/antigravity/workspaces/%E5%9C%9F%E7%AA%9F%E8%A8%AD%E8%A8%88su%E6%B8%B2%E6%9F%93%E6%8F%92%E4%BB%B6/roadmap.md)** 中定義的工具提供具體、可執行的技術架構。

---

## 🎨 工具 2：局部家具換裝 (AI Furniture Stylist)
### 技術架構：SAM + In-painting 局部重繪
1.  **前端 (UI)**:
    *   在渲染結果圖上整合 `Pointer Events`。
    *   用戶點擊區域時，記錄座標並傳送至後端。
2.  **後端 (Vercel/Coze)**:
    *   **Coze 工作流**: 接收 `image_url` 與 `click_coordinates`。
    *   **處理節點**: 調用 SAM (Segment Anything) 識別點擊部位並生成 Mask。
    *   **重繪節點**: 使用 In-painting 模型，結合空間風格提示詞，生成 5 組家具變體。
3.  **插件 (SketchUp)**:
    *   提供一個 `loamlab_proxies.rbz` 的極簡盒組，包含沙發、燈具、桌子的代理方塊 (Bounding Box)。

---

## 📸 工具 3：多角度/張力鏡頭 (9-Square Grid)
### 技術架構：Coze 二次加工工作流
1.  **觸發邏輯**:
    *   當工具 1 (真實渲染) 完成後，UI 提供一個「生動化 (Dramatic Shots)」按鈕。
2.  **Coze 工作流佈署**:
    *   **輸入**: 工具 1 的 1k 結果圖。
    *   **平行處理**: 啟動 9 個平行分支，分別注入不同的鏡頭 Prompt：
        *   `Wide Angle, Interior Photography`
        *   `Close-up, 85mm, Bokeh`
        *   `High Angle Section, Minimalist` ...等。
3.  **UI 呈現**:
    *   開發一個全新的 `Grid-View` 模組，展示這 9 張具有電影張力的分鏡圖。

---

## 📦 工具 4：AI 全能素材管家 (Asset Hub)
### 技術架構：Supabase Storage + AI Tiling API
1.  **素材庫管理**:
    *   在 Supabase 建立 `loam_assets` 資料表，紀錄模型載入路徑與材質屬性。
    *   前端 `aside` 側邊欄展開為 `Asset Browser` 面板。
2.  **AI 材質提取流程**:
    *   **上傳**: 用戶框選圖片區域並上傳至 `/api/extract-material`。
    *   **處理**: 後端調用 AI 瓦片生成模型（如 Stability AI Edit Endpoints），將局部圖案攤平成「無接縫貼圖 (Seamless Texture)」。
    *   **回傳**: 自動在 SketchUp 下載該貼圖，並執行 `model.materials.add` 建立對應材質。

---

## 💰 LemonSqueezy 授權自動化 (License Flow)
### 技術架構：Webhook 同步與免序號驗證
1.  **Webhook 數據對齊**:
    *   後端 `/api/webhook.js` 需解析 `payload.data.attributes.user_email` 與 `payload.data.attributes.license_key`。
    *   在 Supabase 建立 `is_premium` 與 `license_status` 欄位進行即時標記。
2.  **免序號驗證 (Seamless Onboarding)**:
    *   插件端在用戶登入時，後端 `/api/user` 根據 Email 直接查詢資料庫中的 `is_premium` 狀態。
    *   **優勢**：用戶無需在 SU 內手動複製剪貼繁瑣的序號，付費後登入即用。

---

## ⚙️ 系統安全性與效能 (Infrastructure)
1.  **CDN 加速**: 針對 Vercel 產出的圖片進行 Edge Caching，減少 UI 頻繁拉取大圖的延遲。
2.  **負載均衡**: 由於九宮格涉及 9 次 API 調用，採用 **非同步佇列回傳**。UI 先顯示 9 個 Loading 占位符，完成一個顯示一個，避免用戶長時間等待。
