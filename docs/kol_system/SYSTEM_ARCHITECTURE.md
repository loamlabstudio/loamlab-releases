# LoamLab KOL 階梯式分潤系統架構與面板說明

## 1. 系統核心邏輯
本系統基於 Supabase + Dodopayments 構建，採「輕量化快照機制」。

### 歸因綁定 (Attribution)
*   **連結追蹤 (Cookie)**：效期 30 天。使用者點擊 KOL 的專屬連結 (例如 `?ref=KOL_NAME`) 後，前端記錄於 Cookie 或 LocalStorage。
*   **折扣碼優先 (Discount Code)**：若結帳時輸入 KOL 專屬折扣碼，優先級高於 Cookie。
*   **首單綁定**：使用者「第一筆付費訂單」成立時，將 KOL 的代碼寫入使用者的 `users.referred_by` 欄位，完成**永久綁定**。

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
**API 路徑**：`/api/kol/dashboard` (GET)

**資安防護 (Security)**：
1. **嚴格權限驗證**：必須驗證呼叫者的登入 Token，且該使用者的 `is_kol` 必須為 `true`，否則一律回傳 403 Forbidden。
2. **個資去識別化**：API **絕對不可**回傳購買者的完整 Email 或任何聯絡方式，僅回傳「總人數」、「收益總額」等聚合數據 (Aggregated Data)，杜絕 KOL 竊取客戶名單的風險。

**回傳資料結構**：
```json
{
  "kol_code": "JOHN10",
  "total_paid_users": 47,
  "current_tier": {
    "level": 1,
    "name": "Bronze Ambassador",
    "rate": "5%"
  },
  "next_tier": {
    "level": 2,
    "name": "Silver Ambassador",
    "rate": "10%",
    "users_needed_total": 51,
    "users_short": 4
  },
  "earnings": {
    "pending_cooling_off": 1500,  // T+15 冷卻期中的未結算金額
    "ready_to_withdraw": 3000,    // 已過冷卻期可提領金額
    "total_withdrawn": 5000       // 歷史已提領總額
  }
}
```

**UI 呈現建議 (上癮與回饋機制)**：
1.  **專屬身份展示**：顯示當前階梯徽章（如：🥉 青銅大使、🥈 白銀大使、🥇 黃金大使），給予榮譽感。
2.  **遊戲化進度條 (Gamification Progress Bar)**：強烈視覺化顯示「距離下一階梯 (10% 分潤) 只差 **4** 人！」。使用漸層色與微動畫，刺激 KOL 繼續推廣的動力（就像遊戲中快要升等的心態）。
3.  **收益動態卡片**：將收益明確區分為「待結算收益 (處理中)」與「可提領收益 (隨時變現)」。數字的增長與階梯的升級應設計清楚，營造「被動收入不斷增加」的爽快感。

## 4. 結算與防刷機制
*   **T+15 冷卻期**：訂單成立後 15 天內為 `pending` 狀態，避開退款與鑑賞期。
*   **後台對帳腳本**：建立管理員 API `/api/admin/kol_payout`，可將 `created_at` > 15 天且狀態為 `pending` 的紀錄標記為 `ready_to_pay`，並匯出為 CSV 供 PayPal 批次放款。
