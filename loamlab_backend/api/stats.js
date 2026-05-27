import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// ── 洞見郵件共用工具 ──────────────────────────────────────────────────────────
function getLangKey(locale) {
    if (!locale) return 'tw';
    const l = locale.toLowerCase();
    if (l.startsWith('zh-cn') || l === 'cn') return 'cn';
    if (l.startsWith('zh')) return 'tw';
    if (l.startsWith('en')) return 'en';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('pt')) return 'br';
    if (l.startsWith('ja')) return 'jp';
    return 'tw';
}

function wrapBody(subject, body) {
    const bodyHtml = (body || '').replace(/\n/g, '<br>');
    return `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e2e8f0"><div style="font-size:18px;font-weight:700;color:#e2e8f0;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #1e293b">${subject}</div><div style="line-height:1.9;color:#cbd5e1;margin-top:16px">${bodyHtml}</div><p style="font-size:11px;color:#475569;margin-top:40px;border-top:1px solid #1e293b;padding-top:16px">LoamLab · <a href="https://loamlab.studio" style="color:#7c3aed;text-decoration:none">loamlab.studio</a> · <a href="https://loamlab.studio/unsubscribe" style="color:#475569;text-decoration:none">退訂 / Unsubscribe</a></p></div>`;
}

const EMAIL_DEFAULTS = {
    onboarding: {
        tw: { subject: '你還沒用過的 60 點，能做什麼', body: '嗨，\n\n你加入 LoamLab 已經幾天了，帳戶裡有 60 點還沒動過。\n\n這 60 點可以做一件很具體的事：在你現在正在畫的 SketchUp 場景裡，選一個視角，90 秒後得到一張可以直接給客戶看的效果圖——不用匯出、不用學新軟體、不用等渲染農場排隊。\n\n很多設計師的第一張 LoamLab 圖都是提案當天臨時生成的，客戶看到直接點頭。\n\n試試看 → https://loamlab.studio\n\nLoamLab 團隊' },
        en: { subject: 'What can you do with the 60 points you haven\'t used?', body: 'Hi,\n\nYou joined LoamLab a few days ago and still have 60 points sitting in your account.\n\nThose 60 points can do something very concrete: pick a view in the SketchUp scene you\'re already working on, and get a client-ready render in 90 seconds — no export, no new software to learn, no render farm queue.\n\nMany designers generate their first LoamLab render the day of a presentation. Clients say yes on the spot.\n\nTry it → https://loamlab.studio\n\nLoamLab Team' },
    },
    reengagement: {
        tw: { subject: '你最近有沒有案子需要效果圖？', body: '嗨，\n\n有段時間沒見到你了。\n\n不知道你現在手上有什麼，但如果剛好有需要快速出圖的案子——LoamLab 最近批量場景渲染、新的光效風格都有在優化。\n\n很多用 SketchUp 的設計師最常用 LoamLab 的時機是提案前一天：不需要另外開渲染軟體，直接在插件選視角和風格，十分鐘出完整套圖。\n\n如果帳戶裡還有點數，隨時可以回來用 → https://loamlab.studio\n\nLoamLab 團隊' },
        en: { subject: 'Do you have a project that needs renders?', body: 'Hi,\n\nIt\'s been a while since we\'ve seen you render.\n\nIf you happen to have a project that needs quick visuals — LoamLab has been improving batch scene rendering and new lighting styles lately.\n\nMany SketchUp designers use LoamLab the day before a presentation: no need to open another app, just pick your views and styles in the plugin, and get a full set in ten minutes.\n\nIf you still have credits, come back anytime → https://loamlab.studio\n\nLoamLab Team' },
    },
    upgrade: {
        tw: { subject: '點數快見底了，但案子還在繼續', body: '嗨，\n\n你的 LoamLab 點數快用完了。\n\n在問你要不要補點之前，想先問：之前渲出來的圖，有沒有讓提案過程更順一點？\n\n如果有，可能值得繼續。Starter 方案每月 $9 美金，換 500 點——大概是一整個空間方案所有視角的用量，或 10 個獨立場景的 1K 效果圖，點數一到帳就能繼續。\n\n查看方案 → https://loamlab.studio\n\nLoamLab 團隊' },
        en: { subject: 'Your credits are running low, but the project isn\'t done', body: 'Hi,\n\nYour LoamLab credits are almost gone.\n\nBefore asking whether you\'d like to top up — did the renders you\'ve done help make presentations go more smoothly?\n\nIf so, it might be worth continuing. The Starter plan is $9/month for 500 credits — roughly enough for a full space at all angles, or 10 separate 1K renders. Credits hit your account immediately.\n\nSee plans → https://loamlab.studio\n\nLoamLab Team' },
    },
};

// 核心發信函式（notify_users 和 cron_insights 共用）
async function sendBatchInsightEmails(emailList, template, supabase) {
    if (!emailList.length) return { sent: 0, skipped: 0 };
    if (!EMAIL_DEFAULTS[template]) throw new Error(`Unknown template: ${template}`);

    // 7天 dedup
    const alreadySent = new Set();
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const { data: logs } = await supabase.from('email_logs').select('user_email')
            .eq('template_name', template).gte('sent_at', sevenDaysAgo).in('user_email', emailList);
        if (logs) logs.forEach(l => alreadySent.add(l.user_email));
    } catch (_) {}

    const toSend = emailList.filter(e => !alreadySent.has(e));
    if (!toSend.length) return { sent: 0, skipped: emailList.length };

    // 取 DB 範本（優先）
    let dbTpl = null;
    try {
        const { data } = await supabase.from('email_templates').select('*').eq('id', template).single();
        if (data && data.body_tw) dbTpl = data;
    } catch (_) {}

    // 取用戶語言
    const { data: userRows } = await supabase.from('users').select('email, locale').in('email', toSend);
    const localeMap = {};
    (userRows || []).forEach(u => { if (u.locale) localeMap[u.email] = u.locale; });

    const emailItems = toSend.map(to => {
        const key = getLangKey(localeMap[to]);
        let subject, html;
        if (dbTpl) {
            const subjectText = dbTpl[`subject_${key}`] || dbTpl.subject_tw || '';
            const bodyText    = dbTpl[`body_${key}`]    || dbTpl.body_tw    || '';
            subject = subjectText;
            html = wrapBody(subjectText, bodyText);
        } else {
            const fallbackKey = (key === 'en') ? 'en' : 'tw';
            const variant = EMAIL_DEFAULTS[template][fallbackKey];
            subject = variant.subject;
            html = wrapBody(variant.subject, variant.body);
        }
        return { to, subject, html };
    });

    const from = `LoamLab <${process.env.GMAIL_USER}>`;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        pool: true,
        maxConnections: 1,
        rateDelta: 300,
        rateLimit: 3,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    for (const item of emailItems) {
        await transporter.sendMail({ from, to: item.to, subject: item.subject, html: item.html });
    }
    transporter.close();

    try {
        const now = new Date().toISOString();
        await supabase.from('email_logs').insert(toSend.map(e => ({ user_email: e, template_name: template, sent_at: now })));
    } catch (_) {}

    return { sent: toSend.length, skipped: emailList.length - toSend.length };
}

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
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.json({ code: -1, msg: 'Missing SUPABASE env vars' });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const action = req.query.action;

    // --- 公開端點（無需 key，插件健康檢查用、或獲取公告）---
    if (!action) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.status(200).json(await getPublicStats(supabase));
    }


    // --- 圖片代理（繞過 CORS，讓手機端可 fetch blob 下載）---
    if (action === 'proxy_img' && req.method === 'GET') {
        const imgUrl = req.query.url || '';
        let parsedHost = '';
        try { parsedHost = new URL(imgUrl).hostname; } catch(e) {}
        // SSRF protection: must be HTTPS, block private/local addresses
        const privatePattern = /^(localhost$|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1)/;
        if (!imgUrl.startsWith('https://') || !parsedHost || privatePattern.test(parsedHost)) {
            return res.status(403).json({ code: -1, msg: 'URL not allowed' });
        }
        try {
            const upstream = await fetch(imgUrl);
            if (!upstream.ok) return res.status(502).end();
            const contentType = upstream.headers.get('content-type') || 'image/jpeg';
            const buffer = Buffer.from(await upstream.arrayBuffer());
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', 'attachment; filename="loamlab-render.jpg"');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buffer);
        } catch(e) {
            return res.status(502).json({ code: -1, msg: e.message });
        }
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

    if (req.method === 'GET' && action === 'get_share_template') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_SHARE_TEMPLATE')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, template: data?.metadata?.template || {}, config: data?.metadata?.config || {} });
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

    // --- Share Session (POST: 建立; GET: 讀取) — 用 transactions 表儲存，避免建新表 ---
    if (action === 'create_share_session' && req.method === 'POST') {
        const { images, text_data } = req.body || {};
        const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const { error: insertErr } = await supabase.from('transactions').insert({
            user_email: null, amount: 0,
            transaction_type: 'SHARE_SESSION',
            metadata: { session_id: sessionId, images: images || [], text_data: text_data || {} }
        });
        if (insertErr) return res.status(500).json({ code: -1, msg: insertErr.message });
        return res.status(200).json({ code: 0, session_id: sessionId });
    }

    if (action === 'get_share_session' && req.method === 'GET') {
        const sessionId = req.query.session;
        if (!sessionId) return res.status(400).json({ code: -1, msg: 'Missing session' });
        const { data, error } = await supabase
            .from('transactions')
            .select('metadata, created_at')
            .eq('transaction_type', 'SHARE_SESSION')
            .filter('metadata->>session_id', 'eq', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !data) return res.status(404).json({ code: -1, msg: 'Session not found' });
        const age = Date.now() - new Date(data.created_at).getTime();
        if (age > 48 * 3600 * 1000) return res.status(410).json({ code: -1, msg: 'Session expired' });
        // 將原始圖片 URL 替換為後端代理 URL，避免暴露上游域名
        const proxiedImages = (data.metadata.images || []).map((img, idx) => ({
            ...img,
            url: `/api/stats?action=share_img&session=${encodeURIComponent(sessionId)}&idx=${idx}`
        }));
        return res.status(200).json({ code: 0, images: proxiedImages, text_data: data.metadata.text_data || {} });
    }

    // 圖片代理端點：session ID + idx → 後端查真實 URL 後回傳圖片位元組（不暴露上游域名）
    if (action === 'share_img' && req.method === 'GET') {
        const sessionId = req.query.session;
        const idx = parseInt(req.query.idx || '0', 10);
        if (!sessionId) return res.status(400).end();
        const { data, error } = await supabase
            .from('transactions')
            .select('metadata, created_at')
            .eq('transaction_type', 'SHARE_SESSION')
            .filter('metadata->>session_id', 'eq', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !data) return res.status(404).end();
        const age = Date.now() - new Date(data.created_at).getTime();
        if (age > 48 * 3600 * 1000) return res.status(410).end();
        const img = (data.metadata.images || [])[idx];
        if (!img?.url?.startsWith('https://')) return res.status(404).end();
        try {
            const upstream = await fetch(img.url);
            if (!upstream.ok) return res.status(502).end();
            const ct = upstream.headers.get('content-type') || 'image/jpeg';
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.setHeader('Content-Type', ct);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buf);
        } catch(e) {
            return res.status(502).end();
        }
    }

    // --- 上傳本地圖到圖床，供無 cloud_url 的舊存檔使用 ---
    if (action === 'upload_share_img' && req.method === 'POST') {
        const { base64 } = req.body || {};
        if (!base64) return res.status(400).json({ code: -1, msg: 'Missing base64' });
        const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '';
        const clean = base64.replace(/^data:image\/\w+;base64,/, '');

        // Try freeimage.host first (free, no key needed)
        try {
            const form = new FormData();
            form.append('key', '6d207e02198a847aa98d0a2a901485a5');
            form.append('action', 'upload');
            form.append('source', clean);
            form.append('format', 'json');
            const r = await fetch('https://freeimage.host/api/1/upload', { method: 'POST', body: form });
            const d = await r.json();
            if (d.status_code === 200 && d.image?.url) return res.status(200).json({ code: 0, url: d.image.url });
        } catch(_) {}

        // Fallback: ImgBB
        if (IMGBB_API_KEY) {
            try {
                const form2 = new FormData();
                form2.append('image', clean);
                const r2 = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: form2 });
                const d2 = await r2.json();
                if (d2.success && d2.data?.url) return res.status(200).json({ code: 0, url: d2.data.url });
            } catch(_) {}
        }

        return res.status(500).json({ code: -1, msg: 'Upload failed' });
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

    if (req.method === 'GET' && action === 'get_t1_nodes') {
        const [nodesRes, cfgRes] = await Promise.all([
            supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_T1_NODES')
                .order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_ENGINE_CONFIG')
                .order('created_at', { ascending: false }).limit(1).maybeSingle()
        ]);
        if (nodesRes.error) return res.status(500).json({ code: -1, msg: nodesRes.error.message });
        const prompt_engine_mode = cfgRes.data?.metadata?.config?.prompt_engine_mode || 'nodes';
        return res.status(200).json({ code: 0, nodes: nodesRes.data?.metadata?.nodes || [], prompt_engine_mode });
    }

    if (req.method === 'GET' && action === 'get_system_config') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_ENGINE_CONFIG')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, config: data?.metadata?.config || { prompt_engine_mode: 'nodes' } });
    }

    if (req.method === 'GET' && action === 'get_options') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_OPTIONS')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, options: data?.metadata?.options || [] });
    }

    if (req.method === 'GET' && action === 'get_bundles') {
        const { data, error } = await supabase.from('transactions')
            .select('metadata')
            .eq('transaction_type', 'SYSTEM_BUNDLES')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, bundles: data?.metadata?.bundles || [] });
    }

    // --- 用戶預設同步（需要 X-User-Email，不需要 ADMIN_KEY）---
    if (action === 'get_presets' && req.method === 'GET') {
        const ue = req.headers['x-user-email'];
        if (!ue) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        const { data, error } = await supabase.from('user_presets')
            .select('name, preset_data, created_at')
            .eq('user_email', ue)
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, presets: (data || []).map(r => ({ name: r.name, created_at: r.created_at, data: r.preset_data || {} })) });
    }

    if (action === 'save_presets' && req.method === 'POST') {
        const ue = req.headers['x-user-email'];
        if (!ue) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        const { presets } = req.body || {};
        if (!Array.isArray(presets)) return res.status(400).json({ code: -1, msg: 'presets must be array' });
        // INSERT first，成功後才 DELETE 舊資料，避免 DELETE 成功但 INSERT 失敗導致資料歸零。
        const cutoff = new Date().toISOString();
        if (presets.length > 0) {
            const rows = presets.slice(0, 20).map(p => ({
                user_email: ue,
                name: (p.name || '未命名').slice(0, 100),
                preset_data: p.data || {},
                created_at: new Date().toISOString()  // 新時間戳確保 > cutoff
            }));
            const { error } = await supabase.from('user_presets').insert(rows);
            if (error) return res.status(500).json({ code: -1, msg: error.message });
        }
        // INSERT 成功（或明確清空）後才刪除 cutoff 之前的舊記錄
        await supabase.from('user_presets').delete().eq('user_email', ue).lt('created_at', cutoff);
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    // --- Lead Capture（公開端點，無需 ADMIN_KEY）---
    if (action === 'capture_email' && req.method === 'POST') {
        let { email, lang } = req.body || {};
        if (!email || !email.includes('@')) return res.status(400).json({ code: -1, msg: 'Invalid email' });
        email = email.trim().toLowerCase()
            .replace(/@gamil\.com$/,  '@gmail.com')
            .replace(/@gmai\.com$/,   '@gmail.com')
            .replace(/@gmial\.com$/,  '@gmail.com')
            .replace(/@gmail\.con$/,  '@gmail.com')
            .replace(/@gmail\.cim$/,  '@gmail.com')
            .replace(/@gnail\.com$/,  '@gmail.com');
        await supabase.from('transactions').insert({
            user_email: email, amount: 0,
            transaction_type: 'LEAD_CAPTURE',
            metadata: { source: 'mobile_hero_cta', lang: lang || 'us', user_agent: req.headers['user-agent'] }
        });
        if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
            try {
                const DL_URL = 'https://github.com/loamlabstudio/loamlab-releases/releases/latest/download/loamlab_plugin.rbz';
                const footer = `<p style="font-size:12px;color:#64748b;margin-top:40px;border-top:1px solid #1e293b;padding-top:16px">LoamLab · SketchUp AI Renderer<br>If you did not request this email, please ignore it.</p>`;
                const DOWNLOAD_TEMPLATES = {
                    tw: {
                        subject: '🚀 您的 LoamLab SketchUp AI 渲染插件下載連結',
                        heading: '🏠 LoamLab AI 渲染插件',
                        intro: '感謝您的興趣！點擊下方按鈕下載插件：',
                        btnText: '下載插件 →',
                        stepsTitle: '安裝步驟',
                        steps: ['下載 .rbz 檔案至電腦', '開啟 SketchUp → 偏好設定 → 擴充功能 → 安裝擴充功能', '選擇剛下載的 .rbz 檔案', '重啟 SketchUp，在擴充功能選單找到 LoamLab'],
                    },
                    us: {
                        subject: '🚀 Your LoamLab SketchUp AI Renderer Download Link',
                        heading: '🏠 LoamLab AI Renderer',
                        intro: 'Thanks for your interest! Click the button below to download the plugin:',
                        btnText: 'Download Plugin →',
                        stepsTitle: 'Installation Steps',
                        steps: ['Download the .rbz file to your computer', 'Open SketchUp → Preferences → Extensions → Install Extension', 'Select the downloaded .rbz file', 'Restart SketchUp and find LoamLab in the Extensions menu'],
                    },
                    cn: {
                        subject: '🚀 您的 LoamLab SketchUp AI 渲染插件下载链接',
                        heading: '🏠 LoamLab AI 渲染插件',
                        intro: '感谢您的关注！点击下方按钮下载插件：',
                        btnText: '下载插件 →',
                        stepsTitle: '安装步骤',
                        steps: ['下载 .rbz 文件至电脑', '打开 SketchUp → 偏好设置 → 扩展程序 → 安装扩展程序', '选择刚下载的 .rbz 文件', '重启 SketchUp，在扩展程序菜单找到 LoamLab'],
                    },
                    es: {
                        subject: '🚀 Tu enlace de descarga del plugin LoamLab para SketchUp',
                        heading: '🏠 LoamLab AI Renderer',
                        intro: '¡Gracias por tu interés! Haz clic para descargar el plugin:',
                        btnText: 'Descargar Plugin →',
                        stepsTitle: 'Pasos de instalación',
                        steps: ['Descarga el archivo .rbz en tu ordenador', 'Abre SketchUp → Preferencias → Extensiones → Instalar extensión', 'Selecciona el archivo .rbz descargado', 'Reinicia SketchUp y busca LoamLab en el menú de extensiones'],
                    },
                    br: {
                        subject: '🚀 Seu link de download do plugin LoamLab para SketchUp',
                        heading: '🏠 LoamLab AI Renderer',
                        intro: 'Obrigado pelo interesse! Clique abaixo para baixar o plugin:',
                        btnText: 'Baixar Plugin →',
                        stepsTitle: 'Passos de instalação',
                        steps: ['Baixe o arquivo .rbz no seu computador', 'Abra o SketchUp → Preferências → Extensões → Instalar Extensão', 'Selecione o arquivo .rbz baixado', 'Reinicie o SketchUp e encontre o LoamLab no menu de extensões'],
                    },
                    jp: {
                        subject: '🚀 LoamLab SketchUp AIレンダリングプラグインのダウンロードリンク',
                        heading: '🏠 LoamLab AI レンダラー',
                        intro: 'ご興味いただきありがとうございます！下のボタンからプラグインをダウンロードしてください：',
                        btnText: 'プラグインをダウンロード →',
                        stepsTitle: 'インストール手順',
                        steps: ['.rbzファイルをパソコンにダウンロード', 'SketchUpを開く → 環境設定 → 拡張機能 → 拡張機能をインストール', 'ダウンロードした.rbzファイルを選択', 'SketchUpを再起動し、拡張機能メニューでLoamLabを探す'],
                    },
                };
                const tpl = DOWNLOAD_TEMPLATES[lang] || DOWNLOAD_TEMPLATES['us'];
                const stepsHtml = tpl.steps.map(s => `<li>${s}</li>`).join('');
                const html = `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e2e8f0">
  <div style="font-size:22px;font-weight:700;color:#a78bfa;margin-bottom:16px">${tpl.heading}</div>
  <p style="margin:0 0 20px">${tpl.intro}</p>
  <div style="margin:28px 0"><a href="${DL_URL}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">${tpl.btnText}</a></div>
  <div style="background:#1e293b;border-radius:10px;padding:16px 20px;margin:20px 0">
    <div style="color:#a78bfa;font-weight:700;font-size:14px;margin-bottom:8px">${tpl.stepsTitle}</div>
    <ol style="padding-left:20px;line-height:2;margin:0;color:#cbd5e1;font-size:14px">${stepsHtml}</ol>
  </div>
  ${footer}
</div>`;
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
                });
                await transporter.sendMail({
                    from: `LoamLab <${process.env.GMAIL_USER}>`,
                    to: email,
                    subject: tpl.subject,
                    html
                });
            } catch (_) {}
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    // --- Admin 端點（需要 ADMIN_KEY）---
    const adminKeyHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminKeyHeader || adminKeyHeader !== process.env.ADMIN_KEY) {
        return res.status(401).json({ code: -1, msg: 'Unauthorized' });
    }

    if (req.method === 'POST' && action === 'set_t1_nodes') {
        const nodes = req.body?.nodes || [];
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_T1_NODES',
            metadata: { nodes }
        }]);
        if (error) {
            console.error('Save t1 nodes error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
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

    if (req.method === 'POST' && action === 'set_share_template') {
        const template = req.body?.template || {};
        const config = req.body?.config || {};
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_SHARE_TEMPLATE',
            metadata: { template, config }
        }]);
        if (error) {
            console.error('Save share template error:', error.message);
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

    if (req.method === 'POST' && action === 'set_system_config') {
        const config = req.body?.config || {};
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_ENGINE_CONFIG',
            metadata: { config }
        }]);
        if (error) {
            console.error('Save engine config error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_options') {
        const options = req.body?.options || [];
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_OPTIONS',
            metadata: { options }
        }]);
        if (error) {
            console.error('Save options error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_bundles') {
        const bundles = req.body?.bundles || [];
        const { error } = await supabase.from('transactions').insert([{
            user_email: null,
            amount: 0,
            transaction_type: 'SYSTEM_BUNDLES',
            metadata: { bundles }
        }]);
        if (error) {
            console.error('Save bundles error:', error.message);
            return res.status(500).json({ code: -1, msg: error.message });
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'GET' && action === 'export_preset_package') {
        const [promptsRes, nodesRes, modelsRes] = await Promise.all([
            supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_PROMPTS').order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_T1_NODES').order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('transactions').select('metadata').eq('transaction_type', 'MODEL_CONFIG').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        return res.status(200).json({
            code: 0,
            package: {
                prompts: promptsRes.data?.metadata?.prompts || {},
                t1_nodes: nodesRes.data?.metadata?.nodes || [],
                model_config: modelsRes.data?.metadata?.models || {},
                exported_at: new Date().toISOString()
            }
        });
    }

    if (req.method === 'POST' && action === 'import_preset_package') {
        const { prompts, t1_nodes, model_config } = req.body || {};
        const ops = [];
        if (prompts) ops.push(supabase.from('transactions').insert([{ user_email: null, amount: 0, transaction_type: 'SYSTEM_PROMPTS', metadata: { prompts } }]));
        if (t1_nodes) ops.push(supabase.from('transactions').insert([{ user_email: null, amount: 0, transaction_type: 'SYSTEM_T1_NODES', metadata: { nodes: t1_nodes } }]));
        if (model_config) ops.push(supabase.from('transactions').insert([{ user_email: null, amount: 0, transaction_type: 'MODEL_CONFIG', metadata: { models: model_config } }]));
        if (!ops.length) return res.status(400).json({ code: -1, msg: 'Nothing to import' });
        const results = await Promise.all(ops);
        const failed = results.filter(r => r.error);
        if (failed.length) return res.status(500).json({ code: -1, msg: failed[0].error.message });
        return res.status(200).json({ code: 0, msg: `Imported ${ops.length} config(s)` });
    }

    // --- KOL Payout admin (merged from admin/kol_payout.js to stay within Vercel 12-fn limit) ---
    if (action === 'kol_payout') {
        const sub = req.query.sub || 'list';
        const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

        if (sub === 'list') {
            const { data, error } = await supabase.from('kol_ledger')
                .select('*').eq('status', 'pending').lt('created_at', cutoff)
                .order('kol_email').order('created_at');
            if (error) return res.status(500).json({ code: -1, msg: error.message });
            return res.json({ code: 0, count: data.length, records: data });
        }

        if (sub === 'settle') {
            const { data: toSettle, error: fetchErr } = await supabase.from('kol_ledger')
                .select('id').eq('status', 'pending').lt('created_at', cutoff);
            if (fetchErr) return res.status(500).json({ code: -1, msg: fetchErr.message });
            if (!toSettle?.length) return res.json({ code: 0, settled: 0 });
            const ids = toSettle.map(r => r.id);
            const { error: updateErr } = await supabase.from('kol_ledger').update({ status: 'ready_to_pay' }).in('id', ids);
            if (updateErr) return res.status(500).json({ code: -1, msg: updateErr.message });
            return res.json({ code: 0, settled: ids.length });
        }

        if (sub === 'export') {
            const { data, error } = await supabase.from('kol_ledger')
                .select('kol_code,kol_email,buyer_email,transaction_id,amount_paid,commission_rate,commission_amount,status,created_at')
                .in('status', ['pending', 'ready_to_pay']).order('kol_email').order('created_at');
            if (error) return res.status(500).json({ code: -1, msg: error.message });
            const header = 'kol_code,kol_email,buyer_email,transaction_id,amount_paid_cents,commission_rate,commission_amount_cents,status,created_at';
            const rows = (data || []).map(r =>
                [r.kol_code, r.kol_email, r.buyer_email, r.transaction_id, r.amount_paid, r.commission_rate, r.commission_amount, r.status, r.created_at].join(',')
            );
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="kol_payout_${Date.now()}.csv"`);
            return res.send([header, ...rows].join('\n'));
        }

        if (sub === 'mark_paid') {
            const { ids } = req.query;
            if (!ids) return res.status(400).json({ code: -1, msg: 'Missing ids (comma-separated UUIDs)' });
            const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
            if (!idList.length) return res.status(400).json({ code: -1, msg: 'Empty id list' });
            const { error: updateErr } = await supabase.from('kol_ledger')
                .update({ status: 'paid' }).in('id', idList).eq('status', 'ready_to_pay');
            if (updateErr) return res.status(500).json({ code: -1, msg: updateErr.message });
            return res.json({ code: 0, marked_paid: idList.length });
        }

        return res.status(400).json({ code: -1, msg: 'Invalid sub. Use: list | settle | export | mark_paid' });
    }

    // ── 郵件範本管理（讀取）─────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'get_email_templates') {
        const { data, error } = await supabase.from('email_templates').select('*');
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, templates: data || [] });
    }

    // ── 郵件範本管理（儲存）─────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save_email_template') {
        const { id, subject_tw, subject_en, subject_cn, subject_es, subject_br, subject_jp,
                    body_tw,    body_en,    body_cn,    body_es,    body_br,    body_jp } = req.body || {};
        if (!id) return res.status(400).json({ code: -1, msg: 'Missing template id' });
        const row = {
            id, subject_tw, subject_en, subject_cn, subject_es, subject_br, subject_jp,
            body_tw, body_en, body_cn, body_es, body_br, body_jp,
            updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('email_templates').upsert(row, { onConflict: 'id' });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0 });
    }

    // ── 批量發送郵件（Resend）────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'notify_users') {
        const { emails, template } = req.body || {};
        if (!emails?.length || !template) return res.status(400).json({ code: -1, msg: 'Missing emails or template' });
        if (!EMAIL_DEFAULTS[template]) return res.status(400).json({ code: -1, msg: `Unknown template: ${template}` });
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            return res.status(503).json({ code: -1, msg: 'Gmail not configured' });
        }
        try {
            const result = await sendBatchInsightEmails(emails.slice(0, 50), template, supabase);
            return res.status(200).json({ code: 0, ...result });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // ── 每日自動洞見發信（Vercel Cron 或管理員手動觸發）────────────────────────
    if (action === 'cron_insights') {
        const isCron = req.headers['x-vercel-cron'] === '1';
        const isAdmin = (req.headers['authorization'] || '').replace('Bearer ', '') === process.env.ADMIN_KEY;
        if (!isCron && !isAdmin) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            return res.status(503).json({ code: -1, msg: 'Gmail not configured' });
        }

        const now = new Date();
        const summary = {};

        // Onboarding：24–48 小時前註冊，從未渲染（第二天早上，熱情最高）
        try {
            const d1 = new Date(now - 1 * 24 * 3600 * 1000).toISOString();
            const d2 = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
            const { data: candidates } = await noTest(supabase.from('users').select('email'))
                .gte('created_at', d2).lte('created_at', d1);
            if (candidates?.length) {
                const emails = candidates.map(u => u.email);
                const { data: rendered } = await supabase.from('render_history').select('user_email').in('user_email', emails);
                const renderedSet = new Set((rendered || []).map(r => r.user_email));
                const targets = emails.filter(e => !renderedSet.has(e) && !isTest(e));
                if (targets.length) {
                    summary.onboarding = await sendBatchInsightEmails(targets, 'onboarding', supabase);
                }
            }
        } catch (e) { summary.onboarding_error = e.message; }

        // Re-engagement：7–21 天前曾渲染，但最近 7 天沒有活躍（黃金介入窗口）
        try {
            const d7  = new Date(now - 7  * 24 * 3600 * 1000).toISOString();
            const d21 = new Date(now - 21 * 24 * 3600 * 1000).toISOString();
            const { data: stale } = await supabase.from('render_history').select('user_email')
                .gte('created_at', d21).lt('created_at', d7);
            if (stale?.length) {
                const candidates = [...new Set(stale.map(r => r.user_email))].filter(e => !isTest(e));
                // 排除 7 天內有新渲染的
                const { data: recent } = await supabase.from('render_history').select('user_email')
                    .gte('created_at', d7).in('user_email', candidates);
                const recentSet = new Set((recent || []).map(r => r.user_email));
                const targets = candidates.filter(e => !recentSet.has(e));
                if (targets.length) {
                    summary.reengagement = await sendBatchInsightEmails(targets, 'reengagement', supabase);
                }
            }
        } catch (e) { summary.reengagement_error = e.message; }

        return res.status(200).json({ code: 0, ran_at: now.toISOString(), ...summary });
    }

    // ── 批量補點（Admin）─────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'add_bonus_points') {
        const { emails, amount } = req.body || {};
        if (!emails?.length || !amount || amount < 1 || amount > 200) {
            return res.status(400).json({ code: -1, msg: 'Missing emails or invalid amount (1-200)' });
        }
        const emailList = emails.slice(0, 50).filter(e => !isTest(e));

        const { data: currentUsers, error: fetchErr } = await supabase.from('users')
            .select('email, points').in('email', emailList);
        if (fetchErr) return res.status(500).json({ code: -1, msg: fetchErr.message });

        const updateResults = await Promise.allSettled(
            (currentUsers || []).map(u =>
                supabase.from('users').update({ points: Math.max(0, (u.points || 0) + amount) }).eq('email', u.email)
            )
        );

        const succeeded = updateResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length;

        if (succeeded > 0) {
            await supabase.from('transactions').insert(
                (currentUsers || []).slice(0, succeeded).map(u => ({
                    user_email: u.email, amount, transaction_type: 'ADMIN_BONUS',
                    metadata: { reason: 'admin_insight_bonus', granted_at: new Date().toISOString() },
                }))
            );
        }

        return res.status(200).json({ code: 0, succeeded, total: emailList.length });
    }

    // ── Admin: 請求記錄日誌 ────────────────────────────────────────────────────
    if (action === 'request_log' && req.method === 'GET') {
        const limit = Math.min(parseInt(req.query.limit || '100'), 500);
        const emailFilter = (req.query.email || '').trim().toLowerCase();
        const typeFilter = req.query.type || 'all';

        let q = noTestRef(supabase
            .from('transactions')
            .select('id, user_email, amount, transaction_type, metadata, created_at')
            .not('user_email', 'is', null))
            .order('created_at', { ascending: false })
            .limit(limit);

        if (emailFilter) q = q.ilike('user_email', `%${emailFilter}%`);
        if (typeFilter === 'render') q = q.like('transaction_type', 'RENDER_%');
        else if (typeFilter === 'refund') q = q.like('transaction_type', 'REFUND_%');
        else if (typeFilter === 'topup') q = q.in('transaction_type', ['TOPUP_SINGLE', 'TOPUP_SUBSCRIPTION']);

        const { data, error } = await q;
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, logs: data || [] });
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
        noTestRef(supabase.from('transactions').select('*', { count: 'exact', head: true }).in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360']).gte('created_at', d30)),
        noTestRef(supabase.from('transactions').select('amount_usd_cents, transaction_type').in('transaction_type', ['TOPUP_SINGLE','TOPUP_SUBSCRIPTION']).gte('created_at', d30)),
        noTestRef(supabase.from('transactions').select('transaction_type, created_at, metadata').in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360']).gte('created_at', d30).limit(1000)),
        noTestRef(supabase.from('render_history').select('user_rating, style, tool_id').gte('created_at', d30).limit(5000)),
        noTestRef(supabase.from('feedback').select('*', { count: 'exact', head: true }).eq('type', 'paywall_trigger').gte('created_at', d30)),
    ]);

    const revenue30d = (topups || []).reduce((s, r) => s + ((r.amount_usd_cents || 0) / 100), 0);
    const toolBreakdown = {};
    (renders || []).forEach(r => {
        const tid = String(r.metadata?.tool_id || 1);
        toolBreakdown[tid] = (toolBreakdown[tid] || 0) + 1;
    });
    
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
            .in('transaction_type', ['RENDER_1K', 'RENDER_2K', 'RENDER_4K', 'RENDER_360'])),
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
        .select('amount_usd_cents, transaction_type, created_at, user_email')
        .in('transaction_type', ['TOPUP_SINGLE','TOPUP_SUBSCRIPTION'])
        .gte('created_at', daysAgo(90))
        .order('created_at', { ascending: false }));

    const rows = (txns || []).filter(t => !isTest(t.user_email));
    const d30 = daysAgo(30);
    const revenue30d = rows.filter(t => t.created_at >= d30).reduce((s, t) => s + ((t.amount_usd_cents || 0) / 100), 0);
    const daily = groupByDate(rows);

    return { revenue_30d: revenue30d, daily_revenue: daily, total_topups_90d: rows.length };
}

// ── Admin: 渲染分析 ───────────────────────────────────────────────────────────
async function renders(supabase) {
    const { data: rows } = await noTestRef(supabase
        .from('transactions')
        .select('transaction_type, created_at, user_email')
        .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360'])
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
            .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360'])
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
        supabase.from('transactions').select('user_email').in('transaction_type', ['TOPUP_SINGLE','TOPUP_SUBSCRIPTION'])
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
    const d14 = daysAgo(14);
    const d30 = daysAgo(30);

    const [
        { data: allUsers },
        { data: allRenders },
        { data: prevRenders },
        { data: paywallFb },
        { data: topups },
        { data: renderHist },
        { data: allRefunds },
    ] = await Promise.all([
        noTest(supabase.from('users')
            .select('email, points, lifetime_points, subscription_plan, created_at')
            .limit(500)),
        noTestRef(supabase.from('transactions')
            .select('user_email, created_at')
            .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360'])
            .gte('created_at', d30)),
        noTestRef(supabase.from('transactions')
            .select('user_email')
            .in('transaction_type', ['RENDER_1K','RENDER_2K','RENDER_4K','RENDER_360'])
            .gte('created_at', d14).lt('created_at', d7)),
        noTestRef(supabase.from('feedback')
            .select('user_email')
            .eq('type', 'paywall_trigger')),
        noTestRef(supabase.from('transactions')
            .select('user_email')
            .in('transaction_type', ['TOPUP_SINGLE','TOPUP_SUBSCRIPTION'])),
        noTestRef(supabase.from('render_history')
            .select('user_email, tool_id, user_rating')
            .gte('created_at', d30)
            .limit(3000)),
        noTestRef(supabase.from('transactions')
            .select('user_email, created_at')
            .gte('created_at', d30)
            .like('transaction_type', 'REFUND_%')),
    ]);

    const users       = (allUsers    || []).filter(u => !isTest(u.email));
    const renders     = (allRenders  || []).filter(r => !isTest(r.user_email));
    const prev        = (prevRenders || []).filter(r => !isTest(r.user_email));
    const paidSet     = new Set((topups     || []).map(t => t.user_email));
    const hist        = (renderHist  || []).filter(r => !isTest(r.user_email));
    const refunds     = (allRefunds  || []).filter(r => !isTest(r.user_email));

    const renderMap = {};
    renders.forEach(r => { renderMap[r.user_email] = (renderMap[r.user_email] || 0) + 1; });

    const active7d     = new Set(renders.filter(r => r.created_at >= d7).map(r => r.user_email));
    const prevActive7d = new Set(prev.map(r => r.user_email));

    const paywallMap = {};
    (paywallFb || []).forEach(f => {
        if (f.user_email) paywallMap[f.user_email] = (paywallMap[f.user_email] || 0) + 1;
    });

    function makeTrend(current, previous) {
        const delta = current - previous;
        if (Math.abs(delta) <= 1) return { direction: 'same', delta: 0 };
        return { direction: delta > 0 ? 'up' : 'down', delta: Math.abs(delta) };
    }

    const result = [];

    // 1. Onboarding 卡住（activation / priority 1）
    const stuck = users.filter(u => u.created_at < d3 && !renderMap[u.email] && (u.points || 0) > 0);
    const stuckPrev = users.filter(u => {
        const c = u.created_at;
        return c < daysAgo(10) && c >= d14 && !renderMap[u.email] && (u.points || 0) > 0;
    });
    if (stuck.length) result.push({
        type: 'onboarding_stuck', category: 'activation', priority: 1, severity: 'warning',
        count: stuck.length,
        message: `${stuck.length} 位新用戶卡在 onboarding（已註冊 3+ 天，從未渲染，還有點數）`,
        action: '考慮發送 onboarding 激活郵件',
        emails: stuck.slice(0, 5).map(u => u.email),
        all_emails: stuck.map(u => u.email),
        trend: makeTrend(stuck.length, stuckPrev.length),
        auto_actions: ['email', 'points', 'copy'],
        email_template: 'onboarding',
    });

    // 2. 流失風險（retention / priority 1）
    const churnRisk = users.filter(u => renderMap[u.email] && !active7d.has(u.email) && (u.points || 0) < 20 && !u.subscription_plan);
    const churnPrev = users.filter(u => renderMap[u.email] && !prevActive7d.has(u.email) && (u.points || 0) < 20 && !u.subscription_plan);
    if (churnRisk.length) result.push({
        type: 'churn_risk', category: 'retention', priority: 1, severity: 'warning',
        count: churnRisk.length,
        message: `${churnRisk.length} 位活躍用戶近 7 天沉默且點數偏低（可能快流失）`,
        action: '觸發 re-engage 郵件或低點數補點提醒',
        emails: churnRisk.slice(0, 5).map(u => u.email),
        all_emails: churnRisk.map(u => u.email),
        trend: makeTrend(churnRisk.length, churnPrev.length),
        auto_actions: ['email', 'points', 'copy'],
        email_template: 'reengagement',
    });

    // 3. 首次渲染後未再渲染（activation / priority 2）
    const secondMissing = users.filter(u => renderMap[u.email] === 1 && !active7d.has(u.email) && !paidSet.has(u.email));
    if (secondMissing.length) result.push({
        type: 'second_render_missing', category: 'activation', priority: 2, severity: 'opportunity',
        count: secondMissing.length,
        message: `${secondMissing.length} 位用戶首次渲染後超過 7 天未再渲染（有意願但未養成習慣）`,
        action: '發送第二次渲染提醒郵件，附上使用技巧或限時優惠',
        emails: secondMissing.slice(0, 5).map(u => u.email),
        all_emails: secondMissing.map(u => u.email),
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['email', 'copy'],
        email_template: 'reengagement',
    });

    // 4. 升級候選（conversion / priority 2）
    const upgradeCandidates = users.filter(u => (paywallMap[u.email] || 0) >= 2 && !paidSet.has(u.email));
    if (upgradeCandidates.length) result.push({
        type: 'upgrade_candidate', category: 'conversion', priority: 2, severity: 'opportunity',
        count: upgradeCandidates.length,
        message: `${upgradeCandidates.length} 位用戶碰過 Paywall 2+ 次但尚未付費`,
        action: '優化 paywall 文案 / 考慮個人化私訊',
        emails: upgradeCandidates.slice(0, 5).map(u => u.email),
        all_emails: upgradeCandidates.map(u => u.email),
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['email', 'copy'],
        email_template: 'upgrade',
    });

    // 5. 高價值未訂閱（conversion / priority 3）
    const highValue = users.filter(u => (u.lifetime_points || 0) > 100 && !u.subscription_plan);
    if (highValue.length) result.push({
        type: 'high_value_no_sub', category: 'conversion', priority: 3, severity: 'opportunity',
        count: highValue.length,
        message: `${highValue.length} 位重度用戶（累計點數 >100）尚未訂閱`,
        action: '個人化升級推薦，說明訂閱性價比',
        emails: highValue.slice(0, 5).map(u => u.email),
        all_emails: highValue.map(u => u.email),
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['email', 'copy'],
        email_template: 'upgrade',
    });

    // 6. KOL 候選人（conversion / priority 3）
    const goodRatingUsers = new Set(hist.filter(r => r.user_rating != null && r.user_rating >= 4).map(r => r.user_email));
    const kolList = users.filter(u => (u.lifetime_points || 0) > 80 && !u.subscription_plan && goodRatingUsers.has(u.email));
    if (kolList.length) result.push({
        type: 'kol_candidate', category: 'conversion', priority: 3, severity: 'opportunity',
        count: kolList.length,
        message: `${kolList.length} 位高活躍且評分佳的用戶未訂閱，適合邀請成為 KOL/推薦大使`,
        action: '發送個人化邀請，提供 KOL 折扣碼和佣金計劃說明',
        emails: kolList.slice(0, 5).map(u => u.email),
        all_emails: kolList.map(u => u.email),
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['email', 'copy'],
        email_template: 'upgrade',
    });

    // 7. 渲染錯誤率過高（product / priority 1）
    const totalRenders = renders.length;
    if (totalRenders > 10 && refunds.length / totalRenders > 0.15) {
        result.push({
            type: 'error_spike', category: 'product', priority: 1, severity: 'warning',
            count: refunds.length,
            message: `渲染錯誤率過高：${Math.round(refunds.length / totalRenders * 100)}%（${refunds.length} 次退款 / ${totalRenders} 次渲染，30天）`,
            action: '檢查 Coze API 狀態、圖床可用性、後端錯誤日誌',
            emails: [],
            all_emails: [],
            trend: { direction: 'same', delta: 0 },
            auto_actions: ['copy'],
            email_template: null,
        });
    }

    // 8. 低評分集中（product / priority 2）
    const lowRatingMap = {};
    hist.filter(r => r.user_rating != null && r.user_rating <= 2)
        .forEach(r => { lowRatingMap[r.user_email] = (lowRatingMap[r.user_email] || 0) + 1; });
    const lowRatingList = Object.keys(lowRatingMap);
    if (lowRatingList.length >= 2) result.push({
        type: 'low_rating_cluster', category: 'product', priority: 2, severity: 'warning',
        count: lowRatingList.length,
        message: `${lowRatingList.length} 位用戶有低評分記錄（≤2 顆星），需檢查渲染品質`,
        action: '分析低評分渲染的共同特徵（風格/解析度/提示詞），改善模型調校',
        emails: lowRatingList.slice(0, 5),
        all_emails: lowRatingList,
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['copy'],
        email_template: null,
    });

    // 9. 工具使用集中（product / priority 4）
    const toolCounts = {};
    hist.forEach(r => { const t = String(r.tool_id || 1); toolCounts[t] = (toolCounts[t] || 0) + 1; });
    const totalHist = hist.length;
    const t1Count = toolCounts['1'] || 0;
    const otherCount = totalHist - t1Count;
    if (totalHist > 20 && otherCount / totalHist < 0.1) result.push({
        type: 'tool_underuse', category: 'product', priority: 4, severity: 'info',
        count: otherCount,
        message: `T2/T3/T4 合計只佔 ${Math.round(otherCount / totalHist * 100)}% 渲染量，用戶集中在 T1`,
        action: '考慮在 onboarding 和 UI 中突出介紹其他工具的使用場景',
        emails: [],
        all_emails: [],
        trend: { direction: 'same', delta: 0 },
        auto_actions: ['copy'],
        email_template: null,
    });

    result.sort((a, b) => a.priority - b.priority);
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
