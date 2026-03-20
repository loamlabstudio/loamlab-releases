// inpaint.js — Furniture Swap / Inpainting endpoint
// Phase 1: Placeholder (returns 503 until Coze inpainting workflow is configured)
// Phase 2: Accept { image_url, mask_base64, reference_url, prompt }
//           → Call Coze SAM + Inpainting nodes → Return { code: 0, url: "..." }

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ code: -1, msg: 'Method not allowed' });
    }

    // Phase 2: uncomment and implement below
    // const { image_url, mask_base64, reference_url, prompt, mode } = req.body;
    // mode: "brush" (manual mask) | "sam" (click-to-select, Phase 2+)

    return res.status(503).json({
        code: -1,
        msg: 'Furniture swap is coming in the next update.'
    });
}
