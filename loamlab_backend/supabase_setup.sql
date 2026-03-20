-- ==============================================================================
-- LoamLab AI - Supabase Database Initial Setup Script
-- 請將以下 SQL 代碼貼入您的 Supabase Dashboard -> SQL Editor 中執行
-- 這樣 Vercel 才有資料表可以讀寫用戶的點數餘額！
-- ==============================================================================

-- 1. 建立核心使用者點數資料表 (User Points Table)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    points INTEGER NOT NULL DEFAULT 100, -- 註冊預設贈送 100 點
    total_spent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. 建立交易紀錄表 (用來追蹤儲值或消費)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT REFERENCES public.users(email) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- 正數為儲值，負數為算圖消費
    transaction_type TEXT NOT NULL, -- 'TOPUP', 'RENDER_1K', 'RENDER_4K' 等
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. 建立行級安全策略 (Row Level Security - 理論上可為前端防護，但現在我們走 Vercel 伺服器端可跳過)
-- 不過為了以防萬一未來架構變更，預設開啟：
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- (如果您打算完全只透過 Vercel Service Key 存取，可以建立這條萬用策略)
CREATE POLICY "Enable all access for service role" ON public.users FOR ALL USING (true);
CREATE POLICY "Enable all access for service role" ON public.transactions FOR ALL USING (true);

-- 4. 插入一個測試帳號/*
===================================================
Phase 17: 邀請碼裂變擴充 (Refer & Earn 200+200)
如果您之前已經建立過 users 表，請單獨執行以下這段 ALTER 即可：
===================================================
*/
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_points integer DEFAULT 0;

-- (可選) 針對 referral_code 建立索引以加速查詢
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- 4. 插入一個測試帳號 (可自行修改為您的 Email)
INSERT INTO public.users (email, points)
VALUES ('test@example.com', 500)
ON CONFLICT (email) DO NOTHING;
