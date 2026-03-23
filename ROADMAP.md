# LoamLab 素材庫與材質替換系統 Roadmap (商業增長導向)

> **核心理念 (第一性原理)**：
> 設計師痛點在於「反覆修改與渲染造成的時間浪費與溝通成本」。素材庫與材質替換 (SWAP) 的本質是**透過局部 AI 運算 (Inpainting)，以最低的互動成本實現所見即所得的材質迭代**。
> 
> **利潤最大化公式**：
> `長期利潤 = (活躍用戶黏性 × 高頻替換操作消耗) + 付費訂閱轉化 - AI API 成本`
> 要實現利潤最大化，必須讓「存材質 → 框選替換 → 無縫預覽」的閉環體驗極致順滑，並透過個人資產累積（雲端素材庫）與網絡效應（社群分享）鎖定用戶。

---

## Phase 1: 基礎體驗流暢化 (減少流失，提高轉換率)
**目標**：修補現有 MVP 的體驗斷點，確保用戶第一次使用就驚豔，願意持續消耗點數。

- **[x] 補全互動斷點 (F1)**
  - ✅ 快速標籤 (`swap-item-tag`) onclick 已實作（`app.js` L833-841），點擊後附加 `data-tag` 到 prompt。
  - ~~F2 參考圖 (`swap-reference-url`)~~：Fal.ai flux-pro/v1/fill API 無 reference_image 參數，**暫緩後端整合**；UI 輸入框保留作視覺參考用途。
- **[x] 素材庫管理功能 (F3)**
  - ✅ 已實作素材庫單筆刪除：hover 縮圖右上角出現 × 按鈕，點擊立即從 localStorage 移除並刷新網格。
- **[x] 前端效能與除錯**
  - ✅ 筆刷效能修復：mousemove/touchmove 每次 stroke() 後加 beginPath()+moveTo()，從 O(n²) 路徑累積降為 O(1) 單段繪製。
  - ✅ CORS fallback 已實作（`confirmExtract` img.onerror → 64×64 灰色佔位縮圖帶材質名稱）。

## Phase 2: 資產雲端化與價值鎖定 (提高留存與 LTV)
**目標**：將儲存從 LocalStorage 轉向雲端，讓用戶在不同裝置（或重新安裝 SketchUp）間不會丟失心血，增加轉換至付費帳號的誘因。

- **[x] 雲端帳戶同步 (F4)**
  - ✅ 新建 `loamlab_backend/api/materials.js`（GET/POST/DELETE），Supabase `user_materials` 表。
  - ✅ `saveMaterial` / `deleteMaterial` fire-and-forget 同步至雲端；`openSwapModal` 開啟時背景拉取雲端資料更新本地 localStorage。
- **[x] 階梯式素材庫擴容 (商業化)**
  - ✅ 前端 `saveMaterial` 依 `window.loamlabSubscriptionPlan` 決定上限（pro/studio: 200，其他: 20）。
  - ✅ 後端 `materials.js` 同步強制執行上限（FIFO 自動移除最舊筆）。
- **[x] Prompt 增強與翻譯**
  - ✅ `translateMaterialPrompt()` 前端詞庫（30 組中→英），`executeSwap` 送出前自動轉換，無需外部 API。

## Phase 3: 工作流突破與進階能力 (拉高競爭壁壘)
**目標**：引入更強大的 AI 繪圖控制，確保局部替換不會破壞透視與光影。

- **[x] 結果卡片迭代閉環**
  - ✅ inpaint result card 補全 SAVE / SWAP / EXTRACT 三個按鈕，用戶可在替換結果上繼續 SWAP 或提取新材質，形成無限迭代循環。
  - ✅ 呼叫 appendInpaintResultCard 時傳入正確 prompt label（在 closeSwapModal 前讀取）。
- **[ ] 引入架構/深度約束 (Depth / Canny)**
  - 需 SketchUp 匯出 depth map，技術複雜度高，暫緩。
- **[ ] 自動遮罩 (Auto-Masking) - Segment Anything (SAM)**
  - 需驗證 Fal.ai SAM2 API 格式與成本後實作，暫緩。
- **[ ] 材質批次應用**
  - 儲存「材質組合（Material Palette）」，一鍵套用全套材質搭配，暫緩。

## Phase 4: 素材生態系與裂變 (網絡效應)
**目標**：突破單機工具限制，建立去中心化的創作者生態，實現病毒式增長與雙邊平台收益。

- **[ ] 公共素材市場 (Public Asset Library)**
  - 允許設計師將自己提取/調放好的「高品質材質 + 專屬 Prompt」發佈到公共大廳。
  - 別人套用時，原作者可獲得微量點數回饋（Tokenomics）。
- **[ ] 裂變分享 2.0 (與素材綁定)**
  - 不只分享渲染成品圖，而是分享「我的專屬空間配置＋材質包」，點擊 LINE/WA 連結的人進入網頁版可直接預覽，必須註冊並下載插件才能套用。
- **[ ] 品牌材質贊助 (B2B 變現)**
  - 引進真實建材商/傢俱商的材質入庫，作為置頂推薦材質，開拓除了 API 差價之外的廣告/上架抽成營收。

---

*撰寫時間：2026-03-23*
*定位：此文件覆蓋工具 4（素材庫/SWAP 功能）Phase 1-4 的技術計劃。全產品路線圖見 PRODUCT_PLAN.md。*
