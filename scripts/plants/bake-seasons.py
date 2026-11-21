"""Bakes the season sheets of the rally reed and weed cards from the committed atlases, per texel (not a colour multiply).

usage: python3 -I scripts/plants/bake-seasons.py [repo root]

Reads src/games/rally/engine/plants/reeds.webp and weeds.webp (baked by bake-plants.mjs from the CC BY reed / cattail
models and the CC0 nettle scan) and writes, in the same layouts:

- reeds-autumn.webp: the November stand. Each texel is classed as leaf / stem (green over red), pale dead leaf or
  plume / seed head (the dark brown heads in the upper part of a cell); leaves and stems keep their own shading
  (luminance against the class mean) on a new colour by height in the plant: olive green in the lower half, straw in
  the top third, a per-stem (texel column) mix between. Plumes go beige, dead leaves stay pale straw.
- reeds-winter.webp: last year's stand in spring: everything bleached straw-grey, the plumes grey-beige.
- weeds-rust.webp: dead docks / knotweed of the ditch banks in autumn, the nettle cells gone rust red and brown, their
  seed spikes dark red-brown.

It writes their means to season-sheets.data.ts (the shape of plant-atlas.data.ts). Deterministic: no randomness but
a fixed hash per texel column.
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..'))
PLANTS = os.path.join(ROOT, 'src', 'games', 'rally', 'engine', 'plants')


def to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255.0


def hex_lin(h):
    return to_lin(np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64))


def lum(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def column_hash(n, seed):
    """0..1 per texel column (a stem keeps one value up its length)."""
    x = np.arange(n, dtype=np.float64)
    return np.modf(np.sin(x * 12.9898 + seed * 78.233) * 43758.5453)[0] % 1.0


def column_noise(n, seed, width=6):
    """Column hash smoothed over a few texels (a stem is several texels wide)."""
    h = column_hash(n + width, seed)
    k = np.ones(width) / width
    return np.convolve(h, k, mode='valid')[:n]


def cells_of(img, cols, rows):
    h, w = img.shape[:2]
    ch, cw = h // rows, w // cols
    for r in range(rows):
        for c in range(cols):
            yield r * cols + c, (slice(r * ch, (r + 1) * ch), slice(c * cw, (c + 1) * cw))


def height_in_cell(cov):
    """0 at the cell's lowest covered row .. 1 at its highest, per texel row."""
    rows = np.nonzero(cov.any(axis=1))[0]
    h = cov.shape[0]
    if not len(rows):
        return np.zeros((h, cov.shape[1]))
    top, bot = rows.min(), rows.max()
    y = (bot - np.arange(h)) / max(1, bot - top)
    return np.clip(y, 0, 1)[:, None].repeat(cov.shape[1], axis=1)


def classes(lin, cov, hgt):
    """Masks: green leaf / stem, pale dead leaf, dark head (plume / seed spike)."""
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    L = lum(lin)
    green = cov & (g > r * 1.06)
    pale = cov & ~green & (L > 0.12)
    head = cov & ~green & ~pale
    return green, pale, head, L


def shade(L, mask):
    """Each texel's light against its class mean (keeps the scan's shading on the new colour)."""
    m = L[mask].mean() if mask.any() else 1.0
    return np.clip(L / max(m, 1e-4), 0.25, 2.2)


def recolour(img, cols, rows, look, seed):
    out = img.copy()
    rgb = to_lin(img[..., :3].astype(np.float64))
    res = rgb.copy()
    for ci, (ys, xs) in cells_of(img, cols, rows):
        cell = img[ys, xs]
        cov = cell[..., 3] > 0
        lin = rgb[ys, xs]
        hgt = height_in_cell(cov)
        green, pale, head, L = classes(lin, cov, hgt)
        # Heads only up top: a dark texel low in the plant is a shaded stem.
        low_dark = head & (hgt < 0.55)
        green |= low_dark
        head &= ~low_dark
        sg, sp, sh = shade(L, green), shade(L, pale), shade(L, head)
        col = column_noise(cell.shape[1], seed * 31 + ci)[None, :].repeat(cell.shape[0], 0)
        new = lin.copy()
        look(new, green, pale, head, sg, sp, sh, hgt, col)
        res[ys, xs] = np.where(cov[..., None], new, lin)
    out[..., :3] = np.round(to_srgb(res)).astype(np.uint8)
    return out


def paint(new, mask, colour, s):
    new[mask] = colour[None, :] * s[mask][:, None]


def autumn(new, green, pale, head, sg, sp, sh, hgt, col):
    olive = hex_lin('#5a6838')
    olive2 = hex_lin('#6b7040')
    straw = hex_lin('#a8956a')
    plume = hex_lin('#b9aa8c')
    dead = hex_lin('#b3a27c')
    # The leaf turns straw from about mid height up, each stem at its own height (col), all straw at the top.
    t = smooth(0.48 + 0.2 * col, 0.85 + 0.1 * col, hgt)
    base = olive[None, None, :] * (1 - col[..., None] * 0.6) + olive2[None, None, :] * (col[..., None] * 0.6)
    leaf = base * (1 - t[..., None]) + straw[None, None, :] * t[..., None]
    new[green] = leaf[green] * sg[green][:, None]
    paint(new, pale, dead, sp)
    paint(new, head, plume, sh * 0.9)


def winter(new, green, pale, head, sg, sp, sh, hgt, col):
    stem = hex_lin('#8e8466')
    grey = hex_lin('#a39a80')
    plume = hex_lin('#aaa18c')
    t = smooth(0.2, 0.8, hgt) * (0.6 + 0.4 * col)
    leaf = stem[None, None, :] * (1 - t[..., None]) + grey[None, None, :] * t[..., None]
    # Darker toward the foot (old wet stems).
    leaf *= (0.7 + 0.3 * smooth(0.0, 0.35, hgt))[..., None]
    new[green] = leaf[green] * sg[green][:, None]
    paint(new, pale, grey, sp)
    paint(new, head, plume, sh * 0.85)


def rust(new, green, pale, head, sg, sp, sh, hgt, col):
    red = hex_lin('#8e4a2c')
    brown = hex_lin('#735036')
    spike = hex_lin('#5e3220')
    # Whole plants red or browner (per column noise), the seed spikes up top darker.
    k = smooth(0.35, 0.65, col)
    leaf = red[None, None, :] * (1 - k[..., None]) + brown[None, None, :] * k[..., None]
    top = smooth(0.6, 0.85, hgt)[..., None]
    leaf = leaf * (1 - top) + spike[None, None, :] * top
    alls = green | pale
    s = np.where(green, sg, sp)
    new[alls] = leaf[alls] * s[alls][:, None]
    paint(new, head, spike, sh)


def bleed(img):
    rgb = img[..., :3].astype(np.float64)
    w = (img[..., 3] > 0).astype(np.float64)
    acc = rgb * w[..., None]
    wt = w.copy()
    out = rgb.copy()
    filled = w > 0
    for _ in range(24):
        if filled.all():
            break
        s = np.zeros_like(acc)
        n = np.zeros_like(wt)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s += np.roll(np.roll(acc, dy, 0), dx, 1)
            n += np.roll(np.roll(wt, dy, 0), dx, 1)
        new = (~filled) & (n > 0)
        out[new] = s[new] / n[new][:, None]
        acc[new] = out[new]
        wt[new] = 1
        filled |= new
    if not filled.all():
        out[~filled] = out[filled].mean(axis=0)
    img = img.copy()
    img[..., :3] = np.clip(np.round(out), 0, 255).astype(np.uint8)
    return img


def r4(v):
    return [round(float(x), 4) for x in v]


def means(cell):
    a = cell[..., 3] >= 128
    lin = to_lin(cell[..., :3].astype(np.float64))
    h = cell.shape[0]
    rows = np.nonzero(a.any(axis=1))[0]
    top = rows.min() if len(rows) else 0
    span = (h - top) if len(rows) else h
    yy = np.arange(h)[:, None].repeat(cell.shape[1], axis=1)
    root = a & (yy >= h - 0.3 * span)
    tip = a & (yy < top + 0.4 * span)
    body = a & ~root & ~tip
    m = lambda mask: r4(lin[mask].mean(axis=0) if mask.any() else np.zeros(3))
    return dict(mean=m(a), root=m(root), tip=m(tip), body=m(body))


def info(img, cols, rows, window):
    cov = img[..., 3] >= 128
    lin = to_lin(img[..., :3].astype(np.float64))
    leafy = cov & (lin[..., 1] > lin[..., 0])
    pale = cov & (lum(lin) > 0.25)
    avg = lambda m: r4(lin[m].mean(axis=0) if m.any() else lin[cov].mean(axis=0))
    whole = means(img)
    cells = [means(img[ys, xs]) for _, (ys, xs) in cells_of(img, cols, rows)]
    h, w = img.shape[:2]
    return dict(w=w, h=h, cols=cols, rows=rows, window=window, **whole, leaf=avg(leafy), pale=avg(pale),
                paleShare=round(float(pale.sum() / max(1, cov.sum())), 3), cells=cells)


def main():
    reeds = np.array(Image.open(os.path.join(PLANTS, 'reeds.webp')).convert('RGBA'))
    weeds = np.array(Image.open(os.path.join(PLANTS, 'weeds.webp')).convert('RGBA'))
    sheets = {
        'reeds-autumn': (recolour(reeds, 4, 2, autumn, 1), 4, 2, [1.2, 2.4]),
        'reeds-winter': (recolour(reeds, 4, 2, winter, 2), 4, 2, [1.2, 2.4]),
        'weeds-rust': (recolour(weeds, 4, 2, rust, 3), 4, 2, [0.6, 1.2]),
    }
    lines = [
        '// Generated by scripts/plants/bake-seasons.py: season sheets recoloured per texel from reeds.webp / weeds.webp.',
        '// Same shape as plant-atlas.data.ts (linear albedo means of the covered texels).',
        '',
        "import type { PlantSheetInfo } from './plant-atlas.data';",
        '',
        'export const SEASON_SHEETS = {',
    ]
    for sid, (img, cols, rows, window) in sheets.items():
        img = bleed(img)
        Image.fromarray(img).save(os.path.join(PLANTS, f'{sid}.webp'), 'WEBP', quality=90, method=6)
        i = info(img, cols, rows, window)
        lines.append(f"  '{sid}': {{")
        lines.append(f"    w: {i['w']},")
        lines.append(f"    h: {i['h']},")
        lines.append(f"    cols: {cols},")
        lines.append(f"    rows: {rows},")
        lines.append(f"    window: [{window[0]}, {window[1]}],")
        for k in ['mean', 'root', 'tip', 'body', 'leaf', 'pale']:
            lines.append(f"    {k}: [{', '.join(str(v) for v in i[k])}],")
        lines.append(f"    paleShare: {i['paleShare']},")
        lines.append('    cells: [')
        for c in i['cells']:
            lines.append('      {')
            for k in ['mean', 'root', 'tip', 'body']:
                lines.append(f"        {k}: [{', '.join(str(v) for v in c[k])}],")
            lines.append('      },')
        lines.append('    ],')
        lines.append('  },')
    lines.append('} as const satisfies Record<string, PlantSheetInfo>;')
    with open(os.path.join(PLANTS, 'season-sheets.data.ts'), 'w', encoding='utf8') as f:
        f.write('\n'.join(lines) + '\n')
    print('wrote', ', '.join(sheets))


if __name__ == '__main__':
    main()
