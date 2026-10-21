"""Texture atlases of the two fire engines: the images of each model, tiled where its uv leave 0..1, in one jpg each.

    python scripts/car-model/bake-fire-truck-textures.py <dir>

<dir> holds the extractor outputs of the two GLBs (street-pack-extract.py <glb> <dir>/us.json --images <dir>/us, same for
fe; see bake-fire-trucks.mjs). Writes <dir>/fire-us.jpg and <dir>/fire-mk.jpg and <dir>/fire-atlas.json: per atlas the
size and, per source image, `rect` (its tile in the atlas, uv with v down like glTF) plus `lo` / `hi` (the source uv range
that tile covers: whole repeats of the image, so a repeating pattern like the shutters or the stripes keeps repeating).
bake-fire-trucks.mjs maps every vertex uv into its tile.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

D = sys.argv[1]
# atlas: (source pack prefix, atlas px, images shrunk to a fraction of their size)
ATLASES = {
    'us': ('us', (1024, 1024), {}),
    'mk': ('fe', (1024, 1024), {1: 0.5}),
}
GUTTER = 8
QUALITY = 90


def uv_ranges(vehicle):
    """{image index: [u_lo, v_lo, u_hi, v_hi]} whole repeats covering every uv the model draws from that image."""
    ranges = {}
    for m in vehicle['mesh']:
        if m['img'] < 0:
            continue
        uv = np.array(m['uv'])
        lo = np.floor(uv.min(0) + 1e-4)
        hi = np.ceil(uv.max(0) - 1e-4)
        r = ranges.setdefault(m['img'], [lo[0], lo[1], hi[0], hi[1]])
        r[:] = [min(r[0], lo[0]), min(r[1], lo[1]), max(r[2], hi[0]), max(r[3], hi[1])]
    return {k: [int(x) for x in v] for k, v in ranges.items()}


def tile_image(pack, i, rng, shrink):
    img = Image.open(os.path.join(D, f'{pack}_{i}.png')).convert('RGB')
    if shrink != 1:
        img = img.resize((max(1, round(img.size[0] * shrink)), max(1, round(img.size[1] * shrink))), Image.LANCZOS)
    nu, nv = rng[2] - rng[0], rng[3] - rng[1]
    return np.tile(np.asarray(img), (nv, nu, 1)), nu * nv > 1


def shelf_pack(sizes, atlas):
    """sizes: {key: (w, h)} -> {key: (x, y)}, tallest first."""
    pos, x, y, row = {}, 0, 0, 0
    for key, (w, h) in sorted(sizes.items(), key=lambda s: -s[1][1]):
        if x + w > atlas[0]:
            x, y, row = 0, y + row, 0
        if y + h > atlas[1]:
            raise SystemExit(f'atlas {atlas} full at {key}')
        pos[key] = (x, y)
        x, row = x + w, max(row, h)
    return pos


out = {}
for name, (pack, size, shrink) in ATLASES.items():
    vehicle = json.load(open(os.path.join(D, f'{pack}.json')))[0]
    ranges = uv_ranges(vehicle)
    tiles = {i: tile_image(pack, i, r, shrink.get(i, 1)) for i, r in ranges.items()}
    # A tile that fills the atlas needs no gutter (its uv stay inside the image anyway).
    pad = {i: 0 if t[0].shape[0] >= size[1] and t[0].shape[1] >= size[0] else GUTTER for i, t in tiles.items()}
    at = shelf_pack({i: (t[0].shape[1] + 2 * pad[i], t[0].shape[0] + 2 * pad[i]) for i, t in tiles.items()}, size)
    atlas = np.zeros((size[1], size[0], 3), np.uint8)
    info = {}
    for i, (arr, repeats) in tiles.items():
        g = pad[i]
        padded = np.pad(arr, ((g, g), (g, g), (0, 0)), mode='wrap' if repeats else 'edge') if g else arr
        x, y = at[i]
        atlas[y:y + padded.shape[0], x:x + padded.shape[1]] = padded
        h, w = arr.shape[:2]
        info[f'{pack}:{i}'] = dict(
            rect=[round((x + g) / size[0], 6), round((y + g) / size[1], 6), round((x + g + w) / size[0], 6), round((y + g + h) / size[1], 6)],
            lo=ranges[i][:2],
            hi=ranges[i][2:],
        )
    path = os.path.join(D, f'fire-{name}.jpg')
    Image.fromarray(atlas).save(path, quality=QUALITY, optimize=True, subsampling=0)
    print(name, size, len(tiles), 'images,', os.path.getsize(path) // 1024, 'KB')
    out[name] = dict(size=list(size), tiles=info)
json.dump(out, open(os.path.join(D, 'fire-atlas.json'), 'w'), indent=1)
