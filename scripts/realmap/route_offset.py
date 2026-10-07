"""Lateral offset of the stage road (data.route) from the real eastbound carriageway of the Jackie END BOX.

    python scripts/realmap/route_offset.py [--csv out.csv] [--write]       # --write: maps/jackie/route-shift.json

Every STEP m along the route the carriageway (NYC planimetric roadbed minus the median polygons) is cut across; the interval that
holds the route point gives the real width and mid-line. `offset` is + when the real mid-line lies LEFT of the route (travel
direction), so a shift of the route by `offset` centres it. Sections: along (m, polyline length of the control points), x, z, width.
Needs sources/maps/jackie/nyc-planimetrics/endbox-roadbed / median.geojson (nyc_pull.py).
"""

import json
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402
import streets  # noqa: E402

ROOT = streets.ROOT
STEP = 10.0


def measure():
    proj = endbox.proj()
    tr = streets.world_transform(proj)
    data = json.load(open(streets.DATA, encoding='utf-8'))
    route = np.array(data['route'], float)
    road = streets.load_union('roadbed', tr)
    fc = json.load(open(os.path.join(streets.NYC, 'endbox-median.geojson'), encoding='utf-8'))
    med = unary_union([tr(shape(f['geometry'])).buffer(0) for f in fc['features'] if f['geometry']]).buffer(0.2)
    carriage = road.difference(med)
    seg = np.hypot(*np.diff(route, axis=0).T)
    along0 = np.concatenate([[0], np.cumsum(seg)])
    pts, t = streets.resample(route, STEP)
    tang = streets.tangents(pts)
    rows = []
    for c, tg, a in zip(pts, tang, t):
        if not (endbox.X0 <= c[0] <= endbox.X1 and endbox.Z0 <= c[1] <= endbox.Z1):
            continue
        left = np.array([tg[1], -tg[0]])
        cross = LineString([c - left * 20, c + left * 20])
        best = None
        for ln in streets.lines_of(cross.intersection(carriage)):
            u0 = cross.project(ln.interpolate(0)) - 20
            u1 = cross.project(ln.interpolate(ln.length)) - 20
            lo, hi = min(u0, u1), max(u0, u1)
            if lo - 1.0 <= 0 <= hi + 1.0:
                best = (lo, hi)
        if best:
            rows.append((float(a), float(c[0]), float(c[1]), best[1] - best[0], (best[0] + best[1]) / 2))
    return rows


if __name__ == '__main__' and '--write' not in sys.argv:
    rows = measure()
    print(f'{len(rows)} cross sections')
    print(' along      x       z   width  offset')
    for a, x, z, w, o in rows[::5]:
        print(f'{a:7.0f} {x:7.0f} {z:7.0f} {w:6.1f} {o:+6.2f}')
    if '--csv' in sys.argv:
        out = sys.argv[sys.argv.index('--csv') + 1]
        with open(out, 'w') as f:
            f.write('along,x,z,width,offset\n')
            for r in rows:
                f.write(','.join(f'{v:.2f}' for v in r) + '\n')


# --- the shift profile (maps/shared/route-shift.ts) ----------------------------------------------------------------------
CLEAN = (4.5, 7.6)  # m: a cross section this wide is the carriageway alone (wider = a ramp / gore / shoulder merged in)
CAP = 1.5  # m
FROM = 5755  # the NYC data of the END BOX starts here: ramp in over RAMP_IN m
RAMP_IN = 60
RAMP = 40  # m of ramp to zero outside every structure
FINISH_CUT = 6955  # the approved four-roadway cut: untouched
OVERLOOK = (6670, 6770)  # the Union Tpke overlook (hand-built slab)


def profile():
    """[[along, lateral]] every 10 m from FROM to FINISH_CUT, zero in / near the exclusions."""
    from scipy.ndimage import median_filter, uniform_filter1d

    data = json.load(open(streets.DATA, encoding='utf-8'))
    rows = measure()
    a = np.array([r[0] for r in rows])
    w = np.array([r[3] for r in rows])
    o = np.array([r[4] for r in rows])
    ok = (w >= CLEAN[0]) & (w <= CLEAN[1])
    grid = np.arange(FROM, FINISH_CUT + 1, 10.0)
    raw = np.interp(grid, a[ok], o[ok])
    sm = np.clip(uniform_filter1d(median_filter(raw, 7, mode='nearest'), 9, mode='nearest'), -CAP, CAP)
    zones = [(s['from'], s['to']) for s in data['routeSpans']] + [OVERLOOK]

    def env(x):
        e = min(1.0, max(0.0, (x - FROM) / RAMP_IN), max(0.0, (FINISH_CUT - x) / RAMP))
        for lo, hi in zones:
            if lo > FROM - RAMP_IN and hi < FINISH_CUT + RAMP:
                e = min(e, min(1.0, max(lo - x, x - hi, 0) / RAMP))
        return e

    return [[float(x), round(float(v) * env(x), 2)] for x, v in zip(grid, sm)]


if __name__ == '__main__' and '--write' in sys.argv:
    prof = profile()
    out = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'route-shift.json')
    json.dump(prof, open(out, 'w'), separators=(',', ':'))
    print(f'route-shift.json: {len(prof)} keys, max |shift| {max(abs(v) for _, v in prof):.2f} m')
