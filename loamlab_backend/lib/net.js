// x-forwarded-for 是一組逗號分隔清單：客戶端可以自己塞值進去（例如 "1.2.3.4, <攻擊者亂打的值>"），
// Vercel 的邊緣網路收到請求後，會把「實際連進來的那個 IP」附加在整串的最後面，不會覆寫掉前面客戶端自己
// 塞的值。所以真正可信、沒被偽造空間的是「最後一段」，取第一段（.split(',')[0]）等於直接相信攻擊者
// 自報的 IP——這正是 IP pinning 防偽機制可以被繞過的原因。
export function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
    }
    return req.socket?.remoteAddress || 'unknown';
}
