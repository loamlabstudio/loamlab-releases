const { createClient } = require('@supabase/supabase-js');

// 簡單滑動視窗限流：同一把 key（例如 email）在 windowSeconds 秒內最多 maxCount 次。
// Serverless function 每次呼叫都是全新 process，記憶體變數擋不住，所以用 Supabase 當計數器儲存。
// 環境變數缺失或 DB 打不到都 fail-open（不擋），避免限流機制本身故障連帶讓正常用戶也用不了。
async function checkRateLimit(key, { maxCount, windowSeconds }) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return { allowed: true };

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const now = new Date();
        const { data: row } = await supabase.from('rate_limits').select('count, window_start').eq('bucket_key', key).maybeSingle();
        const windowStart = row ? new Date(row.window_start) : null;
        const windowExpired = !windowStart || (now - windowStart) > windowSeconds * 1000;

        if (windowExpired) {
            await supabase.from('rate_limits').upsert({ bucket_key: key, count: 1, window_start: now.toISOString() });
            return { allowed: true };
        }
        if (row.count >= maxCount) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - (now - windowStart) / 1000)) };
        }
        await supabase.from('rate_limits').update({ count: row.count + 1 }).eq('bucket_key', key);
        return { allowed: true };
    } catch (_) {
        return { allowed: true };
    }
}

module.exports = { checkRateLimit };
