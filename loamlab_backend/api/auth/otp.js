// auth/otp.js
// POST /api/auth/otp?action=send   - store lang pref + trigger Supabase OTP
// POST /api/auth/otp?action=verify - verify OTP token
// POST /api/auth/otp?action=hook   - Supabase "Send Email" Auth Hook receiver
const { createClient } = require('@supabase/supabase-js');

const EMAIL_TEMPLATES = {
    'zh-TW': {
        subject: 'LoamLab Camera 登入驗證碼',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">LoamLab Camera 登入驗證碼</h2>
<p style="color:#444">您好，感謝您使用 LoamLab Camera 渲染插件！</p>
<p style="color:#444">請在 SketchUp 插件面板中輸入以下驗證碼：</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">此驗證碼將在 10 分鐘後失效。如果您沒有請求此驗證碼，請忽略此信件。</p>
</div>`
    },
    'en-US': {
        subject: 'LoamLab Camera Verification Code',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">LoamLab Camera Verification Code</h2>
<p style="color:#444">Thank you for using LoamLab Camera!</p>
<p style="color:#444">Enter the following code in your SketchUp plugin panel:</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
</div>`
    },
    'zh-CN': {
        subject: 'LoamLab Camera 登录验证码',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">LoamLab Camera 登录验证码</h2>
<p style="color:#444">您好，感谢您使用 LoamLab Camera 渲染插件！</p>
<p style="color:#444">请在 SketchUp 插件面板中输入以下验证码：</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">此验证码将在 10 分钟后失效。如果您没有请求此验证码，请忽略此邮件。</p>
</div>`
    },
    'es-ES': {
        subject: 'Código de verificación de LoamLab Camera',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">Código de verificación de LoamLab Camera</h2>
<p style="color:#444">¡Gracias por usar LoamLab Camera!</p>
<p style="color:#444">Ingresa el siguiente código en el panel del plugin de SketchUp:</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">Este código expira en 10 minutos. Si no solicitaste esto, ignora este correo.</p>
</div>`
    },
    'pt-BR': {
        subject: 'Código de verificação do LoamLab Camera',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">Código de verificação do LoamLab Camera</h2>
<p style="color:#444">Obrigado por usar o LoamLab Camera!</p>
<p style="color:#444">Digite o seguinte código no painel do plugin SketchUp:</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">Este código expira em 10 minutos. Se você não solicitou isso, ignore este email.</p>
</div>`
    },
    'ja-JP': {
        subject: 'LoamLab Camera 認証コード',
        html: (code) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#111;margin-bottom:8px">LoamLab Camera 認証コード</h2>
<p style="color:#444">LoamLab Camera をご利用いただきありがとうございます！</p>
<p style="color:#444">SketchUp プラグインパネルに以下のコードを入力してください：</p>
<div style="font-size:40px;font-weight:bold;color:#dc2626;letter-spacing:0.4em;padding:20px 0;text-align:center">${code}</div>
<p style="color:#999;font-size:12px">このコードは10分後に失効します。お心当たりのない場合は、このメールを無視してください。</p>
</div>`
    }
};

async function sendOtpEmail(email, code, lang) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error('RESEND_API_KEY not configured');
    const template = EMAIL_TEMPLATES[lang] || EMAIL_TEMPLATES['en-US'];
    const from = process.env.RESEND_FROM_EMAIL || 'LoamLab <noreply@loamlab.studio>';
    const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: email, subject: template.subject, html: template.html(code) })
    });
    if (!resp.ok) throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method not allowed' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ code: -1, msg: 'Server misconfiguration' });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const admin = serviceKey ? createClient(supabaseUrl, serviceKey) : supabase;

    const action = req.query.action;

    // Supabase "Send Email" Auth Hook receiver
    // Supabase calls this instead of sending its own email
    if (action === 'hook') {
        const { user, email_data } = req.body || {};
        if (!user || !email_data || !email_data.token) return res.status(200).json({});

        const email = user.email;
        const code = email_data.token;

        // Look up stored language preference
        let lang = 'en-US';
        try {
            const { data } = await admin.from('otp_lang').select('lang').eq('email', email).single();
            if (data && data.lang) lang = data.lang;
        } catch (_) {}

        try {
            await sendOtpEmail(email, code, lang);
        } catch (e) {
            console.error('[hook] sendOtpEmail failed:', e.message);
            return res.status(500).json({ error: { message: e.message } });
        }
        return res.status(200).json({});
    }

    if (action === 'send') {
        const { email, lang } = req.body || {};
        if (!email) return res.status(400).json({ code: -1, msg: 'Missing email' });

        // Persist language preference so the hook can read it
        try {
            await admin.from('otp_lang').upsert({ email, lang: lang || 'en-US' });
        } catch (_) {}

        const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) return res.status(400).json({ code: -1, msg: error.message });
        return res.status(200).json({ code: 0, msg: 'OTP sent' });
    }

    if (action === 'verify') {
        const { email, token } = req.body || {};
        if (!email || !token) return res.status(400).json({ code: -1, msg: 'Missing email or token' });

        const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
        if (error) return res.status(400).json({ code: -1, msg: 'Invalid or expired code' });
        if (!data.user) return res.status(400).json({ code: -1, msg: 'Verification failed' });

        return res.status(200).json({ code: 0, email: data.user.email, session: data.session });
    }

    return res.status(400).json({ code: -1, msg: 'Invalid action' });
};
