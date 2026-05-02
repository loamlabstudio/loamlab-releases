const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    const { code, state: sessionId, error: oauthError } = req.query;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const renderHtml = (success, title, sub = '') => `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LoamLab 登入</title>
    <style>
        body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .container { text-align: center; max-width: 420px; padding: 40px; background: rgba(255,255,255,0.03); border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); }
        h2 { font-weight: 500; margin-top: 0; }
        p { color: #71717a; font-size: 0.9rem; }
    </style>
</head>
<body>
    <div class="container">
        <div style="font-size:48px;margin-bottom:20px">${success ? '✅' : '❌'}</div>
        <h2 style="color:${success ? '#22c55e' : '#ef4444'}">${title}</h2>
        <p>${sub}</p>
    </div>
</body></html>`;

    // Google 傳回的 OAuth 錯誤（用戶拒絕授權等）
    if (oauthError) {
        return res.status(200).send(renderHtml(false,
            'Google 授權失敗：' + oauthError,
            '請關閉此頁並在 SketchUp 重新點擊登入。'
        ));
    }

    if (!code || !sessionId) {
        return res.status(200).send(renderHtml(false, '缺少授權碼或 Session ID', '請在 SketchUp 重新點擊登入。'));
    }

    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey);

    // 1. 驗證 session 存在（CSRF 防護：確認 session_id 是由我們的 plugin 發起的）
    const { data: sessions } = await supabase
        .from('auth_sessions')
        .select('id, kol_ref')
        .eq('id', sessionId)
        .eq('status', 'pending');

    const sessionValid = Array.isArray(sessions) && sessions.length > 0;
    const kolRef = sessions?.[0]?.kol_ref || null;

    if (!sessionValid) {
        return res.status(200).send(renderHtml(false,
            'Session 無效或已過期',
            '請在 SketchUp 重新點擊登入。'
        ));
    }

    // 2. 用 authorization code 換取 token（完全在伺服器端，不碰任何瀏覽器 Storage）
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const redirectUri = `https://${host}/api/auth/google-callback`;

    let tokenData;
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }).toString()
        });
        tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'token exchange failed');
    } catch (e) {
        return res.status(200).send(renderHtml(false, 'Token 交換失敗：' + e.message, '請重新嘗試。'));
    }

    // 3. 取得 email（先從 id_token JWT decode，fallback 打 userinfo endpoint）
    let email;
    if (tokenData.id_token) {
        try {
            const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString());
            email = payload.email;
        } catch (e) {}
    }
    if (!email && tokenData.access_token) {
        try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            const userInfo = await userRes.json();
            email = userInfo.email;
        } catch (e) {}
    }
    if (!email) {
        return res.status(200).send(renderHtml(false, '無法取得 Email', '請確認 Google 帳號有綁定 Email。'));
    }

    // 4. 更新 auth_sessions → success（plugin 的 poll 機制會偵測到這個變化）
    const { error: updateError } = await supabase
        .from('auth_sessions')
        .upsert({ id: sessionId, email, status: 'success' }, { onConflict: 'id' });

    if (updateError) {
        console.error('[google-callback] session update failed:', updateError.message);
        return res.status(200).send(renderHtml(false,
            '狀態更新失敗',
            updateError.message + '（請聯繫客服或重試）'
        ));
    }

    // 5. 確保 users 資料存在（新用戶給 60 點，舊用戶忽略衝突）
    // KOL 歸因：從 auth_sessions.kol_ref 讀取，查 KOL email → 寫 referred_by（僅首次，舊用戶跳過）
    let referredBy = null;
    if (kolRef) {
        try {
            const { data: me } = await supabase.from('users').select('referred_by').eq('email', email).maybeSingle();
            if (!me || !me.referred_by) {
                const { data: kol } = await supabase.from('users')
                    .select('email').eq('referral_code', kolRef).maybeSingle();
                if (kol && kol.email !== email) referredBy = kol.email;
            }
        } catch (e) {
            console.warn('[google-callback] KOL ref lookup failed (non-fatal):', e.message);
        }
    }

    // 建立新用戶（existing user 的衝突被 ignoreDuplicates 跳過，不影響 points）
    await supabase.from('users').upsert({ email, points: 60 }, {
        onConflict: 'email',
        ignoreDuplicates: true
    });

    // KOL 歸因：單獨 update 確保 existing user 也能被正確寫入（upsert+ignoreDuplicates 不會更新既有行）
    if (referredBy) {
        await supabase.from('users')
            .update({ referred_by: referredBy })
            .eq('email', email)
            .is('referred_by', null);
    }

    return res.status(200).send(renderHtml(
        true,
        '登入大成功！',
        '您現在可以安全地關閉此網頁，回到 SketchUp 繼續出圖了！'
    ));
}
