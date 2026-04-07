# Product Marketing Context

*Last updated: 2026-04-03 (auto-drafted from codebase)*

---

## Product Overview

**One-liner:** AI rendering plugin that turns your SketchUp model into a photorealistic image in 30 seconds — no exports, no setup.

**What it does:** LoamLab Camera is a native SketchUp plugin. Users capture a scene inside SketchUp, choose a resolution (1K/2K/4K), and the plugin uploads the screenshot to the backend which calls an AI (Coze Workflow) to generate a photorealistic render. The result is returned directly inside SketchUp within ~30 seconds. Additional tools: SpaceReform (AI inpainting for area reform), multi-angle generation (9 camera angles at once), and material replacement (coming soon).

**Product category:** AI rendering tool / SketchUp plugin (how customers search: "SketchUp AI render", "SketchUp rendering plugin", "快速 SU 渲染", "AI 效果圖")

**Product type:** SaaS plugin with consumption-based points model

**Business model:** Freemium with points
- New users get 60 free points (~3 renders at 2K)
- Subscription: Starter $24/mo (300 pts), Pro $52/mo (2,000 pts), Studio $139/mo (9,000 pts)
- One-time top-up: $18 for 200 points (permanent)
- Payment: DodoPayment (primary), LemonSqueezy (backup)
- Currently in public beta with 30% discount ("LOAM_BETA_30")

---

## Target Audience

**Target companies:** Independent designers, small studios, freelancers — not enterprise

**Decision-makers:** The designer themselves. They buy it, they use it. No procurement process.

**Primary use case:** Quickly generate photorealistic renders of a SketchUp 3D model for client presentations, design reviews, or social sharing — without switching software or waiting hours.

**Jobs to be done:**
- "Help me show clients what this space will look like before it's built"
- "Help me iterate on design options quickly without spending hours on rendering"
- "Help me look professional without a dedicated renderer or outsourcing"

**Use cases:**
- Interior design client proposal: capture multiple angles, show realistic materials
- Architecture concept presentation: turn a quick massing model into a polished render
- Landscape design: show how planting/hardscape will look in real light
- Quick iteration during design development (test 3-4 versions in one meeting)

---

## Personas

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Interior Designer | Client impression, speed | Rendering takes 2-3 hrs minimum, need results for tomorrow's meeting | Photorealistic in 30 seconds, inside SketchUp |
| Architecture Student/Junior | Portfolio, learning | Can't afford V-Ray, no rendering skills | No learning curve, no extra software |
| Small Studio Owner | Efficiency, cost | Can't justify dedicated renderer license for team | Pay-as-you-go points, no monthly commitment needed |
| Landscape Architect | Material/texture realism | SketchUp trees look fake, hard to communicate planting vision | AI makes vegetation realistic |

---

## Problems & Pain Points

**Core problem:** Getting a photorealistic render from a SketchUp model takes 2-3 hours minimum with traditional tools (V-Ray, Enscape) — requiring a separate software, learning curve, scene setup, and waiting for render.

**Why alternatives fall short:**
- V-Ray / Enscape: expensive ($50-100/mo), steep learning curve, requires scene lighting setup, render time still 20-60 min
- Exporting to Blender/Lumion: workflow break, manual file transfer, another software to learn
- Hiring outsource: expensive ($30-200/render), communication delay, no control
- Other AI render tools: not native to SketchUp, require export, generic styles not architectural

**What it costs them:**
- Time: 2-3 hours per render = 20-30% of a designer's billable day
- Money: $50-100/mo for rendering software they use sporadically
- Opportunities: Can't show clients real-time design changes in meetings

**Emotional tension:** "I have a client meeting tomorrow and my SketchUp model looks like a toy" / "I know what the space should feel like but I can't make it look real fast enough"

---

## Competitive Landscape

**Direct:** Chaos Enscape — instant viewport, but $599/yr, Windows-heavy, requires GPU, no AI generation
**Direct:** V-Ray for SketchUp — industry standard, $84/mo, 30-60 min render, massive learning curve
**Secondary:** Lumion — beautiful output, $1,500/yr, requires model export, separate software
**Indirect:** Hiring a visualization artist — full control but $50-200/render, 1-3 day turnaround
**Indirect:** Photoshop compositing — cheap but requires skills and hours of editing

---

## Differentiation

**Key differentiators:**
- Native SketchUp plugin — zero export, zero workflow break
- 30 seconds vs 30-60 minutes (traditional) or 1-3 days (outsource)
- No GPU required, works on any machine including Mac
- Points model = pay only when you render (vs mandatory subscription)
- AI generates, not just renders — can change style, atmosphere, lighting in prompt

**How we do it differently:** Screenshot the SketchUp viewport directly → AI generates photorealistic image from the 3D composition. No scene lighting needed, no material setup.

**Why that's better:** Designers can stay in their workflow. Iterate 10x faster. Show clients real renders in the same meeting.

**Why customers choose us:** Speed + simplicity. "I don't want to become a rendering expert. I just want the image."

---

## Objections

| Objection | Response |
|-----------|----------|
| "The AI output looks AI-generated / not realistic enough" | Quality improves with prompt guidance; SpaceReform lets you edit specific areas; 4K mode delivers high detail |
| "I don't trust AI for client work" | Use it for internal iteration; show clients polished versions only |
| "Points run out too fast" | 300 pts/mo Starter = 15 renders at 2K; most users render < 10/mo in testing |
| "My internet is slow" | Only the screenshot uploads (~1-3MB); render returns in 30s |
| "Will this work on Mac?" | Yes — Mac-compatible as of v1.3+ |

**Anti-persona:**
- Users needing 100% photorealistic architectural visualization for final deliverables (they need V-Ray/Lumion)
- Users without SketchUp (this only works as a SketchUp plugin)
- Game developers / product designers (tool is optimized for architectural/interior scenes)

---

## Switching Dynamics

**Push (from current tools):** "V-Ray takes too long and I only use it once a week — not worth the subscription cost" / "I hate exporting files just to render"

**Pull (toward LoamLab):** Speed (30 seconds), native workflow, no extra software, free to try

**Habit (keeping them stuck):** "I've learned V-Ray already" / "My firm already has an Enscape license" / "I just outsource to a viz artist"

**Anxiety (about switching):** "What if the AI quality isn't good enough for my clients?" / "Will I lose control over lighting and materials?" / "What happens if I run out of points mid-project?"

---

## Customer Language

**How they describe the problem:**
- "渲染要等很久"（rendering takes forever）
- "SU 截圖很醜，沒辦法給客戶看"（SketchUp screenshots look bad for clients）
- "我不想再另開一個軟體"（I don't want to open another software）
- "效果圖太貴了"（visualization costs too much）

**How they describe us:**
- "就像開個外掛，截個圖就出效果圖了"（like a cheat code — screenshot = render）
- "30 秒出圖" / "AI 渲染"
- "SketchUp 的 AI 渲染插件"

**Words to use:** native, instant, 30 seconds, no export, photorealistic, stay in your workflow, points (not credits)

**Words to avoid:** "credits" (say "points"), "export" (we don't need it), "machine learning" (say AI), overpromising "100% photorealistic"

**Glossary:**
| Term | Meaning |
|------|---------|
| Points | Consumable currency for renders (15/20/30 per image) |
| SpaceReform | Inpainting tool to reform a selected area |
| Multi-angle | 9-angle batch generation tool |
| 真實渲染 | True Render — the core AI rendering tool |
| Beta discount | 30% off all plans, code LOAM_BETA_30 |

---

## Brand Voice

**Tone:** Confident, minimal, slightly editorial — like a design studio, not a tech startup. Not playful, not corporate.

**Style:** Short sentences. Visual. "Show don't tell." Tagline energy: "Intuition Ahead of Computation."

**Personality:** Precise, bold, design-forward, unpretentious

---

## Proof Points

**Metrics:** 30 seconds per render (vs 30-60 min traditional), 1K/2K/4K output, no GPU required

**Customers:** Public beta — no named logos yet

**Testimonials:** Not collected yet (todo: add social proof collection flow post-beta)

**Value themes:**
| Theme | Proof |
|-------|-------|
| Speed | 30 seconds vs hours |
| Simplicity | Native plugin, no export needed |
| Accessibility | No GPU, works on Mac, free to try |
| Flexibility | Pay per render vs mandatory $50-100/mo subscription |

---

## Goals

**Business goal:** First MRR — get the first paying user ($0 → $1). No paying users yet.

**Conversion action:** Download free plugin → complete first render (Aha moment) → upgrade before 60 free points run out

**Current metrics:** Public beta, 0 paying users, DodoPayment primary checkout
