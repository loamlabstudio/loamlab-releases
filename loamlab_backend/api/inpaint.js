// inpaint.js — Material / Furniture Inpainting via Fal.ai Flux Fill
// Phase 2: Full implementation
// Flow: upload mask → Fal.ai Flux Pro Fill → return composited URL
// Fal.ai handles pixel-perfect preservation of non-masked areas natively.

import { createClient } from '@supabase/supabase-js';

// Upload base64 image data to freeimage.host (fallback: ImgBB)
async function uploadBase64(base64Data, imgbbKey) {
    const clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // Try freeimage.host first (free, no key needed)
    try {
        const form = new FormData();
        form.append('key', '6d207e02198a847aa98d0a2a901485a5');
        form.append('action', 'upload');
        form.append('source', clean);
        form.append('format', 'json');
        const r = await fetch('https://freeimage.host/api/1/upload', { method: 'POST', body: form });
        const d = await r.json();
        if (d.status_code === 200 && d.image?.url) return d.image.url;
    } catch (_) {}

    // Fallback: ImgBB
    const form2 = new FormData();
    form2.append('image', clean);
    const r2 = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, { method: 'POST', body: form2 });
    const d2 = await r2.json();
    if (d2.success && d2.data?.url) return d2.data.url;

    throw new Error('Image upload failed on all hosts');
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Email, X-Plugin-Version');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });

    // Env vars
    const FAL_API_KEY = process.env.FAL_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '';

    if (!FAL_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
        const missing = [!FAL_API_KEY && 'FAL_API_KEY', !SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_KEY && 'SUPABASE_ANON_KEY'].filter(Boolean);
        return res.status(500).json({ code: -1, msg: `Server misconfigured: missing ${missing.join(', ')}` });
    }

    const userEmail = req.headers['x-user-email'];
    if (!userEmail) return res.status(401).json({ code: -1, msg: 'Missing X-User-Email header' });

    const { image_url, mask_base64, prompt = '' } = req.body || {};
    if (!image_url || !mask_base64) {
        return res.status(400).json({ code: -1, msg: 'Missing image_url or mask_base64' });
    }

    const COST = 10;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Query user
    const { data: user, error: dbErr } = await supabase
        .from('users')
        .select('points, lifetime_points, subscription_plan')
        .eq('email', userEmail)
        .single();

    if (dbErr || !user) {
        return res.status(404).json({ code: -1, msg: `User not found: ${dbErr?.message}` });
    }

    const totalPoints = (user.points || 0) + (user.lifetime_points || 0);
    if (totalPoints < COST) {
        return res.status(402).json({ code: -1, msg: `Insufficient points. Need ${COST}, have ${totalPoints}.` });
    }

    // Deduct points (waterfall: monthly first, then lifetime)
    const origPoints = user.points || 0;
    const origLifetime = user.lifetime_points || 0;
    let monthlyPoints = origPoints;
    let lifetimePoints = origLifetime;
    if (monthlyPoints >= COST) {
        monthlyPoints -= COST;
    } else {
        const remaining = COST - monthlyPoints;
        monthlyPoints = 0;
        lifetimePoints -= remaining;
    }

    const { error: updateErr } = await supabase
        .from('users')
        .update({ points: monthlyPoints, lifetime_points: lifetimePoints })
        .eq('email', userEmail);

    if (updateErr) return res.status(500).json({ code: -1, msg: 'DB deduction failed' });

    // Record transaction
    try {
        await supabase.from('transactions').insert([{
            user_email: userEmail,
            amount: -COST,
            transaction_type: 'INPAINT',
            metadata: { prompt: prompt.slice(0, 120) }
        }]);
    } catch (_) {}

    // Refund helper
    const refund = async (reason) => {
        await supabase.from('users')
            .update({ points: origPoints, lifetime_points: origLifetime })
            .eq('email', userEmail);
        try {
            await supabase.from('transactions').insert([{
                user_email: userEmail,
                amount: COST,
                transaction_type: `REFUND_${reason}`
            }]);
        } catch (_) {}
    };

    try {
        // Upload mask to public URL (Fal.ai requires URL, not base64)
        let maskUrl;
        try {
            maskUrl = await uploadBase64(mask_base64, IMGBB_API_KEY);
        } catch (e) {
            await refund('MASK_UPLOAD_FAIL');
            return res.status(500).json({ code: -1, msg: 'Mask upload failed', points_refunded: true });
        }

        // Call Fal.ai Flux Pro Fill (inpainting)
        // white mask = area to fill, black = area to preserve
        const falPayload = {
            image_url,
            mask_url: maskUrl,
            prompt: prompt || 'Replace the material in the marked area. Match the lighting, shadows, and perspective of the surrounding scene exactly.',
            num_inference_steps: 28,
            guidance_scale: 3.5,
            output_format: 'jpeg'
        };

        const falRes = await fetch('https://fal.run/fal-ai/flux-pro/v1/fill', {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(falPayload)
        });

        if (!falRes.ok) {
            const errText = await falRes.text().catch(() => '');
            await refund('FAL_API_ERROR');
            return res.status(500).json({ code: -1, msg: `Fal.ai error ${falRes.status}: ${errText.slice(0, 200)}`, points_refunded: true });
        }

        const falData = await falRes.json();
        const resultUrl = falData?.images?.[0]?.url;

        if (!resultUrl) {
            await refund('FAL_NO_URL');
            return res.status(500).json({ code: -1, msg: 'No result image from Fal.ai', points_refunded: true });
        }

        return res.status(200).json({
            code: 0,
            url: resultUrl,
            points_deducted: COST,
            points_remaining: monthlyPoints + lifetimePoints
        });

    } catch (err) {
        await refund('INPAINT_EXCEPTION');
        return res.status(500).json({ code: -1, msg: err.message || 'Internal error', points_refunded: true });
    }
}
