"""Cut a car print model's own rim out of its source STL -> rim + tyre STLs for wheel-stl-to-glb.mjs.

    python scripts/car-model/stl-wheel-extract.py <model.source.json>

Reads the `wheelRim` block of the car's model.source.json (all numbers in MODEL space, after `axes` / `scale` /
`offset` - the same transform as segment-stl.py):

    hub        [z, y, x] of a point on the wheel's axle (x = depth, e.g. the tyre's mid-plane); side +1 = the left wheel
               (+x), -1 = the right one. Measure it on the hub bore / tyre / lip circles AFTER removing the camber, not on
               the spoke pattern (hand-modelled spokes are not symmetric)
    axis       outward axle direction in model space, e.g. [1, 0.0757, 0.002] = 4.3 deg of camber (fit a plane to the tyre's
               outer sidewall: x = a + b dy + c dz -> [1, -b, -c] ... sign as measured); the wheel is rotated about `hub` so
               this becomes the axle - a cambered rim spun on an upright axle wobbles. Default [1, 0, 0]
    face       {"minX": .., "maxR": ..}: the spoke face = triangles in front of minX (|x|, towards the outside) whose
               vertices all lie inside maxR of the axis (hub, spokes; the brake disc / caliper sit behind minX)
    lathe      closed (r, |x|) profile of a procedural lip + barrel, turned round the axis (`segments` steps): print models
               fuse the rim barrel into the tyre, so the model's own barrel is a jagged tyre wall
    tyre       {"minX": .., "minR": .., "maxR": ..}: the model's tyre = triangles whose vertices all lie in that |x| / r range
               (only its width and outer face matter to the converter, so keep the arch liner out of it)
    rim / tyreOut  output STL paths (wheel space: STL z = axle, outer face at z max, metres)

Prints the rim's bead radius (smallest lathe r) for `--barrel`.
"""
import json
import sys

import numpy as np

cfg = json.load(open(sys.argv[1], encoding='utf8'))
wc = cfg['wheelRim']

raw = open(cfg['source'], 'rb').read()
n = int(np.frombuffer(raw[80:84], '<u4')[0])
rec = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
S = np.frombuffer(raw[84:84 + n * 50], dtype=rec)['v'].astype(np.float64)
ax = [('xyz'.index(a[-1]), -1 if a.startswith('-') else 1) for a in cfg['axes']]
T = np.stack([S[..., i] * s for i, s in ax], -1) * cfg['scale']
off = np.array(cfg['offset'], float)
if cfg.get('groundAtMin'):
    off[1] -= T[..., 1].min()
T = T + off

hz, hy, hx = wc['hub']
side = wc.get('side', 1)
# De-camber: rotate about the hub point so `axis` becomes +x (Rodrigues), keeping depths comparable to the lathe |x|.
a = np.array(wc.get('axis', [side, 0, 0]), float)
a /= np.linalg.norm(a)
ex = np.array([float(side), 0, 0])
v = np.cross(a, ex)
sn, cs = np.linalg.norm(v), a @ ex
K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
Rot = np.eye(3) + K + K @ K * ((1 - cs) / sn**2) if sn > 1e-12 else np.eye(3)
pivot = np.array([hx, hy, hz])
T = (T - pivot) @ Rot.T + pivot
print(f'axis {a.round(4).tolist()}: {np.degrees(np.arccos(np.clip(cs, -1, 1))):.2f} deg removed')
# Wheel space (a proper rotation of model space, so the winding stays): X = -side * dz, Y = dy, Z = side * x.
W = np.stack([-side * (T[..., 2] - hz), T[..., 1] - hy, side * T[..., 0]], -1)
C = W.mean(1)
Nrm = np.cross(W[:, 1] - W[:, 0], W[:, 2] - W[:, 0])
Nrm /= np.linalg.norm(Nrm, axis=1)[:, None] + 1e-20
r = np.hypot(C[:, 0], C[:, 1])
nr = (Nrm[:, 0] * C[:, 0] + Nrm[:, 1] * C[:, 1]) / (r + 1e-12)
rv = np.hypot(W[..., 0], W[..., 1]).max(1)

f = wc['face']
barrel_wall = (r > f['maxR'] - 0.035) & (nr < -0.3)  # the tyre's inner wall (replaced by the lathe barrel)
face = (C[:, 2] > f['minX']) & (rv < f['maxR']) & ~barrel_wall
t = wc['tyre']
rmin = np.hypot(W[..., 0], W[..., 1]).min(1)
tyre = (W[..., 2].min(1) > t['minX']) & (rmin >= t['minR']) & (rv < t['maxR']) & ~face & ~barrel_wall

# Lathe: profile points (r, x) round the axis, quads between neighbouring steps (outward winding for a CCW profile
# in (r, x) seen with x up).
prof = np.array(wc['lathe'], float)
seg = wc.get('segments', 96)
ang = np.linspace(0, 2 * np.pi, seg + 1)[:-1]
ring = lambda p, a: np.array([p[0] * np.cos(a), p[0] * np.sin(a), p[1]])
lathe = []
for i in range(len(prof)):
    p, q = prof[i], prof[(i + 1) % len(prof)]
    for j in range(seg):
        a, b = ang[j], ang[(j + 1) % seg]
        lathe.append([ring(p, a), ring(p, b), ring(q, b)])
        lathe.append([ring(p, a), ring(q, b), ring(q, a)])
lathe = np.array(lathe)
# Orientation check: the lathe's normals must point away from the profile's centroid.
cen = prof.mean(0)
L = np.cross(lathe[:, 1] - lathe[:, 0], lathe[:, 2] - lathe[:, 0])
mid = lathe.mean(1)
mr = np.hypot(mid[:, 0], mid[:, 1])
out_r = (mid[:, 0] * L[:, 0] + mid[:, 1] * L[:, 1]) / (mr + 1e-12) * (mr - cen[0]) + L[:, 2] * (mid[:, 2] - cen[1])
if (out_r < 0).mean() > 0.5:
    lathe = lathe[:, ::-1]

rim = np.concatenate([W[face], lathe])


def write_stl(path, tris):
    tris = np.asarray(tris, np.float32)
    nn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    nn /= np.linalg.norm(nn, axis=1)[:, None] + 1e-20
    data = np.zeros(len(tris), dtype=rec)
    data['n'] = nn
    data['v'] = tris
    with open(path, 'wb') as fh:
        fh.write(b'stl-wheel-extract'.ljust(80, b' '))
        fh.write(np.uint32(len(tris)).tobytes())
        fh.write(data.tobytes())


write_stl(wc['rim'], rim)
write_stl(wc['tyreOut'], W[tyre])
print(f"rim: {face.sum()} face + {len(lathe)} lathe triangles -> {wc['rim']}")
print(f"tyre: {tyre.sum()} triangles -> {wc['tyreOut']}")
print(f"bead radius (--barrel): {prof[:, 0].min():.4f}; face z max {rim[..., 2].max():.4f}, tyre z {W[tyre][..., 2].min():.4f} .. {W[tyre][..., 2].max():.4f}")
