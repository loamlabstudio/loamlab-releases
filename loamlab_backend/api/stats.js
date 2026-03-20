const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. 取得總用戶數
        const { count: totalUsers, error: countErr } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (countErr) throw countErr;

        // 2. 取得點數統計 (points + lifetime_points)
        const { data: pointsData, error: pointsErr } = await supabase
            .from('users')
            .select('points, lifetime_points');

        if (pointsErr) throw pointsErr;

        const totalPointsIssued = pointsData.reduce((acc, user) => {
            return acc + (user.points || 0) + (user.lifetime_points || 0);
        }, 0);

        // 3. 回傳統計數據
        return res.status(200).json({
            code: 0,
            status: "healthy",
            stats: {
                total_users: totalUsers,
                total_points_issued: totalPointsIssued,
                timestamp: new Date().toISOString()
            }
        });
    } catch (e) {
        return res.status(500).json({ code: -1, msg: `Stats Error: ${e.message}` });
    }
}
