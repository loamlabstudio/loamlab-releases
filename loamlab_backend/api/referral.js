const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });

    let email, code;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        email = body.email;
        code = body.code ? body.code.toUpperCase() : null;
    } catch (e) {
        return res.status(400).json({ code: -1, msg: 'Invalid JSON payload' });
    }

    if (!email || !code) return res.status(400).json({ code: -1, msg: '請提供 Email 與邀請碼 (Missing email or code)' });

    if (code.length < 5) return res.status(400).json({ code: -1, msg: '無效的邀請碼長度！' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(url, key);

    // 1. 取得使用者本身
    const { data: user, error: userErr } = await supabase.from('users').select('referral_code, referred_by').eq('email', email).single();
    if (userErr || !user) return res.status(404).json({ code: -1, msg: 'User not found' });

    // 2. 檢查是否已經綁定過
    if (user.referred_by) {
        return res.status(400).json({ code: -1, msg: '您已經綁定過推薦人了！無法重複綁定。' });
    }

    // 3. 檢查代碼是否是自己的
    if (user.referral_code === code) {
        return res.status(400).json({ code: -1, msg: '不能輸入自己的推薦碼喔！請填寫邀請您的朋友的代碼。' });
    }

    // 4. 檢查推薦碼是否存在於其他老用戶身上
    const { data: inviter, error: inviterErr } = await supabase.from('users').select('email').eq('referral_code', code).single();
    if (inviterErr || !inviter) {
        return res.status(404).json({ code: -1, msg: '無效的推薦碼！查無此人。請確認是否輸入正確。' });
    }

    // 5. 執行綁定！
    const { error: updateErr } = await supabase.from('users').update({ referred_by: code }).eq('email', email);
    if (updateErr) return res.status(500).json({ code: -1, msg: 'Database error while binding code' });

    return res.status(200).json({ code: 0, msg: '綁定成功！當您首次購買任何方案時，雙方將各獲得 200 點數！' });
}
