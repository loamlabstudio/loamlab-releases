# LoamLab 全局架構與商業化躍升 Roadmap (V2)

基於項目全代碼盤點（前端 Vanilla JS 巨石架構、Vercel Serverless 後端、SketchUp Ruby 橋接）與最新分享機制重設，本路線圖從**第一性原理**與**長期利潤最大化**出發，重新評估並規劃了具備高度落地性的優化方案。

---

## 🎯 第一性原理與戰略錨點

> **本質問題**：用戶為什麼要用這個外掛？
> **答案**：為了在 SketchUp 建模時，能**以最低摩擦力、最快速度獲得「可向客戶提案」的視覺成果**。

> **利潤最大化方程式**：
> `長期收益 = (無摩擦體驗帶來的超高使用頻率 × 每次渲染/修改成本) + (專案資產雲端化帶來的離帳壁壘) + (分享機制帶來的病毒性增長)`

現狀痛點：
1. **代碼負債**：前端邏輯全擠在 `app.js` (>2100行) 與 `index.html` (>900行)，擴充新工具（如九宮格、材質替換）時極易產生耦合與 Bug。狀態管理依賴全域變數 (`window.xxx`)。
2. **UI 審美**：目前的深色 Glassmorphism + 掃描線動畫已有基礎科技感，但缺乏現代化組件系統的「呼吸感」與「彈性佈局」，畫面死角較多。
3. **商業護城河淺**：目前仍偏向「按次計費的工具」，尚未形成「設計師專屬的雲端資產工作流」。

---

## 🗺️ 落地優化路線圖 (Phases)

### Phase 1: 視覺審美與轉換率極致優化 (Quick Wins)
**目標**：不改變底層架構，靠純 UI/UX 升級來降低用戶跳出率，提升「Wow Moment」與付費意願。

- **[ ] 現代化懸浮佈局 (Floating UI)**：
  - 打破目前生硬的「左大右小」固定切割。將工具列 (Sidebar) 與控制器 (Right Panel) 改為**毛玻璃懸浮視窗**，讓 SketchUp 的渲染預覽圖能 100% 滿版填滿背景，沉浸感倍增。
- **[ ] 微動效 (Micro-interactions) 升級**：
  - 優化「渲染中」的視覺等待體驗。用高品質的骨架屏 (Skeleton) 與平滑的 Blur-to-Clear (從模糊漸變至清晰) 動畫取代現有的掃描線，營造像 Apple 產品般的流暢感。
- **[ ] 價格牆 (Paywall) 心理學優化**：
  - 在 `pricing-modal` 中加入更明顯的「用戶見證」或「算圖前後對比」微縮圖，將「點數消耗」轉化為「獲得質感提案的投資」。

### Phase 2: 前端架構現代化重構 (技術基建)
**目標**：徹底解決 `app.js` 的維護災難，為未來的多模態 AI 工具打下可擴展基礎。

- **[ ] 遷移至 Vue 3 / React (Vite)**：
  - 將 Vanilla JS 重構為組件化框架。目前的 UI 很適合分為 `<ToolSidebar>`, `<PreviewGrid>`, `<RenderController>`, `<AssetModal>` 等獨立組件。
  - 編譯後依然是一包靜態資源 (`dist`)，無痛嵌入 SketchUp `UI::HtmlDialog`。
- **[ ] 引入全局狀態管理 (Pinia / Zustand)**：
  - 將散落的 `window.loamlabUserEmail`、點數餘額、當前場景清單、選取狀態統一管理。解決不同函數間資料不同步、重複 Fetch 點數等隱患。
- **[ ] i18n 多語系模組化**：
  - 棄用龐大的全域 `UI_LANG` 物件，改用標準的 `vue-i18n` 或 `i18next` 進行靜態按需加載。

### Phase 3: 後端健壯性與安全性強化 (利潤守護)
**目標**：確保 API 扣款精準不漏，防範惡意刷點，並提升響應速度。

- **[ ] 交易一致性 (Transaction Safety)**：
  - 目前 Serverless 在高併發 (同時按多張圖) 時可能有 Race Condition。需在 Supabase 端實作 RPC (Stored Procedure) 來進行原子性扣款 (Atomic deduction)，避免點數超扣或漏扣。
- **[ ] 基礎設施即代碼 (IaC) & ORM**：
  - 後端引入 Prisma 或 Drizzle ORM，透過 Schema 定義 Users、Transactions、Referrals 表，取代直接寫死資料庫欄位名稱的作法，提升未來遷移與報表分析能力。

### Phase 4: 工作流雲端化與生態網路 (終極護城河)
**目標**：從「渲染外掛」轉型為「設計師的 AI 提案管理平台」。

- **[ ] 雲端相簿與分享頁面 (Web Gallery)**：
  - 突破只存本地的限制。渲染完成後，自動將 4K 成品加上 Floating Watermark 存入 Supabase Storage。
  - 設計師可以直接生成一條 `loamlab.com/p/xxx` 的極簡高質感展示連結傳給業主。
- **[ ] 素材與提示詞共創市場**：
  - 接續之前的計畫，允許用戶將自己微調好的 inpaint 遮罩材質、場景 Prompt 參數封裝成「預設風格卡」發佈。
- **[ ] 病毒式增長整合**：
  - 當業主打開上述的 Web Gallery 連結時，頁面底部溫和附帶「Created with LoamLab AI - Download Plugin (附帶原設計師邀請碼)」，實現 To-B 到 To-B 的病毒式裂變。

---
*總結：此 Roadmap 從表層的「視覺衝擊」到中層的「代碼工程」，再到深層的「雲端生態綁定」提供了一套完整升級打法。建議先以 **Phase 2 (前端重構)** 為下一個主要開發任務，地基穩健後，其他體驗優化即可迅速展開。*
