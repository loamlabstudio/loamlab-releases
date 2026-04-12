import { createClient } from '@supabase/supabase-js';

// ── 測試帳號過濾 ──────────────────────────────────────────────────────────────
// 排除 testsprite_*、*@example.com、*@loamlab.test* 以及指定的測試帳號
const TEST_REGEX = /testsprite|@example\.com|\.test[_.]|\.test$|^loamlabstudio@gmail\.com$|^loamlabs@gmail\.com$/i;
const isTest = email => TEST_REGEX.test(email || '');

// 為 Supabase query 加測試帳號排除（email 欄位）
const noTest = q => q
    .not('email', 'ilike', '%testsprite%')
    .not('email', 'ilike', '%.test')
    .not('email', 'ilike', '%.test_%')
    .not('email', 'ilike', '%@example.com')
    .not('email', 'in', '("loamlabstudio@gmail.com","loamlabs@gmail.com")');

// 為 user_email 欄位（transactions / render_history / feedback）加排除
const noTestRef = q => q
    .not('user_email', 'ilike', '%testsprite%')
    .not('user_email', 'ilike', '%.test')
    .not('user_email', 'ilike', '%.test_%')
    .not('user_email', 'ilike', '%@example.com')
    .not('user_email', 'in', '("loamlabstudio@gmail.com","loamlabs@gmail.com")');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ code: -1, msg: 'Missing SUPABASE env vars' });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const action = req.query.action;

    // --- 公開端點（無需 key，插件健康檢查用、或獲取公告）---
    if (!action) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.status(200).json(await getPublicStats(supabase));
    }

    if (action === 'get_announcement') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_CONFIG')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        // 向下相容：舊格式為字串，新格式為多語言物件
        const raw = data?.metadata?.announcement || '';
        const announcement = (raw && typeof raw === 'string') ? { us: raw, tw: raw, cn: raw, es: raw, br: raw, jp: raw } : (raw || {});
        return res.status(200).json({ code: 0, announcement });
    }

    if (req.method === 'GET' && action === 'get_prompts') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_PROMPTS')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, prompts: data?.metadata?.prompts || {} });
    }

    if (req.method === 'GET' && action === 'get_model_config') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'MODEL_CONFIG')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, models: data?.metadata?.models || {} });
    }

    // --- Admin 端點（需要 ADMIN_KEY）---
    const adminKeyHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminKeyHeader || adminKeyHeader !== process.env.ADMIN_KEY) {
        return res.status(401).json({ code: -1, msg: 'Unauthorized' });
    }

    if (req.method === 'POST' && action === 'set_announcement') {
        const announcement = req.body?.announcement || {};
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_CONFIG',
            metadata: { announcement }
        }]);
        if (error) {
            console.error('Save error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_prompts') {
        const prompts = req.body?.prompts || {};
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_PROMPTS',
            metadata: { prompts }
        }]);
        if (error) {
            console.error('Save prompts error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_model_config') {
        const models = req.body?.models || {};
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'MODEL_CONFIG',
            metadata: { models }
        }]);
        if (error) {
            console.error('Save model config error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    const actions = { dashboard, users, revenue, renders, feedback, funnel, insights, vercel_traffic };
    if (!actions[action]) return res.status(400).json({ code: -1, msg: `Unknown action: ${action}` });

    try {
        return res.status(200).json({ code: 0, data: await actions[action](supabase) });
    } catch (e) {
        return res.status(500).json({ code: -1, msg: e.message });
    }
}

// ── 公開 stats（原有邏輯保留）─────────────────────────────────────────────────
async function getPublicStats(supabase) {
    try {
        const [
            { count: totalUsers },
            { count: c1k }, { count: c2k }, { count: c4k }
        ] = await Promise.all([
            noTest(supabase.from('users').select('*', { count: 'exact', head: true })),
            noTestRef(supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_1K')),
            noTestRef(supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_2K')),
            noTestRef(supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('transaction_type', 'RENDER_4K')),
        ]);
        const hoursSaved = Math.floor((c1k ?? 0) * 1.5 + (c2k ?? 0) * 3 + (c4k ?? 0) * 5);
        return { code: 0, status: 'healthy', hours_saved: hoursSaved, stats: { total_users: totalUsers, timestamp: new Date().toISOString() } };
    } catch (e) {
        return { code: -1, msg: e.message };
    }
}

// ── Admin: 總覽 KPI ───────────────────────────────────────────────────────────
async function dashboard(supabase) {
    const d7  = daysAgo(7);
    const d30 = daysAgo(30);
    const d1  = daysAgo(1);

    const [
        { count: totalUsers },
        { count: activeToday },
        { count: active7d },
        { count: totalRenders30d },
        { data: topups },
        { data: renders },
        { data: ratingRows },
        { count: paywallHits },
    ] = await Promise.all([
        noTest(supabase.from('users').select('*', { count: 'exact', head: true })),
        noTestRef(supabase.from('transactions').select('user_email', { count: 'exact', head: true }).gte('created_at', d1)),
        noTestRef(supabase.from('transactions').select('user_email', { count: 'exact', head: true }).gte('created_at', d7)),
        noTestRef(supabase.from('transactions').select('*', { count: 'exact', head: true }).in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K']).gte('created_at', d30)),
        noTestRef(supabase.from('transactions').select('amount, transaction_type').eq('transaction_type', 'TOPUP').gte('created_at', d30)),
        noTestRef(supabase.from('transactions').select('transaction_type, created_at').in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K']).gte('created_at', d30).limit(1000)),
        noTestRef(supabase.from('render_history').select('user_rating, style, tool_id').gte('created_at', d30)),
        noTestRef(supabase.from('feedback').select('*', { count: 'exact', head: true }).eq('type', 'paywall_trigger').gte('created_at', d30)),
    ]);

    const revenue30d = (topups || []).reduce((s, r) => s + (r.amount || 0), 0);
    const toolBreakdown = groupBy((ratingRows || []).filter(r => r.tool_id != null), 'tool_id');
    
    // 從 render_history 獲取風格分佈 (30天)
    const styleBreakdown = groupBy(ratingRows || [], 'style');
    
    const errorCount = (topups || []).filter(t => t.transaction_type.startsWith('REFUND_')).length;

    const avgRatingRows = (ratingRows || []).filter(r => r.user_rating != null);
    const avgRating = avgRatingRows.length
        ? Math.round((avgRatingRows.reduce((s, r) => s + r.user_rating, 0) / avgRatingRows.length) * 10) / 10
        : null;

    // 解析度解析
    const resBreakdown = groupBy((renders || []).map(r => ({
        ...r, res: (r.transaction_type || '').replace('RENDER_', '').toLowerCase()
    })), 'res');

    return {
        total_users: totalUsers,
        active_today: activeToday,
        active_7d: active7d,
        renders_30d: totalRenders30d,
        revenue_30d: revenue30d,
        paywall_hits_30d: paywallHits,
        avg_rating: avgRating,
        tool_breakdown: toolBreakdown,
        style_breakdown: styleBreakdown,
        resolution_breakdown: resBreakdown,
        error_count_30d: errorCount,
    };
}

// ── Admin: 用戶列表（含分層）────────────────────────────────────────────────
async function users(supabase) {
    const d7  = daysAgo(7);
    const d30 = daysAgo(30);

    const [{ data: userRows }, { data: recentTx }] = await Promise.all([
        noTest(supabase.from('users')
            .select('email, points, lifetime_points, subscription_plan, is_beta_tester, created_at, last_topup_at')
            .order('lifetime_points', { ascending: false })
            .limit(200)),
        noTestRef(supabase.from('transactions')
            .select('user_email, created_at')
            .gte('created_at', d30)
            .in('transaction_type', ['RENDER_1K', 'RENDER_2K', 'RENDER_4K'])),
    ]);

    const active7dSet  = new Set((recentTx || []).filter(t => t.created_at >= d7).map(t => t.user_email));
    const active30dSet = new Set((recentTx || []).map(t => t.user_email));

    // JS 二次過濾（防漏）
    const tagged = (userRows || [])
        .filter(u => !isTest(u.email))
        .map(u => ({ ...u, tier: getTier(u, active7dSet, active30dSet) }));

    return { users: tagged, total: tagged.length };
}

// ── Admin: 收入指標 ───────────────────────────────────────────────────────────
async function revenue(supabase) {
    const { data: txns } = await noTestRef(supabase
        .from('transactions')
        .select('amount, transaction_type, created_at, user_email')
        .eq('transaction_type', 'TOPUP')
        .gte('created_at', daysAgo(90))
        .order('created_at', { ascending: false }));

    const rows = (txns || []).filter(t => !isTest(t.user_email));
    const d30 = daysAgo(30);
    const revenue30d = rows.filter(t => t.created_at >= d30).reduce((s, t) => s + (t.amount || 0), 0);
    const daily = groupByDate(rows);

    return { revenue_30d: revenue30d, daily_revenue: daily, total_topups_90d: rows.length };
}

// ── Admin: 渲染分析 ───────────────────────────────────────────────────────────
async function renders(supabase) {
    const { data: rows } = await noTestRef(supabase
        .from('transactions')
        .select('transaction_type, created_at, user_email')
        .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K'])
        .gte('created_at', daysAgo(30))
        .order('created_at', { ascending: false })
        .limit(1000));

    const data = (rows || []).filter(r => !isTest(r.user_email));
    // 解析度從 transaction_type 提取（RENDER_1K → 1K）
    const dataWithRes = data.map(r => ({
        ...r,
        resolution: (r.transaction_type || '').replace('RENDER_', '').toLowerCase(),
    }));
    return {
        total: dataWithRes.length,
        resolution_breakdown: groupBy(dataWithRes, 'resolution'),
        daily_renders:        groupByDate(dataWithRes),
    };
}

// ── Admin: 反饋彙整 ───────────────────────────────────────────────────────────
async function feedback(supabase) {
    const [{ data: rows }, { data: ratingRows }] = await Promise.all([
        noTestRef(supabase.from('feedback')
            .select('user_email, type, rating, content, tags, created_at')
            .order('created_at', { ascending: false })
            .limit(100)),
        noTestRef(supabase.from('feedback')
            .select('rating')
            .not('rating', 'is', null)),
    ]);

    const data = (rows || []).filter(f => !isTest(f.user_email));
    const ratings = (ratingRows || []).filter(r => !isTest(r.user_email));
    const avgRating = ratings.length
        ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10
        : null;

    return {
        recent: data,
        total: data.length,
        avg_rating: avgRating,
        type_breakdown: groupBy(data, 'type'),
    };
}

// ── 轉化漏斗 ─────────────────────────────────────────────────────────────────
async function funnel(supabase) {
    // Step1: 總註冊用戶
    const { count: registered } = await noTest(
        supabase.from('users').select('*', { count: 'exact', head: true })
    );

    // Step2: 有任何渲染記錄的獨立用戶（從 transactions 計算）
    const { data: r1 } = await noTestRef(
        supabase.from('transactions').select('user_email')
            .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K'])
    );
    const hasRender = new Set((r1 || []).filter(r => r.user_email).map(r => r.user_email));

    // Step3: 習慣形成（≥3次渲染）
    const renderCounts = {};
    (r1 || []).forEach(r => { if (r.user_email) renderCounts[r.user_email] = (renderCounts[r.user_email] || 0) + 1; });
    const habitual = Object.values(renderCounts).filter(c => c >= 3).length;

    // Step4: 觸發過 Paywall 的獨立用戶
    const { data: pw } = await noTestRef(
        supabase.from('feedback').select('user_email').eq('type', 'paywall_trigger')
    );
    const hitPaywall = new Set((pw || []).filter(f => f.user_email).map(f => f.user_email)).size;

    // Step5: 有過 TOPUP 的獨立用戶（付費）
    const { data: paid } = await noTestRef(
        supabase.from('transactions').select('user_email').eq('transaction_type', 'TOPUP')
    );
    const paidSet = new Set((paid || []).filter(p => p.user_email).map(p => p.user_email)).size;

    return {
        steps: [
            { label: '已註冊',      value: registered || 0 },
            { label: '首次渲染',    value: hasRender.size },
            { label: '習慣形成',    value: habitual },
            { label: 'Paywall觸發', value: hitPaywall },
            { label: '已付費',      value: paidSet || 0 },
        ]
    };
}

// ── 自動洞見 ──────────────────────────────────────────────────────────────────
async function insights(supabase) {
    const d3  = daysAgo(3);
    const d7  = daysAgo(7);
    const d30 = daysAgo(30);

    // 拉取需要的原始數據
    const [
        { data: allUsers },
        { data: allRenders },
        { data: paywallFb },
        { data: topups },
    ] = await Promise.all([
        noTest(supabase.from('users')
            .select('email, points, lifetime_points, subscription_plan, created_at')
            .limit(500)),
        noTestRef(supabase.from('transactions')
            .select('user_email, created_at')
            .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K'])
            .gte('created_at', d30)),
        noTestRef(supabase.from('feedback')
            .select('user_email')
            .eq('type', 'paywall_trigger')),
        noTestRef(supabase.from('transactions')
            .select('user_email')
            .eq('transaction_type', 'TOPUP')),
    ]);

    const users    = (allUsers || []).filter(u => !isTest(u.email));
    const renders  = (allRenders || []).filter(r => !isTest(r.user_email));
    const paidSet  = new Set((topups || []).map(t => t.user_email));

    // 渲染計數 Map（30天）
    const renderMap = {};
    renders.forEach(r => { renderMap[r.user_email] = (renderMap[r.user_email] || 0) + 1; });

    // 7天內有渲染的 Set
    const active7d = new Set(renders.filter(r => r.created_at >= d7).map(r => r.user_email));

    // Paywall 觸發次數 Map
    const paywallMap = {};
    (paywallFb || []).forEach(f => {
        if (f.user_email) paywallMap[f.user_email] = (paywallMap[f.user_email] || 0) + 1;
    });

    const result = [];

    // 1. Onboarding 卡住：註冊 >3天，從未渲染，points > 0
    const stuck = users.filter(u =>
        u.created_at < d3 &&
        !renderMap[u.email] &&
        (u.points || 0) > 0
    );
    if (stuck.length) result.push({
        type: 'onboarding_stuck',
        severity: 'warning',
        count: stuck.length,
        message: `${stuck.length} 位新用戶卡在 onboarding（已註冊 3+ 天，從未渲染，還有點數）`,
        action: '考慮發送 onboarding 激活郵件',
        emails: stuck.slice(0, 5).map(u => u.email),
    });

    // 2. 升級候選：Paywall 觸發 ≥2 次，未付費
    const upgradeCandidates = users.filter(u =>
        (paywallMap[u.email] || 0) >= 2 && !paidSet.has(u.email)
    );
    if (upgradeCandidates.length) result.push({
        type: 'upgrade_candidate',
        severity: 'opportunity',
        count: upgradeCandidates.length,
        message: `${upgradeCandidates.length} 位用戶碰過 Paywall 2+ 次但尚未付費`,
        action: '優化 paywall 文案 / 考慮個人化私訊',
        emails: upgradeCandidates.slice(0, 5).map(u => u.email),
    });

    // 3. 流失風險：30天內有渲染，但近7天沉默，且 points < 20
    const churnRisk = users.filter(u =>
        renderMap[u.email] &&
        !active7d.has(u.email) &&
        (u.points || 0) < 20 &&
        !u.subscription_plan
    );
    if (churnRisk.length) result.push({
        type: 'churn_risk',
        severity: 'warning',
        count: churnRisk.length,
        message: `${churnRisk.length} 位活躍用戶近 7 天沉默且點數偏低（可能快流失）`,
        action: '觸發 re-engage 郵件或低點數補點提醒',
        emails: churnRisk.slice(0, 5).map(u => u.email),
    });

    // 4. 高價值未訂閱：lifetime_points > 100 且無訂閱
    const highValue = users.filter(u =>
        (u.lifetime_points || 0) > 100 && !u.subscription_plan
    );
    if (highValue.length) result.push({
        type: 'high_value_no_sub',
        severity: 'opportunity',
        count: highValue.length,
        message: `${highValue.length} 位重度用戶（累計點數 >100）尚未訂閱`,
        action: '個人化升級推薦，說明訂閱性價比',
        emails: highValue.slice(0, 5).map(u => u.email),
    });

    return { insights: result, analyzed_users: users.length };
}


// ── Admin: Vercel 網站流量 ────────────────────────────────────────────────────
async function vercel_traffic() {
    const token   = process.env.VERCEL_ACCESS_TOKEN;
    const slug    = process.env.VERCEL_PROJECT_SLUG || 'loamlab-camera';
    const teamId  = process.env.VERCEL_TEAM_ID;
    if (!token) return { configured: false };

    const now  = new Date();
    const to   = now.toISOString();
    const from = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const tz   = 'Asia/Taipei';
    const h    = { Authorization: `Bearer ${token}` };

    const base   = 'https://vercel.com/api/web-analytics';
    const common = `environment=production&filter=%7B%7D&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(tz)}&projectId=${slug}${teamId ? `&teamId=${teamId}` : ''}`;
    const stats  = (type) => `${base}/stats?${common}&limit=20&type=${type}`;

    const [overviewR, timeseriesR, referrersR, countriesR, devicesR] = await Promise.allSettled([
        fetch(`${base}/overview?${common}&withBounceRate=true`, { headers: h }).then(r => r.json()),
        fetch(`${base}/timeseries?${common}`,                   { headers: h }).then(r => r.json()),
        fetch(stats('referrer'),                                { headers: h }).then(r => r.json()),
        fetch(stats('country'),                                 { headers: h }).then(r => r.json()),
        fetch(stats('device'),                                  { headers: h }).then(r => r.json()),
    ]);

    return {
        configured: true,
        overview:    overviewR.status    === 'fulfilled' ? overviewR.value    : null,
        timeseries:  timeseriesR.status  === 'fulfilled' ? timeseriesR.value  : null,
        referrers:   referrersR.status   === 'fulfilled' ? referrersR.value   : null,
        countries:   countriesR.status   === 'fulfilled' ? countriesR.value   : null,
        devices:     devicesR.status     === 'fulfilled' ? devicesR.value     : null,
    };
}

// ── 工具函數 ──────────────────────────────────────────────────────────────────
function daysAgo(n) {
    return new Date(Date.now() - n * 86400000).toISOString();
}

function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
        const k = String(item[key] ?? 'unknown');
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
}

function groupByDate(arr) {
    return arr.reduce((acc, item) => {
        const d = (item.created_at || '').slice(0, 10);
        if (d) acc[d] = (acc[d] || 0) + 1;
        return acc;
    }, {});
}

function topN(obj, n) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
}

function getTier(user, active7dSet, active30dSet) {
    if ((user.lifetime_points || 0) > 500) return 'whale';
    if (user.subscription_plan) return 'subscriber';
    if (active7dSet.has(user.email)) return 'active';
    if (new Date(user.created_at) > new Date(daysAgo(7))) return 'new';
    if (!active30dSet.has(user.email)) return 'churned';
    return 'active';
}
