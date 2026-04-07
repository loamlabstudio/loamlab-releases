const crypto = require('crypto');
const http = require('http');

const BASE_URL = 'http://localhost:3004';
const DODO_WEBHOOK_SECRET = 'whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='; 
const TEST_USER_EMAIL = 'test_dodo_user_node@example.com';

async function runTest() {
    console.log('🚀 Starting Dodo Webhook Verification (Node.js)...');

    // 1. Get pre-test points
    let prePoints = 0;
    try {
        const preData = await fetchJson(`${BASE_URL}/api/user?email=${TEST_USER_EMAIL}`, {
            'X-User-Email': TEST_USER_EMAIL
        });
        prePoints = preData.points || 0;
    } catch (e) {
        console.log('User might not exist yet, defaulting to 0 pts.');
    }

    // 2. Prepare Payload
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const msgId = `msg_node_${timestamp}`;
    const variantId = 'pdt_0NblmUvFrwJe36ymTELWV'; // STARTER (300 pts)

    const payloadObj = {
        type: 'payment.succeeded',
        data: {
            payment_id: `pay_node_${timestamp}`,
            customer: { email: TEST_USER_EMAIL },
            product_id: variantId,
            total_amount: 2400,
            currency: 'USD'
        }
    };

    const payloadString = JSON.stringify(payloadObj);

    // 3. Compute Dodo Signature
    const signedContent = `${msgId}.${timestamp}.${payloadString}`;
    const secretKey = Buffer.from(DODO_WEBHOOK_SECRET.replace('whsec_', ''), 'base64');
    console.log('Secret Hex:', secretKey.toString('hex'));
    console.log('Signed Content Hex:', Buffer.from(signedContent).toString('hex'));
    
    const hmac = crypto.createHmac('sha256', secretKey);
    const digest = hmac.update(signedContent).digest('base64');
    const signatureHeader = `v1,${digest}`;

    // 4. Send Webhook
    console.log(`Sending webhook for ${TEST_USER_EMAIL}...`);
    const webhookRes = await postData(`${BASE_URL}/api/webhook`, payloadString, {
        'webhook-id': msgId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signatureHeader,
        'Content-Type': 'application/json'
    });

    if (webhookRes.statusCode !== 200) {
        throw new Error(`Webhook failed: ${webhookRes.statusCode} - ${webhookRes.body}`);
    }
    console.log('✅ Webhook accepted (200 OK)');

    // 5. Verify Points
    const postDataObj = await fetchJson(`${BASE_URL}/api/user?email=${TEST_USER_EMAIL}`, {
        'X-User-Email': TEST_USER_EMAIL
    });
    const postPoints = postDataObj.points || 0;

    console.log(`📊 Points update: ${prePoints} -> ${postPoints}`);
    if (postPoints === prePoints + 300) {
        console.log('🎉 VERIFICATION SUCCESSFUL!');
    } else {
        console.error(`❌ Verification failed. Expected ${prePoints + 300}, got ${postPoints}`);
        process.exit(1);
    }
}

function fetchJson(url, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: 'GET',
            headers: headers
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error(data));
                else resolve(JSON.parse(data));
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function postData(url, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const bodyBuffer = Buffer.from(body);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            headers: {
                ...headers,
                'Content-Length': bodyBuffer.length
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(bodyBuffer);
        req.end();
    });
}

runTest().catch(console.error);
