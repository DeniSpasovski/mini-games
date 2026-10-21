"""
Paints the skin map of a base body (CC BY, see THIRD-PARTY.md) for bake-base.mjs: plain skin and, on the face layout that
extract-base.py makes, a little mottling and blush, brows, lips, and eyes (sclera, iris, pupil, lids). The features are
drawn in 3D (an ellipse on the face by position) and rasterised through the mesh's own uv, so they sit exactly on the model.

    python3 scripts/people/skin-map.py <dir> <male|female>

Reads <dir>/<name>.json (extract-base.py); writes <dir>/<name>.jpg (the map), <dir>/<name>_mask.png (white where a colour is
kept whatever the skin tone: sclera, iris, pupil) and <dir>/<name>.skin.json (the map's mean linear colour).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

d, name = sys.argv[1], sys.argv[2]
S = 512
m = json.load(open(os.path.join(d, name + '.json')))
pos = np.array(m['pos'])
uv = np.array(m['uv'])
tri = np.array(m['idx']).reshape(-1, 3)

# Face measures of each body (m, source frame: standing on y = 0, +Z forward): eye height, eye half distance, mouth height,
# brow height above the eye, the face's own look.
F = {
    'male': dict(eye=1.698, ex=0.0325, ew=0.0135, eh=0.0064, mouth=1.603, mw=0.025, lip=0.0072, brow=0.0215, bw=0.024, bt=0.005, lash=0.55, lipc=(0.93, 0.70, 0.72)),
    'female': dict(eye=1.618, ex=0.0305, ew=0.0135, eh=0.0068, mouth=1.535, mw=0.023, lip=0.0082, brow=0.0225, bw=0.023, bt=0.0034, lash=0.8, lipc=(0.92, 0.62, 0.64)),
}[name]

# Rasterise: for every texel, the 3D position it shows.
P = np.zeros((S, S, 3))
cov = np.zeros((S, S), bool)
for t in tri:
    a, b, c = uv[t] * S
    x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(S - 1, np.ceil(max(a[0], b[0], c[0]))))
    y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(S - 1, np.ceil(max(a[1], b[1], c[1]))))
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-9:
        continue
    l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
    l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
    l3 = 1 - l1 - l2
    ok = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    if not ok.any():
        continue
    p = l1[..., None] * pos[t[0]] + l2[..., None] * pos[t[1]] + l3[..., None] * pos[t[2]]
    P[y0 : y1 + 1, x0 : x1 + 1][ok] = p[ok]
    cov[y0 : y1 + 1, x0 : x1 + 1] |= ok

X, Y, Z = P[..., 0], P[..., 1], P[..., 2]
rng = np.random.default_rng(7)
ZC = m['face']['zc']


def noise(scale: float) -> np.ndarray:
    """Smooth value noise over the texture (a blotch of `scale` texels)."""
    n = max(2, int(S / scale))
    g = rng.random((n + 1, n + 1))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
    return np.asarray(img, dtype=float) / 255 - 0.5


# Skin (sRGB 0..1): a warm mid tone; the person's tone later multiplies it by (tone / mean).
skin = np.array([0.80, 0.63, 0.54])
img = np.tile(skin, (S, S, 1))
# Everything that is not a feature fades into the plain skin of the texture's border (where the rest of the body reads).
R = np.hypot(X, Y - (F['eye'] - 0.03))
win = 1 - np.clip((R - 0.06) / 0.04, 0, 1)
mott = (0.05 * noise(40) + 0.03 * noise(12)) * win
img *= (1 + mott)[..., None]
face = Z > ZC + 0.03
# Cheeks and nose a little redder, the brow and the chin lighter.
for sx in (-1, 1):
    cheek = np.exp(-(((X - sx * 0.05) / 0.03) ** 2 + ((Y - (F['eye'] - 0.045)) / 0.03) ** 2))
    img[..., 1] *= 1 - 0.09 * cheek * face * win
    img[..., 2] *= 1 - 0.07 * cheek * face * win
nose = np.exp(-((X / 0.012) ** 2 + ((Y - (F['eye'] - 0.05)) / 0.02) ** 2))
img[..., 1] *= 1 - 0.08 * nose * face * win
img[..., 2] *= 1 - 0.07 * nose * face * win

mask = np.zeros((S, S))


def blend(col, alpha):
    """Paints `col` (an array of 3, in skin-relative or absolute sRGB) over the map where alpha > 0."""
    global img
    img = img * (1 - alpha[..., None]) + np.array(col) * alpha[..., None]


def soft(dist, edge):
    """1 inside (dist < 0), 0 outside, a smooth `edge` wide border."""
    return np.clip(0.5 - dist / edge, 0, 1)


ax = np.abs(X)
front = Z > ZC + 0.03
# Lips: an upper and a lower lip round the mouth line.
lipc = skin * np.array(F['lipc'])
mz = np.hypot((ax) / F['mw'], (Y - F['mouth']) / F['lip'])
lips = soft(mz - 1, 0.25) * front
blend(lipc, lips * 0.9)
# The line between the lips.
line = soft(np.hypot(ax / (F['mw'] * 0.95), (Y - F['mouth'] - 0.0008) / 0.0012) - 1, 0.3) * front
blend(skin * 0.35, line * 0.7)
# Brows: an arc over each eye, thick at the inner end, thinning outwards.
for sx in (-1, 1):
    cx = sx * F['ex']
    t = np.clip((ax - F['ex'] + F['bw']) / (2 * F['bw']), 0, 1)
    arc = F['eye'] + F['brow'] + 0.005 * np.sin(t * np.pi) - 0.005 * t
    th = F['bt'] * (1.0 - 0.55 * t)
    bro = soft(np.hypot(((ax - F['ex']) / (F['bw'] * 1.05)), (Y - arc) / th) - 1, 0.35) * front * (np.sign(X) == sx)
    blend(skin * 0.22, bro * 0.85)
# Eyes: the almond (sclera), iris, pupil, lid lines.
for sx in (-1, 1):
    ex = sx * F['ex']
    inner = (X - ex) * sx  # towards the nose < 0
    ellip = np.hypot((X - ex) / F['ew'], (Y - F['eye']) / (F['eh'] * (1 - 0.5 * np.abs((X - ex) / F['ew']) ** 2)))
    sclera = soft(ellip - 1, 0.18) * front * (np.sign(X) == sx)
    # Lid shadow ring, then the white, the iris and the pupil.
    ring = soft(ellip - 1.35, 0.2) * front * (np.sign(X) == sx)
    blend(skin * 0.8, ring * 0.5 * (1 - sclera))
    blend((0.82, 0.80, 0.77), sclera)
    r = np.hypot(X - ex - sx * -0.0003, (Y - F['eye']) * 1.0)
    iris = soft(r - 0.0049, 0.0011) * front * (np.sign(X) == sx) * sclera
    blend((0.36, 0.24, 0.14), iris)
    inner_ring = soft(np.abs(r - 0.0036) - 0.0014, 0.001) * iris
    blend((0.50, 0.36, 0.20), inner_ring * 0.5)
    pupil = soft(r - 0.0023, 0.0007) * iris
    blend((0.03, 0.03, 0.03), pupil)
    # A catch light.
    glint = soft(np.hypot(X - ex - sx * 0.0016, Y - F['eye'] - 0.002) - 0.0009, 0.0005) * iris
    blend((0.95, 0.95, 0.95), glint * 0.8)
    mask = np.maximum(mask, sclera)
    # Lash line along the upper lid; the lower lid softly.
    up = soft(np.abs(ellip - 1.0) - 0.07, 0.07) * front * (Y > F['eye'] - 0.001) * (np.sign(X) == sx)
    blend((0.10, 0.07, 0.06), up * F['lash'])
    lo = soft(np.abs(ellip - 1.0) - 0.05, 0.08) * front * (Y <= F['eye'] - 0.001) * (np.sign(X) == sx)
    blend(skin * 0.55, lo * 0.3)

img = np.clip(img, 0, 1)
# Fill the unused texels with the nearest painted ones (no seams at the island borders).
fill = cov.copy()
for _ in range(6):
    sh = np.zeros_like(img)
    cnt = np.zeros((S, S))
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        src = np.roll(np.roll(img, dy, 0), dx, 1)
        sf = np.roll(np.roll(fill, dy, 0), dx, 1)
        sh += src * sf[..., None]
        cnt += sf
    grow = (~fill) & (cnt > 0)
    img[grow] = sh[grow] / cnt[grow][..., None]
    fill |= grow
out = Image.fromarray((img * 255 + 0.5).astype(np.uint8))
out.save(os.path.join(d, name + '.jpg'), quality=90)
Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).convert('RGB').save(os.path.join(d, name + '_mask.png'))
# Mean colour of the skin (linear), over the body's own texels.
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
mean = lin[cov & (mask < 0.5)].mean(0)
json.dump([round(float(x), 4) for x in mean], open(os.path.join(d, name + '.skin.json'), 'w'))
print(name, 'skin map', S, 'mean linear', mean.round(3))
