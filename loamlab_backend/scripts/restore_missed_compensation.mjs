// 補救 fix_lifetime_points.mjs 第一輪修正的白名單缺口：
// 第一輪理論上限只認 TOPUP_SINGLE / REFERRAL_PAID_A / REFERRAL_PAID_B，
// 漏了歷史上透過 Supabase SQL Editor 直接手動寫入、不經過任何 API 程式碼路徑的
// SYSTEM_COMPENSATION（人工補償）交易，導致這類用戶被誤下修。
//
// 範圍嚴格限定在「第一輪 --apply 實際寫入過」的 35 位用戶快照（CORRECTED_SNAPSHOT，
// email + 當時寫入的 correctedTo 值），逐一用擴大後的白名單（+ 任何 %COMPENSATION% 類型）
// 重新計算理論上限；只有新上限 > 當時寫入值時才「加回差額」（不是整個覆寫成新上限），
// 尊重這段期間可能發生的正常消費。快照名單以外的用戶完全不觸碰。
//
// 用法：
//   node scripts/restore_missed_compensation.mjs            → dry-run
//   node scripts/restore_missed_compensation.mjs --apply     → 實際寫入

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

try {
    readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) {}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ 未讀到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// 2026-07-08 fix_lifetime_points.mjs --apply 實際寫入的 35 筆快照（email → 當時的 correctedTo）
const CORRECTED_SNAPSHOT = {
    'hanaxyq@gmail.com': 0,
    'bthean@gmail.com': 0,
    'yu6874.design@gmail.com': 200,
    'loamlabs@gmail.com': 0,
    '911016wiwi@gmail.com': 0,
    'fahghhh@gmail.com': 0,
    'fd23270556@gmail.com': 400,
    'ann.kolaw@gmail.com': 400,
    'sengsengpoon@gmail.com': 0,
    'huangw325@gmail.com': 200,
    'smartbuy753@gmail.com': 200,
    'b722tahw@gmail.com': 0,
    'michel.99531@gmail.com': 200,
    'kklue6969@gmail.com': 200,
    'jodichen0602@gmail.com': 200,
    'shenshenyencheng@gmail.com': 0,
    'weixiang.chen19@gmail.com': 0,
    '9s.xxxxxxxxxx@gmail.com': 0,
    'monkey920305@gmail.com': 0,
    'nine.oak.tainan@gmail.com': 0,
    'ku767652@gmail.com': 0,
    'emma_wei@housesolver.com': 0,
    'rainproof41@gmail.com': 0,
    'skillability6448@gmail.com': 0,
    'jschiew28@gmail.com': 0,
    'ericso@studiozhai.com': 0,
    'katharine.norwe@gmail.com': 0,
    'alen3388@gmail.com': 0,
    'candy20230@gmail.com': 0,
    'qop7604230906@gmail.com': 0,
    'loamlabstudio@gmail.com': 0,
    'wiijie.0630@gmail.com': 0,
    'manhsuanlin@gmail.com': 0,
    'ann891130tn@gmail.com': 0,
    'weilostudio@gmail.com': 0,
};

const emails = Object.keys(CORRECTED_SNAPSHOT);

const { data: txs, error: txErr } = await supabase
    .from('transactions')
    .select('user_email, amount, transaction_type')
    .in('user_email', emails);
if (txErr) { console.error('查詢 transactions 失敗:', txErr.message); process.exit(1); }

const CREDIT_TYPES = new Set(['TOPUP_SINGLE', 'REFERRAL_PAID_A', 'REFERRAL_PAID_B']);
const newMax = {};
for (const t of txs || []) {
    if (!emails.includes(t.user_email)) continue;
    const isCredit = CREDIT_TYPES.has(t.transaction_type) || /COMPENSATION/i.test(t.transaction_type || '');
    if (!isCredit) continue;
    newMax[t.user_email] = (newMax[t.user_email] || 0) + (t.amount || 0);
}

const { data: currentRows, error: userErr } = await supabase
    .from('users').select('email, lifetime_points').in('email', emails);
if (userErr) { console.error('查詢 users 失敗:', userErr.message); process.exit(1); }
const currentMap = {};
(currentRows || []).forEach(u => { currentMap[u.email] = u.lifetime_points || 0; });

const restores = [];
for (const email of emails) {
    const oldMax = CORRECTED_SNAPSHOT[email];
    const max = newMax[email] || 0;
    if (max > oldMax) {
        const delta = max - oldMax;
        const current = currentMap[email] || 0;
        restores.push({ email, delta, current, newValue: current + delta });
    }
}

console.log(`\n===== 補償缺口復原報告（${APPLY ? '正式寫入' : 'DRY-RUN，未寫入'}）=====`);
console.log(`檢查範圍: ${emails.length} 位（第一輪被下修過的用戶）`);
console.log(`發現需補回: ${restores.length} 人\n`);
for (const r of restores) {
    console.log(`  ${r.email}: 目前 ${r.current} → 補回 +${r.delta} → ${r.newValue}`);
}
if (!restores.length) console.log('沒有發現需要補回的用戶（第一輪白名單缺口未影響到任何人）。');

if (APPLY && restores.length) {
    console.log('\n開始寫入...');
    let fixed = 0, failed = 0;
    for (const r of restores) {
        const { error } = await supabase.from('users')
            .update({ lifetime_points: r.newValue }).eq('email', r.email);
        if (error) { failed++; console.error(`  ✗ ${r.email} 失敗: ${error.message}`); }
        else fixed++;
    }
    console.log(`\n完成：補回 ${fixed} 人，失敗 ${failed} 人`);
} else if (!APPLY && restores.length) {
    console.log('\n這是 dry-run，尚未寫入。確認無誤後執行：node scripts/restore_missed_compensation.mjs --apply');
}
