"""Straighten a wheel GLB whose faces lean against the axle (a skewed source node): x += ky * y + kz * z.

    python scripts/car-model/glb-wheel-unshear.py <wheel.glb> [<out.glb>] [--k <ky>] [--kz <kz>]

A wheel GLB (wheel-stl-to-glb.mjs: axle = x, outer face +x) must have its lips and faces perpendicular to the axle; a wheel
cut from a source whose node matrix carried a skew comes out with x depending on y, so the rim lip swings sideways by
a couple of centimetres when it spins. Without `--k` / `--kz` the shear is measured on the outer rim lip (the highest x
of the largest-radius ring per 10 degrees against y / z) and removed from every mesh (positions and normals);
without <out.glb> the numbers are printed only. Prints the lip's x spread before and after.
"""
import json
import struct
import sys

import numpy as np

args = sys.argv[1:]
opts = {}
while '--k' in args or '--kz' in args:
    for o in ('--k', '--kz'):
        if o in args:
            i = args.index(o)
            opts[o] = float(args[i + 1])
            del args[i:i + 2]
src = args[0]
dst = args[1] if len(args) > 1 else None

d = bytearray(open(src, 'rb').read())
jlen, _ = struct.unpack('<II', d[12:20])
j = json.loads(d[20:20 + jlen])
bin0 = 20 + jlen + 8


def view(acc):
    a = j['accessors'][acc]
    bv = j['bufferViews'][a['bufferView']]
    off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.ndarray((a['count'], 3), dtype='<f4', buffer=d, offset=off, strides=(bv.get('byteStride', 12), 4))


rim = view(j['meshes'][0]['primitives'][0]['attributes']['POSITION'])
r = np.hypot(rim[:, 1], rim[:, 2])
ang = np.degrees(np.arctan2(rim[:, 2], rim[:, 1]))
lip = r > 0.93 * r.max()
pts = []
for a0 in range(-180, 180, 10):
    idx = np.where(lip & (ang >= a0) & (ang < a0 + 10))[0]
    if len(idx):
        pts.append(rim[idx[np.argmax(rim[idx, 0])]])
pts = np.array(pts, dtype=float)
c = np.linalg.lstsq(np.c_[np.ones(len(pts)), pts[:, 1], pts[:, 2]], pts[:, 0], rcond=None)[0]
ky = opts.get('--k', -c[1])
kz = opts.get('--kz', -c[2])
print(f'lip x spread {np.ptp(pts[:, 0]):.4f}; fitted x = {c[0]:.4f} {c[1]:+.4f} y {c[2]:+.4f} z -> ky {ky:+.4f} kz {kz:+.4f}')
after = pts[:, 0] + ky * pts[:, 1] + kz * pts[:, 2]
print(f'after: lip x spread {np.ptp(after):.4f}')
if not dst:
    sys.exit(0)

for m in j['meshes']:
    p = m['primitives'][0]
    pos = view(p['attributes']['POSITION'])
    nor = view(p['attributes']['NORMAL'])
    pos[:, 0] += ky * pos[:, 1] + kz * pos[:, 2]
    # Normals go by the inverse transpose of x' = x + ky y + kz z: n' = (nx, ny - ky nx, nz - kz nx).
    nx = nor[:, 0].copy()
    nor[:, 1] -= ky * nx
    nor[:, 2] -= kz * nx
    nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-20
    a = j['accessors'][p['attributes']['POSITION']]
    a['min'] = [float(v) for v in pos.min(0)]
    a['max'] = [float(v) for v in pos.max(0)]

# The JSON chunk keeps its length: the min / max numbers change, the padding absorbs the difference.
new = json.dumps(j, separators=(',', ':')).encode()
old = bytes(d[20:20 + jlen])
if len(new) > jlen:
    raise SystemExit('JSON grew')
new = new + b' ' * (jlen - len(new))
d[20:20 + jlen] = new
open(dst, 'wb').write(d)
print('wrote', dst)
