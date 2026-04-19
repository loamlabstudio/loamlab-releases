# LoamLab Suite：產品計畫 (PRODUCT_PLAN.md)
> 版本：v2.6 | 狀態圖例：🟢 完成 ⚡ 進行中 📋 待辦 ⚠️ 已知風險

---

## ⚡ NEXT UP（快速參考）

| 優先級 | 任務 | 理由 | 對應章節 |
|--------|------|------|----------|
| P1 | 工具 3（九宮格鏡頭） | 核心 Wow Effect 功能 | §5 |
| P2 | 工具 2（局部家具換裝） | In-painting 核心功能完善 | §4 |
| P3 | 工具 4（素材管家） | 解決設計師素材管理痛點、修復材質寫回問題 | §6 |

---

## 1. 🟢 已完成基礎建設

- Vercel + Supabase + Coze 渲染鏈路全線貫通
- **工具 1（真實渲染）**：批次導出、非同步渲染、渲染後自動備份
- 穩定性修復：SketchUp 渲染死機、ESM/CJS 模組衝突、Base64 百萬字元傳輸優化
- 公測計畫定稿：30% 折扣碼 `LOAM_BETA_30`、LemonSqueezy 交付流程

---

## 1b. 工具閉環關係圖（Tool Loop）

> 工具 2 & 3 以工具 1 的輸出圖為輸入，須在工具 1 完成後才可觸發。工具 4 獨立運作。

```
  工具 1（基礎渲染）🟢
    IN:  SU 場景截圖 + 材質/風格 Prompt
   OUT:  1K / 2K / 4K 渲染結果圖
          │
          ├──► 工具 2（局部換裝）📋
          │      IN:  工具 1 結果圖 + 點擊座標（相對比例 x_ratio/y_ratio）
          │     OUT:  5 組局部換裝變體（SAM Mask → In-painting）
          │
          └──► 工具 3（九宮格鏡頭）📋
                 IN:  工具 1 結果圖（1K）+ Shot Style
                OUT:  單張九宮格合圖（3×3，9 個視角，一次 Coze 呼叫）

  工具 4（AI 素材管家）📋  ← 獨立，不依賴工具順序
    IN:  任意圖片區域（用戶框選）
   OUT:  Seamless Texture → 直接寫入 SU 材質庫（修復 §2c）
```

---

## 2. ⚠️ 全局技術限制

> 這些限制橫跨多個工具。各工具章節內標有受影響點。解決後請同步更新此處與對應章節的狀態標記。

### §2a — Vercel 4.5MB Payload 上限
- **影響**：工具 1（4K 截圖）、工具 2（In-painting 回傳）
- **短期方案**：`main.rb` 導出時依解析度調整 JPEG 壓縮率（4K 從 0.6 降至 0.4）
- **長期方案 📋**：插件端直接呼叫 S3/OSS Presigned URL 上傳圖片；後端 `render.js` 僅接收 URL

### §2b — Coze Workflow ID 環境化
- **現狀**：`WORKFLOW_ID` 存在程式碼 Fallback，公測產線切換存在風險
- **行動 📋**：統一由 Vercel Env 管理，移除 code-level fallback

### §2c — 材質屬性寫回 SU
- **現狀**：AI 算圖結果無法寫回 SketchUp 材質屬性
- **行動**：列入工具 4 重點攻關（見 §6）

---

## 3. ⚡ 社群聯名與裂變系統（Social & Referral System）— 接續 SPRINT 開發

**策略目標**：透過替設計師解決「高質量 IG 貼文產出與跨裝置發布」的痛點，換取 LoamLab 的無摩擦大量曝光，達成雙向獎勵裂變。

| 角色 | 觸發條件 | 獎勵 |
|------|----------|------|
| 邀請人/設計師 A | 被邀請的新用戶完成首次正式算圖後 | +50 點 |
| 受邀人/新戶 B | 點擊社群/QR短網址自動綁定，並完成首次正式算圖後 | +50 點 (防刷機制) |
| 設計師 A | (主動攔截) 當點數不足時，主動使用整合工具將高畫質與分享至 IG | +100 點 (解救餘額鼓勵) |

> ⚠️ **優化注意**：
> 1. **首渲防刷**：受邀獎勵必須在「首次算圖且扣點成功」後，由後端 RPC 單一 Transaction 發送，防範「創號即領點」的濫用行為。
> 2. **轉換率突破**：前端算圖結果需提供「QR Code 接力手機發佈」與「自帶熱門 Hashtag 的預設專業 IG 排版」，將我們的分享流包裝成設計師的「社群發布神器」。

### DB（Supabase）
- `users` 表已有 `referred_by` (email)、`referral_code`、`referral_rewarded` 欄位
- SQL RPC `increment_points(row_id, amount)` 確保原子性（Atomicity）

### 後端 `/api/referral`
- **防刷驗證**：檢查 `referred_by` 必須為空（代表未使用過邀請碼）
- **無效碼驗證**：邀請碼存在且不為受邀者本人
- **獎勵發放**：Transaction 邏輯，同時更新兩側點數，寫入 `transactions` 日誌

### 前端（`app.js`）
- 頂部導航新增「🎟️ Invite」按鈕
- 彈窗提供「我的邀請碼」與「輸入邀請碼」雙模式
- 兌換成功後呼叫 `fetchUserPoints` 刷新 UI 點數顯示

---

## 4. 📋 工具 2：局部家具換裝（AI Furniture Stylist）

**策略目標**：SAM 模型自動 Mask 識別 + In-painting 局部重繪，生成 5 組家具變體。

> ⚠️ 受技術限制 §2a 影響：需確認 In-painting 結果圖尺寸在 Payload 上限內。

### 前端（UI）
- 在渲染結果圖整合 `Pointer Events`
- 用戶點擊區域時，記錄座標並傳送至後端
- **座標格式**：統一使用相對比例 `{ x_ratio: 0.45, y_ratio: 0.62 }`，避免不同解析度下失準

### 後端（Coze Workflow）
- **輸入**：`image_url` + `click_coordinates`（相對比例格式）
- **SAM 節點**：識別點擊部位，生成 Mask
- **In-painting 節點**：結合空間風格提示詞，生成 5 組家具變體

### 插件（SketchUp）
- 提供 `loamlab_proxies.rbz` 極簡代理盒組（沙發、燈具、桌子 Bounding Box）

---

## 5. 📋 工具 3：多角度張力鏡頭（AI Dramatic Shots / 九宮格）

**策略目標**：工具 1 完成後一鍵生成電影感九宮格構圖大圖，提升產品 Wow Effect。

> ⚠️ 受技術限制 §2a 影響：輸入圖固定使用工具 1 的 1K 渲染結果，避免 Payload 超限。

### 觸發流程
- 用戶在 sidebar 切換至工具 3，選擇 Shot Style 後按下渲染按鈕
- **Shot Style 四選項**（`app.js` `selectedShotStyle`）：`dramatic` / `industrial` / `natural` / `minimal`

### Coze Workflow
- **單次呼叫**：接收工具 1 的圖片 URL + Shot Style 風格 Prompt
- **輸出**：一張包含 9 個不同鏡頭角度的九宮格合圖（3×3 大圖）
- 成本：與工具 1 的 1K 渲染相同，單次扣點

### 前端（`app.js`）
- `showNineGridPlaceholder()`：渲染開始時顯示九宮格骨架 Loading 狀態
- 圖片回傳後替換骨架，顯示完整合圖
- Shot Style 選擇器（`shotStyleSelector`）僅在工具 3 激活時顯示

---

## 6. 📋 工具 4：AI 全能素材管家（Asset Hub）

**策略目標**：解決設計師長期管理素材的痛點，同時修復 §2c（材質屬性無法寫回 SU）。

### 素材庫管理
- Supabase 建立 `loam_assets` 資料表：模型載入路徑 + 材質屬性
- 前端 `aside` 側邊欄擴展為 `Asset Browser` 面板

### AI 材質提取流程（`/api/extract-material`）
- **上傳**：用戶框選圖片區域上傳至端點
- **處理**：後端調用瓦片生成模型（Stability AI Edit Endpoints），將局部圖案生成「無接縫貼圖 (Seamless Texture)」
- **回傳**：自動在 SketchUp 下載貼圖，執行 `model.materials.add` 建立對應材質（修復 §2c）

---

## 7. 📋 LemonSqueezy 授權自動化

**策略目標**：付費後登入即用，用戶無需手動複製貼上序號。

### Webhook（`/api/webhook.js`）
- 解析 `payload.data.attributes.user_email` 與 `license_key`
- Supabase `users` 表新增 `is_premium` 與 `license_status` 欄位

### 插件端（免序號驗證）
- 用戶登入時，後端 `/api/user` 依 Email 查詢 `is_premium` 狀態，即時授權
- **優勢**：用戶無需在 SU 內手動操作序號，付費後直接登入使用

---

## 8. 系統效能備忘

- **CDN 加速**：Vercel Edge Caching 針對渲染結果圖，減少 UI 拉取大圖的延遲
- **`fix_anomalies.js` 技術債**：目前存在 CJS/ESM 混用 Bug（`require()` + `export default`）。建議在工具 4 開發前先做孤立的 CommonJS 化重構，避免新增 DB 欄位後維護成本持續累積
