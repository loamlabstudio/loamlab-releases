# LoamLab Admin 郵件發送與反饋機制優化計畫 (Sprint)

## CONTEXT_DIGEST
目前 Admin 面板的「自動洞見」中，點擊「發郵件」會發送 API `action=notify_users`，但後端 (`stats.js`) 尚未實作該接口，導致點擊無反應。
本計畫旨在從「自動性、審核、多語言推斷」的角度，重建成熟的郵件反饋機制，避免誤發、重複發送，並提供管理員友善的審核預覽。

## TASKS

- [x] **Phase 1: 後端發信基建與 API 修復**
  - **影響檔案**: `loamlab_backend/api/stats.js`, `loamlab_backend/api/utils/email.js` (新建或沿用)
  - **描述**: 在 `stats.js` 實作 `action=notify_users` 處理邏輯。整合 Email 服務 (例如 Resend 或現有 SMTP)，並在 DB (Supabase) 建立 `email_logs` (或類似紀錄表) 記錄 `user_email` 與 `template_id`，防止同一洞見對同一用戶短期內重複發送。
  - **DB Schema 變更**: 新增 `email_logs` 表 (欄位: `id`, `user_email`, `template_name`, `sent_at`)。

- [x] **Phase 2: 動態情境模板系統與多語言推斷**
  - **影響檔案**: `loamlab_backend/api/stats.js`, `loamlab_backend/public/admin.html`
  - **描述**: 依賴 Phase 1。針對不同的洞見情境（如 `onboarding_stuck` 激活郵件、`churn_risk` 留存提醒、`paywall_trigger` 轉化推播）建立獨立的信件範本。系統需在發送前，依據 `users` 表的 `last_login_ip` 或新增的 `locale` 欄位推斷用戶國籍，並動態組裝對應語言（中/英/日等）的內容。
  - **DB Schema 變更**: `users` 表可考慮補上 `locale` 欄位 (字串，選填) 供後續長效紀錄。

- [x] **Phase 3: 前端範本管理與發送預覽窗口 (UI/UX)**
  - **影響檔案**: `loamlab_backend/public/admin.html`
  - **描述**: 
    1. **內容管理**: 在 Admin 既有的「📢 內容」分頁中，新增「✉️ 洞見郵件範本管理」區塊，讓管理員能直觀編輯並預覽 onboarding、retention 等不同問題對應的多語言郵件內容。
    2. **發送審核**: 將目前的 `executeInsightEmail` 一鍵發送改為彈出「發信審核 Modal」。在 Modal 內顯示即將發送的總人數、針對該問題套用的信件預覽及語言分布。管理員確認無誤後，點擊「確認發送」才真實觸發批量 API。

- [NICE] **Phase 4: 全流程驗收與自動化洞見排程預備** _(跳過，NICE 優先級)_
  - **影響檔案**: `loamlab_backend/api/stats.js`, `admin.html`
  - **描述**: 依賴 Phase 3。整合測試全流程，確保發送信件不超時 (Vercel limits)。優化 UI 發送中的 Loading 狀態與進度條。標記已處理的洞見，避免每次重整都顯示相同名單。

status: DONE
