import crypto from 'crypto';

import { processTopup, makeSupabase } from '../lib/activate.js';

const supabase = makeSupabase();

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
                        await processTopup(supabase, customerEmail, variantId, orderId, 'DODO', discountCode, data.subscription_id);
                    } catch (e) {
                        await logWebhookError('DODO', event.type, orderId, customerEmail, e.message, data);
                        throw e; // 讓外層回傳 500，Dodo 會重試
                    }
                } else {
                    await logWebhookError('DODO', event.type, orderId, customerEmail || 'unknown', `Missing fields: variantId=${variantId} orderId=${orderId}`, data);
                    // 結構性缺欄位，重試無法修復，回傳 200 停止 Dodo 無限重試；已記錄於 webhook_errors
                    return res.status(200).json({ status: 'logged', reason: 'missing_fields' });
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
                            await processTopup(supabase, customerEmail, subProductId, fallbackOrderId, 'DODO', null, data.subscription_id);
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
                        await processTopup(supabase, customerEmail, variantId, orderId, 'LS');
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
