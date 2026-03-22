const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const email = req.query.email || req.headers['x-user-email'];
    if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        let { data, error } = await supabase
            .from('users')
            .select('points, lifetime_points, referral_code, referred_by, subscription_plan, last_topup_at')
            .eq('email', email)
            .single();

        // [Beta 試運營] 自動註冊邏輯：如果用戶不存在，則直接建立
        // ★ 冪等性說明：利用 Supabase users.email 的 UNIQUE 限制，即便發生並發請求，
        // 資料庫也會擋掉重複的 Email 寫入，確保一人僅能領取一次 60 點。
        if (error && error.code === 'PGRST116') { // PGRST116 是單筆查詢查無資料的代碼
            const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                    email: email,
                    points: 60,  // 公測新人禮：60 點（3 張 2K 渲染）
                    referral_code: newReferralCode
                }])
                .select()
                .single();

            if (insertError) {
                return res.status(500).json({ code: -1, msg: `Registration Error: ${insertError.message}` });
            }
            data = newUser;
        } else if (error) {
            return res.status(500).json({ code: -1, msg: `DB: ${error.message}` });
        }

        return res.status(200).json({
            code: 0,
            email,
            points: data ? (data.points || 0) + (data.lifetime_points || 0) : 0,
            subscription_plan: data ? (data.subscription_plan || null) : null,
            last_topup_at: data ? (data.last_topup_at || null) : null,
            referral_code: data ? data.referral_code : null,
            referred_by: data ? data.referred_by : null,
            is_new_user: error && error.code === 'PGRST116' ? true : false
        });
    } catch (e) {
        return res.status(500).json({ code: -1, msg: `Error: ${e.message}` });
    }
}
