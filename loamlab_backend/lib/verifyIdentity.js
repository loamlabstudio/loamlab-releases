import { createClient } from '@supabase/supabase-js';

// 目前大部分端點只看 X-User-Email header 就認定「這是誰」，沒有任何簽章或憑證能證明
// 呼叫者真的是那個信箱的主人——知道（或猜到）一個 email 就能冒充。
// otp.js 在登入驗證通過後其實已經回傳 Supabase 簽發的 session（access_token），只是插件端
// 目前沒有存、也沒有送回來。這裡優先驗證 Authorization: Bearer <access_token>，驗證通過就
// 回傳「已驗證」的信箱（由 token 解出，不是自報的）；沒有帶 token（尚未更新的舊版插件）則
// 退回舊的 X-User-Email，呼叫端仍需自行做 IP pinning 檢查，行為與升級前完全一致。
export async function resolveUserEmail(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const headerEmail = req.headers['x-user-email'] || req.body?.email || null;

    if (token) {
        try {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
            if (supabaseUrl && supabaseAnonKey) {
                const supabase = createClient(supabaseUrl, supabaseAnonKey);
                const { data, error } = await supabase.auth.getUser(token);
                if (!error && data?.user?.email) {
                    touchLastActive(data.user.email);
                    return { email: data.user.email, verified: true };
                }
            }
        } catch (_) { /* token 驗證失敗，往下退回舊路徑 */ }
    }

    if (headerEmail) touchLastActive(headerEmail);
    return { email: headerEmail, verified: false };
}

// DAU 統計依據（users.last_active_at）：這裡是全站唯一的身份解析入口，每次授權 API
// 呼叫都會經過，故在此更新。Fire-and-forget，用 service role 繞過 RLS，失敗不影響
// 呼叫端的主流程（不 await、不拋出）。
function touchLastActive(email) {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !key) return;
        createClient(supabaseUrl, key)
            .from('users').update({ last_active_at: new Date().toISOString() }).eq('email', email)
            .then(() => {}, () => {});
    } catch (_) { /* 非致命 */ }
}
