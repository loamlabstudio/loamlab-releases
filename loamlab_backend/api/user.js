import { createClient } from '@supabase/supabase-js';

const DODO_PRODUCTS = {
    TOPUP:   'pdt_0NbIlveGNSETSOveL7Xmk',
    STARTER: 'pdt_0NblmUvFrwJe36ymTELWV',
    PRO:     'pdt_0NblmafncbUuGNrMRvJp4',
    STUDIO:  'pdt_0Nblmhwbr5WXfNyDHpaA2'
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Checkout sub-route（不需要 Supabase auth）──────────────────────────
    if (req.method === 'POST' && req.query.action === 'checkout') {
        const { planKey, email, quantity = 1, referralCode } = req.body || {};
        if (!planKey || !email) return res.status(400).json({ error: 'Missing planKey or email' });
        const productId = DODO_PRODUCTS[planKey.toUpperCase()];
        if (!productId) return res.status(400).json({ error: 'Invalid planKey' });
        const qty = Math.max(1, parseInt(quantity) || 1);
        const DODO_API_KEY = process.env.DODO_API_KEY;
        const DODO_DISCOUNT_CODE = process.env.DODO_DISCOUNT_CODE || '';
        const fallbackUrl = `https://checkout.dodopayments.com/buy/${productId}?quantity=${qty}&customer_email=${encodeURIComponent(email)}`;

        // 歸因綁定 + KOL 折扣查詢（單次 DB 查詢合併）
        let kolDiscountCode = null;
        if (referralCode) {
            try {
                const sbUrl = process.env.SUPABASE_URL;
                const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
                if (sbUrl && sbKey) {
                    const sb = createClient(sbUrl, sbKey);
                    const { data: kol } = await sb.from('users').select('email, is_kol, is_partner, dodo_discount_code').eq('referral_code', referralCode.toUpperCase()).maybeSingle();
                    if (kol) {
                        // KOL / 合夥人折扣（優先於全局 BETA 折扣）
                        if ((kol.is_kol || kol.is_partner) && kol.dodo_discount_code) {
                            kolDiscountCode = kol.dodo_discount_code;
                        }
                        // 歸因綁定（只在尚未綁定時寫入）
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

        if (!DODO_API_KEY) {
            console.warn('[checkout] DODO_API_KEY not set, using fallback URL');
            return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
        }
        const body = { product_cart: [{ product_id: productId, quantity: qty }], customer: { email } };
        const finalDiscount = kolDiscountCode || DODO_DISCOUNT_CODE;
        if (finalDiscount) body.discount_code = finalDiscount;
        try {
            const apiRes = await fetch('https://live.dodopayments.com/checkouts', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!apiRes.ok) {
                console.error('[checkout] DodoPayments error:', apiRes.status, await apiRes.text());
                return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
            }
            const data = await apiRes.json();
            return res.json({ checkoutUrl: data.checkout_url || fallbackUrl, discountApplied: !!finalDiscount });
        } catch (e) {
            console.error('[checkout] fetch error:', e.message);
            return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
        }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Cancel Subscription（用戶確認取消後直接呼叫 Dodo API）──────────────────
    if (req.method === 'POST' && req.query.action === 'cancel_subscription') {
        const { email: cancelEmail } = req.body || {};
        if (!cancelEmail) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!sbUrl || !sbKey) return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
        const sb = createClient(sbUrl, sbKey);

        const { data: user } = await sb.from('users').select('dodo_subscription_id, subscription_plan').eq('email', cancelEmail).maybeSingle();
        let subscriptionId = user?.dodo_subscription_id;

        const DODO_API_KEY = process.env.DODO_API_KEY;
        const PORTAL_URL = `https://customer.dodopayments.com`;
        const dodoBase = DODO_API_KEY?.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';

        if (!DODO_API_KEY) {
            return res.status(200).json({ code: 2, portal_url: PORTAL_URL, msg: 'config_error' });
        }

        // subscription_id 未存，嘗試向 Dodo 查詢 email 找出有效訂閱
        if (!subscriptionId) {
            try {
                const listRes = await fetch(
                    `${dodoBase}/subscriptions?customer_email=${encodeURIComponent(cancelEmail)}&status=active`,
                    { headers: { 'Authorization': `Bearer ${DODO_API_KEY}` } }
                );
                if (listRes.ok) {
                    const listData = await listRes.json();
                    const items = listData.items || listData.subscriptions || listData.data || [];
                    const active = items.find(s => s.status === 'active' || s.status === 'trialing');
                    if (active?.subscription_id || active?.id) {
                        subscriptionId = active.subscription_id || active.id;
                        // 順便回存
                        sb.from('users').update({ dodo_subscription_id: subscriptionId }).eq('email', cancelEmail)
                            .catch(() => {});
                    }
                }
            } catch (_) {}
        }

        if (!subscriptionId) {
            return res.status(200).json({ code: 2, portal_url: PORTAL_URL, msg: 'no_subscription_found' });
        }

        try {
            // 嘗試透過 API 取消
            const apiRes = await fetch(`${dodoBase}/subscriptions/${subscriptionId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancel_at_next_billing_date: true })
            });

            if (apiRes.ok) {
                await sb.from('users').update({ dodo_subscription_id: null }).eq('email', cancelEmail)
                    .catch(e => console.warn('[cancel] db update failed:', e.message));
                return res.json({ code: 0, msg: 'cancelled' });
            }

            // PATCH 失敗（endpoint 不存在），試 DELETE
            const delRes = await fetch(`${dodoBase}/subscriptions/${subscriptionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' }
            });

            if (delRes.ok) {
                await sb.from('users').update({ dodo_subscription_id: null }).eq('email', cancelEmail)
                    .catch(e => console.warn('[cancel] db update failed:', e.message));
                return res.json({ code: 0, msg: 'cancelled' });
            }

            console.error('[cancel_subscription] Dodo error:', delRes.status, await delRes.text().catch(() => ''));
        } catch (e) {
            console.error('[cancel_subscription] fetch error:', e.message);
        }

        // --- Fallback: 若 API 自動取消失敗，動態建立專屬 Customer Portal URL ---
        let dynamicPortalUrl = PORTAL_URL;
        try {
            // 1. 取得 customer_id
            const custRes = await fetch(`${dodoBase}/customers?customer_email=${encodeURIComponent(cancelEmail)}`, {
                headers: { 'Authorization': `Bearer ${DODO_API_KEY}` }
            });
            if (custRes.ok) {
                const custData = await custRes.json();
                const customers = custData.items || custData.customers || custData.data || [];
                const customerId = customers[0]?.customer_id || customers[0]?.id;

                if (customerId) {
                    // 2. 建立 portal session
                    const sessRes = await fetch(`${dodoBase}/customers/${customerId}/customer-portal/session`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ send_email: false })
                    });
                    if (sessRes.ok) {
                        const sessData = await sessRes.json();
                        dynamicPortalUrl = sessData.link || sessData.url || sessData.portal_url || PORTAL_URL;
                    }
                }
            }
        } catch (_) {}

        return res.status(200).json({ code: 2, portal_url: dynamicPortalUrl, msg: 'api_error_fallback' });
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Save Offer（取消挽留：折扣點數 / 暫停訂閱）無需 IP 驗證，因為從 website 發起 ──
    if (req.method === 'POST' && req.query.action === 'save_offer') {
        const { email: offerEmail, offer_type, pause_months = 1 } = req.body || {};
        if (!offerEmail || !offer_type) return res.status(400).json({ code: -1, msg: 'Missing email or offer_type' });

        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!sbUrl || !sbKey) return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });
        const sb = createClient(sbUrl, sbKey);

        const { data: user, error: userErr } = await sb.from('users').select('*').eq('email', offerEmail).maybeSingle();
        if (userErr) return res.status(500).json({ code: -1, msg: userErr.message });
        if (!user) return res.status(404).json({ code: -1, msg: 'User not found' });
        if (!user.subscription_plan) return res.status(400).json({ code: -1, msg: 'No active subscription' });
        if (user.retention_offer_used) return res.status(400).json({ code: -1, msg: '您已使用過此優惠，無法重複領取' });

        const ALREADY_USED = { code: -1, msg: '您已使用過此優惠，無法重複領取' };

        if (offer_type === 'discount') {
            const BONUS = 100;
            // insert-first：deterministic order_id + unique index = 原子鎖，天然防 Race Condition
            const { error: txErr } = await sb.from('transactions').insert([{
                user_email: offerEmail, amount: BONUS,
                transaction_type: 'RETENTION_BONUS',
                order_id: `retention_bonus_${offerEmail}`
            }]);
            if (txErr) {
                if (txErr.code === '23505') return res.status(400).json(ALREADY_USED);
                return res.status(500).json({ code: -1, msg: txErr.message });
            }
            await sb.from('users').update({ points: (user.points || 0) + BONUS, retention_offer_used: true }).eq('email', offerEmail);
            return res.status(200).json({ code: 0, msg: '已為您補充 100 點作為回饋，感謝繼續使用 LoamLab！', points_added: BONUS });
        }

        if (offer_type === 'pause') {
            const months = Math.min(Math.max(parseInt(pause_months) || 1, 1), 3);
            const resumeAt = new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString();

            // insert-first 同樣防重複
            const { error: txErr } = await sb.from('transactions').insert([{
                user_email: offerEmail, amount: 0,
                transaction_type: 'RETENTION_PAUSE',
                order_id: `retention_pause_${offerEmail}`
            }]);
            if (txErr) {
                if (txErr.code === '23505') return res.status(400).json(ALREADY_USED);
                return res.status(500).json({ code: -1, msg: txErr.message });
            }

            const markPauseUsed = () => sb.from('users')
                .update({ retention_offer_used: true, subscription_paused_until: resumeAt })
                .eq('email', offerEmail);

            const subscriptionId = user.dodo_subscription_id;
            if (!subscriptionId || !process.env.DODO_API_KEY) {
                await markPauseUsed();
                return res.status(200).json({ code: 0, msg: `暫停申請已收到，我們將在 24 小時內為您處理，${new Date(resumeAt).toLocaleDateString('zh-TW')} 後自動恢復`, pending: true });
            }

            try {
                const apiRes = await fetch(`https://live.dodopayments.com/subscriptions/${subscriptionId}/pause`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.DODO_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resume_at: resumeAt })
                });
                await markPauseUsed();
                if (!apiRes.ok) {
                    console.error('[save_offer/pause] Dodo API error:', apiRes.status, await apiRes.text());
                    return res.status(200).json({ code: 0, msg: `暫停申請已記錄，我們將盡快為您處理`, pending: true });
                }
                return res.status(200).json({ code: 0, msg: `訂閱已暫停 ${months} 個月，${new Date(resumeAt).toLocaleDateString('zh-TW')} 自動恢復`, resume_at: resumeAt });
            } catch (e) {
                return res.status(500).json({ code: -1, msg: e.message });
            }
        }

        return res.status(400).json({ code: -1, msg: 'Invalid offer_type' });
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
    const isAdmin = process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY;

    // 先行擷取 email
    const email = req.query.email || req.headers['x-user-email'] || req.body?.email;

    // KOL dashboard (email-only, no IP auth — KOL checks own stats)
    if (req.method === 'GET' && req.query.action === 'kol_dashboard') {
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { data: kol } = await supabase.from('users')
            .select('referral_code, referral_success_count, is_kol, is_partner')
            .eq('email', email).maybeSingle();
        if (!kol?.is_kol && !kol?.is_partner) return res.status(403).json({ error: 'Not a KOL account' });
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

    // 若非管理員，必須驗證身分與 IP 指紋
    if (!isAdmin) {
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
        if (clientIp !== 'unknown') {
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

    if (req.method === 'GET') {
        try {
            let { data, error } = await supabase
                .from('users')
                .select('points, lifetime_points, referral_code, dodo_discount_code, referred_by, subscription_plan, last_topup_at, is_kol, is_partner')
                .eq('email', email)
                .single();

            const { count: referralSuccessCount } = await supabase
                .from('users')
                .select('id', { count: 'exact', head: true })
                .eq('referred_by', email)
                .eq('referral_rewarded', true);

            if (error && error.code === 'PGRST116') {
                const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                const { data: newUser, error: insertError } = await supabase
                    .from('users')
                    .insert([{
                        email: email,
                        points: 60,
                        referral_code: newReferralCode
                    }])
                    .select().single();

                if (insertError) return res.status(500).json({ code: -1, msg: insertError.message });
                data = newUser;
            } else if (error) {
                return res.status(500).json({ code: -1, msg: error.message });
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
                referral_success_count: referralSuccessCount || 0,
                is_kol: data ? (data.is_kol || false) : false,
                is_partner: data ? (data.is_partner || false) : false,
                is_new_user: error && error.code === 'PGRST116' ? true : false
            });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // --- POST: Admin reward approve/reject ---
    if (req.method === 'POST' && req.body?.action === 'approve_reward') {
        const adminKey = req.headers['x-admin-key'] || req.body?.admin_key;
        if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
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
        if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
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
        const { email, name, prompt, style, resolution, tool_id } = req.body;
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
        const { email, preset_id } = req.body;
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
        const { email, history_id, rating, is_approved } = req.body;
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
        const { email, code } = req.body || {};
        if (!email || !code) return res.status(400).json({ code: -1, msg: '缺少 Email 或邀請碼' });

        try {
            const { data: me, error: myErr } = await supabase
                .from('users').select('id, email, referred_by').eq('email', email).single();

            if (myErr) return res.status(404).json({ code: -1, msg: '找不到您的帳戶，請先算一張圖進行註冊' });
            if (me.referred_by) return res.status(400).json({ code: -1, msg: '您已經接受過邀請，無法重複領取' });

            const upperCode = code.toUpperCase();
            const { data: inviter } = await supabase
                .from('users').select('id, email')
                .or(`referral_code.eq.${upperCode},dodo_discount_code.eq.${upperCode}`)
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
        if (req.query.key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

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
                const email   = sub.customer?.email || sub.customer_email;
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
                            email, points: planCfg.points, lifetime_points: planCfg.points,
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
                            lifetime_points: (user.lifetime_points || 0) + planCfg.points,
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

