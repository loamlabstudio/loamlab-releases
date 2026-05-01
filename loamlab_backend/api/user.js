import { createClient } from '@supabase/supabase-js';

const DODO_PRODUCTS = {
    TOPUP:   'pdt_0NbIlveGNSETSOveL7Xmk',
    STARTER: 'pdt_0NbImUvFnwJe36ymTELWV',
    PRO:     'pdt_0NbImafnebUuGNrMRvJp4',
    STUDIO:  'pdt_0NbImhwhr5WXfNyDHpaA2'
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

        // 歸因綁定：若前端帶來 referralCode 且用戶尚未綁定，自動寫入 referred_by
        if (referralCode) {
            try {
                const sbUrl = process.env.SUPABASE_URL;
                const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
                if (sbUrl && sbKey) {
                    const sb = createClient(sbUrl, sbKey);
                    const { data: me } = await sb.from('users').select('referred_by').eq('email', email).maybeSingle();
                    if (me && !me.referred_by) {
                        const { data: kol } = await sb.from('users').select('email').eq('referral_code', referralCode.toUpperCase()).maybeSingle();
                        if (kol && kol.email !== email) {
                            await sb.from('users').update({ referred_by: kol.email }).eq('email', email);
                            console.log(`[checkout] auto-bound referred_by: ${email} → ${kol.email}`);
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
        if (DODO_DISCOUNT_CODE) body.discount_code = DODO_DISCOUNT_CODE;
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
            return res.json({ checkoutUrl: data.checkout_url || fallbackUrl, discountApplied: !!DODO_DISCOUNT_CODE });
        } catch (e) {
            console.error('[checkout] fetch error:', e.message);
            return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
        }
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

    // 若非管理員，必須驗證身分與 IP 指紋
    if (!isAdmin) {
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
        if (clientIp !== 'unknown') {
            const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', email).maybeSingle();
            if (!userRow || !userRow.last_login_ip || userRow.last_login_ip !== clientIp) {
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
                .select('points, lifetime_points, referral_code, referred_by, subscription_plan, last_topup_at')
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

            return res.status(200).json({
                code: 0,
                email,
                points: data ? (data.points || 0) + (data.lifetime_points || 0) : 0,
                lifetime_points: data ? (data.lifetime_points || 0) : 0,
                subscription_plan: data ? (data.subscription_plan || null) : null,
                last_topup_at: data ? (data.last_topup_at || null) : null,
                referral_code: data ? data.referral_code : null,
                referred_by: data ? data.referred_by : null,
                referral_success_count: referralSuccessCount || 0,
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

            const { data: inviter, error: inviterErr } = await supabase
                .from('users').select('id, email').eq('referral_code', code.toUpperCase()).single();

            if (inviterErr || !inviter) return res.status(404).json({ code: -1, msg: '無效的邀請碼' });
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

    return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
}

