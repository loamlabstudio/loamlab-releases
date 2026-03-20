const crypto = require('crypto');
const axios = require('axios');

// 配置與 webhook.js 對齊
const WEBHOOK_SECRET = 'your_lemon_squeezy_secret';
const TARGET_URL = 'http://localhost:3000/api/webhook'; // 假設本地運行於 3000 端口

const payload = {
    meta: {
        event_name: 'order_created'
    },
    data: {
        attributes: {
            user_email: 'test@example.com',
            first_order_item: {
                variant_id: 100001 // Pro 方案
            }
        }
    }
};

const rawBody = JSON.stringify(payload);
const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
const signature = hmac.update(rawBody).digest('hex');

console.log('--- 模擬 Webhook 發送 ---');
console.log('Payload:', rawBody);
console.log('Signature:', signature);

axios.post(TARGET_URL, payload, {
    headers: {
        'x-signature': signature,
        'Content-Type': 'application/json'
    }
})
.then(res => {
    console.log('回應狀態:', res.status);
    console.log('回應內容:', res.data);
})
.catch(err => {
    console.error('發送失敗:', err.message);
    if (err.response) {
        console.error('詳細錯誤:', err.response.data);
    }
});
