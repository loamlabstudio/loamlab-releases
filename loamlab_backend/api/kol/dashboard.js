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

    // Tier 1: 1-50人 5%；Tier 2: 51-100人 10%；Tier 3: >100人 15%
    const totalPaid = kol.referral_success_count || 0;
    let currentTier, currentRate, nextTierNeeded, progressToNextTier;
    if (totalPaid <= 50) {
        currentTier = 1; currentRate = '5%';
        nextTierNeeded = 51 - totalPaid;
        progressToNextTier = { needed: 51, remaining: nextTierNeeded };
    } else if (totalPaid <= 100) {
        currentTier = 2; currentRate = '10%';
        nextTierNeeded = 101 - totalPaid;
        progressToNextTier = { needed: 101, remaining: nextTierNeeded };
    } else {
        currentTier = 3; currentRate = '15%';
        progressToNextTier = null;
    }

    // T+15 冷卻期計算
    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    const { data: ledger } = await supabase.from('kol_ledger')
        .select('commission_amount, status, created_at')
        .eq('kol_email', email);

    let pendingCoolingOff = 0;
    let readyToWithdraw = 0;
    let totalWithdrawn = 0;
    for (const row of (ledger || [])) {
        if (row.status === 'pending') {
            if (row.created_at < cutoff) {
                readyToWithdraw += row.commission_amount;
            } else {
                pendingCoolingOff += row.commission_amount;
            }
        } else if (row.status === 'ready_to_pay') {
            readyToWithdraw += row.commission_amount;
        } else if (row.status === 'paid') {
            totalWithdrawn += row.commission_amount;
        }
    }

    return res.json({
        kol_code: kol.referral_code,
        total_paid_users: totalPaid,
        current_tier: currentTier,
        current_commission_rate: currentRate,
        progress_to_next_tier: progressToNextTier,
        earnings: {
            pending_cooling_off: pendingCoolingOff,
            ready_to_withdraw: readyToWithdraw,
            total_withdrawn: totalWithdrawn
        }
    });
}
