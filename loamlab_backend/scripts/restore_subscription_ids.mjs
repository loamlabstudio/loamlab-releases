// 一次性腳本：補齊 4 位真實買家的 dodo_subscription_id
// 執行：cd loamlab_backend && node scripts/restore_subscription_ids.mjs
import { makeSupabase } from './_env.mjs';

const sb = makeSupabase();

const BUYERS = [
    { email: 'golden8933@gmail.com',       subId: 'sub_0NfrN6g5dCoyvFjMq5Iy2' },
    { email: 'kk10608@gmail.com',          subId: 'sub_0NfjxQm8vC45ovVesUWjO' },
    { email: 'huang0430@urbancollab.com',  subId: 'sub_0NfR03VCUaACQJTPzYu1O' },
    { email: 'shenshenyencheng@gmail.com', subId: 'sub_0NfDVe9A9Q1kiNVU0mjiP' },
];

console.log('=== 補齊真實買家 dodo_subscription_id ===\n');
for (const { email, subId } of BUYERS) {
    const { data: u } = await sb.from('users')
        .select('subscription_plan, dodo_subscription_id, points')
        .eq('email', email).maybeSingle();

    if (!u) { console.log(`❌ 找不到帳號: ${email}`); continue; }

    console.log(`${email}`);
    console.log(`  plan=${u.subscription_plan || 'NULL'}, 現有sub_id=${u.dodo_subscription_id || 'NULL'}, pts=${u.points}`);

    const { error } = await sb.from('users')
        .update({ dodo_subscription_id: subId })
        .eq('email', email);

    if (error) console.log(`  ❌ 更新失敗: ${error.message}`);
    else       console.log(`  ✅ 已補齊 → ${subId}\n`);
}
console.log('完成');
