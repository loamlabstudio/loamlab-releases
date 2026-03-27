import { createClient } from '@supabase/supabase-js';
import { PRICING_CONFIG } from '../config.js';

// Node 18+ 內建 fetch，無需 require('node-fetch')

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
    const FURNITURE_WORKFLOW_ID = process.env.FURNITURE_WORKFLOW_ID || "7620803784345157685";
    const SMART_CANVAS_WORKFLOW_ID = process.env.SMART_CANVAS_WORKFLOW_ID || '7621816572496478261';
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    if (!COZE_PAT || !SUPABASE_URL || !SUPABASE_KEY) {
        let missing = [];
        if (!COZE_PAT) missing.push('COZE_PAT');
        if (!SUPABASE_URL) missing.push('SUPABASE_URL');
        if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY');
        return res.status(500).json({ code: -1, msg: `伺服器設定不完整：Vercel 說他找不到這幾把鑰匙 ${missing.join(', ')}。請確認已 Redeploy 過。` });
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
        .select('points, lifetime_points, referred_by, referral_rewarded, subscription_plan')
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
            return res.status(500).json({ code: -1, msg: `自動註冊失敗: ${insertError.message}` });
        }
        user = newUser;
    } else if (dbErr) {
        return res.status(403).json({ code: -1, msg: `帳戶查詢失敗: ${dbErr.message}` });
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
        return res.status(500).json({ code: -1, msg: `系統錯誤：扣款失敗 ${deductErr.message}` });
    }
    if (!deductResult?.success) {
        if (deductResult?.error === 'insufficient_points') {
            return res.status(402).json({ code: -1, msg: `點數不足！本次渲染需 ${cost} 點，您的餘額僅剩 ${deductResult.balance} 點。` });
        }
        return res.status(403).json({ code: -1, msg: `扣款失敗：${deductResult?.error}` });
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

            // 確保 bucket 存在（第一次會建立，之後 ignore already-exists error）
            await supabaseAdmin.storage.createBucket('render-temp', { public: false }).catch(() => {});

            const { error: upErr } = await supabaseAdmin.storage
                .from('render-temp')
                .upload(fileName, imgBuffer, { contentType: 'image/jpeg' });
            if (upErr) throw new Error(`Storage 上傳失敗: ${upErr.message}`);

            const { data: signedData, error: signErr } = await supabaseAdmin.storage
                .from('render-temp')
                .createSignedUrl(fileName, 3600); // 1 小時有效期，夠 Coze 使用
            if (signErr || !signedData?.signedUrl) throw new Error('簽名 URL 生成失敗');

            userPayload.parameters.image = [signedData.signedUrl];
            tempStorageFile = fileName;
        } catch (uploadErr) {
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_UPLOAD_FAIL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: `圖床代傳失敗: ${uploadErr.message}`, points_refunded: true });
        }
    }

    // 5-A. 工具 2（家具風格替換）→ Supabase Storage 上傳兩圖 → Coze FURNITURE_WORKFLOW_ID
    if (activeTool === 2) {
        let tempBase = null, tempRef = null;
        const cleanTemp2 = async () => {
            const paths = [tempBase, tempRef].filter(Boolean);
            if (paths.length && supabaseAdmin) {
                try { await supabaseAdmin.storage.from('render-temp').remove(paths); } catch(e) {}
            }
        };
        try {
            const baseImageB64 = userPayload.parameters?.base_image;
            const baseImageUrl = userPayload.parameters?.base_image_url || '';
            const userPrompt   = (userPayload.parameters?.user_prompt || userPayload.parameters?.prompt || '').trim();
            if (!baseImageB64 && !baseImageUrl) throw new Error('base_image 未提供');

            // 底圖：優先用遠端 URL，否則上傳 base64（Supabase 優先，fallback freeimage.host）
            let baseForCoze = baseImageUrl;
            if (baseImageB64) {
                const cleanB64 = baseImageB64.replace(/^data:image\/\w+;base64,/, '');
                if (supabaseAdmin) {
                    await supabaseAdmin.storage.createBucket('render-temp', { public: false }).catch(() => {});
                    const baseRaw = cleanB64;
                    const baseName = `tmp/${Date.now()}_base_${Math.random().toString(36).slice(2)}.jpg`;
                    const { error: upBase } = await supabaseAdmin.storage.from('render-temp').upload(baseName, Buffer.from(baseRaw, 'base64'), { contentType: 'image/jpeg' });
                    if (upBase) throw new Error(`底圖上傳失敗: ${upBase.message}`);
                    tempBase = baseName;
                    const { data: baseSign } = await supabaseAdmin.storage.from('render-temp').createSignedUrl(baseName, 3600);
                    baseForCoze = baseSign?.signedUrl || '';
                } else {
                    // Fallback: freeimage.host（無需 auth，與 inpaint.js 相同邏輯）
                    let uploaded = false;
                    try {
                        const form = new FormData();
                        form.append('key', '6d207e02198a847aa98d0a2a901485a5');
                        form.append('action', 'upload');
                        form.append('source', cleanB64);
                        form.append('format', 'json');
                        const r = await fetch('https://freeimage.host/api/1/upload', { method: 'POST', body: form });
                        const d = await r.json();
                        if (d.status_code === 200 && d.image?.url) { baseForCoze = d.image.url; uploaded = true; }
                    } catch (_) {}
                    if (!uploaded) {
                        const IMGBB_KEY = process.env.IMGBB_API_KEY || '';
                        const form2 = new FormData();
                        form2.append('image', cleanB64);
                        const r2 = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: 'POST', body: form2 });
                        const d2 = await r2.json();
                        if (d2.success && d2.data?.url) baseForCoze = d2.data.url;
                        else throw new Error('底圖上傳失敗（freeimage.host 與 ImgBB 均失敗）');
                    }
                }
            }

            // 呼叫 Coze Universal_Image_Editor（統一使用 SMART_CANVAS_WORKFLOW_ID）
            const cozeRes = await fetch('https://api.coze.com/v1/workflow/stream_run', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${COZE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow_id: SMART_CANVAS_WORKFLOW_ID,
                    parameters: { image: [baseForCoze], prompt: userPrompt, resolution: resVal || '2k' }
                })
            });
            if (!cozeRes.ok) throw new Error(`Coze Error: ${cozeRes.status}`);

            let sseText = '';
            for await (const chunk of cozeRes.body) sseText += Buffer.from(chunk).toString('utf8');
            const finalUrl = parseUrlFromSse(sseText);

            await cleanTemp2();
            if (finalUrl) {
                return res.status(200).json({ code: 0, url: finalUrl, points_deducted: cost, points_remaining: monthlyPoints + lifetimePoints, transaction_id: transactionId });
            } else {
                await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
                return res.status(500).json({ code: -1, msg: '算圖完成但未收到圖片 URL', points_refunded: true });
            }
        } catch (err2) {
            await cleanTemp2();
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_TOOL2_ERROR' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: `工具 2 失敗: ${err2.message}`, points_refunded: true });
        }
    }

    // 5-B. 工具 1/3/4 → Coze，緩衝完整回應後解析 URL
    try {
        const cozeResponse = await fetch('https://api.coze.com/v1/workflow/stream_run', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${COZE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow_id: activeWorkflowId, parameters: userPayload.parameters })
        });

        if (!cozeResponse.ok) {
            await cleanTemp();
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_COZE_ERROR' }]); } catch(e) {}
            return res.status(cozeResponse.status).json({ code: -1, msg: `Coze Server Error: ${cozeResponse.status}`, points_refunded: true });
        }

        // 緩衝完整 SSE 回應，解析出圖片 URL 後直接返回 JSON
        let sseText = '';
        for await (const chunk of cozeResponse.body) {
            sseText += Buffer.from(chunk).toString('utf8');
        }

        const finalUrl = parseUrlFromSse(sseText);
        if (finalUrl) {
            // Referral 首次算圖獎勵：B +100 / A +300，發放後設 referral_rewarded = true 防重複
            let referralBonusB = 0;
            try {
                if (user.referred_by && user.referral_rewarded === false) {
                    const REWARD_B = PRICING_CONFIG.referral.free_reward_b;  // B 算圖成功加點
                    const REWARD_A = PRICING_CONFIG.referral.free_reward_a;  // A 推薦成功加點
                    await supabase.from('users')
                        .update({ lifetime_points: lifetimePoints + REWARD_B, referral_rewarded: true })
                        .eq('email', userEmail);
                    referralBonusB = REWARD_B;
                    const { data: inviter } = await supabase.from('users')
                        .select('lifetime_points').eq('email', user.referred_by).single();
                    if (inviter) {
                        await supabase.from('users')
                            .update({ lifetime_points: (inviter.lifetime_points || 0) + REWARD_A })
                            .eq('email', user.referred_by);
                    }
                    try {
                        await supabase.from('transactions').insert([
                            { user_email: userEmail, amount: REWARD_B, transaction_type: 'REFERRAL_REWARD_B' },
                            { user_email: user.referred_by, amount: REWARD_A, transaction_type: 'REFERRAL_REWARD_A' }
                        ]);
                    } catch(e) {}
                }
            } catch (refErr) {
                console.warn('[Referral] 獎勵發放失敗（不影響渲染結果）:', refErr.message);
            }
            await cleanTemp();
            return res.status(200).json({ code: 0, url: finalUrl, points_deducted: cost, points_remaining: monthlyPoints + lifetimePoints + referralBonusB, transaction_id: transactionId });
        } else {
            await cleanTemp();
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NO_URL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: '算圖完成但未收到圖片 URL', points_refunded: true });
        }

    } catch (error) {
        await cleanTemp();
        await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
        try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NETWORK_ERROR' }]); } catch(e) {}
        return res.status(500).json({ code: -1, msg: error.message, points_refunded: true });
    }
}

// 從 Coze SSE 文字中提取圖片 URL
function parseUrlFromSse(sseText) {
    let currentEvent = null;
    for (const line of sseText.split('\n')) {
        const t = line.trim();
        if (t.startsWith('event:')) {
            currentEvent = t.slice(6).trim();
        } else if (t.startsWith('data:')) {
            const jsonStr = t.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const obj = JSON.parse(jsonStr);
                if (obj.code && obj.code !== 0) return null;
                if (currentEvent === 'Message' || currentEvent === 'message') {
                    const content = obj.content || obj.answer || obj.data || '';
                    let parsed;
                    try { parsed = JSON.parse(content); } catch { parsed = content; }
                    const out = (parsed && typeof parsed === 'object')
                        ? (parsed.images || parsed.image || parsed.output || parsed.data || parsed.url || content)
                        : content;
                    let final;
                    try { final = typeof out === 'string' ? JSON.parse(out) : out; } catch { final = out; }
                    let url = null;
                    if (Array.isArray(final) && final[0]) {
                        url = typeof final[0] === 'object' ? (final[0].url || final[0].image) : String(final[0]);
                    } else if (final && typeof final === 'object') {
                        url = final.url || final.image;
                    } else if (typeof final === 'string' && final.startsWith('http')) {
                        url = final;
                    }
                    if (url && url.startsWith('http')) return url;
                }
            } catch {}
        }
    }
    return null;
}
