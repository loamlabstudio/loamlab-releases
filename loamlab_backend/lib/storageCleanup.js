// Supabase Storage 排程清理（pano-360 過期分享圖 / render-temp 孤兒暫存檔）
//
// 為什麼獨立成 lib：Vercel Hobby plan 的 serverless function 上限是 12（目前 12/12），
// cron job 上限是 2 條（目前也已滿）。所以清理邏輯不能是新的 api/*.js，也不能是新的 cron，
// 只能做成共用模組，由 render.js 的 admin 端點（手動/大量回填，maxDuration 300）與
// stats.js 的既有排程（每日搭便車，見 scan_render_anomalies）各自呼叫。
//
// ⚠️ Supabase `storage.list()` 對「資料夾」項目回傳的 id / created_at 一律是 null
//    （2026-09-09 實測 pano-360 12/12 全 null）。任何用資料夾 created_at 判齡的邏輯都會
//    把它當成 1970 年、判定為過期而全刪。判齡一律以資料夾「內部檔案」的 created_at 為準。

const PAGE = 1000;
const REMOVE_BATCH = 100;

async function listPage(supa, bucket, prefix, offset) {
    const { data, error } = await supa.storage.from(bucket).list(prefix, {
        limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error(`list ${bucket}/${prefix || ''}: ${error.message}`);
    return data || [];
}

async function listAll(supa, bucket, prefix, cap = 0) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
        const page = await listPage(supa, bucket, prefix, offset);
        out.push(...page);
        if (page.length < PAGE) break;
        if (cap && out.length >= cap) break;
    }
    return out;
}

// 遞迴收集 prefix 底下所有「真檔案」（id 非 null）。pano-360 的多角度分享會多一層
// 子資料夾（`<shareId>/0/`、`/1/`…），只掃一層會漏掉那些檔案。
async function collectFiles(supa, bucket, prefix, depth = 0, cap = 0) {
    if (depth > 3) return [];
    const entries = await listAll(supa, bucket, prefix, cap);
    const files = [];
    for (const e of entries) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id) files.push({ path, created_at: e.created_at, size: e.metadata?.size || 0 });
        else files.push(...await collectFiles(supa, bucket, path, depth + 1, cap));
    }
    return files;
}

async function removeInBatches(supa, bucket, paths, deadline) {
    let removed = 0;
    const errors = [];
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        if (deadline && Date.now() > deadline) break;
        const chunk = paths.slice(i, i + REMOVE_BATCH);
        const { error } = await supa.storage.from(bucket).remove(chunk);
        if (error) errors.push(error.message);
        else removed += chunk.length;
    }
    return { removed, errors };
}

// 過期全景分享圖：保留 7 天，與 360-viewer.html 對用戶宣稱的效期一致。
// 曾考慮放寬到 180 天以免「舊連結突然全部失效」，查證後確認不需要——出貨版的工具 4 走的是
// 本機匯出（main.rb 的 export_360_local），雲端分享那條路徑雖然程式碼還在（export_360_cloud）
// 但實際沒人走：最近 50 筆 RENDER_360 交易 metadata.type 全部是 'local'，pano-360 bucket 的
// 最新檔案停在 2026-05-11。所以庫裡那 12 組是 5 月的測試資料，不是用戶手上的分享連結。
// ⚠️ 若哪天雲端分享真的開放給用戶，這個 7 天就是玩真的了，屆時要一併確認 UI 有講清楚效期。
export async function cleanupPano360(supa, { days = 7, budgetMs = 0, dryRun = false } = {}) {
    const deadline = budgetMs ? Date.now() + budgetMs : 0;
    const cutoff = Date.now() - days * 86400000;
    const folders = await listAll(supa, 'pano-360', '');
    const doomed = [];
    let scanned = 0, skippedUnknownAge = 0, bytes = 0;

    for (const folder of folders) {
        if (deadline && Date.now() > deadline) break;
        if (folder.id) continue; // bucket 根目錄的散檔不歸這裡管
        const files = await collectFiles(supa, 'pano-360', folder.name);
        if (!files.length) continue;
        scanned++;
        // 判齡用最新的一筆檔案；任何一筆缺 created_at 就整組跳過（寧可漏刪，不可誤刪）
        if (files.some(f => !f.created_at)) { skippedUnknownAge++; continue; }
        const newest = Math.max(...files.map(f => new Date(f.created_at).getTime()));
        if (newest >= cutoff) continue;
        doomed.push(...files.map(f => f.path));
        bytes += files.reduce((a, f) => a + f.size, 0);
    }

    if (dryRun) return { folders_scanned: scanned, files_matched: doomed.length, bytes, removed: 0, skipped_unknown_age: skippedUnknownAge, dry_run: true };
    const { removed, errors } = await removeInBatches(supa, 'pano-360', doomed, deadline);
    return { folders_scanned: scanned, files_matched: doomed.length, bytes, removed, remaining: doomed.length - removed, skipped_unknown_age: skippedUnknownAge, errors };
}

// 孤兒暫存圖：AtlasCloud 改非同步 task_id 後，poll_render 是無狀態請求，拿不到當初的
// 暫存路徑，所以正常流程根本沒有人刪 render-temp/tmp/（見 render.js 的說明註解）。
// 這些檔案的簽名 URL 只活 1 小時，超過 hours 小時的一律可安全回收。
export async function cleanupRenderTemp(supa, { hours = 24, budgetMs = 0, dryRun = false, maxFiles = 0 } = {}) {
    const deadline = budgetMs ? Date.now() + budgetMs : 0;
    const cutoff = Date.now() - hours * 3600000;
    // maxFiles 是給排程用的工作量上限（stats.js 的函式沒有 render.js 那 300 秒可用）。
    // 檔名是 Date.now() + 底線 + 亂數 + .jpg，13 位數字等長 ⇒ 字典序等同時間序，list 又固定 name asc，
    // 所以截斷取到的永遠是「最舊的那批」，正好就是要刪的目標，不會漏刪到新檔前面去。
    const files = await collectFiles(supa, 'render-temp', 'tmp', 0, maxFiles);
    const doomed = [];
    let bytes = 0, skippedUnknownAge = 0;

    for (const f of files) {
        if (!f.created_at) { skippedUnknownAge++; continue; }
        if (new Date(f.created_at).getTime() >= cutoff) continue;
        doomed.push(f.path);
        bytes += f.size;
    }

    if (dryRun) return { files_scanned: files.length, files_matched: doomed.length, bytes, removed: 0, skipped_unknown_age: skippedUnknownAge, dry_run: true };
    const { removed, errors } = await removeInBatches(supa, 'render-temp', doomed, deadline);
    return { files_scanned: files.length, files_matched: doomed.length, bytes, removed, remaining: doomed.length - removed, skipped_unknown_age: skippedUnknownAge, errors };
}
