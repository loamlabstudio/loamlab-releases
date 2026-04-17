# LoamLab 監管與對比系統：技術規格書 (Technical Spec)

這是一份針對「官網數據監管」與「渲染前後紀錄」整合的技術深度文件。

---

## 1. 官網數據監管 (Website Monitoring)

目前後台監管的是 `loamlab_backend` 的 API 跳轉。我們需要擴展至 `https://loamlabcamera.vercel.app/` (主站)。

### 實施方案：
1. **流量鏡像**：透過 `stats?action=traffic` 接口，動態載入主站的 Vercel Analytics 數據。
2. **行為轉換分析**：在後台增加「官網訪問 -> 插件下載 -> 算圖轉化」的全鏈路追蹤。
3. **即時訪客監控**：若 Vercel 限額允許，增加「當前在線人數」的儀表盤組件。

---

## 2. 渲染前後對比 (Before & After Logs)

這是「數據飛輪」最關鍵的燃料。沒有輸入（Before）的輸出（After）是沒有分析價值的。

### A. 資料庫 Schema 升級 (Supabase)
我們需要修改 `render_history` 表：
- `input_url`: 存儲用戶上傳的原始白模圖、實景圖。
- `mask_url`: (工具 2 專用) 存儲用戶塗抹的遮罩區域。
- `config_json`: 存儲當時的算圖參數（解析度、風格權重、模型版本）。

### B. 算圖引擎介接 (API Logic)
在 `render.js` 觸發算圖前：
1. 將上傳至 `render-temp` 的原始圖「持久化」轉存至 `render-logs` bucket。
2. 將該 URL 寫入 `render_history.input_url`。

### C. 後台 UI 展示 (Admin UI)
- **對比滑桿 (Comparison Slider)**：在後台點擊任一算圖紀錄時，彈出對比視圖。
- **參數回溯**：顯示「這張圖是用什麼 Prompt 算出來的」。

---

## 3. 執行順序

1. **[DB]** 執行 SQL 增加 `input_url` 與 `config_json` 欄位。
2. **[Backend]** 修改 `render.js` 實作原始圖存儲。
3. **[Frontend]** 在 `admin.html` 增加「官網數據監控」分頁與「前後對比」視窗。
