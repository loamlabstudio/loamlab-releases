# Sprint

## Context Digest
- **T2 顯示正在連線**：index.html 中的 preview-placeholder 錯誤重用了 data-i18n="status_waiting"，導致切換至 T2（空底圖狀態）時，佔位符顯示為「正在等待 Ruby 核心連線...」，誤導用戶以為當機。
- **點數未加總永久點數**：render.js 的 poll_render 邏輯中，僅查詢了 points 而漏掉 lifetime_points；且扣款成功後回傳時誤用了不存在的 deductResult.balance，導致 UI 點數未更新或顯示錯誤。
- **剖面框影響出圖**：SketchUp 剖面框（Section Planes）在未隱藏時會以半透明灰框顯示，干擾 AI 視覺。渲染截圖時未強制關閉 DisplaySectionPlanes。

## Tasks

- [x] [MUST] **Task 1: 修復 T2 空間改造佔位符文字**
  - **影響檔案**: loamlab_plugin/ui/index.html 以及 loamlab_plugin/ui/locales/ 下的語系檔。
  - **描述**: 將 preview-placeholder 中的 data-i18n="status_waiting" 改為新的 key（如 placeholder_empty），並在語系檔中加入對應翻譯（例如：「請從歷史記錄選擇一張圖作為底圖」）。或者採用更簡潔的 UI 呈現方式，避免與系統連線狀態混淆。

- [x] [MUST] **Task 2: 修復後端算圖後點數餘額計算 (lifepoint)**
  - **影響檔案**: loamlab_backend/api/render.js
  - **描述**: 
    1. 在 poll_render 的資料庫查詢中，將 select('points') 改為 select('points, lifetime_points') 並回傳兩者加總。
    2. 檢查 API 回傳的 points_remaining（約 1007、1021 行），扣款成功時 deductResult 沒有 balance 屬性，請改為 (deductResult.points || 0) + (deductResult.lifetime_points || 0)。

- [x] [MUST] **Task 3: 隱藏 SketchUp 剖面實體框 (Section Planes)**
  - **影響檔案**: loamlab_plugin/main.rb
  - **描述**: 確保出圖時完全尊重場景本身的剖面切割效果 (DisplaySectionCuts)，但強制隱藏剖面實體框。建議最簡潔的做法是在 RENDER_KEYS 中加入 'DisplaySectionPlanes' => false。若 Claude 判斷遍歷 entities 隱藏是更安全的方式，也保留彈性空間。

status: DONE

## EXECUTION NOTES (Claude)

### Task 1 — 照做 + 順修既有死碼
- index.html：`<a href="feedback-beta" data-i18n="status_waiting">` → `<span id="placeholder-text" data-i18n="placeholder_empty">`。
  （原 `<a>` 在 `pointer-events-none` 容器內，本來就點不到；且 app.js:1608 / 2368 早已 `querySelector('#placeholder-text')` 期待這個 id，過去一直抓到 null——這次補上 id 後 `preview_select_hint` / `syncing_viewport` 兩段動態文字才真正生效。）
- i18n.js：`placeholder_empty` 已補齊 6 語系（live 系統是 i18n.js `UI_LANG`；`locales/*.json` 全專案零引用，未動）。node 驗證無缺 key。

### Task 2 — 照做（RPC 回傳形狀已核對 supabase_setup.sql:512）
`deduct_render_points` 成功時回 `{success, points, lifetime_points}`，**無 `balance`**；只有 insufficient 分支回 `balance`。
- render.js poll_render 成功查詢：`select('points')` → `select('points, lifetime_points')`，回傳兩者加總。
- render.js 約 1007 / 1021 行：`deductResult.balance`（success 時為 undefined）→ `(deductResult.points||0)+(deductResult.lifetime_points||0)`。
- 第 707 行的 `deductResult.balance` 是 insufficient_points 分支，**正確，未動**。

### Task 3 — 採 RENDER_KEYS 方案（KISS）
main.rb `RENDER_KEYS` 加 `'DisplaySectionPlanes' => false`，不碰 `DisplaySectionCuts`（尊重場景切割）。
`apply_render_keys` 用 model attribute 存原值、`restore_render_keys` 動態迭代 `RENDER_KEYS.keys` 還原，新 key 自動納入存/還原/每場景重套。

**殘留邊界（非本 sprint 範圍，待用戶決定是否另開任務）：**
1. 場景未勾選儲存剖面狀態 → 切場景不重置剖面，前一場景/全域的切割會殘留；強制 `DisplaySectionCuts` 才能解，但違反「尊重場景」。
2. 「當前即時視角」直出 → 用戶編輯時開著的剖面框已藏，切割仍保留。
3. T4 360 預覽（`apply_t4_style` 用獨立 ro 白名單）不套 RENDER_KEYS，預覽仍見灰框；非交付圖。

### 版本
沿用前一 sprint 已 bump 的 1.4.72（尚未 release），本次三修同版隨行，未再 bump。
