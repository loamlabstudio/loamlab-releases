import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const { session_id } = req.query;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;

    if (!session_id) return res.status(400).send('Missing session_id');
    if (!supabaseUrl || supabaseUrl === 'undefined') return res.status(500).send('SUPABASE_URL not configured');
    if (!googleClientId || googleClientId === 'undefined') return res.status(500).send('GOOGLE_CLIENT_ID not configured');

    // 建立 pending auth_session (使用 Service Role 確保繞過 RLS)
    const supabaseKeyToUse = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;
    const supabase = createClient(supabaseUrl, supabaseKeyToUse);
    const { error: dbError } = await supabase
        .from('auth_sessions')
        .upsert({ id: session_id, status: 'pending' }, { onConflict: 'id' });

    if (dbError) {
        console.error('[login] auth_sessions upsert failed:', dbError.message);
        return res.status(500).send('DB error: ' + dbError.message);
    }

    // 直接導向 Google OAuth（完全不碰 Supabase OAuth proxy，Safari ITP 無從干擾）
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const redirectUri = `https://${host}/api/auth/google-callback`;

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.set('client_id', googleClientId);
    googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('scope', 'email openid');
    googleAuthUrl.searchParams.set('state', session_id);  // session_id 兼作 CSRF state，驗收時對比 DB
    googleAuthUrl.searchParams.set('access_type', 'online');

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, googleAuthUrl.toString());
}
