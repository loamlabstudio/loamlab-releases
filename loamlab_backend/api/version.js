// /api/version - 供插件自動更新機制查詢最新版本
// 版本資訊直接內嵌，由 release.ps1 發布時更新此檔案
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
        latest_version: "1.2.2-beta",
        release_notes: "修復新人只送 10 點 bug、修復更新檢查無回應、修復 OAuth 登入跳 localhost",
        download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.2.2-beta/loamlab_plugin.rbz"
    });
}
