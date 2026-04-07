// /api/version - 娓氭稒褰冩禒鎯板殰閸曟洘娲块弬鐗堫熂閸掕埖鐓＄懎銏℃付閺傛壆澧楅張?
// 閻楀牊婀扮挬鍥枙閻╁瓨甯撮崗褍绁甸敍宀€鏁?release.ps1 閻х厧绔烽弲鍌涙纯閺傜増顒濆鏃€顢?
const LATEST = {
    latest_version: "1.4.2",
    download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.4.2/loamlab_plugin.rbz",
    manual_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest"
};

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    // GET /api/version?download=1 鈫?301 redirect to latest .rbz锛堢┅瀹氫笅杓?URL锛?
    if (req.query && req.query.download) {
        return res.redirect(301, LATEST.download_url);
    }
    return res.status(200).json({
        ...LATEST,
        release_notes: "Seamless update hotfix for v1.3.3 users (force reload UI)"
    });
}


