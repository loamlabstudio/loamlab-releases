import { createClient } from '@supabase/supabase-js';

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
        // 查詢用戶資料（點數 + 方案等級）
        const { data: userData } = await supabase
            .from('users')
            .select('points, lifetime_points, subscription_plan')
            .eq('email', data.email)
            .single();

        // 裝置數限制檢查
        const PLAN_MAX_DEVICES = { starter: 1, pro: 2, studio: 5 };
        const userPlan = userData?.subscription_plan || null;
        const maxDevices = PLAN_MAX_DEVICES[userPlan] ?? 1;

        const { count } = await supabase
            .from('auth_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('email', data.email)
            .eq('status', 'success')
            .neq('id', session_id)
            .gt('expires_at', new Date().toISOString());

        if (count >= maxDevices) {
            return res.status(200).json({
                status: 'device_limit',
                max_devices: maxDevices,
                current_plan: userPlan,
                message: `Your plan allows ${maxDevices} active device(s). Please log out from another device or upgrade your plan.`
            });
        }

        return res.status(200).json({
            status: 'success',
            email: data.email,
            points: userData ? (userData.points || 0) + (userData.lifetime_points || 0) : 0,
            subscription_plan: userData?.subscription_plan || null
        });
    }

    return res.status(200).json({ status: data.status });
}
