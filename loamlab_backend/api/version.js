// /api/version - 婵炴挻纰嶇粙鎺曘亹閸愨晝顩烽柟顖涙緲濞堜即鏌涢弴鐔哥婵炴彃娼″顒勬偋閸偆鍞梺鍛婂笩閸╂牠鎮￠敍鍕櫣闁靛繆鍓濇禒姗€鏌￠崒娑橆棆濠⒀勵殜瀵?
// 闂佺粯顨呴悧濠傦耿閹殿喗灏欓柛銉簴閺嬫瑩鏌ｉ埡浣烘憼閻㈩垱鎸冲畷妤勵槻缂佷胶鏁婚弫宥呯暆閳ь剟寮?release.ps1 闂佽皫鍛付缂佹梻鍏樺鏌ュ磼濞戞瑧鍑介梺鍝勫€绘晶妤咁敆濠靛棭鐎堕柡鍐ｅ亾妞?
const LATEST = {
    latest_version: "1.4.70",
    download_url: "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.4.70/loamlab_plugin.rbz",
    manual_url: "https://github.com/loamlabstudio/loamlab-releases/releases/latest"
};

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://loamlab-camera.vercel.app/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://loamlab-camera.vercel.app/privacy.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
  <url><loc>https://loamlab-camera.vercel.app/terms.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
</urlset>`;

export default function handler(req, res) {
    // GET /sitemap.xml 鈥?rewritten from vercel.json
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
        release_notes: `v${LATEST.latest_version} release`
    });
}












