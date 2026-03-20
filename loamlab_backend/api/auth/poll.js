const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    // CORS 允許 SketchUp 輪詢
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const supabase = createClient(url, key);

    // 查詢這個 Session 是否已經被 callback 頁面標記為 success
    const { data, error } = await supabase
        .from('auth_sessions')
        .select('email, status')
        .eq('id', session_id)
        .single();

    if (error || !data) {
        // 還沒好，或者找不到
        return res.status(200).json({ status: 'pending' });
    }

    if (data.status === 'success') {
        // 成功！順便幫它查詢最新點數一併傳回
        const { data: userData } = await supabase
            .from('users')
            .select('points')
            .eq('email', data.email)
            .single();

        return res.status(200).json({
            status: 'success',
            email: data.email,
            points: userData ? userData.points : 0
        });
    }

    return res.status(200).json({ status: data.status });
}
