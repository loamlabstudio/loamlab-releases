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

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ code: -1, msg: 'Server misconfigured' });

    const userEmail = req.headers['x-user-email'];
    if (!userEmail) return res.status(401).json({ code: -1, msg: 'Missing X-User-Email' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
