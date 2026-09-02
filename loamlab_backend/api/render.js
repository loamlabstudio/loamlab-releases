import { createClient } from '@supabase/supabase-js';
import { PRICING_CONFIG, INITIAL_POINTS } from '../config.js';
import { isValidAdminKey } from '../lib/safeCompare.js';
import { getClientIp } from '../lib/net.js';
import { resolveUserEmail } from '../lib/verifyIdentity.js';
import { getConfig } from '../lib/systemConfig.js';
import { reportUsageEvent } from '../lib/dodo.js';
import { grantFreeReferralReward, makeSupabase } from '../lib/activate.js';
import { DEFAULT_PROMPTS, DEFAULT_BATCH_NODES } from '../lib/defaultPrompts.js';

export const maxDuration = 300; // 提示詞翻譯/圖片代傳等前置作業可能耗時；AtlasCloud 生成本身已改為非同步 task_id，不在此函式內等待

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
        .replace(/https?:\/\/api\.[^\s"']+/g, '[API_ENDPOINT]')
        .replace(/supabase/gi, '資料庫服務')
        .replace(/dodopayments?/gi, '金流服務商')
        .replace(/\bvercel\b/gi, '伺服器');
}

// 使用者自訂提示詞清洗（T4 Injection 防護）。
// 只做兩件事：①剝除控制字元（保留 \t \n \r，其餘 C0/DEL 拿掉，防止用不可見字元
// 破壞下游 payload 或日誌）②壓上限長度。
// 刻意「不」跳脫引號 / JSON 保留字元——user_prompt 是在 JSON.stringify() 之後才以
// 純文字附加到 prompt 尾端（見 buildNodesModePrompt / Tool 2、3 組裝），根本不在
// JSON 結構內，跳脫反而會把正常內容弄壞（例：使用者寫 `"oak" table`）。
function sanitizeUserPrompt(raw) {
    if (raw == null) return '';
    let s = typeof raw === 'string' ? raw : String(raw);
    s = Array.from(s).filter(c => { const n = c.charCodeAt(0); return n > 31 ? n !== 127 : (n === 9 || n === 10 || n === 13); }).join('');
    if (s.length > 4000) s = s.slice(0, 4000);
    return s.trim();
}

// ── 模型適配器登錄表：新增模型只需加一條 entry ──
// key = AtlasCloud model ID 前綴；value = (images, prompt, res) => 參數物件
const MODEL_ADAPTERS = {
    'openai/gpt-image-2': (images, prompt, res) => {
        const qualityMap = { '1k': 'low', '2k': 'medium', '4k': 'high' };
        return { images, prompt, quality: qualityMap[res] || 'medium', size: '1536x1024' };
    },
    'google/nano-banana': (images, prompt, res, activeTool, aspectRatio) => ({
        images, prompt, resolution: res,
        // T1/T3 對齊 gpt-image-2 的 3:2 固定尺寸（1536x1024），三工具出圖比例一致
        aspect_ratio: activeTool === 2 ? (aspectRatio || '16:9') : '3:2',
        output_format: 'jpeg'
    }),
    // ByteDance Seedream 用「WIDTH*HEIGHT」像素字串，不吃 resolution/aspect_ratio；
    // 三檔像素預算對齊官方文件範例（1024x1024 / ~1536x1536 / 2048x2048）
    'bytedance/seedream': (images, prompt, res, activeTool, aspectRatio) => {
        const ratio = activeTool === 2 ? (aspectRatio || '16:9') : '3:2';
        const sizeStr = seedreamSize(res, ratio);
        const [w, h] = sizeStr.split('*').map(Number);
        return {
            images, prompt,
            image_size: { width: w, height: h },
            output_format: 'jpeg'
        };
    }
};

const SEEDREAM_PIXEL_BUDGET = { '1k': 1048576, '2k': 2359296, '4k': 4194304 };
function seedreamSize(res, ratio) {
    const [rw, rh] = ratio.split(':').map(Number);
    const budget = SEEDREAM_PIXEL_BUDGET[res] || SEEDREAM_PIXEL_BUDGET['2k'];
    const r = rw / rh;
    const h = Math.round(Math.sqrt(budget / r) / 8) * 8;
    const w = Math.round((h * r) / 8) * 8;
    return `${w}*${h}`;
}

function buildAtlasReqBody(model, images, prompt, resolution, activeTool, aspectRatio) {
    const adapterKey = Object.keys(MODEL_ADAPTERS).find(k => model.startsWith(k));
    const adapter = MODEL_ADAPTERS[adapterKey] || MODEL_ADAPTERS['google/nano-banana'];
    return { model, ...adapter(images, prompt, resolution, activeTool, aspectRatio) };
}

// sceneImages 為索引 0，styleRefUrl（參考圖）緊接在後，確保引擎以場景為空間主體
function buildImagePayload(sceneImages, styleRefUrl) {
    if (!styleRefUrl) return sceneImages;
    return [...sceneImages, styleRefUrl];
}

// 沒有 runtime 翻譯：官方節點文字在 admin.html 編輯階段就用免費的 Google Translate
// 網頁版端點（瀏覽器端直接呼叫，無金鑰無費用，見 admin.html 的 _gtTranslate）翻好、
// 存檔，render.js 只管照存好的 value 原樣送出，不再多打一次 API。

// 結構性 JSON key 的預設值（英文）——admin.html 可在「結構標籤」區塊個別覆蓋並翻譯，
// 未設定時 fallback 到這裡，行為與改動前一致。
const DEFAULT_STRUCTURE_LABELS = {
    image_roles_key: 'Image Roles',
    style_consistency_key: 'Style Consistency',
    project_key: 'Project',
    project_prefix: 'SU Screenshot to Realistic Photography',
    node_key_locale: 'en-US', // 每個節點 JSON key 要用 node.labels 裡的哪個語系
    group_titles: {
        core_constraints: 'Core Constraints',
        scene_lighting:   'Scene & Lighting',
        materials:        'Material Control',
        photography:      'Photography Settings',
        rendering:        'Render Quality'
    }
};

// Tool 1 Nodes 模式的 JSON 提示詞組裝——唯一版本，正式渲染與 admin.html 的 Prompt Preview
// 都呼叫這裡，避免兩邊各寫一份邏輯又不小心兜不起來（先前發生過一次）。
async function buildNodesModePrompt(t1Nodes, batchNodes, defaultBatchNodes, adv, styleRefUrl, userPrompt, structureLabels) {
    const sl = { ...DEFAULT_STRUCTURE_LABELS, ...(structureLabels || {}) };
    const groupTitles = { ...DEFAULT_STRUCTURE_LABELS.group_titles, ...(sl.group_titles || {}) };

    // 1. 收集系統/管理員節點值——admin.html 編輯階段已用免費翻譯把文字轉成想要的語言存好，
    //    這裡直接照存好的原樣使用，不再另外翻譯
    const adminValues = {};
    t1Nodes.forEach(node => {
        const val = node.system ? (node.value || '') : (adv[node.id] || node.default || '');
        if (val.toString().trim()) adminValues[node.id] = val.toString().trim();
    });
    // 用戶自訂材質節點：_usr_<名稱> = 材質值，翻譯後才附加，保持原語言
    const userMatNodes = Object.keys(adv)
        .filter(k => k.startsWith('_usr_'))
        .map(k => ({ label: k.slice(5), value: adv[k] }))
        .filter(m => m.label && m.value?.trim());

    // 2. 建構「官方」JSON 結構（結構 key + 管理員節點值，不含任何用戶輸入）
    const officialPrompt = {};
    const projectType = adminValues['project_type'] || '';

    // 2b. 批量出圖：Image Roles / Style Consistency 前置，最大化模型約束力。
    //     留白邏輯：以「值（value）」為準——admin 把某條的內容清空（""）就代表不要這條
    //     約束，該條整行從 JSON 剔除；只有「從未設定過」（undefined）才 fallback 到
    //     defaultPrompts.js 的預設值。key（那串固定標籤）留著不影響剔除判斷。
    if (styleRefUrl) {
        const bn = batchNodes || {};
        const d = defaultBatchNodes || {};
        // 值：undefined → 用預設；"" 或有內容 → 照 admin 存的
        const val = (userVal, defVal) => userVal !== undefined ? userVal : defVal;
        // key：admin 清掉標籤時退回預設標籤，避免 JSON 出現空字串 key
        const key = (userKey, defKey) => (userKey !== undefined && userKey !== '') ? userKey : defKey;
        const put = (obj, uKey, dKey, uVal, dVal) => {
            const v = val(uVal, dVal);
            if (v !== undefined && v !== '') obj[key(uKey, dKey)] = v;
        };

        const imageRoles = {};
        put(imageRoles, bn.img1_key, d.img1_key, bn.img1, d.img1);
        put(imageRoles, bn.img2_key, d.img2_key, bn.img2, d.img2);
        put(imageRoles, bn.forbidden_key, d.forbidden_key, bn.forbidden, d.forbidden);
        if (Object.keys(imageRoles).length > 0) {
            officialPrompt[sl.image_roles_key] = imageRoles;
        }

        const styleConsistency = {};
        put(styleConsistency, bn.apply_key, d.apply_key, bn.apply, d.apply);
        put(styleConsistency, bn.output_must_be_key, d.output_must_be_key, bn.output_must_be, d.output_must_be);
        put(styleConsistency, bn.never_key, d.never_key, bn.never, d.never);
        if (Object.keys(styleConsistency).length > 0) {
            officialPrompt[sl.style_consistency_key] = styleConsistency;
        }
    }

    officialPrompt[sl.project_key] = `${sl.project_prefix}${projectType ? ' - ' + projectType : ''}`;

    const keyLocale = sl.node_key_locale || 'en-US';
    Object.entries(groupTitles).forEach(([group, title]) => {
        const section = {};
        t1Nodes.filter(n => n.group === group).forEach(node => {
            const val = adminValues[node.id];
            if (val) section[node.labels?.[keyLocale] || node.labels?.['en-US'] || node.id] = val;
        });
        if (Object.keys(section).length > 0) officialPrompt[title] = section;
    });

    // 3. 用戶自訂內容附加在官方內容之後，保持原語言原樣送出
    const translatedPrompt = officialPrompt;
    if (userMatNodes.length > 0) {
        translatedPrompt['User Materials'] = {};
        userMatNodes.forEach(m => { translatedPrompt['User Materials'][m.label] = m.value; });
    }

    return JSON.stringify(translatedPrompt, null, 2)
        + ((userPrompt || '').trim() ? `\n\nUser instructions (keep as-is, do not translate): ${userPrompt.trim()}` : '');
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
            const userEmail = ((await resolveUserEmail(req)).email || '').trim();
            if (!userEmail) return res.status(200).json({ code: -1, msg: '未登入' });
            // Parse scene names (URL-encoded, comma-separated)
            const sceneNamesHeader = (req.headers['x-scene-names'] || '').trim();
            const sceneNames = sceneNamesHeader
                ? sceneNamesHeader.split(',').map(s => { try { return decodeURIComponent(s); } catch(e) { return s; } }).filter(Boolean)
                : ['全景分享'];
            const nScenes = Math.min(sceneNames.length, 10);
            const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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
            try {
                await supa.from('transactions').insert([{ user_email: userEmail, amount: 0, transaction_type: 'RENDER_360', metadata: { resolution: '360', tool_id: 4 } }]);
                await supa.from('render_history').insert([{ user_email: userEmail, input_url: null, full_url: shareUrl, thumbnail_url: shareUrl, prompt: '', style: '360', resolution: '360', tool_id: 4, points_cost: 0 }]);
            } catch(e) {}
            return res.status(200).json({
                code: 0, share_id: shareId, upload_urls: uploadUrls,
                meta_url: metaUrlResult.data.signedUrl,
                scene_names: sceneNames.slice(0, nScenes),
                share_url: shareUrl
            });
        }

        // All-in-One HTML 單文件上傳：完全免費（不呼叫 AtlasCloud，只是把既有截圖包成可分享連結，
        // 我方零 API 成本）→ 返回 1 個簽名 URL，不扣款、不觸發免費層邀請獎勵（同一個理由：零成本
        // 若還能換取點數或獎勵，就是現成的刷分捷徑）
        if (action === 'init_360_single_upload') {
            const userEmail = ((await resolveUserEmail(req)).email || '').trim();
            if (!userEmail) return res.status(200).json({ code: -1, msg: '未登入' });
            const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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
                return res.status(200).json({ code: -1, msg: `簽名失敗: ${urlErr.message}` });
            }
            // 公開 URL 直接作為 share URL（pano-360 bucket 為 public）
            const shareUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/pano-360/${htmlPath}`;
            let balance360 = null;
            try {
                await supa.from('transactions').insert([{ user_email: userEmail, amount: 0, transaction_type: 'RENDER_360', metadata: { resolution: '360', tool_id: 4 } }]);
                await supa.from('render_history').insert([{ user_email: userEmail, input_url: null, full_url: shareUrl, thumbnail_url: shareUrl, prompt: '', style: '360', resolution: '360', tool_id: 4, points_cost: 0 }]);
                const { data: uRow } = await supa.from('users').select('points, lifetime_points').eq('email', userEmail).single();
                if (uRow) balance360 = (uRow.points || 0) + (uRow.lifetime_points || 0);
            } catch(e) {}
            return res.status(200).json({
                code: 0, share_id: shareId,
                upload_url: urlData.signedUrl,
                share_url: shareUrl,
                points_remaining: balance360
            });
        }

        if (action === 'cleanup_360') {
            if (!isValidAdminKey(qs.get('key'))) {
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

    // admin.html Prompt Preview 專用：不扣點、不打 AtlasCloud，直接重用正式渲染同一套
    // buildNodesModePrompt()，保證預覽永遠等於實際送出的內容。
    // t1_nodes/batch_nodes 全部由前端當下（可能還沒存檔）的即時狀態帶過來，不從 Supabase
    // 重讀——admin 編輯到一半、還沒按存檔時，預覽也要跟著動。
    if (req.body?.action === 'preview_prompt') {
        const authHeader = req.headers['authorization'] || '';
        const adminKeyFromHeader = authHeader.replace(/^Bearer\s+/i, '');
        if (!isValidAdminKey(adminKeyFromHeader)) {
            return res.status(401).json({ code: -1, msg: 'Unauthorized' });
        }
        try {
            const t1Nodes = Array.isArray(req.body.t1_nodes) ? req.body.t1_nodes : [];
            const batchNodes = req.body.batch_nodes && typeof req.body.batch_nodes === 'object' ? req.body.batch_nodes : {};
            const structureLabels = req.body.structure_labels && typeof req.body.structure_labels === 'object' ? req.body.structure_labels : {};
            const defaultBatchNodes = DEFAULT_BATCH_NODES;
            const withRef = await buildNodesModePrompt(t1Nodes, batchNodes, defaultBatchNodes, {}, 'preview-style-ref-placeholder', '', structureLabels);
            const withoutRef = await buildNodesModePrompt(t1Nodes, batchNodes, defaultBatchNodes, {}, '', '', structureLabels);
            return res.status(200).json({ code: 0, with_ref: withRef, without_ref: withoutRef });
        } catch (e) {
            return res.status(500).json({ code: -1, msg: `Preview 失敗: ${e.message}` });
        }
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

    // 身份解析：優先驗證 Authorization Bearer token（登入時 Supabase 簽發，無法偽造）；
    // 舊版插件沒有帶 token 時退回 X-User-Email + IP pinning（行為與升級前相同）
    const { email: userEmail, verified: emailVerified } = await resolveUserEmail(req);
    if (!userEmail) {
        return res.status(401).json({ code: -1, msg: '請求被拒絕：未提供使用者信箱 (X-User-Email)' });
    }
    const pluginVersion = req.headers['x-plugin-version'] || null;

    // 建立 Supabase 資料庫連線 (優先使用 Service Role 以確保具備管理權限並繞過 RLS)
    const supabaseKeyToUse = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
    const supabase = createClient(SUPABASE_URL, supabaseKeyToUse);

    // IP Pinning 驗證：防止 API 偽造 (Spoofing)——僅在身份「未經 token 驗證」時才需要這道防線
    // fail-open：DB 不可達時不攔截請求（避免 DB 網路抖動導致所有用戶無法渲染）
    const clientIp = getClientIp(req);
    if (!emailVerified && clientIp !== 'unknown') {
        try {
            const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', userEmail).maybeSingle();
            // 僅當 last_login_ip 已記錄且與當前 IP 不符時拒絕（null 表示舊版用戶未記錄，不擋）
            if (userRow?.last_login_ip && userRow.last_login_ip !== clientIp) {
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

    // 360 單機匯出統計（免費，僅紀錄）
    if (userPayload.action === 'track_360_local') {
        try {
            await supabase.from('transactions').insert([{ user_email: userEmail, amount: 0, transaction_type: 'RENDER_360', metadata: { resolution: '360', tool_id: 4, type: 'local' } }]);
        } catch(e) {}
        return res.status(200).json({ code: 0, msg: 'tracked' });
    }

    // 360 全景雲端上傳（early return，不走渲染流程）
    if (userPayload.action === 'upload_360') {
        const faces = userPayload.faces || {};
        const faceNames = ['back', 'front', 'top', 'bottom', 'right', 'left'];
        if (!faceNames.every(n => faces[n])) {
            return res.status(200).json({ code: -1, msg: '全景圖不完整，請重新截圖' });
        }
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
            try {
                await supabase.from('transactions').insert([{ user_email: userEmail, amount: 0, transaction_type: 'RENDER_360', metadata: { resolution: '360', tool_id: 4 } }]);
                await supabase.from('render_history').insert([{ user_email: userEmail, input_url: null, full_url: shareUrl, thumbnail_url: shareUrl, prompt: '', style: '360', resolution: '360', tool_id: 4, points_cost: 0 }]);
            } catch(e) {}
            return res.status(200).json({ code: 0, share_url: shareUrl });
        } catch (e) {
            return res.status(200).json({ code: -1, msg: `上傳失敗：${e.message}` });
        }
    }

    if (userPayload.action === 'finalize_360_upload') {
        const shareId = (userPayload.share_id || '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(shareId)) {
            return res.status(200).json({ code: -1, msg: 'Invalid share ID' });
        }
        const shareUrl = `https://loamlab-camera-backend.vercel.app/360-viewer.html?id=${shareId}`;
        try {
            await supabase.from('transactions').insert([{ user_email: userEmail, amount: 0, transaction_type: 'RENDER_360', metadata: { resolution: '360', tool_id: 4 } }]);
            await supabase.from('render_history').insert([{ user_email: userEmail, input_url: null, full_url: shareUrl, thumbnail_url: shareUrl, prompt: '', style: '360', resolution: '360', tool_id: 4, points_cost: 0 }]);
        } catch(e) {}
        return res.status(200).json({ code: 0, share_url: shareUrl });
    }

    // 非同步任務輪詢（配合 AtlasCloud 長任務，避免佔用 Vercel 連線）
    // 無伺服端任務表：由前端把首次 processing 回應裡的欄位原樣帶回，這裡只負責查狀態、成功存歷史、失敗退款
    if (userPayload.action === 'poll_render') {
        const taskId = (userPayload.task_id || '').trim();
        if (!taskId) return res.status(200).json({ code: -1, msg: 'task_id 缺失' });
        const pollCost = Number(userPayload.cost) || 0;
        const pollResVal = userPayload.resolution || '1k';
        const pollTool = userPayload.tool || 1;
        const pollTxId = userPayload.transaction_id || null;
        const pollPrompt = userPayload.prompt || '';
        const pollStyle = userPayload.style || '';
        const pollInputUrl = userPayload.input_url || null;
        const pollStartedAt = Number(userPayload.started_at) || null;

        const ATLASCLOUD_API_KEY = process.env.ATLASCLOUD_API_KEY;
        // 白名單「仍在進行中」的狀態字串；不在清單內一律視為失敗並退款——
        // 比原本的失敗字串黑名單（僅 failed/error/canceled）更可靠：AtlasCloud 用詞
        // 只要不在我們預期清單內，舊邏輯會讓任務卡在「processing」直到前端輪詢逾時，
        // 用戶被扣點卻永遠拿不到退款也拿不到圖（已用真實 failed task_id 現場驗證此缺口）。
        const IN_PROGRESS_STATES = new Set(['', 'starting', 'processing', 'queued', 'pending', 'running', 'in_progress', 'created', 'submitted']);
        try {
            const pRes = await fetch(`https://api.atlascloud.ai/api/v1/model/prediction/${taskId}`, {
                headers: { 'Authorization': `Bearer ${ATLASCLOUD_API_KEY}` },
                signal: AbortSignal.timeout(15000)
            });
            if (pRes.status === 404 || pRes.status === 410) {
                // 任務在 AtlasCloud 端已不存在/過期，不可能再有結果，視為失敗並退款
                return res.status(200).json(await refundAndFail(supabase, userEmail, pollCost, `任務查詢不到（HTTP ${pRes.status}）`, pollTool, taskId));
            }
            // AtlasCloud 對「已失敗」的任務有時仍用非 200（如 500）包一層外層錯誤，
            // 但 body 內的 data.status 才是任務真實狀態（實測過：外層 500 + data.status:"failed"）。
            // 因此非 200 不再直接當「還在處理中」，一律嘗試解析 body，解析不出來才視為暫時性錯誤。
            let pData = null;
            try { pData = await pRes.json(); } catch (e) { /* body 非 JSON，交由下方 fallback 處理 */ }
            if (pRes.status !== 200 && !pData?.data) {
                if (userPayload.debug) return res.status(200).json({ code: 0, status: 'processing', debug_http_status: pRes.status });
                // 真的解析不出任務資料：無法判斷真實狀態，先當作仍在處理中，交由下次輪詢重試
                return res.status(200).json({ code: 0, status: 'processing' });
            }
            const realData = pData?.data || pData || {};
            
            const state = (realData.state || realData.status || '').toLowerCase();
            
            // Extract raw cost from AtlasCloud and calculate double cost in cents
            const rawCost = realData.cost || realData.usd || realData.cost_usd || (realData.metrics && realData.metrics.cost) || 0;
            const doubleCostCents = Math.round(parseFloat(rawCost) * 100 * 2) || 0;

            let finalUrl = realData.outputs?.[0] || realData.image_url || realData.images?.[0] || realData.output;
            if (!finalUrl && Array.isArray(realData.images)) finalUrl = realData.images[0]?.url || realData.images[0];
            if (!finalUrl && Array.isArray(realData.outputs)) finalUrl = realData.outputs[0]?.url || realData.outputs[0]?.image_url;
            if (typeof finalUrl === 'object' && finalUrl) finalUrl = finalUrl.url || finalUrl.image_url;

            if (userPayload.debug) return res.status(200).json({ code: 0, status: 'processing', debug_http_status: pRes.status, debug_state: state, debug_raw: pData });

            if (finalUrl || state === 'succeeded' || state === 'completed' || state === 'success') {
                if (!finalUrl) {
                    // 優先用前端帶回的輪詢起始時間；AtlasCloud 的 created_at 欄位不保證存在（未在文件中證實），
                    // 只當備援，避免該欄位缺失時這個安全網永遠不觸發、退回原本無限 processing 的問題
                    const createdAt = pData?.data?.created_at;
                    const refStart = pollStartedAt || (createdAt ? new Date(createdAt).getTime() : null);
                    if (refStart && (Date.now() - refStart > 240000)) {
                        return res.status(200).json(await refundAndFail(supabase, userEmail, pollCost, '任務已成功但圖檔遺失，自動退款', pollTool, taskId));
                    }
                    return res.status(200).json({ code: 0, status: 'processing' });
                }
                const refReward = await saveRenderHistory(supabase, {
                    userEmail, url: finalUrl,
                    userPayload: { parameters: { user_prompt: pollPrompt, style: pollStyle } },
                    resVal: pollResVal, cost: pollCost, activeTool: pollTool, inputUrl: pollInputUrl,
                    clientIp: getClientIp(req), providerCost: doubleCostCents
                });
                let balance = null;
                try {
                    const { data: uRow } = await supabase.from('users').select('points, lifetime_points').eq('email', userEmail).single();
                    if (uRow) balance = (uRow.points || 0) + (uRow.lifetime_points || 0);
                } catch (e) {}
                return res.status(200).json({
                    code: 0, status: 'success', url: finalUrl, points_remaining: balance, transaction_id: pollTxId,
                    referral_bonus: refReward?.granted ? refReward.amount : 0
                });
            }
            if (!IN_PROGRESS_STATES.has(state)) {
                let reason = `AI 渲染引擎任務失敗（狀態: ${state || '未知'}）`;
                let errorKey = null;
                const errString = typeof realData.error === 'string' ? realData.error : (realData.error?.message || '');
                if (errString.includes('copyright restrictions')) {
                    reason = '圖檔可能涉及版權限制，任務已被取消';
                    errorKey = 'err_copyright';
                } else if (errString) {
                    reason = `AI 渲染引擎任務失敗: ${errString}`;
                }
                const refundRes = await refundAndFail(supabase, userEmail, pollCost, reason, pollTool, taskId);
                if (errorKey) refundRes.error_key = errorKey;
                return res.status(200).json(refundRes);
            }
            return res.status(200).json({ code: 0, status: 'processing' });
        } catch (e) {
            // 網路瞬斷或逾時：視為仍在處理中，交由前端繼續輪詢，不做退款判定
            return res.status(200).json({ code: 0, status: 'processing' });
        }
    }

    // 記錄原始輸入 URL（僅保存穩定的外部 URL，不保存 base64 或臨時簽名 URL）
    let inputUrlForHistory = null;
    const _firstInputImg = userPayload.parameters?.image?.[0];
    if (_firstInputImg && _firstInputImg.startsWith('http') && !_firstInputImg.includes('supabase.co')) {
        inputUrlForHistory = _firstInputImg;
    }

    // 整理 payload：統一 prompt 欄位，相容新版 JS (傳 user_prompt) 與舊版 Ruby (傳 prompt)
    // T4：在此一次性清洗使用者輸入，下游全部拿到已剝除控制字元、已壓長度的版本。
    if (userPayload.parameters) {
        const rawPrompt = sanitizeUserPrompt(userPayload.parameters.user_prompt || userPayload.parameters.prompt || "");
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
        .select('points, lifetime_points, subscription_plan, dodo_customer_id')
        .eq('email', userEmail)
        .single();

    // [Beta 試運營] 零門檻：如果算圖時用戶還不存在，則自動註冊
    if (dbErr && dbErr.code === 'PGRST116') {
        const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{
                email: userEmail,
                points: INITIAL_POINTS,
                lifetime_points: 0,
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
            // 即時觸發升級信（fire-and-forget，不阻塞渲染回應）
            const _base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://loamlab-camera.vercel.app';
            fetch(`${_base}/api/stats?action=notify_users`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.ADMIN_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ emails: [userEmail], template: 'upgrade' })
            }).catch(() => {});
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
            metadata: { plugin_version: pluginVersion, resolution: resVal, tool_id: activeTool || 1 }
        }]).select('id').single();
        if (txData) transactionId = txData.id;
    } catch (txErr) {
        console.warn('[交易日誌] 紀錄失敗（不中斷主流程）:', txErr.message);
    }

    // 影子模式：非同步回報用量到 Dodo Meters，僅供後台可視化/未來對賬，不影響本次渲染結果
    if (user.dodo_customer_id) {
        reportUsageEvent(user.dodo_customer_id, 'render_compute', cost, { resolution: resVal, tool_id: activeTool || 1 })
            .catch(() => {});
    }

    // 4. 圖片處理：T1/T3 的截圖以 base64 進來，直接原樣傳給 AtlasCloud。
    //    先前這裡會把 base64 上傳到 Supabase Storage 換一個簽名 URL（宣稱「減少 payload」），
    //    但下方組 atlasImages 時又會把該 http URL 下載回來轉成 base64——繞一圈（多一次上傳 +
    //    一次下載，約 1~2 秒 + 雙倍頻寬），AtlasCloud 最終收到的還是同一份 base64。故直接略過，
    //    base64 由 atlasImages 的 `data:image` 分支原樣帶過。T2 走自己的 base_image/ref_images
    //    路徑，不經過 parameters.image。

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
        // 這 4 個 key 互相獨立，一次平行取回（原本 4 次序列 await，白白多 3 個 round-trip）。
        // getConfig 內部自己 try/catch 並在錯誤時回 null，這裡再包一層 allSettled 防意外拋出。
        // ==========================================
        const [pR, mR, eR, nR] = await Promise.allSettled([
            getConfig(supabase, 'SYSTEM_PROMPTS'),
            getConfig(supabase, 'MODEL_CONFIG'),
            getConfig(supabase, 'SYSTEM_ENGINE_CONFIG'),
            getConfig(supabase, 'SYSTEM_T1_NODES'),
        ]);
        const pVal = pR.status === 'fulfilled' ? pR.value : null;
        const mVal = mR.status === 'fulfilled' ? mR.value : null;
        const eVal = eR.status === 'fulfilled' ? eR.value : null;
        const nVal = nR.status === 'fulfilled' ? nR.value : null;

        const systemPrompts = pVal?.prompts || {};
        // 不再靜默降級：DB 讀不到 SYSTEM_PROMPTS 等同「管理員所有調校全部失效」，
        // 正式環境是嚴重事故，日誌用可被告警規則抓到的關鍵字大聲喊出來（T3）。
        if (pVal == null) {
            console.error('[render][CRITICAL] SYSTEM_PROMPTS 讀取為 null，已降級為 lib/defaultPrompts.js 內建值 — 請立即檢查 system_config 表與 RLS 政策');
        }

        const toolModelMap = mVal?.models || {};

        // ── Prompt Engine Mode（nodes | legacy）──
        let promptEngineMode = 'nodes';
        let structureLabels = {};
        if (eVal?.config?.prompt_engine_mode) promptEngineMode = eVal.config.prompt_engine_mode;
        if (eVal?.config?.structure_labels) structureLabels = eVal.config.structure_labels;

        // T3：預設提示詞統一由 lib/defaultPrompts.js 提供，前後端同一份
        const p1 = systemPrompts.TOOL_1 || DEFAULT_PROMPTS.TOOL_1;
        const p2 = systemPrompts.TOOL_2 || DEFAULT_PROMPTS.TOOL_2;
        const p3 = systemPrompts.TOOL_3 || DEFAULT_PROMPTS.TOOL_3;
        const defaultBatchNodes = DEFAULT_BATCH_NODES;
        const batchNodes = systemPrompts.TOOL_1_BATCH_NODES
            ? (() => { try { return JSON.parse(systemPrompts.TOOL_1_BATCH_NODES); } catch(e) { return {}; } })()
            : {};

        // ── 進階節點配置 (T1 Nodes) ──
        let t1Nodes = [];
        if (nVal?.nodes) t1Nodes = nVal.nodes;
        else if (nVal == null && promptEngineMode !== 'legacy') {
            console.error('[render][CRITICAL] SYSTEM_T1_NODES 讀取為 null，Tool 1 將退回 legacy 拼接 — 請立即檢查 system_config 表與 RLS 政策');
        }

        // 風格參考圖 URL：使用者從歷史渲染裡自選一張（可選）。有值時 buildNodesModePrompt
        // 會附加 Image Roles / Style Consistency 巢狀 JSON。批量出圖已全面平行送出，不再有
        // 「自動等第一張結果當參考圖」機制。
        const styleRefUrl = (userPayload.parameters?.style_ref_url || '').trim();

        // ── 提示詞組裝 ──
        let finalPrompt = "";
        let finalModel = toolModelMap[`tool${activeTool}`] || 'google/nano-banana-2/edit';

        if (activeTool === 2) {
            let changes = [];
            const parts = (userPrompt || "").split(';');
            for (const part of parts) {
                const p = part.trim();
                if (p.includes(': ')) {
                    const spl = p.split(/: (.+)/);
                    const zoneTag = spl[0].trim();
                    let content = spl[1].trim();
                    
                    // 提取可能存在的圖片參考後綴（如 see image 3 as visual reference 等）
                    let refSuffix = "";
                    const refMatch = content.match(/\(see image \d+ as visual reference\)/i) || 
                                     content.match(/apply or place what's shown in image \d+/i);
                    if (refMatch) {
                        refSuffix = " " + refMatch[0];
                        content = content.replace(refMatch[0], "").trim();
                    }
                    
                    // 用戶自訂描述原樣送出，不做翻譯
                    const finalContent = (content + refSuffix).trim();
                    changes.push(`${zoneTag}: ${finalContent}`);
                }
            }
            if (changes.length === 0) {
                finalPrompt = "Enhance this interior design photo naturally with realistic, high-end visual quality.";
            } else {
                const hasRefs = refImageUrls.length >= 1;
                const refText = hasRefs ? "IMAGE 3+ are reference objects: use only their shape, style and form; match lighting to IMAGE 1's environment.\n" : "";
                // 用函式形式做替換：changes 內含使用者輸入，若用字串形式，內容裡的
                // $&、$'、$`、$1 等會被 String.replace 當成特殊替換樣式，導致提示詞被竄改。
                const changesJoined = changes.join('\n');
                finalPrompt = p2
                    .replace("{{REF_TEXT}}", () => refText)
                    .replace("{{CHANGES}}", () => changesJoined);
            }
        } else if (activeTool === 3) {
            finalPrompt = userPrompt.trim() ? p3 + ", " + userPrompt : p3;
        } else {
            // Tool 1: 嚴格 JSON 結構組裝（legacy mode 跳過節點直接拼接）
            const adv = userPayload.advanced_settings || {};
            const d = defaultBatchNodes;
            const bn = batchNodes;
            const legacyImageRoles = `${bn.img1_key || d.img1_key}: ${bn.img1 || d.img1} ${bn.img2_key || d.img2_key}: ${bn.img2 || d.img2} ${bn.forbidden_key || d.forbidden_key}: ${bn.forbidden || d.forbidden}`;
            const legacyStyleNote = styleRefUrl ? ` Apply ${bn.apply || d.apply} Output must be: ${bn.output_must_be || d.output_must_be} Never: ${bn.never || d.never}` : "";

            if (promptEngineMode !== 'legacy' && t1Nodes.length > 0) {
                finalPrompt = await buildNodesModePrompt(t1Nodes, batchNodes, defaultBatchNodes, adv, styleRefUrl, userPrompt, structureLabels);
            } else {
                // Legacy 模式 或 無節點 fallback：傳統拼接（用戶輸入原樣送出）
                const legacyBatchPrefix = styleRefUrl ? " " + legacyImageRoles + legacyStyleNote : "";
                finalPrompt = userPrompt.trim() ? p1 + legacyBatchPrefix + ", " + userPrompt : p1 + legacyBatchPrefix;
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
            allImagesStrArray = buildImagePayload(userPayload.parameters?.image || [], styleRefUrl);
        }

        // 將所有參考圖片確保為 URL 或 base64 data URL 容錯機制
                // 將所有參考圖片確保為 URL 或 base64 data URL 容錯機制
        // 為避免 AtlasCloud 無法下載 TOS 導致 Model input cannot be empty
                // 將所有參考圖片確保為 URL 或 base64 data URL 容錯機制
        // 為避免 AtlasCloud 無法下載 TOS 導致 Model input cannot be empty
        const atlasImages = await Promise.all(allImagesStrArray.filter(Boolean).map(async (img) => {
            if (img.startsWith('http')) {
                try {
                    const imgRes = await fetch(img);
                    if (imgRes.ok) {
                        const arrayBuffer = await imgRes.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                        return `data:${mime};base64,${buffer.toString('base64')}`;
                    } else {
                        throw new Error("無法下載參考圖片，歷史圖片連結可能已過期 (超過24小時)，請重新上傳一張新的參考圖。");
                    }
                } catch (e) {
                    console.error('[render] fetch image URL for atlas failed:', e);
                    throw new Error("無法下載參考圖片，歷史圖片連結可能已過期 (超過24小時)，請重新上傳一張新的參考圖。");
                }
            }
            if (img.startsWith('data:image')) return img;
            return `data:image/jpeg;base64,${img}`;
        }));

        const normalizedRes = resolutionMap[resVal] || '2k';
        const aspectRatioOverride = activeTool === 2 ? (userPayload.parameters?.aspect_ratio || null) : null;
        const reqBody = buildAtlasReqBody(finalModel, atlasImages, finalPrompt, normalizedRes, activeTool, aspectRatioOverride);

        const response = await fetch('https://api.atlascloud.ai/api/v1/model/generateImage', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ATLASCLOUD_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(280000)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`AtlasCloud API error: ${response.status} - ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        // 與 poll_render（約 583-586 行）保持一致的解析邏輯，避免這裡漏抓 outputs/output
        // 或把 images[0]/outputs[0] 的物件形式誤當字串存進 render_history
        const realData2 = data?.data || data || {};
        // 雙倍成本估算（供 daily_metrics 對帳，同 poll_render 的算法，見 544-546 行）
        const rawCost2 = realData2.cost || realData2.usd || realData2.cost_usd || (realData2.metrics && realData2.metrics.cost) || 0;
        const doubleCostCents2 = Math.round(parseFloat(rawCost2) * 100 * 2) || 0;
        let finalUrl = realData2.outputs?.[0] || realData2.image_url || realData2.images?.[0] || realData2.output || null;
        if (!finalUrl && Array.isArray(realData2.images)) finalUrl = realData2.images[0]?.url || realData2.images[0];
        if (!finalUrl && Array.isArray(realData2.outputs)) finalUrl = realData2.outputs[0]?.url || realData2.outputs[0]?.image_url;
        if (typeof finalUrl === 'object' && finalUrl) finalUrl = finalUrl.url || finalUrl.image_url;

        // AtlasCloud 已接受任務但尚未完成：立即回傳 task_id，不佔用 Vercel 連線 long-poll
        // 注意：這裡故意「不」清理暫存圖——AtlasCloud 是非同步任務，實際抓圖時機是
        // 生成開始時而非接受任務當下，先前在此清理過暫存檔導致圖片 URL 失效、AI 端
        // 回報「無法辨識圖片」而整批失敗（已用真實請求 payload 現場驗證）。poll_render
        // 是無狀態的獨立請求，拿不到這裡的 tempStorageFile 等路徑變數，暫時不清理，
        // 靠 Signed URL 1 小時後自然失效；TODO: 之後可考慮排程清理 render-temp/tmp/。
        if (!finalUrl && data?.data?.id) {
            return res.status(200).json({
                code: 0, status: 'processing', task_id: data.data.id,
                transaction_id: transactionId, points_remaining: (deductResult.points || 0) + (deductResult.lifetime_points || 0),
                cost, resolution: normalizedRes, tool: activeTool,
                prompt: userPrompt, style: userPayload.parameters?.style || '', input_url: inputUrlForHistory
            });
        }

        console.log('[AtlasCloud] finalUrl:', finalUrl);

        await cleanTemp2();
        await cleanTemp();

        if (finalUrl) {
            const refReward = await saveRenderHistory(supabase, { userEmail, url: finalUrl, userPayload, resVal, cost, activeTool, inputUrl: inputUrlForHistory, clientIp: getClientIp(req), providerCost: doubleCostCents2 });
            return res.status(200).json({
                code: 0, url: finalUrl, points_deducted: cost, points_remaining: (deductResult.points || 0) + (deductResult.lifetime_points || 0), transaction_id: transactionId,
                referral_bonus: refReward?.granted ? refReward.amount : 0
            });
        } else {
            try { await supabase.rpc('deduct_render_points', { p_email: userEmail, p_cost: -cost }); } catch(e) {}
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NO_URL', metadata: { tool_id: activeTool } }]); } catch(e) {}
            console.error('[render] no_url response:', JSON.stringify(data).slice(0, 200));
            return res.status(500).json({ code: -1, msg: '出圖完成但結果未返回，請稍後再試。', points_refunded: true });
        }
    } catch (apiError) {
        await cleanTemp2().catch(() => {});
        await cleanTemp().catch(() => {});
        try { await supabase.rpc('deduct_render_points', { p_email: userEmail, p_cost: -cost }); } catch(e) {}
        try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NETWORK_ERROR', metadata: { tool_id: activeTool } }]); } catch(e) {}
        return res.status(500).json({ code: -1, msg: sanitizeError(apiError?.message || '渲染失敗，請稍後再試。'), points_refunded: true });
    }
}

// poll_render 判定任務失敗時的統一退款處理：金額 > 0 才退，並回傳給前端的 JSON body
async function refundAndFail(supabase, userEmail, cost, reason, toolId = null, taskId = null) {
    if (cost > 0) {
        if (taskId) {
            const { data: existing } = await supabase.from('transactions')
                .select('id')
                .eq('user_email', userEmail)
                .eq('transaction_type', 'REFUND_TASK_FAILED')
                .contains('metadata', { task_id: taskId })
                .maybeSingle();
            if (existing) return { code: -1, status: 'failed', msg: `${reason}，點數已退回`, points_refunded: false };
        }
        try { await supabase.rpc('deduct_render_points', { p_email: userEmail, p_cost: -cost }); } catch (e) {}
        try { 
            const insertPayload = { user_email: userEmail, amount: cost, transaction_type: 'REFUND_TASK_FAILED', metadata: {} };
            if (toolId) insertPayload.metadata.tool_id = toolId;
            if (taskId) insertPayload.metadata.task_id = taskId;
            await supabase.from('transactions').insert([insertPayload]); 
        } catch (e) {}
    }
    return { code: -1, status: 'failed', msg: `${reason}，點數已退回`, points_refunded: cost > 0 };
}

// 寫入渲染歷史。改為 await（原本 fire-and-forget）：Vercel serverless 函式回應送出後
// 執行環境可能立刻被凍結/回收，沒 await 的 insert promise 有機會根本來不及打進資料庫，
// 導致「明明出圖成功但 render_history 完全沒記錄」——這個表後續也要當異常掃描的成功判斷
// 依據，記錄不可靠會直接讓自動退款誤判，所以這裡必須是可靠的寫入。失敗只 log，不影響回應。
//
// 【2026-08-28 查出的根因】這裡原本用呼叫端傳進來的 anon-key client 寫入，但正式環境的
// render_history RLS 政策其實擋住了 anon key 的 INSERT（跟 supabase_setup.sql 裡寫的政策
// 對不上，懷疑是 Supabase Dashboard 上被手動改過、沒同步回 repo）——導致這個 insert 已經
// 靜默失敗了將近 5 個月（最後一筆成功紀錄是 2026-04-09），而 scan_render_anomalies 把
// render_history 當成「出圖成功」的判斷依據之一，於是把這段期間內大量真正成功的渲染誤判成
// 孤兒扣款、自動退款給用戶（7 月已查到 22 筆）。改用 service role client 直接繞過 RLS，
// 不依賴那組可能跟 repo 不同步的政策設定。
async function saveRenderHistory(supabase, { userEmail, url, userPayload, resVal, cost, activeTool, inputUrl, clientIp, providerCost }) {
    const prompt = userPayload.parameters?.user_prompt || userPayload.parameters?.prompt || '';
    const style  = userPayload.parameters?.style || '';
    try {
        const { error } = await makeSupabase().from('render_history').insert([{
            user_email:    userEmail,
            input_url:     inputUrl || null,
            full_url:      url,
            thumbnail_url: url,
            prompt,
            style,
            resolution:    resVal || '1k',
            tool_id:       activeTool || 1,
            points_cost:   cost,
            provider_cost_usd_cents: providerCost || null
        }]);
        if (error) console.error('[render_history] save failed:', error.message);
    } catch (e) {
        console.error('[render_history] save exception:', e.message);
    }

    // 這裡是全站唯一的「算圖真正成功」匯合點，邀請碼免費層獎勵（B 首次成功算圖）從這裡觸發。
    // 回傳結果供呼叫端塞進本次算圖的回應，讓前端能立即顯示「+20 點到帳」，不影響主流程——
    // 失敗只記 log，不拋出，一律回傳「未發放」。
    try {
        return await grantFreeReferralReward(supabase, userEmail, clientIp);
    } catch (e) {
        console.warn('[grantFreeReferralReward] saveRenderHistory 呼叫失敗（非致命）:', e.message);
        return { granted: false, amount: 0 };
    }
}
