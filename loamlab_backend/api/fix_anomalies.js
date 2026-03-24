import { createClient } from '@supabase/supabase-js';

const ADMIN_KEY = process.env.ADMIN_KEY;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    // Admin key — always required
    const keyParam = req.query.key || req.headers['x-admin-key'];
    if (!ADMIN_KEY || keyParam !== ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Find all users with negative points or lifetime_points
    const { data: anomalies, error: fetchErr } = await supabase
        .from('users')
        .select('email, points, lifetime_points')
        .or('points.lt.0,lifetime_points.lt.0');

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    if (!anomalies || anomalies.length === 0) {
        return res.status(200).json({ ok: true, fixed: 0, message: 'No anomalies found' });
    }

    const fixed = [];
    for (const user of anomalies) {
        const updates = {};
        if ((user.points ?? 0) < 0) updates.points = 0;
        if ((user.lifetime_points ?? 0) < 0) updates.lifetime_points = 0;

        const { error: updateErr } = await supabase
            .from('users')
            .update(updates)
            .eq('email', user.email);

        if (!updateErr) {
            fixed.push({
                email: user.email,
                was: { points: user.points, lifetime_points: user.lifetime_points },
                now: updates
            });
        } else {
            console.warn(`[fix_anomalies] 無法修復 ${user.email}:`, updateErr.message);
        }
    }

    return res.status(200).json({ ok: true, fixed: fixed.length, records: fixed });
}
