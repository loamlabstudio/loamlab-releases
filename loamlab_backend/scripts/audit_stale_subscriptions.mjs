// 訂閱狀態對帳：找出「DB 還掛著 subscription_plan，但 Dodo 端訂閱其實已經死掉」的用戶。
//
// 為什麼需要這支：清空 subscription_plan 的唯一路徑是 webhook 的 subscription.cancelled/expired/failed
// 事件。只要漏接一次（Dodo 沒發、簽章失敗、續訂扣款失敗直接 cancel 沒送事件），DB 就永遠卡著舊方案，
// 而前端看到 subscription_plan 有值就把該方案的購買按鈕鎖死 —— 用戶想重新訂閱都點不動。
// 這是直接的收入損失，而且用戶不會來抱怨，只會默默流失。
//
// 用法：
//   node scripts/audit_stale_subscriptions.mjs           # 只列出，不改資料
//   node scripts/audit_stale_subscriptions.mjs --fix     # 清空這些用戶的 subscription_plan
import { makeSupabase, dodoBase } from './_env.mjs';

const DO_FIX = process.argv.includes('--fix');
const supabase = makeSupabase();
const KEY = process.env.DODO_API_KEY;
if (!KEY) { console.error('❌ 缺 DODO_API_KEY'); process.exit(1); }
const base = dodoBase(KEY);
const H = { Authorization: `Bearer ${KEY}` };

// Dodo 官方 status 枚舉：pending/active/on_hold/cancelled/failed/expired
// 只有 cancelled/expired/failed 代表「這張訂閱已經死透，不會再續訂」。
// on_hold 是扣款失敗但還在挽救中，pending 是剛建立還沒付款 —— 兩者都不該清。
const DEAD = new Set(['cancelled', 'expired', 'failed']);

const { data: users, error } = await supabase.from('users')
    .select('email, subscription_plan, dodo_subscription_id, last_topup_at, points, lifetime_points')
    .not('subscription_plan', 'is', null);
if (error) { console.error('users query failed:', error.message); process.exit(1); }

console.log(`掛著 subscription_plan 的用戶共 ${users.length} 人，開始逐一向 Dodo 核實…\n`);

const stale = [];
const noSubId = [];
for (const u of users) {
    if (!u.dodo_subscription_id) { noSubId.push(u); continue; }
    let sub = null;
    try {
        const r = await fetch(`${base}/subscriptions/${u.dodo_subscription_id}`, { headers: H });
        if (r.status === 404) { stale.push({ ...u, realStatus: 'not_found' }); continue; }
        if (!r.ok) { console.warn(`  ⚠️ ${u.email} 查詢失敗 HTTP ${r.status}，跳過`); continue; }
        sub = await r.json();
    } catch (e) {
        console.warn(`  ⚠️ ${u.email} 查詢例外：${e.message}，跳過`);
        continue;
    }
    if (DEAD.has(sub.status)) stale.push({ ...u, realStatus: sub.status, cancelled_at: sub.cancelled_at });
}

console.log(`\n=== 被鎖死的用戶（DB 有方案、Dodo 已終止）：${stale.length} 人 ===`);
stale.forEach(u => console.log(
    `  ${u.email}  plan=${u.subscription_plan}  dodo=${u.realStatus}  終止於=${u.cancelled_at || '?'}  剩餘點數=${(u.points || 0) + (u.lifetime_points || 0)}`
));

if (noSubId.length) {
    console.log(`\n=== 有方案但沒有 dodo_subscription_id（多半是人工/贈送方案，不動）：${noSubId.length} 人 ===`);
    noSubId.forEach(u => console.log(`  ${u.email}  plan=${u.subscription_plan}`));
}

if (!DO_FIX) {
    console.log('\n（唯讀模式。確認無誤後加 --fix 實際清空。）');
    process.exit(0);
}

if (!stale.length) { console.log('\n無需修復。'); process.exit(0); }

console.log('\n開始清空…');
for (const u of stale) {
    const { error: e } = await supabase.from('users').update({
        subscription_plan: null,
        next_plan: null,
        cancel_pending: false,
        dodo_subscription_id: null,
        payment_failed: false,
    }).eq('email', u.email);
    console.log(e ? `  ❌ ${u.email}: ${e.message}` : `  ✅ ${u.email} 已解鎖（點數未動）`);
}
