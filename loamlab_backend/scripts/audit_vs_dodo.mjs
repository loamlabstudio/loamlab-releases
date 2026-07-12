// 審計腳本：比對 DB 會員名單 vs Dodo API，找出幽靈會員
// 執行：cd loamlab_backend && node scripts/audit_vs_dodo.mjs
import { makeSupabase, dodoBase } from './_env.mjs';

const sb = makeSupabase();
const DODO_KEY = process.env.DODO_API_KEY;
if (!DODO_KEY) { console.error('❌ 未讀到 DODO_API_KEY'); process.exit(1); }
const base = dodoBase(DODO_KEY);

// 1. 拉 Dodo 所有 active 訂閱（Dodo API 可能忽略 status filter，嚴格用 status 欄位比對）
console.log('📡 查詢 Dodo API...');
const dodoRes = await fetch(`${base}/subscriptions?status=active&limit=100`, {
    headers: { Authorization: `Bearer ${DODO_KEY}` }
});
const allItems = (await dodoRes.json()).items || [];
const activeItems = allItems.filter(s => s.status === 'active' || s.status === 'trialing');
const activeSubIds  = new Set(activeItems.map(s => s.subscription_id || s.id));
const activeEmails  = new Set(activeItems.map(s => (s.customer?.email || s.customer_email || '').toLowerCase()));

console.log(`📡 Dodo 返回 ${allItems.length} 筆，其中 active/trialing: ${activeItems.length} 筆`);
console.log('   Active 訂閱清單:');
activeItems.forEach(s => {
    const email = s.customer?.email || s.customer_email || '?';
    console.log(`   ✓ ${email} | ${s.subscription_id || s.id} | ${s.status}`);
});

// 2. 拉 DB 中所有被標記為會員的用戶
const { data: members } = await sb.from('users')
    .select('email, subscription_plan, dodo_subscription_id, points, lifetime_points, last_topup_at')
    .not('subscription_plan', 'is', null)
    .order('last_topup_at', { ascending: false });

console.log(`\n📋 DB 共 ${members.length} 個標記為會員的帳號`);

// 3. 分類
const legit = [], suspicious = [];
for (const u of members) {
    const bySubId = u.dodo_subscription_id && activeSubIds.has(u.dodo_subscription_id);
    const byEmail = activeEmails.has(u.email.toLowerCase());
    if (bySubId || byEmail) {
        legit.push({ ...u, match: bySubId ? 'sub_id' : 'email' });
    } else {
        // 查是否有真實付款記錄（非補發/同步產生的）
        const { data: txs } = await sb.from('transactions')
            .select('order_id, transaction_type, created_at')
            .eq('user_email', u.email)
            .in('transaction_type', ['TOPUP_SUBSCRIPTION', 'TOPUP_SINGLE'])
            .not('order_id', 'ilike', '%_auto')
            .not('order_id', 'ilike', '%_verify')
            .not('order_id', 'ilike', 'SYNC_%')
            .order('created_at', { ascending: false })
            .limit(3);
        suspicious.push({ ...u, real_txs: txs || [] });
    }
}

// 4. 報告正常會員
console.log(`\n✅ 正常會員（Dodo 有記錄）: ${legit.length} 人`);
legit.forEach(u => console.log(`   ${u.email} | ${u.subscription_plan} | match=${u.match} | sub_id=${u.dodo_subscription_id || 'NULL'}`));

// 5. 報告疑似幽靈會員
console.log(`\n⚠️  疑似幽靈會員（Dodo 無記錄）: ${suspicious.length} 人`);
for (const u of suspicious) {
    const txStr = u.real_txs.length > 0
        ? `真實付款: ${u.real_txs.map(t => t.order_id).join(', ')}`
        : '❌ 無真實付款記錄';
    console.log(`   ${u.email}`);
    console.log(`     plan=${u.subscription_plan}, sub_id=${u.dodo_subscription_id || 'NULL'}`);
    console.log(`     pts=${u.points}, lifetime=${u.lifetime_points}, last_topup=${u.last_topup_at || 'NULL'}`);
    console.log(`     ${txStr}`);
}

// 6. 結論
const noTxGhosts  = suspicious.filter(u => u.real_txs.length === 0);
const hasTxGhosts = suspicious.filter(u => u.real_txs.length > 0);
console.log('\n=== 結論 ===');
console.log(`無付款記錄的幽靈會員（建議直接清除）: ${noTxGhosts.length} 人`);
noTxGhosts.forEach(u => console.log(`  → ${u.email}`));
console.log(`有付款記錄但 Dodo 無 active（需手動確認）: ${hasTxGhosts.length} 人`);
hasTxGhosts.forEach(u => console.log(`  → ${u.email} (${u.real_txs[0]?.order_id})`));
console.log('\n下一步: node scripts/revoke_fake_members.mjs        (dry-run 預覽)');
console.log('       node scripts/revoke_fake_members.mjs --execute  (確認後清除)');
