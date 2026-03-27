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
這些套餐應於 LemonSqueezy 或 Stripe 後台建立對應商品，並將 Webhook 對接至 Vercel，用於使用者付款後自動增加庫存。

### Beta 折扣碼
- **代碼**：`LOAM_BETA_30`（7折，30% off）
- **使用場景**：結帳時自動帶入 LemonSqueezy URL，透過 `?checkout[discount_code]=LOAM_BETA_30` 預填
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

## 5. 邀請碼裂變雙贏系統 (Refer & Earn B+100 / A+300) - Phase 17
為在獲取新用戶與保護利潤間取得平衡，我們實施「防羊毛黨」的階梯式動態獎勵：

### A. 獎勵結構
1. **免費行為 (算圖成功即送小甜頭)**：被邀請人 (B) 完成首次成功算圖時，給予雙方些微鼓勵。
   - B 獲得 **+50 pts** 
   - 邀請人 A 獲得 **+50 pts**
2. **付費行為 (首次購課解鎖大獎勵)**：一旦被邀請人 (B) 首次購買任意方案 (Top-up或訂閱)，給予高額獎金，直接與營收掛鉤。
   - B 獲得該購買方案點數的 **20%** 作為首購加碼 (例如 Starter 送 60 點)。
   - 邀請人 A 獲得該購買方案點數的 **50%** 作為分潤 (例如 Starter 送 150 點)。

### B. 運作體驗 (UX)
1. **老用戶分享**：在 SketchUp 插件的點數面板旁，點擊「🎟️ Invite & Earn」。系統顯示專屬邀請碼 (如 `LOAM-1A2B`)。老用戶將代碼貼到社群分享。
2. **新用戶綁定**：新用戶下載插件並登入後，在相同面板輸入老用戶的邀請碼，系統綁定關聯 (防呆機制：無法互相綁定、無法自己填自己)。
3. **無感觸發 (Zero-Friction)**：新用戶完成上述目標操作時，背景無聲派發點數，並更新對應的 `rewarded` 標記防重複。

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
- **render.js 觸發**：首次算圖成功後，若 `referred_by` 已設定且 `referral_rewarded == false`，執行 B `lifetime_points += 100`、A `lifetime_points += 300`，並將狀態改為 `true`。
