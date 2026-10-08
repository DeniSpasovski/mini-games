"""One wheel of a car GLB -> rim + tyre STLs in wheel space for wheel-stl-to-glb.mjs (rim centred on the hub, de-cambered).

    python scripts/car-model/glb-rim-extract.py <in.glb> <out-prefix> --tyre <node-prefix> --rim <node-prefix>[,<prefix>...]

Node prefixes match the primitive's node name case-insensitively ("wheel_lf_002" matches "wheel_lf_002_ac3dmat126_0"); use the
LEFT wheel (outer face towards +x). The hub is the tyre's centroid (a tyre is symmetric about its centre plane), the axle is the
smallest principal axis of the tyre's vertices; the wheel is rotated about the hub so the axle is exactly +x, which removes camber
(the game's wheels are upright). Output frame: STL z = axle (outer face at z max), STL y = up, a proper rotation of the model's.
`--side +x` keeps only the triangles whose centre has x > 0 (a primitive that holds both left wheels of an axle, e.g. a mirrored
FBX symmetry); add `--z front` / `rear` / a number to pick one axle by the sign of z (`front` z > 0, `rear` z < 0).
Writes <out-prefix>-rim.stl / -tyre.stl and prints the numbers wheel-stl-to-glb.mjs needs: `--barrel` (the tyre's bore radius
= the rim's bead seat) and the tyre width / radius.
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from gltfio import load_glb, primitives  # noqa: E402

src, prefix = sys.argv[1], sys.argv[2]
opts = dict(zip(sys.argv[3::2], sys.argv[4::2]))
g, binary = load_glb(src)
prims = primitives(g, binary)


def pick(names):
    sel = [T for n, _, T in prims if any(n.lower().startswith(p.lower()) for p in names.split(','))]
    if not sel:
        sys.exit(f'no primitive starts with {names}')
    return np.concatenate(sel)


tyre, rim = pick(opts['--tyre']), pick(opts['--rim'])


def one_wheel(T):
    c = T.mean(1)
    keep = np.ones(len(T), bool)
    if '--side' in opts:
        keep &= c[:, 0] * (1 if opts['--side'] == '+x' else -1) > 0
    if '--z' in opts:
        keep &= (c[:, 2] > 0) if opts['--z'] == 'front' else (c[:, 2] < 0) if opts['--z'] == 'rear' else c[:, 2] > float(opts['--z'])
    return T[keep]


tyre, rim = one_wheel(tyre), one_wheel(rim)
V = tyre.reshape(-1, 3)
hub = V.mean(0)
axis = np.linalg.svd(V - hub, full_matrices=False)[2][2]
axis *= 1 if axis[0] > 0 else -1  # left wheel: outer face = +x
# rotation taking `axis` onto +x (Rodrigues)
ex = np.array([1.0, 0, 0])
v = np.cross(axis, ex)
s, c = np.linalg.norm(v), axis @ ex
K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
Rm = np.eye(3) + K + K @ K * ((1 - c) / (s * s)) if s > 1e-9 else np.eye(3)


def to_wheel(T):
    P = (T.reshape(-1, 3) - hub) @ Rm.T
    # model (x axle, y up, z forward) -> STL (X = -z, Y = y, Z = x): a proper rotation
    return np.stack([-P[:, 2], P[:, 1], P[:, 0]], -1).reshape(-1, 3, 3)


def write_stl(path, T):
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    N /= np.linalg.norm(N, axis=1)[:, None] + 1e-20
    with open(path, 'wb') as f:
        f.write(b'glb-rim-extract'.ljust(80, b'\0') + struct.pack('<I', len(T)))
        for n, t in zip(N, T):
            f.write(struct.pack('<12fH', *n, *t.ravel(), 0))


tw, rw = to_wheel(tyre), to_wheel(rim)
# Centre the rim's lip-to-lip span on the hub plane and give the tyre stub that same span, so wheel-stl-to-glb.mjs (which
# sets the tyre's outer face flush with the rim lip) lands the rim exactly on the tyre's centre plane.
mid = (rw[..., 2].min() + rw[..., 2].max()) / 2
rw[..., 2] -= mid
tmid = (tw[..., 2].min() + tw[..., 2].max()) / 2
tw[..., 2] = (tw[..., 2] - tmid) * (np.ptp(rw[..., 2]) / np.ptp(tw[..., 2]))
write_stl(prefix + '-rim.stl', rw)
write_stl(prefix + '-tyre.stl', tw)
tv = tw.reshape(-1, 3)
r = np.hypot(tv[:, 0], tv[:, 1])
print(f'hub {np.round(hub, 4)}  axle {np.round(axis, 4)} (camber {np.degrees(np.arcsin(axis[1])):.2f} deg)')
print(f'tyre: radius {r.max():.4f}  bore {r.min():.4f}  width {np.ptp(tv[:, 2]):.4f}')
print(f'rim: z {rw[..., 2].min():.4f} .. {rw[..., 2].max():.4f}  (tyre z {tv[:, 2].min():.4f} .. {tv[:, 2].max():.4f})')
print(f'wheel-stl-to-glb.mjs ... --keep --barrel {r.min():.4f}')
