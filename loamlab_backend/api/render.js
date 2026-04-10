import { createClient } from '@supabase/supabase-js';
import { PRICING_CONFIG } from '../config.js';

export const maxDuration = 300; // Allow Vercel to run up to 5 minutes to poll AtlasCloud

// Node 18+ 內建 fetch，無需 require('node-fetch')

function sanitizeError(msg) {
    if (!msg || typeof msg !== 'string') return msg;
    // 隱藏技術棧字眼
    return msg
        .replace(/AtlasCloud API error/gi, 'AI 渲染引擎錯誤')
        .replace(/AtlasCloud/gi, 'AI 渲染引擎')
        .replace(/nano-banana-2\/edit/gi, 'AI-Renderer-Pro')
        .replace(/nano-banana/gi, 'AI-Engine')
        .replace(/google\/nano-banana-2\/edit/gi, 'AI-Renderer-Pro')
        .replace(/google/gi, 'AI');
}

export default async function handler(req, res) {
    // 1. 允許跨域請求 (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email, X-Plugin-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
    }

    // 環境變數
    const COZE_PAT = process.env.COZE_PAT;
    const WORKFLOW_ID = process.env.WORKFLOW_ID || "7613251981235208197";
    const NINEGRID_WORKFLOW_ID = process.env.NINEGRID_WORKFLOW_ID || "7620780480431030325";
    const SMART_CANVAS_WORKFLOW_ID = process.env.SMART_CANVAS_WORKFLOW_ID || '7621816572496478261';
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

    // 建立 Supabase 資料庫連線
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    // Admin client（繞過 RLS，用於 Storage 私有 bucket）
    const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
        : null;
    let tempStorageFile = null; // 渲染後自動刪除的暫存圖路徑
    const cleanTemp = async () => {
        if (tempStorageFile && supabaseAdmin) {
            try { await supabaseAdmin.storage.from('render-temp').remove([tempStorageFile]); } catch(e) {}
        }
    };

    const userPayload = req.body;
    const activeTool = userPayload.tool || 1;
    const activeWorkflowId = (activeTool === 3 && NINEGRID_WORKFLOW_ID) ? NINEGRID_WORKFLOW_ID : WORKFLOW_ID;

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

    let monthlyPoints = deductResult.points;
    let lifetimePoints = deductResult.lifetime_points;

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
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
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
                if (!originalImageUrl) throw new Error('原始底圖上傳失敗');
            }

            // 合成疊加圖 (Mask)
            baseForCoze = baseImageUrlPayload;
            if (baseImageB64) {
                const cleanB64 = baseImageB64.replace(/^data:image\/\w+;base64,/, '');
                if (supabaseAdmin) {
                    const baseName = `tmp/${Date.now()}_base_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upBase } = await supabaseAdmin.storage.from('render-temp').upload(baseName, Buffer.from(cleanB64, 'base64'), { contentType: 'image/jpeg' });
                    if (upBase) throw new Error(`底圖上傳失敗: ${upBase.message}`);
                    tempBase = baseName;
                    const { data: baseSign } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(baseName, 3600);
                    baseForCoze = baseSign?.signedUrl || '';
                } else {
                    throw new Error('Storage 服務不可用');
                }
            }

            // 用戶的上傳參考圖
            const refImagesB64 = (userPayload.parameters?.ref_images || []).filter(Boolean);
            for (const b64 of refImagesB64) {
                const clean = b64.replace(/^data:image\/\w+;base64,/, '');
                let url = '';
                if (supabaseAdmin) {
                    const fname = `tmp/${Date.now()}_ref_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upRef } = await supabaseAdmin.storage.from('render-temp').upload(fname, Buffer.from(clean, 'base64'), { contentType: 'image/jpeg' });
                    if (!upRef) {
                        tempRefImages.push(fname);
                        const { data: s } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(fname, 3600);
                        if (s?.signedUrl) url = s.signedUrl;
                    }
                }
                if (url) refImageUrls.push(url);
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
        
        const defaultP1 = "這是sketchup室內建模的模型（圖1），最後的目的是要轉換成iPhone拍的照片：先在後端生成一張鎖死空間感的深度圖（圖2）和一張所有元素鎖死並且轉換成色彩分明的通道圖（圖三），使用圖1參考圖2和圖3，在不改變模型材質和結構的情況下，99%還原圖片的空間感、相機位置、材質紋理方向，轉換成iPhone拍攝室內空間寫實照片，自然的光感，補充其他區域的漫反射光線，避免局部死黑或過曝，根據室內空間合理化極小不合理的元素，專業攝影級色彩，照片整體有自然的明暗過渡的層次,ultra-detailed";
        const defaultP2 = "Edit IMAGE 1 (the original scene photo) by replacing objects as specified below.\nThe colored areas in IMAGE 2 are only location markers — do not use these marker colors in the final result.\n{{REF_TEXT}}\nChanges:\n{{CHANGES}}\n\nStrict Guidelines:\n① Final result must be based on IMAGE 1, appearing as a natural, original photograph — not based on IMAGE 2\n② Perspective & Proportion: Render all objects from IMAGE 1's camera angle, adjust orientation to match scene perspective; do not keep the reference photo's original angle\n③ Lighting & Color Temperature: Strictly follow IMAGE 1's light direction, intensity, shadows and color temperature; remove all color casts, glows and artificial lighting from references\n④ Boundary Control: Stay mainly within marked zones; minor edge feathering is allowed for seamless blending, but do not affect unrelated objects or surfaces\n⑤ Realism & Aesthetics: Replaced objects must have realistic materials, correct scale, elegant composition, and blend harmoniously into the original space with consistent style";
        const defaultP3 = "Based on the uploaded reference image, generate a single high-quality 3x3 interior visualization collage in exact 1:1 square aspect ratio. Output only the clean collage - no text, no titles, no watermarks, no borders, no labels.\nHighest priority: Faithfully extract and reproduce all details from the reference image, including material textures, light and shadow characteristics, color tones, object qualities, and unique atmosphere. All 9 panels must maintain the exact same spatial structure, furniture layout, and lighting direction. Accurate perspective with zero distortion or shifting.\n3x3 Mixed Grid Layout:\nTop Row Left: Left 45 wide long shot showing the full spatial layout and depth\nTop Row Center: Exact same viewpoint and framing as the uploaded reference image (visual anchor)\nTop Row Right: Close-up detail 1 - highly faithful reproduction of material textures and craftsmanship from the reference image\nMiddle Row Left: Medium shot focusing on main furniture arrangement and functional area, preserving the original light and shadow atmosphere\nMiddle Row Center: Close-up detail 2 - emphasizing light and shadow interaction and surface qualities from the reference image\nMiddle Row Right: Right 45 wide long shot showing the other side of the space\nBottom Row Left: Close-up detail 3 - faithfully presenting another dimension of details from the reference image (e.g., decorative elements, corner craftsmanship, or material contrast)\nBottom Row Center: Medium shot from an alternative angle showing spatial transparency and overall atmosphere, faithful to the original tone\nBottom Row Right: Balanced medium shot concluding with overall harmony and high-end quality\n\nTechnical Requirements:\nStrictly faithful to the reference image's materials, lighting, colors, and fine details; 8K ultra-high resolution with extreme detail; photorealistic material rendering with accurate reflections, refractions, and micro-surface details; professional multi-layer lighting; cinematic color grading with sophisticated, soft, and luxurious tones; extremely sharp, clean, noise-free, and distortion-free.\nGenerate a single cohesive 3x3 collage with strong visual rhythm and dramatic scale contrast, while perfectly capturing the unique details and atmosphere of the reference image.";
        
        const p1 = systemPrompts.TOOL_1 || defaultP1;
        const p2 = systemPrompts.TOOL_2 || defaultP2;
        const p3 = systemPrompts.TOOL_3 || defaultP3;

        // ── 提示詞組裝 ──
        let finalPrompt = "";
        let finalModel = 'google/nano-banana-2/edit';
        
        if (activeTool === 2) {
            let changes = [];
            for (const part of (userPrompt || "").split(';')) {
                const p = part.trim();
                if (p.includes(': ')) {
                    const spl = p.split(/: (.+)/);
                    if (spl[1]) changes.push(`• ${spl[1].trim()}`);
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
            finalPrompt = userPrompt.trim() ? p3 + ", " + userPrompt : p3;
        } else {
            finalPrompt = userPrompt.trim() ? p1 + "，" + userPrompt : p1;
        }

        // ==========================================
        // 呼叫 AtlasCloud (取代 Coze)
        // ==========================================
        const ATLASCLOUD_API_KEY = process.env.ATLASCLOUD_API_KEY;
        if (!ATLASCLOUD_API_KEY) throw new Error("遺失 ATLASCLOUD_API_KEY，請在 Vercel 環境變數中設定。");

        const resolutionMap = { '1k': '1k', '1K': '1k', '2k': '2k', '2K': '2k', '4k': '4k', '4K': '4k' };
        const resVal = userPayload.resolution || '1k';
        
        // 收集要傳送給 AtlasCloud 的影像
        let allImagesStrArray = [];
        if (activeTool === 2) {
            allImagesStrArray = [originalImageUrl, baseForCoze, ...refImageUrls];
        } else {
            allImagesStrArray = userPayload.parameters?.image || [];
        }

        // 將所有參考圖片確保為 URL 或 base64 data URL 容錯機制
        const atlasImages = allImagesStrArray.filter(Boolean).map(img => {
            if (img.startsWith('http')) return img;
            if (img.startsWith('data:image')) return img;
            return `data:image/jpeg;base64,${img}`;
        });

        const reqBody = {
            model: finalModel,
            images: atlasImages,
            prompt: finalPrompt,
            resolution: resolutionMap[resVal] || '2k',
            aspect_ratio: '16:9',
            output_format: 'jpeg'
        };

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
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NO_URL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: sanitizeError(`API 成功但未回傳網址: ${JSON.stringify(data).slice(0,100)}`), points_refunded: true });
        }
    } catch (apiError) {
        await cleanTemp2();
        await cleanTemp();
        await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
        try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NETWORK_ERROR' }]); } catch(e) {}
        return res.status(500).json({ code: -1, msg: sanitizeError(`出圖出錯/API 超時: ${apiError.message}`), points_refunded: true });
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
// 支援非同步 API (Banana 2 / Replicate) 的動態輪詢
async function pollAsyncUrl(pollUrl) {
    console.log('[Polling] Started for URL:', pollUrl);
    let attempts = 0;
    while (attempts < 60) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const r = await fetch(pollUrl);
            if (r.status === 401 || r.status === 403) {
                console.error('[Polling] Access Denied. Auth token required for polling.');
                return null;
            }
            const data = await r.json();
            
            // Replicate / Banana standard
            if (data.status === 'succeeded' || data.status === 'success' || data.status === 'COMPLETED') {
                let imgUrl = null;
                if (Array.isArray(data.output) && data.output.length > 0) imgUrl = data.output[0];
                else if (typeof data.output === 'string') imgUrl = data.output;
                else {
                    const match = JSON.stringify(data).match(/https?:\/\/[^\s"'\\]+?\.(?:jpg|jpeg|png|webp)/i);
                    if (match) imgUrl = match[0];
                }
                if (imgUrl) return imgUrl;
            } else if (data.status === 'failed' || data.status === 'FAILED' || data.error) {
                console.error('[Polling] Task failed remotely:', data.error);
                return null;
            }
            
            // Fallback for custom APIs mapping directly to output
            if (data.output && !data.status) {
                if (Array.isArray(data.output)) return data.output[0];
                if (typeof data.output === 'string') return data.output;
            }
        } catch (e) {
            console.log('[Polling] Check attempt failed:', e.message);
        }
    }
    console.error('[Polling] Exceeded maximum attempts (180s timeout)');
    return null;
}
