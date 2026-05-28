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

            if (event.type === 'payment.refunded') {
                const paymentId = event.data?.payment_id;
                if (paymentId) await cancelKolCommission(`DODO_${paymentId}`);
                return res.status(200).json({ status: 'success' });
            }

            if (event.type === 'payment.failed') {
                const customerEmail = event.data?.customer?.email;
                if (customerEmail) await sendDunningEmail(customerEmail);
                return res.status(200).json({ status: 'success' });
            }

            if (event.type === 'payment.succeeded') {
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
                let variantId = data.product_cart?.[0]?.product_id || data.product_id || data.plan_id;
                const orderId = data.payment_id;
                const discountCode = data.discount?.code || data.discount_code || null;

                // 某些訂閱的 payment.succeeded 不帶 product_id → 用 subscription_id 補查
                if (!variantId && data.subscription_id && process.env.DODO_API_KEY) {
                    try {
                        const subRes = await fetch(
                            `https://live.dodopayments.com/subscriptions/${data.subscription_id}`,
                            { headers: { 'Authorization': `Bearer ${process.env.DODO_API_KEY}` } }
                        );
                        const subData = await subRes.json();
                        variantId = subData.product_id || subData.plan_id || subData.items?.[0]?.product_id;
                        console.log(`[Dodo] Resolved variantId from subscription lookup: ${variantId}`);
                    } catch (e) {
                        console.warn('[Dodo] subscription lookup failed:', e.message);
                    }
                }

                if (customerEmail && variantId && orderId) {
                    try {
                        await processTopup(customerEmail, variantId, orderId, 'DODO', discountCode, data.subscription_id);
                    } catch (e) {
                        await logWebhookError('DODO', event.type, orderId, customerEmail, e.message, data);
                        throw e; // 讓外層回傳 500，Dodo 會重試
                    }
                } else {
                    await logWebhookError('DODO', event.type, orderId, customerEmail || 'unknown', `Missing fields: variantId=${variantId} orderId=${orderId}`, data);
                    throw new Error(`payment.succeeded missing fields: email=${customerEmail} variantId=${variantId} orderId=${orderId}`);
                }
            }
            
            if (event.type === 'subscription.active' || event.type === 'subscription.renewed') {
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
                const subProductId = data.product_id || data.plan_id || data.product_cart?.[0]?.product_id;
                if (customerEmail && data.subscription_id) {
                    // 先存 subscription_id（無論 product_id 是否存在都做）
                    await supabase.from('users').update({ dodo_subscription_id: data.subscription_id }).eq('email', customerEmail)
                        .catch(e => console.warn('[Dodo] update subscription_id failed:', e.message));
                }
                if (customerEmail && data.subscription_id && subProductId) {
                    const period = data.current_period_start || new Date().toISOString().substring(0, 7);
                    const fallbackOrderId = `${data.subscription_id}_${period}`;

                    // 防雙發：若同週期已有 payment.succeeded 產生的 DODO_pay_% 記錄，跳過 processTopup
                    const periodStart = period.length === 7 ? `${period}-01T00:00:00Z` : new Date(period).toISOString();
                    const { data: existingPayTx } = await supabase
                        .from('transactions')
                        .select('id, order_id')
                        .eq('user_email', customerEmail)
                        .eq('transaction_type', 'TOPUP_SUBSCRIPTION')
                        .like('order_id', 'DODO_pay_%')
                        .gte('created_at', periodStart)
                        .maybeSingle();

                    if (existingPayTx) {
                        console.log(`[Dodo] ${event.type} skipped — payment.succeeded 已處理: ${existingPayTx.order_id}`);
                    } else {
                        // 真正的 fallback：payment.succeeded 未成功，由此補發
                        try {
                            await processTopup(customerEmail, subProductId, fallbackOrderId, 'DODO', null, data.subscription_id);
                            console.log(`[Dodo] ${event.type} fallback processTopup OK: ${customerEmail}`);
                        } catch (e) {
                            if (!e.message.includes('Unknown product')) {
                                await logWebhookError('DODO', event.type, fallbackOrderId, customerEmail, e.message, data);
                            }
                        }
                    }
                }
            } else if (event.type === 'subscription.cancelled' || event.type === 'subscription.canceled' || event.type === 'subscription.expired') {
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
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

            if (eventName === 'order_refunded') {
                const orderId = event.data?.id?.toString();
                if (orderId) await cancelKolCommission(`LS_${orderId}`);
                return res.status(200).json({ status: 'success' });
            }

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
                    try {
                        await processTopup(customerEmail, variantId, orderId, 'LS');
                    } catch (e) {
                        await logWebhookError('LS', eventName, orderId, customerEmail, e.message, event.data?.attributes);
                        throw e;
                    }
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
        subscription_plan: null,
        cancel_pending: false,
        dodo_subscription_id: null
    }).eq('email', customerEmail);
}

const IDS = {
    LS: { TOPUP: 1432023, STARTER: 1432194, PRO: 1432198, STUDIO: 1432205 },
    DODO: {
        TOPUP: 'pdt_0NbIlveGNSETSOveL7Xmk',
        STARTER: 'pdt_0NblmUvFrwJe36ymTELWV',
        PRO: 'pdt_0NblmafncbUuGNrMRvJp4',
        STUDIO: 'pdt_0Nblmhwbr5WXfNyDHpaA2'
    }
};

// 核心充值邏輯 (從 LS 邏輯抽離，支援多平台)
async function processTopup(customerEmail, variantId, orderId, platform, discountCode = null, subscriptionId = null) {
    // 冪等性檢查
    const fullOrderId = `${platform}_${orderId}`;
    const { data: existingTx } = await supabase.from('transactions').select('id').eq('order_id', fullOrderId).maybeSingle();
    if (existingTx) return console.log(`[🔁冪等] ${fullOrderId} 已處理過`);

    const pIds = IDS[platform];
    let pointsToAdd = 0;
    let planName = null;
    let isSubscription = false;

    if (variantId == pIds.STARTER) { pointsToAdd = 300; planName = 'starter'; isSubscription = true; }
    else if (variantId == pIds.PRO) { pointsToAdd = 2000; planName = 'pro'; isSubscription = true; }
    else if (variantId == pIds.STUDIO) { pointsToAdd = 9000; planName = 'studio'; isSubscription = true; }
    else if (variantId == pIds.TOPUP) { pointsToAdd = 200; isSubscription = false; }

    if (pointsToAdd <= 0) {
        // 拋出讓外層回傳 500 → Dodo 自動重試，不再靜默丟棄
        throw new Error(`Unknown product ID: ${variantId} (${platform})`);
    }

    // 【T1修復】先查 KOL 碼對應的邀請人，再取/建用戶，確保新用戶也能完成歸因
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

    // 若已取消訂閱（subscription_plan: null），訂閱型點數不補發（防 webhook 時序問題）
    if (isSubscription && user && user.subscription_plan === null) {
        return console.log(`[🚫跳過] ${customerEmail} 訂閱已取消，不補發點數 (orderId: ${fullOrderId})`);
    }

    if (!user) {
        // 新用戶：建立時帶入 referred_by（若有折扣碼歸因）
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
        // 舊用戶晚期歸因：帶折扣碼但未透過插件綁定
        await supabase.from('users').update({ referred_by: kolEmailFromCode }).eq('email', customerEmail);
        user.referred_by = kolEmailFromCode;
        console.log(`[💡KOL晚期綁定] discount_code=${discountCode}: ${customerEmail} → ${kolEmailFromCode}`);
    }

    // 推薦分銷邏輯（新舊用戶均適用）：B 首次付費 → A +300、B +100
    let bonusB = 0;
    if (user?.referred_by) {
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

    // 儲存 Dodo subscription_id（供 save_offer pause 使用，Phase 24 migration 前不影響主流程）
    if (isSubscription && subscriptionId) {
        supabase.from('users').update({ dodo_subscription_id: subscriptionId }).eq('email', customerEmail)
            .then(() => {}).catch(e => console.warn('[subscription_id] store failed (non-fatal):', e.message));
    }

    // 點數結轉與更新（無論新舊用戶統一走此路徑）
    const carryOver = isSubscription ? (user?.points || 0) : 0;
    const updatePayload = {
        points: isSubscription ? pointsToAdd : (user?.points || 0),
        lifetime_points: (user?.lifetime_points || 0) + carryOver + (isSubscription ? 0 : pointsToAdd) + bonusB,
        is_beta_tester: true,
        last_topup_at: new Date().toISOString(),
    };
    if (planName) updatePayload.subscription_plan = planName;
    await supabase.from('users').update(updatePayload).eq('email', customerEmail);

    // 紀錄交易
    const PLAN_PRICES_CENTS = { starter: 700, pro: 1500, studio: 3500, topup: 490 };
    const amountPaid = planName ? (PLAN_PRICES_CENTS[planName] || 490) : 490;
    await supabase.from('transactions').insert([{
        user_email: customerEmail,
        amount: pointsToAdd,
        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE',
        order_id: fullOrderId,
        amount_usd_cents: amountPaid
    }]);

    // KOL 分潤快照（每次付款均觸發，與首單點數獎勵並行）
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
            .select('referral_code, referral_success_count, is_kol, is_partner').eq('email', kolEmail).maybeSingle();
        if (!kol?.referral_code || (!kol.is_kol && !kol.is_partner)) return;

        const paidCount = kol.referral_success_count || 0;
        const tier = paidCount <= 50 ? 1 : paidCount <= 100 ? 2 : 3;
        // KOL: 5%/10%/15%；Partner（內部）: 15%/20%/25%
        const rate = kol.is_partner
            ? [0.15, 0.20, 0.25][tier - 1]
            : [0.05, 0.10, 0.15][tier - 1];
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
        const role = kol.is_partner ? 'partner' : 'kol';
        console.log(`[💰${role.toUpperCase()}] ${kolEmail} Tier${tier} +${commission}¢ (rate=${rate})`);
    } catch (e) {
        console.warn('[KOL] writeKolCommission failed (non-fatal):', e.message);
    }
}

async function cancelKolCommission(fullOrderId) {
    try {
        const { error } = await supabase.from('kol_ledger')
            .update({ status: 'cancelled' })
            .eq('transaction_id', fullOrderId)
            .eq('status', 'pending');
        if (error) throw error;
        console.log(`[🔴退款] kol_ledger 已標記 cancelled: ${fullOrderId}`);
    } catch (e) {
        console.warn('[KOL] cancelKolCommission failed (non-fatal):', e.message);
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

async function sendDunningEmail(email) {
    try {
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

        // dedup：3 天內不重複發
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        const { data: recent } = await supabase.from('email_logs')
            .select('id').eq('user_email', email).eq('template_name', 'dunning')
            .gte('sent_at', threeDaysAgo).maybeSingle();
        if (recent) return console.log(`[Dunning] 3 天內已發送，跳過: ${email}`);

        const { default: nodemailer } = await import('nodemailer');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
        });

        const subject = '您的 LoamLab 訂閱扣款失敗，請更新付款方式';
        const bodyText = `親愛的設計師，\n\n您的 LoamLab 訂閱因信用卡扣款失敗而暫停。\n\n請前往以下連結更新您的付款資訊，確保點數和渲染服務不中斷：\n\nhttps://loamlab.studio/billing\n\n如有任何疑問，請回覆此信聯繫我們。\n\nLoamLab 團隊`;
        const bodyHtml = bodyText.replace(/\n/g, '<br>');
        const html = `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e2e8f0"><div style="font-size:18px;font-weight:700;color:#e2e8f0;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #1e293b">${subject}</div><div style="line-height:1.9;color:#cbd5e1;margin-top:16px">${bodyHtml}</div><p style="font-size:11px;color:#475569;margin-top:40px;border-top:1px solid #1e293b;padding-top:16px">LoamLab · <a href="https://loamlab.studio" style="color:#7c3aed;text-decoration:none">loamlab.studio</a> · <a href="https://loamlab.studio/unsubscribe" style="color:#475569;text-decoration:none">退訂 / Unsubscribe</a></p></div>`;

        await transporter.sendMail({ from: `LoamLab <${process.env.GMAIL_USER}>`, to: email, subject, html });
        await supabase.from('email_logs').insert([{ user_email: email, template_name: 'dunning', sent_at: new Date().toISOString() }]);
        console.log(`[Dunning] 扣款失敗通知已發送: ${email}`);
    } catch (e) {
        console.warn('[Dunning] email failed (non-fatal):', e.message);
    }
}

// 付款失敗時寫入審計表，讓每筆付款都有記錄可追蹤與手動補償
async function logWebhookError(platform, eventType, orderId, customerEmail, errorMsg, rawData) {
    try {
        await supabase.from('webhook_errors').insert([{
            platform,
            event_type: eventType,
            order_id: orderId,
            customer_email: customerEmail,
            error_message: errorMsg,
            raw_payload: JSON.stringify(rawData)?.substring(0, 8000),
            created_at: new Date().toISOString(),
        }]);
        console.error(`[🚨WebhookError] ${platform} ${eventType} ${orderId} — ${errorMsg}`);
    } catch (_) {
        // 不讓日誌失敗影響主流程
    }
}
