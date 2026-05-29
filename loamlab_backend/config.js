export const DODO_PRODUCTS = {
    TOPUP:   process.env.DODO_PRODUCT_TOPUP   || 'pdt_0NbIlveGNSETSOveL7Xmk',
    STARTER: process.env.DODO_PRODUCT_STARTER || 'pdt_0NblmUvFrwJe36ymTELWV',
    PRO:     process.env.DODO_PRODUCT_PRO     || 'pdt_0NbImafnebUuGNrMRvJp4',
    STUDIO:  process.env.DODO_PRODUCT_STUDIO  || 'pdt_0Nblmhwbr5WXfNyDHpaA2'
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
