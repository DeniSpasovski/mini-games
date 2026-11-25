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
- Lidar (`lidar`, see the section below): 1 m ground tiles and the road's spot heights from the public point cloud near
  the stage.
- Retaining walls: the surveyed wall lines (`survey.walls`) and the stage metres they cover (`survey.wallsUntil`): there
  the parkway's cut / fill walls stand only beside a surveyed one (`network.ts surveyedWall`), elsewhere a bank.

`sources/` is git-ignored and lives only in the main checkout: a worktree finds it there (git common dir).
"""

import base64
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
# edges without a width from SECTION_STEP sections: from SHORT_MIN m long, SHORT_SECTIONS sections, SHORT_END m clear of the ends
SHORT_MIN = 6.0
SHORT_SECTIONS = 4
SHORT_END = 3.0


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
    """Median clean section width along a polyline [n, 2], or None: sections every SECTION_STEP m, not at the ends (a
    junction's roadbed is there). An edge too short for that (a street between two close junctions, a short deck) gets
    SHORT_SECTIONS sections over its length instead, SHORT_END m clear of its ends."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    d = np.concatenate([[0], np.cumsum(seg)])
    w = None
    if d[-1] >= SECTION_STEP:
        w = sections_width(pts, d, np.arange(SECTION_STEP / 2, d[-1] - SECTION_STEP / 4, SECTION_STEP), parts, tree)
    if w is None and d[-1] >= SHORT_MIN:
        step = d[-1] / SHORT_SECTIONS
        end = max(step / 2, min(SHORT_END, d[-1] / 4))
        w = sections_width(pts, d, np.arange(end, d[-1] - end + 1e-6, step), parts, tree)
    return w


def sections_width(pts, d, t, parts, tree):
    """The median clean width of cross sections at arc lengths t, or None (too few clean ones)."""
    if not len(t):
        return None
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


# --- carriageway lines (config survey.centre) ---------------------------------------------------------------------------
# OSM's parkway lines wander 1-2 m off the city's roadbed (both carriageways, the stage too: drive videos and the lidar
# walls sit on the planimetric edges). `"centre": true` moves the stage route and every motorway / trunk mainline edge
# sideways onto its roadbed's centre: sections every CENTRE_STEP m (clean: one carriageway CENTRE_CLEAN m wide holding
# the line), their centre offset as a running median over CENTRE_SMOOTH m, clamped to CENTRE_MAX, gaps interpolated;
# tunnels from CENTRE_BORE m keep their OSM line: nothing within CENTRE_BORE_R m of one moves (eased over CENTRE_HOLD m
# beyond), decks are interpolated over. A node moves with
# its mainline edges (their mean end offset; a stage node with the stage) and drags the other edges' ends along, faded
# over CENTRE_EASE m. Mainline edges also get their width per station (`widths`, as the stage's: the engine narrows
# their pavement to it). Applied once (a full import starts from OSM again; --survey-only skips a centred network).
CENTRE_KINDS = ('motorway', 'trunk')
CENTRE_STEP = 10.0
CENTRE_CLEAN = (4.2, 9.0)
CENTRE_SMOOTH = 120.0
CENTRE_MAX = 3.0
CENTRE_HOLD = 60.0
CENTRE_BORE = 40.0  # m: a tunnel this long keeps its line (a short underpass is a street's deck over the road)
CENTRE_BORE_R = 25.0  # m around such a bore nothing moves (the parallel bore, the streets on its roof)
CENTRE_EASE = 40.0


def arc(pts):
    return np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])


def normals(pts):
    g = np.gradient(pts, axis=0)
    g = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    return np.stack([g[:, 1], -g[:, 0]], 1)  # (left, as section_width)


def section_centre(c, tg, parts, tree):
    """(centre offset + left, width) of the roadbed interval holding point c on its cross line, or None."""
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
                best = ((lo + hi) / 2, hi - lo)
    return best


def centre_profile(pts, parts, tree, hold=None):
    """Smoothed lateral offset (m, + left) of polyline pts [n, 2] onto its roadbed centre, at each vertex, or None.
    hold(m) -> True on a structure (offset 0 there, eased)."""
    d = arc(pts)
    if d[-1] < CENTRE_STEP:
        return None
    t = np.arange(CENTRE_STEP / 2, d[-1], CENTRE_STEP)
    c = np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], 1)
    g = np.gradient(c, axis=0) if len(c) > 1 else np.array([pts[-1] - pts[0]])
    g = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    raw = np.full(len(t), np.nan)
    for k, (ci, gi) in enumerate(zip(c, g)):
        r = section_centre(ci, gi, parts, tree)
        if r and CENTRE_CLEAN[0] <= r[1] <= CENTRE_CLEAN[1]:
            raw[k] = r[0]
    held = np.array([bool(hold and hold(m)) for m in t])
    raw[held] = np.nan
    ok = ~np.isnan(raw)
    if ok.sum() < max(3, 0.3 * len(t)):
        return None
    sm = np.full(len(t), np.nan)
    for k in range(len(t)):
        win = ok & (np.abs(t - t[k]) <= CENTRE_SMOOTH / 2)
        if win.sum() >= 3:
            sm[k] = np.median(raw[win])
    good = ~np.isnan(sm)
    if not good.any():
        return None
    sm = np.interp(t, t[good], sm[good])
    sm = np.clip(sm, -CENTRE_MAX, CENTRE_MAX)
    if held.any():
        dh = np.min(np.abs(t[:, None] - t[held][None, :]), axis=1)
        sm *= np.clip(dh / CENTRE_HOLD, 0, 1) ** 2 * (3 - 2 * np.clip(dh / CENTRE_HOLD, 0, 1))
    return np.interp(d, t, sm)


def fade(s, L):
    """1 at an end (s = 0) .. 0 from CENTRE_EASE m in (smoothstep)."""
    u = np.clip(s / max(1e-6, min(CENTRE_EASE, L / 2)), 0, 1)
    return 1 - u * u * (3 - 2 * u)


def stage_tunnels(network):
    """Stage m ranges of its long tunnel stretches."""
    return [(sp['from'], sp['to']) for sp in network['stage']['spans']
            if sp['kind'] != 'bridge' and sp['to'] - sp['from'] >= CENTRE_BORE]  # fmt: skip


def bore_keep(network, line, hold=None, reach=CENTRE_BORE_R, ease=CENTRE_HOLD, edges=True):
    """f(points) -> per point 0 within `reach` m of a bore (the stage's long tunnel stretches, every long tunnel run of
    an edge unless not `edges`) .. 1 from `reach` + `ease` m out (smoothstep)."""
    from scipy.spatial import cKDTree

    line = np.asarray(line, float)
    dl = arc(line)
    if hold is None:
        scale = network['stage']['length'] / max(1e-6, dl[-1])
        spans = stage_tunnels(network)

        def hold(m):
            return any(a <= m * scale <= b for a, b in spans)

    sets = network['tagSets']
    bore = [line[k] for k in range(len(line)) if hold(dl[k])]
    for e in network['edges'] if edges else ():
        p = np.array(e['pts'], float).reshape(-1, 2)
        d = arc(p)
        for k, (s0, ti) in enumerate(e['tags']):
            s1 = e['tags'][k + 1][0] if k + 1 < len(e['tags']) else len(p) - 1
            if sets[ti].get('tunnel') and d[s1] - d[s0] >= CENTRE_BORE:
                q = p[s0:s1 + 1]
                bore += list(np.vstack([np.linspace(q[i], q[i + 1], max(2, int(np.hypot(*(q[i + 1] - q[i])) / 2)))
                                        for i in range(len(q) - 1)]))
    kd = cKDTree(np.array(bore)) if bore else None

    def keep(pts):
        if kd is None:
            return np.ones(len(np.asarray(pts).reshape(-1, 2)))
        u = np.clip((kd.query(np.asarray(pts, float).reshape(-1, 2))[0] - reach) / ease, 0, 1)
        return u * u * (3 - 2 * u)

    return keep


def centre(network, parts, tree, stage_line):
    """Moves the stage route and the mainline edges onto their roadbed centres (see above). Returns the moved stage
    line (or the given one)."""
    sv = network.setdefault('survey', {})
    if sv.get('centred'):
        print('  survey: lines already centred (a full import re-centres)')
        return stage_line
    st = network['stage']
    sets = network['tagSets']
    scale = None
    line = np.asarray(stage_line, float)
    dl = arc(line)
    scale = st['length'] / max(1e-6, dl[-1])
    spans = stage_tunnels(network)

    def stage_hold(m):
        return any(a <= m * scale <= b for a, b in spans)

    so = centre_profile(line, parts, tree, stage_hold)
    keep = bore_keep(network, line, stage_hold)

    moved_line = line if so is None else line + normals(line) * so[:, None]

    def stage_disp(m_stage):
        if so is None:
            return np.zeros(2)
        m = np.clip(m_stage / scale, 0, dl[-1])
        k = min(len(dl) - 2, max(0, int(np.searchsorted(dl, m) - 1)))
        f = (m - dl[k]) / max(1e-9, dl[k + 1] - dl[k])
        return (moved_line[k] - line[k]) * (1 - f) + (moved_line[k + 1] - line[k + 1]) * f

    # the stage's control points: each moves with the stage line at its own m along it
    cps = np.asarray(st['cps'], float)
    dc = arc(cps) * st['length'] / max(1e-6, arc(cps)[-1])
    dv = np.array([stage_disp(m) for m in dc]) * keep(cps)[:, None]
    st['cps'] = [[round(float(x), 2), round(float(z), 2)] for x, z in cps + dv]
    # mainline edges' own offsets
    own = {}
    for e in network['edges']:
        if e['kind'] not in CENTRE_KINDS:
            continue
        p = np.array(e['pts'], float).reshape(-1, 2)
        seg_st = []
        for k, (s0, ti) in enumerate(e['tags']):
            s1 = e['tags'][k + 1][0] if k + 1 < len(e['tags']) else len(p) - 1
            seg_st += [bool(sets[ti].get('tunnel'))] * (s1 - s0)
        d = arc(p)
        ranges = [(d[i], d[i + 1]) for i, s in enumerate(seg_st) if s]
        if sum(b - a for a, b in ranges) < CENTRE_BORE:
            ranges = []
        o = centre_profile(p, parts, tree, lambda m, r=ranges: any(a - 1 <= m <= b + 1 for a, b in r))
        if o is not None:
            own[e['id']] = (p, normals(p) * o[:, None])
    # node moves: a stage node with the stage, else the mean end offset of its mainline edges
    length = st['length']
    runout = st.get('runout', {}).get('length', 0)
    disp = {}
    ends = {}
    for e in network['edges']:
        for at, nid in enumerate(e['nodes']):
            ends.setdefault(nid, []).append((e, at))
    for n in network['nodes']:
        nid, along = n[0], n[4]
        if along >= 0:
            v = stage_disp(min(along, length))
            if along > length:
                v = v * float(fade(np.array([runout - (along - length)]), runout)[0]) if runout else v * 0
            disp[nid] = v
            continue
        vs = [own[e['id']][1][-1 if at else 0] for e, at in ends.get(nid, []) if e['id'] in own]
        if vs:
            disp[nid] = np.mean(vs, axis=0)
    moved = 0
    for n in network['nodes']:
        v = disp.get(n[0])
        if v is not None:
            v = v * keep([n[1], n[2]])[0]  # (as the edges' ends below)
        if v is not None and np.hypot(*v) > 0.01:
            n[1], n[2] = round(float(n[1] + v[0]), 2), round(float(n[2] + v[1]), 2)
    for e in network['edges']:
        p = np.array(e['pts'], float).reshape(-1, 2)
        d = arc(p)
        L = d[-1]
        v = own[e['id']][1].copy() if e['id'] in own else np.zeros_like(p)
        for at, nid in enumerate(e['nodes']):
            dn = disp.get(nid)
            if dn is None:
                dn = v[-1 if at else 0]
            w = fade(L - d if at else d, L)[:, None]
            v = v * (1 - w) + dn[None, :] * w
        v = v * keep(p)[:, None]
        if np.abs(v).max() > 0.01:
            e['pts'] = [round(float(x), 2) for x in (p + v).reshape(-1)]
            moved += 1
    if st.get('runout'):
        rp = np.asarray(st['runout']['pts'], float)
        d = arc(np.vstack([cps[-1:], rp]))[1:]
        v0 = stage_disp(length) * keep(cps[-1:])[0]
        rl = st['runout']['length']
        st['runout']['pts'] = [[round(float(x), 2), round(float(z), 2)]
                               for x, z in rp + v0[None, :] * (1 - np.clip(d / max(1e-6, rl), 0, 1))[:, None]]
    sv['centred'] = moved
    shift = np.abs(so) if so is not None else np.zeros(1)
    print(f'  survey: centred the stage (median {np.median(shift):.2f} m, max {shift.max():.2f} m) and {len(own)} '
          f'mainline edges; {moved} edges moved')
    return moved_line


# A mainline's widths near the stage's bores: none (the engine keeps the template section within TUNNEL_HOLD m along of
# the stage's tunnels and eases over WIDTH_EASE, network.ts): the same reach here, as a width that clamps to the
# template. An edge with a tunnel run from CENTRE_BORE m gets none.
WIDTH_BORE_R = 150.0
WIDTH_BORE_EASE = 100.0
WIDTH_TEMPLATE = 99.0


def mainline_widths(network, parts, tree, stage_line):
    """Width per station on the mainline edges (`edge.widths`, m along the edge), as the stage's; tunnel edges none."""
    keep = bore_keep(network, stage_line, reach=WIDTH_BORE_R, ease=WIDTH_BORE_EASE, edges=False)
    sets = network['tagSets']
    n = 0
    for e in network['edges']:
        if e['kind'] not in CENTRE_KINDS:
            continue
        p = np.array(e['pts'], float).reshape(-1, 2)
        L = arc(p)[-1]
        if L < 2 * SECTION_STEP:
            continue
        d = arc(p)
        bore = any(sets[ti].get('tunnel') and d[e['tags'][k + 1][0] if k + 1 < len(e['tags']) else -1] - d[s0]
                   >= CENTRE_BORE for k, (s0, ti) in enumerate(e['tags']))  # fmt: skip
        st = None if bore else station_widths(p, parts, tree, L)
        if st:
            at = np.stack([np.interp([m for m, _ in st], d, p[:, 0]), np.interp([m for m, _ in st], d, p[:, 1])], 1)
            kw = keep(at)
            st = [[m, round(min(WIDTH_TEMPLATE, w / max(k, 1e-3)), 2)] for (m, w), k in zip(st, kw)]
            e['widths'] = st
            n += 1
        else:
            e.pop('widths', None)
    # a short piece between two surveyed ones (an underpass under a street deck, no roadbed survey there): their end
    # widths, joined
    ends = {}
    for e in network['edges']:
        for at, nid in enumerate(e['nodes']):
            ends.setdefault(nid, []).append((e, at))
    for e in network['edges']:
        if e['kind'] not in CENTRE_KINDS or e.get('widths'):
            continue
        p = np.array(e['pts'], float).reshape(-1, 2)
        L = arc(p)[-1]
        if L >= 4 * SECTION_STEP:
            continue
        ws = []
        for at, nid in enumerate(e['nodes']):
            o = [(f, a) for f, a in ends.get(nid, []) if f is not e]
            if len(o) == 1 and o[0][0].get('widths') and o[0][0]['kind'] in CENTRE_KINDS:
                st = o[0][0]['widths']
                ws.append(st[-1][1] if o[0][1] else st[0][1])
        if len(ws) == 2:
            e['widths'] = [[0.0, ws[0]], [round(float(L), 1), ws[1]]]
            n += 1
    return n


def apply(cfg, root, proj, network, stage_line):
    sv = cfg.get('survey')
    if not sv:
        return
    folder = find_path(root, sv['planimetrics'])
    if folder:
        parts, tree = carriageways(folder, proj)
        if sv.get('centre'):
            stage_line = centre(network, parts, tree, stage_line)
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
        if sv.get('centre'):
            print(f'  survey: widths per station on {mainline_widths(network, parts, tree, stage_line)} mainline edges')
    else:
        print(f'  survey: {sv["planimetrics"]} not found, no widths')
    if sv.get('spotHeights'):
        sp = json.load(open(os.path.join(root, sv['spotHeights'])))
        datum = sv.get('datum', 0.0)
        hs = [[round(x, 2), round(z, 2), round(y - datum, 2)] for k in ('route', 'streets') for x, z, y in sp.get(k, [])]
        source = sp.get('source', '')
        if sv.get('lidar') and folder:
            in_area, ls = lidar_spots(sv['lidar'], root, proj, stage_line, folder, datum)
            n0 = len(hs)
            hs = [h for h in hs if not in_area(h[0], h[1])]
            print(f'  survey: lidar area: {n0 - len(hs)} spot heights replaced by {len(ls)} lidar ones')
            hs += ls
            source += '; USGS 3DEP lidar ground'
        network.setdefault('survey', {}).update(heights=hs, source=source)
        print(f'  survey: {len(hs)} spot heights')
    if sv.get('retainingWalls'):
        rw = json.load(open(os.path.join(root, sv['retainingWalls'])))
        network.setdefault('survey', {})['walls'] = [[round(v, 2) for v in w] for w in rw['walls']]
        network['survey']['wallsUntil'] = sv.get('wallsUntil', network['stage']['length'])
        print(f'  survey: {len(rw["walls"])} retaining walls (stage to {network["survey"]["wallsUntil"]} m)')


# --- lidar ground (config survey.lidar) ----------------------------------------------------------------------------------
# Public lidar point cloud (USGS 3DEP, Entwine Point Tile on AWS, EPSG:3857, heights in metres = the heightmap's datum)
# for a world box. Its ground returns (LIDAR_GROUND) binned to a 1 m median grid, holes (buildings, decks, water)
# filled linearly. Two uses within `corridor` m of the stage from stage metre `from`:
#   - terrain: 1 m height grids (`tile` m blocks + LIDAR_PAD m overlap) put ahead of the map's 10 m grid (data.json)
#   - road heights: in the same area the survey's spot heights are replaced by lidar ground on the roadbed every
#     LIDAR_SPOT m (one source per area: the city's spot heights sit up to 0.7 m off the lidar in the Kew trench);
#     spots where the lidar has no ground (decks, bridges) stay
#
#     "lidar": {"ept": "<EPT folder url>", "box": [x0, x1, z0, z1], "corridor": 60, "from": 6450, "tile": 64,
#               "cache": "sources/maps/<id>/lidar"}
#
# Needs laspy + lazrs (pip install laspy lazrs) the first time (then cached in `cache`, git-ignored).

LIDAR_GROUND = (2, 18)  # ground, overlap ground (USGS NY_NewYorkCity classes)
LIDAR_PAD = 8  # m each tile reaches into its neighbours (> the engine's 6-cell edge blend)
LIDAR_SPOT = 5.0  # m between lidar spot heights on the roadbed
LIDAR_DECK_PAD = 3.0  # m around a planimetric deck outline that is deck, not ground (the outlines sit a few m off the lidar)


def lidar_ground(lc, root, proj, coarse=None, structures=None):
    """-> (x0, z0, grid [rows, cols] m, have [rows, cols]: the cell holds ground returns), 1 m cells.

    The binned returns are cached; the holes (buildings, decks, water) are filled from `coarse` (x, z arrays -> height,
    the map's own grid: a bare-earth DEM runs under the bridges) shifted by the lidar's offset to it around the hole,
    else linearly across the hole. `structures` (world polygons: decks, bridges) are holes too.
    """
    from scipy import ndimage
    from scipy.interpolate import griddata

    x0, x1, z0, z1 = lc['box']
    fn = os.path.join(root, lc['cache'], f'ground-{x0}_{x1}_{z0}_{z1}-raw.npz')
    if not os.path.exists(fn):
        pts = lidar_points(lc['ept'], proj, lc['box'])
        g = pts[np.isin(pts[:, 3], LIDAR_GROUND)]
        cols, rows = int(x1 - x0) + 1, int(z1 - z0) + 1
        ix = np.clip(np.round(g[:, 0] - x0).astype(int), 0, cols - 1)
        iz = np.clip(np.round(g[:, 1] - z0).astype(int), 0, rows - 1)
        key = iz * cols + ix
        order = np.argsort(key, kind='stable')
        key, y = key[order], g[order, 2]
        u, start, cnt = np.unique(key, return_index=True, return_counts=True)
        grid = np.full(rows * cols, np.nan)
        grid[u] = [np.median(y[s : s + c]) for s, c in zip(start, cnt)]
        os.makedirs(os.path.dirname(fn), exist_ok=True)
        np.savez_compressed(fn, grid=grid.reshape(rows, cols).astype(np.float32))
        print(f'  lidar: {len(pts)} points, ground in {np.mean(~np.isnan(grid)):.0%} of the 1 m cells -> {os.path.relpath(fn, root)}')
    grid = np.load(fn)['grid'].astype(float)
    rows, cols = grid.shape
    if structures:
        # decks and bridges (planimetric transportation structures) are holes: a deck's top can be classed as ground
        from shapely import contains_xy

        for g in structures:
            g = g.buffer(LIDAR_DECK_PAD)
            bx0, bz0, bx1, bz1 = g.bounds
            i0, i1 = max(0, int(bx0 - x0)), min(cols - 1, int(bx1 - x0) + 1)
            j0, j1 = max(0, int(bz0 - z0)), min(rows - 1, int(bz1 - z0) + 1)
            if i0 > i1 or j0 > j1:
                continue
            gx, gz = np.meshgrid(np.arange(i0, i1 + 1) + x0, np.arange(j0, j1 + 1) + z0)
            m = contains_xy(g, gx, gz)
            grid[j0 : j1 + 1, i0 : i1 + 1][m] = np.nan
    have = ~np.isnan(grid)
    jj, ii = np.nonzero(have)
    qj, qi = np.nonzero(~have)
    if coarse is not None:
        base = coarse(x0 + np.arange(cols)[None, :] + 0 * np.arange(rows)[:, None], z0 + np.arange(rows)[:, None] + 0 * np.arange(cols)[None, :])
        d = grid - base
        d[~have] = griddata((jj, ii), d[have], (qj, qi), method='linear')
        grid = base + d
    else:
        grid[~have] = griddata((jj, ii), grid[have], (qj, qi), method='linear')
    still = np.isnan(grid)
    if still.any():
        _, (a, b) = ndimage.distance_transform_edt(still, return_indices=True)
        grid = grid[a, b]
    return x0, z0, grid, have


def structures(root, sv, proj):
    """The planimetric transportation structures (decks, bridges, overpasses) as world polygons, or None."""
    folder = find_path(root, sv['planimetrics']) if sv.get('planimetrics') else None
    out = []
    for fn in sorted(glob.glob(os.path.join(folder or '', '*-transport.geojson'))):
        for f in json.load(open(fn, encoding='utf-8'))['features']:
            if f.get('geometry'):
                out.append(transform(lambda lon, lat, z=None: proj.fwd(lat, lon), shape(f['geometry'])).buffer(0))
    return out or None


def coarse_height(hm):
    """data.json heightmap -> f(x, z arrays) bilinear on its first grid coarser than 1 m (absolute metres)."""
    import base64 as b64

    g = next(g for g in hm['grids'] if g['cell'] > 1)
    h = hm['base'] + np.frombuffer(b64.b64decode(g['data']), '<i2').reshape(g['rows'], g['cols']) * hm['step']

    def f(x, z):
        fx = np.clip((np.asarray(x) - g['originX']) / g['cell'], 0, g['cols'] - 1.001)
        fz = np.clip((np.asarray(z) - g['originZ']) / g['cell'], 0, g['rows'] - 1.001)
        i, j = fx.astype(int), fz.astype(int)
        tx, tz = fx - i, fz - j
        return (h[j, i] * (1 - tx) + h[j, i + 1] * tx) * (1 - tz) + (h[j + 1, i] * (1 - tx) + h[j + 1, i + 1] * tx) * tz

    return f


def lidar_points(ept_url, proj, box):
    """All points of an EPT cloud in world box (x0, x1, z0, z1) -> [n, 4] world x, z, height, class."""
    import concurrent.futures as cf
    import io
    import urllib.request

    import laspy

    R = 6378137.0
    x0, x1, z0, z1 = box

    def merc(x, z):
        lat, lon = proj.inv(x, z)
        return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

    cs = [merc(x, z) for x in (x0, x1) for z in (z0, z1)]
    bx0, bx1 = min(c[0] for c in cs), max(c[0] for c in cs)
    by0, by1 = min(c[1] for c in cs), max(c[1] for c in cs)

    def get(u):
        err = None
        for _ in range(4):
            try:
                return urllib.request.urlopen(ept_url + u, timeout=60).read()
            except OSError as e:
                err = e
        raise err

    B = json.loads(get('ept.json'))['bounds']

    def hit(k):
        d, x, y, _ = map(int, k.split('-'))
        s = (B[3] - B[0]) / 2**d
        return B[0] + x * s <= bx1 and B[0] + (x + 1) * s >= bx0 and B[1] + y * s <= by1 and B[1] + (y + 1) * s >= by0

    nodes = []

    def walk(key):
        for k, n in json.loads(get(f'ept-hierarchy/{key}.json')).items():
            if not hit(k):
                continue
            if n == -1:
                if k != key:
                    walk(k)
            elif n > 0:
                nodes.append(k)

    walk('0-0-0-0')

    def load(k):
        las = laspy.read(io.BytesIO(get(f'ept-data/{k}.laz')))
        X, Y = np.asarray(las.x), np.asarray(las.y)
        m = (X >= bx0) & (X <= bx1) & (Y >= by0) & (Y <= by1)
        lon = np.degrees(X[m] / R)
        lat = np.degrees(2 * np.arctan(np.exp(Y[m] / R)) - math.pi / 2)
        wx, wz = proj.fwd(lat, lon)
        return np.stack([wx, wz, np.asarray(las.z)[m], np.asarray(las.classification)[m].astype(float)], 1)

    with cf.ThreadPoolExecutor(12) as ex:
        P = np.concatenate(list(ex.map(load, nodes)))
    m = (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 1] >= z0) & (P[:, 1] <= z1)
    return P[m]


def lidar_area(lc, stage_line, length):
    """-> (KD tree of the stage line from `from` m, corridor m): the area the lidar replaces terrain and spots in."""
    from scipy.spatial import cKDTree

    p = np.asarray(stage_line, float)
    seg = [a + (b - a) * np.linspace(0, 1, max(1, int(np.linalg.norm(b - a))), endpoint=False)[:, None] for a, b in zip(p, p[1:])]  # fmt: skip
    p = np.vstack([*seg, p[-1:]])
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    return cKDTree(p[s >= lc.get('from', 0)]), lc.get('corridor', 60)


def lidar_tiles(sv, root, proj, stage_line, hm):
    """1 m height grids (HeightGridDef) over the lidar area, in `tile` m blocks."""
    lc = sv['lidar']
    base, step = hm['base'], hm['step']
    x0, z0, grid, _ = lidar_ground(lc, root, proj, coarse_height(hm), structures(root, sv, proj))
    kd, corridor = lidar_area(lc, stage_line, 0)
    rows, cols = grid.shape
    t = lc.get('tile', 64)
    out = []
    for bz in range(int(z0), int(z0) + rows - 1, t):
        for bx in range(int(x0), int(x0) + cols - 1, t):
            gx, gz = np.meshgrid(np.linspace(bx, bx + t, 9), np.linspace(bz, bz + t, 9))
            if kd.query(np.c_[gx.ravel(), gz.ravel()])[0].min() > corridor + t / 8:
                continue
            i0, j0 = max(0, bx - LIDAR_PAD - int(x0)), max(0, bz - LIDAR_PAD - int(z0))
            i1, j1 = min(cols, bx + t + LIDAR_PAD + 1 - int(x0)), min(rows, bz + t + LIDAR_PAD + 1 - int(z0))
            v = np.round((grid[j0:j1, i0:i1] - base) / step).astype('<i2')
            out.append({
                'originX': int(x0) + i0, 'originZ': int(z0) + j0, 'cell': 1, 'cols': i1 - i0, 'rows': j1 - j0,
                'data': base64.b64encode(v.tobytes()).decode('ascii'),
            })  # fmt: skip
    return out


def lidar_spots(lc, root, proj, stage_line, folder, datum):
    """-> (in_area(x, z) -> bool, spot heights [[x, z, y], ...] world y) on the roadbed in the lidar area."""
    x0, z0, grid, have = lidar_ground(lc, root, proj, structures=structures(root, {'planimetrics': folder}, proj))
    kd, corridor = lidar_area(lc, stage_line, 0)
    rows, cols = grid.shape
    parts, _ = carriageways(folder, proj)
    from shapely import contains_xy

    road = unary_union(parts)
    gx, gz = np.meshgrid(np.arange(x0, x0 + cols - 1, LIDAR_SPOT), np.arange(z0, z0 + rows - 1, LIDAR_SPOT))
    gx, gz = gx.ravel(), gz.ravel()
    keep = (kd.query(np.c_[gx, gz])[0] <= corridor) & contains_xy(road, gx, gz)
    ix = np.round(gx - x0).astype(int)
    iz = np.round(gz - z0).astype(int)
    keep &= have[iz, ix]
    spots = [[round(float(x), 2), round(float(z), 2), round(float(grid[j, i]) - datum, 2)] for x, z, i, j in zip(gx[keep], gz[keep], ix[keep], iz[keep])]  # fmt: skip
    near = ndimage_max(have, 2)

    def in_area(x, z):
        # (where the lidar has no ground - a deck, a bridge - the survey's spots stay)
        i, j = int(round(x - x0)), int(round(z - z0))
        return 0 <= i < cols and 0 <= j < rows and near[j, i] and kd.query([x, z])[0] <= corridor

    return in_area, spots


def ndimage_max(mask, r):
    from scipy import ndimage

    return ndimage.maximum_filter(mask.astype(np.uint8), size=2 * r + 1) > 0


def lidar_terrain(cfg, root, proj, network, data_path):
    """The lidar tiles (survey.lidar) ahead of data.json's height grids; earlier tiles (1 m cells) are replaced."""
    lc = (cfg.get('survey') or {}).get('lidar')
    if not lc:
        return
    with open(data_path) as f:
        data = json.load(f)
    hm = data['heightmap']
    tiles = lidar_tiles(cfg['survey'], root, proj, network['stage']['cps'], hm)
    hm['grids'] = tiles + [g for g in hm['grids'] if g['cell'] > 1]
    with open(data_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  lidar: {len(tiles)} ground tiles (1 m) in {os.path.relpath(data_path, root)}')
