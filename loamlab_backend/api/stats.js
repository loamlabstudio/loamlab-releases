import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    // CDN 快取 60s，背景 revalidate 120s — ticker 不需要即時精確
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 全部並行
        const [
            { count: totalUsers, error: countErr },
            { data: pointsData, error: pointsErr },
            { count: c1k }, { count: c2k }, { count: c4k }
        ] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('points, lifetime_points'),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_1K'),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_2K'),
            supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_4K'),
        ]);

        if (countErr) throw countErr;
        if (pointsErr) throw pointsErr;

        const totalPointsIssued = (pointsData ?? []).reduce((acc, u) =>
            acc + (u.points || 0) + (u.lifetime_points || 0), 0);

        // 1K × 1.5h、2K × 3h、4K × 5h
        const hoursSaved = Math.floor((c1k ?? 0) * 1.5 + (c2k ?? 0) * 3 + (c4k ?? 0) * 5);

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
