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
DROP POLICY IF EXISTS "Enable all access for service role" ON public.users;
CREATE POLICY "Enable all access for service role" ON public.users FOR ALL USING (true);
DROP POLICY IF EXISTS "Enable all access for service role" ON public.transactions;
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

/*
===================================================
Phase 18: auth_sessions + 方案特權差異化擴充
請在 Supabase Dashboard -> SQL Editor 執行此段
===================================================
*/

-- auth_sessions 表（OAuth 登入輪詢 + 裝置追蹤雙用途）
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',  -- 'pending' | 'success' | 'expired'
    device_id   TEXT,                    -- 裝置識別（未來擴充用）
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_email ON public.auth_sessions(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_status ON public.auth_sessions(status);

-- 開放 RLS 存取
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.auth_sessions;
CREATE POLICY "Enable all access for service role" ON public.auth_sessions FOR ALL USING (true);

-- users 表補欄位
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_beta_tester    BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip     TEXT DEFAULT NULL; -- IP Pinning 紀錄
-- subscription_plan 值：NULL（無訂閱）| 'starter' | 'pro' | 'studio'

-- transactions 表補 order_id（Webhook 冪等鍵）
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id) WHERE order_id IS NOT NULL;

/*
===================================================
Phase 18b: auth_sessions 補全欄位（若表在早期版本創建）
請在 Supabase Dashboard -> SQL Editor 執行此段
===================================================
*/

-- 若 auth_sessions 在 email 欄位加入前已存在，補加欄位
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS email      TEXT;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days';

/*
===================================================
Feedback System — 反饋系統
===================================================
*/

-- transactions 補 metadata 欄位（記錄 plugin_version, resolution 等）
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 建立 feedback 表
CREATE TABLE IF NOT EXISTS public.feedback (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email     TEXT,
  type           TEXT NOT NULL,        -- 'rating' | 'error_report' | 'general'
  rating         INTEGER,              -- 5 = 讚，1 = 差評（可 NULL）
  content        TEXT,                 -- 用戶文字（可 NULL）
  tags           TEXT[],               -- 差評標籤，如 ['style_wrong', 'detail_missing']
  transaction_id UUID,                 -- 關聯到 transactions.id
  metadata       JSONB DEFAULT '{}',   -- plugin_version, resolution, error_code 等
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.feedback;
CREATE POLICY "Enable all access for service role" ON public.feedback FOR ALL USING (true);

/*
===================================================
Phase 19: 原子扣款 RPC — 防止並發 Race Condition
在 Supabase Dashboard → SQL Editor 執行此段
===================================================
*/

-- 瀑布流原子扣款：月費點數 (points) 優先，不足再扣永久點數 (lifetime_points)
-- SECURITY DEFINER 使函數以建立者權限執行，繞過 RLS，可用 anon key 呼叫
/*
===================================================
護城河強化：用戶風格庫 + 渲染歷史（切換成本護城河）
在 Supabase Dashboard → SQL Editor 執行此段
===================================================
*/

-- 用戶個人風格預設庫
CREATE TABLE IF NOT EXISTS public.user_presets (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  TEXT NOT NULL REFERENCES public.users(email) ON DELETE CASCADE,
  name        TEXT NOT NULL,          -- 預設名稱，如「我的北歐極簡」
  prompt      TEXT,
  style       TEXT,
  resolution  TEXT,
  tool_id     INT DEFAULT 1,          -- 1=真實渲染 2=SpaceReform 3=九宮格
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_presets_email ON public.user_presets(user_email);
ALTER TABLE public.user_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.user_presets;
CREATE POLICY "Enable all access for service role" ON public.user_presets FOR ALL USING (true);

-- 渲染歷史記錄
CREATE TABLE IF NOT EXISTS public.render_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email   TEXT NOT NULL REFERENCES public.users(email) ON DELETE CASCADE,
  input_url    TEXT,                  -- 原始輸入圖片 URL（數據飛輪用）
  thumbnail_url TEXT,                 -- freeimage.host 縮圖 URL
  full_url     TEXT,                  -- 完整圖片 URL
  prompt       TEXT,
  style        TEXT,
  resolution   TEXT,
  tool_id      INT DEFAULT 1,
  points_cost  INT,
  user_rating  INT,                   -- 1-5（未來 LoRA 數據飛輪用）
  is_approved  BOOLEAN DEFAULT FALSE, -- 用戶標記「這張很好」
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_render_history_email ON public.render_history(user_email);
CREATE INDEX IF NOT EXISTS idx_render_history_created ON public.render_history(created_at DESC);
ALTER TABLE public.render_history ENABLE ROW LEVEL SECURITY;
-- 若表已存在，補上新欄位（冪等操作）
ALTER TABLE public.render_history ADD COLUMN IF NOT EXISTS input_url TEXT;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.render_history;
CREATE POLICY "Enable all access for service role" ON public.render_history FOR ALL USING (true);

CREATE OR REPLACE FUNCTION deduct_render_points(p_email TEXT, p_cost INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly  INT;
  v_lifetime INT;
BEGIN
  -- 鎖定列，防止並發請求同時讀取相同餘額
  SELECT COALESCE(points, 0), COALESCE(lifetime_points, 0)
    INTO v_monthly, v_lifetime
    FROM users
   WHERE email = p_email
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF (v_monthly + v_lifetime) < p_cost THEN
    RETURN json_build_object(
      'success', false,
      'error',   'insufficient_points',
      'balance', v_monthly + v_lifetime
    );
  END IF;

  IF v_monthly >= p_cost THEN
    UPDATE users SET points = v_monthly - p_cost WHERE email = p_email;
    RETURN json_build_object('success', true, 'points', v_monthly - p_cost, 'lifetime_points', v_lifetime);
  ELSE
    UPDATE users SET points = 0, lifetime_points = v_lifetime - (p_cost - v_monthly) WHERE email = p_email;
    RETURN json_build_object('success', true, 'points', 0, 'lifetime_points', v_lifetime - (p_cost - v_monthly));
  END IF;
END;
$$;

-- ==============================================================================
-- KOL 分潤帳本 (kol_ledger) — KOL Commission Ledger
-- 每次付款成功時寫入快照；T+15 天後由管理員腳本推進至 ready_to_pay
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.kol_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kol_code TEXT NOT NULL,
    kol_email TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    amount_paid INTEGER NOT NULL,
    commission_rate NUMERIC(4,2) NOT NULL,
    commission_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kol_ledger_kol_email ON public.kol_ledger (kol_email);
CREATE INDEX IF NOT EXISTS idx_kol_ledger_status ON public.kol_ledger (status);
CREATE INDEX IF NOT EXISTS idx_kol_ledger_created ON public.kol_ledger (created_at);

ALTER TABLE public.kol_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.kol_ledger;
CREATE POLICY "Enable all access for service role" ON public.kol_ledger FOR ALL USING (true);
