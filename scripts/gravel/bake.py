"""Bake the gravel road tile (engine/asphalt/road.<size>.{color,normal,rough}.webp) from the Poly Haven "Rocky Trail"
scan (CC0, Amal Kumar).

usage: python3 scripts/gravel/bake.py <dir with rocky_trail_{diff,nor_gl,rough,disp}_2k.jpg>

The tile is the whole road: u across it (0 = right edge, 1 = left edge, about 6 m), v along it (`LEN` m, =
ROAD_SURFACE_LEN.road). The 2 m scan is laid at its real size, each 2 m cell from another spot of the scan (the cells
cross-fade), so it does not read as a grid. Two wheel ruts (`RUTS`) are packed down: loose stones blurred away, flatter
and smoother, but the same colour as the loose gravel around them (the difference is in the relief, not the hue); the
edges are the same gravel as the verge (the road shader fades them out into it, engine/road-surface.ts).
"""
import os
import sys

import numpy as np
from PIL import Image

SCAN_M = 2.0
WIDTH_M = 6.0
LEN = 6.0
RUTS = (0.29, 0.71)
RUT_HALF = 0.085  # half width of a rut (fraction of the road)
LUM = 0.233  # mean linear luminance of the colour tile: the ground gravel layer's (GROUND_MEAN.gravel), so road and verge match
SAT = 0.85  # colour kept: the ground gravel layer's (scripts/ground/bake.py), the road and the verge are one gravel
CONTRAST = 1.0  # stones against the fines, around the mean: as the ground gravel layer
SIZES = (1024, 512)
LUMA = np.array([0.2126, 0.7152, 0.0722])


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 1e-6), 1 / 2.4) - 0.055)


def load(src, part, n):
    im = Image.open(os.path.join(src, f'rocky_trail_{part}_2k.jpg')).convert('RGB').resize((n, n), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64) / 255


def blur(a, sigma):
    """Gaussian blur of an (h, w, c) array, wrapping round the tile edges."""
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        a = sum(w * np.roll(a, i - r, axis=axis) for i, w in enumerate(k))
    return a


def lay(scan, size, rng):
    """The scan laid in 2 m cells over the tile, each cell from a random offset, cells cross-faded (the scan tiles)."""
    n = scan.shape[0]  # px per 2 m
    cells = int(round(WIDTH_M / SCAN_M))
    out = np.zeros((size, size, scan.shape[2]))
    wsum = np.zeros((size, size, 1))
    ys, xs = np.mgrid[0:size, 0:size]
    for cy in range(cells):
        for cx in range(cells):
            ox, oy = rng.integers(0, n, 2)
            # Cell weight: a soft bump centred on the cell, wrapping across the tile edges.
            fx = (xs / size * cells - cx - 0.5 + cells / 2) % cells - cells / 2
            fy = (ys / size * cells - cy - 0.5 + cells / 2) % cells - cells / 2
            w = (np.clip(1.25 - np.abs(fx) * 1.5, 0, 1) * np.clip(1.25 - np.abs(fy) * 1.5, 0, 1))[..., None] ** 2
            sx = ((xs * n * cells / size).astype(int) + ox) % n
            sy = ((ys * n * cells / size).astype(int) + oy) % n
            out += scan[sy, sx] * w
            wsum += w
    return out / np.maximum(wsum, 1e-6)


def rut_mask(size):
    u = (np.arange(size) + 0.5) / size
    m = np.zeros(size)
    for r in RUTS:
        m = np.maximum(m, np.clip(1 - np.abs(u - r) / RUT_HALF, 0, 1))
    m = m ** 0.7
    return m[None, :, None].repeat(size, 0)


def main():
    src = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), '../../src/games/rally/engine/asphalt')
    for size in SIZES:
        n = int(round(size * SCAN_M / WIDTH_M))
        rng = np.random.default_rng(7)
        col = lay(lin(load(src, 'diff', n)), size, np.random.default_rng(7))
        nor = lay(load(src, 'nor_gl', n) * 2 - 1, size, np.random.default_rng(7))
        rough = lay(load(src, 'rough', n)[..., :1], size, np.random.default_rng(7))
        rut = rut_mask(size)
        L = (col @ LUMA)[..., None]
        col = np.maximum(L + (col - L) * SAT, 0)
        col = np.maximum(col + (L - L.mean()) * (CONTRAST - 1), 0)
        # Packed ruts: the loose stones blurred away (linear light, wrapping: the mean colour stays), the same colour as
        # the loose gravel around them; only the stones' relief goes.
        col = col * (1 - rut * 0.85) + blur(col, size / 160) * rut * 0.85
        col = col * (LUM / (col @ LUMA).mean())
        nor[..., :2] *= (1 - rut * 0.6)
        nor[..., 2] = np.sqrt(np.clip(1 - nor[..., 0] ** 2 - nor[..., 1] ** 2, 0, 1))
        rough = np.clip(rough * (1 - rut * 0.2), 0, 1)
        Image.fromarray((srgb(np.clip(col, 0, 1)) * 255 + 0.5).astype(np.uint8)).save(
            os.path.join(out, f'road.{size}.color.webp'), quality=85, method=6)
        Image.fromarray(((nor * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(
            os.path.join(out, f'road.{size}.normal.webp'), quality=90, method=6)
        r = (rough[..., 0] * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.stack([r, r, r], -1)).save(os.path.join(out, f'road.{size}.rough.webp'), quality=85, method=6)
        print(size, 'mean lum', round(float((col @ LUMA).mean()), 3))


main()
