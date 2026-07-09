// 系統設定存取（system_config 表）。之前這 8 種設定（SYSTEM_CONFIG /
// SYSTEM_PROMPTS / SYSTEM_T1_NODES / MODEL_CONFIG / SYSTEM_OPTIONS /
// SYSTEM_BUNDLES / SYSTEM_ENGINE_CONFIG / SYSTEM_SHARE_TEMPLATE）塞在
// transactions 表裡（每次存檔 INSERT 一列新的，靠 created_at DESC LIMIT 1
// 撈最新），跟真正的財務流水帳混在一起。改用專屬的 system_config 表
// （UPSERT，一個 key 一列）。render.js 和 stats.js 都要讀寫同一份設定，
// 所以共用這支模組，避免兩邊各自實作一份、日後改一邊漏改另一邊。
export async function getConfig(supabase, key) {
    const { data, error } = await supabase.from('system_config').select('value').eq('key', key).maybeSingle();
    if (error) { console.error('[systemConfig:read_failed]', key, error.message); return null; }
    return data?.value || null;
}

export async function setConfig(supabase, key, value) {
    const { error } = await supabase.from('system_config')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) return { error };
    // 必須 await：serverless function 一旦回應就可能被凍結，沒 await 的 promise
    // 不保證會跑完，之前用 fire-and-forget 導致這筆歷史記錄實測從未真正寫入。
    // 失敗只記 log、不影響主要設定已經存檔成功（不 throw、不改變回傳值）。
    const { error: logErr } = await supabase.from('system_config_log').insert({ key, value });
    if (logErr) console.error('[systemConfig:log_failed]', key, logErr.message);
    return { error: null };
}
