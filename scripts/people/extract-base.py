"""
Extracts one clean base body (CC BY, see THIRD-PARTY.md) for bake-base.mjs: the most detailed mesh of the GLB, centred on x = 0,
standing on y = 0 at `height` metres, +Z forward.

    python3 scripts/people/extract-base.py <model.glb> <out dir> <male|female> <height m>

Writes <out>/<name>.json (positions, normals, uv, indices; uv seams keep their duplicate vertices).

The base bodies come without a usable uv layout (the female one is scrambled), so the uv is made here: the triangles of the
face get a planar (x, y) view of the front of the head at 0.4 m per uv unit, every other triangle maps to one plain skin texel
in the corner (vertices on the border are duplicated, nothing else changes). skin-map.py paints the face onto that layout.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'car-model'))
from gltfio import accessor, load_glb, node_matrix  # noqa: E402

path, out, name, height = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
os.makedirs(out, exist_ok=True)
g, binary = load_glb(path)
prims = []


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
            uv = accessor(g, binary, p['attributes']['TEXCOORD_0'])
            idx = accessor(g, binary, p['indices']).astype(np.int64).ravel()
            prims.append((pos, nor, uv, idx))
    for c in n.get('children', []):
        walk(c, M)


for s in g['scenes'][g.get('scene', 0)]['nodes']:
    walk(s, np.eye(4))
# The pack holds the same body twice (a lighter copy beside it): keep the most detailed.
P, N, U, I = max(prims, key=lambda p: len(p[3]))
k = height / (P[:, 1].max() - P[:, 1].min())
P = P.copy()
P[:, 0] -= (P[:, 0].min() + P[:, 0].max()) / 2
P[:, 1] -= P[:, 1].min()
P *= k
# Eye height of each body (m): the centre of the face layout.
EYE = {'male': 1.700, 'female': 1.625}[name]
band = P[(P[:, 1] > EYE - 0.02) & (P[:, 1] < EYE + 0.02) & (np.abs(P[:, 0]) < 0.08)]
zc = float((band[:, 2].max() + band[:, 2].min()) / 2)
SCALE = 2.5
Tri = I.reshape(-1, 3)
cent = P[Tri].mean(1)
face = (np.hypot(cent[:, 0], cent[:, 1] - (EYE - 0.03)) < 0.1) & (cent[:, 2] > zc + 0.03)
face_uv = np.stack([0.5 + P[:, 0] * SCALE, 0.3 + (EYE - P[:, 1]) * SCALE], axis=1)
remap = {}
rows = []
newI = []
for t, isface in zip(Tri, face):
    for v in t:
        key = (int(v), bool(isface))
        if key not in remap:
            remap[key] = len(rows)
            rows.append(key)
        newI.append(remap[key])
src = np.array([r[0] for r in rows])
P, N = P[src], N[src]
U = np.where(np.array([r[1] for r in rows])[:, None], face_uv[src], np.array([0.97, 0.97]))
I = np.array(newI)
print(name, len(P), 'vertices', len(I) // 3, 'triangles', P.min(0).round(3), P.max(0).round(3), 'scale', round(k, 2))
json.dump(
    {
        'pos': P.round(5).tolist(),
        'nor': N.round(4).tolist(),
        'uv': U.round(5).tolist(),
        'face': {'eye': EYE, 'zc': zc},
        'idx': I.tolist(),
    },
    open(os.path.join(out, name + '.json'), 'w'),
)
