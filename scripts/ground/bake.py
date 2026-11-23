"""Bake the terrain tiles of the rally ground (engine/ground/*.webp) from Poly Haven (CC0) scans.

usage: python3 -I scripts/ground/bake.py <dir with <id>/<id>_diff_1k.jpg (+ _nor_gl_1k.jpg, _rough_1k.jpg)> [out dir [tile names]]
(the scans live in sources/rally/polyhaven/<id>/; a flat dir with <id>_diff_1k.jpg or <id>.jpg works too)

One 512 px tile per layer, the whole scan (its size in metres is `SCAN` in engine/ground-textures.ts). The meadow tiles
are only a luminance / structure source: the terrain shader tints them to the season's grass colour, so they are
normalised to one mean brightness and keep a good part of their own colour (straw, green and soil specks: the shader's
tint scales it, it does not repaint it); soil, gravel, rock and leaves keep their own colour.

With the scan's roughness map (`<id>_rough_1k.jpg`) the colour tile carries the roughness in its alpha (WebP alpha
quality 50: ~0.01 off, a quarter smaller than lossless): the scan's own pattern (stone tops smoother than the dust
between them) moved to a dry-ground mean (`ROUGH`), since the scans' raw values (dry soil 0.5) read as wet plastic
under a low sun.

With the scan's OpenGL normal map (`<id>_nor_gl_1k.jpg`), each tile also gets `<name>_n.webp`: its normals at the same
512 px as two grey halves side by side (x left, y right; z is rebuilt by the shader). Grey, because lossy WebP keeps
luma at full resolution but halves red / green (4:2:0): an RGB normal tile at q85 was ~8-12 degrees off on gravel and
soil (p99 30-40), the grey pair at q90 ~1.2 (p99 3), at a third of a lossless tile's size.
"""
import os
import sys

import numpy as np
from PIL import Image

SZ = 512
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
# Colour of the old procedural meadow tile relative to its luminance (linear): the meadow scans take it, so every map's
# `groundTint` (chosen against that tile) keeps its look; the scans bring the structure.
MEADOW = np.array([0.85, 1.08, 0.30], dtype=np.float32)
# The gravel road and verge: the scan's own colour is light tan (mean sRGB 147 128 107); a compacted road of the region reads
# darker and browner, so its linear colour is tinted and brought to this mean luminance (the scan's own is 0.233); mean sRGB 121 101 77.
GRAVEL_LUM = 0.145
GRAVEL_TINT = np.array([1.0, 0.88, 0.70], dtype=np.float32)
# The pine floor: the scan's needles are pale tan; an old black-pine carpet reads darker and more russet.
NEEDLE_TINT = np.array([1.06, 0.95, 0.82], dtype=np.float32)
# tile: (Poly Haven id, mean linear luminance or None, colour kept 0..1, contrast around the mean, meadow hue 0..1)
TILES = {
    'grass_spring': ('forrest_ground_01', 0.077, 0.95, 1.0, 0.35),
    'grass_summer': ('grass_ground', 0.077, 0.95, 1.1, 0.35),
    'grass_autumn': ('leafy_grass', 0.077, 0.95, 1.0, 0.35),
    'soil': ('brown_mud_dry', None, 0.85, 1.0, 0),
    'gravel': ('rocky_trail', GRAVEL_LUM, 0.85, 1.0, 0),
    'rock': ('rock_boulder_dry', 0.22, 0.8, 1.0, 0),
    'litter': ('forest_leaves_04', None, 0.85, 1.0, 0),
    'leaves': ('leaves_forest_ground', None, 0.9, 1.0, 0),
    'stubble': ('withered_grass', 0.09, 0.6, 1.0, 0),
    'needles': ('forrest_ground_03', 0.105, 0.95, 1.15, 0),
}


# Tiles whose stones are sharpened (unsharp mask): tile -> (amount, blur radius in m, scan size in m). The scan's own
# stones are 1 - 3 px from the chase camera and mip away; the gravel road (world/gravel-road.ts) is this layer too.
DETAIL = {'gravel': (0.4, 0.03, 2.0)}

# Roughness: tile -> (mean, spread p5..p95). Dry ground is near fully rough; stones (gravel, rock) and waxy needles /
# straw / leaves a little less, so their tops catch a low sun. The terrain shader fades it to its flat 0.96 by ~45 m.
ROUGH = {
    'grass_spring': (0.93, 0.08),
    'grass_summer': (0.93, 0.08),
    'grass_autumn': (0.92, 0.08),
    'soil': (0.93, 0.1),
    'gravel': (0.86, 0.2),
    'rock': (0.84, 0.2),
    'litter': (0.88, 0.14),
    'leaves': (0.84, 0.14),
    'stubble': (0.86, 0.12),
    'needles': (0.86, 0.12),
}
NORMAL_Q = 90


def blur(a, sigma):
    """Gaussian blur of an (h, w, c) array, wrapping round the tile edges."""
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        a = sum(w * np.roll(a, i - r, axis=axis) for i, w in enumerate(k))
    return a


def find(src, pid, kind='diff', required=True):
    names = [f'{pid}_{kind}_1k.jpg'] + ([f'{pid}.jpg'] if kind == 'diff' else [])
    for d in (os.path.join(src, pid), src):
        for name in names:
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
    if required:
        raise SystemExit(f'missing scan {pid} in {src}')
    return None


def roughness(path, mean, spread):
    """The scan's roughness at SZ, its p5..p95 spread scaled to `spread` around `mean` (8 bit)."""
    r = np.asarray(Image.open(path).convert('L').resize((SZ, SZ), Image.LANCZOS)).astype(np.float32) / 255
    lo, hi = np.percentile(r, [5, 95])
    r = mean + (r - r.mean()) * spread / max(hi - lo, 1e-3)
    return (np.clip(r, 0.5, 1.0) * 255 + 0.5).astype(np.uint8)


def srgb_to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 1e-6), 1 / 2.4) - 0.055)


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'src/games/rally/engine/ground'
    os.makedirs(out, exist_ok=True)
    only = sys.argv[3:]
    for name, (pid, lum, sat, contrast, meadow) in TILES.items():
        if only and name not in only:
            continue
        im = Image.open(find(src, pid)).convert('RGB').resize((SZ, SZ), Image.LANCZOS)
        a = srgb_to_lin(np.asarray(im).astype(np.float32) / 255)
        L = (a * LUMA).sum(2, keepdims=True)
        a = L + (a - L) * sat
        if meadow:
            a = a * (1 - meadow) + L * MEADOW * meadow
        if contrast != 1.0:
            m = L.mean()
            a = np.maximum((a - m) * contrast + m, 0)
        if name == 'gravel':
            a = a * GRAVEL_TINT
        if name == 'needles':
            a = a * NEEDLE_TINT
        if name in DETAIL:
            amount, radius, scan = DETAIL[name]
            a = np.maximum(a + (a - blur(a, radius * SZ / scan)) * amount, 0)
        if lum is not None:
            a = a * (lum / (a * LUMA).sum(2).mean())
        a = lin_to_srgb(np.clip(a, 0, 1))
        rgb = (a * 255 + 0.5).astype(np.uint8)
        rough = find(src, pid, 'rough', False)
        if rough:
            rgba = np.dstack([rgb, roughness(rough, *ROUGH[name])])
            Image.fromarray(rgba, 'RGBA').save(os.path.join(out, f'{name}.webp'), quality=80, alpha_quality=50, method=6)
        else:
            Image.fromarray(rgb).save(os.path.join(out, f'{name}.webp'), quality=80, method=6)
        print(name, pid, round(float((srgb_to_lin(a) * LUMA).sum(2).mean()), 3), 'rough' if rough else 'no rough')
        nor = find(src, pid, 'nor_gl', False)
        if nor:
            n = np.asarray(Image.open(nor).convert('RGB').resize((SZ, SZ), Image.LANCZOS)).astype(np.float32) / 255 * 2 - 1
            n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
            n = (np.clip(n * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)
            Image.fromarray(np.concatenate([n[..., 0], n[..., 1]], axis=1), 'L').save(
                os.path.join(out, f'{name}_n.webp'), quality=NORMAL_Q, method=6
            )


if __name__ == '__main__':
    main()
