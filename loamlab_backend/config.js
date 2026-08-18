export const INITIAL_POINTS = 60;

export const DODO_PRODUCTS = {
    TOPUP:   process.env.DODO_PRODUCT_TOPUP   || 'pdt_0NbIlveGNSETSOveL7Xmk',
    STARTER: process.env.DODO_PRODUCT_STARTER || 'pdt_0NbImUvFnwJe36ymTELWV',
    PRO:     process.env.DODO_PRODUCT_PRO     || 'pdt_0NbImafnebUuGNrMRvJp4',
    STUDIO:  process.env.DODO_PRODUCT_STUDIO  || 'pdt_0NbImhwhr5WXfNyDHpaA2'
};

// 唯一真理來源：方案 → 點數／原價／對應 Dodo 商品 ID。
// 調價時只改這裡；activate.js 的商品辨識與記帳都從這張表查，不再各自硬編一份數字。
export const PLAN_DEFS = {
    starter: { points: 300,  priceCents: 3500,  productId: DODO_PRODUCTS.STARTER, isSub: true },
    pro:     { points: 2000, priceCents: 7500,  productId: DODO_PRODUCTS.PRO,     isSub: true },
    studio:  { points: 9000, priceCents: 19900, productId: DODO_PRODUCTS.STUDIO,  isSub: true },
    topup:   { points: 200,  priceCents: 2500,  productId: DODO_PRODUCTS.TOPUP,   isSub: false },
};

export const PRICING_CONFIG = {
    render_costs: {
        '1k': 15,
        '2k': 20,
        '4k': 30
    },
    referral: {
        paid_reward_a: 300,  // 邀請人 A 於 B 首次付費時獲得（固定）
        paid_reward_b: 100   // 被邀請人 B 首次付費時獲得加碼（固定）
    }
};
