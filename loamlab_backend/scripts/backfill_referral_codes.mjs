// 補發缺少 referral_code 的用戶
// 執行：cd loamlab_backend && node scripts/backfill_referral_codes.mjs
import { makeSupabase } from './_env.mjs';

const supabase = makeSupabase();

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randCode() {
    let c = '';
    for (let i = 0; i < 6; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
    return c;
}

const { data: users, error } = await supabase.from('users').select('email').is('referral_code', null);
if (error) { console.error('查詢失敗:', error.message); process.exit(1); }
if (!users?.length) { console.log('所有用戶已有邀請碼，無需補發'); process.exit(0); }

console.log(`找到 ${users.length} 位需要補發邀請碼的用戶`);
let fixed = 0, failed = 0;
for (const u of users) {
    let ok = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        const { error: e } = await supabase.from('users').update({ referral_code: randCode() }).eq('email', u.email);
        if (!e) { ok = true; break; }
    }
    if (ok) { fixed++; console.log(`  ✓ ${u.email}`); }
    else     { failed++; console.error(`  ✗ ${u.email} 失敗`); }
}
console.log(`\n完成：補發 ${fixed} 人，失敗 ${failed} 人`);
