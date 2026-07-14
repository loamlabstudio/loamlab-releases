# Sprint Plan: Admin Prompt Translation Simplification

## CONTEXT_DIGEST
當前 `admin.html` 中存在多個零散的翻譯按鈕，導致維護與操作繁瑣。基於第一性原理，官方提示詞只需一份統一語言版本即可送往渲染引擎（引擎具備多語意圖理解能力，能接受官方中文 Prompt 混搭用戶英文選項）。本計畫旨在收斂所有提示詞翻譯為單一控制鍵，自動處理所有系統節點與舊版咒語，並略過用戶自定義選項，確保渲染順暢。

## TASKS

### 1. [MUST][DONE] 移除零散翻譯按鈕並實作單一全局翻譯入口
- **目標**：清理 `admin.html` 中繁雜的單一節點、版塊、Value 翻譯按鈕，保留唯一的「全局提示詞語言切換」按鍵。
- **影響檔案**：`loamlab_backend/public/admin.html`
- **任務描述**：
  1. 移除結構標籤區塊、選項設定包區塊、節點清單中所有的單一翻譯按鈕（如 `btn-translate-structure`, `btn-translate-all-sysnodes`, `translateSingleNode` 等）。
  2. 將現有 `translateAllOfficialPrompt()` 升級為單一入口，支援選擇目標語言（預設提供簡體中文/英文切換）。
  3. 擴充該函數，使其除了處理 `t1NodesData` 與 `structureLabelsData` 外，也要翻譯 `TOOL_1_BATCH_NODES` (Batch Layer 的 key 與 value) 以及 `TOOL_1/2/3` 的備用文字咒語（`prompt-t1/t2/t3`），並在翻譯完成後一併呼叫所有對應的 save 函數保存至資料庫。

### 2. [MUST][進行中] 保留用戶自定義內容並驗證渲染流程
- **目標**：確保全域翻譯只影響官方架構與預設值，不污染用戶前端傳入的自定義選項，並確認後端能正確處理中英混搭 JSON。
- **影響檔案**：`loamlab_backend/public/admin.html`, `loamlab_backend/api/render.js`
- **任務描述**：
  1. [DONE] 檢視 `translateAllOfficialPrompt` 邏輯，確認**不翻譯** `node.type === 'slider'` 的 `default` 數值，且**不強制翻譯**用戶選項 (`options` 的 value，若要翻譯僅處理 option 的 label)。
  2. [DONE] 確認 `render.js` 中的 `buildNodesModePrompt` 能在結構 key 變更為中文時，無縫地將用戶從插件選取的英文 `adv` 參數拼接上去——本來就是純 JS 物件 + `JSON.stringify`，天生支援 Unicode key/value，不需改動。
  3. [待人工執行] 執行測試：在 Admin 面板將提示詞一鍵切換為簡體中文後，發起一次渲染請求，驗證混搭語言的 Prompt 能夠正確送達引擎並完成渲染。**此步驟會真的把 production 官方提示詞切成簡中並燒真實渲染點數，Claude 無瀏覽器工具可操作，需使用者本人在 admin 面板手動點擊驗證。**

## 調整說明（Claude 執行時的判斷）
- 任務1原文列出的「Value 翻譯按鈕」（optionsData 一鍵翻譯 Value + 單選項多語系）**未併入全域入口，維持獨立**：它是生成下拉選項的 6 語系 UI 顯示標籤，跟官方提示詞的單一目標語言邏輯是不同性質的功能，直接刪除會造成純粹的功能減損，且任務1.2的擴充清單本身也未將 optionsData 納入。已與用戶確認此判斷。

status: READY_FOR_CLAUDE（Task 1 已完成並部署 production；Task 2.3 實測待人工執行）
