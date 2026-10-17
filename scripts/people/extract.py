"""
Extracts a CC BY person model (one textured mesh, T-pose, +Z forward, Y up) for bake-people.mjs:
  <out>/<name>.json  positions, uv, normals, indices (both primitives welded into one mesh)
  <out>/<name>.jpg   the texture, <out>/<name>_mask.png  tint mask: R = top garment, G = trousers, B = skin; <name>_mask2.png: R = hair, G = shoes, B = torso fill
(texel colour inside a body zone decides the garment; soft edges).

  python scripts/people/extract.py <model.glb> <out dir> <name> <female|male>
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'car-model'))
from gltfio import accessor, load_glb, node_matrix  # noqa: E402

path, out, name, kind = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
g, binary = load_glb(path)
P, N, U, I = [], [], [], []


def walk(i, M):
    n = g['nodes'][i]
    M = M @ node_matrix(n)
    if 'mesh' in n:
        for p in g['meshes'][n['mesh']]['primitives']:
            pos = accessor(g, binary, p['attributes']['POSITION'])
            pos = (M[:3, :3] @ pos.T).T + M[:3, 3]
            nor = accessor(g, binary, p['attributes']['NORMAL'])
            nor = (np.linalg.inv(M[:3, :3]).T @ nor.T).T
            nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-9
            base = sum(len(x) for x in P)
            P.append(pos)
            N.append(nor)
            U.append(accessor(g, binary, p['attributes']['TEXCOORD_0']))
            I.append(accessor(g, binary, p['indices']).astype(np.int64).ravel() + base)
    for c in n.get('children', []):
        walk(c, M)


for s in g['scenes'][g.get('scene', 0)]['nodes']:
    walk(s, np.eye(4))
P, N, U, I = np.concatenate(P), np.concatenate(N), np.concatenate(U), np.concatenate(I)
tri = I.reshape(-1, 3)
print(name, len(P), 'verts', len(tri), 'tris', P.min(0).round(3), P.max(0).round(3))

im = g['images'][0]
bv = g['bufferViews'][im['bufferView']]
tex = Image.open(io.BytesIO(binary[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']])).convert('RGB')
S = tex.size[0]
if kind == 'male':
    # Retouch the small printed graphic on the back of the T-shirt (two patches of the texture): replace what differs
    # from the shirt by the shirt's median colour.
    arr = np.asarray(tex).copy()
    for x0, y0, x1, y1 in [(566, 668, 632, 720), (960, 710, 1002, 744)]:
        ring = np.concatenate([arr[y0 - 6:y0, x0:x1].reshape(-1, 3), arr[y1:y1 + 6, x0:x1].reshape(-1, 3)])
        med = np.median(ring[ring.sum(1) > 450], axis=0)
        box = arr[y0:y1, x0:x1].astype(int)
        navy = (box[..., 2] - box[..., 0] > 12) & (box.max(2) < 110)
        print_ = (np.abs(box - med).sum(2) > 40) & ~navy
        arr[y0:y1, x0:x1][print_] = med
    tex = Image.fromarray(arr)
tex.save(os.path.join(out, name + '.jpg'), quality=86)

# Zones per triangle (centroid): 1 upper body, 2 legs / hips, 3 head, 4 feet.
c = P[tri].mean(1)
waist = 1.14 if kind == 'female' else 0.93  # her trousers sit high: the band up to here is trousers
zone = np.where(c[:, 1] > 1.53, 3, np.where(c[:, 1] > waist, 1, np.where(c[:, 1] > 0.12, 2, 4)))
zimg = Image.new('L', (S, S), 0)
d = ImageDraw.Draw(zimg)
for t in range(len(tri)):
    pts = [(U[v][0] * S, U[v][1] * S) for v in tri[t]]
    d.polygon(pts, fill=int(zone[t]))


def grow(a, n=6):
    # The texture is padded past each island's edge: let the padding take its island's label, so the tint covers it.
    a = a.copy()
    for _ in range(n):
        m = np.asarray(Image.fromarray(a).filter(ImageFilter.MaxFilter(3)))
        a = np.where(a == 0, m, a)
    return a


Z = grow(np.asarray(zimg))
A = np.asarray(tex).astype(np.float64) / 255
mx, mn = A.max(2), A.min(2)
sat = (mx - mn) / (mx + 1e-6)


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


r, gg, b = A[..., 0], A[..., 1], A[..., 2]
# Hair texels: on the top / back / sides of the head, where the face has none.
hz = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(hz)
for t in range(len(tri)):
    cc = c[t]
    if zone[t] == 3 and (cc[1] > 1.72 or cc[2] < -0.02 or abs(cc[0]) > 0.075):
        d.polygon([(U[v][0] * S, U[v][1] * S) for v in tri[t]], fill=255)
HZ = (grow(np.asarray(hz)) > 0) & (Z == 3)
# Torso fill: the torso between the arms (a jacket or shirt closes the neckline, the bare midriff).
fz = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(fz)
for t in range(len(tri)):
    cc = c[t]
    if zone[t] == 1 and waist <= cc[1] <= 1.47 and abs(cc[0]) < (0.19 if kind == 'female' else 0.21):
        d.polygon([(U[v][0] * S, U[v][1] * S) for v in tri[t]], fill=255)
FZ = (grow(np.asarray(fz)) > 0) & (Z == 1)
warm = ss((r - b) / (r + 1e-6), 0.18, 0.3) * ss(r - gg, 0.02, 0.07) * ss(mx, 0.38, 0.5)  # skin-ish (not dark hair)
# Skin proper: paler and darker skin counts too, except where hair is (dark brown hair looks like shaded skin).
skin_tone = ss((r - b) / (r + 1e-6), 0.07, 0.14) * ss(r - gg, 0.0, 0.03) * ss(mx, 0.18, 0.3)
if kind == 'male':
    top = ((Z == 1) * (1 - warm) * ss(mx, 0.4, 0.55) * (1 - ss(sat, 0.2, 0.3)))
    low = ((Z == 2) * (1 - warm) * ss(b - r, 0.0, 0.05))
else:
    orange = ss((r - b) / (r + 1e-6), 0.5, 0.62) * (1 - ss(gg / (r + 1e-6), 0.62, 0.74))
    top = (Z == 1) * orange
    low = (Z == 2) * (1 - warm) * (1 - ss(mx, 0.3, 0.42))
skin = ((Z == 1) | (Z == 2) | (Z == 3) | (Z == 4)) * np.where(HZ, warm, skin_tone) * (1 - top) * (1 - low)
mask = np.stack([top, low, skin], 2)
Image.fromarray((mask * 255).astype(np.uint8)).save(os.path.join(out, name + '_mask.png'))

# Second mask: R = hair, G = shoes, B = torso fill.

lum0 = 0.2126 * r + 0.7152 * gg + 0.0722 * b
hair = HZ * (1 - ss(lum0, 0.3, 0.42)) * (1 - warm)
shoes = (Z == 4) * (1 - skin_tone)
mask2 = np.stack([hair, shoes, FZ.astype(np.float64)], 2)
Image.fromarray((mask2 * 255).astype(np.uint8)).save(os.path.join(out, name + '_mask2.png'))

# Mean luminance of each garment (the shader keeps the fabric's light / dark detail around it).
LIN = np.where(A <= 0.04045, A / 12.92, ((A + 0.055) / 1.055) ** 2.4)
lum = 0.2126 * LIN[..., 0] + 0.7152 * LIN[..., 1] + 0.0722 * LIN[..., 2]


def mean(m):
    return float((lum * m).sum() / max(m.sum(), 1))


skin_base = [float((LIN[..., k] * skin).sum() / max(skin.sum(), 1)) for k in range(3)]


refs = [mean(top), mean(low), mean(skin), mean(hair), mean(shoes)]
print(' refs', [round(x, 3) for x in refs], 'mask px', [int(m.sum()) for m in (top, low, skin, hair, shoes)])
# Colour and tint mask per vertex: the mid-range mesh drops the uv (no seams to hold the simplifier back).
iu = np.clip((U[:, 0] * S).astype(int), 0, S - 1)
iv = np.clip((U[:, 1] * S).astype(int), 0, S - 1)
vcol = (A[iv, iu] * 255).round().astype(int)
vmask = (np.concatenate([mask, mask2], 2)[iv, iu] * 255).round().astype(int)  # top, low, skin, hair, shoes, fill
json.dump(
    dict(
        vcol=vcol.tolist(), vmask=vmask.tolist(), pos=P.round(4).tolist(), nor=N.round(3).tolist(), uv=U.round(5).tolist(), idx=I.tolist(), refs=refs, skinBase=skin_base,
        size=S,
    ),
    open(os.path.join(out, name + '.json'), 'w'),
)
