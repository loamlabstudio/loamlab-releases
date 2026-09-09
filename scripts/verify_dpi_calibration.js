#!/usr/bin/env node
// 驗證 SmartCanvas 的 DPIFix 倍率量測（app.js 內 DPIFix.observe 的同源實作）。
//
// 問題：SketchUp 舊版 CEF 在 Windows 顯示縮放（125%/150%…）下，滑鼠事件座標
// （clientX / offsetX）是裝置像素，而版面量測（getBoundingClientRect）是 CSS 像素，
// 兩者差一個固定倍率 f。現行代碼把 f 當成 1，於是游標算出來的位置會超出畫布右緣而消失。
//
// 量法：同一個滑鼠事件裡，clientX 與 offsetX 只差「元素左緣」這一段距離，
// 而元素左緣 rect.left 是 CSS 像素。相減即得倍率：
//     f = (clientX − offsetX) / (rect.left + clientLeft)
// X 軸、Y 軸各算一次（兩個長度不同的錨點），兩軸吻合才採信。
//
// 執行： node scripts/verify_dpi_calibration.js

'use strict';

// ─── 與 app.js DPIFix.observe 同源的核心 ────────────────────────────
const MIN_ANCHOR = 100, AGREE = 0.01, F_MIN = 0.95, F_MAX = 4, QUORUM = 5;

// 回傳這一個事件量到的倍率；量不出來回傳 null
function measure(clientX, clientY, offsetX, offsetY, anchorL, anchorT) {
    if (anchorL < MIN_ANCHOR || anchorT < MIN_ANCHOR) return null;   // 錨點太短，除法不穩
    const fx = (clientX - offsetX) / anchorL;
    const fy = (clientY - offsetY) / anchorT;
    if (!(fx > 0) || !(fy > 0)) return null;
    if (Math.abs(fx - fy) / fx > AGREE) return null;                 // 兩軸不一致 → 不採信
    const f = (fx + fy) / 2;
    return (f >= F_MIN && f <= F_MAX) ? +f.toFixed(2) : null;
}

// 採信條件：最近 9 票裡有 QUORUM 票「完全相同」。
// 依據是——倍率是個固定常數，正常情況下每個事件量出來本來就該一模一樣（見測試 1）。
// 票數湊不齊代表模型不成立（兩個量不同源）或有雜訊，一律維持 f=1，即今天的行為。
function commit(votes) {
    const tally = new Map();
    for (const v of votes) tally.set(v, (tally.get(v) || 0) + 1);
    let best = 1, hits = 0;
    for (const [v, n] of tally) if (n > hits) { hits = n; best = v; }
    return hits >= QUORUM ? best : 1;
}

// ─── 合成事件：指標真實 CSS 位置 (X,Y)，滑過 rect.left=L / rect.top=T 的元素 ───
// fc = clientX 相對 CSS 的倍率，fo = offsetX 相對 CSS 的倍率
const ev = (fc, fo, X, Y, L, T) => [
    Math.round(X * fc), Math.round(Y * fc),
    Math.round((X - L) * fo), Math.round((Y - T) * fo), L, T,
];

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };
const rand = (a, b) => a + Math.random() * (b - a);

// ─── 1. 實際會發生的情境：兩個量同源，被同一個倍率污染 ──────────────
// （Blink 裡 offsetX 由 clientX 同一份原始座標推導，兩者必然同倍率）
console.log('1. 同源污染 —— 期望單一滑鼠事件即精確量出');
for (const f of [1, 1.25, 1.5, 1.75, 2, 2.5]) {
    const errs = [];
    for (const [L, T] of [[400, 300], [200, 150], [140, 110], [105, 102]]) {
        let worst = 0, nulls = 0;
        for (let t = 0; t < 500; t++) {
            const got = measure(...ev(f, f, rand(L + 5, L + 420), rand(T + 5, T + 320), L, T));
            if (got === null) nulls++; else worst = Math.max(worst, Math.abs(got - f));
        }
        // 量不出來（null）是安全的：那一筆不採用而已，不算失敗
        check(worst < 0.02, `f=${f} 錨點 ${L}/${T} → 最大誤差 ${worst}`);
        errs.push(`${L}/${T}:±${worst.toFixed(3)}`);
    }
    console.log(`   f=${String(f).padEnd(4)} → ${errs.join('  ')}`);
}

// ─── 2. 假想情境：兩個量被不同倍率污染 → 必須拒絕，不可給錯答案 ──────
console.log('\n2. 異源污染（假想）—— 期望兩軸不吻合而拒絕，退回 f=1');
for (const [fc, fo] of [[1.5, 1], [1, 1.5], [2, 1], [1.25, 1]]) {
    let committed = 0;
    for (let t = 0; t < 2000; t++) {          // 每次模擬一整段 hover（30 個滑鼠事件）
        const votes = [];
        for (let i = 0; i < 30; i++) {
            const [L, T] = [Math.round(rand(60, 400)), Math.round(rand(60, 300))];
            const got = measure(...ev(fc, fo, rand(L + 5, L + 420), rand(T + 5, T + 320), L, T));
            if (got !== null) { votes.push(got); if (votes.length > 9) votes.shift(); }
        }
        if (commit(votes) !== 1) committed++;
    }
    const rate = (committed / 2000 * 100).toFixed(1);
    check(committed / 2000 < 0.01, `fc=${fc} fo=${fo} 整段 hover 後誤採信率 ${rate}%（門檻 1%）`);
    console.log(`   fc=${fc} fo=${fo} → 整段 hover 後誤採信率 ${rate}%`);
}

// ─── 3. 錨點過短的元素必須跳過（貼齊視窗邊緣的按鈕等）──────────────
console.log('\n3. 錨點過短 —— 期望跳過不採樣');
for (const [L, T] of [[10, 200], [200, 8], [5, 5], [99, 99]]) {
    const got = measure(...ev(1.5, 1.5, L + 100, T + 80, L, T));
    check(got === null, `錨點 ${L}/${T} 應跳過，卻回傳 ${got}`);
    console.log(`   rect.left=${L} rect.top=${T} → ${got === null ? '正確跳過' : '誤採信 ' + got}`);
}

// ─── 4. 離群事件抗性 ─────────────────────────────────────────────
// 「答錯」= 採信了一個錯誤倍率，會讓落點更歪，絕不可發生。
// 「退回 1」= 票數湊不齊而維持現行行為，是安全的，只是這次沒修好。
console.log('\n4. 離群事件抗性（模擬帶 transform 的元素混進來）');
for (const rate of [0, 0.1, 0.2, 0.3, 0.5]) {
    let wrong = 0, fellBack = 0;
    for (let t = 0; t < 1000; t++) {
        const votes = [];
        for (let i = 0; i < 40; i++) {                 // 一整段 hover，滾動保留最近 9 筆
            const [L, T] = [240, 160];
            const e = ev(1.5, 1.5, rand(L + 5, L + 420), rand(T + 5, T + 320), L, T);
            if (Math.random() < rate) e[2] += Math.round(rand(-150, 150));   // 破壞 offsetX
            const got = measure(...e);
            if (got !== null) { votes.push(got); if (votes.length > 9) votes.shift(); }
        }
        const f = commit(votes);
        if (f === 1) fellBack++; else if (Math.abs(f - 1.5) > 0.03) wrong++;
    }
    check(wrong === 0, `污染率 ${rate * 100}% 採信了 ${wrong} 次錯誤倍率`);
    console.log(`   污染率 ${String(rate * 100).padStart(3)}% → 採信錯誤倍率 ${wrong} 次，安全退回 ${fellBack} 次（共 1000）`);
}

// ─── 5. 健康機器必須恆為 1（不可自作聰明改動行為）──────────────────
console.log('\n5. 健康機器（100% 縮放）—— 期望恆為 1');
{
    let bad = 0;
    for (let t = 0; t < 3000; t++) {
        const [L, T] = [Math.round(rand(50, 400)), Math.round(rand(50, 300))];
        const got = measure(...ev(1, 1, rand(L + 5, L + 420), rand(T + 5, T + 320), L, T));
        if (got !== null && got !== 1) bad++;
    }
    check(bad === 0, `健康機器出現 ${bad} 次非 1 的倍率`);
    console.log(`   3000 次事件中，量出非 1 的次數：${bad}`);
}

// ─── 6. 直接驗證「實際出貨」的代碼 ───────────────────────────────
// 上面 1~5 驗的是演算法規格。這一段從 app.js 抽出真正上線的 DPIFix 與 _scGetXY，
// 用假 DOM 餵事件跑一遍——若哪天上面的副本與 app.js 走音，這一段會失敗。
console.log('\n6. 抽出 app.js 實際出貨的 DPIFix / _scGetXY 跑端到端');
{
    const fs = require('fs'), path = require('path');
    const appPath = path.join(__dirname, '..', 'loamlab_plugin', 'ui', 'app.js');
    const src = fs.readFileSync(appPath, 'utf8');
    const grab = (a, b) => {
        const i = src.indexOf(a); if (i < 0) throw new Error('app.js 找不到 ' + a);
        const j = src.indexOf(b, i); if (j < 0) throw new Error('app.js 找不到結尾 ' + b);
        return src.slice(i, j + b.length);
    };

    const listeners = [];
    global.document = {
        addEventListener: (t, fn) => listeners.push(fn),
        removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    };
    global.SmartCanvas = { isDrawing: false, canvasW: 1920, canvasH: 1080 };
    eval(grab('const DPIFix = {', '\n};').replace('const DPIFix = {', 'global.DPIFix = {'));
    eval(grab('function _scGetXY(e) {', '\n}').replace('function _scGetXY(e) {', 'global._scGetXY = function (e) {'));

    // 合成「滑鼠滑過某元素」；fc / fo = 事件座標相對 CSS 的倍率
    const fakeEvent = (fc, fo, X, Y, L, T, W, H) => ({
        clientX: Math.round(X * fc), clientY: Math.round(Y * fc),
        offsetX: Math.round((X - L) * fo), offsetY: Math.round((Y - T) * fo),
        target: {
            clientLeft: 0, clientTop: 0, clientWidth: W, clientHeight: H,
            getBoundingClientRect: () => ({ left: L, top: T, width: W, height: H }),
        },
    });
    const reset = () => { DPIFix.stop(); DPIFix.factor = 1; DPIFix._votes.length = 0; DPIFix.start(); };

    // 6a. 各種縮放能否定案，且定案後自動移除監聽
    for (const f of [1, 1.25, 1.5, 1.75, 2]) {
        reset();
        const fire = listeners[0];
        let settledAt = null;
        for (let i = 1; i <= 12 && listeners.length; i++) {
            fire(fakeEvent(f, f, 800 + i * 9, 220 + i * 6, 760, 180, 180, 40));   // 側欄按鈕
            if (settledAt === null && DPIFix.factor === f && f !== 1) settledAt = i;
        }
        check(Math.abs(DPIFix.factor - f) < 0.03, `出貨代碼在縮放 ${f} 量到 ${DPIFix.factor}`);
        check(listeners.length === 0, `縮放 ${f} 定案後監聽未移除`);
        console.log(`   縮放 ${f} → factor=${DPIFix.factor}${settledAt ? `（第 ${settledAt} 個 mousemove 定案）` : ''}`);
    }

    // 6b. 右側死區：修復前後的實際 docX
    const W = 800, H = 450, L = 300, T = 200, f = 1.5;
    const docXat = (factor, frac) => {
        DPIFix.factor = factor;
        return _scGetXY(fakeEvent(f, f, L + W * frac, T + H * 0.5, L, T, W, H)).x;
    };
    const before = docXat(1, 2 / 3), after23 = docXat(f, 2 / 3), afterEdge = docXat(f, 1);
    check(before >= 1900, `修復前應在 2/3 處撞右緣，實得 ${before}`);
    check(Math.abs(after23 - 1280) < 4 && Math.abs(afterEdge - 1920) < 4, `修復後 2/3=${after23} 右緣=${afterEdge}`);
    console.log(`   150% 機器：修復前 2/3 處 docX=${before}（圖寬 1920，已撞緣＝死區）`);
    console.log(`             修復後 2/3 處 docX=${after23}、最右緣 docX=${afterEdge}`);

    // 6c. 健康機器不可被改動
    reset();
    for (let i = 0; i < 30 && listeners.length; i++) listeners[0](fakeEvent(1, 1, 800 + i * 11, 220 + i * 7, 760, 180, 180, 40));
    DPIFix.factor = 1;
    const mid = _scGetXY(fakeEvent(1, 1, L + W / 2, T + H / 2, L, T, W, H));
    check(mid.x === 960 && mid.y === 540, `健康機器換算應為 960/540，實得 ${mid.x}/${mid.y}`);
    console.log(`   健康機器：畫布正中央 → docX=${mid.x} docY=${mid.y}`);

    // 6d. 兩軸不吻合必須拒絕
    reset();
    for (let i = 0; i < 60 && listeners.length; i++) listeners[0](fakeEvent(1.5, 1, 800 + i * 13, 220 + i * 9, 760, 180, 180, 40));
    check(DPIFix.factor === 1, `異源污染時應退回 1，卻採信 ${DPIFix.factor}`);
    console.log(`   異源污染 → factor=${DPIFix.factor}（1 = 正確退回修復前行為）`);

    // 6e. 量不出來時預算用完要自行收尾，不可永遠掛著監聽
    reset();
    for (let i = 0; i < DPIFix.BUDGET + 5 && listeners.length; i++) {
        listeners[0](fakeEvent(1.5, 1, 800 + (i % 40) * 9, 220 + (i % 30) * 6, 760, 180, 180, 40));
    }
    check(listeners.length === 0, '預算用完後監聽仍掛在 document 上');
    console.log(`   ${DPIFix.BUDGET} 個事件後仍量不出來 → 自動停止，剩餘監聽 ${listeners.length}`);
}

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✓ 全部通過');
process.exit(failures ? 1 : 0);
