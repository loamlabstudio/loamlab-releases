# 土窟設計 SU 渲染插件 - 分佈式指揮協議 (DISTRIBUTED_PROTOCOL.md)

本文件定義了「總隊長」與各「隊長」跨對話視窗協作的標準，旨在最大化 Token 利用率並防止模型遺忘。

---

## Ⅰ. 指揮權限 (Command Hierarchy)

### 1. 總隊長 (Total Captain) - 抗重力調度核心
- **職責**: 策略設計、任務分發 (By KPI)、技術巡檢、重大衝突仲裁。
- **指標**: 總隊長不親自動手編碼，其產出為「經過驗收的整合代碼」。

### 2. 隊長 (Captain) - 自治執行單元
- **職責**: 認領任務、獨立決策、實現 KPI、回報證據。
- **入職預檢 (REQUIRED)**: 每次對話開始，必須先閱讀 `AGENTS_SYNC.md` 並更新自己的 **[HEARTBEAT]** 狀態。
- **環境定義**: 必須遵循 `AGENTS_CHECKLIST.md` 中的全域定義，嚴禁修改非歸屬區域的檔案。

### 2. 隊長 (Captains / Agents)
- **職責**: 各自負責所屬目錄的功能實現（如插件代碼、後端運維）。
- **協調**: 除特定系統性改動外，各隊長優先向總隊長匯報，不輕易打擾用戶。

---

## Ⅱ. 隊長陣容與分片路徑 (Context Sharding)

| 隊長簡稱 | 獨立對話建議 | 負責目錄 | 初始召喚件 |
| :------- | :----------- | :------- | :--------- |
| **插件隊長** | 強烈建議 | `loamlab_plugin/` | `Summon_Plugin.md` |
| **金流隊長** | 建議 | `loamlab_backend/` | `Summon_Billing.md` |
| **渲染隊長** | 建議 | `loamlab_backend/api/render.js` | `Summon_Render.md` |

---

## Ⅲ. 分佈式同步流程 (Distributed Sync)

1. **讀取黑板**: 隊長啟動時必須掃描 `AGENTS_SYNC.md` 獲取總隊長最新命令。
2. **局部開發**: 隊長在獨立視窗進行大量代碼修改與測試。
3. **狀態寫回**: 完成任務後，將代碼變更摘要與測試截圖路徑寫入 `AGENTS_SYNC.md`。
4. **巡檢驗收**: 總隊長在主視窗讀取 `AGENTS_SYNC.md` 後，向用戶匯報。

---
*總隊長執行中 - Antigravity (Advanced Agentic Coding)*
