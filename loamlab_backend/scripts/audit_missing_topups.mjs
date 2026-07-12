// 對帳腳本：比對 Dodo 單次點數購買(TOPUP) 的 succeeded 付款 vs DB transactions，
// 找出「扣款成功但未入帳」的受害者。預設 dry-run 僅報告；加 --execute 才會補發並雙倍補償。
// 執行：cd loamlab_backend && node scripts/audit_missing_topups.mjs [--execute]
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { processTopup } from '../lib/activate.js';
import { DODO_PRODUCTS } from '../config.js';

try {
    readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) {}

const EXECUTE = process.argv.includes('--execute');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DODO_KEY = process.env.DODO_API_KEY;
if (!DODO_KEY) { console.error('❌ 未讀到 DODO_API_KEY'); process.exit(1); }
const base = DODO_KEY.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
const TOPUP_POINTS = 200;

async function fetchAllPayments() {
    const all = [];
    let pageNumber = 0;
    while (true) {
        const res = await fetch(`${base}/payments?page_size=100&page_number=${pageNumber}`, {
            headers: { Authorization: `Bearer ${DODO_KEY}` }
        });
        if (!res.ok) { console.error(`❌ Dodo API 錯誤 page=${pageNumber}:`, res.status, await res.text()); break; }
        const json = await res.json();
        const items = json.items || [];
        if (items.length === 0) break;
        all.push(...items);
        pageNumber++;
        if (pageNumber > 50) break; // 安全上限
    }
    return all;
}

async function fetchTopupPayments() {
    const all = await fetchAllPayments();
    console.log(`📡 Dodo 共 ${all.length} 筆歷史付款記錄`);
    const result = [];
    for (const p of all) {
        if (p.status !== 'succeeded') continue;
        if (p.subscription_id) continue; // 只查單次購買，訂閱另有機制覆蓋
        // list 端點本身帶 metadata，優先用 planKey 判斷（不需額外呼叫）
        if (p.metadata?.planKey) {
            if (p.metadata.planKey.toUpperCase() === 'TOPUP') result.push(p);
            continue;
        }
        // metadata 缺漏的舊資料 fallback：查 payment 詳情裡的 product_cart
        try {
            const detailRes = await fetch(`${base}/payments/${p.payment_id}`, { headers: { Authorization: `Bearer ${DODO_KEY}` } });
            if (!detailRes.ok) continue;
            const detail = await detailRes.json();
            const productId = detail.product_cart?.[0]?.product_id;
            if (productId === DODO_PRODUCTS.TOPUP) result.push(p);
        } catch (_) {}
    }
    return result;
}

async function run() {
    console.log('📡 拉取 Dodo 單次點數購買(TOPUP) succeeded 付款...');
    const payments = await fetchTopupPayments();
    console.log(`📡 共 ${payments.length} 筆 succeeded TOPUP 付款`);

    const victims = [];
    for (const pay of payments) {
        const email = (pay.customer?.email || pay.customer_email || '').toLowerCase();
        if (!email) continue;
        const orderId = pay.payment_id;
        const fullOrderId = `DODO_${orderId}`;
        const { data: ex } = await sb.from('transactions').select('id').eq('order_id', fullOrderId).maybeSingle();
        if (ex) continue;
        // 排除已用舊格式手動補償過的（例如 maggieliu 是先前手動處理，order_id = COMPENSATE_<paymentId>）
        const { data: legacyComp } = await sb.from('transactions').select('id').eq('order_id', `COMPENSATE_${orderId}`).maybeSingle();
        if (legacyComp) { console.log(`   ℹ️  ${email} 已用舊格式手動補償過，跳過: COMPENSATE_${orderId}`); continue; }
        // 人工核實出的 I/l 誤植近似 order_id，跳過待人工複核（見對話紀錄）
        if (email === 'jodichen0602@gmail.com') { console.log(`   ⚠️  ${email} order_id 疑似打字誤植近似已存在紀錄，跳過待人工確認`); continue; }
        victims.push({ email, orderId, paymentId: pay.payment_id, createdAt: pay.created_at });
    }

    console.log(`\n⚠️  疑似受害者（扣款成功但未入帳）: ${victims.length} 筆`);
    victims.forEach(v => console.log(`   ${v.email} | payment_id=${v.paymentId} | ${v.createdAt}`));

    if (victims.length === 0) {
        console.log('\n✅ 沒有其他受害者，對帳完成。');
        return;
    }

    if (!EXECUTE) {
        console.log('\n這是 dry-run，尚未寫入任何資料。確認名單無誤後執行：node scripts/audit_missing_topups.mjs --execute');
        return;
    }

    console.log('\n🚀 開始修復並雙倍補償...');
    for (const v of victims) {
        try {
            // 1. 補發原本應得的 200 pts（走正式 processTopup，含冪等/回滾/推薦人分潤邏輯）
            await processTopup(sb, v.email, DODO_PRODUCTS.TOPUP, v.orderId, 'DODO');

            // 2. 額外雙倍補償 200 pts（獨立 order_id，避免與上面衝突）
            const compOrderId = `COMPENSATE_DODO_${v.paymentId}`;
            const { data: compEx } = await sb.from('transactions').select('id').eq('order_id', compOrderId).maybeSingle();
            if (!compEx) {
                const { data: user } = await sb.from('users').select('lifetime_points').eq('email', v.email).maybeSingle();
                await sb.from('users').update({ lifetime_points: (user?.lifetime_points || 0) + TOPUP_POINTS }).eq('email', v.email);
                await sb.from('transactions').insert([{
                    user_email: v.email,
                    amount: TOPUP_POINTS,
                    transaction_type: 'TOPUP_SINGLE',
                    order_id: compOrderId,
                    amount_usd_cents: 0,
                }]);
            }
            console.log(`   ✅ ${v.email} 修復 + 雙倍補償完成 (+${TOPUP_POINTS * 2} pts total)`);
        } catch (e) {
            console.error(`   ❌ ${v.email} 處理失敗:`, e.message);
        }
    }
    console.log('\n完成。');
}

run();
