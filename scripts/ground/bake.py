"""Bake the terrain tiles of the rally ground (engine/ground/*.webp) from Poly Haven (CC0) scans.

usage: python3 scripts/ground/bake.py <dir with <id>_diff_1k.jpg or <id>.jpg> [out dir [tile names]]

One 512 px tile per layer, the whole scan (its size in metres is `SCAN` in engine/ground-textures.ts). The meadow tiles
are only a luminance / structure source: the terrain shader tints them to the season's grass colour, so they are
normalised to one mean brightness and kept slightly desaturated; soil, gravel, rock and leaves keep their own colour.
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
# darker and browner, so its linear colour is tinted and brought to this mean luminance (the scan's own is 0.233); mean sRGB 129 109 85.
GRAVEL_LUM = 0.17
GRAVEL_TINT = np.array([1.0, 0.90, 0.74], dtype=np.float32)
# tile: (Poly Haven id, mean linear luminance or None, colour kept 0..1, contrast around the mean, meadow hue 0..1)
TILES = {
    'grass_spring': ('forrest_ground_01', 0.077, 0.8, 1.0, 0.7),
    'grass_summer': ('grass_ground', 0.077, 0.8, 1.1, 0.7),
    'grass_autumn': ('leafy_grass', 0.077, 0.8, 1.0, 0.7),
    'soil': ('brown_mud_dry', None, 0.85, 1.0, 0),
    'gravel': ('rocky_trail', GRAVEL_LUM, 0.85, 1.0, 0),
    'rock': ('rock_boulder_dry', 0.22, 0.8, 1.0, 0),
    'litter': ('forest_leaves_04', None, 0.85, 1.0, 0),
    'leaves': ('leaves_forest_ground', None, 0.9, 1.0, 0),
    'stubble': ('withered_grass', 0.09, 0.6, 1.0, 0),
}


# Tiles whose stones are sharpened (unsharp mask): tile -> (amount, blur radius in m, scan size in m). The scan's own
# stones are 1 - 3 px from the chase camera and mip away; the gravel road (world/gravel-road.ts) is this layer too.
DETAIL = {'gravel': (0.4, 0.03, 2.0)}


def blur(a, sigma):
    """Gaussian blur of an (h, w, c) array, wrapping round the tile edges."""
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        a = sum(w * np.roll(a, i - r, axis=axis) for i, w in enumerate(k))
    return a


def find(src, pid):
    for name in (f'{pid}_diff_1k.jpg', f'{pid}.jpg'):
        p = os.path.join(src, name)
        if os.path.exists(p):
            return p
    raise SystemExit(f'missing scan {pid} in {src}')


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
        if name in DETAIL:
            amount, radius, scan = DETAIL[name]
            a = np.maximum(a + (a - blur(a, radius * SZ / scan)) * amount, 0)
        if lum is not None:
            a = a * (lum / (a * LUMA).sum(2).mean())
        a = lin_to_srgb(np.clip(a, 0, 1))
        Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, f'{name}.webp'), quality=80, method=6)
        print(name, pid, round(float((srgb_to_lin(a) * LUMA).sum(2).mean()), 3))


if __name__ == '__main__':
    main()
