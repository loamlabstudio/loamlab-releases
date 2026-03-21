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
            .select('id, email, points')
            .eq('referral_code', code.toUpperCase())
            .single();

        if (inviterErr || !inviter) return res.status(404).json({ code: -1, msg: '無效的邀請碼' });
        if (inviter.email === email) return res.status(400).json({ code: -1, msg: '不能輸入自己的邀請碼' });

        // 3. 獎勵邏輯 (B 領 50, A 領 200)
        // 為了簡單起見，這裡使用連續更新。高併發下建議使用 RPC 存儲流程。
        const REWARD_A = 200;
        const REWARD_B = 50;

        // 更新 B (自己)
        const { error: updateBErr } = await supabase
            .from('users')
            .update({ 
                referred_by: inviter.email,
                points: (me.points || 0) + REWARD_B 
            })
            .eq('email', email);

        if (updateBErr) throw updateBErr;

        // 更新 A (邀請人)
        const { error: updateAErr } = await supabase.rpc('increment_points', { 
            row_id: inviter.id, 
            amount: REWARD_A 
        });
        
        // 如果 RPC 不存在，則回退到普通更新 (建議在 SQL 配置中加上此 RPC)
        if (updateAErr) {
            await supabase
                .from('users')
                .update({ points: (inviter.points || 0) + REWARD_A })
                .eq('id', inviter.id);
        }

        // 紀錄交易日誌
        await supabase.from('transactions').insert([
            { user_email: email, amount: REWARD_B, transaction_type: 'REFERRAL_REWARD_B' },
            { user_email: inviter.email, amount: REWARD_A, transaction_type: 'REFERRAL_REWARD_A' }
        ]);

        return res.status(200).json({ 
            code: 0, 
            msg: `成功！您獲得了 ${REWARD_B} 點，邀請人獲贈 ${REWARD_A} 點。`,
            new_points: (me.points || 0) + REWARD_B
        });

    } catch (err) {
        return res.status(500).json({ code: -1, msg: `系統錯誤: ${err.message}` });
    }
}
