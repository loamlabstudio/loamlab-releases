// 前後端唯一的 Tool 1/2/3 預設提示詞來源（Single Source of Truth）。
//
// 背景：先前 render.js 與 admin.html 各自 hardcode 一份預設字串，已經分歧到
// render.js 的 TOOL_1 預設是英文、admin.html 的是一段完全不同的中文，TOOL_2 兩邊
// 也不一致。任何「DB 讀取失敗 → 降級預設」或「admin 在 DB 尚無值時按存檔」都會
// 讓實際送出的提示詞取決於「剛好命中哪一份 hardcode」。
//
// 現在統一：render.js 直接 import 這支模組；admin.html 透過
// GET /api/stats?action=get_prompts 回應裡的 `defaults` / `default_batch_nodes`
// 欄位取得，不再自己寫一份。以 render.js 原本（正式環境實際生效的）英文版為準。

export const DEFAULT_PROMPTS = {
    TOOL_1: "SketchUp interior model (Image 1). Backend pre-generates a spatial depth map (Image 2) and a color-segmented channel map (Image 3). Using Image 1 with reference to Images 2 and 3, restore 99% of spatial depth, camera position, and material texture direction without altering geometry or materials. Convert to a realistic interior photo. Apply natural lighting with supplemental diffuse fill to eliminate pure-black shadows and overexposure. Rationalize minor spatial inconsistencies. Professional photography-grade color grading with natural tonal gradation. ultra-detailed",

    TOOL_2: "Edit IMAGE 1 (the original scene photo) by replacing materials/objects as specified below.\nIMAGE 2 shows the same scene with WHITE OUTLINE MARKERS and NUMBER LABELS (1, 2, 3...) — these are PURELY spatial location indicators showing WHERE to apply each change; each number corresponds exactly to the matching \"Region N\" entry in the Changes list below. These white outlines and numbers are NOT part of the desired output and must NOT appear in the final image in any form.\n{{REF_TEXT}}\nChanges:\n{{CHANGES}}\n\nStrict Guidelines:\n① Final result must be based on IMAGE 1, appearing as a natural, original photograph — the white outline markers and numbers from IMAGE 2 must never appear in the output\n② Perspective & Proportion: Render all objects from IMAGE 1's camera angle; do not use the reference photo's original angle\n③ Lighting & Color Temperature: Strictly follow IMAGE 1's light direction, intensity, shadows and color temperature\n④ Boundary Control: Stay mainly within each marked zone; minor edge feathering allowed for seamless blending; do not affect unrelated surfaces\n⑤ Realism & Aesthetics: Replaced objects must have realistic materials, correct scale, and blend harmoniously into the original space",

    TOOL_3: "Based on the uploaded reference image, generate a single high-quality 3x3 interior visualization collage in exact 1:1 square aspect ratio. Output only the clean collage - no text, no titles, no watermarks, no borders, no labels.\nHighest priority: Faithfully extract and reproduce all details from the reference image, including material textures, light and shadow characteristics, color tones, object qualities, and unique atmosphere. All 9 panels must maintain the exact same spatial structure, furniture layout, and lighting direction. Accurate perspective with zero distortion or shifting.\n3x3 Mixed Grid Layout:\nTop Row Left: Left 45 wide long shot showing the full spatial layout and depth\nTop Row Center: Exact same viewpoint and framing as the uploaded reference image (visual anchor)\nTop Row Right: Close-up detail 1 - highly faithful reproduction of material textures and craftsmanship from the reference image\nMiddle Row Left: Medium shot focusing on main furniture arrangement and functional area, preserving the original light and shadow atmosphere\nMiddle Row Center: Close-up detail 2 - emphasizing light and shadow interaction and surface qualities from the reference image\nMiddle Row Right: Right 45 wide long shot showing the other side of the space\nBottom Row Left: Close-up detail 3 - faithfully presenting another dimension of details from the reference image (e.g., decorative elements, corner craftsmanship, or material contrast)\nBottom Row Center: Medium shot from an alternative angle showing spatial transparency and overall atmosphere, faithful to the original tone\nBottom Row Right: Balanced medium shot concluding with overall harmony and high-end quality\n\nTechnical Requirements:\nStrictly faithful to the reference image's materials, lighting, colors, and fine details; 8K ultra-high resolution with extreme detail; photorealistic material rendering with accurate reflections, refractions, and micro-surface details; professional multi-layer lighting; cinematic color grading with sophisticated, soft, and luxurious tones; extremely sharp, clean, noise-free, and distortion-free.\nGenerate a single cohesive 3x3 collage with strong visual rhythm and dramatic scale contrast, while perfectly capturing the unique details and atmosphere of the reference image.",
};

// Tool 1 批量出圖：有「風格參考圖」時（使用者從歷史選一張）render.js 會把這組
// Image Roles / Style Consistency 文字附加為巢狀 JSON。admin.html「批量節點」區塊
// 可個別覆蓋，未覆蓋時 fallback 到這裡。
export const DEFAULT_BATCH_NODES = {
    img1_key: "Image 1 [PRIMARY OUTPUT BASIS]",
    img1: "SketchUp scene — every spatial element in the output (room layout, all furniture, all objects, all surfaces, camera viewpoint, geometry, proportions) must originate exclusively from Image 1.",
    img2_key: "Image 2 [STYLE EXTRACTION ONLY]",
    img2: "Lighting reference photo — extract ONLY: light direction, color temperature (Kelvin), warmth/coolness ratio, shadow softness, and highlight quality.",
    forbidden_key: "FORBIDDEN from Image 2",
    forbidden: "Any furniture, object, surface, wall, floor, architecture, or spatial arrangement from Image 2 must NOT appear in the output.",
    apply_key: "Apply",
    apply: "Image 2's photographic lighting quality and color tone onto Image 1's existing scene.",
    output_must_be_key: "Output must be",
    output_must_be: "A realistic photo of Image 1's exact spatial layout and objects — lit and color-graded to match Image 2's atmosphere.",
    never_key: "Never",
    never: "Blend, composite, or merge spatial content from both images.",
};
