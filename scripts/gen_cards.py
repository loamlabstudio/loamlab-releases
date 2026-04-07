#!/usr/bin/env python3
"""
gen_cards.py — LoamLab Tutorial Card Image Generator

Generates explanation cards (1200×630, dark brand background) for each tool step.
No SketchUp required — pure programmatic generation.

Usage:
    python scripts/gen_cards.py --version 1.3.1
    python scripts/gen_cards.py --version 1.3.1 --lang zh-TW
    python scripts/gen_cards.py --version 1.3.1 --animated   (outputs animated GIF per tool)

Output:
    docs/assets/cards/{toolId}-step{n}-{lang}.png
    docs/assets/gifs/{toolId}-demo.gif   (if --animated)

Requires: pip install Pillow
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ── Config ─────────────────────────────────────────────────────────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(REPO_ROOT, 'docs', 'tutorial_config.json')
OUTPUT_CARDS = os.path.join(REPO_ROOT, 'docs', 'assets', 'cards')
OUTPUT_GIFS = os.path.join(REPO_ROOT, 'docs', 'assets', 'gifs')

CARD_W, CARD_H = 1200, 630

# LoamLab brand palette
BG_COLOR = (9, 9, 11)           # #09090b — near black
SURFACE = (17, 17, 19)          # #111113 — card surface
BORDER = (255, 255, 255, 20)    # white/8
ACCENT = (251, 191, 36)         # amber-400 #fbbf24
TEXT_PRIMARY = (255, 255, 255)
TEXT_SECONDARY = (255, 255, 255, 128)  # white/50
TEXT_MUTED = (255, 255, 255, 64)       # white/25

# Font paths — fallback chain
FONT_PATHS = [
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def load_font(size):
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def get_lang(obj, lang):
    if not obj:
        return ''
    return obj.get(lang) or obj.get('en-US') or ''


def version_lte(a, b):
    def parts(v):
        return [int(x) for x in v.split('.')]
    return parts(a) <= parts(b)


def filter_steps(steps, version):
    return [s for s in steps
            if not s.get('deprecated') and version_lte(s.get('since', '0.0.0'), version)]


def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, outline_width=1):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill, outline=outline, width=outline_width)


def wrap_text(text, font, max_width, draw):
    """Wrap text to fit max_width."""
    words = text.split()
    lines = []
    current = []
    for word in words:
        test = ' '.join(current + [word])
        bbox = draw.textbbox((0, 0), test, font=font)
        w = bbox[2] - bbox[0]
        if w > max_width and current:
            lines.append(' '.join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(' '.join(current))
    return lines


def make_card(tool, step, lang, step_index, total_steps, version):
    """Create a single PIL Image card for one step."""
    img = Image.new('RGB', (CARD_W, CARD_H), BG_COLOR)
    draw = ImageDraw.Draw(img, 'RGBA')

    # ── Fonts ──────────────────────────────────────────────────────────────────
    font_huge = load_font(120)     # Big icon
    font_title = load_font(52)     # Step title
    font_desc = load_font(30)      # Step description
    font_meta = load_font(22)      # Meta / counter
    font_tool = load_font(26)      # Tool name
    font_brand = load_font(20)     # LoamLab brand tag

    # ── Background grid lines (subtle) ─────────────────────────────────────────
    for x in range(0, CARD_W, 60):
        draw.line([(x, 0), (x, CARD_H)], fill=(255, 255, 255, 5), width=1)
    for y in range(0, CARD_H, 60):
        draw.line([(0, y), (CARD_W, y)], fill=(255, 255, 255, 5), width=1)

    # ── Left: Visual / Icon area ───────────────────────────────────────────────
    left_w = 420
    draw_rounded_rect(draw, [40, 40, left_w - 20, CARD_H - 40], radius=20,
                      fill=SURFACE, outline=(255, 255, 255, 15), outline_width=1)

    icon = step.get('visual', {}).get('icon', '📋')
    # Centered in left panel
    ix = (left_w - 20 + 40) // 2
    iy = CARD_H // 2 - 10
    draw.text((ix, iy), icon, font=font_huge, anchor='mm', fill=TEXT_PRIMARY)

    # Step dots at bottom of icon panel
    dot_y = CARD_H - 80
    dot_spacing = 16
    dot_start_x = ix - ((total_steps - 1) * dot_spacing) // 2
    for i in range(total_steps):
        cx = dot_start_x + i * dot_spacing
        if i == step_index:
            draw.ellipse([cx - 5, dot_y - 5, cx + 5, dot_y + 5], fill=ACCENT)
        else:
            draw.ellipse([cx - 3, dot_y - 3, cx + 3, dot_y + 3], fill=(255, 255, 255, 40))

    # ── Right: Text content ────────────────────────────────────────────────────
    rx = left_w + 20
    rw = CARD_W - rx - 50
    ry = 60

    # Tool name + icon
    tool_icon = tool.get('icon', '')
    tool_title = get_lang(tool.get('title'), lang)
    draw.text((rx, ry), f"{tool_icon}  {tool_title}", font=font_tool,
              fill=(255, 255, 255, 100))

    # Step counter chip
    counter_text = f"Step {step['step']} of {total_steps}"
    cw_bbox = draw.textbbox((0, 0), counter_text, font=font_meta)
    cw = cw_bbox[2] - cw_bbox[0]
    chip_x = CARD_W - 50 - cw - 20
    chip_y = ry - 2
    draw_rounded_rect(draw, [chip_x - 10, chip_y - 4, chip_x + cw + 10, chip_y + 28],
                      radius=8, fill=(251, 191, 36, 30), outline=(251, 191, 36, 60))
    draw.text((chip_x, chip_y), counter_text, font=font_meta, fill=ACCENT)

    # Step title
    step_title = get_lang(step.get('title'), lang)
    ty = ry + 70
    draw.text((rx, ty), step_title, font=font_title, fill=TEXT_PRIMARY)

    # Accent underline
    title_bbox = draw.textbbox((rx, ty), step_title, font=font_title)
    draw.line([(rx, ty + title_bbox[3] - ty + 8), (rx + 60, ty + title_bbox[3] - ty + 8)],
              fill=ACCENT, width=3)

    # Step description (word wrapped)
    step_desc = get_lang(step.get('desc'), lang)
    desc_y = ty + title_bbox[3] - ty + 35
    wrapped = wrap_text(step_desc, font_desc, rw, draw)
    line_h = 42
    for line in wrapped[:5]:  # max 5 lines
        draw.text((rx, desc_y), line, font=font_desc, fill=(255, 255, 255, 160))
        desc_y += line_h

    # ── Bottom: Brand + version ────────────────────────────────────────────────
    draw.text((rx, CARD_H - 50), f"LoamLab  v{version}", font=font_brand,
              fill=(255, 255, 255, 40))

    # Accent border left edge
    draw.rectangle([0, 0, 4, CARD_H], fill=ACCENT)

    return img


def make_animated_gif(frames, output_path):
    """Save list of PIL Images as animated GIF."""
    if not frames:
        return
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=2500,  # 2.5s per frame
        loop=0,
        optimize=True
    )
    print(f'  [GIF] {os.path.basename(output_path)}')


def load_config():
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def main():
    if not PIL_AVAILABLE:
        print('[ERROR] Pillow not installed. Run: pip install Pillow', file=sys.stderr)
        sys.exit(1)

    parser = argparse.ArgumentParser(description='Generate LoamLab tutorial card images')
    parser.add_argument('--version', required=True, help='Plugin version (e.g. 1.3.1)')
    parser.add_argument('--lang', default=None, help='Single language (default: en-US only for cards)')
    parser.add_argument('--animated', action='store_true', help='Also output animated GIF per tool')
    args = parser.parse_args()

    version = args.version
    langs = [args.lang] if args.lang else ['en-US', 'zh-TW']  # Default: 2 languages for cards

    if not os.path.exists(CONFIG_PATH):
        print(f'[ERROR] tutorial_config.json not found', file=sys.stderr)
        sys.exit(1)

    config = load_config()
    all_tools = config.get('tools', [])
    live_tools = [t for t in all_tools
                  if t.get('live') and version_lte(t.get('since', '0.0.0'), version)]

    os.makedirs(OUTPUT_CARDS, exist_ok=True)
    if args.animated:
        os.makedirs(OUTPUT_GIFS, exist_ok=True)

    print(f'[gen_cards] v{version} | {len(live_tools)} tools | langs: {langs}')

    for tool in live_tools:
        tool_id = tool['id']
        steps = filter_steps(tool.get('steps', []), version)
        if not steps:
            continue

        for lang in langs:
            frames = []
            for i, step in enumerate(steps):
                img = make_card(tool, step, lang, i, len(steps), version)
                frames.append(img)

                # Save static card
                fname = f"{tool_id}-step{step['step']}-{lang}.png"
                out_path = os.path.join(OUTPUT_CARDS, fname)
                img.save(out_path)
                print(f'  [card] {fname}')

            # Animated GIF
            if args.animated:
                gif_name = tool.get('marketing', {}).get('gif_filename', f'{tool_id}-demo.gif')
                gif_path = os.path.join(OUTPUT_GIFS, gif_name.replace('.gif', f'-{lang}.gif'))
                make_animated_gif(frames, gif_path)

    print(f'[gen_cards] Done. Output: docs/assets/cards/')


if __name__ == '__main__':
    main()
