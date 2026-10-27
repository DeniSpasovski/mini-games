"""Bake the rally straw tile (engine/props/straw.webp) for the hay bales from "Hay bales" by Abby Crawford (CC BY 4.0).

usage: python3 scripts/props/bake-straw.py <dir with the model's first texture as tex0.jpg> [out file]

The tile is the long side of one square bale in the scan's photo atlas (~0.94 x 0.55 m, twine included), cross-faded
at its edges so it repeats, its brightness levelled (the shading comes from the game's light) and kept in colour.
"""
import os
import sys

import numpy as np
from PIL import Image

BOX = (462, 706, 776, 892)  # the bale side in the 1024 px atlas (left, top, right, bottom)
OUT = (512, 256)
FADE = 40  # px of cross-fade on each wrapping edge (in OUT pixels)
TARGET = 0.55  # mean brightness (0..1, sRGB)


def tileable(a, fade):
    """Cross-fade the last `fade` columns / rows into the first ones, then drop them: the result wraps."""
    h, w, _ = a.shape
    ramp = np.linspace(0, 1, fade)[None, :, None]
    left = a[:, :fade] * ramp + a[:, w - fade:] * (1 - ramp)
    a = np.concatenate([left, a[:, fade:w - fade]], axis=1)
    ramp = np.linspace(0, 1, fade)[:, None, None]
    top = a[:fade] * ramp + a[h - fade:] * (1 - ramp)
    return np.concatenate([top, a[fade:h - fade]], axis=0)


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'src/games/rally/engine/props/straw.webp'
    img = Image.open(os.path.join(src, 'tex0.jpg')).convert('RGB').crop(BOX)
    img = img.resize((OUT[0] + FADE, OUT[1] + FADE), Image.LANCZOS)
    a = tileable(np.asarray(img, dtype=np.float64) / 255, FADE)
    # Level the slow shading (a blurred copy divides it out), then set the mean brightness.
    blur = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((8, 4), Image.BOX).resize(OUT, Image.BICUBIC),
                      dtype=np.float64) / 255
    lum = lambda x: x @ np.array([0.2126, 0.7152, 0.0722])
    a = a * (lum(a).mean() / np.maximum(lum(blur), 0.05))[..., None]
    a = np.clip(a * (TARGET / lum(a).mean()), 0, 1)
    Image.fromarray((a * 255).round().astype(np.uint8)).save(out, quality=88, method=6)
    print(out, a.shape, 'mean', round(float(lum(a).mean()), 3))


main()
