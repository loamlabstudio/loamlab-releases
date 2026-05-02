// auth/otp.js — Combined OTP handler
// POST /api/auth/otp?action=send   → send OTP
// POST /api/auth/otp?action=verify → verify OTP
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method not allowed' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Server misconfiguration' });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const action = req.query.action;

    if (action === 'send') {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const { data, error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true }
        });

        if (error) return res.status(400).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'OTP sent to your email' });
    }

    if (action === 'verify') {
        const { email, token } = req.body || {};
        if (!email || !token) return res.status(400).json({ code: -1, msg: 'Missing email or token' });

        const { data, error } = await supabase.auth.verifyOtp({
            email, token, type: 'email'
        });

        if (error) return res.status(400).json({ code: -1, msg: 'Invalid or expired code' });
        if (!data.user) return res.status(400).json({ code: -1, msg: 'Verification failed' });

        return res.status(200).json({
            code: 0,
            email: data.user.email,
            session: data.session
        });
    }

    return res.status(400).json({ code: -1, msg: 'Invalid action. Use ?action=send or ?action=verify' });
}
