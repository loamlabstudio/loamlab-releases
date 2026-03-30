const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method not allowed' });

    const { email, token } = req.body || {};
    if (!email || !token) return res.status(400).json({ code: -1, msg: '請填寫完整的 Email 與驗證碼' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Server misconfiguration' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
    });

    if (error) {
        return res.status(400).json({ code: -1, msg: '驗證碼錯誤或已過期 / Invalid or expired code' });
    }

    if (!data.user) {
        return res.status(400).json({ code: -1, msg: '驗證失敗 / Verification failed' });
    }

    // 驗證成功後直接回傳 user email 給前端，前端即完成登入
    return res.status(200).json({
        code: 0,
        email: data.user.email,
        session: data.session
    });
}
