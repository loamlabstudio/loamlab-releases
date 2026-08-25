// 【SPRINT Task 4】修復 alen3388@gmail.com 的訂閱方案卡死 + 交易紀錄脫鉤問題。
//
// 根因（已用 scratch_check_alen.mjs 重現）：用戶先升級到 Studio（真的拿到 9000 monthly points），
// 隨後在同一筆舊訂閱內又收到一筆 Pro 等級的付款事件（同訂閱降級防護正確擋下，未發點），
// 接著開了一筆全新訂閱（sub_0Nlvw2vX1wqeq92Mh4jlz，真正在扣款的訂閱）想改訂 Pro，但當時的
// 降級防護誤把「全新訂閱」也當成「同訂閱降級」擋下——導致 DB 卡在 subscription_plan=studio，
// 而 Dodo 真實訂閱早已是 Pro（舊 Studio 訂閱已被 webhook.js 取消）。
//
// 對應 activate.js 的 Task 1 修復後，這筆新訂閱事件「原本應該」會正常套用 Pro 方案
// （p_set_monthly=2000，訂閱本來就是 use-it-or-lose-it，覆寫掉舊 Studio 留下的月配額）。
// 本腳本把帳號校正回「Task 1 修好後，這三筆歷史事件原本應該落地的狀態」：
//   1. subscription_plan: studio → pro
//   2. points（monthly bucket）: 8415 → 2000（比照修好後 p_set_monthly 的效果，不動 lifetime_points）
//   3. 兩筆「已 claim 但沒實際發點」的 transactions.amount 訂正為 0（比照 Task 2 修復）
//
// 預設 dry-run（只印出計算結果，不寫入）。確認無誤後加 --apply 才真的執行。
import { makeSupabase } from './_env.mjs';

const EMAIL = 'alen3388@gmail.com';
const CORRECT_PLAN = 'pro';
const CORRECT_MONTHLY_POINTS = 2000; // PLAN_DEFS.pro.points
// 這兩筆是同訂閱降級防護擋下、從未實際發點的交易，amount 應訂正為 0
const ZERO_OUT_ORDER_IDS = [
    'DODO_sub_0NgHrSph0GfXtifRxC7hI_pay_0NiQO4bfRNzk0DsWaJnkX',
    'DODO_sub_0Nlvw2vX1wqeq92Mh4jlz_pay_0Nlvw2vH8syPOD3K9pVGS',
];

const APPLY = process.argv.includes('--apply');
const supabase = makeSupabase();

async function run() {
    const { data: user, error: userErr } = await supabase.from('users')
        .select('email, subscription_plan, dodo_subscription_id, points, lifetime_points')
        .eq('email', EMAIL).maybeSingle();
    if (userErr || !user) {
        console.error('❌ 查無用戶或查詢失敗:', userErr?.message || 'not found');
        process.exit(1);
    }

    const { data: txs, error: txErr } = await supabase.from('transactions')
        .select('order_id, amount')
        .in('order_id', ZERO_OUT_ORDER_IDS);
    if (txErr) {
        console.error('❌ 查詢交易紀錄失敗:', txErr.message);
        process.exit(1);
    }

    console.log('=== 目前狀態 ===');
    console.log(`subscription_plan: ${user.subscription_plan} → ${CORRECT_PLAN}`);
    console.log(`points (monthly):  ${user.points} → ${CORRECT_MONTHLY_POINTS}`);
    console.log(`lifetime_points:   ${user.lifetime_points} (不變)`);
    console.log('待訂正的 transactions:');
    for (const id of ZERO_OUT_ORDER_IDS) {
        const found = txs.find(t => t.order_id === id);
        console.log(`  ${id}: amount ${found ? found.amount : '(查無此筆，跳過)'} → 0`);
    }

    if (!APPLY) {
        console.log('\n[dry-run] 尚未寫入，確認無誤後加 --apply 執行。');
        return;
    }

    const { error: updUserErr } = await supabase.from('users')
        .update({ subscription_plan: CORRECT_PLAN, points: CORRECT_MONTHLY_POINTS })
        .eq('email', EMAIL);
    if (updUserErr) {
        console.error('❌ 更新 users 失敗:', updUserErr.message);
        process.exit(1);
    }

    for (const id of ZERO_OUT_ORDER_IDS) {
        const { error: updTxErr } = await supabase.from('transactions').update({ amount: 0 }).eq('order_id', id);
        if (updTxErr) console.warn(`⚠️ 訂正 ${id} 失敗（non-fatal）:`, updTxErr.message);
    }

    console.log('\n✅ 已套用修復。');
}

run();
