// DodoPayments checkout session proxy
// 由後端統一管理折扣碼，確保前端顯示與實際結帳折扣同步
const DODO_PRODUCTS = {
  TOPUP:   'pdt_0NbIlveGNSETSOveL7Xmk',
  STARTER: 'pdt_0NbImUvFnwJe36ymTELWV',
  PRO:     'pdt_0NbImafnebUuGNrMRvJp4',
  STUDIO:  'pdt_0NbImhwhr5WXfNyDHpaA2'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { planKey, email, quantity = 1 } = req.body || {};

  if (!planKey || !email) {
    return res.status(400).json({ error: 'Missing planKey or email' });
  }

  const productId = DODO_PRODUCTS[planKey.toUpperCase()];
  if (!productId) {
    return res.status(400).json({ error: 'Invalid planKey' });
  }

  const qty = Math.max(1, parseInt(quantity) || 1);
  const DODO_API_KEY = process.env.DODO_API_KEY;
  const DODO_DISCOUNT_CODE = process.env.DODO_DISCOUNT_CODE || '';
  const DODO_API_BASE = 'https://live.dodopayments.com';

  const fallbackUrl = `https://checkout.dodopayments.com/buy/${productId}?quantity=${qty}&customer_email=${encodeURIComponent(email)}`;

  if (!DODO_API_KEY) {
    console.warn('[checkout] DODO_API_KEY not set, using fallback URL (no discount)');
    return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
  }

  const body = {
    product_cart: [{ product_id: productId, quantity: qty }],
    customer: { email },
  };
  if (DODO_DISCOUNT_CODE) body.discount_code = DODO_DISCOUNT_CODE;

  try {
    const apiRes = await fetch(`${DODO_API_BASE}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[checkout] DodoPayments API error:', apiRes.status, errText);
      return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
    }

    const data = await apiRes.json();
    const checkoutUrl = data.checkout_url || fallbackUrl;
    return res.json({ checkoutUrl, discountApplied: !!DODO_DISCOUNT_CODE });
  } catch (e) {
    console.error('[checkout] fetch error:', e.message);
    return res.json({ checkoutUrl: fallbackUrl, discountApplied: false });
  }
}
