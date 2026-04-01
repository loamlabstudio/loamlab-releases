// /api/version - 供插件自動更新機制查詢最新版本
// 版本資訊直接內嵌，由 release.ps1 發布時更新此檔案
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
        latest_version: "1.2.9-beta",
        release_notes: "v1.2.9-beta: 修復 UI 黑屏問題 (Local Styling Fallback)；新增本地 CSS 備援機制確保離線可用",
        download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.2.9-beta/loamlab_plugin.rbz"
    });
}
