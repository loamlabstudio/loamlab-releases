import { createClient } from '@supabase/supabase-js';
import { PRICING_CONFIG } from '../config.js';

export const maxDuration = 300; // Allow Vercel to run up to 5 minutes to poll AtlasCloud

// Node 18+ 內建 fetch，無需 require('node-fetch')

function sanitizeError(msg) {
    if (!msg || typeof msg !== 'string') return msg;
    // 隱藏技術棧字眼
    return msg
        .replace(/AtlasCloud API error/gi, 'AI 渲染引擎錯誤')
        .replace(/api\.atlascloud\.ai/gi, 'ai-render-gateway')
        .replace(/atlascloud\.ai/gi, 'ai-render-gateway')
        .replace(/AtlasCloud/gi, 'AI 渲染引擎')
        .replace(/ATLASCLOUD_API_KEY/g, '渲染引擎金鑰')
        .replace(/openai\/gpt-image-2\/edit/gi, 'AI-Renderer-Vision')
        .replace(/gpt-image-2/gi, 'AI-Renderer-Vision')
        .replace(/openai/gi, 'AI')
        .replace(/nano-banana-2\/edit/gi, 'AI-Renderer-Pro')
        .replace(/nano-banana/gi, 'AI-Engine')
        .replace(/google\/nano-banana-2\/edit/gi, 'AI-Renderer-Pro')
        .replace(/google/gi, 'AI')
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, '[TOKEN]')
        .replace(/https?:\/\/api\.[^\s"']+/g, '[API_ENDPOINT]');
}

// ── 模型適配器登錄表：新增模型只需加一條 entry ──
// key = AtlasCloud model ID 前綴；value = (images, prompt, res) => 參數物件
const MODEL_ADAPTERS = {
    'openai/gpt-image-2': (images, prompt, res) => {
        const qualityMap = { '1k': 'low', '2k': 'medium', '4k': 'high' };
        return { images, prompt, quality: qualityMap[res] || 'medium', size: '1536x1024' };
    },
    'google/nano-banana': (images, prompt, res) => ({
        images, prompt, resolution: res, aspect_ratio: '16:9', output_format: 'jpeg'
    })
};

function buildAtlasReqBody(model, images, prompt, resolution) {
    const adapterKey = Object.keys(MODEL_ADAPTERS).find(k => model.startsWith(k));
    const adapter = MODEL_ADAPTERS[adapterKey] || MODEL_ADAPTERS['google/nano-banana'];
    return { model, ...adapter(images, prompt, resolution) };
}

// 全域快取：存放 Promise 避免同一瞬間併發的多個相同翻譯請求重複扣除 API 額度
const translationPromises = new Map();

// ── Gemini 翻譯 helper（有 CJK 字元 + API Key 才翻，否則原值回傳）──
async function translateValues(valuesObj) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return valuesObj;
    const hasCJK = Object.values(valuesObj).some(v => /[\u4e00-\u9fff\u3040-\u30ff]/.test(String(v)));
    if (!hasCJK) return valuesObj;

    const cacheKey = 'obj_' + JSON.stringify(valuesObj);
    if (translationPromises.has(cacheKey)) {
        return await translationPromises.get(cacheKey);
    }

    const promise = (async () => {
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text:
                    `Translate these interior design/photography descriptions to professional English. Output ONLY a valid JSON object with identical keys and English values. No explanations.\n\n${JSON.stringify(valuesObj)}`
                  }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } }) }
            );
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const m = text.match(/\{[\s\S]*\}/);
            if (m) return JSON.parse(m[0]);
        } catch(e) { /* fallback: 回傳原值 */ }
        return valuesObj;
    })();

    translationPromises.set(cacheKey, promise);
    if (translationPromises.size > 100) translationPromises.delete(translationPromises.keys().next().value);
    
    return await promise;
}

// ── 單字串翻譯（有 CJK 才翻；失敗靜默降級返回原文）──
async function translateToEnglish(text) {
    if (!text || !text.trim()) return text;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return text;
    if (!/[\u4e00-\u9fff\u3040-\u30ff]/.test(text)) return text;

    const cacheKey = 'str_' + text;
    if (translationPromises.has(cacheKey)) {
        return await translationPromises.get(cacheKey);
    }

    const promise = (async () => {
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text:
                    `Translate the following interior design description to professional English. Output ONLY the translated text, no explanations.\n\n${text}`
                  }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 512 } }) }
            );
            const data = await resp.json();
            const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (translated) return translated;
        } catch(e) { /* 靜默降級 */ }
        return text;
    })();

    translationPromises.set(cacheKey, promise);
    if (translationPromises.size > 100) translationPromises.delete(translationPromises.keys().next().value);
    
    return await promise;
}

export default async function handler(req, res) {
    try { return await _handleRender(req, res); }
    catch (fatal) {
        console.error('[render] uncaught fatal:', fatal?.message || fatal);
        if (!res.headersSent) res.status(500).json({ code: -1, msg: `伺服器內部錯誤，請稍後再試。(${fatal?.message?.slice(0,80) || 'unknown'})` });
    }
}
async function _handleRender(req, res) {
    // 1. 允許跨域請求 (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email, X-Plugin-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET /api/render?action=get_360&id=<uuid>  — 360 viewer 取得圖片 URL
    // GET /api/render?action=cleanup_360&key=<ADMIN_KEY> — 刪除 7 天前的全景圖（供 cron 呼叫）
    if (req.method === 'GET') {
        const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
        const action = qs.get('action');

        if (action === 'get_360') {
            const shareId = qs.get('id') || '';
            if (!/^[0-9a-f-]{36}$/i.test(shareId)) {
                return res.status(400).json({ code: -1, msg: 'Invalid share ID' });
            }
            const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/pano-360/${shareId}`;
            const faceNames = ['back', 'front', 'top', 'bottom', 'right', 'left'];
            // Priority: URL params sc/sn (embedded at share time) → meta.json → flat-path fallback (old shares)
            let nScenes = 1;
            let sceneNames = ['全景分享'];
            const scParam = parseInt(qs.get('sc') || '0');
            const snParam = qs.get('sn') || '';
            if (scParam >= 1 && snParam) {
                nScenes = Math.min(scParam, 20);
                sceneNames = decodeURIComponent(snParam).split('|').filter(Boolean);
                const scenes = [];
                for (let i = 0; i < nScenes; i++) {
                    const faces = Object.fromEntries(faceNames.map(f => [f, `${base}/${i}/${f}.jpg`]));
                    scenes.push({ name: sceneNames[i] || `場景 ${i + 1}`, faces });
                }
                return res.status(200).json({ code: 0, scenes });
            }
            // Detect storage layout: new indexed (${shareId}/0/back.jpg) vs old flat (${shareId}/back.jpg)
            let useFlatPath = false;
            try {
                const checkResp = await fetch(`${base}/0/back.jpg`, { method: 'HEAD' });
                if (!checkResp.ok) useFlatPath = true;
            } catch(e) { /* network error — assume indexed */ }
            if (useFlatPath) {
                // Legacy single-scene flat-path upload
                const faces = Object.fromEntries(faceNames.map(f => [f, `${base}/${f}.jpg`]));
                return res.status(200).json({ code: 0, scenes: [{ name: '全景分享', faces }] });
            }
            // New indexed layout: try meta.json for scene count/names
            try {
                const metaResp = await fetch(`${base}/meta.json`);
                if (metaResp.ok) {
                    const meta = await metaResp.json();
                    nScenes = Math.max(1, meta.scene_count || 1);
                    sceneNames = meta.scene_names || sceneNames;
                }
            } catch(e) { /* fallback to single scene */ }
            const scenes = [];
            for (let i = 0; i < nScenes; i++) {
                const faces = Object.fromEntries(faceNames.map(f => [f, `${base}/${i}/${f}.jpg`]));
                scenes.push({ name: sceneNames[i] || `場景 ${i + 1}`, faces });
            }
            return res.status(200).json({ code: 0, scenes });
        }

        if (action === 'init_360_upload') {
            const userEmail = (req.headers['x-user-email'] || '').trim();
            if (!userEmail) return res.status(200).json({ code: -1, msg: '未登入' });
            // Parse scene names (URL-encoded, comma-separated)
            const sceneNamesHeader = (req.headers['x-scene-names'] || '').trim();
            const sceneNames = sceneNamesHeader
                ? sceneNamesHeader.split(',').map(s => { try { return decodeURIComponent(s); } catch(e) { return s; } }).filter(Boolean)
                : ['全景分享'];
            const nScenes = Math.min(sceneNames.length, 10);
            const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            const { data: user } = await supa.from('users').select('points, lifetime_points').eq('email', userEmail).single();
            const totalPoints = (user?.points || 0) + (user?.lifetime_points || 0);
            if (!user || totalPoints < 5) {
                return res.status(200).json({ code: -1, msg: `點數不足（需要 5 點，目前 ${totalPoints} 點）` });
            }
            // 原子扣款（在建 URL 前扣，避免 finalize 多一次 RTT）
            const { data: deductResult, error: deductErr } = await supa.rpc('deduct_render_points', { p_email: userEmail, p_cost: 5 });
            if (deductErr || !deductResult?.success) {
                const msg = deductResult?.error === 'insufficient_points'
                    ? `點數不足，餘額 ${deductResult.balance} 點`
                    : (deductErr?.message || '點數扣除失敗，請稍後再試');
                return res.status(200).json({ code: -1, msg });
            }
            const supaAdmin = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
            );
            const { randomUUID } = await import('node:crypto');
            const shareId = randomUUID();
            const faceNames = ['back', 'front', 'top', 'bottom', 'right', 'left'];
            // 並行產生 nScenes×6 個簽名 URL + 1 個 meta.json URL
            const uploadTasks = [];
            for (let si = 0; si < nScenes; si++) {
                for (const face of faceNames) {
                    uploadTasks.push({ si, face, path: `${shareId}/${si}/${face}.jpg` });
                }
            }
            const [faceUrlResults, metaUrlResult] = await Promise.all([
                Promise.all(uploadTasks.map(t => supaAdmin.storage.from('pano-360').createSignedUploadUrl(t.path))),
                supaAdmin.storage.from('pano-360').createSignedUploadUrl(`${shareId}/meta.json`)
            ]);
            const failedFace = faceUrlResults.find(r => r.error);
            if (failedFace) return res.status(200).json({ code: -1, msg: `簽名失敗: ${failedFace.error.message}` });
            if (metaUrlResult.error) return res.status(200).json({ code: -1, msg: `meta 簽名失敗: ${metaUrlResult.error.message}` });
            // Build upload_urls: { "0": { "back": url, ... }, "1": {...}, ... }
            const uploadUrls = {};
            for (let i = 0; i < uploadTasks.length; i++) {
                const { si, face } = uploadTasks[i];
                if (!uploadUrls[si]) uploadUrls[si] = {};
                uploadUrls[si][face] = faceUrlResults[i].data.signedUrl;
            }
            // Embed scene metadata in URL so viewer doesn't depend on meta.json availability
            const snEncoded = encodeURIComponent(sceneNames.slice(0, nScenes).join('|'));
            const shareUrl = `https://loamlab-camera-backend.vercel.app/360-viewer.html?id=${shareId}&sc=${nScenes}&sn=${snEncoded}`;
            return res.status(200).json({
                code: 0, share_id: shareId, upload_urls: uploadUrls,
                meta_url: metaUrlResult.data.signedUrl,
                scene_names: sceneNames.slice(0, nScenes),
                share_url: shareUrl, points_remaining: deductResult.balance
            });
        }

        // All-in-One HTML 單文件上傳：扣款 + 返回 1 個簽名 URL
        if (action === 'init_360_single_upload') {
            const userEmail = (req.headers['x-user-email'] || '').trim();
            if (!userEmail) return res.status(200).json({ code: -1, msg: '未登入' });
            const COST_360 = 5;
            const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            const { data: user360s } = await supa.from('users').select('points, lifetime_points').eq('email', userEmail).single();
            const totalPts = (user360s?.points || 0) + (user360s?.lifetime_points || 0);
            if (!user360s || totalPts < COST_360) {
                return res.status(200).json({ code: -1, msg: `點數不足（需要 ${COST_360} 點，目前 ${totalPts} 點）` });
            }
            const { data: deductS, error: deductSErr } = await supa.rpc('deduct_render_points', { p_email: userEmail, p_cost: COST_360 });
            if (deductSErr || !deductS?.success) {
                const msg = deductS?.error === 'insufficient_points'
                    ? `點數不足，餘額 ${deductS.balance} 點`
                    : (deductSErr?.message || '點數扣除失敗，請稍後再試');
                return res.status(200).json({ code: -1, msg });
            }
            const supaAdmin = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
            );
            const { randomUUID } = await import('node:crypto');
            const shareId = randomUUID();
            const htmlPath = `${shareId}/viewer.html`;
            const { data: urlData, error: urlErr } = await supaAdmin.storage
                .from('pano-360').createSignedUploadUrl(htmlPath);
            if (urlErr) {
                // 退款
                try { await supa.rpc('deduct_render_points', { p_email: userEmail, p_cost: -COST_360 }); } catch(e) {}
                return res.status(200).json({ code: -1, msg: `簽名失敗: ${urlErr.message}` });
            }
            // 公開 URL 直接作為 share URL（pano-360 bucket 為 public）
            const shareUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/pano-360/${htmlPath}`;
            return res.status(200).json({
                code: 0, share_id: shareId,
                upload_url: urlData.signedUrl,
                share_url: shareUrl,
                points_remaining: deductS.balance
            });
        }

        if (action === 'cleanup_360') {
            if (qs.get('key') !== process.env.ADMIN_KEY) {
                return res.status(401).json({ code: -1, msg: 'Unauthorized' });
            }
            const supa = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
            );
            const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const { data: folders } = await supa.storage.from('pano-360').list('', { limit: 1000 });
            if (!folders) return res.status(200).json({ code: 0, deleted: 0 });

            let deleted = 0;
            for (const folder of folders) {
                if (new Date(folder.created_at) < cutoff) {
                    const { data: files } = await supa.storage.from('pano-360').list(folder.name, { limit: 10 });
                    if (files && files.length) {
                        await supa.storage.from('pano-360').remove(files.map(f => `${folder.name}/${f.name}`));
                    }
                    deleted++;
                }
            }
            console.log(`[cleanup_360] deleted ${deleted} expired panoramas`);
            return res.status(200).json({ code: 0, deleted });
        }

        return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
    }

    // 環境變數
    const COZE_PAT = process.env.COZE_PAT;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    if (!COZE_PAT || !SUPABASE_URL || !SUPABASE_KEY) {
        let missing = [];
        if (!COZE_PAT) missing.push('COZE_PAT');
        if (!SUPABASE_URL) missing.push('SUPABASE_URL');
        if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY');
        return res.status(500).json({ code: -1, msg: sanitizeError(`伺服器設定不完整：Vercel 說他找不到這幾把鑰匙 ${missing.join(', ')}。請確認已 Redeploy 過。`) });
    }

    // 從 Header 取得 SketchUp 用戶信箱與插件版本
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) {
        return res.status(401).json({ code: -1, msg: '請求被拒絕：未提供使用者信箱 (X-User-Email)' });
    }
    const pluginVersion = req.headers['x-plugin-version'] || null;

    // 建立 Supabase 資料庫連線 (優先使用 Service Role 以確保具備管理權限並繞過 RLS)
    const supabaseKeyToUse = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
    const supabase = createClient(SUPABASE_URL, supabaseKeyToUse);

    // IP Pinning 驗證：防止 API 偽造 (Spoofing)
    // fail-open：DB 不可達時不攔截請求（避免 DB 網路抖動導致所有用戶無法渲染）
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (clientIp !== 'unknown') {
        try {
            const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', userEmail).maybeSingle();
            if (!userRow || !userRow.last_login_ip || userRow.last_login_ip !== clientIp) {
                return res.status(401).json({ code: -1, msg: '登入憑證已過期或網路環境發生變更。為保障您的點數安全，請在外掛首頁重新點擊登入以驗證身分。' });
            }
        } catch (ipErr) {
            console.warn('[render] IP check DB error, proceeding:', ipErr?.message);
        }
    }

    const supabaseAdmin = supabase; // 相容於舊代碼中的 supabaseAdmin 參考
    let tempStorageFile = null; // 渲染後自動刪除的暫存圖路徑
    const cleanTemp = async () => {
        if (tempStorageFile && supabaseAdmin) {
            try { await supabaseAdmin.storage.from('render-temp').remove([tempStorageFile]); } catch(e) {}
        }
    };

    const userPayload = req.body || {};
    const activeTool = userPayload.tool || 1;

    // 360 全景雲端上傳（early return，不走渲染流程）
    if (userPayload.action === 'upload_360') {
        const COST_360 = 5;
        const faces = userPayload.faces || {};
        const faceNames = ['back', 'front', 'top', 'bottom', 'right', 'left'];
        if (!faceNames.every(n => faces[n])) {
            return res.status(200).json({ code: -1, msg: '全景圖不完整，請重新截圖' });
        }
        let { data: user } = await supabase.from('users').select('points, lifetime_points').eq('email', userEmail).single();
        if (!user || user.points < COST_360) {
            return res.status(200).json({ code: -1, msg: `點數不足（需要 ${COST_360} 點，目前 ${user?.points ?? 0} 點）` });
        }
        const { error: deductErr } = await supabase.from('users').update({
            points: user.points - COST_360,
            lifetime_points: (user.lifetime_points || 0) + COST_360
        }).eq('email', userEmail);
        if (deductErr) return res.status(200).json({ code: -1, msg: '點數扣除失敗，請稍後再試' });
        try {
            const { randomUUID } = await import('node:crypto');
            const shareId = randomUUID();
            for (const name of faceNames) {
                const b64 = faces[name].replace(/^data:image\/\w+;base64,/, '');
                const buf = Buffer.from(b64, 'base64');
                const { error: upErr } = await supabaseAdmin.storage
                    .from('pano-360').upload(`${shareId}/${name}.jpg`, buf, { contentType: 'image/jpeg' });
                if (upErr) throw new Error(`${name}: ${upErr.message}`);
            }
            const shareUrl = `https://loamlab-camera-backend.vercel.app/360-viewer.html?id=${shareId}`;
            return res.status(200).json({ code: 0, share_url: shareUrl, points_remaining: user.points - COST_360 });
        } catch (e) {
            await supabase.from('users').update({ points: user.points }).eq('email', userEmail).catch(() => {});
            return res.status(200).json({ code: -1, msg: `上傳失敗：${e.message}` });
        }
    }

    if (userPayload.action === 'finalize_360_upload') {
        const shareId = (userPayload.share_id || '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(shareId)) {
            return res.status(200).json({ code: -1, msg: 'Invalid share ID' });
        }
        const COST_360 = 5;
        let { data: user360 } = await supabase.from('users').select('points, lifetime_points').eq('email', userEmail).single();
        const totalPoints360 = (user360?.points || 0) + (user360?.lifetime_points || 0);
        if (!user360 || totalPoints360 < COST_360) {
            return res.status(200).json({ code: -1, msg: `點數不足（需要 ${COST_360} 點，目前 ${totalPoints360} 點）` });
        }
        const { data: deductResult360, error: deductErr360 } = await supabase.rpc('deduct_render_points', { p_email: userEmail, p_cost: COST_360 });
        if (deductErr360 || !deductResult360?.success) {
            const errMsg = deductResult360?.error === 'insufficient_points'
                ? `點數不足，餘額 ${deductResult360.balance} 點`
                : (deductErr360?.message || '點數扣除失敗，請稍後再試');
            return res.status(200).json({ code: -1, msg: errMsg });
        }
        const shareUrl = `https://loamlab-camera-backend.vercel.app/360-viewer.html?id=${shareId}`;
        return res.status(200).json({ code: 0, share_url: shareUrl, points_remaining: deductResult360.balance });
    }

    // 記錄原始輸入 URL（僅保存穩定的外部 URL，不保存 base64 或臨時簽名 URL）
    let inputUrlForHistory = null;
    const _firstInputImg = userPayload.parameters?.image?.[0];
    if (_firstInputImg && _firstInputImg.startsWith('http') && !_firstInputImg.includes('supabase.co')) {
        inputUrlForHistory = _firstInputImg;
    }

    // 整理 payload：統一 prompt 欄位，相容新版 JS (傳 user_prompt) 與舊版 Ruby (傳 prompt)
    if (userPayload.parameters) {
        const rawPrompt = (userPayload.parameters.user_prompt || userPayload.parameters.prompt || "").trim();
        userPayload.parameters.user_prompt = rawPrompt; // Coze Python 節點讀取
        userPayload.parameters.prompt = rawPrompt;       // 相容 Coze workflow 宣告的必填欄位
    }

    // 動態解析消耗點數 (從 resolution 欄位判斷，大小寫皆相容)
    const resVal = (userPayload.parameters?.resolution || '').toLowerCase();
    let cost = PRICING_CONFIG.render_costs['1k']; // 預設 1K
    if (resVal.includes('4k')) cost = PRICING_CONFIG.render_costs['4k'];
    else if (resVal.includes('2k')) cost = PRICING_CONFIG.render_costs['2k'];

    // 2. 查詢帳戶點數與方案等級
    let { data: user, error: dbErr } = await supabase
        .from('users')
        .select('points, lifetime_points, subscription_plan')
        .eq('email', userEmail)
        .single();

    // [Beta 試運營] 零門檻：如果算圖時用戶還不存在，則自動註冊
    if (dbErr && dbErr.code === 'PGRST116') {
        const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{
                email: userEmail,
                points: 60,
                referral_code: newReferralCode
            }])
            .select()
            .single();

        if (insertError) {
            return res.status(500).json({ code: -1, msg: sanitizeError(`自動註冊失敗: ${insertError.message}`) });
        }
        user = newUser;
    } else if (dbErr) {
        return res.status(403).json({ code: -1, msg: sanitizeError(`帳戶查詢失敗: ${dbErr.message}`) });
    }

    if (!user) {
        return res.status(403).json({ code: -1, msg: '帳戶不存在且自動註冊失敗。' });
    }

    // 解析度特權檢查：Starter / Top-up / 無訂閱 → 最高 2K
    const PLAN_MAX_RES = { starter: '2k', pro: '4k', studio: '4k' };
    const userPlan = user.subscription_plan || null;
    const maxRes = PLAN_MAX_RES[userPlan] ?? '2k';
    if (resVal.includes('4k') && maxRes === '2k') {
        return res.status(403).json({
            code: -1,
            error: 'resolution_limit',
            msg: '4K renders require a Pro or Studio plan. Please upgrade.',
            points_refunded: false
        });
    }

    // 3. 原子扣款（Supabase RPC，FOR UPDATE 鎖列，防止並發 Race Condition）
    const { data: deductResult, error: deductErr } = await supabase.rpc('deduct_render_points', {
        p_email: userEmail,
        p_cost: cost
    });

    if (deductErr) {
        return res.status(500).json({ code: -1, msg: sanitizeError(`系統錯誤：扣款失敗 ${deductErr.message}`) });
    }
    if (!deductResult?.success) {
        if (deductResult?.error === 'insufficient_points') {
            return res.status(402).json({ code: -1, msg: sanitizeError(`點數不足！本次渲染需 ${cost} 點，您的餘額僅剩 ${deductResult.balance} 點。`) });
        }
        return res.status(403).json({ code: -1, msg: sanitizeError(`扣款失敗：${deductResult?.error}`) });
    }

    // ★ 修復：用 try/catch 包裹交易紀錄，避免因 transactions 表不存在而崩潰主流程
    let transactionId = null;
    try {
        const txType = cost === PRICING_CONFIG.render_costs['4k'] ? 'RENDER_4K' : (cost === PRICING_CONFIG.render_costs['2k'] ? 'RENDER_2K' : 'RENDER_1K');
        const { data: txData } = await supabase.from('transactions').insert([{
            user_email: userEmail,
            amount: -cost,
            transaction_type: txType,
            metadata: { plugin_version: pluginVersion, resolution: resVal }
        }]).select('id').single();
        if (txData) transactionId = txData.id;
    } catch (txErr) {
        console.warn('[交易日誌] 紀錄失敗（不中斷主流程）:', txErr.message);
    }

    // 4. 解析圖片並代為上傳至 Supabase Storage（私有暫存，渲染後自動刪除）
    let imageUrls = userPayload.parameters?.image;
    if (imageUrls && imageUrls.length > 0 && imageUrls[0].startsWith('data:image')) {
        try {
            if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY 未設定，無法安全上傳圖片');
            const base64Data = imageUrls[0].split(',')[1] || imageUrls[0];
            const imgBuffer = Buffer.from(base64Data, 'base64');
            const fileName = `tmp/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
            await supabaseAdmin.storage.createBucket('render-temp', { public: false }).catch(() => {});
            const { error: upErr } = await supabaseAdmin.storage
                .from('render-temp')
                .upload(fileName, imgBuffer, { contentType: 'image/jpeg' });
            if (upErr) throw new Error(`Storage 上傳失敗: ${upErr.message}`);
            const { data: signedData, error: signErr } = await supabaseAdmin.storage
                .from('render-temp')
                .createSignedUrl(fileName, 3600);
            if (signErr || !signedData?.signedUrl) throw new Error('簽名 URL 生成失敗');
            userPayload.parameters.image = [signedData.signedUrl];
            tempStorageFile = fileName;
        } catch (uploadErr) {
            try { await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail); } catch(e) {}
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_UPLOAD_FAIL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: sanitizeError(`圖床代傳失敗: ${uploadErr.message}`), points_refunded: true });
        }
    }

    // 5. 處理圖片與提取參數
    let tempBase = null, tempRef = null;
    const tempRefImages = [];
    const cleanTemp2 = async () => {
        const paths = [tempBase, tempRef, ...tempRefImages].filter(Boolean);
        if (paths.length && supabaseAdmin) {
            try { await supabaseAdmin.storage.from('render-temp').remove(paths); } catch(e) {}
        }
    };

    let originalImageUrl = '';
    let baseForCoze = ''; // (實際上是供 AtlasCloud 使用)
    const refImageUrls = [];
    const userPrompt = (userPayload.parameters?.user_prompt || userPayload.parameters?.prompt || '').trim();

    try {
        if (activeTool === 2) {
            const baseImageB64 = userPayload.parameters?.base_image;
            const baseImageUrlPayload = userPayload.parameters?.base_image_url || '';
            const originalImageB64 = userPayload.parameters?.original_image_b64;
            originalImageUrl = userPayload.parameters?.original_image_url || '';
            
            if (!baseImageB64 && !baseImageUrlPayload) throw new Error('base_image 未提供');

            // 原始底圖
            if (originalImageB64 && !originalImageUrl) {
                const cleanOrig = originalImageB64.replace(/^data:image\/\w+;base64,/, '');
                if (supabaseAdmin) {
                    await supabaseAdmin.storage.createBucket('render-temp', { public: false }).catch(() => {});
                    const origName = `tmp/${Date.now()}_orig_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upOrig } = await supabaseAdmin.storage.from('render-temp').upload(origName, Buffer.from(cleanOrig, 'base64'), { contentType: 'image/jpeg' });
                    if (!upOrig) {
                        tempRef = origName;
                        const { data: origSign } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(origName, 3600);
                        if (origSign?.signedUrl) originalImageUrl = origSign.signedUrl;
                    }
                }
                // Fallback：Storage 不可用時直接用 base64 data URL（AtlasCloud 支援）
                if (!originalImageUrl) originalImageUrl = originalImageB64;
            }

            // 合成疊加圖 (Mask)
            baseForCoze = baseImageUrlPayload;
            if (baseImageB64) {
                if (supabaseAdmin) {
                    const cleanB64 = baseImageB64.replace(/^data:image\/\w+;base64,/, '');
                    const baseName = `tmp/${Date.now()}_base_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upBase } = await supabaseAdmin.storage.from('render-temp').upload(baseName, Buffer.from(cleanB64, 'base64'), { contentType: 'image/jpeg' });
                    if (upBase) throw new Error(`底圖上傳失敗: ${upBase.message}`);
                    tempBase = baseName;
                    const { data: baseSign } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(baseName, 3600);
                    baseForCoze = baseSign?.signedUrl || '';
                } else {
                    // Fallback：Storage 不可用時直接用 base64 data URL（AtlasCloud 支援）
                    baseForCoze = baseImageB64;
                }
            }

            // 用戶的上傳參考圖
            const refImagesB64 = (userPayload.parameters?.ref_images || []).filter(Boolean);
            for (const b64 of refImagesB64) {
                if (supabaseAdmin) {
                    const clean = b64.replace(/^data:image\/\w+;base64,/, '');
                    const fname = `tmp/${Date.now()}_ref_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upRef } = await supabaseAdmin.storage.from('render-temp').upload(fname, Buffer.from(clean, 'base64'), { contentType: 'image/jpeg' });
                    if (!upRef) {
                        tempRefImages.push(fname);
                        const { data: s } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(fname, 3600);
                        if (s?.signedUrl) refImageUrls.push(s.signedUrl);
                    }
                } else {
                    // Fallback：直接用 base64 data URL
                    refImageUrls.push(b64);
                }
            }
        }

        // ==========================================
        // 從 Supabase 取得動態工作流設定 (若無則套用預設)
        // ==========================================
        let systemPrompts = {};
        try {
            const pRes = await supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_PROMPTS').order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (pRes.data) systemPrompts = pRes.data.metadata?.prompts || {};
        } catch(e) {}

        let toolModelMap = {};
        try {
            const mRes = await supabase.from('transactions').select('metadata').eq('transaction_type', 'MODEL_CONFIG').order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (mRes.data?.metadata?.models) toolModelMap = mRes.data.metadata.models;
        } catch(e) {}

        // ── Prompt Engine Mode（nodes | legacy）──
        let promptEngineMode = 'nodes';
        try {
            const eRes = await supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_ENGINE_CONFIG').order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (eRes.data?.metadata?.config?.prompt_engine_mode) promptEngineMode = eRes.data.metadata.config.prompt_engine_mode;
        } catch(e) {}

        const defaultP1 = "SketchUp interior model (Image 1). Backend pre-generates a spatial depth map (Image 2) and a color-segmented channel map (Image 3). Using Image 1 with reference to Images 2 and 3, restore 99% of spatial depth, camera position, and material texture direction without altering geometry or materials. Convert to a realistic interior photo. Apply natural lighting with supplemental diffuse fill to eliminate pure-black shadows and overexposure. Rationalize minor spatial inconsistencies. Professional photography-grade color grading with natural tonal gradation. ultra-detailed";
        const defaultP2 = "Edit IMAGE 1 (the original scene photo) by replacing materials/objects as specified below.\nIMAGE 2 shows the same scene overlaid with ARTIFICIAL NEON MARKER COLORS (magenta, cyan, lime, red, yellow, etc.) — these are PURELY spatial location indicators and have ZERO relation to the target appearance. CRITICAL: The final output must contain ABSOLUTELY NO trace of these neon marker colors. Ignore all color information from IMAGE 2 entirely.\n{{REF_TEXT}}\nChanges:\n{{CHANGES}}\n\nStrict Guidelines:\n① Final result must be based on IMAGE 1, appearing as a natural, original photograph — never based on IMAGE 2's colors or tones\n② Perspective & Proportion: Render all objects from IMAGE 1's camera angle; do not use the reference photo's original angle\n③ Lighting & Color Temperature: Strictly follow IMAGE 1's light direction, intensity, shadows and color temperature; remove all color casts from IMAGE 2\n④ Boundary Control: Stay mainly within marked zones; minor edge feathering allowed for seamless blending; do not affect unrelated surfaces\n⑤ Realism & Aesthetics: Replaced objects must have realistic materials, correct scale, and blend harmoniously into the original space";
        const defaultP3 = "Based on the uploaded reference image, generate a single high-quality 3x3 interior visualization collage in exact 1:1 square aspect ratio. Output only the clean collage - no text, no titles, no watermarks, no borders, no labels.\nHighest priority: Faithfully extract and reproduce all details from the reference image, including material textures, light and shadow characteristics, color tones, object qualities, and unique atmosphere. All 9 panels must maintain the exact same spatial structure, furniture layout, and lighting direction. Accurate perspective with zero distortion or shifting.\n3x3 Mixed Grid Layout:\nTop Row Left: Left 45 wide long shot showing the full spatial layout and depth\nTop Row Center: Exact same viewpoint and framing as the uploaded reference image (visual anchor)\nTop Row Right: Close-up detail 1 - highly faithful reproduction of material textures and craftsmanship from the reference image\nMiddle Row Left: Medium shot focusing on main furniture arrangement and functional area, preserving the original light and shadow atmosphere\nMiddle Row Center: Close-up detail 2 - emphasizing light and shadow interaction and surface qualities from the reference image\nMiddle Row Right: Right 45 wide long shot showing the other side of the space\nBottom Row Left: Close-up detail 3 - faithfully presenting another dimension of details from the reference image (e.g., decorative elements, corner craftsmanship, or material contrast)\nBottom Row Center: Medium shot from an alternative angle showing spatial transparency and overall atmosphere, faithful to the original tone\nBottom Row Right: Balanced medium shot concluding with overall harmony and high-end quality\n\nTechnical Requirements:\nStrictly faithful to the reference image's materials, lighting, colors, and fine details; 8K ultra-high resolution with extreme detail; photorealistic material rendering with accurate reflections, refractions, and micro-surface details; professional multi-layer lighting; cinematic color grading with sophisticated, soft, and luxurious tones; extremely sharp, clean, noise-free, and distortion-free.\nGenerate a single cohesive 3x3 collage with strong visual rhythm and dramatic scale contrast, while perfectly capturing the unique details and atmosphere of the reference image.";
        
        const p1 = systemPrompts.TOOL_1 || defaultP1;
        const p2 = systemPrompts.TOOL_2 || defaultP2;
        const p3 = systemPrompts.TOOL_3 || defaultP3;
        const defaultBatchNodes = {
            img1_key: "Image 1 [PRIMARY OUTPUT BASIS]",
            img1: "SketchUp scene — every spatial element in the output (room layout, all furniture, all objects, all surfaces, camera viewpoint, geometry, proportions) must originate exclusively from Image 1.",
            img2_key: "Image 2 [STYLE EXTRACTION ONLY]",
            img2: "Lighting reference photo — extract ONLY: light direction, color temperature (Kelvin), warmth/coolness ratio, shadow softness, and highlight quality.",
            forbidden_key: "FORBIDDEN from Image 2",
            forbidden: "Any furniture, object, surface, wall, floor, architecture, or spatial arrangement from Image 2 must NOT appear in the output.",
            apply_key: "Apply",
            apply: "Image 2's photographic lighting quality and color tone onto Image 1's existing scene.",
            output_must_be_key: "Output must be",
            output_must_be: "A realistic photo of Image 1's exact spatial layout and objects — lit and color-graded to match Image 2's atmosphere.",
            never_key: "Never",
            never: "Blend, composite, or merge spatial content from both images."
        };
        const batchNodes = systemPrompts.TOOL_1_BATCH_NODES
            ? (() => { try { return JSON.parse(systemPrompts.TOOL_1_BATCH_NODES); } catch(e) { return {}; } })()
            : {};

        // ── 進階節點配置 (T1 Nodes) ──
        let t1Nodes = [];
        try {
            const nRes = await supabase.from('transactions').select('metadata').eq('transaction_type', 'SYSTEM_T1_NODES').order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (nRes.data?.metadata?.nodes) t1Nodes = nRes.data.metadata.nodes;
        } catch(e) {}

        // Method B：提前取得風格參考 URL（需在 finalPrompt 組裝前宣告）
        const styleRefUrl = (userPayload.parameters?.style_ref_url || '').trim();

        // ── 提示詞組裝 ──
        let finalPrompt = "";
        let finalModel = toolModelMap[`tool${activeTool}`] || 'google/nano-banana-2/edit';

        if (activeTool === 2) {
            const translatedPrompt2 = await translateToEnglish(userPrompt);
            let changes = [];
            for (const part of (translatedPrompt2 || "").split(';')) {
                const p = part.trim();
                if (p.includes(': ')) {
                    const spl = p.split(/: (.+)/);
                    if (spl[0] && spl[1]) {
                        changes.push(`Zone Color (HEX): ${spl[0].trim()}\n  Target Object: ${spl[1].trim()}`);
                    }
                }
            }
            if (changes.length === 0) {
                finalPrompt = "Enhance this interior design photo naturally with realistic, high-end visual quality.";
            } else {
                const hasRefs = refImageUrls.length >= 1;
                const refText = hasRefs ? "IMAGE 3+ are reference objects: use only their shape, style and form; match lighting to IMAGE 1's environment.\n" : "";
                finalPrompt = p2.replace("{{REF_TEXT}}", refText).replace("{{CHANGES}}", changes.join('\n'));
            }
        } else if (activeTool === 3) {
            const translatedPrompt3 = await translateToEnglish(userPrompt);
            finalPrompt = translatedPrompt3.trim() ? p3 + ", " + translatedPrompt3 : p3;
        } else {
            // Tool 1: 嚴格 JSON 結構組裝（legacy mode 跳過節點直接拼接）
            const adv = userPayload.advanced_settings || {};
            const d = defaultBatchNodes;
            const bn = batchNodes;
            const legacyImageRoles = `${bn.img1_key || d.img1_key}: ${bn.img1 || d.img1} ${bn.img2_key || d.img2_key}: ${bn.img2 || d.img2} ${bn.forbidden_key || d.forbidden_key}: ${bn.forbidden || d.forbidden}`;
            const legacyStyleNote = styleRefUrl ? ` Apply ${bn.apply || d.apply} Output must be: ${bn.output_must_be || d.output_must_be} Never: ${bn.never || d.never}` : "";

            if (promptEngineMode !== 'legacy' && t1Nodes.length > 0) {
                // Nodes 模式：JSON 結構化提示詞
                // 1. 收集所有值（system 節點用 node.value，用戶節點用 adv[node.id]；userPrompt 一同納入翻譯）
                const rawValues = {};
                if (userPrompt.trim()) rawValues['__userPrompt__'] = userPrompt.trim();
                t1Nodes.forEach(node => {
                    const val = node.system ? (node.value || '') : (adv[node.id] || node.default || '');
                    if (val.toString().trim()) rawValues[node.id] = val.toString().trim();
                });
                // 用戶自訂材質節點：_usr_<名稱> = 材質值，與系統節點同層 flat key
                const userMatNodes = Object.keys(adv)
                    .filter(k => k.startsWith('_usr_'))
                    .map(k => ({ label: k.slice(5), value: adv[k] }))
                    .filter(m => m.label && m.value?.trim());
                userMatNodes.forEach((m, i) => {
                    if (m.label?.trim()) rawValues[`__umat_${i}_label`] = m.label.trim();
                    if (m.value?.trim()) rawValues[`__umat_${i}_value`] = m.value.trim();
                });
                // 2. Gemini 翻譯（有 CJK 才翻，無 API Key 則原值）
                const translatedValues = await translateValues(rawValues);
                const translatedUserPrompt = translatedValues['__userPrompt__'] || userPrompt.trim();

                // 3. 建構 JSON 結構
                const GROUP_CONFIG = {
                    core_constraints: 'Core Constraints',
                    scene_lighting:   'Scene & Lighting',
                    materials:        'Material Control',
                    photography:      'Photography Settings',
                    rendering:        'Render Quality'
                };
                const jsonPrompt = {};
                const projectType = translatedValues['project_type'] || '';
                jsonPrompt['Project'] = `SU Screenshot to Realistic Photography${projectType ? ' - ' + projectType : ''}${translatedUserPrompt ? ' - ' + translatedUserPrompt : ''}`;

                Object.entries(GROUP_CONFIG).forEach(([group, title]) => {
                    const section = {};
                    t1Nodes.filter(n => n.group === group).forEach(node => {
                        const val = translatedValues[node.id];
                        if (val) section[node.labels?.['en-US'] || node.id] = val;
                    });
                    // 3b. 自訂材質節點與 Material Control 同批次建構，確保 JSON 結構一致
                    if (group === 'materials' && userMatNodes.length > 0) {
                        userMatNodes.forEach((m, i) => {
                            const key = translatedValues[`__umat_${i}_label`] || m.label;
                            const val = translatedValues[`__umat_${i}_value`] || m.value;
                            if (key && val?.trim()) section[key] = val.trim();
                        });
                    }
                    if (Object.keys(section).length > 0) jsonPrompt[title] = section;
                });

                // 4. 批量出圖風格一致性附加（巢狀 JSON 物件，避免字串化）
                if (styleRefUrl) {
                    const bn = batchNodes;
                    const d = defaultBatchNodes;
                    jsonPrompt['Image Roles'] = {
                        [bn.img1_key || d.img1_key]: bn.img1 || d.img1,
                        [bn.img2_key || d.img2_key]: bn.img2 || d.img2,
                        [bn.forbidden_key || d.forbidden_key]: bn.forbidden || d.forbidden
                    };
                    jsonPrompt['Style Consistency'] = {
                        [bn.apply_key || d.apply_key]: bn.apply || d.apply,
                        [bn.output_must_be_key || d.output_must_be_key]: bn.output_must_be || d.output_must_be,
                        [bn.never_key || d.never_key]: bn.never || d.never
                    };
                }

                finalPrompt = JSON.stringify(jsonPrompt, null, 2);
            } else {
                // Legacy 模式 或 無節點 fallback：傳統拼接（翻譯後拼接）
                const translatedPrompt1 = await translateToEnglish(userPrompt);
                const legacyBatchPrefix = styleRefUrl ? " " + legacyImageRoles + legacyStyleNote : "";
                finalPrompt = translatedPrompt1.trim() ? p1 + legacyBatchPrefix + ", " + translatedPrompt1 : p1 + legacyBatchPrefix;
            }
        }

        // ==========================================
        // 呼叫 AtlasCloud (取代 Coze)
        // ==========================================
        const ATLASCLOUD_API_KEY = process.env.ATLASCLOUD_API_KEY;
        if (!ATLASCLOUD_API_KEY) throw new Error("渲染引擎金鑰未設定，請聯繫管理員。");

        const resolutionMap = { '1k': '1k', '1K': '1k', '2k': '2k', '2K': '2k', '4k': '4k', '4K': '4k' };
        const resVal = userPayload.parameters?.resolution || userPayload.resolution || '1k';

        // 收集要傳送給 AtlasCloud 的影像
        let allImagesStrArray = [];
        if (activeTool === 2) {
            allImagesStrArray = [originalImageUrl, baseForCoze, ...refImageUrls];
        } else {
            allImagesStrArray = userPayload.parameters?.image || [];
            // Method B：若有風格參考 URL，附加在截圖之後作為第二張圖
            if (styleRefUrl) {
                allImagesStrArray = [...allImagesStrArray, styleRefUrl];
            }
        }

        // 將所有參考圖片確保為 URL 或 base64 data URL 容錯機制
        const atlasImages = allImagesStrArray.filter(Boolean).map(img => {
            if (img.startsWith('http')) return img;
            if (img.startsWith('data:image')) return img;
            return `data:image/jpeg;base64,${img}`;
        });

        const normalizedRes = resolutionMap[resVal] || '2k';
        const reqBody = buildAtlasReqBody(finalModel, atlasImages, finalPrompt, normalizedRes);

        const response = await fetch('https://api.atlascloud.ai/api/v1/model/generateImage', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ATLASCLOUD_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`AtlasCloud API error: ${response.status} - ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        let finalUrl = data?.data?.image_url || data?.data?.images?.[0] || null;

        if (!finalUrl && data?.data?.id) {
            const taskId = data.data.id;
            console.log('[AtlasCloud] Task started async, polling ID:', taskId);
            const pollUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${taskId}`;
            
            let attempts = 0;
            while (attempts < 40 && !finalUrl) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 3000));
                try {
                    const pRes = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${ATLASCLOUD_API_KEY}` } });
                    if (pRes.status === 200) {
                        const pData = await pRes.json();
                        // support multiple potential finished states
                        const state = (pData?.data?.state || pData?.data?.status || '').toLowerCase();
                        if (state === 'succeeded' || state === 'completed' || pData?.data?.outputs) {
                            finalUrl = pData.data.outputs?.[0] || pData.data.image_url || pData.data.images?.[0];
                            break;
                        } else if (state === 'failed' || state === 'error') {
                            throw new Error(`AtlasCloud task failed: ${pData?.data?.error || 'unknown error'}`);
                        }
                    }
                } catch(e) {
                    console.error('[Polling Error]', e.message);
                }
            }
        }

        console.log('[AtlasCloud] finalUrl:', finalUrl);

        await cleanTemp2();
        await cleanTemp();

        if (finalUrl) {
            saveRenderHistory(supabase, { userEmail, url: finalUrl, userPayload, resVal, cost, activeTool, inputUrl: inputUrlForHistory });
            return res.status(200).json({ code: 0, url: finalUrl, points_deducted: cost, points_remaining: user.points + user.lifetime_points, transaction_id: transactionId });
        } else {
            try { await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail); } catch(e) {}
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NO_URL' }]); } catch(e) {}
            console.error('[render] no_url response:', JSON.stringify(data).slice(0, 200));
            return res.status(500).json({ code: -1, msg: '出圖完成但結果未返回，請稍後再試。', points_refunded: true });
        }
    } catch (apiError) {
        await cleanTemp2().catch(() => {});
        await cleanTemp().catch(() => {});
        try { await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail); } catch(e) {}
        try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NETWORK_ERROR' }]); } catch(e) {}
        return res.status(500).json({ code: -1, msg: sanitizeError(apiError?.message || '渲染失敗，請稍後再試。'), points_refunded: true });
    }
}

// 非同步寫入渲染歷史（fire-and-forget，不阻塞回應）
function saveRenderHistory(supabase, { userEmail, url, userPayload, resVal, cost, activeTool, inputUrl }) {
    const prompt = userPayload.parameters?.user_prompt || userPayload.parameters?.prompt || '';
    const style  = userPayload.parameters?.style || '';
    supabase.from('render_history').insert([{
        user_email:    userEmail,
        input_url:     inputUrl || null,
        full_url:      url,
        thumbnail_url: url,
        prompt,
        style,
        resolution:    resVal || '1k',
        tool_id:       activeTool || 1,
        points_cost:   cost
    }]).then(({ error }) => {
        if (error) console.error('[render_history] save failed:', error.message);
    });
}
