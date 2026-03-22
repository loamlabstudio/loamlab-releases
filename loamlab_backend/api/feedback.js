import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { type, rating, content, tags, transaction_id, metadata } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });

    const userEmail = req.headers['x-user-email'] || null;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    const { error } = await supabase.from('feedback').insert([{
        user_email: userEmail,
        type,
        rating: rating ?? null,
        content: content || null,
        tags: tags || null,
        transaction_id: transaction_id || null,
        metadata: metadata || {}
    }]);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
}
