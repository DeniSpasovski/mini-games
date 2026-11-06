"""Bake the heap tiles of the rally piles (sand / crushed stone, engine/props/pile-*.webp) from Poly Haven (CC0) scans.

usage: python scripts/props/bake-piles.py <dir with <id>/<id>_diff_1k.jpg> [out dir]   (e.g. sources/rally/polyhaven)

One 512 px tile per pile material (the landmark kit keys `sand` / `aggregate`, maps/shared/piles.ts): the scan resized,
its mean brightness set and a little of its colour kept (the vertex colour tints each pile), seams kept (the scans tile).
"""
import os
import sys

import numpy as np
from PIL import Image

SZ = 512
# tile: (Poly Haven id, target mean brightness 0..1, colour kept 0..1, contrast)
TILES = {
    'pile-sand': ('dense_sand', 0.62, 0.55, 1.25),
    'pile-aggregate': ('gravel_floor_02', 0.55, 0.6, 1.45),
}


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'src/games/rally/engine/props'
    for name, (pid, lum, sat, contrast) in TILES.items():
        im = Image.open(os.path.join(src, pid, f'{pid}_diff_1k.jpg')).convert('RGB').resize((SZ, SZ), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255
        L = (a * [0.2126, 0.7152, 0.0722]).sum(2, keepdims=True)
        a = L + (a - L) * sat
        m = L.mean()
        a = m + (a - m) * contrast
        a = a * (lum / m)
        Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, f'{name}.webp'), quality=82, method=6)
        print(name, pid, f'{os.path.getsize(os.path.join(out, name + ".webp")) // 1024} KB')


if __name__ == '__main__':
    main()
