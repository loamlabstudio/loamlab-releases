// /api/version - 渚涙彃浠惰嚜鍕曟洿鏂版鍒舵煡瑭㈡渶鏂扮増鏈?
// 鐗堟湰璩囪▕鐩存帴鍏у祵锛岀敱 release.ps1 鐧煎竷鏅傛洿鏂版妾旀
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
        latest_version: "1.3.0",
        release_notes: "Fix installation failure and oversized RBZ",
        download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.3.0/loamlab_plugin.rbz"
    });
}


