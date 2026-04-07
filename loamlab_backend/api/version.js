// /api/version - 渚涙彃浠惰嚜鍕曟洿鏂版鍒舵煡瑭㈡渶鏂扮増鏈?
// 鐗堟湰璩囪▕鐩存帴鍏у祵锛岀敱 release.ps1 鐧煎竷鏅傛洿鏂版妾旀
const LATEST = {
    latest_version: "1.4.0",
    download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.4.0/loamlab_plugin.rbz",
    manual_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest"
};

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    // GET /api/version?download=1 → 301 redirect to latest .rbz（穩定下載 URL）
    if (req.query && req.query.download) {
        return res.redirect(301, LATEST.download_url);
    }
    return res.status(200).json({
        ...LATEST,
        release_notes: "新增圖片放大預覽功能 (Image Preview Modal)"
    });
}
