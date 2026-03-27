const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

// 1. 讀取 .env.local 取得 WEBHOOK_SECRET
const envContent = fs.readFileSync('.env.local', 'utf-8');
const secretMatch = envContent.match(/LEMON_WEBHOOK_SECRET="(.*)"/) || envContent.match(/LEMON_WEBHOOK_SECRET=(.*)/);
const WEBHOOK_SECRET = secretMatch ? secretMatch[1].trim() : '';

if (!WEBHOOK_SECRET) {
    console.error('找不到 LEMON_WEBHOOK_SECRET');
    process.exit(1);
}

// 2. 準備假造的 Payload (模擬購買 Starter 方案)
const testEmail = `test_payment_${Date.now()}@example.com`;
const payloadObj = {
    meta: {
        event_name: 'order_created'
    },
    data: {
        id: `dummy_order_${Date.now()}`,
        attributes: {
            user_email: testEmail,
            first_order_item: {
                variant_id: 1432194 // STARTER
            }
        }
    }
};

const payloadString = JSON.stringify(payloadObj);

// 3. 計算簽章
const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
const signature = hmac.update(payloadString).digest('hex');

console.log(`[Test] 發送 Webhook 模擬請求給 ${testEmail}...`);

// 4. 發送請求
const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/webhook',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'Content-Length': Buffer.byteLength(payloadString)
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`[Response] Status Code: ${res.statusCode}`);
        console.log(`[Response] Body: ${data}`);
        
        if (res.statusCode === 200) {
            console.log('✅ Webhook 充值測試成功！');
        } else {
            console.error('❌ Webhook 測試失敗');
        }
    });
});

req.on('error', (e) => {
    console.error(`[Error] 請求遭遇問題: ${e.message}`);
});

req.write(payloadString);
req.end();
