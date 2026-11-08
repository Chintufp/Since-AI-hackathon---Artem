"""Overlay cards for the v3 cut: the 'No fancy UI here' corner note and the MCP autonomy card (PIL, RGBA arrays)."""
import re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SF = '/System/Library/Fonts/SFNS.ttf'
MONO = '/System/Library/Fonts/SFNSMono.ttf'
BRUSH = 'M6 20 C40 8 80 4 140 5 C240 3 330 12 420 10 C510 8 580 3 690 4 C790 5 870 6 940 4 C988 3 1000 12 990 20 C978 30 900 33 800 33 C700 33 610 37 510 37 C410 37 330 31 230 32 C160 33 120 36 90 38 C60 39 30 36 12 32 C2 29 0 24 6 20 Z'

def font(size, weight=400, mono=False):
    f = ImageFont.truetype(MONO if mono else SF, size)
    if not mono:
        f.set_variation_by_axes([100, min(96, max(17, size * 0.75)), 400, weight])
    return f

def brush(draw, x, y, w, h, color=(252, 239, 138, 255)):
    nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', BRUSH)]
    pts, cur = [], (nums[0], nums[1]); i = 2; pts.append(cur)
    while i + 6 <= len(nums):
        p1, p2, p3 = (nums[i], nums[i + 1]), (nums[i + 2], nums[i + 3]), (nums[i + 4], nums[i + 5]); i += 6
        for k in range(1, 13):
            t = k / 12
            bx = (1 - t) ** 3 * cur[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0]
            by = (1 - t) ** 3 * cur[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]
            pts.append((bx, by))
        cur = p3
    draw.polygon([(x + px / 1000 * w, y + py / 40 * h) for px, py in pts], fill=color)

def card(lines, pad=(26, 22), radius=18, width=None, bg=(255, 255, 255, 246), shadow=True):
    """lines: [(text, font, color, highlight?)]; returns RGBA float array (0..1) incl. soft shadow margin."""
    m = 24 if shadow else 0
    sizes = [ln[1].getbbox(ln[0]) for ln in lines]
    w = width or max(b[2] - b[0] for b in sizes) + pad[0] * 2
    gap = 8
    h = sum((b[3] - b[1]) + gap for b in sizes) - gap + pad[1] * 2 + 6
    im = Image.new('RGBA', (w + 2 * m, h + 2 * m), (0, 0, 0, 0))
    if shadow:
        sh = Image.new('L', im.size, 0)
        ImageDraw.Draw(sh).rounded_rectangle((m, m + 6, m + w, m + h + 6), radius=radius, fill=70)
        im.putalpha(sh.filter(ImageFilter.GaussianBlur(12)))
        base = Image.new('RGBA', im.size, (20, 20, 30, 0)); base.putalpha(sh.filter(ImageFilter.GaussianBlur(12)))
        im = base
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((m, m, m + w, m + h), radius=radius, fill=bg, outline=(0, 0, 0, 40), width=1)
    y = m + pad[1]
    for (text, f, color, hl), b in zip(lines, sizes):
        if hl:
            tw = b[2] - b[0]; th = b[3] - b[1]
            brush(d, m + pad[0] - 6, y + th * 0.55, tw + 12, th * 0.75)
        d.text((m + pad[0] - b[0], y - b[1]), text, font=f, fill=color)
        y += (b[3] - b[1]) + gap
    return np.asarray(im).astype(np.float32) / 255.0

def no_fancy_ui():
    return card([("No fancy UI here.", font(30, 650), (17, 17, 17, 255), True),
                 ("Backend view, only for this demo.", font(21), (80, 80, 86, 255), False),
                 ("People only ever see Lumi.", font(21), (80, 80, 86, 255), False)])

def mcp_card():
    return card([("AUTONOMY OVER MCP", font(17, 650), (110, 110, 118, 255), False),
                 ("Any agent plugs in with one config entry.", font(27, 600), (17, 17, 17, 255), False),
                 ("12 tools: investigate, find people, ask a colleague, record outcomes", font(19), (80, 80, 86, 255), False),
                 ("The agent never contacts anyone directly: Lumi asks for it.", font(19), (80, 80, 86, 255), False)])

if __name__ == '__main__':
    for name, a in [('no-fancy-ui', no_fancy_ui()), ('mcp-card', mcp_card())]:
        Image.fromarray((a * 255).astype(np.uint8)).save(f'/private/tmp/claude-501/-Users-artevil-Since-AI-hackathon---Artem/63017ac0-f7e4-45c9-8e26-a11f1e3509fd/scratchpad/{name}.png')
        print(name, a.shape)

def tagline(text="Knowledge snowballs.", size=44):
    f = font(size, 500)
    b = f.getbbox(text)
    im = Image.new('RGBA', (b[2] - b[0] + 8, b[3] - b[1] + 16), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4 - b[0], 8 - b[1]), text, font=f, fill=(70, 70, 78, 255))
    return np.asarray(im).astype(np.float32) / 255.0
