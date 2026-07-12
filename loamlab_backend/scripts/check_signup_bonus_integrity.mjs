// 排查免費新人禮（60 點）是否被誤寫進 lifetime_points，或是否有用戶 points 出現「每月被重置回 60」的痕跡。
// 只讀不寫，聚合統計，不印出個別用戶明細。
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

try {
    readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) {}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: lp60, error: e1 } = await supabase.from('users').select('email', { count: 'exact', head: false }).eq('lifetime_points', 60);
if (e1) { console.error(e1.message); process.exit(1); }
console.log('lifetime_points = 60 的用戶數（新人禮誤寫進永久池的可能徵兆）:', lp60?.length ?? 0);

const { data: subUsers, error: e2 } = await supabase.from('users')
    .select('email').eq('points', 60).not('subscription_plan', 'is', null);
if (e2) { console.error(e2.message); process.exit(1); }
console.log('目前有訂閱方案、但 points 剛好卡在 60 的用戶數（可能被誤重置回新人禮值）:', subUsers?.length ?? 0);
