"""Bakes the thistle card atlases (engine/plants/thistle-*.webp + thistle.data.ts) for the rally's canal banks.

usage: python3 scripts/plants/bake-thistle.py <dir with plant-render.png and leaf-sheet.png> [repo root]

The sources are AI-generated reference images (a thistle plant on white, a sheet of thistle leaves on grey). Heads are
cut from the plant, leaves from the sheet, and each season's plants are composed from them (seeded, so a bake is the
same on every machine): `green` = young plants and rosettes (spring), `dry` = the straw-brown stand with pale seed heads
(summer: biennial thistles dry out by July), `autumn` = grey-brown skeletons with torn heads.
Every sheet is 1024 x 512, four cells of 0.8 x 1.6 m in a row (256 x 512 px). Writes thistle-<season>.webp and
thistle.data.ts (the same info shape as plant-atlas.data.ts: linear mean albedo of the covered texels, roots / body / tips).
"""
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

SRC = sys.argv[1]
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'src', 'games', 'rally', 'engine', 'plants')
CELL_W, CELL_H = 256, 512
SS = 2  # supersampling
SEASONS = ['green', 'dry', 'autumn']


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def cut_leaves(path):
    """The sheet's leaves as RGBA sprites (soft alpha against the grey ground)."""
    a = np.array(Image.open(path).convert('RGB')).astype(float)
    bg = np.median(a[:30, :30].reshape(-1, 3), axis=0)
    d = np.abs(a - bg).sum(2)
    m = ndi.binary_opening(d > 45)
    lab, n = ndi.label(m)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h < 60:
            continue
        mm = ndi.binary_fill_holes(lab[sl] == i + 1)
        alpha = np.clip((d[sl] - 25) / 60, 0, 1) * ndi.binary_dilation(mm, iterations=2)
        alpha = np.maximum(alpha, mm * 0.0)
        alpha = np.where(mm, np.maximum(alpha, 0.0), alpha)
        rgba = np.dstack([a[sl], alpha * 255]).astype(np.uint8)
        out.append(Image.fromarray(rgba, 'RGBA'))
    return out


def cut_heads(path):
    """Three heads cut from the plant render: (sprite, anchor = the stalk foot at the bottom centre)."""
    im = Image.open(path).convert('RGB')
    boxes = [(600, 10, 840, 262), (505, 95, 650, 272), (780, 145, 900, 300)]
    heads = []
    for box in boxes:
        a = np.array(im.crop(box)).astype(float)
        d = 765 - a.sum(2)
        m = ndi.binary_opening(d > 60)
        lab, n = ndi.label(ndi.binary_dilation(m, iterations=2))
        if n == 0:
            continue
        sizes = ndi.sum(m, lab, range(1, n + 1))
        big = lab == (1 + int(np.argmax(sizes)))
        alpha = np.clip((d - 30) / 90, 0, 1) * ndi.binary_dilation(big, iterations=2)
        ys, xs = np.where(alpha > 0.3)
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        # un-premultiply the white ground out of the edge texels
        rgb = a.copy()
        al = np.clip(alpha, 0.05, 1)[..., None]
        rgb = np.clip((rgb - 245 * (1 - al)) / al, 0, 255)
        heads.append(Image.fromarray(np.dstack([rgb, alpha * 255])[sl].astype(np.uint8), 'RGBA'))
    return heads


def recolour(sprite, season, kind, rng):
    """Season colours: leaves and heads from the green / purple sprites (recolouring plants is fine)."""
    a = np.array(sprite).astype(float)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    lum = (0.3 * r + 0.55 * g + 0.15 * b)
    purple = (r > g + 18) & (b > g + 8)
    if season == 'green':
        if kind == 'head':  # buds: no flower yet, green spiky balls
            rgb = np.stack([r, np.where(purple, g * 1.5 + 25, g), np.where(purple, b * 0.55, b)], -1)
            a[..., :3] = np.clip(rgb, 0, 255)
        else:
            a[..., 0] = np.clip(r * 1.12, 0, 255)
            a[..., 1] = np.clip(g * 1.2, 0, 255)
            a[..., 2] = np.clip(b * 0.95, 0, 255)
    elif season == 'dry':
        if kind == 'head':
            tan = np.stack([lum * 1.75 + 52, lum * 1.5 + 44, lum * 0.95 + 26], -1)
            cream = np.stack([lum * 0.5 + 165, lum * 0.42 + 154, lum * 0.32 + 122], -1)
            a[..., :3] = np.where(purple[..., None], cream, tan)
        else:
            k = rng.uniform(0.0, 0.45)  # a share stays olive-grey
            dry = np.stack([lum * 1.5 + 42, lum * 1.3 + 38, lum * 0.8 + 20], -1)
            a[..., :3] = dry * (1 - k) + a[..., :3] * k + np.array([22, 18, 6]) * k
    else:  # autumn: grey-brown, dead
        if kind == 'head':
            hd = np.stack([lum * 1.1 + 52, lum * 0.98 + 46, lum * 0.78 + 36], -1)
            br = np.stack([lum * 0.75 + 78, lum * 0.66 + 70, lum * 0.55 + 56], -1)
            a[..., :3] = np.where(purple[..., None], br, hd)
        else:
            a[..., :3] = np.stack([lum * 1.35 + 40, lum * 1.15 + 35, lum * 0.85 + 24], -1)
    a[..., :3] = np.clip(a[..., :3], 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def paste(canvas, sprite, x, y, ang, height, rng, flip=False):
    """Sprite with its bottom centre on (x, y), turned `ang` degrees clockwise from up, scaled to `height` px."""
    s = height / sprite.height
    sp = sprite.resize((max(1, int(sprite.width * s)), max(1, int(sprite.height * s))), Image.LANCZOS)
    if flip:
        sp = sp.transpose(Image.FLIP_LEFT_RIGHT)
    pad = Image.new('RGBA', (sp.width * 2, sp.height * 2), (0, 0, 0, 0))
    pad.paste(sp, (sp.width // 2, 0))
    # pivot = bottom centre of the sprite, at (w, h*... ) in pad
    pivot = (pad.width / 2, sp.height)
    rot = pad.rotate(-ang, resample=Image.BICUBIC, center=pivot)
    canvas.alpha_composite(rot, (int(x - pivot[0]), int(y - pivot[1])))


def stem(draw_img, pts, w0, w1, col):
    from PIL import ImageDraw
    d = ImageDraw.Draw(draw_img)
    n = len(pts) - 1
    for i in range(n):
        t = i / max(1, n - 1)
        w = max(1, int((w0 + (w1 - w0) * t)))
        d.line([pts[i], pts[i + 1]], fill=col, width=w)


def plant_cell(season, leaves, heads, rng, variant):
    """One cell: a clump of 2 - 3 plants side by side (the stands in the photos are bushy), drawn back to front."""
    W, H = CELL_W * SS, CELL_H * SS
    cv = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if season == 'green' and variant < 2:
        plant(cv, season, leaves, heads, rng, variant, W / 2 + rng.uniform(-14, 14) * SS, 1.0, 1.5)
    else:
        n = 1 if season == 'green' else rng.choice([2, 3, 3])
        xs = sorted(W / 2 + (i - (n - 1) / 2) * 46 * SS + rng.uniform(-14, 14) * SS for i in range(n))
        order = list(range(n))
        rng.shuffle(order)
        for k in order:
            hf = rng.uniform(0.72, 1.0) if season != 'green' else 1.0
            plant(cv, season, leaves, heads, rng, variant, xs[k], hf, 1.0)
    return cv.resize((CELL_W, CELL_H), Image.LANCZOS)


def plant(cv, season, leaves, heads, rng, variant, base_x, hf, sf):
    W, H = cv.size
    foot = H - 6 * SS
    rosette = season == 'green' and variant < 2
    leaf_h = lambda t: (150 - 70 * t) * SS * sf * 1.15 * rng.uniform(0.85, 1.1)  # lower leaves bigger
    stem_col = {'green': (92, 116, 62, 255), 'dry': (150, 132, 88, 255), 'autumn': (98, 88, 70, 255)}[season]
    if rosette:
        # a low fan of leaves out of the root: 9 leaves, 14 - 40 cm
        for i in range(9):
            ang = -84 + 168 * i / 8 + rng.uniform(-8, 8)
            lf = recolour(rng.choice(leaves), season, 'leaf', rng)
            hh = (rng.uniform(95, 150) * (1 - 0.35 * abs(ang) / 84)) * SS * sf
            paste(cv, lf, base_x, foot, ang, hh, rng, flip=rng.random() < 0.5)
        return
    top = H * (1 - hf * rng.uniform(0.80, 0.86))
    if season == 'green':
        top = H * rng.uniform(0.42, 0.55)  # young plant: half height
    lean = rng.uniform(-14, 14) * SS
    pts = []
    for i in range(0, 21):
        t = i / 20
        pts.append((base_x + lean * t * t, foot + (top - foot) * t))
    stem(cv, pts, 6 * SS, 3 * SS, stem_col)
    # leaves along the lower 70 % of the stem
    nl = {'green': 9, 'dry': 9, 'autumn': 3}[season] + rng.randint(-1, 2)
    for i in range(nl):
        t = 0.04 + 0.62 * i / max(1, nl - 1)
        px = base_x + lean * t * t
        py = foot + (top - foot) * t
        side = 1 if i % 2 == 0 else -1
        ang = side * rng.uniform(32, 68)
        lf = recolour(rng.choice(leaves), season, 'leaf', rng)
        paste(cv, lf, px, py, ang, leaf_h(t) * (0.8 if season == 'green' else 1.0), rng, flip=side < 0)
    # branches with heads in the upper half
    nb = {'green': 2, 'dry': 4, 'autumn': 3}[season] + rng.randint(0, 1)
    tips = [(pts[-1][0], pts[-1][1], 0.0)]
    for i in range(nb):
        t = rng.uniform(0.55, 0.85)
        px = base_x + lean * t * t
        py = foot + (top - foot) * t
        side = 1 if i % 2 == 0 else -1
        ang = side * rng.uniform(18, 38)
        ln = (foot - py) * rng.uniform(0.22, 0.4)
        ex, ey = px + math.sin(math.radians(ang)) * ln, py - math.cos(math.radians(ang)) * ln
        stem(cv, [(px, py), (ex, ey)], 4 * SS, 2 * SS, stem_col)
        tips.append((ex, ey, ang))
    scale = {'green': 0.8, 'dry': 1.0, 'autumn': 0.75}[season]
    for (ex, ey, ang) in tips:
        hd = recolour(rng.choice(heads), season, 'head', rng)
        hh = rng.uniform(52, 66) * SS * scale
        paste(cv, hd, ex, ey + 3 * SS, ang * 0.5, hh, rng, flip=rng.random() < 0.5)


def bleed(img):
    """Fill the fully transparent texels with the nearest colour (no dark fringes from mips and filtering)."""
    a = np.array(img)
    m = a[..., 3] > 8
    idx = ndi.distance_transform_edt(~m, return_distances=False, return_indices=True)
    rgb = a[..., :3][idx[0], idx[1]]
    a[..., :3] = np.where(m[..., None], a[..., :3], rgb)
    return Image.fromarray(a, 'RGBA')


def means(rgba):
    a = rgba.astype(float)
    cov = a[..., 3] > 128
    if not cov.any():
        return [0, 0, 0]
    return [round(float(v), 4) for v in srgb_to_lin(a[..., :3][cov]).mean(0)]


def cell_means(rgba):
    cov = rgba[..., 3] > 128
    ys = np.where(cov.any(1))[0]
    top, bot = ys.min(), ys.max()
    span = bot - top + 1
    def band(y0, y1):
        m = np.zeros_like(cov)
        m[int(y0):int(y1) + 1] = cov[int(y0):int(y1) + 1]
        sub = rgba.copy()
        sub[..., 3] = np.where(m, 255, 0)
        return means(sub)
    return {
        'mean': means(rgba),
        'root': band(bot - span * 0.3, bot),
        'tip': band(top, top + span * 0.4),
        'body': band(top + span * 0.4, bot - span * 0.3),
    }


def main():
    leaves = cut_leaves(os.path.join(SRC, 'leaf-sheet.png'))
    heads = cut_heads(os.path.join(SRC, 'plant-render.png'))
    print(len(leaves), 'leaves', len(heads), 'heads')
    info = {}
    for si, season in enumerate(SEASONS):
        rng = random.Random(4100 + si)
        sheet = Image.new('RGBA', (CELL_W * 4, CELL_H), (0, 0, 0, 0))
        for v in range(4):
            sheet.paste(plant_cell(season, leaves, heads, rng, v), (v * CELL_W, 0))
        sheet = bleed(sheet)
        sheet.save(os.path.join(OUT, f'thistle-{season}.webp'), quality=90, alpha_quality=100, method=6)
        arr = np.array(sheet)
        cells = [cell_means(arr[:, v * CELL_W:(v + 1) * CELL_W]) for v in range(4)]
        whole = cell_means(arr)
        cov = arr[..., 3] > 128
        lin = srgb_to_lin(arr[..., :3].astype(float))
        leafy = cov & (lin[..., 1] > lin[..., 0] * 0.98)
        pale = cov & (lin.mean(2) > 0.25)
        def avg(m):
            return [round(float(v), 4) for v in lin[m].mean(0)] if m.any() else whole['mean']
        info[season] = dict(
            **whole, leaf=avg(leafy), pale=avg(pale), paleShare=round(float(pale.sum() / max(1, cov.sum())), 3), cells=cells
        )
    lines = [
        '// Generated by scripts/plants/bake-thistle.py: the thistle card atlases in engine/plants/thistle-*.webp.',
        '// Same shape as plant-atlas.data.ts (linear albedo means of the covered texels).',
        '',
        "import type { PlantSheetInfo } from './plant-atlas.data';",
        '',
        'export const THISTLE_SHEETS = {',
    ]
    for season in SEASONS:
        i = info[season]
        lines.append(f"  'thistle-{season}': {{")
        lines.append(f"    w: {CELL_W * 4},\n    h: {CELL_H},\n    cols: 4,\n    rows: 1,\n    window: [0.8, 1.6],")
        for k in ['mean', 'root', 'tip', 'body', 'leaf', 'pale']:
            lines.append(f'    {k}: {i[k]},')
        lines.append(f"    paleShare: {i['paleShare']},")
        lines.append('    cells: [')
        for c in i['cells']:
            lines.append(f"      {{ mean: {c['mean']}, root: {c['root']}, tip: {c['tip']}, body: {c['body']} }},")
        lines.append('    ],')
        lines.append('  },')
    lines.append('} satisfies Record<string, PlantSheetInfo>;')
    with open(os.path.join(OUT, 'thistle.data.ts'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('done')


main()
