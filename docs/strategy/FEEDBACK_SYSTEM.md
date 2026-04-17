# LoamLab 反饋與數據飛輪系統

> 目標：從「被動統計展示」轉向「數據驅動的產品進化」。

---

## 現況問題

- **單向性**：管理員看數據，但數據不會自動回饋給模型優化
- **維度淺層**：只看成功/失敗，不看「為什麼這張圖漂亮」
- **反饋孤島**：用戶的 5 星評價只是數字，未轉化為 prompt 優化標註
- **錯誤分類粗糙**：REFUND 紀錄無法區分 AI端故障 / 輸入問題 / 模型品質不佳

---

## 核心架構：AI 數據飛輪

### 第一層：感知層（Sensing）
- **插件端**：增加「場景複雜度標籤」，採集模型密度、光譜等結構特徵
- **API 端（stats.js）**：引入 `Trend Vector` 趨勢向量，不只給當下數值，更給「劣化趨勢」預警

### 第二層：分析層（Intelligence）
- **品質矩陣**：橫軸 Style × 縱軸 User Tier → 聚類分析（例：「高級用戶在北歐風下不滿意度上升」）
- **算圖全生命週期標註**：每筆 transaction 擴展為 Decision Map（Input Context + 隱性行為 + 顯性評分）
- **對抗性排序（Elo Rating）**：讓管理員在兩張相似圖中選「哪張更好」，自動生成 Prompt 演進權重

### 第三層：行動層（Action）
- **自動化預警**：單一用戶失敗 >3 次 或連續 2 次 1 星 → admin.html 紅點通知
- **Prompt 演進紀錄（Git-like）**：所有 Prompt 修改有版本控制與數據關聯，追蹤「哪次更新導致模型泛化能力下降」
- **自動化補償**：嚴重故障時自動補發點數 + 個性化通知

---

## 後台管理介面升級（admin.html）

- **算圖品質牆（Gallery View）**：根據用戶 Rating 自動彙整 1 星 vs 5 星對比
- **健康預警**：顯示異常行為（大量退費 / 大量 1 星）
- **Prompt 實驗室**：針對特定失敗族群一鍵生成「修復版 Prompt」並進行小規模 A/B Test

---

## 實施路徑

- [ ] **Phase 1：後端 API 強化**（`stats.js`, `feedback.js`）
    - [ ] 擴展 `stats?action=feedback` 支援錯誤標籤聚合排行
    - [ ] 新增 `stats?action=retention` 計算 7/30 日留存
- [ ] **Phase 2：後台介面升級**（`admin.html`）
    - [ ] 品質牆 Gallery View
    - [ ] 健康預警工具
    - [ ] 整合 Vercel Analytics
- [ ] **Phase 3：數據飛輪實施**
    - [ ] Supabase Schema 升級（`metadata` 深度結構）
    - [ ] Prompt 實驗室介面
    - [ ] Elo Rating 系統實作

---

> 這不只是升級一個網頁，而是為 LoamLab 植入一個「會學習的腦袋」。
