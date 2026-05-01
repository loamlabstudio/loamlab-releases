# LoamLab KOL 階梯式分潤系統架構與面板說明

## 1. 系統核心邏輯
本系統基於 Supabase + Dodopayments 構建，採「輕量化快照機制」。

### 歸因綁定 (Attribution)
*   **連結追蹤 (LocalStorage)**：效期 30 天。使用者點擊 KOL 的專屬連結 (`?ref=KOL_CODE`) 後，網站首頁將代碼存入同域 localStorage，下次登入時自動帶入。
*   **登入時綁定**：使用者在 SketchUp Plugin 點擊登入 → 開啟 `auth-bridge.html`（讀取 localStorage kol_ref）→ 傳遞給 `/api/auth/login` → 存入 `auth_sessions.kol_ref` → Google OAuth 完成後，`google-callback` 將 `kol_ref` 寫入 `users.referred_by`，完成**永久綁定**。

### 分潤計算與快照 (Snapshot)
*   **觸發時機**：每次 Dodopayments Webhook 收到 `payment.succeeded` 或 `subscription.renewed` 時觸發。
*   **動態階梯計算**：Webhook 會即時計算該 KOL「當下」累積邀請的總付費人數。
    *   Tier 1 (1-50 人)：5% 分潤
    *   Tier 2 (51-100 人)：10% 分潤
    *   Tier 3 (>100 人)：15% 分潤
*   **快照寫入**：依據計算出的分潤比例，將該筆訂單的抽成金額寫入 `kol_ledger` 資料表，狀態設為 `pending`。不回溯舊有訂單。

## 2. 資料庫 Schema (Supabase)
新增 `kol_ledger` 表格：
*   `id`: UUID (PK)
*   `kol_code`: TEXT (KOL 專屬碼)
*   `buyer_email`: TEXT (購買者 Email)
*   `transaction_id`: TEXT (Dodopayments 訂單編號)
*   `amount_paid`: INTEGER (實際付款金額)
*   `commission_rate`: NUMERIC (分潤比例，如 0.05, 0.1, 0.15)
*   `commission_amount`: INTEGER (分潤金額)
*   `status`: TEXT (預設 'pending', 結算後改為 'ready_to_pay' 或 'paid')
*   `created_at`: TIMESTAMPTZ

## 3. KOL 即時反饋面板 (Dashboard) 規格
**API 路徑**：`GET /api/user?action=kol_dashboard&email=KOL_EMAIL`
（已合併至 user.js，以符合 Vercel Hobby 12 函數上限）
**回傳資料結構**：
```json
{
  "kol_code": "JOHN_DOE",
  "total_paid_users": 52,
  "current_tier": 2,
  "current_commission_rate": "10%",
  "progress_to_next_tier": {
    "needed": 101,
    "remaining": 49
  },
  "earnings": {
    "pending_cooling_off": 1500,  // T+15 冷卻期中的未結算金額
    "ready_to_withdraw": 3000,    // 已過冷卻期可提領金額
    "total_withdrawn": 5000       // 歷史已提領總額
  }
}
```
**UI 呈現建議**：
1.  **歡迎區塊**：顯示專屬推薦連結與折扣碼複製按鈕。
2.  **進度條 (Progress Bar)**：視覺化顯示「距離下一個分潤階梯 (15%) 還差 49 人」。
3.  **收益卡片 (Cards)**：分為「待結算收益 (冷卻期中)」、「可提領收益」、「已提領總額」。

## 4. 結算與防刷機制
*   **T+15 冷卻期**：訂單成立後 15 天內為 `pending` 狀態，避開退款與鑑賞期。
*   **後台對帳腳本**：管理員 API `GET /api/stats?action=kol_payout&sub=list|settle|export|mark_paid`（需 `Authorization: Bearer ADMIN_KEY` header），可將 `created_at` > 15 天且狀態為 `pending` 的紀錄標記為 `ready_to_pay`，並匯出為 CSV 供 PayPal 批次放款。
