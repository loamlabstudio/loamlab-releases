const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method not allowed' });

    const { email } = req.body || {};
    if (!email) return res.status(400).json({ code: -1, msg: '請輸入電子郵件' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Server misconfiguration' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            shouldCreateUser: true
        }
    });

    if (error) {
        return res.status(400).json({ code: -1, msg: error.message });
    }

    return res.status(200).json({ code: 0, msg: '驗證碼已發送至您的信箱 / OTP sent to your email' });
}
