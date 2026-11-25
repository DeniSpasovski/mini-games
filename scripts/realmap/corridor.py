"""The WEST corridor of the Jackie street model: the stage route buffered by REACH m (the streets the game dresses,
`cityStreets.reach` 500 m), minus the END BOX (endbox.py, the Kew Gardens end that has its own NYC files).

    python scripts/realmap/corridor.py        # size of the corridor and its pull chunks

Other scripts import `contains(x, z)`, `socrata_polys()` (one lon / lat box per CHUNK m of route, for `intersects`
queries), `bbox_ll_chunks()` (south, west, north, east per chunk, for point datasets) and `near_spans(paths)` (the paths
next to the stage road's bridges / portals and its start: approved structures, their width and position stay as baked).
"""

import functools
import json
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point, box
from shapely.prepared import prep

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'data.json')
REACH = 560.0
CHUNK = 600.0
# Approved structures: streets within this distance of a stage-road span / portal, or of the first START m of the route
# (the Highland Blvd bridges), keep their baked width and centre line (they only get lanes / paint / sidewalks).
PROTECT = 45.0
# ... and within this distance of a street deck near the stage road (an overpass and the streets round its ends: B4)
PROTECT_DECK = 120.0
START = 260.0


@functools.lru_cache(maxsize=1)
def route():
    return np.array(json.load(open(DATA, encoding='utf-8'))['route'], float)


@functools.lru_cache(maxsize=1)
def polygon():
    """The corridor (world x, z): the route buffered by REACH, without the END BOX."""
    return LineString(route()).buffer(REACH).difference(box(endbox.X0, endbox.Z0, endbox.X1, endbox.Z1))


@functools.lru_cache(maxsize=1)
def _prepared():
    return prep(polygon())


def contains(x, z):
    return _prepared().contains(Point(x, z))


def _chunks(margin):
    """World boxes (x0, z0, x1, z1): one per CHUNK m of route, grown by REACH + margin, clipped to the corridor's bounds."""
    r = route()
    seg = np.hypot(*np.diff(r, axis=0).T)
    along = np.concatenate([[0], np.cumsum(seg)])
    bx0, bz0, bx1, bz1 = polygon().bounds
    out = []
    a0 = 0.0
    while a0 < along[-1]:
        m = (along >= a0 - 30) & (along <= a0 + CHUNK + 30)
        pts = r[m]
        x0, z0 = pts.min(axis=0) - REACH - margin
        x1, z1 = pts.max(axis=0) + REACH + margin
        x0, z0, x1, z1 = max(x0, bx0 - margin), max(z0, bz0 - margin), min(x1, bx1 + margin), min(z1, bz1 + margin)
        if x0 < x1 and z0 < z1 and polygon().intersects(box(x0, z0, x1, z1)):
            out.append((x0, z0, x1, z1))
        a0 += CHUNK
    return out


def socrata_polys(margin=40.0):
    """WKT polygons (lon lat) of the pull chunks, for `$where=intersects(the_geom, '<wkt>')`."""
    p = endbox.proj()
    out = []
    for x0, z0, x1, z1 in _chunks(margin):
        ll = [p.inv(x, z) for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1), (x0, z0)]]
        out.append('POLYGON((' + ', '.join(f'{lon:.6f} {lat:.6f}' for lat, lon in ll) + '))')
    return out


def bbox_ll_chunks(margin=40.0):
    """(south, west, north, east) of each pull chunk."""
    p = endbox.proj()
    out = []
    for x0, z0, x1, z1 in _chunks(margin):
        ll = [p.inv(x, z) for x, z in [(x0, z0), (x1, z1), (x0, z1), (x1, z0)]]
        lats, lons = [a for a, _ in ll], [b for _, b in ll]
        out.append((min(lats), min(lons), max(lats), max(lons)))
    return out


def span_lines():
    """The stage road's bridge / portal stretches (data.routeSpans) as lines along the route."""
    data = json.load(open(DATA, encoding='utf-8'))
    r = route()
    seg = np.hypot(*np.diff(r, axis=0).T)
    along = np.concatenate([[0], np.cumsum(seg)])
    out = []
    for s in data.get('routeSpans', []):
        m = (along >= s['from'] - 5) & (along <= s['to'] + 5)
        pts = r[m]
        if len(pts) >= 2:
            out.append(LineString(pts))
        elif len(pts) == 1:
            out.append(Point(pts[0]))
    m = along <= START
    out.append(LineString(r[m]))
    return out


def near_spans(paths):
    """Indices of the paths with a point within PROTECT m of a span / portal stretch, the route's start, or a street deck
    near the stage road (an overpass: B4)."""
    zones = [g.buffer(PROTECT) for g in span_lines()]
    rl = LineString(route())
    for p in paths:
        if p.get('bridge') and len(p['pts']) >= 4:
            ln = LineString(np.array(p['pts']).reshape(-1, 2))
            if ln.distance(rl) < 80:
                zones.append(ln.buffer(PROTECT_DECK))
    out = set()
    for i, p in enumerate(paths):
        ln = LineString(np.array(p['pts']).reshape(-1, 2)) if len(p['pts']) >= 4 else Point(p['pts'][0], p['pts'][1])
        if any(z.intersects(ln) for z in zones):
            out.add(i)
    return out


if __name__ == '__main__':
    poly = polygon()
    print(f'WEST corridor: {poly.area / 1e6:.1f} km2, route {len(route())} points, {len(_chunks(40))} pull chunks')
    print(socrata_polys()[0])
