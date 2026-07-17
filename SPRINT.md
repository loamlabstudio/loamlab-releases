# Sprint Plan: 完善 Node 選項過濾與配方匯入機制

## CONTEXT_DIGEST
目前已實作 Node 過濾機制，會將不再有效的舊選項從用戶快取中剔除。然而用戶希望：1. 官方預設更新時，若無用戶有效選項則自動跟隨新預設。2. 保留用戶既有的自訂 Node。3. 匯入他人分享的配方時，若含有未知自訂 Node，需自動在本地新建這些自訂 Node 而非剔除。

## TASKS

1. [x] **優化配方匯入邏輯 (Import Preset)，自動繼承並新建自訂 Node**
   - **優先級**: [MUST]
   - **影響檔案**: `loamlab_plugin/ui/app.js`
   - **描述**: 修改 `importPresetCode()` 及 `applyPreset()`。當解析別人分享的配方時，檢查其附帶的 `userChips` 或是節點字串。遇到不在官方選項且本地沒有的 Node 字串，必須自動將它寫入本地的 `userChips`，讓它成為合法的自訂選項，防止被剛上線的過濾機制當作「殘留舊選項」刪除。

2. [x] **確保無效選項過濾後能自動回退至最新官方預設 (Default)**
   - **優先級**: [MUST]
   - **影響檔案**: `loamlab_plugin/ui/app.js`
   - **描述**: 在 `renderT1Nodes()` 中，再次檢驗舊快取字串被過濾掉無效選項後的回退邏輯。確保如果有效字串數量為零，系統能正確套用當前官方最新的 `data-chip-default="1"` 的選項，完全跟隨官方最新的預設設定。

3. [x] **驗證用戶本地自訂節點 (userChips) 的保留與顯示邏輯**
   - **優先級**: [MUST]
   - **影響檔案**: `loamlab_plugin/ui/app.js`
   - **描述**: 確保每次 UI 重繪時，`_nodeValidValues` 陣列能正確將 `personalOpts` (用戶過去自己新增的 Chips) 包裝進合法清單中，讓他們自定義的保存永久保留不受新過濾機制干擾。

status: DONE
