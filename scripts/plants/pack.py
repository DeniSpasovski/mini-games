"""Packs the plant cells rendered by scripts/plants/bake-plants.mjs into the card atlases.

usage: python3 scripts/plants/pack.py <manifest.json> <repo root>   (bake-plants.mjs runs it)

Writes src/games/rally/engine/plants/<sheet>.webp and plant-atlas.data.ts: per sheet and per cell the measured mean
albedo (linear) of the covered texels, of the roots (lowest 30 % of the cell), of the tips (the top 40 % of the
covered rows) and of the body between them. The spring sheet is the green one (same layout) with its linear colour scaled to SPRING.
The autumn fern sheet is the fern one turned to dead bracken (`bracken`).
A bake of some sheets (`--sheets`) keeps the other sheets' atlases and data as they are.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

# Spring flush, linear: a little lighter and yellower than the summer scan (trees/Foliage.md: spring leaves sit at
# luminance 0.13-0.16, grass blades a little under the leaves). Applied as a per-channel gain on the green sheet's mean.
SPRING = np.array([0.085, 0.14, 0.04], dtype=np.float64)
LUMA = np.array([0.2126, 0.7152, 0.0722])


# Per-texel toning of the grass scans (linear), so the cards read as a meadow from afar:
# - green: the pale texels (seed stalks, dead blades: red >= green) go halfway to the sheet's leaf colour and stay
#   under PALE_MAX x its luminance, else the thin stalks turn the far cards white;
# - dry: the scan's dry map runs from orange bases (red / green ~1.5) to near-white tips; each texel's chroma goes
#   DRY_PULL of the way to one straw hue and its luminance range is compressed (DRY_CONTRAST) about the sheet mean.
PALE_PULL = 0.5
PALE_MAX = 1.3
STRAW = np.array([1.15, 1.0, 0.5])  # red / green, 1, blue / green
DRY_PULL = 0.75
DRY_CONTRAST = 0.6


def tone(sid, img):
    if sid not in ('grass-green', 'grass-dry'):
        return img
    cov = img[..., 3] > 0
    lin = to_lin(img[..., :3].astype(np.float64))
    px = lin[cov]
    lum = px @ LUMA
    if sid == 'grass-green':
        leafy = px[:, 1] > px[:, 0] * 1.05
        leaf = px[leafy].mean(axis=0)
        leaf_lum = float(leaf @ LUMA)
        pale = ~leafy
        target = leaf * (np.minimum(lum, PALE_MAX * leaf_lum) / leaf_lum)[:, None]
        px[pale] = px[pale] * (1 - PALE_PULL) + target[pale] * PALE_PULL
        over = (px @ LUMA) > PALE_MAX * leaf_lum
        px[over] *= (PALE_MAX * leaf_lum / (px[over] @ LUMA))[:, None]
    else:
        lum = np.maximum(lum, 1e-6)
        straw = STRAW / float(STRAW @ LUMA)
        chroma = px / lum[:, None] * (1 - DRY_PULL) + straw * DRY_PULL
        mean = float(lum.mean())
        px = chroma * (mean * (lum / mean) ** DRY_CONTRAST)[:, None]
    lin[cov] = px
    img = img.copy()
    img[..., :3] = np.round(to_srgb(lin)).astype(np.uint8)
    return img


# Dead bracken (autumn ferns), linear: rust brown (red / green, 1, blue / green), mean luminance and contrast about it.
BRACKEN = np.array([1.75, 1.0, 0.42])
BRACKEN_LUM = 0.11
BRACKEN_PULL = 0.85
BRACKEN_CONTRAST = 0.8


def bracken(img):
    """The fern sheet in autumn: each covered texel's chroma BRACKEN_PULL of the way to rust, its luminance about BRACKEN_LUM."""
    cov = img[..., 3] > 0
    lin = to_lin(img[..., :3].astype(np.float64))
    px = lin[cov]
    lum = np.maximum(px @ LUMA, 1e-6)
    rust = BRACKEN / float(BRACKEN @ LUMA)
    chroma = px / lum[:, None] * (1 - BRACKEN_PULL) + rust * BRACKEN_PULL
    mean = float(lum.mean())
    px = chroma * (BRACKEN_LUM * (lum / mean) ** BRACKEN_CONTRAST)[:, None]
    lin[cov] = px
    out = img.copy()
    out[..., :3] = np.round(to_srgb(lin)).astype(np.uint8)
    return out


def to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255.0


def means(cell):
    """Linear mean of a cell's covered texels: all, roots, tips (seed heads mostly) and the leafy body between."""
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
    m = lambda mask: lin[mask].mean(axis=0) if mask.any() else np.zeros(3)
    return m(a), m(root), m(tip), m(body)


def bleed(img):
    """Pushes the colour of covered texels into the transparent ones (filtering never pulls in black)."""
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


def committed(path):
    """The PLANT_SHEETS entries of the committed plant-atlas.data.ts (prettier's TS object literal -> JSON)."""
    if not os.path.exists(path):
        return {}
    src = open(path, encoding='utf8').read()
    body = src[src.index('PLANT_SHEETS = ') + len('PLANT_SHEETS = '):src.rindex(' as const')]
    body = re.sub(r"'([^']*)'", r'"\1"', body)
    body = re.sub(r'([{,]\s*)([A-Za-z_]\w*):', r'\1"\2":', body)
    body = re.sub(r',(\s*[}\]])', r'\1', body)
    return json.loads(body)


def r(v):
    return [round(float(x), 4) for x in v]


def main():
    manifest = json.load(open(sys.argv[1]))
    root = sys.argv[2]
    out_dir = os.path.join(root, 'src/games/rally/engine/plants')
    os.makedirs(out_dir, exist_ok=True)
    data = committed(os.path.join(out_dir, 'plant-atlas.data.ts'))
    sheets = {}
    for s in manifest['sheets']:
        cw, ch = s['cellW'], s['cellH']
        img = np.zeros((s['h'], s['w'], 4), dtype=np.uint8)
        for i, f in enumerate(s['files']):
            cell = np.frombuffer(open(f, 'rb').read(), dtype=np.uint8).reshape(ch, cw, 4)
            x, y = (i % s['cols']) * cw, (i // s['cols']) * ch
            img[y:y + ch, x:x + cw] = cell
        sheets[s['id']] = (s, tone(s['id'], img))
    if 'grass-green' in sheets:
        green_spec, green = sheets['grass-green']
        gm = means(green)[0]
        spring = green.copy()
        lin = to_lin(spring[..., :3].astype(np.float64)) * (SPRING / gm)
        spring[..., :3] = np.round(to_srgb(lin)).astype(np.uint8)
        sheets['grass-spring'] = ({**green_spec, 'id': 'grass-spring'}, spring)
    if 'ferns' in sheets:
        fern_spec, ferns = sheets['ferns']
        sheets['ferns-autumn'] = ({**fern_spec, 'id': 'ferns-autumn'}, bracken(ferns))
    for sid, (s, img) in sheets.items():
        cw, ch = s['cellW'], s['cellH']
        cells = []
        for i in range(s['cols'] * s['rows']):
            x, y = (i % s['cols']) * cw, (i // s['cols']) * ch
            m, ro, ti, bo = means(img[y:y + ch, x:x + cw])
            cells.append({'mean': r(m), 'root': r(ro), 'tip': r(ti), 'body': r(bo)})
        m, ro, ti, bo = means(img)
        # The blades' two colours: the leaves (greener than red) and the pale ones (dead blades, stalks, seed heads).
        cov = img[..., 3] >= 128
        lin = to_lin(img[..., :3].astype(np.float64))[cov]
        leafy = lin[:, 1] > lin[:, 0] * 1.05
        leaf = lin[leafy].mean(axis=0) if leafy.any() else bo
        pale = lin[~leafy].mean(axis=0) if (~leafy).any() else bo
        cover = float((img[..., 3] >= 128).mean())
        data[sid] = {
            'w': s['w'], 'h': s['h'], 'cols': s['cols'], 'rows': s['rows'], 'window': s['window'],
            'mean': r(m), 'root': r(ro), 'tip': r(ti), 'body': r(bo),
            'leaf': r(leaf), 'pale': r(pale), 'paleShare': round(float((~leafy).mean()), 3), 'cells': cells,
        }
        Image.fromarray(bleed(img), 'RGBA').save(
            os.path.join(out_dir, f'{sid}.webp'), 'WEBP', quality=90, method=6, exact=True)
        print(f'{sid}: mean {r(m)} lum {float(m @ LUMA):.3f} cover {cover:.2f}')
    ts = [
        '// Generated by scripts/plants/bake-plants.mjs (pack.py): the plant card atlases in engine/plants/*.webp.',
        '// Means are linear albedo of the covered texels: whole sheet / cell, roots (lowest 30 %), tips (top 40 %), body',
        '// (between the two).',
        '',
        f"export const LAYOUT_HASH = {manifest['hash']};",
        '',
        'export interface PlantCellMeans {',
        '  mean: [number, number, number];',
        '  root: [number, number, number];',
        '  tip: [number, number, number];',
        '  body: [number, number, number];',
        '}',
        '',
        'export interface PlantSheetInfo extends PlantCellMeans {',
        '  w: number;',
        '  h: number;',
        '  cols: number;',
        '  rows: number;',
        '  /** Blade colours: the leafy texels (green over red), the pale ones (dead blades, stalks) and their share. */',
        '  leaf: [number, number, number];',
        '  pale: [number, number, number];',
        '  paleShare: number;',
        '  /** What one cell shows: width x height (m). */',
        '  window: [number, number];',
        '  cells: PlantCellMeans[];',
        '}',
        '',
        'export const PLANT_SHEETS = ' + json.dumps(data, indent=2) + ' as const satisfies Record<string, PlantSheetInfo>;',
        '',
    ]
    open(os.path.join(out_dir, 'plant-atlas.data.ts'), 'w', encoding='utf8', newline='\n').write('\n'.join(ts))


main()
