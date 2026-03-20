import { createClient } from '@supabase/supabase-js';
// Node 18+ 內建 fetch，無需 require('node-fetch')
// ★ 修復拒経：移除 CJS require 解決 ESM/CJS 衝突導致的 FUNCTION_INVOCATION_FAILED
// ★ 串流改用 for-await 循環，避免 Readable.fromWeb 相容性崩潰

export default async function handler(req, res) {
    // 1. 允許跨域請求 (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
    }

    // 環境變數
    const COZE_PAT = process.env.COZE_PAT;
    const WORKFLOW_ID = process.env.WORKFLOW_ID || "7613251981235208197";
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    if (!COZE_PAT || !SUPABASE_URL || !SUPABASE_KEY) {
        let missing = [];
        if (!COZE_PAT) missing.push('COZE_PAT');
        if (!SUPABASE_URL) missing.push('SUPABASE_URL');
        if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY');
        return res.status(500).json({ code: -1, msg: `伺服器設定不完整：Vercel 說他找不到這幾把鑰匙 ${missing.join(', ')}。請確認已 Redeploy 過。` });
    }

    // 從 Header 取得 SketchUp 用戶信箱
    const userEmail = req.headers['x-user-email'];
    if (!userEmail) {
        return res.status(401).json({ code: -1, msg: '請求被拒絕：未提供使用者信箱 (X-User-Email)' });
    }

    // 建立 Supabase 資料庫連線
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const userPayload = req.body;

    // 整理 payload：統一 prompt 欄位，相容新版 JS (傳 user_prompt) 與舊版 Ruby (傳 prompt)
    if (userPayload.parameters) {
        const rawPrompt = (userPayload.parameters.user_prompt || userPayload.parameters.prompt || "").trim();
        userPayload.parameters.user_prompt = rawPrompt; // Coze Python 節點讀取
        userPayload.parameters.prompt = rawPrompt;       // 相容 Coze workflow 宣告的必填欄位
    }

    // 動態解析消耗點數 (從 Payload 預判)
    let cost = 15; // 預設 1K
    const payloadStr = JSON.stringify(userPayload);
    if (payloadStr.includes('4K')) cost = 25;
    else if (payloadStr.includes('2K')) cost = 20;

    // 2. 查詢帳戶點數
    let { data: user, error: dbErr } = await supabase
        .from('users')
        .select('points, lifetime_points')
        .eq('email', userEmail)
        .single();

    // [Beta 試運營] 零門檻：如果算圖時用戶還不存在，則自動註冊
    if (dbErr && dbErr.code === 'PGRST116') {
        const newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{
                email: userEmail,
                points: 10,
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

    let monthlyPoints = user.points || 0;
    let lifetimePoints = user.lifetime_points || 0;
    let totalPoints = monthlyPoints + lifetimePoints;

    if (totalPoints < cost) {
        return res.status(402).json({ code: -1, msg: `點數不足！本次渲染需 ${cost} 點，您的餘額僅剩 ${totalPoints} 點 (Beta 初始贈送 10 點)。` });
    }

    // 3. 預先扣除點數 (瀑布流：優先扣除即將過期的月費點數)
    if (monthlyPoints >= cost) {
        monthlyPoints -= cost;
    } else {
        let remainingCost = cost - monthlyPoints;
        monthlyPoints = 0;
        lifetimePoints -= remainingCost;
    }

    const { error: updateErr } = await supabase
        .from('users')
        .update({ points: monthlyPoints, lifetime_points: lifetimePoints })
        .eq('email', userEmail);

    if (updateErr) {
        return res.status(500).json({ code: -1, msg: '系統錯誤：資料庫扣款失敗。' });
    }

    // ★ 修復：用 try/catch 包裹交易紀錄，避免因 transactions 表不存在而崩潰主流程
    try {
        await supabase.from('transactions').insert([{
            user_email: userEmail,
            amount: -cost,
            transaction_type: payloadStr.includes('4K') ? 'RENDER_4K' : (payloadStr.includes('2K') ? 'RENDER_2K' : 'RENDER_1K')
        }]);
    } catch (txErr) {
        console.warn('[交易日誌] 紀錄失敗（不中斷主流程）:', txErr.message);
    }

    // 4. 解析圖片並代為上傳 (Bypass Local Network Constraints)
    let imageUrls = userPayload.parameters?.image;
    if (imageUrls && imageUrls.length > 0 && imageUrls[0].startsWith('data:image')) {
        try {
            const base64Data = imageUrls[0].split(',')[1] || imageUrls[0];

            // ★ 使用 freeimage.host API 上傳（完全免費）
            const formData = new FormData();
            formData.append('key', '6d207e02198a847aa98d0a2a901485a5');
            formData.append('action', 'upload');
            formData.append('source', base64Data);
            formData.append('format', 'json');

            const imgRes = await fetch('https://freeimage.host/api/1/upload', {
                method: 'POST',
                body: formData
            });
            const imgData = await imgRes.json();

            if (imgData.status_code === 200 && imgData.image?.url) {
                userPayload.parameters.image = [imgData.image.url];
            } else {
                // 備用：尝試 ImgBB （如果 freeimage 失敗）
                const formData2 = new FormData();
                formData2.append('key', process.env.IMGBB_API_KEY || '0b9c6a79883833d78da47f6314cfa856');
                formData2.append('image', base64Data);
                const imgbbRes = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData2 });
                const imgbbData = await imgbbRes.json();
                if (imgbbData.success) {
                    userPayload.parameters.image = [imgbbData.data.url];
                } else {
                    throw new Error(`圖床上傳全部失敗: ${JSON.stringify(imgData)}`);
                }
            }
        } catch (uploadErr) {
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_UPLOAD_FAIL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: `圖床代傳失敗: ${uploadErr.message}`, points_refunded: true });
        }
    }

    // 5. 代替使用者向 Coze 請圖，緩衝完整回應後解析 URL
    try {
        const cozeResponse = await fetch('https://api.coze.com/v1/workflow/stream_run', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${COZE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow_id: WORKFLOW_ID, parameters: userPayload.parameters })
        });

        if (!cozeResponse.ok) {
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
            return res.status(200).json({ code: 0, url: finalUrl });
        } else {
            await supabase.from('users').update({ points: user.points, lifetime_points: user.lifetime_points }).eq('email', userEmail);
            try { await supabase.from('transactions').insert([{ user_email: userEmail, amount: cost, transaction_type: 'REFUND_NO_URL' }]); } catch(e) {}
            return res.status(500).json({ code: -1, msg: '算圖完成但未收到圖片 URL', points_refunded: true });
        }

    } catch (error) {
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
