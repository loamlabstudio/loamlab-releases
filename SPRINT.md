# Sprint Plan: 新增合夥人 (Partner) 角色及分潤級距

**Context Digest:**
- 當前系統已有 KOL 系統 (`is_kol` 標記)，階梯分潤為 5%, 10%, 15%。
- 需求：新增結構完全相同但身分稱為「合夥人」(`is_partner` 標記)，階梯分潤為 15%, 20%, 25%。
- 核心涉及資料庫 Schema 擴充、Webhook 算錢邏輯分支、Dashboard API 資訊分支，以及前端 UI 的動態顯示。

## TASKS

- **[MUST] Task 1: 擴充 Supabase Schema**
  - **影響檔案**: `loamlab_backend/supabase_setup.sql`
  - **描述**: 於 `users` 表格新增 boolean 欄位：`is_partner`，預設為 `false`。

- **[MUST] Task 2: 更新自動分潤快照邏輯 (Webhook)**
  - **影響檔案**: `loamlab_backend/api/webhook.js`
  - **描述**: 在 `writeKolCommission` 中，同時讀取 `is_kol` 與 `is_partner`。如果買家的推薦人是 `is_partner`，採用新級距：1-50人 (15%)，51-100人 (20%)，>100人 (25%)；若為 `is_kol` 則維持原樣。

- **[MUST] Task 3: 升級 User API**
  - **影響檔案**: `loamlab_backend/api/user.js`
  - **描述**: 
    1. 主 `GET /api/user` 需在 response 加入 `is_partner` 欄位。
    2. `kol_dashboard` action 中，根據使用者是 `is_partner` 或 `is_kol`，返回對應的 `role_type` (partner/kol)，以及正確的級距和 percentage (15/20/25% vs 5/10/15%)。

- **[MUST] Task 4: 前端介面適配與多語系支援**
  - **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/i18n.js`, `loamlab_plugin/ui/locales/zh-TW.json`, `loamlab_plugin/ui/locales/zh-CN.json` 等
  - **描述**: 
    1. 修改 `app.js` 裡的 `updateLoginUI` 與 `fetchKolDashboard`，支援 `is_partner` 觸發面板顯示。
    2. 新增多語系 key `partner_dashboard` (例如：🏆 合夥人進度 Partner Dashboard)。
    3. 動態渲染面板標題與 Tier 3 封頂文字，避免寫死 "15%"。

- **[NICE] Task 5: 更新內部營運文件**
  - **影響檔案**: `docs/kol_system/ADMIN_KOL_MANUAL.md`, `docs/kol_system/SYSTEM_ARCHITECTURE.md`
  - **描述**: 補充 `is_partner` 的操作說明，並列出其對應的 15/20/25% 階梯規則。

status: DONE
