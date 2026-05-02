import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { PRICING_CONFIG } from '../config.js';

// 初始化 Supabase (優先使用 Service Role)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''; 
const supabase = createClient(supabaseUrl, supabaseKey);

const WEB_SECRET_LS = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
const WEB_SECRET_DODO = process.env.DODO_WEBHOOK_SECRET || '';

// Vercel 設定：停用自動解析 JSON 格式，以便讀取原始 HMAC 簽章
export const config = {
    api: { bodyParser: false },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const rawBody = await getRawBody(req);
        const sigLS = req.headers['x-signature'];
        const sigDodo = req.headers['webhook-signature'];

        if (sigDodo) {
            // --- 處理 Dodo Payments Webhook ---
            if (!verifyDodoSignature(rawBody, req.headers, WEB_SECRET_DODO)) {
                return res.status(401).json({ error: 'Invalid Dodo Signature' });
            }
            const event = JSON.parse(rawBody.toString());
            console.log('[Dodo] Event received:', event.type);

            if (event.type === 'payment.succeeded' || event.type === 'subscription.active' || event.type === 'subscription.renewed') {
                const data = event.data;
                const customerEmail = data.customer?.email;
                // Dodo 的商品 ID 在 product_cart[0].product_id，或直接在 data.product_id
                const variantId = data.product_cart?.[0]?.product_id || data.product_id;
                
                // 【修復雙倍點數 Bug】如果是訂閱的 payment.succeeded，直接忽略，交給 subscription.active 處理
                if (event.type === 'payment.succeeded' && variantId !== 'pdt_0NbIlveGNSETSOveL7Xmk') {
                    console.log(`[Dodo] 忽略訂閱的 payment.succeeded，交給 active/renewed 處理`);
                    return res.status(200).json({ status: 'ignored' });
                }

                // 【修復續約 0 點 Bug】續約時 subscription_id 相同，必須加上週期時間防止冪等擋下
                let orderId = data.payment_id || data.subscription_id;
                if (event.type === 'subscription.renewed' || event.type === 'subscription.active') {
                    const period = data.current_period_start || new Date().toISOString().substring(0, 7);
                    orderId = `${data.subscription_id}_${period}`;
                }

                // 從 payload 讀取折扣碼（用於晚期 KOL 歸因）
                const discountCode = data.discount?.code || data.discount_code || null;

                if (customerEmail && variantId) {
                    await processTopup(customerEmail, variantId, orderId, 'DODO', discountCode);
                }
            } else if (event.type === 'subscription.cancelled' || event.type === 'subscription.canceled' || event.type === 'subscription.expired') {
                const data = event.data;
                const customerEmail = data.customer?.email;
                if (customerEmail) {
                    await processCancellation(customerEmail, 'DODO');
                }
            }
            return res.status(200).json({ status: 'success' });

        } else if (sigLS) {
            // --- 處理 LemonSqueezy Webhook ---
            if (!verifySignature(rawBody, sigLS, WEB_SECRET_LS)) {
                return res.status(401).json({ error: 'Invalid LS Signature' });
            }
            const event = JSON.parse(rawBody.toString());
            const eventName = event.meta.event_name;
            console.log('[LS] Event received:', eventName);

            if (eventName === 'order_created' || eventName === 'subscription_payment_success') {
                const orderData = event.data.attributes;
                const customerEmail = orderData.user_email;
                const variantId = orderData.first_order_item?.variant_id || orderData.variant_id;
                const orderId = event.data?.id?.toString();

                // 【修復雙倍點數 Bug】如果是訂閱的 order_created，直接忽略，交給 subscription_payment_success 處理
                if (eventName === 'order_created' && variantId != 1432023) {
                    console.log(`[LS] 忽略訂閱的 order_created，交給 subscription_payment_success 處理`);
                    return res.status(200).json({ status: 'ignored' });
                }

                if (customerEmail && variantId) {
                    await processTopup(customerEmail, variantId, orderId, 'LS');
                }
            } else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
                const orderData = event.data.attributes;
                const customerEmail = orderData.user_email;
                if (customerEmail) {
                    await processCancellation(customerEmail, 'LS');
                }
            }
            return res.status(200).json({ status: 'success' });
        }

        return res.status(401).json({ error: 'Missing Signature' });

    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function processCancellation(customerEmail, platform) {
    console.log(`[🛑取消訂閱] 處理 ${platform} 取消: ${customerEmail}`);
    await supabase.from('users').update({
        subscription_plan: null
    }).eq('email', customerEmail);
}

// 核心充值邏輯 (從 LS 邏輯抽離，支援多平台)
async function processTopup(customerEmail, variantId, orderId, platform, discountCode = null) {
    // 冪等性檢查
    const fullOrderId = `${platform}_${orderId}`;
    const { data: existingTx } = await supabase.from('transactions').select('id').eq('order_id', fullOrderId).maybeSingle();
    if (existingTx) return console.log(`[🔁冪等] ${fullOrderId} 已處理過`);

    // 平台 ID 對應表 (支援 LS 與 Dodo)
    // 這裡建議未來將 ID 移入環境變數或資料庫，目前保留寫死以匹配原有邏輯
    const IDS = {
        LS: { TOPUP: 1432023, STARTER: 1432194, PRO: 1432198, STUDIO: 1432205 },
        DODO: {
            TOPUP: 'pdt_0NbIlveGNSETSOveL7Xmk',
            STARTER: 'pdt_0NbImUvFnwJe36ymTELWV',
            PRO: 'pdt_0NbImafnebUuGNrMRvJp4',
            STUDIO: 'pdt_0NbImhwhr5WXfNyDHpaA2'
        }
    };

    const pIds = IDS[platform];
    let pointsToAdd = 0;
    let planName = null;
    let isSubscription = false;

    if (variantId == pIds.STARTER) { pointsToAdd = 300; planName = 'starter'; isSubscription = true; }
    else if (variantId == pIds.PRO) { pointsToAdd = 2000; planName = 'pro'; isSubscription = true; }
    else if (variantId == pIds.STUDIO) { pointsToAdd = 9000; planName = 'studio'; isSubscription = true; }
    else if (variantId == pIds.TOPUP) { pointsToAdd = 200; isSubscription = false; }

    if (pointsToAdd <= 0) return console.warn(`[⚠️充值] 未知商品 ID: ${variantId} (${platform})`);

    const { data: user } = await supabase.from('users').select('*').eq('email', customerEmail).maybeSingle();

    // 晚期 KOL 歸因：買家直接在結帳頁輸入折扣碼但未透過插件綁定時，補寫 referred_by
    if (discountCode && user && !user.referred_by) {
        try {
            const { data: kolByCode } = await supabase.from('users')
                .select('email').eq('referral_code', discountCode.toUpperCase()).eq('is_kol', true).maybeSingle();
            if (kolByCode && kolByCode.email !== customerEmail) {
                await supabase.from('users').update({ referred_by: kolByCode.email }).eq('email', customerEmail);
                user.referred_by = kolByCode.email;
                console.log(`[💡KOL晚期綁定] discount_code=${discountCode}: ${customerEmail} → ${kolByCode.email}`);
            }
        } catch (e) {
            console.warn('[KOL] late-bind failed (non-fatal):', e.message);
        }
    }

    if (user) {
        // 推薦分銷邏輯 (Paid Referral)：B 首次付費 → A +300、B +100（固定）
        let bonusB = 0;
        if (user.referred_by) {
            const { data: txPaid } = await supabase.from('transactions').select('id').eq('user_email', customerEmail).eq('transaction_type', 'REFERRAL_PAID_B').maybeSingle();
            if (!txPaid) {
                const REWARD_A = PRICING_CONFIG.referral.paid_reward_a;
                const REWARD_B = PRICING_CONFIG.referral.paid_reward_b;
                bonusB = REWARD_B;
                const { data: inviter } = await supabase.from('users').select('lifetime_points, referral_success_count').eq('email', user.referred_by).single();
                if (inviter) {
                    await supabase.from('users').update({
                        lifetime_points: (inviter.lifetime_points || 0) + REWARD_A,
                        referral_success_count: (inviter.referral_success_count || 0) + 1
                    }).eq('email', user.referred_by);
                    await supabase.from('transactions').insert([
                        { user_email: user.referred_by, amount: REWARD_A, transaction_type: 'REFERRAL_PAID_A', order_id: `refA_${fullOrderId}` },
                        { user_email: customerEmail, amount: REWARD_B, transaction_type: 'REFERRAL_PAID_B', order_id: `refB_${fullOrderId}` }
                    ]);
                }
            }
        }

        // 點數結轉與更新
        const carryOver = isSubscription ? (user.points || 0) : 0;
        const updatePayload = {
            points: isSubscription ? pointsToAdd : user.points,
            lifetime_points: (user.lifetime_points || 0) + carryOver + (isSubscription ? 0 : pointsToAdd) + bonusB,
            is_beta_tester: true,
            last_topup_at: new Date().toISOString(),
        };
        if (planName) updatePayload.subscription_plan = planName;
        await supabase.from('users').update(updatePayload).eq('email', customerEmail);
    } else {
        // 新用戶直接建立
        await supabase.from('users').insert([{
            email: customerEmail,
            points: isSubscription ? pointsToAdd : 0,
            lifetime_points: isSubscription ? 0 : pointsToAdd,
            is_beta_tester: true,
            subscription_plan: planName,
            last_topup_at: new Date().toISOString(),
        }]);
    }

    // 紀錄交易
    await supabase.from('transactions').insert([{
        user_email: customerEmail,
        amount: pointsToAdd,
        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE',
        order_id: fullOrderId
    }]);

    // KOL 分潤快照（每次付款均觸發，與首單點數獎勵並行）
    const PLAN_PRICES_CENTS = { starter: 700, pro: 1500, studio: 3500, topup: 490 };
    const amountPaid = planName ? (PLAN_PRICES_CENTS[planName] || 490) : 490;
    await writeKolCommission(customerEmail, amountPaid, fullOrderId);

    console.log(`[🚀金流] 成功處理 ${platform} 充值: ${customerEmail} (+${pointsToAdd} pts)`);
}

async function writeKolCommission(buyerEmail, amountPaid, orderId) {
    try {
        const { data: buyer } = await supabase.from('users')
            .select('referred_by').eq('email', buyerEmail).maybeSingle();
        if (!buyer?.referred_by) return;

        const kolEmail = buyer.referred_by;
        const { data: kol } = await supabase.from('users')
            .select('referral_code, referral_success_count, is_kol').eq('email', kolEmail).maybeSingle();
        if (!kol?.referral_code || !kol.is_kol) return; // 只有 KOL 帳號才計入現金分潤

        // 以 referral_success_count 判斷 Tier（已由首單獎勵邏輯維護）
        // Tier 1: 1-50人 5%；Tier 2: 51-100人 10%；Tier 3: >100人 15%
        const paidCount = kol.referral_success_count || 0;
        const rate = paidCount <= 50 ? 0.05 : paidCount <= 100 ? 0.10 : 0.15;
        const commission = Math.round(amountPaid * rate);

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
        console.log(`[💰KOL] ${kolEmail} Tier${paidCount <= 50 ? 1 : paidCount <= 100 ? 2 : 3} +${commission}¢ (rate=${rate})`);
    } catch (e) {
        console.warn('[KOL] writeKolCommission failed (non-fatal):', e.message);
    }
}

function verifySignature(rawBody, signature, secret) {
    if (!secret || !signature) return false;
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// Dodo Payments 使用 Standard Webhooks 規範：簽署內容 = webhook-id.webhook-timestamp.body
function verifyDodoSignature(rawBody, headers, secret) {
    const msgId = headers['webhook-id'];
    const msgTimestamp = headers['webhook-timestamp'];
    const sigHeader = headers['webhook-signature'];
    if (!msgId || !msgTimestamp || !sigHeader || !secret) return false;
    const signedContent = `${msgId}.${msgTimestamp}.${rawBody.toString()}`;
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const hmac = crypto.createHmac('sha256', secretBytes);
    const digest = hmac.update(signedContent).digest('base64');
    // sigHeader 可能含多個簽名，格式為 "v1,base64sig v1,base64sig2"
    const signatures = sigHeader.split(' ').map(s => s.split(',')[1]).filter(Boolean);
    return signatures.some(sig => sig === digest);
}

async function getRawBody(req) {
    if (req.body instanceof Buffer) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    return new Promise((resolve) => {
        let chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
