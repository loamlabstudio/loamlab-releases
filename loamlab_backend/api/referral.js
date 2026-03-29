import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });

    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ code: -1, msg: '缺少 Email 或邀請碼' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    try {
        // 1. 檢查自己
        const { data: me, error: myErr } = await supabase
            .from('users')
            .select('id, email, referred_by')
            .eq('email', email)
            .single();

        if (myErr) return res.status(404).json({ code: -1, msg: '找不到您的帳戶，請先算一張圖進行註冊' });
        if (me.referred_by) return res.status(400).json({ code: -1, msg: '您已經接受過邀請，無法重複領取' });

        // 2. 檢查邀請碼所屬用戶 (A)
        const { data: inviter, error: inviterErr } = await supabase
            .from('users')
            .select('id, email')
            .eq('referral_code', code.toUpperCase())
            .single();

        if (inviterErr || !inviter) return res.status(404).json({ code: -1, msg: '無效的邀請碼' });
        if (inviter.email === email) return res.status(400).json({ code: -1, msg: '不能輸入自己的邀請碼' });

        // 3. 純綁定：記錄邀請人，獎勵在 B 首次付費後由 webhook.js 觸發
        const { error: updateBErr } = await supabase
            .from('users')
            .update({ referred_by: inviter.email })
            .eq('email', email);

        if (updateBErr) throw updateBErr;

        return res.status(200).json({
            code: 0,
            msg: '邀請碼已綁定！首次付費後，+100 點將自動到帳，您的推薦人同時獲得 +300 點。'
        });

    } catch (err) {
        return res.status(500).json({ code: -1, msg: `系統錯誤: ${err.message}` });
    }
}
