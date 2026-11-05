"""Girth table of an imported car: how far round the body (arc length from the roof centre line) each surface point is.

    python scripts/car-model/girth-table.py <model.source.json> <out.json> [--parts body,glass] [--dz 0.05] [--d 0.03]

Reads the GLB written by stl-to-glb.mjs (`output` of the config) and, every `dz` metres along z, cuts the given parts with
the plane z, takes the outer outline of the cut (farthest hit per 1-degree ray from the cut's centre, both sides folded
onto |x|) and measures its arc length s from the top centre line down to the sill. Writes, per z row:

- `top`: s at |x| = 0, d, 2d ... (the upper part of the outline: roof, pillars, shoulder) - for top-chart faces;
- `side`: s at y = 0, d, 2d ... (the outer side, found from the sill upward) - for side-chart faces;

in millimetres. A livery drawn in (z, s) through this table paints the same block on both charts where a surface switches
from one to the other (a pillar or a shoulder at 45 degrees), and its blocks keep their size down a steep panel
(`cars/bimmer-gt2/livery.ts`).
"""
import json
import struct
import sys

import numpy as np

cfg_path, out_path = sys.argv[1], sys.argv[2]
args = sys.argv[3:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


cfg = json.load(open(cfg_path, encoding='utf8'))
Bd = cfg['atlas']['bounds']
parts = opt('--parts', 'body,glass').split(',')
DZ = float(opt('--dz', 0.05))
D = float(opt('--d', 0.03))

glb = open(cfg['output'], 'rb').read()
jl = struct.unpack('<I', glb[12:16])[0]
gj = json.loads(glb[20:20 + jl])
b0 = 20 + jl + 8


def acc(i):
    a = gj['accessors'][i]
    v = gj['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']]
    off = b0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(glb, dt, a['count'] * n, off).reshape(-1, n)


tris = []
for p in gj['meshes'][0]['primitives']:
    if gj['materials'][p['material']]['name'] not in parts:
        continue
    P = acc(p['attributes']['POSITION']).astype(float)
    tris.append(P[acc(p['indices']).astype(int).reshape(-1)].reshape(-1, 3, 3))
T = np.concatenate(tris)
T[:, :, 0] = np.abs(T[:, :, 0])  # fold both sides onto |x|


def section(z):
    """Segments (n, 2, 2) in (|x|, y) where the plane z cuts the triangles."""
    d = T[:, :, 2] - z
    segs = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        m = (d[:, a] * d[:, b]) < 0
        t = d[m, a] / (d[m, a] - d[m, b])
        segs.append((np.flatnonzero(m), T[m, a, :2] + t[:, None] * (T[m, b, :2] - T[m, a, :2])))
    pts = {}
    for idx, q in segs:
        for i, pt in zip(idx, q):
            pts.setdefault(i, []).append(pt)
    return np.array([v[:2] for v in pts.values() if len(v) >= 2]).reshape(-1, 2, 2)


def outline(S):
    """Outer outline: farthest hit along rays from the cut's centre, from straight up (90 deg) to straight down."""
    yc = 0.5 * (S[:, :, 1].min() + S[:, :, 1].max())
    o = np.array([0.0, yc])
    out = []
    for deg in np.arange(90, -90.5, -1.0):
        r = np.array([np.cos(np.radians(deg)), np.sin(np.radians(deg))])
        a, e = S[:, 0] - o, S[:, 1] - S[:, 0]
        den = r[0] * e[:, 1] - r[1] * e[:, 0]
        ok = np.abs(den) > 1e-12
        t = np.where(ok, (a[:, 0] * e[:, 1] - a[:, 1] * e[:, 0]) / np.where(ok, den, 1), -1)
        u = np.where(ok, (a[:, 0] * r[1] - a[:, 1] * r[0]) / np.where(ok, den, 1), -1)
        hit = ok & (t > 0) & (u >= 0) & (u <= 1)
        if hit.any():
            out.append(o + r * t[hit].max())
    L = np.array(out)
    if len(L) > 4:  # light smoothing: ray jitter would lengthen the arc
        L[1:-1] = (L[:-2] + 2 * L[1:-1] + L[2:]) / 4
    L[0, 0] = 0.0  # start on the centre line
    return L


zs = np.round(np.arange(Bd['z'][0], Bd['z'][1] + 1e-9, DZ), 4)
xs = np.round(np.arange(0, Bd['x'][1] + D, D), 4)
ys = np.round(np.arange(0, Bd['y'][1] + D, D), 4)
top_rows, side_rows = [], []
for z in zs:
    S = section(z)
    if len(S) < 8:
        top_rows.append(None)
        side_rows.append(None)
        continue
    L = outline(S)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(L, axis=0), axis=1))])
    # top: first time the outline reaches each |x| (roof -> pillar -> shoulder); past its widest point s grows 1:1
    top = []
    reach = np.maximum.accumulate(L[:, 0])
    for x in xs:
        i = np.searchsorted(reach, x)
        if i == 0:
            top.append(s[0] + x - L[0, 0])
        elif i >= len(L):
            top.append(s[np.argmax(L[:, 0])] + x - L[:, 0].max())
        else:
            x0, x1 = reach[i - 1], reach[i]
            f = 0 if x1 == x0 else (x - x0) / (x1 - x0)
            top.append(s[i - 1] + f * (s[i] - s[i - 1]))
    # side: from the sill upward, the first time the outline reaches each y (the outer side, then the pillar above it)
    side = []
    rev_y = np.maximum.accumulate(L[::-1, 1])
    rev_s = s[::-1]
    for y in ys:
        i = np.searchsorted(rev_y, y)
        if i == 0:
            side.append(rev_s[0] + (rev_y[0] - y))
        elif i >= len(L):
            side.append(rev_s[-1] - (y - rev_y[-1]))
        else:
            y0, y1 = rev_y[i - 1], rev_y[i]
            f = 0 if y1 == y0 else (y - y0) / (y1 - y0)
            side.append(rev_s[i - 1] + f * (rev_s[i] - rev_s[i - 1]))
    top_rows.append([round(v * 1000) for v in top])
    side_rows.append([round(v * 1000) for v in side])

# rows the cut missed (beyond the body's ends) copy the nearest row
for rows in (top_rows, side_rows):
    have = [i for i, r in enumerate(rows) if r is not None]
    for i, r in enumerate(rows):
        if r is None:
            rows[i] = rows[min(have, key=lambda j: abs(j - i))]

json.dump({'$comment': f'girth table (mm), scripts/car-model/girth-table.py {cfg_path} (parts {",".join(parts)})',
           'z0': float(zs[0]), 'dz': DZ, 'd': D, 'top': top_rows, 'side': side_rows},
          open(out_path, 'w', encoding='utf8', newline='\n'), separators=(',', ':'))
print(f'{len(zs)} rows, {len(xs)} x / {len(ys)} y samples -> {out_path}')
