import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { reconcilePaymentsForEmail } from '../lib/activate.js';
import { isValidAdminKey } from '../lib/safeCompare.js';
import { resolveUserEmail } from '../lib/verifyIdentity.js';
import { getConfig, setConfig } from '../lib/systemConfig.js';

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
    } catch (e) { console.error('[stats:dedup_check_failed]', template, e.message); }

    const toSend = emailList.filter(e => !alreadySent.has(e));
    if (!toSend.length) return { sent: 0, skipped: emailList.length };

    // 取 DB 範本（優先）
    let dbTpl = null;
    try {
        const { data } = await supabase.from('email_templates').select('*').eq('id', template).single();
        if (data && data.body_tw) dbTpl = data;
    } catch (e) {
        // PGRST116 = 尚未在 DB 自訂範本，走 hardcoded fallback 是正常路徑，不算錯誤
        if (e.code !== 'PGRST116') console.error('[stats:template_fetch_failed]', template, e.message);
    }

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
    } catch (e) { console.error('[stats:email_log_insert_failed]', template, e.message); }

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
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
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
        const value = await getConfig(supabase, 'SYSTEM_CONFIG');
        // 向下相容：舊格式為字串，新格式為多語言物件
        const raw = value?.announcement || '';
        const announcement = (raw && typeof raw === 'string') ? { us: raw, tw: raw, cn: raw, es: raw, br: raw, jp: raw } : (raw || {});
        return res.status(200).json({ code: 0, announcement });
    }

    if (req.method === 'GET' && action === 'get_share_template') {
        const value = await getConfig(supabase, 'SYSTEM_SHARE_TEMPLATE');
        return res.status(200).json({ code: 0, template: value?.template || {}, config: value?.config || {} });
    }

    if (req.method === 'GET' && action === 'get_prompts') {
        const value = await getConfig(supabase, 'SYSTEM_PROMPTS');
        return res.status(200).json({ code: 0, prompts: value?.prompts || {} });
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
            console.error('[stats:freeimage_upload_failed]', d.status_code, d.error?.message);
        } catch(e) { console.error('[stats:freeimage_upload_error]', e.message); }

        // Fallback: ImgBB
        if (IMGBB_API_KEY) {
            try {
                const form2 = new FormData();
                form2.append('image', clean);
                const r2 = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: form2 });
                const d2 = await r2.json();
                if (d2.success && d2.data?.url) return res.status(200).json({ code: 0, url: d2.data.url });
                console.error('[stats:imgbb_upload_failed]', d2.error?.message);
            } catch(e) { console.error('[stats:imgbb_upload_error]', e.message); }
        }

        console.error('[stats:upload_share_img_all_failed]');
        return res.status(500).json({ code: -1, msg: 'Upload failed' });
    }

    if (req.method === 'GET' && action === 'get_model_config') {
        const value = await getConfig(supabase, 'MODEL_CONFIG');
        return res.status(200).json({ code: 0, models: value?.models || {} });
    }

    if (req.method === 'GET' && action === 'get_t1_nodes') {
        const [nodesVal, cfgVal] = await Promise.all([
            getConfig(supabase, 'SYSTEM_T1_NODES'),
            getConfig(supabase, 'SYSTEM_ENGINE_CONFIG'),
        ]);
        const prompt_engine_mode = cfgVal?.config?.prompt_engine_mode || 'nodes';
        const disable_batch_style_lock = !!cfgVal?.config?.disable_batch_style_lock;
        return res.status(200).json({ code: 0, nodes: nodesVal?.nodes || [], prompt_engine_mode, disable_batch_style_lock });
    }

    if (req.method === 'GET' && action === 'get_system_config') {
        const value = await getConfig(supabase, 'SYSTEM_ENGINE_CONFIG');
        return res.status(200).json({ code: 0, config: value?.config || { prompt_engine_mode: 'nodes' } });
    }

    if (req.method === 'GET' && action === 'get_options') {
        const value = await getConfig(supabase, 'SYSTEM_OPTIONS');
        return res.status(200).json({ code: 0, options: value?.options || [] });
    }

    if (req.method === 'GET' && action === 'get_bundles') {
        const value = await getConfig(supabase, 'SYSTEM_BUNDLES');
        return res.status(200).json({ code: 0, bundles: value?.bundles || [] });
    }

    // --- 用戶預設同步（需要 X-User-Email，不需要 ADMIN_KEY）---
    if (action === 'get_presets' && req.method === 'GET') {
        const ue = (await resolveUserEmail(req)).email;
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
        const ue = (await resolveUserEmail(req)).email;
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

    // --- 用戶自訂 Node (userChips) 雲端同步（需要 X-User-Email，不需要 ADMIN_KEY）---
    if (action === 'get_user_chips' && req.method === 'GET') {
        const ue = (await resolveUserEmail(req)).email;
        if (!ue) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        const { data, error } = await supabase.from('users')
            .select('user_chips')
            .eq('email', ue)
            .single();
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, user_chips: data?.user_chips || {} });
    }

    if (action === 'save_user_chips' && req.method === 'POST') {
        const ue = (await resolveUserEmail(req)).email;
        if (!ue) return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        const { user_chips } = req.body || {};
        if (!user_chips || typeof user_chips !== 'object' || Array.isArray(user_chips)) {
            return res.status(400).json({ code: -1, msg: 'user_chips must be object' });
        }
        const { error } = await supabase.from('users').update({ user_chips }).eq('email', ue);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    // --- Lead Capture（公開端點，無需 ADMIN_KEY）---
    if (action === 'capture_email' && req.method === 'POST') {
        const { email, lang } = req.body || {};
        if (!email || !email.includes('@')) return res.status(400).json({ code: -1, msg: 'Invalid email' });
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
            } catch (e) { console.error('[stats:capture_email_download_link_failed]', email, e.message); }
        }
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    // ── 渲染異常自動掃描與退款（Vercel Cron 每日觸發，或管理員手動觸發）───────────
    // 背景：render.js 的 poll_render 有 4 分鐘逾時退款安全網，但那只覆蓋「還在輪詢中」
    // 的任務；若輪詢本身在客戶端提前放棄（例如 main.rb 5 分鐘逾時、App 被關閉、網路斷線），
    // 扣點交易會變成孤兒——沒有 render_history 出圖記錄，也沒有任何 REFUND_* 交易。
    // 這支排程用「同一用戶的扣款 vs. 出圖/退款」時間序列做配對，找出超過 20 分鐘仍未配對
    // 到結果的孤兒扣款，自動退回點數，把「客訴才發現」變成系統自癒。
    // 判斷成功與否依賴 render_history 記錄完整——這也是為什麼 saveRenderHistory 必須 await
    // 而不是 fire-and-forget（見 render.js），否則這裡會把「其實有出圖但記錄漏寫」誤判成孤兒。
    if (action === 'scan_render_anomalies') {
        const isCron = req.headers['x-vercel-cron'] === '1';
        const isAdmin = isValidAdminKey((req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
        if (!isCron && !isAdmin) return res.status(401).json({ code: -1, msg: 'Unauthorized' });

        // 【Sprint: 數據版塊重建】daily_metrics 需要每日自動聚合，但 Vercel Hobby plan 的
        // Cron Job 數量有上限（目前已有 2 個），不新增第 3 條排程，改為搭便車跑在既有的
        // scan_render_anomalies（每日 01:30 UTC，此時前一個 UTC 日已完整結束，數據不會算漏）。
        // 失敗只記 log，不影響本排程原本的孤兒扣款掃描主流程。
        try { await cron_daily_metrics(supabase); } catch (e) { console.error('[cron_daily_metrics] failed:', e.message); }

        const RENDER_TYPES = ['RENDER_1K', 'RENDER_2K', 'RENDER_4K'];
        // 注意：REFUND_PENALTY 故意不列入——那是付款爭議/退單的扣點（amount 是負的、原因跟渲染
        // 無關），列進來會讓真正的孤兒扣款被誤判成「已處理」而漏退
        const REFUND_TYPES = ['REFUND_TASK_FAILED', 'REFUND_NO_URL', 'REFUND_NETWORK_ERROR', 'REFUND_UPLOAD_FAIL', 'REFUND_MANUAL_COMPENSATION', 'REFUND_AUTO_ANOMALY', 'REFUND_COMPENSATION'];
        const STALE_MS = 15 * 60 * 1000;         // poll_render 逾時退款安全網是 4 分鐘，這裡多留緩衝，絕不碰還在跑的任務
        const MATCH_WINDOW_MS = 20 * 60 * 1000;  // 扣款後 20 分鐘內若配不到出圖/退款記錄，視為孤兒
        const LOOKBACK_MS = 26 * 60 * 60 * 1000; // 略多於一天，涵蓋每日排程間隔，避免漏掃
        const now = Date.now();
        const windowStart = new Date(now - LOOKBACK_MS).toISOString();
        const windowEnd = new Date(now - STALE_MS).toISOString();

        try {
            const [debitRes, refundRes, historyRes] = await Promise.all([
                noTestRef(supabase.from('transactions').select('id,user_email,amount,transaction_type,created_at'))
                    .in('transaction_type', RENDER_TYPES)
                    .gte('created_at', windowStart).lte('created_at', windowEnd)
                    .order('created_at', { ascending: true }),
                noTestRef(supabase.from('transactions').select('id,user_email,amount,transaction_type,created_at,metadata'))
                    .in('transaction_type', REFUND_TYPES)
                    .gte('created_at', windowStart)
                    .order('created_at', { ascending: true }),
                noTestRef(supabase.from('render_history').select('user_email,created_at'))
                    .gte('created_at', windowStart)
                    .order('created_at', { ascending: true }),
            ]);
            if (debitRes.error) throw new Error('debit query: ' + debitRes.error.message);
            if (refundRes.error) throw new Error('refund query: ' + refundRes.error.message);
            if (historyRes.error) throw new Error('history query: ' + historyRes.error.message);

            // 已經自動退過款的原始交易 id，防止重複掃描造成重複退款
            const alreadyRefundedIds = new Set(
                (refundRes.data || [])
                    .filter(r => r.transaction_type === 'REFUND_AUTO_ANOMALY')
                    .map(r => r.metadata?.original_transaction_id)
                    .filter(Boolean)
            );

            const byUser = {};
            for (const tx of debitRes.data || []) {
                if (alreadyRefundedIds.has(tx.id)) continue;
                (byUser[tx.user_email] ||= { debits: [], resolves: [] }).debits.push(tx);
            }
            for (const tx of refundRes.data || []) {
                if (!byUser[tx.user_email]) continue;
                byUser[tx.user_email].resolves.push(new Date(tx.created_at).getTime());
            }
            for (const row of historyRes.data || []) {
                if (!byUser[row.user_email]) continue;
                byUser[row.user_email].resolves.push(new Date(row.created_at).getTime());
            }

            const orphans = [];
            for (const [email, { debits, resolves }] of Object.entries(byUser)) {
                resolves.sort((a, b) => a - b);
                const used = new Array(resolves.length).fill(false);
                for (const d of debits) {
                    const dTime = new Date(d.created_at).getTime();
                    let matched = false;
                    for (let i = 0; i < resolves.length; i++) {
                        if (used[i]) continue;
                        if (resolves[i] >= dTime && resolves[i] - dTime <= MATCH_WINDOW_MS) {
                            used[i] = true; matched = true; break;
                        }
                    }
                    if (!matched) orphans.push({ id: d.id, user_email: email, amount: Math.abs(d.amount), created_at: d.created_at });
                }
            }

            // dry_run=1：只回報掃描結果，不執行任何退款寫入（部署前 / 人工複查用）
            const dryRun = req.query.dry_run === '1';
            if (dryRun) {
                return res.status(200).json({
                    code: 0, dry_run: true, orphans_found: orphans.length,
                    orphans: orphans.slice(0, 200),
                    window: { start: windowStart, end: windowEnd }
                });
            }

            // 安全上限：單次最多處理 200 筆，避免資料異常時一次性放大衝擊
            const toRefund = orphans.slice(0, 200);
            let totalPoints = 0;
            const failures = [];
            for (const o of toRefund) {
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('deduct_render_points', { p_email: o.user_email, p_cost: -o.amount });
                    if (rpcErr || !rpcData?.success) { failures.push({ ...o, reason: rpcErr?.message || rpcData?.error }); continue; }
                    await supabase.from('transactions').insert([{
                        user_email: o.user_email, amount: o.amount, transaction_type: 'REFUND_AUTO_ANOMALY',
                        metadata: { original_transaction_id: o.id, original_created_at: o.created_at, reason: '排程掃描：扣點後無對應出圖/退款記錄，自動退回' }
                    }]);
                    totalPoints += o.amount;
                } catch (e) {
                    failures.push({ ...o, reason: e.message });
                }
            }

            console.log(`[scan_render_anomalies] orphans_found=${orphans.length} refunded=${toRefund.length - failures.length} points=${totalPoints} failures=${failures.length}`);
            return res.status(200).json({
                code: 0, orphans_found: orphans.length, refunded_count: toRefund.length - failures.length,
                total_points_refunded: totalPoints, failures,
                window: { start: windowStart, end: windowEnd }
            });
        } catch (e) {
            console.error('[scan_render_anomalies] fatal:', e.message);
            return res.status(500).json({ code: -1, msg: e.message });
        }
    }

    // --- Admin 端點（需要 ADMIN_KEY）---
    const adminKeyHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!isValidAdminKey(adminKeyHeader)) {
        return res.status(401).json({ code: -1, msg: 'Unauthorized' });
    }

    if (req.method === 'POST' && action === 'set_t1_nodes') {
        const nodes = req.body?.nodes || [];
        const { error } = await setConfig(supabase, 'SYSTEM_T1_NODES', { nodes });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_announcement') {
        const announcement = req.body?.announcement || {};
        const { error } = await setConfig(supabase, 'SYSTEM_CONFIG', { announcement });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_share_template') {
        const template = req.body?.template || {};
        const config = req.body?.config || {};
        const { error } = await setConfig(supabase, 'SYSTEM_SHARE_TEMPLATE', { template, config });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_prompts') {
        const prompts = req.body?.prompts || {};
        const { error } = await setConfig(supabase, 'SYSTEM_PROMPTS', { prompts });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_model_config') {
        const models = req.body?.models || {};
        const { error } = await setConfig(supabase, 'MODEL_CONFIG', { models });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_system_config') {
        const config = req.body?.config || {};
        const { error } = await setConfig(supabase, 'SYSTEM_ENGINE_CONFIG', { config });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_options') {
        const options = req.body?.options || [];
        const { error } = await setConfig(supabase, 'SYSTEM_OPTIONS', { options });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'POST' && action === 'set_bundles') {
        const bundles = req.body?.bundles || [];
        const { error } = await setConfig(supabase, 'SYSTEM_BUNDLES', { bundles });
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'Saved' });
    }

    if (req.method === 'GET' && action === 'export_preset_package') {
        const [promptsVal, nodesVal, modelsVal] = await Promise.all([
            getConfig(supabase, 'SYSTEM_PROMPTS'),
            getConfig(supabase, 'SYSTEM_T1_NODES'),
            getConfig(supabase, 'MODEL_CONFIG'),
        ]);
        return res.status(200).json({
            code: 0,
            package: {
                prompts: promptsVal?.prompts || {},
                t1_nodes: nodesVal?.nodes || [],
                model_config: modelsVal?.models || {},
                exported_at: new Date().toISOString()
            }
        });
    }

    if (req.method === 'POST' && action === 'import_preset_package') {
        const { prompts, t1_nodes, model_config } = req.body || {};
        const ops = [];
        if (prompts) ops.push(setConfig(supabase, 'SYSTEM_PROMPTS', { prompts }));
        if (t1_nodes) ops.push(setConfig(supabase, 'SYSTEM_T1_NODES', { nodes: t1_nodes }));
        if (model_config) ops.push(setConfig(supabase, 'MODEL_CONFIG', { models: model_config }));
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
        const isAdmin = isValidAdminKey((req.headers['authorization'] || '').replace('Bearer ', ''));
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

        // 方案過期清理：如果 dodo_subscription_id 是 null，且 last_topup_at 超過 31 天，自動清空 subscription_plan
        try {
            const d31 = new Date(now - 31 * 24 * 3600 * 1000).toISOString();
            const { error: expireErr } = await supabase.from('users')
                .update({ subscription_plan: null })
                .is('dodo_subscription_id', null)
                .not('subscription_plan', 'is', null)
                .lt('last_topup_at', d31);
            if (expireErr) summary.expire_cleanup_error = expireErr.message;
            else summary.expire_cleanup = 'success';
        } catch (e) { summary.expire_cleanup_error = e.message; }

        // cancel_pending 安全網：webhook 未觸發時，31天後強制清除
        try {
            const d31cp = new Date(now - 31 * 24 * 3600 * 1000).toISOString();
            const { error: cpErr } = await supabase.from('users')
                .update({ subscription_plan: null, cancel_pending: false, dodo_subscription_id: null })
                .eq('cancel_pending', true)
                .lt('last_topup_at', d31cp);
            if (cpErr) summary.cancel_pending_cleanup_error = cpErr.message;
            else summary.cancel_pending_cleanup = 'success';
        } catch (e) { summary.cancel_pending_cleanup_error = e.message; }

        // DB 付款掃描：無付款記錄且超過 35 天的帳號 → 清除（不依賴 Dodo API，恆常生效）
        // 重要：只掃 dodo_subscription_id IS NULL 的帳號
        // 有 sub_id 的用戶（含 webhook 失敗後靠 _auto 修復的真實付款者）交由 dodo_reconcile 驗證，不在此誤傷
        try {
            const d35 = new Date(now - 35 * 24 * 3600 * 1000).toISOString();
            const { data: staleMembers } = await supabase.from('users')
                .select('email')
                .not('subscription_plan', 'is', null)
                .is('dodo_subscription_id', null)
                .lt('last_topup_at', d35);

            const swept = [];
            for (const m of (staleMembers || [])) {
                if (isTest(m.email)) continue;
                // 真實付款：DODO_pay_* / LS_* / MANUAL_* / *_manual / 純數字（LS舊格式）/ DODO_sub_*_20xx
                const { data: realTxs } = await supabase.from('transactions')
                    .select('order_id').eq('user_email', m.email)
                    .in('transaction_type', ['TOPUP_SUBSCRIPTION', 'TOPUP_SINGLE'])
                    .not('order_id', 'ilike', '%_auto')
                    .not('order_id', 'ilike', '%_verify')
                    .not('order_id', 'ilike', 'SYNC_%')
                    .limit(1);
                if (!realTxs?.length) {
                    await supabase.from('users').update({
                        subscription_plan: null, dodo_subscription_id: null, cancel_pending: false
                    }).eq('email', m.email);
                    swept.push(m.email);
                    console.log(`[cron:payment_sweep] 清除無付款記錄幽靈會員: ${m.email}`);
                }
            }
            summary.payment_sweep = { checked: (staleMembers || []).length, swept: swept.length, emails: swept };
        } catch (e) { summary.payment_sweep_error = e.message; }

        // Dodo 訂閱對帳（雙向）：一次 API 呼叫，同時抓「DB 有但 Dodo 沒有」（幽靈會員，撤銷）
        // 與「Dodo active 但 DB 沒同步到當期點數」（webhook 漏接，主動補發）
        // 用 subscription_id 比對（繞過 Dodo API 忽略 customer_email 查詢參數的 bug）
        try {
            if (process.env.DODO_API_KEY) {
                const dodoBase = process.env.DODO_API_KEY.startsWith('test_')
                    ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
                // Dodo API 分頁參數是 page_size（上限100）+ page_number，不是 limit。
                // 舊版用 limit 會被忽略，靜默退回預設 page_size=10，導致每次只看到
                // 一小部分訂閱，下面的撤銷/補發邏輯都只在這一小部分資料上運作。
                let allItems = [];
                for (let page = 0; page < 5; page++) {
                    const listRes = await Promise.race([
                        fetch(`${dodoBase}/subscriptions?status=active&page_size=100&page_number=${page}`, {
                            headers: { Authorization: `Bearer ${process.env.DODO_API_KEY}` }
                        }),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))
                    ]);
                    if (!listRes.ok) break;
                    const items = (await listRes.json()).items || [];
                    if (!items.length) break;
                    allItems = allItems.concat(items);
                    if (items.length < 100) break;
                }
                if (allItems.length) {
                    // Dodo 可能忽略 status filter，嚴格用欄位比對
                    const activeItems = allItems.filter(s => s.status === 'active' || s.status === 'trialing');
                    const activeSubIds = new Set(activeItems.map(s => s.subscription_id || s.id));

                    // 方向一：找出 DB 有 subscription_id 但 Dodo 已無此 active sub 的帳號 → 撤銷
                    const { data: dbSubs } = await supabase.from('users')
                        .select('email, dodo_subscription_id, subscription_plan')
                        .not('subscription_plan', 'is', null)
                        .not('dodo_subscription_id', 'is', null);
                    const toRevoke = (dbSubs || []).filter(u =>
                        !isTest(u.email) && !activeSubIds.has(u.dodo_subscription_id)
                    );
                    if (toRevoke.length > 0) {
                        const revokeEmails = toRevoke.map(u => u.email);
                        await supabase.from('users')
                            .update({ subscription_plan: null, dodo_subscription_id: null, cancel_pending: false })
                            .in('email', revokeEmails);
                        summary.dodo_reconcile = { revoked: toRevoke.length, emails: revokeEmails };
                        console.log(`[cron:dodo_reconcile] 清除幽靈會員 ${toRevoke.length} 個:`, revokeEmails);
                    } else {
                        summary.dodo_reconcile = { revoked: 0 };
                    }

                    // 方向二：Dodo 顯示 active，但 DB 這期沒有對應的入帳紀錄 → 主動補發（catch webhook 漏接）
                    const repaired = [];
                    for (const sub of activeItems) {
                        const subEmail = (sub.customer?.email || sub.customer_email || '').toLowerCase().trim();
                        if (!subEmail || isTest(subEmail)) continue;
                        const periodStart = sub.current_period_start ? new Date(sub.current_period_start) : null;
                        const { data: u } = await supabase.from('users')
                            .select('subscription_plan, last_topup_at').eq('email', subEmail).maybeSingle();
                        // 沒有這個用戶、沒方案、或最後入帳時間早於本期開始（留 1 天緩衝防時區誤差）→ 判定可能漏接
                        const staleTopup = periodStart && (!u?.last_topup_at || new Date(u.last_topup_at) < new Date(periodStart.getTime() - 24 * 3600 * 1000));
                        if (u?.subscription_plan && !staleTopup) continue;
                        const { activated } = await reconcilePaymentsForEmail(supabase, subEmail, process.env.DODO_API_KEY);
                        if (activated) repaired.push(subEmail);
                    }
                    summary.dodo_missed_payment_repair = { checked: activeItems.length, repaired: repaired.length, emails: repaired };
                    if (repaired.length) console.warn(`[cron:dodo_reconcile] 主動補發漏接 webhook: ${repaired.length} 個`, repaired);
                }
            }
        } catch (e) { summary.dodo_reconcile_error = e.message; }

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

    // ── IG 聯名推廣獎勵（Admin 一鍵發放）─────────────────────────────────────────
    // order_id 用日期（非 timestamp）鎖同一用戶同一天只能發一次，靠 transactions.order_id
    // 的 UNIQUE 索引防呆，避免管理員手滑連點造成重複入帳。
    if (req.method === 'POST' && action === 'collab_reward') {
        const email = (req.body?.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return res.status(400).json({ code: -1, msg: 'Invalid email' });

        const { data: user, error: userErr } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
        if (userErr) return res.status(500).json({ code: -1, msg: userErr.message });
        if (!user) return res.status(404).json({ code: -1, msg: 'User not found' });

        const COLLAB_REWARD = 300;
        const orderId = `collab_${email}_${new Date().toISOString().slice(0, 10)}`;

        const { data: rpcData, error: rpcErr } = await supabase.rpc('apply_points_delta', {
            p_email: email, p_set_monthly: null, p_add_lifetime: COLLAB_REWARD, p_add_referral_count: 0
        });
        if (rpcErr || !rpcData?.success) {
            return res.status(500).json({ code: -1, msg: rpcErr?.message || rpcData?.error || 'RPC failed' });
        }

        const { error: txErr } = await supabase.from('transactions').insert({
            user_email: email, amount: COLLAB_REWARD, transaction_type: 'COLLAB_REWARD', order_id: orderId,
            metadata: { reason: 'ig_collab_admin_grant', granted_at: new Date().toISOString() },
        });
        if (txErr) {
            if (txErr.code === '23505') return res.status(409).json({ code: -1, msg: '今日已對此用戶發放過聯名獎勵' });
            console.error('[collab_reward:tx_insert_failed]', email, txErr.message);
        }

        return res.status(200).json({ code: 0, msg: 'Granted', email, amount: COLLAB_REWARD });
    }

    // ── Admin: 請求記錄日誌 ────────────────────────────────────────────────────
    if (action === 'request_log' && req.method === 'GET') {
        const limit = Math.min(parseInt(req.query.limit || '100'), 500);
        const emailFilter = (req.query.email || '').trim().toLowerCase();
        const typeFilter = req.query.type || 'all';
        const fromDate = (req.query.from || '').trim();
        const toDate   = (req.query.to   || '').trim();

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
        if (fromDate) q = q.gte('created_at', new Date(fromDate).toISOString());
        if (toDate)   q = q.lte('created_at', new Date(toDate + 'T23:59:59.999Z').toISOString());

        const { data, error } = await q;
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, logs: data || [] });
    }

    // ── Admin: 付款審計（webhook_errors + 異常用戶）────────────────────────────
    if (req.method === 'GET' && action === 'payment_audit') {
        return res.status(200).json({ code: 0, data: await paymentAudit(supabase, req.query) });
    }

    // ── Admin: 流失分析（退訂原因 + 挽留成功率 + 近期流失用戶）────────────────
    if (req.method === 'GET' && action === 'churn_stats') {
        const days = Math.min(parseInt(req.query.days || '30'), 365);
        return res.status(200).json({ code: 0, data: await churnStats(supabase, days) });
    }

    if (req.method === 'POST' && action === 'resolve_webhook_error') {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ code: -1, msg: 'Missing id' });
        const { error } = await supabase.from('webhook_errors').update({ resolved: true }).eq('id', id);
        if (error) return res.status(500).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0 });
    }

    const actions = { dashboard, users, revenue, renders, feedback, funnel, insights, vercel_traffic, mrr: mrrBreakdown, dodo_diff: dodoDiff, cron_daily_metrics };
    if (!actions[action]) return res.status(400).json({ code: -1, msg: `Unknown action: ${action}` });

    try {
        return res.status(200).json({ code: 0, data: await actions[action](supabase, req.query) });
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
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. 取得最近 30 天的每日聚合數據
    const { data: metrics } = await supabase.from('daily_metrics')
        .select('*')
        .gte('date', d30)
        .order('date', { ascending: true });

    // 2. 獲取總用戶數
    const { count: totalUsers } = await noTest(supabase.from('users').select('*', { count: 'exact', head: true }));

    // 3. 獲取 tool breakdown / style / resolution 仍維持抽樣查詢
    const { data: renders } = await noTestRef(supabase.from('render_history')
        .select('tool_id, style, resolution')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1000));

    let activeToday = 0;
    let active7d = 0;
    let totalRenders30d = 0;
    let revenue30d = 0;
    let cost30d = 0;
    let errorCount = 0;

    if (metrics && metrics.length > 0) {
        activeToday = metrics[metrics.length - 1].active_users || 0;
        active7d = metrics.slice(-7).reduce((acc, m) => acc + (m.active_users || 0), 0);
        totalRenders30d = metrics.reduce((acc, m) => acc + (m.total_renders || 0), 0);
        revenue30d = metrics.reduce((acc, m) => acc + ((m.revenue_usd_cents || 0) / 100), 0);
        cost30d = metrics.reduce((acc, m) => acc + ((m.cost_usd_cents || 0) / 100), 0);
        errorCount = metrics.reduce((acc, m) => acc + ((m.refund_usd_cents || 0) > 0 ? 1 : 0), 0);
    }

    const toolBreakdown = {};
    const styleBreakdown = {};
    const resBreakdown = {};

    (renders || []).forEach(r => {
        const tid = String(r.tool_id || 1);
        toolBreakdown[tid] = (toolBreakdown[tid] || 0) + 1;
        const style = r.style || 'unknown';
        styleBreakdown[style] = (styleBreakdown[style] || 0) + 1;
        const res = r.resolution || 'unknown';
        resBreakdown[res] = (resBreakdown[res] || 0) + 1;
    });

    return {
        total_users: totalUsers,
        active_today: activeToday,
        active_7d: active7d,
        renders_30d: totalRenders30d,
        revenue_30d: revenue30d,
        cost_30d: cost30d,
        paywall_hits_30d: 0,
        avg_rating: null,
        tool_breakdown: toolBreakdown,
        style_breakdown: styleBreakdown,
        resolution_breakdown: resBreakdown,
        error_count_30d: errorCount,
    };
}

// ── Admin: 用戶管理 ───────────────────────────────────────────────────────────
async function users(supabase, query = {}) {
    const d7  = daysAgo(7);
    const d30 = daysAgo(30);
    const fromDate    = query.from          ? new Date(query.from).toISOString()                          : null;
    const toDate      = query.to            ? new Date(query.to + 'T23:59:59.999Z').toISOString()         : null;
    const emailFilter = (query.email_filter || '').trim();
    const hasFilter   = fromDate || toDate || emailFilter;

    let userQ = noTest(supabase.from('users')
        .select('email, points, lifetime_points, subscription_plan, is_beta_tester, created_at, last_topup_at')
        .order(hasFilter ? 'created_at' : 'lifetime_points', { ascending: false })
        .limit(200));
    if (fromDate)    userQ = userQ.gte('created_at', fromDate);
    if (toDate)      userQ = userQ.lte('created_at', toDate);
    if (emailFilter) userQ = userQ.ilike('email', `%${emailFilter}%`);

    const [{ data: userRows }, { data: recentTx }, { data: allTopups }] = await Promise.all([
        userQ,
        noTestRef(supabase.from('transactions')
            .select('user_email, created_at')
            .gte('created_at', d30)
            .in('transaction_type', ['RENDER_1K', 'RENDER_2K', 'RENDER_4K', 'RENDER_360'])),
        noTestRef(supabase.from('transactions')
            .select('user_email, amount')
            .in('transaction_type', ['TOPUP_SINGLE', 'TOPUP_SUBSCRIPTION'])),
    ]);

    const active7dSet  = new Set((recentTx || []).filter(t => t.created_at >= d7).map(t => t.user_email));
    const active30dSet = new Set((recentTx || []).map(t => t.user_email));

    const purchaseTotals = {};
    (allTopups || []).forEach(t => { purchaseTotals[t.user_email] = (purchaseTotals[t.user_email] || 0) + (t.amount || 0); });

    // JS 二次過濾（防漏）
    const tagged = (userRows || [])
        .filter(u => !isTest(u.email))
        .map(u => ({ ...u, tier: getTier(u, active7dSet, active30dSet, purchaseTotals[u.email] || 0) }));

    return { users: tagged, total: tagged.length };
}

// ── Admin: 收入指標 ───────────────────────────────────────────────────────────
async function revenue(supabase) {
    const { data: payments } = await noTestRef(supabase
        .from('payments')
        .select('amount_usd_cents, created_at, user_email, status')
        .eq('status', 'paid')
        .gte('created_at', daysAgo(90))
        .order('created_at', { ascending: false }));

    const rows = (payments || []).filter(t => !isTest(t.user_email));
    const d30 = daysAgo(30);
    const revenue30d = rows.filter(t => t.created_at >= d30).reduce((s, t) => s + ((t.amount_usd_cents || 0) / 100), 0);
    const daily = groupByDate(rows);

    return { revenue_30d: revenue30d, daily_revenue: daily, total_topups_90d: rows.length };
}

// ── Admin: MRR 依方案拆分（用最近一筆訂閱扣款金額代表目前月費，避免用固定價目表猜錯）──
async function mrrBreakdown(supabase) {
    const { data: subUsers } = await supabase.from('users')
        .select('email, subscription_plan')
        .not('subscription_plan', 'is', null)
        .not('email', 'ilike', '%test%');

    const subs = (subUsers || []).filter(u => !isTest(u.email));
    if (!subs.length) return { total_mrr: 0, by_plan: {}, active_subscribers: 0 };

    const emails = subs.map(u => u.email);
    const { data: recentSubTxns } = await supabase.from('transactions')
        .select('user_email, amount_usd_cents, created_at')
        .eq('transaction_type', 'TOPUP_SUBSCRIPTION')
        .gte('created_at', daysAgo(35))
        .in('user_email', emails)
        .order('created_at', { ascending: false });

    // 每個用戶取最近一筆訂閱扣款金額，代表目前實際月費
    const latestAmount = {};
    (recentSubTxns || []).forEach(t => {
        if (!(t.user_email in latestAmount)) latestAmount[t.user_email] = (t.amount_usd_cents || 0) / 100;
    });

    const byPlan = {};
    let total = 0;
    subs.forEach(u => {
        const plan = u.subscription_plan;
        const amt = latestAmount[u.email] || 0;
        if (!byPlan[plan]) byPlan[plan] = { count: 0, mrr: 0 };
        byPlan[plan].count += 1;
        byPlan[plan].mrr += amt;
        total += amt;
    });
    Object.values(byPlan).forEach(v => { v.mrr = Math.round(v.mrr * 100) / 100; });

    return { total_mrr: Math.round(total * 100) / 100, by_plan: byPlan, active_subscribers: subs.length };
}

// ── Admin: Dodo 對帳快照（唯讀，不寫入任何資料，只給人看差異）──────────────
async function dodoDiff(supabase) {
    if (!process.env.DODO_API_KEY) return { configured: false };
    const dodoBase = process.env.DODO_API_KEY.startsWith('test_')
        ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';

    // Dodo API 分頁參數是 page_size（上限 100）+ page_number，不是 limit——
    // 用錯參數名會被忽略，靜默退回預設 page_size=10，導致只看到一小部分資料。
    let dodoItems = [];
    try {
        for (let page = 0; page < 10; page++) {
            const r = await fetch(`${dodoBase}/subscriptions?page_size=100&page_number=${page}`, {
                headers: { Authorization: `Bearer ${process.env.DODO_API_KEY}` }
            });
            if (!r.ok) return { configured: true, error: `Dodo API 回應 ${r.status}` };
            const items = (await r.json()).items || [];
            if (!items.length) break;
            dodoItems = dodoItems.concat(items);
            if (items.length < 100) break;
        }
    } catch (e) {
        return { configured: true, error: e.message };
    }

    const statusCounts = {};
    dodoItems.forEach(s => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });

    const { data: dbUsers } = await supabase.from('users')
        .select('email, subscription_plan, dodo_subscription_id, cancel_pending')
        .not('subscription_plan', 'is', null)
        .not('email', 'ilike', '%test%');
    const subs = (dbUsers || []).filter(u => !isTest(u.email));

    const dodoById = {};
    dodoItems.forEach(s => { dodoById[s.subscription_id || s.id] = s; });

    // DB 顯示有效方案，但 Dodo 端不是 active/trialing（可能是漏處理的取消/暫停，或 subscription_id 沒對上）
    const dbAheadOfDodo = subs.filter(u => {
        const d = dodoById[u.dodo_subscription_id];
        return !d || !['active', 'trialing'].includes(d.status);
    }).map(u => ({
        email: u.email,
        db_plan: u.subscription_plan,
        dodo_status: dodoById[u.dodo_subscription_id]?.status || 'not_found_in_dodo',
        cancel_pending: u.cancel_pending,
    }));

    // Dodo 顯示 active/trialing，但 DB 沒有對應有效方案（可能漏接 webhook）
    const dbByDodoId = {};
    subs.forEach(u => { if (u.dodo_subscription_id) dbByDodoId[u.dodo_subscription_id] = u; });
    const dodoAheadOfDb = dodoItems.filter(s =>
        ['active', 'trialing'].includes(s.status) && !dbByDodoId[s.subscription_id || s.id]
    ).map(s => ({
        dodo_subscription_id: s.subscription_id || s.id,
        status: s.status,
        email: s.customer?.email || s.customer_email || null,
    }));

    return {
        configured: true,
        dodo_total: dodoItems.length,
        dodo_status_counts: statusCounts,
        db_active_subscribers: subs.length,
        db_ahead_of_dodo: dbAheadOfDodo,
        dodo_ahead_of_db: dodoAheadOfDb,
    };
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
async function feedback(supabase, query = {}) {
    const fromDate = query.from ? new Date(query.from).toISOString()                  : null;
    const toDate   = query.to   ? new Date(query.to + 'T23:59:59.999Z').toISOString() : null;

    let fbQ = noTestRef(supabase.from('feedback')
        .select('user_email, type, rating, content, tags, created_at, metadata')
        .order('created_at', { ascending: false })
        .limit(200));
    if (fromDate) fbQ = fbQ.gte('created_at', fromDate);
    if (toDate)   fbQ = fbQ.lte('created_at', toDate);

    const [{ data: rows }, { data: ratingRows }] = await Promise.all([
        fbQ,
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
            .select('user_email, amount')
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
    const purchaseTotals = {};
    (topups || []).forEach(t => { purchaseTotals[t.user_email] = (purchaseTotals[t.user_email] || 0) + (t.amount || 0); });
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
    // 用歷史累計購買點數（非會遞減的 lifetime_points 餘額）判斷是否為重度付費用戶
    const highValue = users.filter(u => (purchaseTotals[u.email] || 0) > 100 && !u.subscription_plan);
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
    const kolList = users.filter(u => (purchaseTotals[u.email] || 0) > 80 && !u.subscription_plan && goodRatingUsers.has(u.email));
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

function getTier(user, active7dSet, active30dSet, totalPurchased = 0) {
    // lifetime_points 是「尚未花完的永久餘額」，會隨消費遞減，不能拿來判斷歷史消費量；
    // 改用 transactions 表的歷史累計購買點數（totalPurchased）判斷高價值用戶。
    if (totalPurchased > 500) return 'whale';
    if (user.subscription_plan) return 'subscriber';
    if (active7dSet.has(user.email)) return 'active';
    if (new Date(user.created_at) > new Date(daysAgo(7))) return 'new';
    if (!active30dSet.has(user.email)) return 'churned';
    return 'active';
}

// ── 付款審計 ──────────────────────────────────────────────────────────────────
async function paymentAudit(supabase, query = {}) {
    const webhookFrom   = (query.webhook_from || '').trim();
    const webhookTo     = (query.webhook_to   || '').trim();
    const showResolved  = query.show_resolved === 'true';
    const topupFrom     = (query.topup_from   || '').trim();
    const topupTo       = (query.topup_to     || '').trim();
    const hasTopupDate  = topupFrom || topupTo;

    let errQ = supabase.from('webhook_errors')
        .select('id, platform, event_type, order_id, customer_email, error_message, created_at, resolved')
        .order('created_at', { ascending: false })
        .limit(100);
    if (!showResolved) errQ = errQ.eq('resolved', false);
    if (webhookFrom) errQ = errQ.gte('created_at', new Date(webhookFrom).toISOString());
    if (webhookTo)   errQ = errQ.lte('created_at', new Date(webhookTo + 'T23:59:59.999Z').toISOString());

    let topupQ = supabase.from('transactions')
        .select('user_email, amount, order_id, transaction_type, created_at')
        .in('transaction_type', ['TOPUP_SUBSCRIPTION', 'TOPUP_SINGLE'])
        .order('created_at', { ascending: false })
        .limit(hasTopupDate ? 200 : 30);
    if (topupFrom) topupQ = topupQ.gte('created_at', new Date(topupFrom).toISOString());
    if (topupTo)   topupQ = topupQ.lte('created_at', new Date(topupTo + 'T23:59:59.999Z').toISOString());

    const [errRes, zeroRes, topupRes] = await Promise.all([
        errQ,
        // 有訂閱方案但 points = 0（可能漏發）
        supabase.from('users')
            .select('email, subscription_plan, points, lifetime_points, last_topup_at')
            .not('subscription_plan', 'is', null)
            .eq('points', 0)
            .not('email', 'ilike', '%test%')
            .limit(20),
        topupQ,
    ]);
    return {
        webhook_errors: {
            unresolved_count: errRes.data?.length || 0,
            items: errRes.data || [],
        },
        suspicious_users: zeroRes.data || [],
        recent_topups: topupRes.data || [],
    };
}

// ── 流失分析 ──────────────────────────────────────────────────────────────────
// 正確定義：「流失訂閱者」= 曾有 TOPUP_SUBSCRIPTION 交易，但現在 subscription_plan = null
// 不依賴 last_topup_at（那對單次充值用戶也會設定，無法區分）
async function churnStats(supabase, days = 30) {
    const dN  = new Date(Date.now() - days                       * 24 * 3600e3).toISOString();
    const d90 = new Date(Date.now() - Math.max(days * 3, 90)     * 24 * 3600e3).toISOString();
    const d30 = dN; // alias for backward-compat within this function

    const PLAN_CENTS = { 700: 'Starter', 1500: 'Pro', 3500: 'Studio' };

    // Step 1：並行查詢基礎數據
    const [activeRes, reasonsRes, retentionRes, pendingRes, subTxnRes] = await Promise.all([
        // 活躍訂閱者數
        supabase.from('users')
            .select('*', { count: 'exact', head: true })
            .not('subscription_plan', 'is', null)
            .not('email', 'ilike', '%test%'),
        // 退訂原因（feedback 表，走完取消流程才會寫入）
        supabase.from('feedback')
            .select('content, user_email, created_at')
            .eq('type', 'unsubscribe_reason')
            .order('created_at', { ascending: false })
            .limit(300),
        // 近 30 天挽留優惠接受
        supabase.from('transactions')
            .select('transaction_type, user_email, created_at')
            .in('transaction_type', ['RETENTION_BONUS', 'RETENTION_PAUSE'])
            .gte('created_at', d30),
        // 待取消用戶（已申請、待週期末執行）
        supabase.from('users')
            .select('email, subscription_plan, last_topup_at')
            .eq('cancel_pending', true)
            .not('email', 'ilike', '%test%')
            .limit(50),
        // 近 90 天 TOPUP_SUBSCRIPTION 交易（用於精確判斷誰是「曾訂閱者」）
        supabase.from('transactions')
            .select('user_email, created_at, amount_usd_cents')
            .eq('transaction_type', 'TOPUP_SUBSCRIPTION')
            .gte('created_at', d90)
            .order('created_at', { ascending: false })
            .limit(600),
    ]);

    // Step 2：從 TOPUP_SUBSCRIPTION 推算每個訂閱用戶的最後付款時間與方案
    const emailLatest = {};
    (subTxnRes.data || []).forEach(t => {
        if (!emailLatest[t.user_email] || t.created_at > emailLatest[t.user_email].at) {
            emailLatest[t.user_email] = { at: t.created_at, cents: t.amount_usd_cents };
        }
    });
    const subEmails = Object.keys(emailLatest);

    // Step 3：查這些曾訂閱用戶的當前狀態，找出 subscription_plan = null 的（流失）
    let churnedList = [];
    if (subEmails.length > 0) {
        const batchSize = 200;
        let allChurned = [];
        for (let i = 0; i < subEmails.length; i += batchSize) {
            const batch = subEmails.slice(i, i + batchSize);
            const { data } = await supabase.from('users')
                .select('email, subscription_plan, last_topup_at')
                .in('email', batch)
                .is('subscription_plan', null)
                .not('email', 'ilike', '%test%');
            allChurned = allChurned.concat(data || []);
        }
        churnedList = allChurned.map(u => ({
            email: u.email,
            last_sub_at: emailLatest[u.email]?.at,
            plan: PLAN_CENTS[emailLatest[u.email]?.cents] || '未知',
        })).sort((a, b) => (b.last_sub_at || '').localeCompare(a.last_sub_at || ''));
    }

    const churned30d = churnedList.filter(u => (u.last_sub_at || '') >= d30);

    // Step 4：為流失用戶附上退訂原因（如果有走完取消流程）
    const reasonByEmail = {};
    (reasonsRes.data || []).forEach(r => { if (!reasonByEmail[r.user_email]) reasonByEmail[r.user_email] = r.content; });
    const churnedWithContext = churned30d.map(u => ({ ...u, cancel_reason: reasonByEmail[u.email] || null }));

    // 退訂原因分佈
    function groupByReason(arr) {
        const map = {};
        arr.forEach(r => { map[r.content] = (map[r.content] || 0) + 1; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
    }

    const allReasons = reasonsRes.data || [];
    const reasons30d = allReasons.filter(r => r.created_at >= d30);
    const retention = retentionRes.data || [];
    const discountAccepted = retention.filter(t => t.transaction_type === 'RETENTION_BONUS').length;
    const pauseAccepted = retention.filter(t => t.transaction_type === 'RETENTION_PAUSE').length;

    // 挽留成功率 = 接受挽留 / (接受挽留 + 實際流失)，分母基於近 30 天
    const retentionDenom = discountAccepted + pauseAccepted + churned30d.length;
    const retentionRate = retentionDenom > 0
        ? Math.round((discountAccepted + pauseAccepted) / retentionDenom * 100)
        : 0;

    return {
        days,
        active_subscribers: activeRes.count || 0,
        churned_30d: churned30d.length,
        churned_90d: churnedList.length,
        reason_breakdown_all: groupByReason(allReasons),
        reason_breakdown_30d: groupByReason(reasons30d),
        reason_records_total: allReasons.length,
        discount_accepted_30d: discountAccepted,
        pause_accepted_30d: pauseAccepted,
        retention_rate_30d: retentionRate,
        cancel_pending_users: pendingRes.data || [],
        churned_users_30d: churnedWithContext,
    };
}

// ── 每日數據聚合 Cron Job (Phase 2) ───────────────────────────────────────────────────────────
async function cron_daily_metrics(supabase) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // 1. 抓取昨日的所有 users 活躍數 (依賴 last_active_at)
    const { count: activeUsers } = await supabase.from('users')
        .select('*', { count: 'exact', head: true })
        .gte('last_active_at', yesterday + 'T00:00:00Z')
        .lt('last_active_at', yesterday + 'T23:59:59Z');
        
    // 2. 抓取昨日新註冊用戶
    const { count: newUsers } = await supabase.from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday + 'T00:00:00Z')
        .lt('created_at', yesterday + 'T23:59:59Z');
        
    // 3. 抓取昨日的所有 payments 營收 (真實金流)
    const { data: payments } = await supabase.from('payments')
        .select('amount_usd_cents, status')
        .gte('created_at', yesterday + 'T00:00:00Z')
        .lt('created_at', yesterday + 'T23:59:59Z');
        
    let revenue_usd_cents = 0;
    let refund_usd_cents = 0;
    (payments || []).forEach(p => {
        if (p.status === 'paid') revenue_usd_cents += p.amount_usd_cents;
        if (p.status === 'refunded' || p.status === 'chargeback') refund_usd_cents += p.amount_usd_cents;
    });

    // 4. 抓取昨日的真實成本 (從 render_history 抓 API 花費)
    const { data: renders } = await supabase.from('render_history')
        .select('provider_cost_usd_cents')
        .gte('created_at', yesterday + 'T00:00:00Z')
        .lt('created_at', yesterday + 'T23:59:59Z');
        
    const total_renders = (renders || []).length;
    let cost_usd_cents = 0;
    (renders || []).forEach(r => {
        cost_usd_cents += (r.provider_cost_usd_cents || 0);
    });

    // 寫入 daily_metrics
    const row = {
        date: yesterday,
        active_users: activeUsers || 0,
        total_renders,
        revenue_usd_cents,
        refund_usd_cents,
        cost_usd_cents,
        new_users: newUsers || 0,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('daily_metrics').upsert(row, { onConflict: 'date' });
    if (error) return { success: false, error: error.message };
    return { success: true, date: yesterday, metrics: row };
}
