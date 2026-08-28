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
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_success_count integer DEFAULT 0;

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
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS kol_ref    TEXT DEFAULT NULL; -- KOL 推廣碼（auth-bridge 傳入，callback 時綁定 referred_by）

/*
===================================================
Feedback System — 反饋系統
===================================================
*/

-- transactions 補 metadata 欄位（記錄 plugin_version, resolution 等）
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- transactions 補美金金額欄位（Webhook 付款時記錄，用於收入統計）
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_usd_cents INTEGER;

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
ALTER TABLE public.user_presets ADD COLUMN IF NOT EXISTS preset_data JSONB DEFAULT '{}';
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

-- ==============================================================================
-- Phase 21: KOL 大使權限標記
-- is_kol = true 才算大使；管理員直接在 Supabase 手動設定
-- referral_code 同樣由管理員手動改為客製化字串（如 JOHN10）
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_kol BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_kol ON public.users(is_kol) WHERE is_kol = true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dodo_discount_code TEXT DEFAULT NULL;

-- ==============================================================================
-- Partner 合夥人角色（內部，不對外公開）
-- is_partner = true 由管理員手動設定；階梯分潤 15%/20%/25%
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_partner BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_partner ON public.users(is_partner) WHERE is_partner = true;

-- ==============================================================================
-- Phase 22: 郵件發送記錄（email_logs）
-- 用於防止同一用戶短期內重複收到相同範本（後端 7 天 dedup 窗口）
-- notify_users API 在發送前查詢此表，發送後寫入；graceful degradation（表不存在時跳過）
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    template_name TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_email_logs_lookup ON public.email_logs(user_email, template_name, sent_at);

-- ==============================================================================
-- Phase 22: users.locale 欄位
-- 選填，記錄用戶慣用語言（如 zh-TW, en-US）
-- notify_users API 依此欄位選擇郵件語言版本；null 預設 zh-TW
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT NULL;

-- ==============================================================================
-- Phase 23: 可編輯郵件範本（email_templates）
-- Admin 在後台編輯主旨/內文（純文字），支援 6 語言；後端套 HTML 殼發送
-- notify_users 優先讀 DB，找不到 fallback 硬碼預設值
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.email_templates (
    id TEXT PRIMARY KEY,                   -- 'onboarding' | 'reengagement' | 'upgrade'
    subject_tw TEXT NOT NULL DEFAULT '',
    subject_en TEXT NOT NULL DEFAULT '',
    subject_cn TEXT NOT NULL DEFAULT '',
    subject_es TEXT NOT NULL DEFAULT '',
    subject_br TEXT NOT NULL DEFAULT '',
    subject_jp TEXT NOT NULL DEFAULT '',
    body_tw    TEXT NOT NULL DEFAULT '',
    body_en    TEXT NOT NULL DEFAULT '',
    body_cn    TEXT NOT NULL DEFAULT '',
    body_es    TEXT NOT NULL DEFAULT '',
    body_br    TEXT NOT NULL DEFAULT '',
    body_jp    TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_rw" ON public.email_templates FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- Phase 24: 訂閱挽留系統（Cancel Flow / Save Offer / Dunning）
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dodo_subscription_id TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS retention_offer_used BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_paused_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- ==============================================================================
-- Phase 25: Webhook 失敗審計表（webhook_errors）
-- 每次 processTopup 拋例外時寫入，確保付款資料永不丟失
-- 查詢未處理失敗：SELECT * FROM webhook_errors ORDER BY created_at DESC;
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_errors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform    TEXT NOT NULL,           -- 'DODO' | 'LS'
    event_type  TEXT NOT NULL,           -- 'payment.succeeded' 等
    order_id    TEXT,                    -- payment_id 或 subscription_id
    customer_email TEXT,
    error_message  TEXT,
    raw_payload    TEXT,                 -- 原始 JSON（最多 8000 字）
    resolved    BOOLEAN DEFAULT false,   -- 手動標記已處理
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
ALTER TABLE public.webhook_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_rw" ON public.webhook_errors FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- Phase 26: Disk IO 優化索引
-- 解決 transactions / feedback 全表掃描導致 Supabase IO 超出預算
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_transactions_type       ON public.transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created    ON public.transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_email      ON public.transactions (user_email);
CREATE INDEX IF NOT EXISTS idx_transactions_type_created ON public.transactions (transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type           ON public.feedback (type);
CREATE INDEX IF NOT EXISTS idx_feedback_created        ON public.feedback (created_at DESC);

-- ==============================================================================
-- Phase 27: webhook_errors 加 email_sent 欄位（激活失敗通知防重複）
-- ==============================================================================
ALTER TABLE public.webhook_errors ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT false;

-- ==============================================================================
-- Phase 28: Dunning 扣款失敗狀態欄位
-- payment_failed = true 時 UI 顯示警告橫幅引導更新付款資訊
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS payment_failed BOOLEAN DEFAULT false;

-- ==============================================================================
-- Phase 29: 訂閱升降級支援
-- next_plan：降級期末生效時暫存新方案名稱，subscription.renewed 清除
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS next_plan TEXT DEFAULT NULL;

-- ==============================================================================
-- Phase 30: webhook_errors 加 status 欄位（無主訂單追蹤）
-- 'error' = 一般錯誤；'unclaimed' = 付款成功但 email 缺失/匿名，需人工歸戶
-- 查詢無主訂單：SELECT * FROM webhook_errors WHERE status = 'unclaimed' ORDER BY created_at DESC;
-- ==============================================================================
ALTER TABLE public.webhook_errors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'error';

-- ==============================================================================
-- Phase 31: 訂閱狀態單一事實來源重構
-- subscription_period_end：直接鏡射 Dodo subscription.next_billing_date，
-- 讓前端能顯示確切的退訂/續訂日期，取代原本只有布林值的 cancel_pending。
-- 同時取代 subscription_paused_until 的用途（挽留暫停改為延後 next_billing_date，
-- 不再呼叫不存在的 Dodo /pause 端點）；該舊欄位保留但不再寫入，避免非必要的破壞性 migration。
-- ==============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- ==============================================================================
-- Phase 32: 輕量 Rate Limiting（供 lib/rateLimit.js 使用）
-- Serverless function 每次呼叫都是全新 process，記憶體變數擋不住暴力請求，
-- 改用這張表存滑動視窗計數。目前只接在 auth/otp.js 的 send/verify 動作，
-- 防止 email 轟炸與 OTP 驗證碼暴力猜測。
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
    bucket_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ==============================================================================
-- Phase 33: system_config 表（把系統設定從 transactions 拆分出來）
-- 背景：SYSTEM_CONFIG / SYSTEM_PROMPTS / SYSTEM_T1_NODES / MODEL_CONFIG /
-- SYSTEM_OPTIONS / SYSTEM_BUNDLES / SYSTEM_ENGINE_CONFIG / SYSTEM_SHARE_TEMPLATE
-- 這 8 種系統設定原本每次存檔都是往 transactions 表 INSERT 一列新的，用
-- created_at DESC LIMIT 1 撈「最新」，跟真正的財務流水帳（RENDER_*/TOPUP_*/
-- REFUND_*）混在同一張表，財務稽核查詢都要額外過濾 transaction_type，這張
-- 表也只會無限成長。改成：
--   system_config     目前生效的設定，每個 key 一列，UPSERT，O(1) 查詢
--   system_config_log 每次變更的歷史記錄（append-only，供之後做設定變更
--                      歷史介面用；查詢路徑不依賴這張表，寫入失敗不影響主流程）
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.system_config_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_system_config_log_key ON public.system_config_log(key, created_at DESC);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.system_config;
CREATE POLICY "Enable all access for service role" ON public.system_config FOR ALL USING (true);
DROP POLICY IF EXISTS "Enable all access for service role" ON public.system_config_log;
CREATE POLICY "Enable all access for service role" ON public.system_config_log FOR ALL USING (true);

-- 一次性資料遷移：把 transactions 裡目前最新的 8 種系統設定搬進 system_config。
-- 用 ON CONFLICT DO UPDATE，可重複執行不會出錯（例如先跑過一次、之後又想重新校正）。
INSERT INTO public.system_config (key, value, updated_at)
SELECT DISTINCT ON (transaction_type)
    transaction_type,
    metadata,
    created_at
FROM public.transactions
WHERE transaction_type IN (
    'SYSTEM_CONFIG', 'SYSTEM_PROMPTS', 'SYSTEM_T1_NODES', 'MODEL_CONFIG',
    'SYSTEM_OPTIONS', 'SYSTEM_BUNDLES', 'SYSTEM_ENGINE_CONFIG', 'SYSTEM_SHARE_TEMPLATE'
)
ORDER BY transaction_type, created_at DESC
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

-- ==============================================================================
-- Phase 34: processTopup 原子加點 RPC（修 Webhook Race Condition）+ Dodo 對賬欄位
-- 背景：deduct_render_points（算圖扣點）已用 FOR UPDATE 鎖列做到原子操作，但
-- lib/activate.js 的 processTopup（webhook 發點路徑）一直是純 JS 的
-- read-then-write：查 user.points/lifetime_points → 算新值 → update。webhook
-- 重送、verify_payment 手動觸發、cron 對賬三條路徑都可能同時打同一個 email，
-- 後寫的會蓋掉先寫的，點數可能悄悄流失。改成同一種 FOR UPDATE 鎖列模式的
-- RPC，讓「加點」也變成原子操作，跟 deduct_render_points 對稱。
-- ==============================================================================
CREATE OR REPLACE FUNCTION apply_points_delta(
  p_email TEXT,
  p_set_monthly INT DEFAULT NULL,      -- 非 NULL 時覆寫 points（訂閱 use-it-or-lose-it）
  p_add_lifetime INT DEFAULT 0,        -- lifetime_points 增量（單次購買/推薦獎勵）
  p_add_referral_count INT DEFAULT 0   -- referral_success_count 增量
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prev_monthly   INT;
  v_prev_lifetime  INT;
  v_prev_referral  INT;
BEGIN
  SELECT COALESCE(points, 0), COALESCE(lifetime_points, 0), COALESCE(referral_success_count, 0)
    INTO v_prev_monthly, v_prev_lifetime, v_prev_referral
    FROM users
   WHERE email = p_email
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  UPDATE users SET
    points = CASE WHEN p_set_monthly IS NOT NULL THEN p_set_monthly ELSE points END,
    lifetime_points = lifetime_points + p_add_lifetime,
    referral_success_count = referral_success_count + p_add_referral_count
  WHERE email = p_email;

  RETURN json_build_object(
    'success', true,
    'prev_monthly', v_prev_monthly,
    'prev_lifetime', v_prev_lifetime,
    'prev_referral', v_prev_referral,
    'points', COALESCE(p_set_monthly, v_prev_monthly),
    'lifetime_points', v_prev_lifetime + p_add_lifetime
  );
END;
$$;

-- Dodo 對賬用：儲存 Dodo 的 customer_id（非 email），供未來查詢 balance/回報 usage 用
ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_customer_id TEXT DEFAULT NULL;

-- ==============================================================================
-- Phase 35: 自訂 Node (userChips) 綁定帳號
-- 背景：userChips 原本只存前端 localStorage，SketchUp 內嵌瀏覽器核心重啟時常清空
-- 快取，導致自訂節點遺失並被過濾機制一併清除已選取值。改存資料庫與帳號綁定。
-- ==============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_chips JSONB DEFAULT '{}'::jsonb;

-- ==============================================================================
-- Phase 36: 退款一律退回 lifetime_points（第一性原理修正）
-- 背景：render.js 的退款是呼叫 deduct_render_points 傳負數金額重用扣款邏輯，但扣款邏輯是
-- 「月配額不夠才動用永久點數」，退款卻永遠退回月配額——如果原本扣的其實是永久點數，
-- 退款會被誤放進月配額，只要在下次訂閱續訂前沒花完，續訂當下 apply_points_delta 的
-- p_set_monthly 會覆寫（use-it-or-lose-it）月配額，退款就此憑空消失。
-- 修法：不猜原本扣的是哪個桶，退款一律進 lifetime_points（永久、不會被續訂覆寫）——
-- 對用戶只會更好不會更差（多數情況下退款金額原本就该是永久點數；即使原本真的是月配額，
-- 使用者換到不會過期的永久點數也不吃虧），比精確追蹤扣款分桶簡單且不會有漏洞。
-- ==============================================================================
CREATE OR REPLACE FUNCTION deduct_render_points(p_email TEXT, p_cost INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly  INT;
  v_lifetime INT;
BEGIN
  SELECT COALESCE(points, 0), COALESCE(lifetime_points, 0)
    INTO v_monthly, v_lifetime
    FROM users
   WHERE email = p_email
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF p_cost < 0 THEN
    UPDATE users SET lifetime_points = v_lifetime - p_cost WHERE email = p_email;
    RETURN json_build_object('success', true, 'points', v_monthly, 'lifetime_points', v_lifetime - p_cost);
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
-- Phase 37: 數據版塊第一性重建 (Analytics Revamp)
-- 將業務邏輯與數據紀錄解耦，提供真實的銷量、成本與活躍度。
-- ==============================================================================

-- 1. 真實活躍度：新增 last_active_at，每次授權 API 呼叫時更新
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. 真實銷量 (Revenue)：獨立 payments 表，脫離點數流水表 (transactions)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    order_id TEXT UNIQUE NOT NULL,       -- Stripe/Dodo 的真實訂單號或 Subscription Invoice ID
    amount_usd_cents INTEGER NOT NULL,   -- 真實法幣金額
    status TEXT NOT NULL DEFAULT 'paid', -- 'paid' | 'refunded' | 'chargeback'
    payment_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_payments_email ON public.payments(user_email);
CREATE INDEX IF NOT EXISTS idx_payments_created ON public.payments(created_at DESC);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.payments;
CREATE POLICY "Enable all access for service role" ON public.payments FOR ALL USING (true);

-- 3. 埋點專用表 (Telemetry)：解耦業務表
CREATE TABLE IF NOT EXISTS public.telemetry_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT,
    event_type TEXT NOT NULL,          -- 'paywall_trigger', 'SHARE_SESSION', 'LEAD_CAPTURE', etc.
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_telemetry_type ON public.telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON public.telemetry_events(created_at DESC);
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.telemetry_events;
CREATE POLICY "Enable all access for service role" ON public.telemetry_events FOR ALL USING (true);

-- 4. 真實成本 (Cost)：擴充 render_history 追蹤 API 供應商成本
ALTER TABLE public.render_history ADD COLUMN IF NOT EXISTS provider_id TEXT DEFAULT 'replicate';
ALTER TABLE public.render_history ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
ALTER TABLE public.render_history ADD COLUMN IF NOT EXISTS provider_cost_usd_cents INTEGER;

-- 5. 效能優化：每日聚合表 (Materialized view pattern for dashboard)
CREATE TABLE IF NOT EXISTS public.daily_metrics (
    date DATE PRIMARY KEY,
    active_users INTEGER DEFAULT 0,
    total_renders INTEGER DEFAULT 0,
    revenue_usd_cents INTEGER DEFAULT 0,
    refund_usd_cents INTEGER DEFAULT 0,
    cost_usd_cents INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for service role" ON public.daily_metrics;
CREATE POLICY "Enable all access for service role" ON public.daily_metrics FOR ALL USING (true);
