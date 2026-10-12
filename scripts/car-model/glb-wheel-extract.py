"""One wheel of a GLB car -> rim STL + tyre STL for wheel-stl-to-glb.mjs --keep.

    python scripts/car-model/glb-wheel-extract.py <in.glb> <wheel group node> <out-rim.stl> <out-tyre.stl>
        [--drop Caliperz,discs,...] [--tyre Tires] [--outer -x]

Every primitive under the named node is baked to world space; those whose material is the tyre's (`--tyre`,
default "Tires") go to the tyre STL, the rest (minus `--drop` materials: brake discs / calipers, the game draws
its own) to the rim STL. Both are centred on the tyre's axis and rotated so that the axle is STL z with the
outer face at z max (the layout wheel-stl-to-glb.mjs expects): `--outer -x` = the wheel's outside faces -x
(a right-side wheel), `+x` = left side. Prints the tyre radius / width and the bead-seat (bore) radius to
pass as `--barrel`.
"""
import importlib.util
import os
import struct
import sys

import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('g', os.path.join(here, 'glb-to-parts-stl.py'))
g2s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g2s)

glb, group, out_rim, out_tyre = sys.argv[1:5]
opts = dict(zip(sys.argv[5::2], sys.argv[6::2]))
drop = set(opts.get('--drop', 'Caliperz,discs').split(','))
tyre_mat = opts.get('--tyre', 'Tires')
outer = opts.get('--outer', '-x')

g, bins = g2s.load_glb(glb)
rim, tyre = [], []
for _, mat, path, T in g2s.primitives(g, bins):
    if group not in path or mat in drop:
        continue
    (tyre if mat == tyre_mat else rim).append(T)
if tyre_mat == 'auto':
    # Tyre and rim share one material: weld, take connected pieces; the piece reaching the largest radius is the tyre.
    allt = np.concatenate(rim)
    p = allt.reshape(-1, 3)
    c0 = (p.min(0) + p.max(0)) / 2
    _, inv = np.unique(np.round(p, 3), axis=0, return_inverse=True)
    inv = inv.reshape(-1, 3)
    parent = list(range(inv.max() + 1))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in inv:
        for u, v in ((a, b), (b, c)):
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
    comp = np.array([find(a) for a in inv[:, 0]])
    radius = {k: np.hypot(*(allt[comp == k].reshape(-1, 3)[:, 1:] - c0[1:]).T).max() for k in np.unique(comp)}
    big = max(radius, key=radius.get)
    tyre = allt[comp == big]
    rim = allt[comp != big]
else:
    rim = np.concatenate(rim)
    tyre = np.concatenate(tyre)

pts = tyre.reshape(-1, 3)
ctr = (pts.min(0) + pts.max(0)) / 2  # axle centre (x is the axle, y / z radial)
s = -1.0 if outer == '-x' else 1.0


def to_stl(T):
    T = T - ctr
    # STL (x, y, z) = (-s * Z, Y, s * X) with s = -1 for an -x outer face: a proper rotation (a swap alone mirrors the mesh).
    return np.stack([-s * T[..., 2], T[..., 1], s * T[..., 0]], axis=-1)


def write(path, T):
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-20
    with open(path, 'wb') as f:
        f.write(b'wheel part (glb-wheel-extract.py)'.ljust(80, b' '))
        f.write(struct.pack('<I', len(T)))
        for t, nn in zip(T, n):
            f.write(struct.pack('<12fH', *nn, *t.ravel(), 0))


R = to_stl(rim)
Y = to_stl(tyre)
write(out_rim, R)
write(out_tyre, Y)
ty = Y.reshape(-1, 3)
r = np.hypot(ty[:, 0], ty[:, 1])
print(f'tyre radius {r.max():.4f} width {ty[:, 2].max() - ty[:, 2].min():.4f} bore radius {r.min():.4f}')
rr = np.hypot(R.reshape(-1, 3)[:, 0], R.reshape(-1, 3)[:, 1])
print(f'rim radius max {rr.max():.4f}, {len(R)} rim triangles, {len(Y)} tyre triangles')
