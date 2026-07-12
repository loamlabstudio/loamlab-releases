import crypto from 'crypto';

// 封裝 Dodo Payments API 呼叫。目前僅用於「影子回報」（usage 可視化）與對賬查詢，
// 不作為點數扣款/發放的權威來源——deduct_render_points / apply_points_delta（Supabase RPC）
// 才是唯一真實的帳本，避免把營收熱路徑綁死在未經驗證的外部依賴上。
//
// 官方端點（已用 WebFetch 查證 docs.dodopayments.com/llms.txt，2026-07-12）：
//   POST /usage-events/ingest   — 上報用量事件
//   GET  /customers?email=      — 依 email 查客戶（拿 customer_id 用）

function dodoBase(apiKey) {
    return apiKey?.startsWith('test_') ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
}

// 依 email 查 Dodo customer_id（找不到回傳 null，不丟例外——呼叫端自行決定要不要當作致命錯誤）
export async function getCustomerByEmail(email, apiKey = process.env.DODO_API_KEY) {
    if (!apiKey || !email) return null;
    try {
        const res = await fetch(`${dodoBase(apiKey)}/customers?email=${encodeURIComponent(email)}&limit=1`, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (!res.ok) return null;
        const body = await res.json();
        return body.items?.[0] || null;
    } catch (e) {
        console.warn('[dodo] getCustomerByEmail failed:', e.message);
        return null;
    }
}

// 上報用量事件（影子模式：僅供 Dodo 後台可視化/未來對賬用，失敗不拋出、不影響呼叫端）。
export async function reportUsageEvent(customerId, eventName, quantity, metadata = {}, apiKey = process.env.DODO_API_KEY) {
    if (!apiKey || !customerId) return { ok: false, reason: 'missing_key_or_customer_id' };
    try {
        const res = await fetch(`${dodoBase(apiKey)}/usage-events/ingest`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_id: crypto.randomUUID(),
                customer_id: customerId,
                event_name: eventName,
                metadata: { quantity, ...metadata }
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.warn(`[dodo] reportUsageEvent non-200 (${res.status}):`, text.slice(0, 200));
            return { ok: false, reason: `http_${res.status}` };
        }
        return { ok: true };
    } catch (e) {
        console.warn('[dodo] reportUsageEvent failed (non-fatal):', e.message);
        return { ok: false, reason: e.message };
    }
}
