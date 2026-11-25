"""
Survey data for the v2 road network (network.py, config key `survey`): real roadbed widths per edge and surveyed spot
heights, so a map follows the city's survey instead of OSM defaults.

    "survey": {
      "planimetrics": "sources/maps/jackie/nyc-planimetrics",   # *-roadbed.geojson + *-median.geojson (nyc_pull.py)
      "spotHeights": "src/games/rally/maps/jackie/spot-heights.json",   # spot_heights.py: route + streets [x, z, y]
      "datum": 32.9,                                             # world y = survey y - datum (the heightmap offset)
      "retainingWalls": "src/games/rally/maps/jackie/retaining-walls.json",   # retaining_walls.py: {walls: [[x, z, ...]]}
      "wallsUntil": 6850                                         # stage m the wall survey covers (beyond: the daylight rule)
    }

- Widths: every SECTION_STEP m along an edge, a cross line meets the roadbed minus the medians (one carriageway of a
  divided road); the interval holding the edge line is its curb-to-curb width. The median of the clean sections
  (MIN_W..MAX_W, at least MIN_SHARE of them) becomes the edge's `surveyWidth` (the engine scales the template's pavement
  to it, `templates.ts buildSection`). Same for the stage route (`stage.surveyWidth`), plus its width per station
  (`stage.widths`, smoothed over 200 m: the engine narrows the stage pavement along it, `network.ts stageScale`).
- Heights: the spot list in world heights (`survey.heights`); the engine's profiles follow them (`network.ts profiles`).
- Retaining walls: the surveyed wall lines (`survey.walls`) and the stage metres they cover (`survey.wallsUntil`): there
  the parkway's cut / fill walls stand only beside a surveyed one (`network.ts surveyedWall`), elsewhere a bank.

`sources/` is git-ignored and lives only in the main checkout: a worktree finds it there (git common dir).
"""

import glob
import json
import math
import os
import subprocess

import numpy as np
from shapely.geometry import LineString, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

SECTION_STEP = 10.0
REACH = 20.0
# A section this wide (m) is one carriageway / street: narrower is a clip, wider a junction or a gore merged in.
MIN_W = 3.0
MAX_W = 24.0
MIN_SHARE = 0.5


def find_path(root, rel):
    """`rel` under the checkout, else under the main checkout (sources/ is git-ignored, not in worktrees)."""
    p = os.path.join(root, rel)
    if os.path.exists(p):
        return p
    try:
        common = subprocess.run(
            ['git', 'rev-parse', '--git-common-dir'], cwd=root, capture_output=True, text=True, check=True
        ).stdout.strip()
        main = os.path.dirname(os.path.abspath(os.path.join(root, common)))
        p2 = os.path.join(main, rel)
        if os.path.exists(p2):
            return p2
    except (OSError, subprocess.CalledProcessError):
        pass
    return None


def carriageways(folder, proj):
    def load(pattern):
        polys = []
        for fn in sorted(glob.glob(os.path.join(folder, pattern))):
            for f in json.load(open(fn, encoding='utf-8'))['features']:
                if f.get('geometry'):
                    g = transform(lambda lon, lat, z=None: proj.fwd(lat, lon), shape(f['geometry'])).buffer(0)
                    if not g.is_empty:
                        polys.append(g)
        return polys

    road = unary_union(load('*-roadbed.geojson')).buffer(0.1).buffer(-0.1)
    med = unary_union(load('*-median.geojson')).buffer(0.2)
    cw = road.difference(med)
    parts = list(getattr(cw, 'geoms', [cw]))
    return parts, STRtree(parts)


def section_width(c, tg, parts, tree):
    left = np.array([tg[1], -tg[0]])
    cross = LineString([c - left * REACH, c + left * REACH])
    best = None
    for i in tree.query(cross):
        g = cross.intersection(parts[i])
        for ln in getattr(g, 'geoms', [g]):
            if ln.is_empty or ln.geom_type != 'LineString':
                continue
            u0 = cross.project(ln.interpolate(0)) - REACH
            u1 = cross.project(ln.interpolate(ln.length)) - REACH
            lo, hi = min(u0, u1), max(u0, u1)
            if lo - 1.0 <= 0 <= hi + 1.0:
                best = hi - lo
    return best


def line_width(pts, parts, tree):
    """Median clean section width along a polyline [n, 2], or None."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    d = np.concatenate([[0], np.cumsum(seg)])
    if d[-1] < SECTION_STEP:
        return None
    # not the ends: a junction's roadbed is there
    t = np.arange(SECTION_STEP / 2, d[-1] - SECTION_STEP / 4, SECTION_STEP)
    c = np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], 1)
    g = np.gradient(c, axis=0) if len(c) > 1 else np.array([pts[-1] - pts[0]])
    g = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    ws = [section_width(ci, gi, parts, tree) for ci, gi in zip(c, g)]
    ok = [w for w in ws if w is not None and MIN_W <= w <= MAX_W]
    if len(ok) < max(1, math.ceil(MIN_SHARE * len(ws))):
        return None
    return round(float(np.median(ok)), 2)


def station_widths(pts, parts, tree, length):
    """Stage width per station: [[m along the stage road, width], ...] every STATION_STEP m, the median of the clean
    sections within STATION_SMOOTH m (gaps = a junction / gore: the nearest clean one), clamped. m scaled to `length`."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    d = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(SECTION_STEP / 2, d[-1], SECTION_STEP)
    c = np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], 1)
    g = np.gradient(c, axis=0)
    g = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    ws = np.array([section_width(ci, gi, parts, tree) or np.nan for ci, gi in zip(c, g)], float)
    ok = (ws >= STATION_CLEAN[0]) & (ws <= STATION_CLEAN[1])
    if ok.sum() < 2:
        return None
    out = []
    half = STATION_SMOOTH / 2
    for m in np.arange(0, d[-1] + STATION_STEP / 2, STATION_STEP):
        win = ok & (np.abs(t - m) <= half)
        if not win.any():
            win = ok & (np.abs(t - m) == np.min(np.abs(t[ok] - m)))
        w = float(np.clip(np.median(ws[win]), *STATION_CLAMP))
        out.append([round(float(m * length / d[-1]), 1), round(w, 2)])
    return out


# Stage width stations (m), their smoothing window (m), the clean section widths (wider = a shoulder / ramp / gore the
# roadbed merges in, narrower = a clip) and the clamp (two 2.6 m lanes + strips .. two 11 ft lanes + gutters): the same
# rules as v1's parkway_width.py.
STATION_STEP = 20.0
STATION_SMOOTH = 200.0
STATION_CLEAN = (4.2, 7.2)
STATION_CLAMP = (5.6, 7.0)


def apply(cfg, root, proj, network, stage_line):
    sv = cfg.get('survey')
    if not sv:
        return
    folder = find_path(root, sv['planimetrics'])
    if folder:
        parts, tree = carriageways(folder, proj)
        n = 0
        for e in network['edges']:
            w = line_width(np.array(e['pts'], float).reshape(-1, 2), parts, tree)
            if w:
                e['surveyWidth'] = w
                n += 1
        sw = line_width(np.asarray(stage_line, float), parts, tree)
        if sw:
            network['stage']['surveyWidth'] = sw
        st = station_widths(np.asarray(stage_line, float), parts, tree, network['stage']['length'])
        if st:
            network['stage']['widths'] = st
        print(f'  survey: widths on {n} of {len(network["edges"])} edges, stage {sw} m, {len(st or [])} stations')
    else:
        print(f'  survey: {sv["planimetrics"]} not found, no widths')
    if sv.get('spotHeights'):
        sp = json.load(open(os.path.join(root, sv['spotHeights'])))
        datum = sv.get('datum', 0.0)
        hs = [[round(x, 2), round(z, 2), round(y - datum, 2)] for k in ('route', 'streets') for x, z, y in sp.get(k, [])]
        network['survey'] = {'heights': hs, 'source': sp.get('source', '')}
        print(f'  survey: {len(hs)} spot heights')
    if sv.get('retainingWalls'):
        rw = json.load(open(os.path.join(root, sv['retainingWalls'])))
        network.setdefault('survey', {})['walls'] = [[round(v, 2) for v in w] for w in rw['walls']]
        network['survey']['wallsUntil'] = sv.get('wallsUntil', network['stage']['length'])
        print(f'  survey: {len(rw["walls"])} retaining walls (stage to {network["survey"]["wallsUntil"]} m)')
