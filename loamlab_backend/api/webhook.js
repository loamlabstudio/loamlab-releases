import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// 初始化 Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || ''; // 應該使用 Service Role Key 以獲得完整權限
const supabase = createClient(supabaseUrl, supabaseKey);

// LemonSqueezy 的自訂 Webhook Secret (用來驗證是不是真的從官方發送過來的)
const WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || process.env.LEMON_WEBHOOK_SECRET || '';

// Vercel 設定：停用自動解析 JSON 格式，以便 getRawBody 讀取原始 HMAC 簽章 Buffer
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    // 只允許 POST 方法
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 1. 驗證 Webhook 的加密簽章 (防偽造)
    try {
        const rawBody = await getRawBody(req);
        const signature = req.headers['x-signature'];

        if (!signature) {
            console.error('[🚫安全] 缺少 X-Signature 簽章頭！');
            return res.status(401).json({ error: 'Missing Signature' });
        }

        const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
        const digest = hmac.update(rawBody).digest('hex');

        // 使用 timingSafeEqual 防止時序攻擊
        const digestBuffer = Buffer.from(digest, 'hex');
        const signatureBuffer = Buffer.from(signature, 'hex');

        if (digestBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
            console.error('[🚫安全] Webhook 簽章校驗失敗！');
            return res.status(401).json({ error: 'Invalid Signature' });
        }

        // 2. 解析事件內容
        const event = JSON.parse(rawBody.toString('utf8'));
        const eventName = event.meta.event_name;
        const orderData = event.data.attributes;

        // 判斷是否為「訂單建立成功」
        if (eventName === 'order_created') {
            const customerEmail = orderData.user_email;
            const variantId = orderData.first_order_item.variant_id; // 商品 ID
            const orderId = event.data?.id?.toString();               // 訂單唯一 ID

            // P0-3 冪等性：防止 LemonSqueezy 重試時重複充值
            if (orderId) {
                const { data: existingTx } = await supabase
                    .from('transactions')
                    .select('id')
                    .eq('order_id', orderId)
                    .maybeSingle();
                if (existingTx) {
                    console.log(`[🔁冪等] 訂單 ${orderId} 已處理過，跳過`);
                    return res.status(200).json({ ok: true, skipped: true });
                }
            }

            let pointsToAdd = 0;   // ★ 修正：使用 let 宣告，避免變數污染
            let isSubscription = false;

            // ============================================================
            // ★ Variant IDs — 請至 LemonSqueezy 後台 Products > Variants 取得真實 ID
            //   同步更新 app.js 的 LS_VARIANTS 物件（兩邊必須對齊）
            // ============================================================
            const VARIANT_TOPUP = 1432023;  // ← 同步 LS_VARIANTS.TOPUP
            const VARIANT_STARTER = 1432194;  // ← 同步 LS_VARIANTS.STARTER
            const VARIANT_PRO = 1432198;  // ← 同步 LS_VARIANTS.PRO
            const VARIANT_STUDIO = 1432205;  // ← 同步 LS_VARIANTS.STUDIO

            let planName = null; // 訂閱方案等級

            if (variantId === VARIANT_STARTER) {        // Starter $24 / mo
                pointsToAdd = 300;
                isSubscription = true;
                planName = 'starter';
            } else if (variantId === VARIANT_PRO) {     // Pro $52 / mo
                pointsToAdd = 2000;
                isSubscription = true;
                planName = 'pro';
            } else if (variantId === VARIANT_STUDIO) {  // Studio $139 / mo
                pointsToAdd = 9000;
                isSubscription = true;
                planName = 'studio';
            } else if (variantId === VARIANT_TOPUP) {   // Top-up $18 一次
                pointsToAdd = 200;
                isSubscription = false;
                planName = null; // Top-up 不改變訂閱等級
            }

            if (pointsToAdd > 0) {
                // 先查詢使用者是否已存在，以及他背後的綁定關聯
                const { data: user } = await supabase
                    .from('users')
                    .select('points, lifetime_points, referred_by, referral_rewarded')
                    .eq('email', customerEmail)
                    .single();

                if (user) {
                    // 雙軌錢包：訂閱方案刷新 points（月費），單購累加 lifetime_points（永久）
                    // 升級訂閱時，將舊月費剩餘點數 carry over 到 lifetime_points，不讓用戶損失
                    let carryOver = isSubscription ? (user.points || 0) : 0;
                    let newPoints = isSubscription ? pointsToAdd : user.points;
                    let newLifetimePoints = (user.lifetime_points || 0) + carryOver + (isSubscription ? 0 : pointsToAdd);

                    const updatePayload = {
                        points: newPoints,
                        lifetime_points: newLifetimePoints,
                        is_beta_tester: true,
                        last_topup_at: new Date().toISOString(),
                    };
                    // Top-up 不覆蓋現有訂閱等級；訂閱升級時才更新
                    if (planName !== null) updatePayload.subscription_plan = planName;

                    await supabase
                        .from('users')
                        .update(updatePayload)
                        .eq('email', customerEmail);

                    // 紀錄充值交易（含 order_id 防重複）
                    await supabase.from('transactions').insert([{
                        user_email: customerEmail,
                        amount: pointsToAdd,
                        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE',
                        order_id: orderId || null
                    }]);

                    console.log(`[🚀金流] 成功為 ${customerEmail} 充值！月費餘額：${newPoints}, 永久餘額: ${newLifetimePoints}`);

                    // Referral 200+200：首次訂閱購買時觸發
                    if (isSubscription && user.referred_by && !user.referral_rewarded) {
                        await triggerReferralReward(customerEmail, user.referred_by);
                    }

                } else {
                    // 不存在 -> 直接建立新使用者並給予點數
                    let initPoints = isSubscription ? pointsToAdd : 0;
                    let initLifetime = isSubscription ? 0 : pointsToAdd;
                    await supabase
                        .from('users')
                        .insert([{
                            email: customerEmail,
                            points: initPoints,
                            lifetime_points: initLifetime,
                            is_beta_tester: true,
                            subscription_plan: planName,
                            last_topup_at: new Date().toISOString(),
                        }]);

                    // 紀錄充值交易（含 order_id 防重複）
                    await supabase.from('transactions').insert([{
                        user_email: customerEmail,
                        amount: pointsToAdd,
                        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE',
                        order_id: orderId || null
                    }]);
                    console.log(`[🚀金流] 新建用戶 ${customerEmail} 並充值！月費 ${initPoints}, 永久 ${initLifetime} 點。`);
                    // 新建用戶無 referred_by，不觸發 referral
                }
            }

        } else if (eventName === 'subscription_payment_success') {
            // 訂閱月費自動續費 → 按用戶現有方案重置月費點數
            const customerEmail = orderData.user_email;
            const subscriptionId = event.data?.id?.toString();

            if (!customerEmail) {
                console.warn('[⚠️續費] 缺少 user_email，跳過');
                return res.status(200).json({ status: 'success' });
            }

            // 冪等性：同一筆訂閱發票不重複充值
            if (subscriptionId) {
                const { data: existingTx } = await supabase
                    .from('transactions')
                    .select('id')
                    .eq('order_id', `sub_${subscriptionId}`)
                    .maybeSingle();
                if (existingTx) {
                    console.log(`[🔁冪等] 訂閱發票 ${subscriptionId} 已處理過，跳過`);
                    return res.status(200).json({ ok: true, skipped: true });
                }
            }

            // 查詢用戶現有訂閱方案
            const { data: user } = await supabase
                .from('users')
                .select('subscription_plan')
                .eq('email', customerEmail)
                .single();

            const PLAN_POINTS = { starter: 300, pro: 2000, studio: 9000 };
            const renewPoints = PLAN_POINTS[user?.subscription_plan];

            if (renewPoints) {
                await supabase.from('users').update({ points: renewPoints, last_topup_at: new Date().toISOString() }).eq('email', customerEmail);
                await supabase.from('transactions').insert([{
                    user_email: customerEmail,
                    amount: renewPoints,
                    transaction_type: 'TOPUP_RENEWAL',
                    order_id: subscriptionId ? `sub_${subscriptionId}` : null
                }]);
                console.log(`[🔄續費] ${customerEmail} 方案 ${user.subscription_plan} 重置 ${renewPoints} 點`);
            } else {
                console.warn(`[⚠️續費] ${customerEmail} 無訂閱方案記錄，跳過`);
            }
        }

        // 回傳成功狀態讓 LemonSqueezy 知道我們收到了
        return res.status(200).json({ status: 'success' });

    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// Referral 200+200 獎勵：給 referee 和 referrer 各 +200 lifetime_points
async function triggerReferralReward(refereeEmail, referralCode) {
    try {
        // 找到 referrer
        const { data: referrer } = await supabase
            .from('users')
            .select('email, lifetime_points')
            .eq('referral_code', referralCode)
            .single();

        if (!referrer) {
            console.warn(`[邀請碼] 找不到 referrer（code: ${referralCode}）`);
            return;
        }

        // 給 referee +200 lifetime_points，標記 referral_rewarded
        const { data: referee } = await supabase.from('users').select('lifetime_points').eq('email', refereeEmail).single();
        await supabase.from('users').update({
            lifetime_points: (referee?.lifetime_points || 0) + 200,
            referral_rewarded: true,
        }).eq('email', refereeEmail);

        // 給 referrer +200 lifetime_points
        await supabase.from('users').update({
            lifetime_points: (referrer.lifetime_points || 0) + 200,
        }).eq('email', referrer.email);

        // 記錄交易
        await supabase.from('transactions').insert([
            { user_email: refereeEmail, amount: 200, transaction_type: 'REFERRAL_BONUS_REFEREE' },
            { user_email: referrer.email, amount: 200, transaction_type: 'REFERRAL_BONUS_REFERRER' },
        ]);

        console.log(`[🎁邀請碼] ${refereeEmail} ↔ ${referrer.email} 各 +200 lifetime_points`);
    } catch (err) {
        console.error('[邀請碼] 獎勵發放失敗：', err);
    }
}

// 輔助函數：供 Next.js / Vercel 正確擷取 Raw Body
// 注意：在某些 Vercel 版本中，如果使用了 bodyParser，這段可能會失效。
// 建議在生產環境中通過 config 關閉 bodyParser。
async function getRawBody(req) {
    if (req.body instanceof Buffer) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);

    return new Promise((resolve, reject) => {
        let chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', (err) => reject(err));
    });
}
