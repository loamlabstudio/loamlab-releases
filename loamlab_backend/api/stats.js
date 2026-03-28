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

        // 2. 取得點數統計
        const { data: pointsData, error: pointsErr } = await supabase
            .from('users')
            .select('points, lifetime_points');

        if (pointsErr) throw pointsErr;

        const totalPointsIssued = pointsData.reduce((acc, user) => {
            return acc + (user.points || 0) + (user.lifetime_points || 0);
        }, 0);

        // 3. 按解析度分級計算真實節省小時數（供行銷網頁 ticker 使用）
        // 1K × 1.5h、2K × 3h、4K × 5h（保守估計，對應傳統渲染工時）
        const [r1k, r2k, r4k] = await Promise.all([
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_1K'),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_2K'),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_4K'),
        ]);
        const hoursSaved = Math.floor(
            (r1k.count ?? 0) * 1.5 +
            (r2k.count ?? 0) * 3 +
            (r4k.count ?? 0) * 5
        );

        // 4. 回傳統計數據
        return res.status(200).json({
            code: 0,
            status: "healthy",
            hours_saved: hoursSaved,
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
