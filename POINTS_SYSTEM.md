# LoamLab Camera - 點數與授權體系 (Points & License System)

本文檔用於記錄與維護 LoamLab Camera 的點數消耗規則、付費方案定價，以及後端資料表結構。您未來若要調整售價或扣點比例，請以本文檔為最高準則進行同步。

---

## 1. 點數消耗規則 (Credit Consumption Engine)
當用戶點擊 `Start Engine` 時，Vercel 後端會根據傳入的 `resolution` (解析度) 變數，進行點數扣除。

目前設定如下（若需調整，請同步修改插件的 UI 顯示以及 Vercel 扣款邏輯）：
- **1K (Fast)**: 每次渲染消耗 **15** 點
- **2K (Pro)**: 每次渲染消耗 **20** 點
- **4K (Ultra)**: 每次渲染消耗 **25** 點

---

## 2. 定價與套餐結構 (Pricing & Subscription Plans)
這些套餐應於 LemonSqueezy 或 Stripe 後台建立對應商品，並將 Webhook 對接至 Vercel，用於使用者付款後自動增加庫存。

### 單次購買包 (Top-up) - [Beta 7折優惠]
- **售價**: `$18` (原價 `$25`，約 `NT$ 570`)
- **獲得點數**: `200 Credits`
- **可產圖數**: 10 張 (以 2K 畫質計)
- **定位**: 適合偶發性渲染的急救包。

### 訂閱方案 (Subscriptions) - [Beta 7折優惠]
使用者每月會獲得固定的點數發放。

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
- `points`: (Integer) 使用者的點數餘額，預設為 `0`。扣到小於所需點數時即阻擋渲染。
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
1. 用戶在 SketchUp 點擊購買/訂閱，跳轉至 LemonSqueezy 或 Stripe 帶有其 `email` 的專屬結帳網址。
2. 結帳成功，支付平台向您的 Vercel `/api/webhook` 發送 POST 請求。
3. Vercel 內的代碼解析 Payload 得到使用者買了哪個方案，將對應的點數 `UPDATE users SET points = points + N WHERE email = X`。
4. 使用者在 SketchUp 重整即可獲得點數並開始出圖。

---

## 5. 邀請碼裂變雙贏系統 (Refer & Earn 200+200) - Phase 17
為了將「用戶口碑」轉化為「永久的增長飛輪」，我們導入 200+200 的裂變獎勵機制。這具備極高的落地性與絕佳的使用者體驗。

### A. 運作體驗 (UX)
1. **老用戶分享**：在 SketchUp 插件的點數面板旁，點擊「🎟️ Invite & Earn」。系統顯示專屬邀請碼 (如 `LOAM-1A2B`)。老用戶將代碼貼到社群分享。
2. **新用戶綁定**：新用戶下載插件並登入後，在相同面板輸入老用戶的邀請碼，系統綁定關聯 (防呆機制：無法互相綁定、無法自己填自己)。
3. **無感觸發 (Zero-Friction)**：新用戶在未來**首次成功購買訂閱方案**時，LemonSqueezy 觸發 Webhook，系統除了發放原本購買的點數外，背景會「自動偵測綁定關係」，並**額外無聲派發 200 點給新用戶、同時發送 200 點給遠方的老用戶**。

### B. 資料庫擴充 (Supabase Schema V2)
在原本的 `users` 結構上，我們將利用 SQL 追加三個輕量級欄位：
```sql
ALTER TABLE users ADD COLUMN referral_code text UNIQUE; -- 用戶自己的邀請碼 (登入時自動生成)
ALTER TABLE users ADD COLUMN referred_by text;          -- 填入的老用戶邀請碼 (綁定對象)
ALTER TABLE users ADD COLUMN referral_rewarded boolean DEFAULT false; -- 是否已發放過首購獎勵
```

### C. 實作架構 (Vercel + HTMLDialog)
- **API `GET /api/auth/poll`**: 輪詢時，若用戶沒有 `referral_code`，後端順手幫他生成一組 6 碼英數並存入 DB，回傳給前端顯示。
- **API `POST /api/referral`**: 專門接收新用戶填寫的代碼，負責驗證代碼是否有效、是否是自己，驗證通過則更新 `referred_by`。
- **UI 面板**: 使用 Tailwind 實作精美的卡片，顯示 `Your Code: XXX [Copy]` 以及輸入框 `Enter Inviter's Code`。
- **Webhook 攔截器升級**: 在接收到 `order_created` (訂閱成功) 後，增加一段判斷式：如果客戶有 `referred_by` 且 `referral_rewarded == false`，則執行雙向 `points = points + 200`，並將狀態改為 `true`。
