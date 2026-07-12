// 查詢單筆 Dodo 付款詳情
// 執行：cd loamlab_backend && node scripts/check_payment.mjs <payment_id>
import { loadEnvLocal, dodoBase } from './_env.mjs';

loadEnvLocal();
const dodoKey = process.env.DODO_API_KEY;
const paymentId = process.argv[2];

if (!paymentId) {
    console.error('用法: node scripts/check_payment.mjs <payment_id>');
    process.exit(1);
}
if (!dodoKey) {
    console.error('❌ 未讀到 DODO_API_KEY');
    process.exit(1);
}

console.log(`Fetching payment ${paymentId}...`);
const res = await fetch(`${dodoBase(dodoKey)}/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${dodoKey}` }
});
if (!res.ok) {
    console.log('Failed to fetch payment:', res.status, await res.text());
    process.exit(1);
}
console.log('=== DODO PAYMENT ===');
console.log(JSON.stringify(await res.json(), null, 2));
