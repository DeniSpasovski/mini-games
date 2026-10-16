"""Texture atlas of the baked background cars: every car's own texture in one image, plus the tint mask of its paint.

    python scripts/car-model/bake-street-textures.py <dir>

<dir> holds the extractor outputs (street-pack-extract.py <pack>.glb <dir>/<pack>.json --images <dir>/<pack>, flags as in
bake-street-cars.mjs: gp.json needs `--seeds Body_0`). Writes <dir>/atlas.jpg (colour, ATLAS px), <dir>/mask.png (tint
mask, ATLAS / 2 px) and <dir>/atlas.json (where each source image sits: {key: [u0, v0, u1, v1]} in uv, v down like glTF).
bake-street-cars.mjs maps every part's uv into its tile and embeds the images.

The paint of a gp body is a coloured (or dark grey) panel area of its texture: the mask is white there, and inside it the
texture holds the shade only (grey = luminance / the lit paint's), so the game's tint colour replaces the source paint and
keeps the baked shading. Everything else (grille, trim, lamps, wheels) keeps its own texels. The p8 cars have a flat palette
instead: their paint triangles are re-pointed to a white `paint` cell (mask white) by the baker; `glass`, `tyre`, `side`
and `rim` are flat swatches for the windows and the far LODs' wheels (atlas.json `cells`: uv of each swatch's middle).
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ATLAS = 2048
GUTTER = 8
D = sys.argv[1]

# Textures that are a car's own body: coloured paint is tinted; `untinted` (the black SUV: its dark paint and black
# plastic cannot be told apart) keeps its own colours.
BODIES = {
    'gp:11': dict(),
    'gp:25': dict(),
    'gp:33': dict(),
    'gp:17': dict(),
    'gp:35': dict(untinted=True),
    'gp:7': dict(),
    'gp:21': dict(),
    'gp:4': dict(),
    'gp:27': dict(),
    'gp:37': dict(),
}
LAMPS = 'gp:6'
WHEELS = ['gp:13', 'gp:23', 'gp:31', 'gp:15', 'gp:9', 'gp:19', 'gp:2', 'gp:29']
PALETTE = 'p8:0'
BODY_PX, WHEEL_PX, LAMP_PX, PALETTE_PX = 496, 240, 496, 256
MIN_BLOB = 600
SHADE_GAMMA = 0.6


def source(key):
    pack, i = key.split(':')
    return Image.open(os.path.join(D, f'{pack}_{i}.png')).convert('RGB')


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255.0


def paint_mask(rgb):
    f = rgb.astype(np.float32)
    mx, mn = f.max(-1), f.min(-1)
    m = (mx >= 12) & ((mx - mn) >= 0.25 * mx)
    m = ndi.binary_closing(m, structure=np.ones((3, 3)))
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= MIN_BLOB * (rgb.shape[0] / 1024) ** 2
    return keep[lab]


def shade_texture(rgb, mask):
    """The texture with the paint texels replaced by grey shade (1 = the lit paint)."""
    lin = to_linear(rgb.astype(np.float32))
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ref = float(np.percentile(lum[mask], 85))
    # Gamma lifts the baked occlusion a little: sills and lower doors would otherwise read as dirt.
    shade = np.clip(lum / ref, 0, 1) ** SHADE_GAMMA
    grey = to_srgb(shade)[..., None].repeat(3, -1)
    out = rgb.astype(np.float32).copy()
    out[mask] = grey[mask]
    return out


tiles = {}
colour = Image.new('RGB', (ATLAS, ATLAS), (0, 0, 0))
mask_full = Image.new('L', (ATLAS, ATLAS), 0)


def gutter(key):
    # The palette is flat cells read at their centres: no padding, so it stays pixel-exact.
    return 0 if key == PALETTE else GUTTER


def shelf_pack(sizes):
    """sizes: [(key, px)] -> {key: (x, y)} (tile = px + 2 gutter), biggest first."""
    pos, x, y, row = {}, 0, 0, 0
    for key, px in sorted(sizes, key=lambda s: -s[1]):
        w = px + 2 * gutter(key)
        if x + w > ATLAS:
            x, y, row = 0, y + row, 0
        if y + w > ATLAS:
            raise SystemExit('atlas full')
        pos[key] = (x, y)
        x, row = x + w, max(row, w)
    return pos


want = [(k, BODY_PX) for k in BODIES] + [(LAMPS, LAMP_PX), (PALETTE, PALETTE_PX)] + [(k, WHEEL_PX) for k in WHEELS]
at = shelf_pack(want)


def put(key, img, msk=None):
    x, y = at[key]
    g = gutter(key)
    px = img.size[0]
    arr = np.asarray(img)
    padded = np.pad(arr, ((g, g), (g, g), (0, 0)), mode='edge')
    colour.paste(Image.fromarray(padded.astype(np.uint8)), (x, y))
    if msk is not None:
        mask_full.paste(Image.fromarray(np.pad(np.asarray(msk), g, mode='edge')), (x, y))
    inner = (x + g, y + g, x + g + px, y + g + px)
    tiles[key] = [round(v / ATLAS, 6) for v in inner]


for key, spec in BODIES.items():
    rgb = np.asarray(source(key))
    if spec.get('untinted'):
        m = np.zeros(rgb.shape[:2], bool)
        shaded = rgb.astype(np.float32)
    else:
        m = paint_mask(rgb)
        shaded = shade_texture(rgb, m)
    size = BODY_PX
    img = Image.fromarray(np.clip(shaded, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    mimg = Image.fromarray((m * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    put(key, img, mimg)
    print(key, 'paint', round(float(m.mean()) * 100, 1), '%')

put(LAMPS, source(LAMPS).resize((LAMP_PX, LAMP_PX), Image.LANCZOS))
for key in WHEELS:
    put(key, source(key).resize((WHEEL_PX, WHEEL_PX), Image.LANCZOS))

# The palette (flat 12 px cells) keeps its pixels; flat 32 px swatches in its unused right edge (spaced, so mip levels
# never mix them): glass, tyre, tyre side, rim (the far LODs' wheels and the glass of the gp cars) and the white paint cell
# (masked) of the palette cars.
pal = np.asarray(source(PALETTE)).copy()
pm = np.zeros((PALETTE_PX, PALETTE_PX), np.uint8)
BLOCK = 32
SWATCHES = {  # name: (y of the block, colour)
    'glass': (0, (22, 30, 38)),
    'tyre': (48, (27, 27, 29)),
    'side': (96, (44, 44, 48)),
    'rim': (144, (118, 120, 125)),
    'paint': (PALETTE_PX - BLOCK, (255, 255, 255)),
}
for name, (y, colour_) in SWATCHES.items():
    pal[y:y + BLOCK, -BLOCK:] = colour_
pm[-BLOCK:, -BLOCK:] = 255
put(PALETTE, Image.fromarray(pal), Image.fromarray(pm))
x0, y0, x1, y1 = tiles[PALETTE]
cells = {name: [round(x1 - BLOCK / 2 / ATLAS, 6), round(y0 + (y + BLOCK / 2) / ATLAS, 6)] for name, (y, _) in SWATCHES.items()}
out = {'tiles': tiles, 'cells': cells, 'atlas': ATLAS}

colour.save(os.path.join(D, 'atlas.jpg'), quality=88, optimize=True, subsampling=0)
mask_full.resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(os.path.join(D, 'mask.png'), optimize=True)
json.dump(out, open(os.path.join(D, 'atlas.json'), 'w'), indent=1)
print('atlas.jpg', os.path.getsize(os.path.join(D, 'atlas.jpg')) // 1024, 'KB; mask.png', os.path.getsize(os.path.join(D, 'mask.png')) // 1024, 'KB')
