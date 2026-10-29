"""Bake the detail tiles of 3, 2, 1 Kabooom (src/games/kaboom/assets/textures/<level>.webp) from Poly Haven (CC0) scans.

usage: python3 scripts/kaboom/bake-textures.py <dir with <id>_diff_1k.jpg> [out dir]

One 512 px tile covers the level's tile size in m (`LEVELS`, the same number as the theme's `detail.tile`). Each scan is made grey (the vertex colours supply the paint), softened so
detail finer than the game camera shows is gone, given a little more mid-scale contrast, and set to mean 0.5: the
shader multiplies the paint by 2 x the channel, so the colour stays what the palette says (DETAILS.md "Style").
Red = the ground (terraces, rim, meadow and pitch, decks), green = the second surface (cliff and walls, bare soil, hulls),
blue = boulders (Valley; grey 0.5 = no detail where a level has none).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SZ = 512
# level: (tile size m, red: (Poly Haven id, scan size m, contrast), green: same or None, blue: same or None)
LEVELS = {
    'quarry': (2.4, ('gravelly_sand', 2.48, 0.17), ('rock_face', 2.38, 0.2), None),
    'valley': (2.0, ('leafy_grass', 2.0, 0.17), ('brown_mud_dry', 1.3, 0.18), ('rock_boulder_dry', 1.8, 0.2)),
    'sea': (1.5, ('fine_grained_wood', 0.6, 0.14), ('wood_peeling_paint_weathered', 0.76, 0.2), None),
}


def channel(src, spec, tile):
    if spec is None:
        return np.full((SZ, SZ), 0.5, np.float32)
    pid, size, contrast = spec
    im = Image.open(os.path.join(src, f'{pid}_diff_1k.jpg')).convert('L')
    # the scan repeats n x n times in a tile (seamless: it tiles itself), then the whole tile is scaled to SZ
    n = max(1, round(tile / size))
    w, h = im.size
    tiled = Image.new('L', (w * n, h * n))
    for i in range(n):
        for j in range(n):
            tiled.paste(im, (i * w, j * h))
    t = tiled.resize((SZ, SZ), Image.LANCZOS)
    # drop the grain the camera never resolves, then lift the mid-scale shapes (pebbles, clumps, boards); wrap the
    # edges for the blur so the tile stays seamless
    pad = Image.new('L', (SZ * 3, SZ * 3))
    for i in range(3):
        for j in range(3):
            pad.paste(t, (i * SZ, j * SZ))
    crop = (SZ, SZ, SZ * 2, SZ * 2)
    a = np.asarray(pad.filter(ImageFilter.GaussianBlur(1.2)).crop(crop), np.float32) / 255
    b = np.asarray(pad.filter(ImageFilter.GaussianBlur(10)).crop(crop), np.float32) / 255
    a = a + (a - b) * 0.6
    a = (a - a.mean()) / (a.std() + 1e-6) * contrast + 0.5
    return np.clip(a, 0, 1)


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'src/games/kaboom/assets/textures'
    os.makedirs(out, exist_ok=True)
    for level, (tile, red, green, blue) in LEVELS.items():
        rgb = np.stack([channel(src, red, tile), channel(src, green, tile), channel(src, blue, tile)], 2)
        path = os.path.join(out, f'{level}.webp')
        Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(path, quality=85, method=6)
        print(level, red[0], green[0] if green else '-', os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
