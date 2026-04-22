import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const TYPE_LABEL = {
    rating: '渲染評分',
    error_report: '錯誤回報',
    feature: '功能建議',
    quality: '渲染品質',
    bug: 'Bug 回報',
    general: '一般反饋',
    other: '其他'
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { type, rating, content, tags, transaction_id, metadata } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });

    const userEmail = req.headers['x-user-email'] || req.body?.email;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (userEmail) {
        // IP Pinning 驗證
        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
        if (clientIp !== 'unknown') {
            const { data: userRow } = await supabase.from('users').select('last_login_ip').eq('email', userEmail).maybeSingle();
            if (!userRow || !userRow.last_login_ip || userRow.last_login_ip !== clientIp) {
                return res.status(401).json({ code: -1, msg: '登入憑證已過期或網路變更，請重新登入' });
            }
        }
    }

    const { error } = await supabase.from('feedback').insert([{
        user_email: userEmail,
        type,
        rating: rating ?? null,
        content: content || null,
        tags: tags || null,
        transaction_id: transaction_id || null,
        metadata: metadata || {}
    }]);

    if (error) return res.status(500).json({ error: error.message });

    // 發送 Gmail 通知（fire-and-forget，失敗不影響主流程）
    sendEmailNotification({ type, rating, content, tags, transaction_id, metadata, userEmail })
        .catch(e => console.warn('[Feedback Email]', e.message));

    return res.status(200).json({ ok: true });
}

async function sendEmailNotification({ type, rating, content, tags, transaction_id, metadata, userEmail }) {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) return false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass }
    });

    const ratingStr = rating === 5 ? '👍 讚' : rating === 1 ? '👎 差評' : '—';
    const tagsStr = tags?.length ? tags.join(', ') : '—';
    const pluginVer = metadata?.plugin_version || '—';
    const resolution = metadata?.resolution || '—';
    const errorCode = metadata?.error_code || '—';

    const subject = `[LoamLab AI Renderer 反饋] ${TYPE_LABEL[type] || type}${rating ? ` ${ratingStr}` : ''}`;
    const text = [
        `類型：${TYPE_LABEL[type] || type}`,
        `評分：${ratingStr}`,
        `差評標籤：${tagsStr}`,
        `內容：${content || '—'}`,
        `用戶：${userEmail || '未登入'}`,
        `插件版本：${pluginVer}`,
        `解析度：${resolution}`,
        `錯誤碼：${errorCode}`,
        `Transaction ID：${transaction_id || '—'}`,
    ].join('\n');

    await transporter.sendMail({
        from: gmailUser,
        to: gmailUser,
        subject,
        text
    });
    return true;
}
