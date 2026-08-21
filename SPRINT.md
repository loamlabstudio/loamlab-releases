---
status: DONE
---
# IG 聯合發文與裂變機制優化 (Collabs & Referral Optimization)

## CONTEXT_DIGEST
優化現有 IG 共同發佈 (Collabs) 的轉化與營運流程。透過自動回覆概念解決 IG 連結限制，並在 Admin 後台提供一鍵發放 300 點獎勵的功能，取代手動打 SQL，提升活動擴展性與用戶體驗。同時補齊免責聲明以規避官方背書的版權風險。

## TASKS
- `[x]` **[MUST] 建立 IG 聯名推廣用戶手冊**
  - **影響檔案**: `docs/kol_system/IG_COLLAB_USER_GUIDE.md` (新檔案)
  - **描述**: 撰寫面向用戶的聯名教學手冊。包含：(1) 強烈建議使用 ManyChat 等 IG 自動回覆機制，教導粉絲「留言自動索取下載連結與邀請碼」，以解決 IG 內文無法點擊連結的問題。(2) 聯名免責聲明：提交聯名即代表保證原創，若遇版權爭議，官方有權單方面解除 Collab 並收回點數。

- `[x]` **[MUST] 實作 Admin 後台的「聯名獎勵一鍵發送」介面**
  - **影響檔案**: `loamlab_backend/public/admin.html`
  - **描述**: 在 Admin 後台（例如「用戶」Tab 內）加上一個小工具：輸入用戶 Email，點擊按鈕「發放 Collab 獎勵 (300 點)」。

- `[x]` **[MUST] 實作 Admin 後端 API 支援聯名獎勵發放**
  - **影響檔案**: 尋找適當的 API 檔案（如 `loamlab_backend/api/admin.js` 或相關檔案）
  - **描述**:
    1. 驗證管理員身份後，接收 target Email。
    2. 呼叫 `apply_points_delta` RPC，給予該用戶 `p_add_lifetime: 300`。
    3. 寫入 `transactions` 表，`transaction_type` 設為 `'COLLAB_REWARD'`，並產生一組防呆的 `order_id`（例如 `collab_<email>_<timestamp>`）。
    4. 成功後回傳前端。
