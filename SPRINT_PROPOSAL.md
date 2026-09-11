# 官網與軟體定價/點數不一致修復提案 (Pricing & Credits Sync)

status: REJECTED
reviewed_by: Claude Code
reviewed_at: 2026-09-11

---

## 駁回理由（逐條查證）

### Phase 1「官網定價錯誤」— 誤判，且指定了死檔

**官網沒有錯。** 提案認為 `PricingConfig` 把 Beta 優惠價當原價、再打一次 7 折；
實際上前端整套設計就是「掛牌價 → 結帳自動折 30% → 實收」：`origPrice` 放掛牌價、
`price` 放 `Math.round(掛牌價 × 0.7)`，與插件端 `applyBetaDiscountDisplay()`
（`app.js:3470-3488`）算出的數字逐項吻合（$13 / $17 / $36 / $97）。

真正的錯在 **Dodo 後台 Top-up 商品標價設成 $13**（應為 $18），
已由用戶於 2026-09-11 在 Dodo 後台修正。插件端 `PLAN_RENDER_COST_USD` 的註解
（`app.js:3433`）早就寫著 `$18 × 0.7 / 200 pts`，程式碼一直假設標價是 $18。

此外提案的「影響檔案」指向根目錄 `loamlab_camera_official.html` — 該檔最後改動停在
2026-07-17，比線上版舊兩個月、少 50KB、差 1256 行。`vercel.json` 的 rewrite 是
`/` → `/public/index.html`，線上只讀後者。照提案執行會把本來正確的官網改壞，
而真正的錯一個都修不到。**該死檔已於本次刪除**，避免再次誤導。

### Phase 2「軟體點數錯誤」— 問題屬實，但修法無法生效

問題確實存在：`i18n.js` 的 `pricing_feat_pro_credits` / `pricing_feat_studio_credits`
仍是 1,000 / 3,000，會在語系套用時覆蓋 `index.html` 裡正確的 2,000 / 9,000 fallback。

但提案的修法做不到：

1. `node scripts/sync_i18n.js` **不存在**（`scripts/` 下只有 `check_i18n.mjs`），
   提案提到的 `sync-localization` skill 同樣不存在
2. `loamlab_plugin/ui/locales/*.json` **沒有被任何程式碼載入**（全專案只在 `i18n.js`
   的註解裡被提及），實際生效的是編譯產物 `i18n.js`。只改 JSON 等於零效果

已改為手動同步 `locales/*.json`（6 檔）與 `i18n.js`（12 行），JSON/JS 語法驗證通過。

---

## 根因：一組從未存在過的「原價」

提案與第一輪稽核都被 `POINTS_SYSTEM.md` 記載的「原價 $25 / $35 / $75 / $199」誤導。
該組數字**從未在 Dodo 後台或任何前端程式碼出現過**，是 2026-03-20 初版規劃階段的錨點
（當時連支付平台都還沒選定，原文寫的是 LemonSqueezy 或 Stripe）。

現行掛牌價正是由它 × 0.7 反推而來，四個數字剛好全部吻合
（$75×0.7≈$52、$35×0.7≈$24、$199×0.7≈$139、$25×0.7≈$18），
因此讀到的人極易誤判「掛牌價已經是折後價」，進而把 30% 折扣重複計算一次。

`POINTS_SYSTEM.md` 已改寫，明確區分掛牌價／顯示價／實收三層，
並將該組原價標註為從未上線、不可引用。

---

## 本次實際交付

| 項目 | 內容 |
|---|---|
| 點數修正 | `i18n.js` + `locales/*.json`：Pro 1,000→2,000、Studio 3,000→9,000（6 語系） |
| 文件校正 | `POINTS_SYSTEM.md`：三層價格定義 + 手動同步清單，定為定價唯一真實來源 |
| 清理 | 刪除死檔 `loamlab_camera_official.html` |
| 未改動 | 官網 `public/index.html`、後端 API 一字未動，**本次無需部署** |

插件端的點數修正需等下次打包 `.rbz` 才會到用戶手上。
