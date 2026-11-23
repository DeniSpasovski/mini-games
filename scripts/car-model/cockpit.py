"""Where the crew sits in an imported car: measures its cockpit model for `model.cockpit` (cars/shared/types.ts).

    python scripts/car-model/cockpit.py public/models/cars/<car>.glb seat <x> [zBack]
    python scripts/car-model/cockpit.py public/models/cars/<car>.glb wheel <x> <y> <z> [tiltDeg] [radius]

Car frame: y = 0 the ground, +z the nose, +x the car's left; metres. Glass and body paint are left out, so what is
measured is the interior.

`seat` prints, on the vertical slice through the middle of a seat (x = its centre, try 0.3 - 0.45):
- the top of the cushion by z            -> `seat.cushion` (the flat part under the hips)
- the front of the backrest by height    -> `seat.back` [z, y, z, y] (a low and a high point of its straight part);
  `zBack` = how far forward a backrest can be (default -0.1): pass a smaller one when the wheel or dash is picked up
- the lowest thing overhead by z         -> `roof` (over the head, cage tubes included)
- the top of the footwell by z           -> `floor`
A right-hand-drive car (`rhd: true`) is measured on its left seat all the same: the seats mirror.

`wheel` fits a ring to the steering wheel's rim, starting from a guess of its centre (read it off the model in the
car viewer; within ~8 cm is enough), tilt (degrees its axis rises towards the driver, default 20) and radius
(default 0.17). It prints the centre, tilt and radius for `wheel`, and how much of the ring it found (`cover` of 24
sectors: under ~18 the guess caught something else).

Then look in the car viewer (the crew is on by default): hands on the rim, back in the seat, helmet under the roof.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltfio import load_glb, primitives  # noqa: E402


def points(path, step):
    """The interior as points: every triangle's corners plus samples so no gap is wider than about `step`."""
    g, b = load_glb(path)
    out = []
    for _, mat, tri in primitives(g, b):
        if mat.split(':')[0] in ('glass', 'body'):
            continue
        out.append(tri.reshape(-1, 3))
        edge = np.maximum.reduce([np.linalg.norm(tri[:, i] - tri[:, (i + 1) % 3], axis=1) for i in range(3)])
        for n in (2, 4, 8, 16, 32):
            sel = tri[(edge > step * n / 2) & (edge <= step * n)] if n < 32 else tri[edge > step * 16]
            for i in range(n + 1):
                for j in range(n + 1 - i):
                    a, c = i / n, j / n
                    out.append(sel[:, 0] * a + sel[:, 1] * c + sel[:, 2] * (1 - a - c))
    return np.vstack(out)


def row(label, keys, value):
    print(f' {label}: ' + ' '.join(f'{k:+.2f}:{value(k)}' for k in keys))


def seat(path, x, z_back):
    p = points(path, 0.02)
    p = p[np.abs(p[:, 0] - x) < 0.04]

    def top(sel, lo=False):
        if not sel.any():
            return '  - '
        return f'{(p[sel][:, 1].min() if lo else p[sel][:, 1].max()):.2f}'

    def front(y):
        sel = (np.abs(p[:, 1] - y) < 0.025) & (p[:, 2] < z_back) & (p[:, 2] > -0.95)
        return f'{p[sel][:, 2].max():+.2f}' if sel.any() else '  - '

    print(f'slice at x = {x}: {len(p)} points')
    row('cushion top (y) by z', np.arange(-0.6, 0.31, 0.05),
        lambda z: top((np.abs(p[:, 2] - z) < 0.025) & (p[:, 1] < 0.72) & (p[:, 1] > 0.2)))
    row('backrest front (z) by y', np.arange(0.4, 1.31, 0.05), front)
    row('overhead (y) by z', np.arange(-0.6, 0.21, 0.1),
        lambda z: top((np.abs(p[:, 2] - z) < 0.03) & (p[:, 1] > 1.05), lo=True))
    row('footwell (y) by z', np.arange(0.1, 1.01, 0.1), lambda z: top((np.abs(p[:, 2] - z) < 0.03) & (p[:, 1] < 0.33)))


def wheel(path, c, tilt, radius):
    p = points(path, 0.012)
    c = np.array(c)
    p = p[np.linalg.norm(p - c, axis=1) < 0.27]
    t = np.radians(tilt)
    n = np.array([0, np.sin(t), -np.cos(t)])

    def ring(width):
        q = p - c
        h = q @ n
        r = np.linalg.norm(q - np.outer(h, n), axis=1)
        return np.hypot(h, r - radius) < width, q

    for it in range(30):
        sel, _ = ring(0.035 if it < 8 else 0.022)
        s = p[sel]
        if len(s) < 20:
            sys.exit('no rim near that guess')
        m = s.mean(0)
        _, _, vt = np.linalg.svd(s - m, full_matrices=False)
        n = vt[2] if vt[2] @ n > 0 else -vt[2]
        X, Y = (s - m) @ vt[0], (s - m) @ vt[1]
        sol = np.linalg.lstsq(np.c_[2 * X, 2 * Y, np.ones(len(X))], X * X + Y * Y, rcond=None)[0]
        radius = float(np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2))
        c = m + vt[0] * sol[0] + vt[1] * sol[1]
    sel, q = ring(0.022)
    u = np.array([1.0, 0, 0])
    ang = np.arctan2(q[sel] @ np.cross(n, u), q[sel] @ u)
    cover = len(np.unique(np.floor((ang + np.pi) / (2 * np.pi) * 24)))
    print(f'wheel: {{ at: [{c[0]:.3f}, {c[1]:.3f}, {c[2]:.3f}], r: {radius:.3f}, '
          f'tilt: {np.degrees(np.arctan2(n[1], -n[2])):.1f} }}   cover {cover}/24, {int(sel.sum())} points')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) >= 3 and a[1] == 'seat':
        seat(a[0], float(a[2]), float(a[3]) if len(a) > 3 else -0.1)
    elif len(a) >= 5 and a[1] == 'wheel':
        wheel(a[0], [float(v) for v in a[2:5]], float(a[5]) if len(a) > 5 else 20.0, float(a[6]) if len(a) > 6 else 0.17)
    else:
        sys.exit(__doc__)
