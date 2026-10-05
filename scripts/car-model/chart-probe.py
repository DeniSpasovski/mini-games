"""Which atlas chart does each body triangle of a car GLB use? (livery debugging)

    python scripts/car-model/chart-probe.py <model.source.json> [--box x0,x1,y0,y1,z0,z1] [--abs-x]
        [--seam rear|top|side] [--profile z0,z1,x0,x1]

Reads the GLB written by stl-to-glb.mjs (`output` of the config), takes the `body` primitive and
maps every triangle's atlas UV back to its chart (left / right / top / front / rear / bottom).

- default / `--box`: per chart, the triangle count, area and the normal / position ranges of the
  triangles whose centre is in the model-space box (x is the car's left; `--abs-x` mirrors x).
  Use it to find WHY a painted edge shows slivers: faces you did not expect on a chart
  (a crease wall on a side chart, a fender shoulder on the top chart) -> `atlas.chartBoxes`.
- `--seam rear`: for each height band behind z -1.7, where the side chart ends (min z) and the
  rear chart starts (max |x|) - the lines your checker / stripe cells must straddle.
- `--profile z0,z1,x0,x1`: surface height (cm) over a z / x grid (top-most triangle vertex), to
  find where a panel actually ends (a bonnet edge drops 1 - 3 cm over a few mm).
"""
import json
import struct
import sys

import numpy as np

cfg_path = sys.argv[1]
args = sys.argv[2:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


cfg = json.load(open(cfg_path, encoding='utf8'))
A = cfg['atlas']
W, H = A['width'], A['height']
Bd = A['bounds']
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


prim = next(p for p in gj['meshes'][0]['primitives'] if gj['materials'][p['material']]['name'] == 'body')
P = acc(prim['attributes']['POSITION']).astype(float)
UV = acc(prim['attributes']['TEXCOORD_0']).astype(float)
I = acc(prim['indices']).astype(int).reshape(-1, 3)
T = P[I]
c = T.mean(1)
uv = UV[I].mean(1)
n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
area = 0.5 * np.linalg.norm(n, axis=1)
n /= np.linalg.norm(n, axis=1)[:, None] + 1e-12


def chart_rects():
    out = {}
    for name, (cx, cy) in A['charts'].items():
        w = (Bd['x'][1] - Bd['x'][0]) if name in ('front', 'rear') else (Bd['z'][1] - Bd['z'][0])
        h = (Bd['y'][1] - Bd['y'][0]) if name in ('left', 'right', 'front', 'rear') else (Bd['x'][1] - Bd['x'][0])
        out[name] = (cx, cy, w, h)
    return out


def chart_of(u, v):
    for name, (cx, cy, w, h) in chart_rects().items():
        if cx - 0.01 <= u <= cx + w + 0.01 and cy - 0.01 <= v <= cy + h + 0.01:
            return name
    return 'none'


u, v = uv[:, 0] * W, uv[:, 1] * H
names = np.array([chart_of(a, b) for a, b in zip(u, v)])
if (names == 'none').mean() > 0.5:  # glTF v runs top-down: flip
    names = np.array([chart_of(a, H - b) for a, b in zip(u, v)])
print('triangles per chart:', {k: int((names == k).sum()) for k in sorted(set(names))})

if 'rear' == opt('--seam'):
    print('rear seam, per height band: side chart min z / rear chart max |x| (rear faces with |x| > 0.5)')
    for y0 in np.arange(0.1, 1.15, 0.075):
        m = (c[:, 1] >= y0) & (c[:, 1] < y0 + 0.075) & (c[:, 2] < -1.7)
        s = m & np.isin(names, ['left', 'right'])
        r = m & (names == 'rear') & (np.abs(c[:, 0]) > 0.5)
        print(f'  y {y0:.2f}: side min z {c[s, 2].min() if s.any() else 0:.3f}   rear max|x| {np.abs(c[r, 0]).max() if r.any() else 0:.3f}')

box = opt('--box')
if box:
    x0, x1, y0, y1, z0, z1 = [float(t) for t in box.split(',')]
    cx = np.abs(c[:, 0]) if '--abs-x' in args else c[:, 0]
    m = (cx >= x0) & (cx <= x1) & (c[:, 1] >= y0) & (c[:, 1] <= y1) & (c[:, 2] >= z0) & (c[:, 2] <= z1)
    print(f'\nbox x[{x0},{x1}] y[{y0},{y1}] z[{z0},{z1}]: {int(m.sum())} triangles')
    for k in sorted(set(names[m])):
        q = m & (names == k)
        print(f'  {k:7s} {int(q.sum()):5d} tris {area[q].sum() * 1e4:7.0f} cm2   '
              f'normal y {n[q, 1].min():+.2f}..{n[q, 1].max():+.2f}  x {n[q, 0].min():+.2f}..{n[q, 0].max():+.2f}   '
              f'pos y {c[q, 1].min():.2f}..{c[q, 1].max():.2f}  z {c[q, 2].min():.2f}..{c[q, 2].max():.2f}')

prof = opt('--profile')
if prof:
    z0, z1, x0, x1 = [float(t) for t in prof.split(',')]
    pts = np.concatenate([T.reshape(-1, 3), c])
    xs = np.arange(x0, x1 + 1e-9, 0.02 * (1 if x1 > x0 else -1))
    print('\nsurface height (cm); rows z, columns x =', ' '.join(f'{x:.2f}' for x in xs))
    for z in np.arange(z0, z1 + 1e-9, 0.1):
        row = []
        for x in xs:
            w = (np.abs(pts[:, 2] - z) < 0.05) & (np.abs(pts[:, 0] - x) < 0.012)
            row.append(f'{pts[w, 1].max() * 100:5.1f}' if w.any() else '  nan')
        print(f'{z:.2f}', ' '.join(row))
