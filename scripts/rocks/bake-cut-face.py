"""
Bakes the rally road-cut rock face tiles (world/rock-cut-mesh.ts) from the CC0 Poly Haven scan "Cliff Side"
(James Ray Cock, Dario Barresi, Jenelle van Heerden; https://polyhaven.com/a/cliff_side, 1k diffuse + OpenGL normal map):

    python scripts/rocks/bake-cut-face.py sources/rally/polyhaven/cliff_side

-> src/games/rally/engine/props/cut-face.color.webp + cut-face.normal.webp (512 px = the scan's 1.83 m).
The scan's thin strata already run across the picture (u = along the road). Its orange sandstone is turned into a light,
near-neutral stone of MEAN_LUM keeping SAT of the hue (iron stains stay faintly warm): the mesh's vertex colour gives each
stretch of face its own tone (silver-grey schist, yellow ochre, rust), like the Vodno cuts.
"""

import os
import sys

import numpy as np
from PIL import Image

SZ = 512
# Mean linear luminance of the toned face and the share of the scan's own colour kept around the grey.
MEAN_LUM = 0.24
SAT = 0.15
# Base stone (linear, a touch warm: weathered, dusty).
GREY = np.array([1.0, 0.97, 0.9], dtype=np.float32)
# Contrast of the luminance around its mean (the scan's lit block tops vs the shaded joints).
CONTRAST = 1.15
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def srgb_to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'sources/rally/polyhaven/cliff_side'
    out = os.path.join(os.path.dirname(__file__), '../../src/games/rally/engine/props')
    pid = 'cliff_side'
    col = Image.open(os.path.join(src, f'{pid}_diff_1k.jpg')).convert('RGB').resize((SZ, SZ), Image.LANCZOS)
    a = srgb_to_lin(np.asarray(col, dtype=np.float32) / 255)
    lum = (a * LUMA).sum(2, keepdims=True)
    m = float(lum.mean())
    toned = (m + (lum - m) * CONTRAST) * GREY + (a - lum) * SAT
    toned *= MEAN_LUM / float((toned * LUMA).sum(2).mean())
    Image.fromarray((lin_to_srgb(toned) * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(out, 'cut-face.color.webp'), quality=82, method=6
    )
    nor = Image.open(os.path.join(src, f'{pid}_nor_gl_1k.jpg')).convert('RGB').resize((SZ, SZ), Image.LANCZOS)
    nor.save(os.path.join(out, 'cut-face.normal.webp'), quality=90, method=6)
    print('mean linear luminance', round(float((toned * LUMA).sum(2).mean()), 3))


if __name__ == '__main__':
    main()
