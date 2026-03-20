// /api/version - 供插件自動更新機制查詢最新版本
// 版本資訊直接內嵌，由 release.ps1 發布時更新此檔案
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
        latest_version: "1.2.0",
        release_notes: "初始穩定版本",
        download_url: "https://github.com/loamlabstudio/loamlab-camera-backend/releases/download/v1.2.0/loamlab_plugin.rbz"
    });
}
