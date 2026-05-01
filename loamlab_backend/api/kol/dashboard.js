import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing SUPABASE env vars' });
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: kol } = await supabase.from('users')
        .select('referral_code, referral_success_count')
        .eq('email', email)
        .maybeSingle();

    if (!kol?.referral_code) return res.status(404).json({ error: 'KOL not found or no referral code' });

    const totalPaid = kol.referral_success_count || 0;
    let currentTier, currentRate, nextTierAt, nextTierNeeded;
    if (totalPaid < 50) {
        currentTier = 1; currentRate = 0.05; nextTierAt = 50; nextTierNeeded = 50 - totalPaid;
    } else if (totalPaid < 100) {
        currentTier = 2; currentRate = 0.10; nextTierAt = 100; nextTierNeeded = 100 - totalPaid;
    } else {
        currentTier = 3; currentRate = 0.15; nextTierAt = null; nextTierNeeded = 0;
    }

    // T+15 冷卻期計算
    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    const { data: ledger } = await supabase.from('kol_ledger')
        .select('commission_amount, status, created_at')
        .eq('kol_email', email);

    let pendingCommission = 0;
    let clearedCommission = 0;
    for (const row of (ledger || [])) {
        if (row.status === 'pending') {
            if (row.created_at < cutoff) {
                clearedCommission += row.commission_amount;
            } else {
                pendingCommission += row.commission_amount;
            }
        } else if (row.status === 'ready_to_pay') {
            clearedCommission += row.commission_amount;
        }
    }

    return res.json({
        kol_code: kol.referral_code,
        total_paid_referrals: totalPaid,
        current_tier: currentTier,
        current_rate: currentRate,
        next_tier_at: nextTierAt,
        next_tier_needed: nextTierNeeded,
        pending_commission: pendingCommission,
        cleared_commission: clearedCommission
    });
}
