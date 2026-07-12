/**
 * cleanup_dodo_dupe.mjs
 * 清洗自 2026-05-29 起 Dodo Webhook 雙發導致的重複 TOPUP_SUBSCRIPTION 交易
 * 並修正 users.lifetime_points 因重複 carryOver 虛增的數值
 *
 * 用法：
 *   node scripts/cleanup_dodo_dupe.mjs                     ← DRY RUN（只印，不改資料）
 *   DRY_RUN=false node scripts/cleanup_dodo_dupe.mjs        ← 真正執行
 */
import { makeSupabase } from './_env.mjs';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const SINCE = '2026-05-29T00:00:00Z';
const supabase = makeSupabase();

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Dodo 重複交易清洗腳本  ${DRY_RUN ? '[DRY RUN — 不會寫入]' : '[⚠️  LIVE — 將修改資料庫]'}`);
    console.log(`  查詢範圍：${SINCE} 之後的 TOPUP_SUBSCRIPTION`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. 拉出 SINCE 後所有 TOPUP_SUBSCRIPTION 記錄（含 DODO_pay_* 格式）
    const { data: txs, error } = await supabase
        .from('transactions')
        .select('id, user_email, order_id, amount, created_at')
        .eq('transaction_type', 'TOPUP_SUBSCRIPTION')
        .gte('created_at', SINCE)
        .order('created_at', { ascending: true });

    if (error) { console.error('拉取交易失敗:', error); process.exit(1); }
    console.log(`共找到 ${txs.length} 筆 TOPUP_SUBSCRIPTION（${SINCE} 後）\n`);

    // 2. 按 user_email + 計費月份分組
    const groups = {};
    for (const tx of txs) {
        const period = tx.created_at.substring(0, 7); // "YYYY-MM"
        const key = `${tx.user_email}||${period}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(tx);
    }

    // 3. 找出重複組（同一用戶同一月份 > 1 筆）
    const dupeGroups = Object.entries(groups).filter(([, rows]) => rows.length > 1);
    console.log(`發現 ${dupeGroups.length} 個用戶/月份有重複交易\n`);

    if (dupeGroups.length === 0) {
        console.log('✅ 無需清洗，資料庫已乾淨。');
        return;
    }

    let totalExtraPts = 0;
    const affectedUsers = new Set();

    for (const [key, rows] of dupeGroups) {
        const [email, period] = key.split('||');
        // 保留最早那筆，其餘為重複
        const keep = rows[0];
        const dupes = rows.slice(1);
        const extraPts = dupes.reduce((sum, r) => sum + (r.amount || 0), 0);
        totalExtraPts += extraPts;
        affectedUsers.add(email);

        console.log(`[${period}] ${email}`);
        console.log(`  ✅ 保留: ${keep.order_id} (+${keep.amount} pts, ${keep.created_at.substring(0,19)})`);
        for (const d of dupes) {
            console.log(`  ❌ 刪除: ${d.order_id} (+${d.amount} pts, ${d.created_at.substring(0,19)})`);
        }
        console.log(`  → lifetime_points 需扣除: ${extraPts} pts\n`);

        if (!DRY_RUN) {
            // 刪除重複交易
            const dupeIds = dupes.map(d => d.id);
            const { error: delErr } = await supabase.from('transactions').delete().in('id', dupeIds);
            if (delErr) { console.error(`  刪除失敗 (${email}):`, delErr.message); continue; }

            // 修正 lifetime_points
            const { data: user, error: uErr } = await supabase.from('users').select('lifetime_points').eq('email', email).single();
            if (uErr || !user) { console.error(`  取用戶失敗 (${email}):`, uErr?.message); continue; }
            const newLt = Math.max(0, (user.lifetime_points || 0) - extraPts);
            const { error: updErr } = await supabase.from('users').update({ lifetime_points: newLt }).eq('email', email);
            if (updErr) {
                console.error(`  更新 lifetime_points 失敗 (${email}):`, updErr.message);
            } else {
                console.log(`  ✅ lifetime_points: ${user.lifetime_points} → ${newLt}`);
            }
        }
    }

    console.log(`${'='.repeat(60)}`);
    console.log(`總結：`);
    console.log(`  影響用戶：${affectedUsers.size} 人`);
    console.log(`  虛增點數：${totalExtraPts} pts`);
    if (DRY_RUN) {
        console.log(`\n[DRY RUN] 以上僅為預覽，未實際修改任何資料。`);
        console.log(`確認無誤後執行：DRY_RUN=false node scripts/cleanup_dodo_dupe.mjs`);
    } else {
        console.log(`\n✅ 清洗完成。`);
    }
    console.log(`${'='.repeat(60)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
