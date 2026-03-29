// /api/version - 供插件自動更新機制查詢最新版本
// 版本資訊直接內嵌，由 release.ps1 發布時更新此檔案
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({
        latest_version: "1.2.6",
        release_notes: "新增 SpaceReform 工具（局部改圖）；公測版開放工具 1/2/3",
        download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest/download/loamlab_plugin.rbz"
    });
}
