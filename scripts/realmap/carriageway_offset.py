"""The opposite (westbound) carriageway of the Jackie moved onto the real pavement, like the stage road (route_offset.py).

    python scripts/realmap/carriageway_offset.py            # report per 400 m of route
    python scripts/realmap/carriageway_offset.py --write    # maps/jackie/carriageway-shift.json

The ground `motorway` ways within REACH m of the route are joined into chains (end to end, one continuation each). Every
STEP m along a chain the NYC carriageways (planimetric roadbed minus the medians, END BOX + WEST corridor files) are cut
across: the clean section (CLEAN m wide) holding the chain's point and the one holding the stage road give the real distance
between the two carriageways' mid-lines. The way moves to that distance from the stage road AS THE GAME HAS IT (data.route
+ route-shift.json): the median is the real one, the approved stage road stays (OSM has both carriageways up to 2.5 m off
the pavement outside the END BOX, where the stage road keeps its OSM line). The lateral offset (+ = left of the way's
direction) is filtered, smoothed, capped at CAP m and faded to zero over RAMP m at every structure (stage-road spans, the
carriageway's own decks, a chain end that meets no ground carriageway) and in the approved zones (ZONES, m along the
route). Output: per way {k: its end points as baked, o: offset per vertex} -> `maps/shared/carriageway-shift.ts`.
"""

import json
import os
import sys

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402
import streets  # noqa: E402

ROOT = streets.ROOT
OUT = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'carriageway-shift.json')
REACH = 30.0  # m: a motorway way this close to the route is the opposite carriageway
STEP = 5.0
CLEAN = (4.5, 8.0)  # m: a section this wide is the carriageway alone
GAP = 80.0  # m: a longer run without a clean section keeps the OSM line
CAP = 2.0
RAMP = 40.0
JOIN = 0.5
# Approved structures, m along the route: the start bridge, the Union Tpke overlook, the finish cut (four roadways).
ZONES = [(-1e9, 300), (6670, 6770), (6955, 1e9)]


def carriage():
    proj = endbox.proj()
    tr = streets.world_transform(proj)
    parts = []
    for region in ('endbox', 'west'):
        streets.set_region(region)
        road = streets.load_union('roadbed', tr)
        fc = json.load(open(os.path.join(streets.NYC, f'{region}-median.geojson'), encoding='utf-8'))
        med = unary_union([tr(shape(f['geometry'])).buffer(0) for f in fc['features'] if f['geometry']]).buffer(0.2)
        parts.append(road.difference(med))
    streets.set_region('endbox')
    return unary_union(parts)


def chains(paths, route):
    """Lists of way indices, each a run of ground motorway ways joined end to start."""
    ids = [
        i
        for i, p in enumerate(paths)
        if p['kind'] == 'motorway' and not p.get('bridge') and p['surface'] == 'tarmac'
        and LineString(np.array(p['pts']).reshape(-1, 2)).distance(route) <= REACH
    ]
    start = {i: np.array(paths[i]['pts'][:2]) for i in ids}
    end = {i: np.array(paths[i]['pts'][-2:]) for i in ids}
    nxt, prv = {}, {}
    for a in ids:
        cand = [b for b in ids if b != a and np.hypot(*(start[b] - end[a])) <= JOIN]
        if len(cand) == 1:
            nxt[a] = cand[0]
    for a, b in nxt.items():
        prv.setdefault(b, []).append(a)
    out, seen = [], set()
    for i in ids:
        if i in seen or len(prv.get(i, [])) == 1:
            continue
        run = [i]
        seen.add(i)
        while run[-1] in nxt and nxt[run[-1]] not in seen and len(prv.get(nxt[run[-1]], [])) == 1:
            run.append(nxt[run[-1]])
            seen.add(run[-1])
        out.append(run)
    for i in ids:  # (loops)
        if i not in seen:
            out.append([i])
    return out


def main():
    data = json.load(open(streets.DATA, encoding='utf-8'))
    paths = data['paths']
    route = LineString(data['route'])
    rshift = np.array(json.load(open(os.path.join(os.path.dirname(OUT), 'route-shift.json'))), float)
    cw = carriage()
    decks = [LineString(np.array(p['pts']).reshape(-1, 2)) for p in paths if p.get('bridge') and len(p['pts']) >= 4]
    spans = [(s['from'], s['to']) for s in data.get('routeSpans', [])]
    zones = spans + ZONES
    entries, report = [], []
    for run in chains(paths, route):
        line = np.concatenate([np.array(paths[i]['pts']).reshape(-1, 2) if k == 0 else np.array(paths[i]['pts']).reshape(-1, 2)[1:]
                               for k, i in enumerate(run)])  # fmt: skip
        if LineString(line).length < 2 * STEP:
            continue
        pts, t = streets.resample(line, STEP)
        tang = streets.tangents(pts)
        off = np.full(len(pts), np.nan)
        for j, (c, tg) in enumerate(zip(pts, tang)):
            left = np.array([tg[1], -tg[0]])
            cross = LineString([c - left * 30, c + left * 30])
            # the stage road on this cross line (as the game has it: + its route shift, + = left of the route = towards
            # this carriageway's left as well, the carriageways run opposite ways)
            ra = route.project(Point(c))
            rp = np.array(route.interpolate(ra).coords[0])
            osm = float(np.dot(rp - c, left))
            rl = osm - (float(np.interp(ra, rshift[:, 0], rshift[:, 1], left=0, right=0)) if len(rshift) else 0.0)
            mine = stage = None
            for seg in streets.lines_of(cross.intersection(cw)):
                u0 = cross.project(seg.interpolate(0)) - 30
                u1 = cross.project(seg.interpolate(seg.length)) - 30
                lo, hi = min(u0, u1), max(u0, u1)
                if not CLEAN[0] <= hi - lo <= CLEAN[1]:
                    continue
                if lo - 1.0 <= 0 <= hi + 1.0:
                    mine = (lo + hi) / 2
                # the stage road's real pavement: the section its OSM line lies in (it is up to 2.5 m off)
                if lo - 2.5 <= osm <= hi + 2.5:
                    stage = (lo + hi) / 2
            if mine is not None and stage is not None and stage > mine:
                off[j] = rl - (stage - mine)
        ok = ~np.isnan(off)
        if ok.sum() < 3:
            continue
        # fill short gaps, keep long ones at 0
        filled = np.interp(t, t[ok], off[ok])
        near = np.array([np.min(np.abs(t[ok] - a)) for a in t])
        filled[near > GAP / 2] = 0.0
        prof = np.clip(uniform_filter1d(median_filter(filled, 7, mode='nearest'), 9, mode='nearest'), -CAP, CAP)
        # envelope: structures and approved zones
        ra = np.array([route.project(Point(c)) for c in pts])
        env = np.ones(len(pts))
        for lo, hi in zones:
            env = np.minimum(env, np.clip(np.maximum(lo - ra, ra - hi) / RAMP, 0, 1))
        for dk in decks:
            dd = np.array([dk.distance(Point(c)) for c in pts])
            env = np.minimum(env, np.clip((dd - 2) / RAMP, 0, 1))
        # a chain end that meets no ground carriageway (a deck, a ramp's end, the map edge) stays put
        L = t[-1]
        env = np.minimum(env, np.clip(np.minimum(t, L - t) / RAMP, 0, 1))
        prof = prof * env
        # per way: offset at each vertex (chain arc length of the vertex)
        acc = 0.0
        for k, i in enumerate(run):
            xy = np.array(paths[i]['pts']).reshape(-1, 2)
            seg = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
            o = np.interp(acc + seg, t, prof)
            acc += seg[-1]
            if np.max(np.abs(o)) < 0.05:
                continue
            p = paths[i]['pts']
            entries.append({'k': [p[0], p[1], p[-2], p[-1]], 'o': [round(float(v), 2) for v in o]})
        report += [(float(a), float(w)) for a, w in zip(ra, prof)]
    rep = np.array(report)
    for lo in range(0, 7600, 400):
        m = (rep[:, 0] >= lo) & (rep[:, 0] < lo + 400)
        if m.sum():
            print(f'{lo:5d}-{lo + 400:5d}  shift median {np.median(rep[m, 1]):+5.2f}  max |shift| {np.max(np.abs(rep[m, 1])):4.2f}')
    print(f'{len(entries)} ways shifted')
    if '--write' in sys.argv:
        json.dump(entries, open(OUT, 'w'), separators=(',', ':'))
        print(f'wrote {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
