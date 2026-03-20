import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// 初始化 Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || ''; // 應該使用 Service Role Key 以獲得完整權限
const supabase = createClient(supabaseUrl, supabaseKey);

// LemonSqueezy 的自訂 Webhook Secret (用來驗證是不是真的從官方發送過來的)
const WEBHOOK_SECRET = process.env.LEMON_WEBHOOK_SECRET || 'your_lemon_squeezy_secret';

// Vercel 設定：停用自動解析 JSON 格式，以便 getRawBody 讀取原始 HMAC 簽章 Buffer
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    // 只允許 POST 方法
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 1. 驗證 Webhook 的加密簽章 (防偽造)
    try {
        const rawBody = await getRawBody(req);
        const signature = req.headers['x-signature'];

        if (!signature) {
            console.error('[🚫安全] 缺少 X-Signature 簽章頭！');
            return res.status(401).json({ error: 'Missing Signature' });
        }

        const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
        const digest = hmac.update(rawBody).digest('hex');

        // 使用 timingSafeEqual 防止時序攻擊
        const digestBuffer = Buffer.from(digest, 'hex');
        const signatureBuffer = Buffer.from(signature, 'hex');

        if (digestBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
            console.error('[🚫安全] Webhook 簽章校驗失敗！');
            return res.status(401).json({ error: 'Invalid Signature' });
        }

        // 2. 解析事件內容
        const event = JSON.parse(rawBody.toString('utf8'));
        const eventName = event.meta.event_name;
        const orderData = event.data.attributes;

        // 判斷是否為「訂單建立成功」
        if (eventName === 'order_created') {
            const customerEmail = orderData.user_email;
            const variantId = orderData.first_order_item.variant_id; // 商品 ID

            let pointsToAdd = 0;   // ★ 修正：使用 let 宣告，避免變數污染
            let isSubscription = false;

            // ============================================================
            // ★ Variant IDs — 請至 LemonSqueezy 後台 Products > Variants 取得真實 ID
            //   同步更新 app.js 的 LS_VARIANTS 物件（兩邊必須對齊）
            // ============================================================
            const VARIANT_TOPUP   = 99999;  // ← 同步 LS_VARIANTS.TOPUP
            const VARIANT_STARTER = 12345;  // ← 同步 LS_VARIANTS.STARTER
            const VARIANT_PRO     = 12346;  // ← 同步 LS_VARIANTS.PRO
            const VARIANT_STUDIO  = 12347;  // ← 同步 LS_VARIANTS.STUDIO

            if (variantId === VARIANT_STARTER) {        // Starter $35 / NT$1,120
                pointsToAdd = 300;                      // 月費點數 (寫入 points)
                isSubscription = true;
            } else if (variantId === VARIANT_PRO) {     // Pro $75 / NT$2,400
                pointsToAdd = 2000;                     // 月費點數 (寫入 points)
                isSubscription = true;
            } else if (variantId === VARIANT_STUDIO) {  // Studio $199 / NT$6,368
                pointsToAdd = 9000;                     // 月費點數 (寫入 points)
                isSubscription = true;
            } else if (variantId === VARIANT_TOPUP) {   // Top-up $25 / NT$800
                pointsToAdd = 200;                      // 永久點數 (寫入 lifetime_points)
                isSubscription = false;
            }

            if (pointsToAdd > 0) {
                // 先查詢使用者是否已存在，以及他背後的綁定關聯
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('points, lifetime_points, referred_by, referral_rewarded')
                    .eq('email', customerEmail)
                    .single();

                if (user) {
                    // 雙軌錢包：訂閱方案刷新 points（月費），單購累加 lifetime_points（永久）
                    let newPoints = isSubscription ? pointsToAdd : user.points;
                    let newLifetimePoints = (user.lifetime_points || 0) + (isSubscription ? 0 : pointsToAdd);

                    let shouldRewardRef = false;

                    // 【Phase 17 邀請碼裂變雙贏】首次訂閱才觸發：新用戶 +200 永久點
                    if (user.referred_by && !user.referral_rewarded && isSubscription) {
                        newLifetimePoints += 200; // 新用戶額外獲得 200 點永久積分
                        shouldRewardRef = true;
                    }

                    await supabase
                        .from('users')
                        .update({
                            points: newPoints,
                            lifetime_points: newLifetimePoints,
                            referral_rewarded: shouldRewardRef ? true : user.referral_rewarded,
                            is_beta_tester: true
                        })
                        .eq('email', customerEmail);

                    // [New] 紀錄充值交易
                    await supabase.from('transactions').insert([{
                        user_email: customerEmail,
                        amount: pointsToAdd,
                        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE'
                    }]);

                    console.log(`[🚀金流] 成功為 ${customerEmail} 充值！月費餘額：${newPoints}, 永久餘額: ${newLifetimePoints}`);

                    // 無聲派發推薦人紅利
                    if (shouldRewardRef) {
                        try {
                            const { data: inviter } = await supabase.from('users').select('lifetime_points').eq('referral_code', user.referred_by).single();
                            if (inviter) {
                                await supabase.from('users').update({ lifetime_points: (inviter.lifetime_points || 0) + 200 }).eq('referral_code', user.referred_by);
                                console.log(`[🎟️裂變紅利] 成功發送首購分成 200 點給幕後推手代碼: ${user.referred_by}`);
                            }
                        } catch (e) {
                            console.error('[🎟️裂變紅利] 發送推薦人點數失敗:', e);
                        }
                    }

                } else {
                    // 不存在 -> 直接建立新使用者並給予點數
                    let initPoints = isSubscription ? pointsToAdd : 0;
                    let initLifetime = isSubscription ? 0 : pointsToAdd;
                    await supabase
                        .from('users')
                        .insert([{ email: customerEmail, points: initPoints, lifetime_points: initLifetime }]);

                    // [New] 紀錄充值交易 (新用戶)
                    await supabase.from('transactions').insert([{
                        user_email: customerEmail,
                        amount: pointsToAdd,
                        transaction_type: isSubscription ? 'TOPUP_SUBSCRIPTION' : 'TOPUP_SINGLE'
                    }]);
                    console.log(`[🚀金流] 新建用戶 ${customerEmail} 並充值！月費 ${initPoints}, 永久 ${initLifetime} 點。`);
                }
            }
        }

        // 回傳成功狀態讓 LemonSqueezy 知道我們收到了
        return res.status(200).json({ status: 'success' });

    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// 輔助函數：供 Next.js / Vercel 正確擷取 Raw Body
// 注意：在某些 Vercel 版本中，如果使用了 bodyParser，這段可能會失效。
// 建議在生產環境中通過 config 關閉 bodyParser。
async function getRawBody(req) {
    if (req.body instanceof Buffer) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);

    return new Promise((resolve, reject) => {
        let chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', (err) => reject(err));
    });
}
