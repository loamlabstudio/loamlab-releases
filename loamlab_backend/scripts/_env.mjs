// 共用工具：對賬/稽核腳本一律用這支載入 .env.local + 建立 Supabase client，
// 取代過去每支腳本各自複製一份 readFileSync 解析邏輯（或更糟：直接把 key 寫死在原始碼裡）。
// 用法：import { makeSupabase } from './_env.mjs';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

export function loadEnvLocal() {
    try {
        readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').forEach(line => {
            const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
            if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        });
    } catch (_) {}
}

export function makeSupabase() {
    loadEnvLocal();
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('❌ 未讀到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，請確認 loamlab_backend/.env.local 存在');
        process.exit(1);
    }
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function dodoBase(apiKey = process.env.DODO_API_KEY) {
    return apiKey?.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
}
