export default function handler(req, res) {
    const { session_id } = req.query;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    const html = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LoamLab 安全登入導向</title>
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <style>
            body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .loader { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #dc2626; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px;}
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .container { text-align: center; }
            h2 { font-weight: 500; font-size: 1.2rem; color: #a1a1aa; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="loader"></div>
            <h2>正在為您建立安全連線...</h2>
        </div>
        <script>
            // 暫存 session_id 供 callback 使用
            const sessionId = '${session_id || ""}';
            if (sessionId) localStorage.setItem('loamlab_oauth_session', sessionId);
            
            const supabaseUrl = '${url}';
            const supabaseKey = '${key}';
            
            if (!supabaseUrl || supabaseUrl === 'undefined') {
                document.querySelector('h2').innerText = "伺服器未設定 SUPABASE 環境變數！";
                document.querySelector('h2').style.color = "#ef4444";
                document.querySelector('.loader').style.display = "none";
            } else {
                const client = window.supabase.createClient(supabaseUrl, supabaseKey);
                
                // 先在 auth_sessions 建立一筆 pending，確保這個 session_id 是合法的
                if (sessionId) {
                    client.from('auth_sessions').upsert({ id: sessionId, status: 'pending' }).then(() => {
                        client.auth.signInWithOAuth({
                            provider: 'google',
                            options: {
                                // 動態導向回這個 Vercel 網域的 callback
                                redirectTo: window.location.origin + '/api/auth/callback'
                            }
                        });
                    });
                } else {
                    document.querySelector('h2').innerText = "無效的登入請求 (缺乏 Session ID)";
                    document.querySelector('.loader').style.display = "none";
                }
            }
        </script>
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
}
