export default function handler(req, res) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    const html = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LoamLab 登入成功</title>
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <style>
            body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .container { text-align: center; max-width: 400px; padding: 40px; background: rgba(255,255,255,0.03); border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); }
            h2 { color: #a1a1aa; font-weight: 500; }
            .success-icon { font-size: 48px; margin-bottom: 20px; display: none; }
            .loader { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #22c55e; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px;}
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="loader" id="loader"></div>
            <div class="success-icon" id="success-icon">✅</div>
            <h2 id="status-text">驗證身分中，請稍候...</h2>
            <p id="sub-text" style="color: #71717a; font-size: 0.9rem; mt-4;"></p>
        </div>
        <script>
            const supabaseUrl = '${url}';
            const supabaseKey = '${key}';
            const client = window.supabase.createClient(supabaseUrl, supabaseKey);
            
            async function processLogin() {
                // Supabase 會自動抓取網址中的 #access_token
                const { data, error } = await client.auth.getSession();
                
                if (error || !data.session) {
                    document.getElementById('status-text').innerText = "驗證失敗或逾時";
                    document.getElementById('status-text').style.color = "#ef4444";
                    document.getElementById('loader').style.display = 'none';
                    return;
                }
                
                const email = data.session.user.email;
                const sessionId = localStorage.getItem('loamlab_oauth_session');
                
                if (sessionId && email) {
                    // 更新 auth_sessions 狀態，讓 SketchUp 知道我們成功了
                    const { error: dbErr } = await client
                        .from('auth_sessions')
                        .upsert({ id: sessionId, email: email, status: 'success' });
                        
                    // 同步確保此用戶在 users 資料庫中存在 (Beta 試運營：分配初始 10 點)
                    await client.from('users').upsert({ email: email, points: 60 }, { onConflict: 'email', ignoreDuplicates: true });
                    
                    if (dbErr) {
                         document.getElementById('status-text').innerText = "存取狀態庫失敗：" + dbErr.message;
                         document.getElementById('status-text').style.color = "#ef4444";
                         document.getElementById('loader').style.display = 'none';
                         return;
                    }
                    
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('success-icon').style.display = 'block';
                    document.getElementById('status-text').innerText = "登入大成功！";
                    document.getElementById('status-text').style.color = "#22c55e";
                    document.getElementById('sub-text').innerText = "您現在可以安全地關閉此網頁，回到 SketchUp 繼續出圖了！";
                    
                    // 清除殘留，避免下次干擾
                    localStorage.removeItem('loamlab_oauth_session');
                    
                    // 從 Supabase 登出 (因為我們只要一次性的 Email 認證，不需要讓網頁一直保持登入狀態)
                    await client.auth.signOut();
                } else {
                    document.getElementById('status-text').innerText = "找不到連線階段 (Session ID遺失)，請在 SketchUp 重新點擊登入。";
                    document.getElementById('status-text').style.color = "#ef4444";
                    document.getElementById('loader').style.display = 'none';
                }
            }
            
            // 給予 1 秒延遲讓 Supabase JS 吃掉 Hash
            setTimeout(processLogin, 1000);
        </script>
    </body>
    </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
}
