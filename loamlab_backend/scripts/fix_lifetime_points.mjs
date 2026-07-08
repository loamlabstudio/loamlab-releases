// SPRINT.md TASK 4：校正 lifetime_points 溢發問題（activate.js 雙重發放漏洞造成）。
//
// 保守單向修正：只計算「理論上限」= 該用戶所有 TOPUP_SINGLE / REFERRAL_PAID_A / REFERRAL_PAID_B
// 交易金額加總（這些是唯一會增加 lifetime_points 的交易類型）。歷史 RENDER_* 扣點紀錄沒有區分
// 扣的是 points 池還是 lifetime_points 池，無法精確重建每人「現在應該剩多少」，所以不猜測往下修；
// 只有當目前 lifetime_points 明確超過理論上限（不可能發生，必為 bug 造成）時才下修到上限，
// 其餘一律不動。
//
// 用法：
//   node scripts/fix_lifetime_points.mjs            → dry-run，只印報告，不寫入
//   node scripts/fix_lifetime_points.mjs --apply     → 實際寫入 Supabase

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

try {
    readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) {}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ 未讀到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（請在 loamlab_backend/ 下執行，且 .env.local 存在）');
    process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const APPLY = process.argv.includes('--apply');

const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('email, lifetime_points')
    .not('email', 'ilike', '%test%');
if (usersErr) { console.error('查詢 users 失敗:', usersErr.message); process.exit(1); }

const { data: txs, error: txErr } = await supabase
    .from('transactions')
    .select('user_email, amount, transaction_type')
    .in('transaction_type', ['TOPUP_SINGLE', 'REFERRAL_PAID_A', 'REFERRAL_PAID_B']);
if (txErr) { console.error('查詢 transactions 失敗:', txErr.message); process.exit(1); }

const theoreticalMax = {};
for (const t of txs || []) {
    theoreticalMax[t.user_email] = (theoreticalMax[t.user_email] || 0) + (t.amount || 0);
}

const overages = [];
for (const u of users || []) {
    const current = u.lifetime_points || 0;
    const max = theoreticalMax[u.email] || 0;
    if (current > max) {
        overages.push({ email: u.email, current, correctedTo: max, diff: current - max });
    }
}

console.log(`\n===== lifetime_points 校正報告（${APPLY ? '正式寫入' : 'DRY-RUN，未寫入'}）=====`);
console.log(`總用戶數: ${(users || []).length}`);
console.log(`發現異常（現值 > 理論上限）: ${overages.length} 人\n`);

if (overages.length) {
    overages.sort((a, b) => b.diff - a.diff);
    for (const o of overages) {
        console.log(`  ${o.email}: ${o.current} → ${o.correctedTo}（下修 ${o.diff}）`);
    }
    const totalDiff = overages.reduce((s, o) => s + o.diff, 0);
    console.log(`\n合計將下修 ${totalDiff} 點`);
} else {
    console.log('沒有需要校正的用戶。');
}

if (APPLY && overages.length) {
    console.log('\n開始寫入...');
    let fixed = 0, failed = 0;
    for (const o of overages) {
        const { error } = await supabase.from('users')
            .update({ lifetime_points: o.correctedTo })
            .eq('email', o.email);
        if (error) { failed++; console.error(`  ✗ ${o.email} 失敗: ${error.message}`); }
        else { fixed++; }
    }
    console.log(`\n完成：修正 ${fixed} 人，失敗 ${failed} 人`);
} else if (!APPLY && overages.length) {
    console.log('\n這是 dry-run，尚未寫入。確認無誤後執行：node scripts/fix_lifetime_points.mjs --apply');
}
