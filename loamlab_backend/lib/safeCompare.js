import crypto from 'crypto';

// 一般 `!==` 字串比較會因為「發現第一個不同字元就提早結束」洩漏秒差時間資訊，
// 讓遠端攻擊者理論上可逐位元猜出 ADMIN_KEY。這裡統一先做定長 SHA-256 雜湊，
// 再用 crypto.timingSafeEqual 比較兩個固定長度的 digest，長度、內容都不會造成時間差。
export function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const digestA = crypto.createHash('sha256').update(a).digest();
    const digestB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(digestA, digestB);
}

export function isValidAdminKey(provided) {
    const expected = process.env.ADMIN_KEY;
    if (!expected) return false;
    return safeEqual(provided, expected);
}
