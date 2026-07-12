// 一次性補償腳本：maggieliu@yoshin-design.com 單次購買未入帳 + 雙倍補償
// 執行：cd loamlab_backend && node scripts/compensate_maggieliu.mjs
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

try {
    readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) {}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL = 'maggieliu@yoshin-design.com';
const ORDER_ID = 'COMPENSATE_pay_0Niy9PtFIXXMbHFpJEWIa';
const COMPENSATE_POINTS = 400; // 200 原始購買 + 200 雙倍補償

async function run() {
    const { data: existing } = await sb.from('transactions').select('id').eq('order_id', ORDER_ID).maybeSingle();
    if (existing) {
        console.log('已補償過，order_id 已存在，跳過。');
        return;
    }

    const { data: user, error: userErr } = await sb.from('users')
        .select('email, points, lifetime_points').eq('email', EMAIL).maybeSingle();
    if (userErr || !user) {
        console.error('❌ 找不到用戶:', EMAIL, userErr?.message);
        return;
    }

    const newLifetime = (user.lifetime_points || 0) + COMPENSATE_POINTS;
    const { error: updateErr } = await sb.from('users')
        .update({ lifetime_points: newLifetime, last_topup_at: new Date().toISOString() })
        .eq('email', EMAIL);
    if (updateErr) {
        console.error('❌ 更新點數失敗:', updateErr.message);
        return;
    }

    const { error: txErr } = await sb.from('transactions').insert([{
        user_email: EMAIL,
        amount: COMPENSATE_POINTS,
        transaction_type: 'TOPUP_SINGLE',
        order_id: ORDER_ID,
        amount_usd_cents: 0,
    }]);
    if (txErr) {
        console.error('🔴 交易紀錄寫入失敗，嘗試回滾點數:', txErr.message);
        await sb.from('users').update({ lifetime_points: user.lifetime_points || 0 }).eq('email', EMAIL);
        return;
    }

    console.log(`✅ 補償完成: ${EMAIL} lifetime_points ${user.lifetime_points || 0} → ${newLifetime} (+${COMPENSATE_POINTS})`);
}

run();
