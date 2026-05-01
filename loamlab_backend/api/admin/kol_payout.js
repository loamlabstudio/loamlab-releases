import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const adminKey = req.query.key || req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { action = 'list' } = req.query;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing SUPABASE env vars' });
    const supabase = createClient(supabaseUrl, supabaseKey);

    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    if (action === 'list') {
        const { data, error } = await supabase.from('kol_ledger')
            .select('*')
            .eq('status', 'pending')
            .lt('created_at', cutoff)
            .order('kol_email')
            .order('created_at');
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ count: data.length, records: data });
    }

    if (action === 'settle') {
        const { data: toSettle, error: fetchErr } = await supabase.from('kol_ledger')
            .select('id')
            .eq('status', 'pending')
            .lt('created_at', cutoff);
        if (fetchErr) return res.status(500).json({ error: fetchErr.message });
        if (!toSettle?.length) return res.json({ settled: 0 });

        const ids = toSettle.map(r => r.id);
        const { error: updateErr } = await supabase.from('kol_ledger')
            .update({ status: 'ready_to_pay' })
            .in('id', ids);
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.json({ settled: ids.length });
    }

    if (action === 'export') {
        const { data, error } = await supabase.from('kol_ledger')
            .select('kol_code,kol_email,buyer_email,transaction_id,amount_paid,commission_rate,commission_amount,status,created_at')
            .in('status', ['pending', 'ready_to_pay'])
            .order('kol_email')
            .order('created_at');
        if (error) return res.status(500).json({ error: error.message });

        const header = 'kol_code,kol_email,buyer_email,transaction_id,amount_paid_cents,commission_rate,commission_amount_cents,status,created_at';
        const rows = (data || []).map(r =>
            [r.kol_code, r.kol_email, r.buyer_email, r.transaction_id, r.amount_paid, r.commission_rate, r.commission_amount, r.status, r.created_at].join(',')
        );
        const csv = [header, ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="kol_payout_${Date.now()}.csv"`);
        return res.send(csv);
    }

    // mark_paid: 管理員確認匯款後，將 ready_to_pay 轉為 paid（記入 total_withdrawn）
    if (action === 'mark_paid') {
        const { ids } = req.query;
        if (!ids) return res.status(400).json({ error: 'Missing ids (comma-separated UUIDs)' });
        const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
        if (!idList.length) return res.status(400).json({ error: 'Empty id list' });
        const { error: updateErr } = await supabase.from('kol_ledger')
            .update({ status: 'paid' })
            .in('id', idList)
            .eq('status', 'ready_to_pay');
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.json({ marked_paid: idList.length });
    }

    return res.status(400).json({ error: 'Invalid action. Use: list | settle | export | mark_paid' });
}
