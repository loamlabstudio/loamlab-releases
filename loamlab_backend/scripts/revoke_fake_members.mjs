// 清除幽靈會員腳本（以付款記錄為憑，不需要 Dodo API Key）
// 付款證明標準：
//   DODO_pay_*         → payment.succeeded webhook（強確認）
//   LS_* / 純數字      → LemonSqueezy 付款
//   MANUAL_* / *_manual → 管理員手動補發
//   DODO_sub_*_20xx    → subscription.active 週期 webhook
// 以下為非付款記錄：_auto / _verify / SYNC_
//
// 執行：cd loamlab_backend
//   預覽: node scripts/revoke_fake_members.mjs
//   清除: node scripts/revoke_fake_members.mjs --execute
import { makeSupabase } from './_env.mjs';

const DRY = process.argv[2] !== '--execute';
const sb = makeSupabase();

console.log(DRY
    ? '🔍 DRY-RUN 模式（僅預覽，加 --execute 才執行）\n'
    : '⚡ EXECUTE 模式，開始清除幽靈會員...\n');

const PLAN_POINTS = { starter: 300, pro: 2000, studio: 9000 };

// 需跳過的帳號（管理員測試帳號等）
const WHITELIST = new Set([
    'jacksonling2@gmail.com',   // 手動升級測試帳號
    'loamlabstudio@gmail.com',  // repo owner 帳號
]);

const { data: members } = await sb.from('users')
    .select('email, subscription_plan, dodo_subscription_id, points')
    .not('subscription_plan', 'is', null);

let revokeCount = 0, skipCount = 0;
for (const u of members) {
    if (WHITELIST.has(u.email)) { skipCount++; continue; }

    const { data: txs } = await sb.from('transactions')
        .select('order_id, transaction_type')
        .eq('user_email', u.email)
        .in('transaction_type', ['TOPUP_SUBSCRIPTION', 'TOPUP_SINGLE']);

    const hasRealPayment = (txs || []).some(t => {
        const o = t.order_id || '';
        return o.startsWith('DODO_pay_')
            || o.startsWith('LS_')
            || o.startsWith('MANUAL_')
            || o.endsWith('_manual')
            || /^[0-9]+$/.test(o)                      // LS 舊格式純數字
            || /^DODO_sub_.+_20\d{2}/.test(o);          // subscription.active 週期
    });

    if (hasRealPayment) { skipCount++; continue; }

    revokeCount++;
    const planPts = PLAN_POINTS[u.subscription_plan] || 0;
    const restoredPts = Math.max(60, (u.points || 0) - planPts);
    console.log(`🔴 ${DRY ? '[DRY] ' : ''}清除 ${u.email}`);
    console.log(`     plan=${u.subscription_plan}, sub_id=${u.dodo_subscription_id || 'NULL'}`);
    console.log(`     pts: ${u.points} → ${restoredPts}`);
    if ((txs || []).length > 0) console.log(`     可疑交易: ${txs.map(t => t.order_id).join(', ')}`);

    if (!DRY) {
        await sb.from('users').update({
            subscription_plan: null,
            dodo_subscription_id: null,
            cancel_pending: false,
            points: restoredPts,
        }).eq('email', u.email);
        // 刪除 _auto / _verify / SYNC_ 詐偽交易記錄
        await sb.from('transactions').delete()
            .eq('user_email', u.email)
            .or('order_id.ilike.%_auto,order_id.ilike.%_verify,order_id.ilike.SYNC_%');
        console.log(`     ✅ 已清除`);
    }
}

console.log(`\n${DRY ? '[DRY] ' : ''}幽靈會員: ${revokeCount} 個${DRY ? '（待清除）' : '已清除'}`);
console.log(`略過（白名單 + 有付款記錄）: ${skipCount} 個`);
if (DRY && revokeCount > 0) console.log('\n確認後執行: node scripts/revoke_fake_members.mjs --execute');
