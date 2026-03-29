const http = require('http');

const testEmail = 'test_payment_1774451020256@example.com';

http.get(`http://localhost:3000/api/user?email=${testEmail}`, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`[Verify] Status: ${res.statusCode}`);
        console.log(`[Verify] Result: ${data}`);
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
