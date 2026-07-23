# LoamLab Camera - 點數與授權體系 (Points & License System)

本文檔用於記錄與維護 LoamLab Camera 的點數消耗規則、付費方案定價，以及後端資料表結構。您未來若要調整售價或扣點比例，請以本文檔為最高準則進行同步。

---

## 0. 新人禮 (Signup Bonus)
- **公測期間新人禮**：`60 點`（剛好 3 張 2K 渲染）
- **實作位置**：`loamlab_backend/api/user.js` — 首次登入自動建帳號時寫入
- **冪等性保證**：依賴 Supabase `users.email UNIQUE` 限制，並發請求只有一次能成功插入

## 1. 點數消耗規則 (Credit Consumption Engine)
當用戶點擊 `Start Engine` 時，Vercel 後端會根據傳入的 `resolution` (解析度) 變數，進行點數扣除。

目前的扣點機制嚴格按照底層運算成本 1.5 倍跨度設計：
- **1K (Fast)**: 每次渲染消耗 **15** 點
- **2K (Pro)**: 每次渲染消耗 **20** 點
- **4K (Ultra)**: 每次渲染消耗 **30** 點 (運算成本為 2K 之 1.5 倍)

---

## 2. 定價與套餐結構 (Pricing & Subscription Plans)
這些套餐應於 Dodo Payments 後台建立對應商品，並將 Webhook 對接至 Vercel，用於使用者付款後自動增加庫存。

### Beta 折扣碼
- **代碼**：`LOAM_BETA_30`（7折，30% off）
- **使用場景**：結帳時自動帶入 Dodo Payments URL 參數預填
- **Beta 用戶身份**：公測期付費用戶標記為 Beta Tester，享有首年或永久折扣承諾

### 單次購買包 (Top-up) - [Beta 7折優惠]
- **售價**: `$18` (原價 `$25`，約 `NT$ 570`)
- **獲得點數**: `200 Credits` (永久有效)
- **可產圖數**: 10 張 (以 2K 畫質計)
- **定位**: 適合偶發性渲染的急救包。

### 訂閱方案 (Subscriptions) - [Beta 7折優惠]
使用者每月會獲得固定的點數發放。
**【防囤積機制】**：訂閱點數採嚴格的「Use it or lose it」當月重置制度，**點數不結轉至下個月**，以維持健康的 MRR 與伺服器負載。當用戶取消訂閱時，當期剩餘點數保留至該週期結束。

| 方案等級 | 方案名稱 | 月費 (Beta 優惠價) | 原價 | 每月發放點數 | 換算張數 (以2K計) |
| -------- | -------- | ------------------ | ---- | ------------ | ---------------- |
| 基礎 | **Starter** | **$24** | $35 | **300** | 15 張 |
| 專業 | **Pro** | **$52** | $75 | **2,000** | 100 張 |
| 工作室 | **Studio** | **$139** | $199 | **9,000** | 450 張 |

---

## 3. 資料庫欄位定義 (Supabase Schema)
我們唯一的資料表名稱為 `users`，以下為各欄位的用途與定義：

- `id`: (UUID) 系統自動生成的唯一流水號。
- `email`: (Text) 綁定 Google 登入帳號的信箱，作為身份認證與點數結算核心。
- `points`: (Integer) 訂閱方案的當月額度，預設為 `0`。每次訂閱扣款（含續訂）會直接**覆寫**成方案點數（use-it-or-lose-it，不結轉）。
- `lifetime_points`: (Integer) 單次購買 (Top-up) 與推薦獎勵累加而成的**永久餘額**，不會被訂閱續訂覆寫或增加。扣點順序：`deduct_render_points`／退款 `clawbackPoints` 一律先扣 `points`，不足才扣 `lifetime_points`。`processTopup`（`loamlab_backend/lib/activate.js`）嚴格區分：訂閱只動 `points`，單次購買只動 `lifetime_points`，避免雙重入帳（2026-07-08 修復過一次真實漏洞，見 `SPRINT.md` 歷史記錄與 commit `436055f`）。
- `license_key`: (Text) （預留擴充）如果您未來發放實體序號卡或團體金鑰，可填入此處。
- `created_at`: (Timestamp) 帳號建立的日期時間。

**SQL 建立語法**（貼至 SQL Editor 使用）：
```sql
create table users (
  id uuid default uuid_generate_v4() primary key,
  email text unique not null,
  points integer default 0,
  license_key text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
```

---

## 4. Webhook 流程預定 (Phase 10 後續)
1. 用戶在 SketchUp 點擊購買/訂閱，跳轉至 Dodo Payments 帶有其 `email` 的專屬結帳網址。
2. 結帳成功，支付平台向您的 Vercel `/api/webhook` 發送 POST 請求。
3. Vercel 內的代碼解析 Payload 得到使用者買了哪個方案，將對應的點數 `UPDATE users SET points = points + N WHERE email = X`。
4. 使用者在 SketchUp 重整即可獲得點數並開始出圖。

---

## 5. 邀請碼裂變系統 (Refer & Earn B+100 / A+300)
只有一層獎勵，**綁定當下不發任何點數**，只在被邀請人 (B) 首次付費（Top-up 或訂閱）成功時，一次性觸發：
- B 獲得 **+100 pts**（固定，`loamlab_backend/config.js` `PRICING_CONFIG.referral.paid_reward_b`）
- 邀請人 A 獲得 **+300 pts**（固定，`paid_reward_a`）

> 2026-07-23 補充：舊版曾規劃「B 免費算圖成功即送 A/B 各 +50 pts」的免費層與「按購買金額 20%/50% 抽成」的百分比付費層，兩者皆為早期草稿、從未實作，已從文件移除避免與實際行為混淆。目前上線的就是本節描述的單層固定金額設計。

### A. 運作體驗 (UX)
1. **老用戶分享**：插件點數面板點擊「Invite & Earn」，顯示專屬邀請碼。
2. **新用戶綁定**：新用戶在同一面板輸入邀請碼，`POST /api/user`（`{email, code}`）驗證後寫入 `referred_by`（防呆：不可互相綁定、不可填自己、每人只能綁定一次）。
3. **付費觸發發放**：B 首次付費成功時，`loamlab_backend/lib/activate.js` 的 `processTopup` 檢查 `referred_by` 且尚未發過（以 `transactions` 表的 `REFERRAL_PAID_B` 記錄冪等判斷），一次性發放上述點數。

### B. 資料庫欄位
```sql
ALTER TABLE users ADD COLUMN referral_code text UNIQUE; -- 用戶自己的邀請碼（登入時自動生成）
ALTER TABLE users ADD COLUMN referred_by text;          -- 填入的老用戶邀請碼（綁定對象）
```
> `referral_rewarded boolean` 欄位是舊設計殘留，目前程式碼未使用（改用 `transactions` 表冪等判斷），保留欄位但不維護。
