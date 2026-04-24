// /api/version - 濞撴碍绋掕ぐ鍐╃閹澘娈伴柛鏇熸礃濞插潡寮悧鍫唫闁告帟鍩栭悡锛勬噹閵忊剝浠橀柡鍌涘婢ф寮?
// 闁绘鐗婂﹢鎵尙閸ヮ亖鏋欓柣鈺佺摠鐢挳宕楄缁佺敻鏁嶅畝鈧弫?release.ps1 闁谎呭帶缁旂兘寮查崒娑欑函闁哄倻澧楅婵嗩瀶閺冣偓椤?
const LATEST = {
    latest_version: "1.4.12",
    download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.4.12/loamlab_plugin.rbz",
    manual_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest"
};

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // GET /api/version?download=1 閳?301 redirect to latest .rbz閿涘牏鈹呯€规矮绗呮潛?URL閿?
    if (req.query && req.query.download) {
        return res.redirect(301, LATEST.download_url);
    }
    return res.status(200).json({
        ...LATEST,
        release_notes: "Fix tool 2/3 base image picker: now correctly shows rendered results instead of original screenshots"
    });
}








