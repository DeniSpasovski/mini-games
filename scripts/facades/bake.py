"""Bake the wall and roof tiles of the rally buildings (engine/facades/*.webp) from Poly Haven (CC0) scans.

usage: python3 scripts/facades/bake.py <dir with <id>_diff_1k.jpg or <id>.jpg> [out dir]

One 512 px tile covers one 3.2 m bay. Render and block are neutralised (grey, fixed brightness) because the vertex colour
supplies the paint; clay brick, rubble, brick and the roof keep their own colour (brick and roof darkened / lifted a little).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

SZ = 512
# tile: (Poly Haven id, scan size m, target brightness or None, colour kept 0..1, gamma, gain, contrast)
TILES = {
    'render': ('painted_plaster_wall', 2.0, 0.80, 0.0, 1.0, 1.0, 2.2),
    'clay_brick': ('brick_wall_006', 3.0, None, 1.0, 1.3, 1.0, 1.0),
    'brick_red': ('red_brick', 1.4, None, 1.0, 1.0, 1.0, 1.0),
    'rubble': ('plaster_stone_wall_02', 2.1, 0.66, 1.0, 1.0, 1.0, 1.0),
    'block': ('concrete_wall_007', 2.2, 0.78, 0.25, 1.0, 1.0, 1.0),
    'sheet': ('corrugated_iron_03', 2.0, 0.80, 0.2, 1.0, 1.0, 1.0),
    'slab': ('concrete_slab_wall', 2.3, 0.80, 0.2, 1.0, 1.0, 1.0),
    'ashlar': ('sandstone_blocks_05', 3.0, None, 1.0, 1.0, 1.0, 1.0),
    'siding': ('white_planks_clean', 1.8, 0.85, 0.0, 1.0, 1.0, 1.0),
    'roof_clay': ('clay_roof_tiles_03', 2.6, None, 1.0, 1.0, 1.2, 1.0),
}
# Scans repeated this often per tile (the rest is stretched): bay / scan size, at least 1.
BAY = 3.2


def find(src, pid):
    for name in (f'{pid}_diff_1k.jpg', f'{pid}.jpg'):
        p = os.path.join(src, name)
        if os.path.exists(p):
            return p
    raise SystemExit(f'missing scan {pid} in {src}')


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'src/games/rally/engine/facades'
    os.makedirs(out, exist_ok=True)
    for name, (pid, size, lum, sat, gamma, gain, contrast) in TILES.items():
        im = Image.open(find(src, pid)).convert('RGB')
        n = max(1, round(BAY / size))
        t = im.resize((SZ // n, SZ // n), Image.LANCZOS)
        a = np.asarray(t).astype(np.float32) / 255
        if n > 1:
            a = np.tile(a, (n, n, 1))[:SZ, :SZ]
        L = (a * [0.2126, 0.7152, 0.0722]).sum(2, keepdims=True)
        if sat < 1:
            a = L + (a - L) * sat
        if lum is not None:
            a = a * (lum / L.mean())
        a = np.clip(a, 0, 1) ** gamma * gain
        if contrast != 1.0:
            m = a.mean()
            a = (a - m) * contrast + m
        a = np.clip(a, 0, 1)
        Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, f'{name}.webp'), quality=82, method=6)
        print(name, pid, f'x{n}')


if __name__ == '__main__':
    main()
