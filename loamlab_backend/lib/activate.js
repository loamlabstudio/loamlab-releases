import { createClient } from '@supabase/supabase-js';
import { PRICING_CONFIG, DODO_PRODUCTS } from '../config.js';

const IDS = {
    LS: { TOPUP: 1432023, STARTER: 1432194, PRO: 1432198, STUDIO: 1432205 },
    DODO: DODO_PRODUCTS
};

export function makeSupabase() {
    return createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    );
}

export async function processTopup(supabase, customerEmail, variantId, orderId, platform, discountCode = null, subscriptionId = null, planKey = null, dodoCustomerId = null) {
    const fullOrderId = `${platform}_${orderId}`;
    const { data: existingTx } = await supabase.from('transactions').select('id').eq('order_id', fullOrderId).maybeSingle();
    if (existingTx) return console.log(`[🔁冪等] ${fullOrderId} 已處理過`);

    const PLAN_KEY_MAP = {
        STARTER: { points: 300,  name: 'starter', isSub: true },
        PRO:     { points: 2000, name: 'pro',     isSub: true },
        STUDIO:  { points: 9000, name: 'studio',  isSub: true },
        TOPUP:   { points: 200,  name: null,      isSub: false },
    };

    let pointsToAdd = 0;
    let planName = null;
    let isSubscription = false;

    if (planKey && PLAN_KEY_MAP[planKey.toUpperCase()]) {
        const m = PLAN_KEY_MAP[planKey.toUpperCase()];
        pointsToAdd = m.points; planName = m.name; isSubscription = m.isSub;
    } else {
        const pIds = IDS[platform];
        if (!pIds) throw new Error(`Unknown platform: ${platform}`);
        if (variantId == pIds.STARTER) { pointsToAdd = 300; planName = 'starter'; isSubscription = true; }
        else if (variantId == pIds.PRO) { pointsToAdd = 2000; planName = 'pro'; isSubscription = true; }
        else if (variantId == pIds.STUDIO) { pointsToAdd = 9000; planName = 'studio'; isSubscription = true; }
        else if (variantId == pIds.TOPUP) { pointsToAdd = 200; isSubscription = false; }
    }

    if (pointsToAdd <= 0) {
        throw new Error(`Unknown product: planKey=${planKey} variantId=${variantId} (${platform})`);
    }

    let kolEmailFromCode = null;
    if (discountCode) {
        try {
            const upperDiscountCode = discountCode.toUpperCase();
            const { data: kolByCode } = await supabase.from('users')
                .select('email')
                .or(`referral_code.eq.${upperDiscountCode},dodo_discount_code.eq.${upperDiscountCode}`)
                .or('is_kol.eq.true,is_partner.eq.true')
                .maybeSingle();
            if (kolByCode && kolByCode.email !== customerEmail) kolEmailFromCode = kolByCode.email;
        } catch (e) {
            console.warn('[KOL] early-lookup failed (non-fatal):', e.message);
        }
    }

    let { data: user } = await supabase.from('users').select('*').eq('email', customerEmail).maybeSingle();

    if (!user) {
        await supabase.from('users').insert([{
            email: customerEmail,
            points: 0,
            lifetime_points: 0,
            is_beta_tester: true,
            subscription_plan: planName,
            last_topup_at: new Date().toISOString(),
            referred_by: kolEmailFromCode || null,
        }]);
        const { data: fetchedUser } = await supabase.from('users').select('*').eq('email', customerEmail).maybeSingle();
        user = fetchedUser;
        if (kolEmailFromCode) console.log(`[💡KOL新用戶歸因] discount_code=${discountCode}: ${customerEmail} → ${kolEmailFromCode}`);
    } else if (kolEmailFromCode && !user.referred_by) {
        await supabase.from('users').update({ referred_by: kolEmailFromCode }).eq('email', customerEmail);
        user.referred_by = kolEmailFromCode;
        console.log(`[💡KOL晚期綁定] discount_code=${discountCode}: ${customerEmail} → ${kolEmailFromCode}`);
    }

    // 邀請人分潤 A：改用 apply_points_delta 原子 RPC（FOR UPDATE 鎖列），避免多筆訂單
    // 同時對同一個邀請人做 read-then-write 互相蓋掉。
    let bonusB = 0;
    let inviterEmail = null;
    let REWARD_A = 0;
    if (user?.referred_by) {
        const { data: txPaid } = await supabase.from('transactions').select('id').eq('user_email', customerEmail).eq('transaction_type', 'REFERRAL_PAID_B').maybeSingle();
        if (!txPaid) {
            REWARD_A = PRICING_CONFIG.referral.paid_reward_a;
            const REWARD_B = PRICING_CONFIG.referral.paid_reward_b;
            bonusB = REWARD_B;
            inviterEmail = user.referred_by;
            const { data: inviterRpc } = await supabase.rpc('apply_points_delta', {
                p_email: inviterEmail, p_set_monthly: null, p_add_lifetime: REWARD_A, p_add_referral_count: 1
            });
            if (inviterRpc?.success) {
                await supabase.from('transactions').insert([
                    { user_email: inviterEmail, amount: REWARD_A, transaction_type: 'REFERRAL_PAID_A', order_id: `refA_${fullOrderId}` },
                    { user_email: customerEmail, amount: REWARD_B, transaction_type: 'REFERRAL_PAID_B', order_id: `refB_${fullOrderId}` }
                ]);
            } else {
                inviterEmail = null; // 邀請人不存在，rollback 時不用補償
            }
        }
    }

    if (isSubscription && subscriptionId) {
        try {
            await supabase.from('users').update({ dodo_subscription_id: subscriptionId }).eq('email', customerEmail);
        } catch (e) {
            console.warn('[subscription_id] store failed (non-fatal):', e.message);
        }
    }
    if (dodoCustomerId) {
        try {
            await supabase.from('users').update({ dodo_customer_id: dodoCustomerId }).eq('email', customerEmail);
        } catch (e) {
            console.warn('[dodo_customer_id] store failed (non-fatal):', e.message);
        }
    }

    // 方案防護：如果用戶目前已經是較高等級的方案，忽略低等級的訂閱覆寫
    let shouldUpdatePlan = true;
    const PLAN_TIERS = { starter: 1, pro: 2, studio: 3 };
    if (planName && user && user.subscription_plan) {
        const currentTier = PLAN_TIERS[user.subscription_plan] || 0;
        const newTier = PLAN_TIERS[planName] || 0;
        if (newTier < currentTier) {
            shouldUpdatePlan = false;
            console.log(`[🛡️防護] 忽略低階方案更新: ${customerEmail} (目前: ${user.subscription_plan}, 傳入: ${planName})`);
        }
    }

    const isOverridingLowerTier = isSubscription && !shouldUpdatePlan;
    const lifetimeDelta = (isSubscription ? 0 : pointsToAdd) + bonusB;
    const { data: mainRpc, error: mainRpcErr } = await supabase.rpc('apply_points_delta', {
        p_email: customerEmail,
        p_set_monthly: (isSubscription && !isOverridingLowerTier) ? pointsToAdd : null,
        p_add_lifetime: lifetimeDelta,
        p_add_referral_count: 0
    });
    if (mainRpcErr || !mainRpc?.success) {
        const err = new Error(`apply_points_delta failed for ${customerEmail}: ${mainRpcErr?.message || mainRpc?.error}`);
        err.code = 'POINT_CALC_ERROR';
        throw err;
    }

    const otherFields = {
        is_beta_tester: true,
        last_topup_at: new Date().toISOString(),
    };
    if (planName && shouldUpdatePlan) otherFields.subscription_plan = planName;
    await supabase.from('users').update(otherFields).eq('email', customerEmail);

    const PLAN_PRICES_CENTS = { starter: 700, pro: 1500, studio: 3500, topup: 490 };
    const amountPaid = planName ? (PLAN_PRICES_CENTS[planName] || 490) : 490;
    const { error: txInsertErr } = await supabase.from('transactions').insert([{
        user_email: customerEmail,
        amount: pointsToAdd,
        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE',
        order_id: fullOrderId,
        amount_usd_cents: amountPaid
    }]);
    // 23505 = order_id unique constraint：並發請求已先一步處理，視為冪等成功
    if (txInsertErr) {
        if (txInsertErr.code === '23505' || txInsertErr.message?.includes('unique')) {
            return console.log(`[processTopup] 23505 idempotent — ${fullOrderId} 已由並發請求處理`);
        }
        // 非冪等錯誤：點數已寫入但交易紀錄失敗 → 補償性回滾（用同一支原子 RPC 反向操作，
        // 只還原「這筆請求剛剛加的量」，不會動到並發寫入的其他變更）
        console.error(`[🔴ROLLBACK] transactions insert failed for ${fullOrderId}, attempting rollback`);
        try {
            await supabase.rpc('apply_points_delta', {
                p_email: customerEmail,
                p_set_monthly: isSubscription ? mainRpc.prev_monthly : null,
                p_add_lifetime: -lifetimeDelta,
                p_add_referral_count: 0
            });
            if (inviterEmail) {
                await supabase.rpc('apply_points_delta', {
                    p_email: inviterEmail, p_set_monthly: null, p_add_lifetime: -REWARD_A, p_add_referral_count: -1
                });
            }
            console.error(`[🔴ROLLBACK] 點數已回滾: ${customerEmail}`);
        } catch (rollbackErr) {
            console.error(`[🚨CRITICAL] 回滾失敗，點數不一致！user=${customerEmail} order=${fullOrderId}`, rollbackErr.message);
        }
        throw txInsertErr;
    }

    await writeKolCommission(supabase, customerEmail, amountPaid, fullOrderId);

    console.log(`[🚀金流] 成功處理 ${platform} 充值: ${customerEmail} (+${pointsToAdd} pts)`);
}

// 無腦拉取（Dumb Pull）：向 Dodo 拉該 email 的 payments，把還沒入帳的 succeeded 付款全部補發。
// 冪等完全交給 processTopup 的 UNIQUE(order_id) 檢查。供 verify_payment（用戶手動觸發）與
// cron_insights 的 dodo_reconcile（主動偵測漏接 webhook）共用，避免同一套邏輯維護兩份。
export async function reconcilePaymentsForEmail(supabase, email, dodoApiKey) {
    if (!dodoApiKey || !email) return { activated: false, foundSucceeded: false };
    const dodoBase = dodoApiKey.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
    let activated = false;
    let foundSucceeded = false;
    try {
        // Dodo 的 /payments 端點會忽略 customer_email 這個查詢參數（已在 stats.js/user.js
        // 的訂閱對帳邏輯實測證實），單頁 limit=10 抓到的其實是「全平台最新 10 筆付款」，
        // 跟這個 email 完全無關。真正能信任的做法是分頁抓 + 用回傳資料裡的 email 欄位自己比對
        // （下面 payEmail !== email 這段本來就有做），分頁參數要用 page_size/page_number，
        // 用 limit 一樣會被忽略。抓 3 頁（最多 300 筆全平台付款）足以涵蓋任何訂閱的月結週期。
        let pays = [];
        for (let page = 0; page < 3; page++) {
            const payRes = await fetch(
                `${dodoBase}/payments?page_size=100&page_number=${page}`,
                { headers: { Authorization: `Bearer ${dodoApiKey}` } }
            );
            if (!payRes.ok) break;
            const items = (await payRes.json()).items || [];
            if (!items.length) break;
            pays = pays.concat(items);
            if (items.length < 100) break;
        }
        for (const pay of pays) {
            const payEmail = pay.customer?.email || pay.email || pay.customer_email;
            if (payEmail !== email) continue;
            if (pay.status !== 'succeeded') continue;
            foundSucceeded = true;
            const productId = pay.product_cart?.[0]?.product_id || pay.product_id;
            // 對齊 webhook.js 的判斷順序：/payments 列表端點回來的物件通常沒有 product_cart，
            // 只有 metadata.planKey——只認 productId 會讓幾乎所有透過這條路徑補發的付款都被
            // 誤判成「無法辨識商品」而整筆跳過（foundSucceeded 仍為 true，但 activated 永遠是 false）
            const planKey = pay.metadata?.planKey || null;
            if (!productId && !planKey) continue;
            // 對齊 webhook.js orderId 格式（subscription 付款含 sub_id 前綴）
            const orderId = pay.subscription_id ? `${pay.subscription_id}_${pay.payment_id}` : pay.payment_id;
            const { data: ex } = await supabase.from('transactions').select('id').eq('order_id', `DODO_${orderId}`).maybeSingle();
            // fallback：查舊格式（07a6772 之前寫入的 transaction，避免重複補發）
            let alreadyIssued = !!ex;
            if (!alreadyIssued && pay.subscription_id) {
                const { data: exOld } = await supabase.from('transactions').select('id').eq('order_id', `DODO_${pay.payment_id}`).maybeSingle();
                alreadyIssued = !!exOld;
            }
            if (!alreadyIssued) {
                const payCustomerId = pay.customer?.customer_id || null;
                await processTopup(supabase, email, productId, orderId, 'DODO', null, pay.subscription_id || null, planKey, payCustomerId);
                activated = true;
            }
        }
    } catch (e) { console.warn(`[reconcilePaymentsForEmail] ${email}:`, e.message); }
    return { activated, foundSucceeded };
}

export async function writeKolCommission(supabase, buyerEmail, amountPaid, orderId) {
    try {
        const { data: buyer } = await supabase.from('users')
            .select('referred_by').eq('email', buyerEmail).maybeSingle();
        if (!buyer?.referred_by) return;

        const kolEmail = buyer.referred_by;
        const { data: kol } = await supabase.from('users')
            .select('referral_code, referral_success_count, is_kol, is_partner').eq('email', kolEmail).maybeSingle();
        if (!kol?.referral_code || (!kol.is_kol && !kol.is_partner)) return;

        const paidCount = kol.referral_success_count || 0;
        const tier = paidCount <= 50 ? 1 : paidCount <= 100 ? 2 : 3;
        const rate = kol.is_partner
            ? [0.15, 0.20, 0.25][tier - 1]
            : [0.05, 0.10, 0.15][tier - 1];
        const commission = Math.round(amountPaid * rate);

        // 月度 dedup：同一買家同一日曆月只記一筆佣金，防止 subscription.active + payment.succeeded 雙重計算
        const monthStart = `${new Date().toISOString().substring(0, 7)}-01T00:00:00Z`;
        const { data: dupCheck } = await supabase.from('kol_ledger')
            .select('id').eq('kol_email', kolEmail).eq('buyer_email', buyerEmail)
            .gte('created_at', monthStart).maybeSingle();
        if (dupCheck) {
            console.log(`[KOL] 本月已記錄佣金，跳過重複: ${buyerEmail}`);
            return;
        }

        await supabase.from('kol_ledger').insert([{
            kol_code: kol.referral_code,
            kol_email: kolEmail,
            buyer_email: buyerEmail,
            transaction_id: orderId,
            amount_paid: amountPaid,
            commission_rate: rate,
            commission_amount: commission,
            status: 'pending'
        }]);
        const role = kol.is_partner ? 'partner' : 'kol';
        console.log(`[💰${role.toUpperCase()}] ${kolEmail} Tier${tier} +${commission}¢ (rate=${rate})`);
    } catch (e) {
        console.warn('[KOL] writeKolCommission failed (non-fatal):', e.message);
    }
}
