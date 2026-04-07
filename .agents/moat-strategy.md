# LoamLab 護城河策略文檔

*作者：工程策略 AI（Claude Sonnet 4.6）*
*日期：2026-04-03*
*交接對象：策略 AI / 產品 AI / 行銷 AI*

---

## 背景與問題定義

LoamLab 是一款 SketchUp AI 渲染插件，核心流程是：
**SketchUp 截圖 → Vercel 後端 → Coze/Fal.ai API → 回傳圖片**

這個流程本質上**可以被複製**。一個 1-2 人的小團隊，觀察介面後 1-2 個月可以做出功能相似的競品。

因此，我們需要建立競品**難以快速複製**的護城河，讓用戶在 LoamLab 上沉澱越來越多，讓遷移成本越來越高。

---

## 當前競爭優勢盤點（誠實評估）

### 真正的壁壘（競品需要數月才能追上）

**1. Coze Workflow 提示詞工程**
- LoamLab 維護 4 條獨立 Coze Workflow（真實渲染、SpaceReform、九宮格、SmartCanvas）
- 每條 workflow 都有精心調校的提示詞模板、參數結構、多模型協調邏輯
- 這是 **看不見也複製不了的 IP**，外人只能看到輸入/輸出，無法知道中間怎麼做到的
- 調好一條 workflow 需要大量試錯，積累的是隱性知識

**2. SketchUp 深度整合（Ruby API 專業壁壘）**
- 邊線動態控制（DrawEdges / DrawSilhouettes / DrawDepthQue）：渲染時自動關閉技術邊線，渲染後還原
- 多場景批次遍歷、場景 Attribute 讀寫
- SmartCanvas：雙層繪圖（遮罩通道 + 參考圖通道）、SAM 魔術棒、Undo/Redo 棧
- 材質寫回（開發中）：AI 生成材質 → 寫回 SketchUp 材質庫並套用到選中的面
- 這些功能需要同時懂 **SketchUp Ruby API + AI 工作流 + UX**，人才稀缺

### 中等壁壘（有效但競品也能做）

**3. 用戶沉澱資產（已開始實作）**
- 個人風格預設庫：用戶儲存自己調好的 prompt/style/resolution 組合，命名為「我的北歐極簡」
- 渲染歷史記錄：可回溯翻找過去所有算圖，帶設定記錄
- **效果**：用戶積累 10+ 個預設後，遷移到競品等於從零開始，有真實切換成本

### 誤區：需要澄清的假設

**「收集評分 → 訓練私有模型」的飛輪構想**
- **目前不成立**：LoamLab 調用的是第三方 API（Coze / Fal.ai），不擁有底層模型
- 收集的評分數據無法直接用於訓練
- **正確定位**：評分是純 UX 功能（用戶標記好圖方便查找），不是飛輪
- **未來條件**：如果切換到支援 fine-tune 的平台（如 Replicate 自部署 LoRA），評分數據才有飛輪意義

---

## 已實作的護城河功能（2026-04-03）

### 後端（已完成，待部署到 Supabase + Vercel）

**新增兩張 Supabase 資料表：**

```
user_presets
├── user_email (FK → users)
├── name          "我的北歐極簡"
├── prompt        提示詞
├── style         風格
├── resolution    解析度
└── tool_id       哪個工具

render_history
├── user_email (FK → users)
├── full_url      圖片 URL
├── prompt / style / resolution / tool_id
├── points_cost   花費點數
├── user_rating   評分（預留欄位，目前為 UX 用）
└── is_approved   用戶標記「這張很好」
```

**`user.js` 新增 API endpoints（action 參數模式）：**
- `GET ?action=presets` — 取得預設列表
- `GET ?action=history` — 取得渲染歷史（分頁）
- `POST {action:'save_preset'}` — 儲存預設
- `POST {action:'delete_preset'}` — 刪除預設
- `POST {action:'rate_history'}` — 評分

**`render.js` 自動寫入歷史：**
- 每次渲染成功，fire-and-forget 寫一筆 `render_history`（不影響回應速度）

### 尚未實作（優先順序排列）

| 優先 | 功能 | 說明 |
|------|------|------|
| P1 | 前端風格庫 UI | 儲存預設按鈕 + 下拉選單 |
| P1 | 前端歷史頁籤 | 縮圖 grid + 懶加載 |
| P3 | 場景快照記憶 | `model.set_attribute` 記住每個場景上次的 prompt/style |
| P2 | AI 材質寫回 | AI 生成材質 → 寫回 SketchUp 模型 |

---

## 策略 AI 接手的方向建議

以下是需要更深度策略思考的問題，建議接手的 AI 聚焦：

### 問題一：切換成本如何最大化？

風格預設庫和歷史記錄是好的開始，但「用戶資產」還可以更深。
- 用戶能不能匯出自己的預設庫？（如果不能匯出，就鎖定在平台內）
- 渲染歷史能不能和 SketchUp 專案文件綁定？（開啟同一個 `.skp` 就能看到這個模型的歷史渲染）
- 能不能做「版本比較」？（A/B 對比兩張渲染，讓用戶標記哪個給客戶看）

### 問題二：分發壁壘如何建立？

目前用戶需要手動安裝 `.rbz`，未上 Trimble Extension Warehouse。
- Extension Warehouse 上架：搜尋「SketchUp AI render」的用戶直接找到，競品要追上需要同樣通過審核
- 設計學校合作：免費版給學生 → 習慣了 LoamLab 工作流 → 出來工作還用同一個工具
- 設計師社群曝光（小紅書、PTT 設計版、台灣室設公會）

### 問題三：Workflow IP 如何保護？

Coze Workflow ID 是最核心的 IP，但目前：
- Workflow ID 有硬編碼 fallback 在原始碼中（需要改為全部由環境變數管理）
- 如果有人能看到 API 請求內容，可以部分推測 workflow 結構

建議：
- 所有 Workflow ID 移到 Vercel 環境變數，不在程式碼中出現
- 考慮加一層後端參數混淆，讓 API 請求不直接暴露 workflow 結構

### 問題四：定價護城河

目前點數制有「訂閱點數當月重置」機制，對重度用戶（設計師）有一定鎖定效果。
- 年付方案是否合理？（設計師如果年付，遷移時損失更大）
- Team 方案：小工作室共享點數池 → 工作室整體切換成本更高，不是一個人決定

---

## 總結：護城河優先矩陣

| 護城河類型 | 實際強度 | 實作難度 | 優先做 |
|-----------|---------|---------|--------|
| Coze Workflow IP | ⭐⭐⭐⭐⭐ | 已有，需保護 | 立即：Workflow ID 全部環境變數化 |
| SketchUp 深度整合 | ⭐⭐⭐⭐⭐ | 高（Ruby 專業） | 持續：材質寫回、場景快照 |
| 用戶沉澱資產 | ⭐⭐⭐⭐ | 中（已做後端） | 本週：前端 UI |
| 分發壁壘 | ⭐⭐ | 中 | 下月：Extension Warehouse |
| 定價鎖定 | ⭐⭐⭐ | 低 | 下季：年付 / Team 方案 |
| 數據飛輪 | ⭐（目前） | 高 | 長期：需切換到可 fine-tune 平台 |
