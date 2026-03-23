import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const { key } = req.query;
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
        return res.status(403).json({ code: -1, msg: 'Forbidden' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. 找出所有點數異常的用戶 (負數或欄位缺失)
        const { data: users, error: fetchErr } = await supabase.from('users').select('*');
        if (fetchErr) throw fetchErr;

        let fixedCount = 0;
        let auditLog = [];

        for (const user of users) {
            let updates = {};
            let needsFix = false;

            // 修復負數點數
            if ((user.points || 0) < 0) {
                updates.points = 0;
                needsFix = true;
            }
            if ((user.lifetime_points || 0) < 0) {
                updates.lifetime_points = 0;
                needsFix = true;
            }

            // 補齊缺失欄位
            if (user.lifetime_points === null) {
                updates.lifetime_points = 0;
                needsFix = true;
            }

            if (needsFix) {
                const { error: updateErr } = await supabase.from('users').update(updates).eq('id', user.id);
                if (updateErr) console.error(`Failed to fix user ${user.email}:`, updateErr.message);
                else {
                    fixedCount++;
                    auditLog.push(`Fixed user ${user.email}: ${JSON.stringify(updates)}`);

                    // 建立審計起點交易紀錄
                    await supabase.from('transactions').insert([{
                        user_email: user.email,
                        amount: 0,
                        transaction_type: 'FIX_ANOMALY_RESET'
                    }]);
                }
            }
        }

        return res.status(200).json({
            code: 0,
            msg: `修復完成。共處理 ${fixedCount} 名異常帳戶。`,
            log: auditLog
        });

    } catch (e) {
        return res.status(500).json({ code: -1, msg: `Repair Error: ${e.message}` });
    }
}
