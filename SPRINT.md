# CONTEXT_DIGEST
SmartCanvas（T2）v2 上線後，真實測試發現 AI 輸出會出現跟圈選顏色一致的實色色塊污染。原因是
composite 上的霓虹線框顏色本身會被模型誤解成塗色指令，即使 prompt 文字已移除色碼也一樣。
本輪先採用折衷方案驗證：composite 視覺維持彩色（不影響使用者編輯體驗），但只有實際送給 AI
的那份額外烘入「隱藏數字編號」（如「1. 描述」），跟文字 prompt 的「Region N」精準對應，使用者
看到的預覽版不會出現任何編號。方案二（composite 全改中性白線框）程式碼已保留備用，未啟用。

# TASKS
- [x] TASK 1: composite 改「彩色線框 + 送出版隱藏數字編號」混合方案
  - **影響檔案**: `loamlab_plugin/ui/app.js`
  - 描述: `_scDrawRegionAnnotation` 的 `neutral`（全中性白線框，方案二保留備用）與 `number`
    （烘入序號）拆成兩個獨立參數；`_scCreateAnnotatedComposite` 只在 `bakeRefTags=true`
    （送出版）時傳入序號，預覽版（使用者看得到）維持乾淨無編號。

- [x] TASK 2: render.js prompt 組裝格式簡化
  - **影響檔案**: `loamlab_backend/api/render.js`
  - 描述: `changes.push` 從 `zoneTag\n  Target Object: content` 兩行式改成 `zoneTag: content`
    單行，跟 app.js 端組裝格式一致，避免 prompt 讀起來斷行斷錯地方。

- [x] TASK 3: 資訊圖標籤框邊框加粗
  - **影響檔案**: `loamlab_plugin/ui/app.js`
  - 描述: `_scDrawLabelPill` 標籤框邊框從 `Math.max(1, 1.5 * scale)` 加粗到
    `Math.max(2.5, 3 * scale)`，提升辨識度。

**驗收**: 以 Playwright 匯出預覽版與送出版 composite 截圖人工比對——預覽版純彩色無編號，
送出版彩色線框 + 正確序號皆已烘入。實際色塊污染是否解決待使用者實測回饋後再決定是否切換
方案二。

status: DONE

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_backend/api/render.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
sql_migration: false
