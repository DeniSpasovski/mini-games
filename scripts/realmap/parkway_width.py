"""Real width of the stage road's carriageway along the WHOLE Jackie route (NYC planimetric roadbed minus medians).

    python scripts/realmap/parkway_width.py [--pull] [--csv out.csv] [--write]

--pull   downloads the roadbed + median polygons of a corridor along the route (boxes of CHUNK m of route + MARGIN) into
         sources/maps/jackie/nyc-planimetrics/route-<layer>.geojson (git-ignored; cached unless --pull).
--write  writes src/games/rally/maps/jackie/route-width.json: keyframes [metres along the route, width m] (`map.ts` feeds them
         to `routePoints`): the measured carriageway width, outliers (ramps / gores merged in, decks missing from the
         roadbed) dropped, smoothed over ~200 m, clamped to [MIN_W, MAX_W] (the finish cut too).
Sections every STEP m (route_offset.py's cut: the interval of the carriageway that holds the route point).
"""

import json
import os
import sys

import numpy as np
from shapely.geometry import LineString, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402
import nyc_pull  # noqa: E402
import streets  # noqa: E402

ROOT = streets.ROOT
STEP = 10.0
CHUNK = 500.0
MARGIN = 60.0
LAYERS = ('roadbed', 'median')
OUT = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'route-width.json')

# --- profile ----------------------------------------------------------------------------------------------------------------
CLEAN = (4.2, 7.2)  # m: a section this wide is the carriageway alone (wider = a shoulder / ramp / gore merged in, narrower = a clip)
MIN_W = 5.6  # m: two 2.6 m lanes + edge strips: the narrowest the stage road gets
MAX_W = 7.0  # m: two 11 ft lanes + gutters (the wider readings are shoulders the roadbed merges in)


def corridor_polys(route):
    """Socrata WKT polygons: one box per CHUNK m of route (+ MARGIN)."""
    p = endbox.proj()
    seg = np.hypot(*np.diff(route, axis=0).T)
    along = np.concatenate([[0], np.cumsum(seg)])
    out = []
    a0 = 0.0
    while a0 < along[-1]:
        m = (along >= a0 - 20) & (along <= a0 + CHUNK + 20)
        pts = route[m]
        x0, z0 = pts.min(axis=0) - MARGIN
        x1, z1 = pts.max(axis=0) + MARGIN
        ll = [p.inv(x, z) for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1), (x0, z0)]]
        out.append('POLYGON((' + ', '.join(f'{lon:.6f} {lat:.6f}' for lat, lon in ll) + '))')
        a0 += CHUNK
    return out


def pull(route):
    for name in LAYERS:
        fn = os.path.join(nyc_pull.OUT, f'route-{name}.geojson')
        feats = {}
        for poly in corridor_polys(route):
            j = nyc_pull.curl_json(
                (
                    f'https://data.cityofnewyork.us/resource/{nyc_pull.LAYERS[name]}.geojson',
                    [
                        '--data-urlencode', f"$where=intersects(the_geom, '{poly}')",
                        '--data-urlencode', f'$limit={nyc_pull.PAGE}',
                    ],
                )
            )  # fmt: skip
            if 'features' not in j:
                raise RuntimeError(f'{name}: unexpected answer {str(j)[:300]}')
            for f in j['features']:
                key = json.dumps(f['geometry'], sort_keys=True)[:4000]
                feats[key] = f
        os.makedirs(nyc_pull.OUT, exist_ok=True)
        json.dump({'type': 'FeatureCollection', 'features': list(feats.values())}, open(fn, 'w'), separators=(',', ':'))
        print(f'  {name}: {len(feats)} features -> {os.path.basename(fn)}')


def load(name, tr):
    fc = json.load(open(os.path.join(nyc_pull.OUT, f'route-{name}.geojson'), encoding='utf-8'))
    return unary_union([tr(shape(f['geometry'])).buffer(0) for f in fc['features'] if f['geometry']]).buffer(0)


def measure(route):
    tr = streets.world_transform(endbox.proj())
    road = load('roadbed', tr).buffer(0.1).buffer(-0.1)
    carriage = road.difference(load('median', tr).buffer(0.2))
    pts, t = streets.resample(route, STEP)
    tang = streets.tangents(pts)
    rows = []
    for c, tg, a in zip(pts, tang, t):
        left = np.array([tg[1], -tg[0]])
        cross = LineString([c - left * 20, c + left * 20])
        best = None
        for ln in streets.lines_of(cross.intersection(carriage)):
            u0 = cross.project(ln.interpolate(0)) - 20
            u1 = cross.project(ln.interpolate(ln.length)) - 20
            lo, hi = min(u0, u1), max(u0, u1)
            if lo - 1.0 <= 0 <= hi + 1.0:
                best = (lo, hi)
        rows.append((float(a), float(c[0]), float(c[1]), best[1] - best[0] if best else 0.0, (best[0] + best[1]) / 2 if best else 0.0))
    return rows


def profile(rows):
    from scipy.ndimage import median_filter, uniform_filter1d

    a = np.array([r[0] for r in rows])
    w = np.array([r[3] for r in rows])
    ok = (w >= CLEAN[0]) & (w <= CLEAN[1])
    raw = np.interp(a, a[ok], w[ok])
    sm = uniform_filter1d(median_filter(raw, 15, mode='nearest'), 21, mode='nearest')
    sm = np.clip(sm, MIN_W, MAX_W)
    # keys every 20 m, rounded to 5 cm (the road is a spline: finer keys add nothing)
    return [[float(x), round(float(v) * 20) / 20] for x, v in zip(a[::2], sm[::2])]


if __name__ == '__main__':
    data = json.load(open(streets.DATA, encoding='utf-8'))
    route = np.array(data['route'], float)
    if '--pull' in sys.argv:
        pull(route)
    rows = measure(route)
    ok = [r for r in rows if CLEAN[0] <= r[3] <= CLEAN[1]]
    print(f'{len(rows)} sections, {len(ok)} clean')
    print(' along      x       z   width  offset')
    for r in rows[::25]:
        print(f'{r[0]:7.0f} {r[1]:7.0f} {r[2]:7.0f} {r[3]:6.1f} {r[4]:+6.2f}')
    if '--csv' in sys.argv:
        with open(sys.argv[sys.argv.index('--csv') + 1], 'w') as f:
            f.write('along,x,z,width,offset\n')
            for r in rows:
                f.write(','.join(f'{v:.2f}' for v in r) + '\n')
    if '--write' in sys.argv:
        prof = profile(rows)
        json.dump(prof, open(OUT, 'w'), separators=(',', ':'))
        ws = [v for _, v in prof]
        print(f'route-width.json: {len(prof)} keys, {min(ws):.2f}..{max(ws):.2f} m, mean {np.mean(ws):.2f}')
