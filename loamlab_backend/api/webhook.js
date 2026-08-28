import crypto from 'crypto';

import { processTopup, makeSupabase, cancelDodoSubscription, fetchDodoSubscriptionInfo } from '../lib/activate.js';
import { PLAN_DEFS } from '../config.js';

const supabase = makeSupabase();

const WEB_SECRET_DODO = process.env.DODO_WEBHOOK_SECRET || '';

// Dodo 官方訂閱生命週期事件（見 docs.dodopayments.com/developer-resources/webhooks/intents/subscription）
// 這些事件都可能帶最新的訂閱快照，一律走 syncSubscriptionState 鏡射，不特化猜測哪個事件才會帶哪個欄位
const SUBSCRIPTION_SYNC_EVENTS = new Set([
    'subscription.active', 'subscription.renewed', 'subscription.updated',
    'subscription.plan_changed', 'subscription.on_hold',
]);
const PLAN_TIERS = { starter: 1, pro: 2, studio: 3 };

// Vercel 設定：停用自動解析 JSON 格式，以便讀取原始 HMAC 簽章
export const config = {
    api: { bodyParser: false },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    let sigDodo, event;
    try {
        const rawBody = await getRawBody(req);
        sigDodo = req.headers['webhook-signature'];

        if (sigDodo) {
            // --- 處理 Dodo Payments Webhook ---
            if (!verifyDodoSignature(rawBody, req.headers, WEB_SECRET_DODO)) {
                await logWebhookError('DODO', 'signature_verification', null, null, 'Invalid Dodo Signature', null);
                return res.status(401).json({ error: 'Invalid Dodo Signature' });
            }
            event = JSON.parse(rawBody.toString());
            console.log('[Dodo] Event received:', event.type);

            if (event.type === 'payment.refunded' || event.type === 'payment.disputed') {
                const paymentId = event.data?.payment_id;
                if (paymentId) {
                    await cancelKolCommission(`DODO_${paymentId}`);
                    await clawbackPoints(paymentId, event.type);
                    await markPaymentStatus(paymentId, event.type === 'payment.disputed' ? 'chargeback' : 'refunded');
                }
                return res.status(200).json({ status: 'success' });
            }

            if (event.type === 'payment.failed') {
                const customerEmail = event.data?.customer?.email;
                if (customerEmail) {
                    await sendDunningEmail(customerEmail);
                    await Promise.resolve(supabase.from('users').update({ payment_failed: true }).eq('email', customerEmail))
                        .catch(e => console.warn('[Dodo] set payment_failed failed:', e.message));
                }
                return res.status(200).json({ status: 'success' });
            }

            if (event.type === 'payment.succeeded') {
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
                let variantId = data.product_cart?.[0]?.product_id || data.product_id || data.plan_id;
                // orderId 含 payment_id（全域唯一），Supabase UNIQUE(order_id) 即可防止重複發放；
                // 訂閱付款保留 subscription_id 前綴，與既有歷史交易紀錄格式一致，避免重複入帳
                const orderId = data.subscription_id ? `${data.subscription_id}_${data.payment_id}` : data.payment_id;
                const discountCode = data.discount?.code || data.discount_code || null;
                const planKey = data.metadata?.planKey || null;
                const dodoCustomerId = data.customer?.customer_id || null;
                // 實付金額（美分），供 processTopup 做洗點金額校驗與精準記帳。
                // 【Task 3・已用 Dodo 官方文件查證】只能用 total_amount：它跟訂閱物件的
                // recurring_pre_tax_amount（expectedAmountCents 的來源）同屬「結帳當下幣別」，
                // 兩者才能直接比對。settlement_amount 是「商戶結算幣別」（adaptive pricing 情境下
                // 可能是不同幣別，例如客戶用台幣結帳、商戶用美元結算），拿來跟 expectedAmountCents
                // 比對是拿不同幣別的數字互比，比對結果沒有意義——total_amount 缺失就當作拿不到，
                // 交由 processTopup 既有的「兩者缺一就跳過驗證」邏輯處理，不要用不同幣別的數字硬湊。
                const amountPaidCents = (typeof data.total_amount === 'number') ? data.total_amount : null;

                // 無主訂單攔截：email 缺失或為 Apple Pay 匿名信箱 → 留稽核紀錄，不丟棄金流
                if (isAnonymousEmail(customerEmail)) {
                    console.warn(`[🔒無主訂單] payment.succeeded 無有效 email: orderId=${orderId}`);
                    await logWebhookError('DODO', event.type, orderId, customerEmail || 'unknown',
                        `Unclaimed: email missing or Apple Pay anonymous (${customerEmail})`, data, 'unclaimed');
                    return res.status(200).json({ status: 'unclaimed', reason: 'anonymous_email' });
                }

                // 【洗點防禦・第一性原理 2026-07】訂閱付款一律去問 Dodo「這筆訂閱真正鎖定多少錢」
                // （recurring_pre_tax_amount，已涵蓋任何折扣碼），取代自己猜價格表 × 比例的舊做法；
                // 順便補上遺漏的 product_id（部分 payment.succeeded 不帶 product_cart）。
                // 查不到就不能發點——回 500 讓 Dodo 重試，而不是在沒驗證金額的情況下放行。
                let expectedAmountCents = null;
                if (data.subscription_id) {
                    const subInfo = await fetchDodoSubscriptionInfo(data.subscription_id);
                    if (!variantId) variantId = subInfo.productId;
                    expectedAmountCents = subInfo.expectedAmountCents;
                    if (expectedAmountCents == null) {
                        await logWebhookError('DODO', event.type, orderId, customerEmail || 'unknown',
                            'subscription 真實金額查詢失敗，暫緩發點等待重試', data);
                        return res.status(500).json({ error: 'subscription_amount_lookup_failed_retry' });
                    }
                }

                if (customerEmail) {
                    await Promise.resolve(supabase.from('users').update({ payment_failed: false }).eq('email', customerEmail))
                        .catch(e => console.warn('[Dodo] clear payment_failed failed:', e.message));
                }
                if (customerEmail && (variantId || planKey) && orderId) {
                    // 唯一真理來源：processTopup 內部以 UNIQUE(order_id) 做冪等檢查，
                    // 重複的 payment_id 會被自然擋下，不需要任何額外的週期/升級判斷

                    // 【Task 2】在 processTopup 覆寫 dodo_subscription_id 之前，先抓「舊訂閱 ID」。
                    // 若這次是全新的訂閱（subscription_id 與舊的不同），發點成功後要主動取消舊訂閱，
                    // 避免用戶同時持有兩筆訂閱被雙重扣款。
                    let oldSubId = null;
                    if (data.subscription_id) {
                        const { data: uRow } = await supabase.from('users')
                            .select('dodo_subscription_id').eq('email', customerEmail).maybeSingle();
                        oldSubId = uRow?.dodo_subscription_id || null;
                    }

                    try {
                        await processTopup(supabase, customerEmail, variantId, orderId, 'DODO', discountCode, data.subscription_id, planKey, dodoCustomerId, amountPaidCents, expectedAmountCents);
                        await recordPayment(orderId, customerEmail, amountPaidCents ?? expectedAmountCents, 'paid', 'DODO');
                        if (data.subscription_id) {
                            await Promise.resolve(supabase.from('users')
                                .update({ dodo_subscription_id: data.subscription_id }).eq('email', customerEmail))
                                .catch(e => console.warn('[Dodo] update subscription_id failed:', e.message));
                            // 發點成功且確為「不同的新訂閱」→ 取消舊訂閱（立即生效，避免雙重扣款）
                            if (oldSubId && oldSubId !== data.subscription_id) {
                                await cancelDodoSubscription(oldSubId);
                            }
                        }
                    } catch (e) {
                        // 洗點防禦攔截：金額異常（proration/0 元）→ 記稽核、回 200 不重試、不寄激活失敗信
                        // （用戶「確實付了」一筆畸零款，但這是我們刻意拒發的，重試與寄信都無意義）
                        if (e.code === 'AMOUNT_VALIDATION_FAILED') {
                            await logWebhookError('DODO', event.type, orderId, customerEmail, e.message, data, 'rejected');
                            return res.status(200).json({ status: 'rejected', reason: 'amount_validation_failed' });
                        }
                        await logWebhookError('DODO', event.type, orderId, customerEmail, e.message, data);
                        await sendActivationFailureEmail(customerEmail, orderId);
                        throw e; // 讓外層回傳 500，Dodo 會重試
                    }
                } else {
                    await logWebhookError('DODO', event.type, orderId, customerEmail || 'unknown', `Missing fields: variantId=${variantId} planKey=${planKey} orderId=${orderId}`, data);
                    if (!process.env.DODO_API_KEY) {
                        // API key 缺失，重試無意義 → 通知用戶 + 停止重試
                        if (customerEmail) await sendActivationFailureEmail(customerEmail, orderId);
                        return res.status(200).json({ status: 'logged', reason: 'api_key_missing' });
                    }
                    // key 存在但 lookup 暫失敗 → 回 500 讓 Dodo 繼續重試
                    return res.status(500).json({ error: 'product_lookup_failed_retry' });
                }
            }
            
            if (SUBSCRIPTION_SYNC_EVENTS.has(event.type)) {
                // 單一事實來源：Dodo 訂閱物件本身就是真相，這裡只把它鏡射進 DB，
                // 不管觸發的是哪個事件（Portal 取消 / 自助升降級 / 續訂 / 扣款失敗進 on_hold）
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
                const isRenewal = event.type === 'subscription.active' || event.type === 'subscription.renewed';
                if (customerEmail) {
                    await syncSubscriptionState(customerEmail, data, {
                        clearNextPlan: isRenewal,     // 新週期開始，降級已由 Dodo 生效
                        allowPlanChange: !isRenewal,  // 只有用戶主動改方案的事件才做升降級判斷
                    });
                }
            } else if (event.type === 'subscription.cancelled' || event.type === 'subscription.canceled' || event.type === 'subscription.expired' || event.type === 'subscription.failed') {
                const data = event.data;
                const customerEmail = data.customer?.email || data.email || data.customer_email;
                if (customerEmail) {
                    await processCancellation(customerEmail, 'DODO');
                }
            }
            return res.status(200).json({ status: 'success' });
        }

        return res.status(401).json({ error: 'Missing Signature' });

    } catch (error) {
        console.error('Webhook Error:', error);
        const platform = sigDodo ? 'DODO' : 'UNKNOWN';
        const evData = event?.data || event?.data?.attributes || null;
        const emailGuess = evData?.customer?.email || evData?.email || evData?.customer_email || evData?.user_email || null;
        const orderGuess = evData?.payment_id || evData?.subscription_id || event?.data?.id || null;
        await logWebhookError(platform, event?.type || 'uncaught_exception', orderGuess, emailGuess, error.message, evData);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function processCancellation(customerEmail, platform, subscriptionId = null) {
    if (subscriptionId) {
        const { data: uRow } = await supabase.from('users').select('dodo_subscription_id').eq('email', customerEmail).maybeSingle();
        if (uRow && uRow.dodo_subscription_id && uRow.dodo_subscription_id !== subscriptionId) {
            console.log(`[🛑取消訂閱] 忽略過期取消事件: ${customerEmail} (已綁定新訂閱)`);
            return;
        }
    }

    console.log(`[🛑取消訂閱] 處理 ${platform} 取消: ${customerEmail}`);
    await supabase.from('users').update({
        subscription_plan: null,
        next_plan: null,
        cancel_pending: false,
        dodo_subscription_id: null,
        payment_failed: false
    }).eq('email', customerEmail);
}

// 單一事實來源：把 Dodo 回傳的訂閱物件原樣鏡射到 DB，取代過去分散在各事件裡各自猜欄位的寫法。
// sub 直接是 Dodo API/webhook 的訂閱物件（status / subscription_id / product_id / cancel_at_next_billing_date / next_billing_date）。
async function syncSubscriptionState(customerEmail, sub, { clearNextPlan = false, allowPlanChange = false } = {}) {
    if (!customerEmail || !sub?.subscription_id) return;

    // Dodo 官方 status 枚舉：pending/active/on_hold/cancelled/failed/expired（無 trialing、無 canceled 單L）
    if (sub.status === 'cancelled' || sub.status === 'expired') {
        return processCancellation(customerEmail, 'DODO', sub.subscription_id);
    }

    

    const updateFields = {
        dodo_subscription_id: sub.subscription_id,
        cancel_pending: !!sub.cancel_at_next_billing_date,
        subscription_period_end: sub.next_billing_date || null,
    };
    if (sub.status === 'on_hold') updateFields.payment_failed = true;
    if (sub.status === 'active') updateFields.payment_failed = false;
    if (clearNextPlan) updateFields.next_plan = null;

    if (allowPlanChange) {
        const newProductId = sub.product_id || sub.plan_id;
        if (newProductId) {
            const newPlanName = resolvePlanName(newProductId, null);
            if (newPlanName) {
                const { data: user } = await supabase.from('users')
                    .select('subscription_plan').eq('email', customerEmail).maybeSingle();
                const currentTier = PLAN_TIERS[user?.subscription_plan] || 0;
                const newTier = PLAN_TIERS[newPlanName] || 0;

                if (newTier >= currentTier) {
                    // 升級或同方案變更：立刻同步（payment.succeeded 負責點數）
                    updateFields.subscription_plan = newPlanName;
                    updateFields.next_plan = null;
                    console.log(`[Dodo] 方案升級/同級: ${customerEmail} → ${newPlanName}`);
                } else {
                    // 降級（期末生效）：儲存 next_plan，續訂時 clearNextPlan 清除
                    updateFields.next_plan = newPlanName;
                    console.log(`[Dodo] 降級待生效: ${customerEmail} → ${newPlanName} (期末)`);
                }
            }
        }
    }

    await Promise.resolve(supabase.from('users').update(updateFields).eq('email', customerEmail))
        .catch(e => console.warn('[Dodo] syncSubscriptionState update failed:', e.message));
}

// 爭議/退款防護網：扣回該筆付款發放的點數（不足則歸零）並終止訂閱，防止用戶透過爭議白嫖服務
async function clawbackPoints(paymentId, eventType) {
    try {
        const fullOrderId = `DODO_${paymentId}`;
        const penaltyOrderId = `PENALTY_${fullOrderId}`;

        // 冪等：同一筆付款可能先後收到 disputed + refunded，已扣回過就不重複扣
        const { data: existingPenalty } = await supabase.from('transactions')
            .select('id').eq('order_id', penaltyOrderId).maybeSingle();
        if (existingPenalty) {
            console.log(`[🔁冪等] ${penaltyOrderId} 已扣回過，跳過`);
            return;
        }

        const { data: tx } = await supabase.from('transactions')
            .select('user_email, amount').eq('order_id', fullOrderId).maybeSingle();
        if (!tx?.user_email) {
            console.warn(`[🚨${eventType}] 找不到對應交易紀錄，無法扣點: ${fullOrderId}`);
            return;
        }
        const { data: user } = await supabase.from('users').select('points, lifetime_points').eq('email', tx.user_email).maybeSingle();
        if (!user) return;

        // 比照 deduct_render_points（SQL）的雙層扣款：先扣 points（月額度），不足再扣 lifetime_points（永久餘額），
        // 避免退款/爭議用戶靠 lifetime_points 白嫖服務。
        const pointsToDeduct = tx.amount || 0;
        const currentPoints = user.points || 0;
        const currentLifetime = user.lifetime_points || 0;
        const newPoints = Math.max(0, currentPoints - pointsToDeduct);
        const newLifetime = currentPoints >= pointsToDeduct
            ? currentLifetime
            : Math.max(0, currentLifetime - (pointsToDeduct - currentPoints));
        await supabase.from('users').update({
            points: newPoints,
            lifetime_points: newLifetime,
            subscription_plan: null,
            dodo_subscription_id: null,
        }).eq('email', tx.user_email);

        await Promise.resolve(supabase.from('transactions').insert([{
            user_email: tx.user_email,
            amount: -pointsToDeduct,
            transaction_type: eventType === 'payment.disputed' ? 'DISPUTE_PENALTY' : 'REFUND_PENALTY',
            order_id: `PENALTY_${fullOrderId}`,
        }])).catch(e => console.warn('[clawbackPoints] penalty tx insert failed (non-fatal):', e.message));

        console.warn(`[🚨${eventType}] ${tx.user_email} 扣除 ${pointsToDeduct} 點並終止訂閱`);
    } catch (e) {
        console.error('[clawbackPoints] failed:', e.message);
    }
}

// 財務系統與業務系統物理隔離：無論 processTopup 發點邏輯怎麼變，真實進帳都獨立記一筆到
// payments 表，讓退款/財報有真實資料可查。用 order_id upsert，同一筆付款重試不會重複入帳。
async function recordPayment(orderId, customerEmail, amountUsdCents, status, paymentMethod) {
    if (!orderId || !customerEmail || typeof amountUsdCents !== 'number') return;
    try {
        const { error } = await supabase.from('payments').upsert([{
            order_id: orderId,
            user_email: customerEmail,
            amount_usd_cents: amountUsdCents,
            status,
            payment_method: paymentMethod,
        }], { onConflict: 'order_id' });
        if (error) console.error('[payments] record failed:', error.message);
    } catch (e) {
        console.error('[payments] record exception:', e.message);
    }
}

// 退款/拒付：payment.refunded 只帶 payment_id，訂閱付款的 order_id 是 `${subscription_id}_${payment_id}`，
// 一般付款則是 payment_id 本身——用後綴比對兩種格式都能命中。
async function markPaymentStatus(paymentId, status) {
    try {
        const { error } = await supabase.from('payments')
            .update({ status })
            .like('order_id', `%${paymentId}`);
        if (error) console.error('[payments] status update failed:', error.message);
    } catch (e) {
        console.error('[payments] status update exception:', e.message);
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
function resolvePlanName(variantId, planKey) {
    if (planKey && PLAN_DEFS[planKey.toLowerCase()]?.isSub) return planKey.toLowerCase();
    for (const [key, def] of Object.entries(PLAN_DEFS)) {
        if (def.isSub && variantId == def.productId) return key;
    }
    return null;
}

async function logWebhookError(platform, eventType, orderId, customerEmail, errorMsg, rawData, status = 'error') {
    try {
        await supabase.from('webhook_errors').insert([{
            platform,
            event_type: eventType,
            order_id: orderId,
            customer_email: customerEmail,
            error_message: errorMsg,
            raw_payload: JSON.stringify(rawData)?.substring(0, 8000),
            created_at: new Date().toISOString(),
            status,
        }]);
        console.error(`[🚨WebhookError] ${platform} ${eventType} ${orderId} — ${errorMsg}`);
    } catch (_) {
        // 不讓日誌失敗影響主流程
    }
}

function isAnonymousEmail(email) {
    return !email || email.endsWith('@privaterelay.appleid.com');
}

// 激活失敗時主動寄信通知用戶；防重複：查 webhook_errors.email_sent 欄位
async function sendActivationFailureEmail(customerEmail, orderId) {
    if (!customerEmail || !process.env.RESEND_API_KEY) return;
    try {
        // 防重複：同一 order_id 只寄一次
        const { data: errRow } = await supabase.from('webhook_errors')
            .select('email_sent').eq('order_id', String(orderId)).maybeSingle();
        if (errRow?.email_sent) return;

        const from = process.env.RESEND_FROM_EMAIL || 'LoamLab <noreply@loamlab.studio>';
        const verifyUrl = 'https://loamlab.studio/verify';
        const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e2e8f0">
  <div style="font-size:16px;font-weight:700;color:#e2e8f0;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #1e293b">您的 LoamLab 訂閱激活遇到問題</div>
  <div style="line-height:1.9;color:#cbd5e1;margin-top:16px">
    <p>親愛的設計師，</p>
    <p>我們已收到您的付款，但帳號激活過程中遇到暫時性問題，點數尚未發放。</p>
    <p>請點擊下方按鈕手動驗證您的付款，通常可立即解決：</p>
    <a href="${verifyUrl}" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;font-size:14px">立即驗證付款</a>
    <p style="font-size:12px;color:#94a3b8">若驗證後仍有問題，請回覆此信或聯繫 <a href="mailto:support@loamlab.studio" style="color:#7c3aed">support@loamlab.studio</a></p>
  </div>
  <p style="font-size:11px;color:#475569;margin-top:40px;border-top:1px solid #1e293b;padding-top:16px">LoamLab · <a href="https://loamlab.studio" style="color:#7c3aed;text-decoration:none">loamlab.studio</a></p>
</div>`;

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from,
                to: customerEmail,
                subject: '⚠️ 您的 LoamLab 帳號激活需要您的確認',
                html,
            }),
        });

        // 標記已寄，防後續重試重複發
        await Promise.resolve(supabase.from('webhook_errors')
            .update({ email_sent: true }).eq('order_id', String(orderId)))
            .catch(() => {});

        console.log(`[📧激活通知] 已寄送給: ${customerEmail}`);
    } catch (e) {
        console.warn('[sendActivationFailureEmail] non-fatal:', e.message);
    }
}
