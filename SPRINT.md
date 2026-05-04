# SPRINT

## CONTEXT_DIGEST
- 用戶要求將所有的 Beta 優惠（包含文案、折扣標籤、原價對比劃線、DodoPayment URL 內的 `discount_code` 參數）全面移除，價格全部恢復為原定價。
- 定價牆 UI 需全面改版為「方案 A（Tab 切換單次與訂閱 + 詳細功能折疊）」，以達成極簡化設計，並將此修改同步至 Plugin、Website 網頁版及所有多國語系設定。
- 恢復後的定價基準 (USD)：Top-up ($25)、Starter ($35)、Pro ($75)、Studio ($199)。

## TASKS

- [SKIP] TASK 1: 移除全站與 Plugin 的 Beta 優惠與折扣參數（用戶決定維持 Beta 折扣）
  - **影響檔案**: `POINTS_SYSTEM.md`, `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js`, `loamlab_website/src/app/page.tsx`
  - **描述**: 移除所有 "Beta"、"-30%"、"7折" 等文案及 Badge 標籤。移除 HTML 與 React 結帳 URL 內的 `discount_code=LOAM_BETA_30` 參數。價格改回原定價（Top-up $25, Starter $35, Pro $75, Studio $199），並移除「原價劃線」的 UI 顯示。同步更新相關的單位成本預估文字（例如 2K ≈ $X.XX）。

- [x] TASK 2: Plugin UI 定價牆改版 (方案 A)
  - **影響檔案**: `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/app.js`
  - **描述**: 針對 `#pricing-modal` 重構。加入頂部 Tab 切換，分為「訂閱方案」與「單次充值」。卡片外觀極簡化，只保留「名稱、價格、每月/單次點數」。將原本的「支援 4K、設備數量、商用許可」等次要特徵收納入一個「查看詳細功能 ▼」的展開組件 (Accordion) 內。用戶見證區可視情況優化或隱藏。移除 `app.js` 中 `applyBetaDiscountDisplay()` 的動態折扣邏輯。

- [x] TASK 3: 補齊 Plugin 語系翻譯 (i18n)
  - **影響檔案**: `loamlab_plugin/ui/locales/*.json`, `loamlab_plugin/ui/i18n.js` (若有增減詞條)
  - **描述**: 清除與 Beta 折扣相關的舊翻譯（如 `pricing_beta_banner`, `pricing_period_mo_beta` 等）。新增新版定價牆所需的翻譯鍵值（如 Tab 名稱、`pricing_view_features` 等），並同步至所有語言。

- [x] TASK 4: Website 網頁定價區塊改版 (方案 A)
  - **影響檔案**: `loamlab_website/src/app/page.tsx`
  - **描述**: 同步修改官方網站的定價區塊 `#pricing`。使用 React State 實作 Tab 切換（Top-up vs Subscriptions），並加入 Top-up 的方案卡片。將每個卡片的詳細功能清單改為點擊展開（或 Hover）樣式，維持網站極簡美學。

status: DONE
