"""Re-centre a wheel GLB's rim lip + barrel on the axle: some source models have them off the axle (or tilted, camber
baked in) while the spokes and hub are centred, so the rim wobbles against the tyre when it spins.

    python scripts/car-model/glb-wheel-straighten.py <wheel.glb> [--write] [--r0 0.45] [--r1 0.58]

Works on the game wheel GLB (wheel-stl-to-glb.mjs output, unit wheel space: x = axle, barrel at r 0.62). Fits a circle
to the rim's outermost vertices (beyond r1) in thin slices along the axle and a line through the slice centres (y, z against x).
With --write the rim's vertices move by that line's offset, in full beyond r1 and fading to none at r0 (the spokes
blend into it, the hub stays put); normals follow the shear. Prints the slice centres before and after.
"""
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gltfio  # noqa: E402

path = sys.argv[1]
opts = dict(zip(sys.argv[2::2], sys.argv[3::2]))
write = '--write' in sys.argv
r0 = float(opts.get('--r0', 0.45))
r1 = float(opts.get('--r1', 0.58))
g, binary = gltfio.load_glb(path)
binary = bytearray(binary)
mesh = next(m for m in g['meshes'] if m['name'] == 'rim')


def slices(v):
    x, y, z = v.T
    out = []
    for lo in np.arange(x.min(), x.max(), 0.04):
        s = (x >= lo) & (x < lo + 0.04) & (np.hypot(y, z) > r1)
        if s.sum() < 40:
            continue
        th = np.arctan2(z[s], y[s])
        if len(np.unique(np.floor((th + np.pi) / (np.pi / 12)))) < 12:
            continue  # less than half the circle: no reliable centre
        # The outermost point per 7.5 degrees (the lip's edge, not whatever else the slice cuts through).
        r = np.hypot(y[s], z[s])
        idx = [np.where(s)[0][m][r[m].argmax()] for a in range(48) if (m := np.floor((th + np.pi) / (np.pi / 24)) == a).any()]
        p = np.c_[y[idx], z[idx]]
        c = np.linalg.lstsq(np.c_[2 * p, np.ones(len(p))], (p**2).sum(1), rcond=None)[0]
        res = np.abs(np.hypot(p[:, 0] - c[0], p[:, 1] - c[1]) - np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))
        if np.median(res) > 0.004:
            continue  # not a round edge (spoke ends, vents)
        out.append((lo + 0.02, c[0], c[1]))
    return np.array(out)


def report(c):
    return ' '.join(f'x{xm:+.2f}:({cy * 1000:+.1f},{cz * 1000:+.1f})' for xm, cy, cz in c)


pos = np.vstack([gltfio.accessor(g, binary, p['attributes']['POSITION']) for p in mesh['primitives']])
c = slices(pos)
print('slice centres (1/1000):', report(c))
ky, cy = np.polyfit(c[:, 0], c[:, 1], 1)
kz, cz = np.polyfit(c[:, 0], c[:, 2], 1)
print(f'line: y = {cy * 1000:+.1f} {ky * 1000:+.1f} x, z = {cz * 1000:+.1f} {kz * 1000:+.1f} x (1/1000)')
if not write:
    sys.exit(0)

for p in mesh['primitives']:
    ia = g['accessors'][p['attributes']['POSITION']]
    views = {}
    for key in ('POSITION', 'NORMAL'):
        i = p['attributes'].get(key)
        if i is None:
            continue
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        assert a['componentType'] == 5126 and not bv.get('byteStride'), 'packed float VEC3 only'
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        views[key] = (a, off, np.frombuffer(binary, '<f4', a['count'] * 3, off).reshape(-1, 3).astype(np.float64))
    _, _, v = views['POSITION']
    r = np.hypot(v[:, 1], v[:, 2])
    t = np.clip((r - r0) / (r1 - r0), 0, 1)
    w = t * t * (3 - 2 * t)
    if 'NORMAL' in views:
        # Shear y -= w (cy + ky x): normals by the inverse transpose (w taken as locally constant).
        n = views['NORMAL'][2]
        n[:, 0] += w * (ky * n[:, 1] + kz * n[:, 2])
        n /= np.linalg.norm(n, axis=1, keepdims=True)
    v[:, 1] -= w * (cy + ky * v[:, 0])
    v[:, 2] -= w * (cz + kz * v[:, 0])
    ia['min'] = v.min(0).tolist()
    ia['max'] = v.max(0).tolist()
    for a, off, arr in views.values():
        binary[off:off + arr.size * 4] = arr.astype('<f4').tobytes()

js = json.dumps(g, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
binary = bytes(binary) + b'\0' * (-len(binary) % 4)
with open(path, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binary)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)
g2, b2 = gltfio.load_glb(path)
pos = np.vstack([gltfio.accessor(g2, b2, p['attributes']['POSITION']) for p in mesh['primitives']])
print('after (1/1000):', report(slices(pos)))
