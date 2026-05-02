// /api/version - 濞撴碍绋掕ぐ鍐╃閹澘娈伴柛鏇熸礃濞插潡寮悧鍫唫闁告帟鍩栭悡锛勬噹閵忊剝浠橀柡鍌涘婢ф寮?
// 闁绘鐗婂﹢鎵尙閸ヮ亖鏋欓柣鈺佺摠鐢挳宕楄缁佺敻鏁嶅畝鈧弫?release.ps1 闁谎呭帶缁旂兘寮查崒娑欑函闁哄倻澧楅婵嗩瀶閺冣偓椤?
const LATEST = {
    latest_version: "1.4.23",
    download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.4.23/loamlab_plugin.rbz",
    manual_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest"
};

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://loamlab-camera.vercel.app/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://loamlab-camera.vercel.app/privacy.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
  <url><loc>https://loamlab-camera.vercel.app/terms.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
</urlset>`;

export default function handler(req, res) {
    // GET /sitemap.xml — rewritten from vercel.json
    if (req.query && req.query._sitemap) {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(SITEMAP_XML);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.query && req.query.download) {
        return res.redirect(301, LATEST.download_url);
    }
    return res.status(200).json({
        ...LATEST,
        release_notes: "v1.4.22 release"
    });
}











