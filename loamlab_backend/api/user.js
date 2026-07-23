import { createClient } from '@supabase/supabase-js';
import { DODO_PRODUCTS, INITIAL_POINTS } from '../config.js';
import { makeSupabase, reconcilePaymentsForEmail } from '../lib/activate.js';
import { isValidAdminKey } from '../lib/safeCompare.js';
import { getClientIp } from '../lib/net.js';
import { resolveUserEmail } from '../lib/verifyIdentity.js';

// Dodo `/customers?customer_email=` 的伺服器端過濾不可信（實測會回傳與 email 無關的帳號列表），
// 絕不可直接取 customers[0]，一律由呼叫端拿到的 email 做二次精確比對，找不到就回 null。
async function findDodoCustomerId(dodoBase, apiKey, targetEmail) {
    const custRes = await fetch(`${dodoBase}/customers?customer_email=${encodeURIComponent(targetEmail)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!custRes.ok) return null;
    const custData = await custRes.json();
    const customers = custData.items || custData.customers || custData.data || [];
    const match = customers.find(c => (c.email || c.customer?.email || '').toLowerCase() === targetEmail.toLowerCase());
    return match?.customer_id || match?.id || null;
}

// 已知 dodo_subscription_id 時優先用它直接查訂閱拿 customer_id，比搜尋整個客戶清單更準；
// 仍核對回傳的 customer.email 是否等於預期用戶，避免資料庫存到錯誤/過期 subscription_id 時誤傳他人資料。
async function findDodoCustomerIdBySubscription(dodoBase, apiKey, subscriptionId, expectedEmail) {
    const subRes = await fetch(`${dodoBase}/subscriptions/${subscriptionId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!subRes.ok) return null;
    const subData = await subRes.json();
    const subEmail = (subData.customer?.email || subData.customer_email || '').toLowerCase();
    if (subEmail !== expectedEmail.toLowerCase()) return null;
    return subData.customer?.customer_id || subData.customer?.id || subData.customer_id || null;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Checkout sub-route（不需要 Supabase auth）──────────────────────────
    if (req.method === 'POST' && req.query.action === 'checkout') {
        let { planKey, email, referralCode, affonsoRef } = req.body || {};
        if (email) email = email.toLowerCase().trim();
        if (!planKey) return res.status(400).json({ error: 'Missing planKey' });
        const productId = DODO_PRODUCTS[planKey.toUpperCase()];
        if (!productId) return res.status(400).json({ error: 'Invalid planKey' });
        const DODO_API_KEY = process.env.DODO_API_KEY;
        const DODO_DISCOUNT_CODE = process.env.DODO_DISCOUNT_CODE || 'LOAM_BETA_30';

        // 【第一性原理・洗點事故重構 2026-07】徹底廢棄 Dodo change-plan / proration 補差價流程。
        // 舊做法：既有訂閱者切換方案 → 呼叫 /subscriptions/{id}/change-plan 產生「補差價」畸零付款。
        // 該畸零 payment.succeeded 的 product_cart 為空、金額不可預測，後端 processTopup 會被 metadata
        // 的 planKey 誘導無條件把當月點數覆寫成滿額，導致用戶花 $1 補差價即可無限洗回滿血。
        // 新做法：所有購買/升降級都走全新的 /checkouts，用戶支付「全額」並以當天為新計費週期第一天，
        // 建立一個完整 30 天的新訂閱。舊訂閱在 webhook 發點成功後由後端主動取消（見 webhook.js Task 2），
        // 避免雙重扣款。前端與後端一致：不再有任何 planChanged / proration 分支。

        // 歸因綁定 + KOL 折扣查詢（單次 DB 查詢合併）
        let kolDiscountCode = null;
        if (referralCode && email) {
            try {
                const sbUrl = process.env.SUPABASE_URL;
                const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
                if (sbUrl && sbKey) {
                    const sb = createClient(sbUrl, sbKey);
                    const { data: kol } = await sb.from('users').select('email, is_kol, is_partner, dodo_discount_code').eq('referral_code', referralCode.toUpperCase()).maybeSingle();
                    if (kol) {
                        if ((kol.is_kol || kol.is_partner) && kol.dodo_discount_code) {
                            kolDiscountCode = kol.dodo_discount_code;
                        }
                        if (kol.email !== email) {
                            const { data: me } = await sb.from('users').select('referred_by').eq('email', email).maybeSingle();
                            if (me && !me.referred_by) {
                                await sb.from('users').update({ referred_by: kol.email }).eq('email', email);
                                console.log(`[checkout] auto-bound referred_by: ${email} → ${kol.email}`);
                            }
                        }
                    }
                }
            } catch (bindErr) {
                console.warn('[checkout] referral bind failed (non-fatal):', bindErr.message);
            }
        }

        const finalDiscount = kolDiscountCode || DODO_DISCOUNT_CODE;

        if (!DODO_API_KEY) {
            return res.status(500).json({ error: 'payment_not_configured' });
        }

        const dodoBase = DODO_API_KEY.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
        // 已命中 KOL 折扣碼的訂單不再附帶 Affonso 歸因，避免同一筆交易被兩套分潤系統各自認領
        const body = {
            product_cart: [{ product_id: productId, quantity: 1 }],
            ...(email && { customer: { email } }),
            metadata: {
                planKey: planKey.toUpperCase(),
                email: email || '',
                ...(affonsoRef && !kolDiscountCode && { affonso_referral: affonsoRef }),
            },
        };
        if (finalDiscount) body.discount_codes = [finalDiscount];

        const doRequest = (reqBody) => fetch(`${dodoBase}/checkouts`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });

        try {
            let apiRes = await doRequest(body);
            let appliedDiscount = finalDiscount;

            // 若 Dodo 拒絕（折扣碼未綁定此方案），自動 retry 不帶折扣碼
            if (!apiRes.ok && finalDiscount && body.discount_codes) {
                const errText = await apiRes.text().catch(() => '');
                console.warn('[checkout] Dodo rejected with discount, retrying without:', apiRes.status, errText);
                delete body.discount_codes;
                apiRes = await doRequest(body);
                appliedDiscount = null; // 本次 session 不帶折扣，改由 URL 參數讓用戶手動套用
            }

            if (!apiRes.ok) {
                const errText = await apiRes.text().catch(() => '');
                console.error('[checkout] Dodo API error:', apiRes.status, errText);
                return res.status(502).json({ error: 'checkout_api_failed' });
            }
            const data = await apiRes.json();
            let checkoutUrl = data.checkout_url || null;
            // 將折扣碼拼入 URL，讓 Dodo 結帳頁預填折扣欄位
            if (checkoutUrl && finalDiscount && !checkoutUrl.includes('discount_code=')) {
                const sep = checkoutUrl.includes('?') ? '&' : '?';
                checkoutUrl += `${sep}discount_code=${encodeURIComponent(finalDiscount)}`;
            }
            return res.json({ checkoutUrl, discountApplied: !!appliedDiscount });
        } catch (e) {
            console.error('[checkout] fetch error:', e.message);
            return res.status(502).json({ error: 'checkout_api_failed' });
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Undo Cancel（撤回退訂申請，在週期結束前可呼叫）────────────────────────────
    if (req.method === 'POST' && req.query.action === 'undo_cancel') {
        let { email: undoEmail } = req.body || {};
        if (undoEmail) undoEmail = undoEmail.toLowerCase().trim();
        if (!undoEmail) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const sbUrl2 = process.env.SUPABASE_URL;
        const sbKey2 = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!sbUrl2 || !sbKey2) return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
        const sb2 = createClient(sbUrl2, sbKey2);

        const { data: undoUser } = await sb2.from('users')
            .select('dodo_subscription_id, cancel_pending').eq('email', undoEmail).maybeSingle();

        if (!undoUser?.cancel_pending) return res.status(400).json({ code: -1, msg: 'no_pending_cancel' });

        const DODO_API_KEY2 = process.env.DODO_API_KEY;
        const PORTAL_URL2 = 'https://customer.dodopayments.com';

        if (!DODO_API_KEY2 || !undoUser?.dodo_subscription_id) {
            // 無法透過 API 撤回，清除 pending flag 並告知用戶聯繫客服
            await sb2.from('users').update({ cancel_pending: false }).eq('email', undoEmail).catch(() => {});
            return res.status(200).json({ code: 2, portal_url: PORTAL_URL2, msg: 'no_api_key_or_id' });
        }

        const dodoBase2 = DODO_API_KEY2.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
        try {
            const undoRes = await fetch(`${dodoBase2}/subscriptions/${undoUser.dodo_subscription_id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${DODO_API_KEY2}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancel_at_next_billing_date: false })
            });
            if (undoRes.ok) {
                await sb2.from('users').update({ cancel_pending: false }).eq('email', undoEmail).catch(() => {});
                return res.json({ code: 0, msg: 'undo_success' });
            }
            console.error('[undo_cancel] Dodo PATCH failed:', undoRes.status, await undoRes.text().catch(() => ''));
        } catch (e) {
            console.error('[undo_cancel] fetch error:', e.message);
        }
        // Dodo API 不支援撤回（或失敗）→ 引導 portal
        return res.status(200).json({ code: 2, portal_url: PORTAL_URL2, msg: 'undo_failed_use_portal' });
    }
    // ────────────────────────────────────────────────────────────────────────

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 管理員請求豁免 IP 與 Email 驗證
    const adminKey = req.headers['x-admin-key'] || req.body?.admin_key;
    const isAdmin = isValidAdminKey(adminKey);

    // 先行擷取 email：優先信任 Authorization Bearer token 解出的信箱（無法偽造）；
    // 舊版插件沒有帶 token 時，退回原本的 query/header/body 判斷順序
    const { email: tokenEmail, verified: emailVerified } = await resolveUserEmail(req);
    let email = tokenEmail || req.query.email || req.headers['x-user-email'] || req.body?.email;
    if (email) email = email.toLowerCase().trim();

    // KOL dashboard (email-only, no IP auth — KOL checks own stats)
    if (req.method === 'GET' && req.query.action === 'kol_dashboard') {
        if (!email) return res.status(400).json({ error: 'Missing email' });
        let { data: kol } = await supabase.from('users')
            .select('referral_code, referral_success_count, is_kol, is_partner')
            .eq('email', email).maybeSingle();
        if (!kol?.is_kol && !kol?.is_partner) return res.status(403).json({ error: 'Not a KOL account' });
        
        // 自動補發 KOL 邀請碼
        if (kol && !kol.referral_code) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let backfillCode = '';
            for (let i = 0; i < 6; i++) { backfillCode += chars.charAt(Math.floor(Math.random() * chars.length)); }
            const { error: bfErr } = await supabase.from('users').update({ referral_code: backfillCode }).eq('email', email);
            if (!bfErr) kol.referral_code = backfillCode;
        }

        if (!kol?.referral_code) return res.status(404).json({ error: 'KOL not found or no referral code' });

        const isPartner = !!kol.is_partner;
        const roleType = isPartner ? 'partner' : 'kol';
        const totalPaid = kol.referral_success_count || 0;
        let currentTier, currentRate, progressToNextTier;
        // KOL: 5%/10%/15%；Partner（內部）: 15%/20%/25%
        const TIERS = isPartner
            ? ['15%', '20%', '25%']
            : ['5%', '10%', '15%'];
        if (totalPaid <= 50) {
            currentTier = 1; currentRate = TIERS[0];
            progressToNextTier = { needed: 51, remaining: 51 - totalPaid };
        } else if (totalPaid <= 100) {
            currentTier = 2; currentRate = TIERS[1];
            progressToNextTier = { needed: 101, remaining: 101 - totalPaid };
        } else {
            currentTier = 3; currentRate = TIERS[2]; progressToNextTier = null;
        }

        const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
        const { data: ledger } = await supabase.from('kol_ledger')
            .select('commission_amount, status, created_at').eq('kol_email', email);

        let pendingCoolingOff = 0, readyToWithdraw = 0, totalWithdrawn = 0;
        for (const row of (ledger || [])) {
            if (row.status === 'pending') {
                if (row.created_at < cutoff) readyToWithdraw += row.commission_amount;
                else pendingCoolingOff += row.commission_amount;
            } else if (row.status === 'ready_to_pay') {
                readyToWithdraw += row.commission_amount;
            } else if (row.status === 'paid') {
                totalWithdrawn += row.commission_amount;
            }
        }

        return res.json({
            role_type: roleType,
            kol_code: kol.referral_code,
            total_paid_users: totalPaid,
            current_tier: currentTier,
            current_commission_rate: currentRate,
            progress_to_next_tier: progressToNextTier,
            earnings: { pending_cooling_off: pendingCoolingOff, ready_to_withdraw: readyToWithdraw, total_withdrawn: totalWithdrawn }
        });
    }

    // 若非管理員，必須驗證身分與 IP 指紋（已用 token 驗證過身份的話，IP pinning 已無必要）
    if (!isAdmin) {
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const clientIp = getClientIp(req);
        if (!emailVerified && clientIp !== 'unknown') {
            const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', email).maybeSingle();
            if (userRow?.last_login_ip && userRow.last_login_ip !== clientIp) {
                return res.status(401).json({ code: -1, msg: '登入已過期或網路變更，請重新登入' });
            }
        }
    }

    // --- GET: presets list / render history ---
    if (req.method === 'GET' && req.query.action === 'presets') {
        try {
            const { data, error } = await supabase
                .from('user_presets')
                .select('id, name, prompt, style, resolution, tool_id, created_at')
                .eq('user_email', email)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return res.status(200).json({ code: 0, presets: data || [] });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    if (req.method === 'GET' && req.query.action === 'history') {
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        try {
            const { data, error, count } = await supabase
                .from('render_history')
                .select('id, thumbnail_url, full_url, prompt, style, resolution, tool_id, points_cost, user_rating, created_at', { count: 'exact' })
                .eq('user_email', email)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (error) throw error;
            return res.status(200).json({ code: 0, history: data || [], total: count || 0 });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // ── Billing Portal（生成 Dodo Customer Portal URL，供更新信用卡用）────────────
    if (req.method === 'GET' && req.query.action === 'billing_portal') {
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });
        const DODO_API_KEY = process.env.DODO_API_KEY;
        const FALLBACK_URL = 'https://customer.dodopayments.com';
        if (!DODO_API_KEY) return res.status(200).json({ code: 0, portal_url: FALLBACK_URL });

        const dodoBase = DODO_API_KEY.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
        try {
            // 1. 優先用資料庫已存的 dodo_subscription_id 直接查訂閱拿 customer_id（可靠）
            let customerId = null;
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (supabaseUrl && supabaseKey) {
                const sb = createClient(supabaseUrl, supabaseKey);
                const { data: u } = await sb.from('users').select('dodo_subscription_id').eq('email', email).maybeSingle();
                if (u?.dodo_subscription_id) {
                    customerId = await findDodoCustomerIdBySubscription(dodoBase, DODO_API_KEY, u.dodo_subscription_id, email);
                }
            }
            // 2. 沒有存 subscription_id 或查不到才退回用 email 搜尋客戶清單
            if (!customerId) {
                customerId = await findDodoCustomerId(dodoBase, DODO_API_KEY, email);
            }
            if (!customerId) return res.status(200).json({ code: 0, portal_url: FALLBACK_URL });

            const sessRes = await fetch(`${dodoBase}/customers/${customerId}/customer-portal/session`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ send_email: false })
            });
            if (!sessRes.ok) return res.status(200).json({ code: 0, portal_url: FALLBACK_URL });

            const sessData = await sessRes.json();
            const portalUrl = sessData.link || sessData.url || sessData.portal_url || FALLBACK_URL;
            return res.status(200).json({ code: 0, portal_url: portalUrl });
        } catch (e) {
            console.warn('[billing_portal] non-fatal:', e.message);
            return res.status(200).json({ code: 0, portal_url: FALLBACK_URL });
        }
    }
    // ────────────────────────────────────────────────────────────────────────────

    if (req.method === 'GET' && req.query.action === 'verify_payment') {
        let vEmail = req.headers['x-user-email'];
        if (vEmail) vEmail = vEmail.toLowerCase().trim();
        if (!vEmail) return res.status(400).json({ code: -1, msg: 'Missing email' });
        const DODO_API_KEY = process.env.DODO_API_KEY;
        if (!DODO_API_KEY) return res.status(503).json({ code: -1, msg: 'DODO_API_KEY not configured' });
        const dodoBase = DODO_API_KEY.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
        const sb = makeSupabase();
        let activated = false;

        // 無腦拉取（Dumb Pull）：唯一真理來源是 Dodo 的 payments 紀錄，不再另外查 subscriptions 狀態。
        // 舊版「查活躍訂閱」用 period 合成 order_id，跟這裡的 payment_id order_id 是兩把不同的冪等鍵，
        // 曾在補發時對同一筆扣款各自成功一次，造成雙重入帳 — 移除該路徑徹底根除。
        const { activated: didActivate, foundSucceeded } = await reconcilePaymentsForEmail(sb, vEmail, DODO_API_KEY);
        activated = didActivate;

        if (foundSucceeded) {
            sb.from('users').update({ payment_failed: false }).eq('email', vEmail).catch(() => {});
            sb.from('webhook_errors').update({ resolved: true })
                .eq('customer_email', vEmail).eq('resolved', false).catch(() => {});
        }

        return res.status(200).json({ code: 0, activated, msg: activated ? '已成功補發' : '查無未入帳的付款記錄' });
    }

    // --- Admin: 一次性補發所有 referral_code 為空的舊用戶 ---
    if (req.method === 'GET' && req.query.action === 'backfill_referral_codes') {
        if (!isAdmin) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        try {
            const { data: users } = await supabase.from('users')
                .select('email').is('referral_code', null);
            if (!users?.length) return res.status(200).json({ code: 0, fixed: 0, failed: 0, msg: '所有用戶已有邀請碼' });
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let fixed = 0, failed = 0;
            for (const u of users) {
                let ok = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                    let code = '';
                    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                    const { error: bfErr } = await supabase.from('users').update({ referral_code: code }).eq('email', u.email);
                    if (!bfErr) { ok = true; break; }
                }
                ok ? fixed++ : failed++;
            }
            return res.status(200).json({ code: 0, fixed, failed, total: users.length });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    if (req.method === 'GET') {
        try {
            let { data, error } = await supabase
                .from('users')
                .select('points, lifetime_points, referral_code, dodo_discount_code, referred_by, subscription_plan, next_plan, last_topup_at, is_kol, is_partner, cancel_pending, referral_success_count, payment_failed, subscription_period_end')
                .eq('email', email)
                .single();

            if (error && error.code === 'PGRST116') {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let newReferralCode = '';
                for (let i = 0; i < 6; i++) { newReferralCode += chars.charAt(Math.floor(Math.random() * chars.length)); }
                
                const { data: newUser, error: insertError } = await supabase
                    .from('users')
                    .insert([{
                        email: email,
                        points: INITIAL_POINTS,
                        lifetime_points: 0,
                        referral_code: newReferralCode
                    }])
                    .select().single();

                if (insertError) return res.status(500).json({ code: -1, msg: insertError.message });
                data = newUser;
            } else if (error) {
                return res.status(500).json({ code: -1, msg: error.message });
            }

            // 舊用戶自動補發邀請碼（最多 3 次 retry，防 UNIQUE 碰撞）
            if (data && !data.referral_code) {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                for (let attempt = 0; attempt < 3; attempt++) {
                    let code = '';
                    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                    const { error: bfErr } = await supabase.from('users').update({ referral_code: code }).eq('email', email);
                    if (!bfErr) { data.referral_code = code; break; }
                    if (attempt === 2) console.error('[backfill] referral_code 補發失敗:', email, bfErr.message);
                }
            }

            // 靜默自動修復：用戶有帳、無訂閱 → 主動查 Dodo 補發
            // 觸發條件：從未入帳（新用戶）OR 距上次入帳 > 29 天（月訂閱週期已過，renewal webhook 可能失敗）
            // 【2026-07 洗點防禦補漏】改呼叫 reconcilePaymentsForEmail（唯一真理來源：Dodo payments 紀錄
            // + fetchDodoSubscriptionInfo 真實金額比對），不再自己查 /subscriptions?status=active 直接發點——
            // 舊寫法跟 verify_payment 當初移除的版本是同一種反模式：(1) 完全沒有金額驗證，(2) 用
            // subscription_id 合成 order_id（跟 payment_id 是不同冪等鍵，過去已造成一次雙重入帳，
            // 見上方 verify_payment 註解）。統一收斂到同一套已修好的邏輯，不維護兩份補發機制。
            const _daysSinceLast = data?.last_topup_at
                ? (Date.now() - new Date(data.last_topup_at).getTime()) / (24 * 3600 * 1000)
                : Infinity;
            if (data && !data.subscription_plan && (_daysSinceLast > 29 || !data.last_topup_at) && process.env.DODO_API_KEY) {
                try {
                    const { activated } = await reconcilePaymentsForEmail(supabase, email, process.env.DODO_API_KEY);
                    if (activated) {
                        const { data: refreshed } = await supabase
                            .from('users')
                            .select('points, lifetime_points, referral_code, dodo_discount_code, referred_by, subscription_plan, last_topup_at, is_kol, is_partner, cancel_pending, subscription_period_end')
                            .eq('email', email).single();
                        if (refreshed) data = refreshed;
                        supabase.from('webhook_errors').update({ resolved: true })
                            .eq('customer_email', email).eq('resolved', false)
                            .catch(() => {});
                        console.log(`[🔄自動修復] ${email} 已自動補發訂閱`);
                    }
                } catch (e) {
                    console.warn('[auto-repair] non-fatal:', e.message);
                }
            }

            const displayCode = data && (data.is_kol || data.is_partner) && data.dodo_discount_code
                ? data.dodo_discount_code
                : (data ? data.referral_code : null);
            return res.status(200).json({
                code: 0,
                email,
                points: data ? (data.points || 0) + (data.lifetime_points || 0) : 0,
                lifetime_points: data ? (data.lifetime_points || 0) : 0,
                subscription_plan: data ? (data.subscription_plan || null) : null,
                last_topup_at: data ? (data.last_topup_at || null) : null,
                referral_code: data ? data.referral_code : null,
                display_code: displayCode,
                referred_by: data ? data.referred_by : null,
                referral_success_count: data ? (data.referral_success_count || 0) : 0,
                is_kol: data ? (data.is_kol || false) : false,
                is_partner: data ? (data.is_partner || false) : false,
                cancel_pending: data ? (data.cancel_pending || false) : false,
                payment_failed: data ? (data.payment_failed || false) : false,
                next_plan: data ? (data.next_plan || null) : null,
                subscription_period_end: data ? (data.subscription_period_end || null) : null,
                is_new_user: error && error.code === 'PGRST116' ? true : false
            });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // --- POST: Admin reward approve/reject ---
    if (req.method === 'POST' && req.body?.action === 'approve_reward') {
        const adminKey = req.headers['x-admin-key'] || req.body?.admin_key;
        if (!isValidAdminKey(adminKey)) {
            return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        }
        const { request_id, reviewer_note } = req.body;
        if (!request_id) return res.status(400).json({ code: -1, msg: 'Missing request_id' });

        const { data: rr } = await supabase.from('reward_requests')
            .select('reward_points, status, user_email').eq('id', request_id).single();
        if (!rr) return res.status(404).json({ code: -1, msg: 'Not found' });
        if (rr.status !== 'pending') return res.status(400).json({ code: -1, msg: `Already ${rr.status}` });

        const { data: userData } = await supabase.from('users').select('points').eq('email', rr.user_email).single();
        const curPts = userData ? (userData.points || 0) : 0;
        await supabase.from('users').update({ points: curPts + rr.reward_points }).eq('email', rr.user_email);
        await supabase.from('reward_requests').update({
            status: 'approved', reviewed_at: new Date().toISOString(), reviewer_note: reviewer_note || null
        }).eq('id', request_id);
        return res.status(200).json({ code: 0, msg: `+${rr.reward_points} pts approved` });
    }

    if (req.method === 'POST' && req.body?.action === 'reject_reward') {
        const adminKey = req.headers['x-admin-key'] || req.body?.admin_key;
        if (!isValidAdminKey(adminKey)) {
            return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        }
        const { request_id, reviewer_note } = req.body;
        if (!request_id) return res.status(400).json({ code: -1, msg: 'Missing request_id' });
        await supabase.from('reward_requests').update({
            status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_note: reviewer_note || null
        }).eq('id', request_id);
        return res.status(200).json({ code: 0, msg: 'Rejected' });
    }

    // --- POST: presets CRUD + history rating ---
    if (req.method === 'POST' && req.body?.action === 'save_preset') {
        let { email, name, prompt, style, resolution, tool_id } = req.body;
        if (email) email = email.toLowerCase().trim();
        if (!email || !name) return res.status(400).json({ code: -1, msg: 'Missing email or name' });
        try {
            const { data, error } = await supabase
                .from('user_presets')
                .insert([{ user_email: email, name, prompt, style, resolution, tool_id: tool_id || 1 }])
                .select('id, name').single();
            if (error) throw error;
            return res.status(200).json({ code: 0, preset: data });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    if (req.method === 'POST' && req.body?.action === 'delete_preset') {
        let { email, preset_id } = req.body;
        if (email) email = email.toLowerCase().trim();
        if (!email || !preset_id) return res.status(400).json({ code: -1, msg: 'Missing email or preset_id' });
        try {
            const { error } = await supabase
                .from('user_presets')
                .delete()
                .eq('id', preset_id)
                .eq('user_email', email);  // 確保只能刪自己的
            if (error) throw error;
            return res.status(200).json({ code: 0 });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    if (req.method === 'POST' && req.body?.action === 'rate_history') {
        let { email, history_id, rating, is_approved } = req.body;
        if (email) email = email.toLowerCase().trim();
        if (!email || !history_id) return res.status(400).json({ code: -1, msg: 'Missing email or history_id' });
        try {
            const update = {};
            if (rating !== undefined) update.user_rating = rating;
            if (is_approved !== undefined) update.is_approved = is_approved;
            const { error } = await supabase
                .from('render_history')
                .update(update)
                .eq('id', history_id)
                .eq('user_email', email);
            if (error) throw error;
            return res.status(200).json({ code: 0 });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // --- POST: Bind referral code (formerly referral.js) ---
    if (req.method === 'POST') {
        let { email, code } = req.body || {};
        if (email) email = email.toLowerCase().trim();
        if (!email || !code) return res.status(400).json({ code: -1, msg: '缺少 Email 或邀請碼' });

        try {
            const { data: me, error: myErr } = await supabase
                .from('users').select('id, email, referred_by').eq('email', email).single();

            if (myErr) return res.status(404).json({ code: -1, msg: '找不到您的帳戶，請先算一張圖進行註冊' });
            if (me.referred_by) return res.status(400).json({ code: -1, msg: '您已經接受過邀請，無法重複領取' });

            const cleanCode = code.trim();
            const upperCode = cleanCode.toUpperCase();
            const { data: inviter } = await supabase
                .from('users').select('id, email')
                .or(`referral_code.eq.${upperCode},dodo_discount_code.ilike.${cleanCode}`)
                .maybeSingle();

            if (!inviter) return res.status(404).json({ code: -1, msg: '找不到此推薦碼，請確認後重新輸入' });
            if (inviter.email === email) return res.status(400).json({ code: -1, msg: '不能輸入自己的邀請碼' });

            const { error: updateErr } = await supabase
                .from('users').update({ referred_by: inviter.email }).eq('email', email);

            if (updateErr) throw updateErr;

            return res.status(200).json({
                code: 0,
                msg: '邀請碼已綁定！首次付費後，+100 點將自動到帳，您的推薦人同時獲得 +300 點。'
            });
        } catch (err) {
            return res.status(500).json({ code: -1, msg: err.message });
        }
    }

    // --- POST: Logout device session (Merged to avoid Vercel 12 functions limit) ---
    if (req.method === 'POST' && req.body?.action === 'logout') {
        const { session_id } = req.body || {};
        if (!session_id) return res.status(400).json({ code: -1, msg: 'Missing session_id' });
        try {
            const { error } = await supabase
                .from('auth_sessions')
                .delete()
                .eq('id', session_id);
            if (error) throw error;
            return res.status(200).json({ code: 0, status: 'success' });
        } catch (err) {
            return res.status(500).json({ code: -1, msg: err.message });
        }
    }

    // ── Admin: 補發所有 Dodo 訂閱用戶（一次性修復）────────────────────────────
    if (req.method === 'GET' && req.query.action === 'sync_dodo_subscriptions') {
        if (!isValidAdminKey(req.query.key)) return res.status(401).json({ error: 'Unauthorized' });

        const DODO_API_KEY = process.env.DODO_API_KEY;
        if (!DODO_API_KEY) return res.status(500).json({ error: 'DODO_API_KEY not set' });

        const PLAN_MAP = {
            [DODO_PRODUCTS.STARTER]: { plan: 'starter', points: 300,  cents: 700  },
            [DODO_PRODUCTS.PRO]:     { plan: 'pro',     points: 2000, cents: 1500 },
            [DODO_PRODUCTS.STUDIO]:  { plan: 'studio',  points: 9000, cents: 3500 },
        };

        const results = { fixed: [], skipped: [], errors: [] };

        try {
            // 拉所有 active/trialing 訂閱（最多 100 筆）
            const listRes = await fetch(
                'https://live.dodopayments.com/subscriptions?status=active&limit=100',
                { headers: { 'Authorization': `Bearer ${DODO_API_KEY}` } }
            );
            const listData = await listRes.json();
            const subs = listData.items || listData.subscriptions || listData.data || [];

            for (const sub of subs) {
                const subId   = sub.subscription_id || sub.id;
                let email   = sub.customer?.email || sub.customer_email;
                if (email) email = email.toLowerCase().trim();
                const prodId  = sub.product_id || sub.plan_id || sub.items?.[0]?.product_id;
                const planCfg = PLAN_MAP[prodId];

                if (!email || !planCfg) {
                    results.skipped.push({ subId, email, prodId, reason: 'unknown_product_or_no_email' });
                    continue;
                }

                try {
                    // 取得目前 DB 狀態
                    let { data: user } = await supabase.from('users').select('email, subscription_plan, points, lifetime_points').eq('email', email).maybeSingle();

                    if (!user) {
                        // 訂閱前未建帳號（直接從網站購買）→ 新建
                        await supabase.from('users').insert([{
                            email, points: planCfg.points, lifetime_points: 0,
                            subscription_plan: planCfg.plan, dodo_subscription_id: subId,
                            is_beta_tester: true, last_topup_at: new Date().toISOString()
                        }]);
                        results.fixed.push({ email, action: 'created', plan: planCfg.plan });
                    } else if (!user.subscription_plan) {
                        // 有帳號但沒有 plan → 補發
                        await supabase.from('users').update({
                            subscription_plan: planCfg.plan,
                            dodo_subscription_id: subId,
                            points: planCfg.points,
                            last_topup_at: new Date().toISOString()
                        }).eq('email', email);
                        results.fixed.push({ email, action: 'updated', plan: planCfg.plan });
                    } else {
                        // 已有 plan → 跳過
                        results.skipped.push({ email, reason: 'already_has_plan', plan: user.subscription_plan });
                        continue;
                    }

                    // 補 transaction 記錄（冪等）
                    await supabase.from('transactions').insert([{
                        user_email: email, amount: planCfg.points,
                        transaction_type: 'TOPUP_SUBSCRIPTION',
                        order_id: `SYNC_${subId}`,
                        amount_usd_cents: planCfg.cents
                    }]).select(); // ignore conflict silently

                } catch (e) {
                    results.errors.push({ email, subId, error: e.message });
                }
            }

            return res.status(200).json({
                code: 0,
                total_subs: subs.length,
                fixed: results.fixed.length,
                skipped: results.skipped.length,
                errors: results.errors.length,
                details: results
            });
        } catch (e) {
            return res.status(500).json({ code: -1, error: e.message });
        }
    }

    return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
}

