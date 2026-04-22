// materials.js — User Material Library API
// GET  /api/materials           — list user's saved materials
// POST /api/materials           — save a material (upsert by id)
// DELETE /api/materials?id=xxx  — delete a material by id

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ code: -1, msg: 'Server misconfigured' });

    const supabase = createClient(supabaseUrl, supabaseKey);

    const userEmail = req.headers['x-user-email'] || req.body?.email;
    if (!userEmail) return res.status(401).json({ code: -1, msg: 'Missing email' });

    // IP Pinning 驗證
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (clientIp !== 'unknown') {
        const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', userEmail).maybeSingle();
        if (!userRow || !userRow.last_login_ip || userRow.last_login_ip !== clientIp) {
            return res.status(401).json({ code: -1, msg: '登入憑證已過期或網路變更，請重新登入' });
        }
    }
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('user_materials')
            .select('id, name, thumbnail, created_at')
            .eq('user_email', userEmail)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, materials: data || [] });
    }

    if (req.method === 'POST') {
        const { id, name, thumbnail } = req.body || {};
        if (!id || !name || !thumbnail) return res.status(400).json({ code: -1, msg: 'Missing id, name, or thumbnail' });

        // 分級上限強制：免費用戶最多 20 筆
        const { data: userRow } = await supabase
            .from('users').select('subscription_plan').eq('email', userEmail).single();
        const isPaid = userRow?.subscription_plan === 'pro' || userRow?.subscription_plan === 'studio';
        const maxItems = isPaid ? 200 : 20;

        const { count } = await supabase
            .from('user_materials').select('id', { count: 'exact', head: true }).eq('user_email', userEmail);
        if ((count || 0) >= maxItems) {
            // FIFO：刪除最舊的一筆
            const { data: oldest } = await supabase
                .from('user_materials').select('id').eq('user_email', userEmail)
                .order('created_at', { ascending: true }).limit(1).single();
            if (oldest) await supabase.from('user_materials').delete().eq('id', oldest.id);
        }

        const { error } = await supabase.from('user_materials').upsert([{
            id, user_email: userEmail, name, thumbnail, created_at: new Date().toISOString()
        }]);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0 });
    }

    if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ code: -1, msg: 'Missing id' });
        const { error } = await supabase
            .from('user_materials').delete().eq('id', id).eq('user_email', userEmail);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0 });
    }

    return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
}
