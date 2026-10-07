"""Street model of the Jackie END BOX: real widths, lane layout, sidewalks, surface and markings per path.

    python scripts/realmap/nyc_pull.py                          # once: download the NYC layers (sources/maps/jackie/)
    python scripts/realmap/streets.py                           # report only (nothing written)
    python scripts/realmap/streets.py --write                   # add the street-model fields to data.json paths, IN PLACE
    python scripts/realmap/streets.py --write --apply-width     # ...and replace `width` by the measured curb-to-curb width
    python scripts/realmap/streets.py --write --fields lawn      # only (re)write these model fields (the rest stays)
    python scripts/realmap/streets.py --region west ...          # the WEST corridor (corridor.py, `west-*` NYC files): paths
                                                                 # near the stage road's bridges / portals / start keep their
                                                                 # width and centre line (approved structures)

Inputs (all local, see maps/jackie/DETAILS.md "Street model"):
  - `maps/jackie/data.json` paths (never inserted / deleted / reordered: terrain-gen path indices depend on the order);
  - the cached Overpass answer the bake used (`.cache/overpass/base_*.xml`, ODbL): tags per OSM way, stop / signal nodes;
  - NYC Planimetric Database roadbed + sidewalk polygons (`sources/maps/jackie/nyc-planimetrics/endbox-*.geojson`);
  - NYC CSCL Centerline (street width in feet, travel / parking lane counts, traffic direction, posted speed).

Per tarmac path with a point in the END BOX the script writes these fields (a path outside the box is left alone):
  curbWidth  m, measured curb to curb (median of the roadbed cross sections, else CSCL street width, else the baked width)
  layout     { fwd, back, parkL, parkR, shoulder }  travel lanes with / against the path direction, parking lanes left /
             right of the path direction, shoulder m each side (ramps / carriageways)
  sidewalk   [left, right] m (0 = none)
  lawn       [left, right] m of tree lawn between the kerb and the sidewalk (only on paths that have one)
  pave       'asphalt' (always: owner decision, OSM concrete streets are drawn as asphalt)
  marks      { centre: 'double_yellow' | 'none', stop: [atStart, atEnd], turn?: 'left|through;right', turnBack? }
  speed      mph (posted)
  `width` and `lanes` stay as baked (other code reads them) unless --apply-width (width only; never carriageways).
The lateral offset of each OSM centre line from the real roadbed mid-line (phase 3) goes to the local report
`sources/maps/jackie/streets-report.json` (not shipped).
"""

import argparse
import collections
import glob
import json
import math
import os
import statistics
import sys

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corridor  # noqa: E402
import endbox  # noqa: E402
import overpass  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'data.json')
NYC = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'nyc-planimetrics')
REPORT = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'streets-report.json')
# The region the model is built for: 'endbox' (Kew Gardens end) or 'west' (the rest of the corridor); NYC file prefix.
REGION = 'endbox'


def set_region(name):
    global REGION
    if name not in ('endbox', 'west'):
        raise ValueError(f'unknown region {name}')
    REGION = name


def report_path():
    return REPORT if REGION == 'endbox' else REPORT.replace('.json', f'-{REGION}.json')


def in_region(xy):
    """xy: (n, 2) points of a path. END BOX: any point in it; WEST: a point in the corridor and none in the END BOX."""
    inside_end = (xy[:, 0] >= endbox.X0) & (xy[:, 0] <= endbox.X1) & (xy[:, 1] >= endbox.Z0) & (xy[:, 1] <= endbox.Z1)
    if REGION == 'endbox':
        return bool(inside_end.any())
    return not inside_end.any() and any(corridor.contains(x, z) for x, z in xy[:: max(1, len(xy) // 6)])
SHIFTS = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'street-shifts.json')
FT = 0.3048
STEP = 5.0  # m between cross sections
CROSS = 30.0  # half length of a cross section (m)
BIG = ('motorway', 'motorway_link', 'trunk', 'trunk_link')
LINKS = ('motorway_link', 'trunk_link', 'primary_link')
FIXED = ('motorway', 'trunk')  # carriageways: their baked width (lanes x 3.3 + 0.8) is approved and never changes
GAP = 0.8  # m of verge kept between the edges of two parallel roads
GAP_CARRIAGEWAY = 2.6  # ... beside a carriageway: it keeps a flat 2 m verge (terrain-gen CARRIAGEWAY_VERGE) + the barrier
# The stage road (data.route, not a path): its widest width, and the room beside it - shoulder 0.5 + cut-wall offset 1.6 +
# the setback of the sheer rise 1.5 + 0.6 (a street at the rim of the parkway's cut stands clear of its wall).
ROUTE_W = 7.0
GAP_ROUTE = 4.2
STREETS = ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service')
JUNCTION_REACH = 7.0  # a crossing way within half its width + this makes a sample a junction sample (not measured)
OSM_TOL = 2.0  # m: path point to OSM way
CSCL_TOL = 14.0  # m: path point to a CSCL centre line
MIN_SAMPLES = 3


# --- small geometry helpers ---------------------------------------------------------------------------------------


def resample(pts, step):
    """Polyline [n, 2] -> points every `step` m (incl. both ends) and the along distances."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    d = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(math.ceil(d[-1] / step)) + 1)
    t = np.linspace(0, d[-1], n)
    return np.stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])], 1), t


def tangents(p):
    g = np.gradient(p, axis=0)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def geoms(feature_collection, tr):
    out = []
    for f in feature_collection['features']:
        if f.get('geometry'):
            out.append((f['properties'], tr(shape(f['geometry']))))
    return out


def world_transform(proj):
    from shapely.ops import transform

    return lambda g: transform(lambda lon, lat, z=None: proj.fwd(lat, lon), g)


def lines_of(g):
    """All LineStrings of a geometry."""
    if g.is_empty:
        return []
    if g.geom_type == 'LineString':
        return [g]
    return [x for part in getattr(g, 'geoms', []) for x in lines_of(part)]


def mean_ang(a, b):
    return abs(a[0] * b[0] + a[1] * b[1])


# --- inputs -------------------------------------------------------------------------------------------------------


def cached_osm():
    """Every cached Overpass base answer (the bake's box + east.py's strip), oldest first: the newest copy of a way wins."""
    files = sorted(glob.glob(os.path.join(HERE, '.cache', 'overpass', 'base_*.xml')), key=os.path.getmtime)
    if not files:
        sys.exit('no cached Overpass base answer in scripts/realmap/.cache/overpass (run the bake first)')
    return files


def load_cscl(tr):
    fc = json.load(open(os.path.join(NYC, f'{REGION}-cscl.geojson'), encoding='utf-8'))
    out = []
    for props, g in geoms(fc, tr):
        for ln in lines_of(g):
            if ln.length > 1:
                out.append((props, ln))
    return out


def load_union(name, tr):
    fc = json.load(open(os.path.join(NYC, f'{REGION}-{name}.geojson'), encoding='utf-8'))
    polys = [g for _, g in geoms(fc, tr)]
    u = unary_union(polys).buffer(0.1).buffer(-0.1)
    return u


# --- matching a path to OSM ways / CSCL segments --------------------------------------------------------------------


class Matcher:
    def __init__(self, items):
        """items: [(payload, LineString)]."""
        self.items = items
        self.tree = STRtree([ln for _, ln in items])

    def vote(self, pts, tang, tol, min_cos):
        """Plurality vote over the sample points: {item index: count}, the unmatched count."""
        votes = collections.Counter()
        miss = 0
        for p, t in zip(pts, tang):
            pt = Point(p)
            best, bd = None, tol
            for i in self.tree.query(pt.buffer(tol)):
                ln = self.items[i][1]
                d = ln.distance(pt)
                if d >= bd:
                    continue
                s = ln.project(pt)
                a, b = ln.interpolate(max(0, s - 1.5)), ln.interpolate(min(ln.length, s + 1.5))
                v = np.array([b.x - a.x, b.y - a.y])
                n = np.linalg.norm(v)
                if n < 1e-6 or mean_ang(v / n, t) < min_cos:
                    continue
                best, bd = int(i), d
            if best is None:
                miss += 1
            else:
                votes[best] += 1
        return votes, miss


# --- main ------------------------------------------------------------------------------------------------------------


def num(v, default=None):
    try:
        return float(str(v).split()[0])
    except (TypeError, ValueError):
        return default


def lanes_tag(tags, key):
    v = tags.get(key)
    return int(v) if v and v.isdigit() else None


ABBR = {
    'avenue': 'ave', 'road': 'rd', 'street': 'st', 'boulevard': 'blvd', 'parkway': 'pkwy', 'pky': 'pkwy', 'py': 'pkwy', 'turnpike': 'tpke',
    'place': 'pl', 'lane': 'ln', 'drive': 'dr', 'expressway': 'expy', 'expwy': 'expy', 'crescent': 'cres', 'court': 'ct', 'north': 'n',
    'south': 's', 'east': 'e', 'west': 'w',
}  # fmt: skip


def norm_name(name):
    """'82nd Avenue' / '82 AVE' -> frozenset of comparable tokens (ordinal suffixes and road types folded)."""
    if not name:
        return frozenset()
    out = []
    for t in ''.join(c if c.isalnum() else ' ' for c in name.lower()).split():
        if t[:-2].isdigit() and t[-2:] in ('st', 'nd', 'rd', 'th'):
            t = t[:-2]
        out.append(ABBR.get(t, t))
    return frozenset(out)


def same_street(a, b):
    na, nb = norm_name(a), norm_name(b)
    return bool(na and nb and len(na & nb) / len(na | nb) >= 0.5)


def bike_sides(tags):
    """(left, right) 1 = a marked bike lane / track beside the carriageway (OSM `cycleway*`, relative to the way direction)."""
    out = {}
    for side in ('left', 'right'):
        v = tags.get(f'cycleway:{side}') or tags.get('cycleway:both') or tags.get('cycleway')
        out[side] = 1 if v in ('lane', 'track', 'opposite_lane', 'opposite_track') else 0
    return out['left'], out['right']


PARK_W, LANE_W, BIKE_W = 2.2, 2.7, 1.5  # m: parking lane, minimum travel lane, bike lane


def fit_layout(curb, fwd, back, parkL, parkR, bikeL, bikeR, shoulder):
    """Drop what does not fit the measured width: bike lanes first, then parking (left before right), as NYC streets do."""
    dropped = []

    def room(pl, pr, bl, br):
        return curb - 2 * shoulder - (pl + pr) * PARK_W - (bl + br) * BIKE_W - (fwd + back) * LANE_W

    for what in ('bikeL', 'bikeR', 'parkL', 'parkR'):
        if room(parkL, parkR, bikeL, bikeR) >= -0.3:
            break
        if what == 'bikeL' and bikeL:
            bikeL = 0
        elif what == 'bikeR' and bikeR:
            bikeR = 0
        elif what == 'parkL' and parkL:
            parkL = 0
        elif what == 'parkR' and parkR:
            parkR = 0
        else:
            continue
        dropped.append(what)
    return parkL, parkR, bikeL, bikeR, dropped


def parking_sides(tags):
    """(left, right) parking lanes from OSM `parking:*` (relative to the way direction), None = not tagged."""
    out = {}
    for side in ('left', 'right'):
        v = tags.get(f'parking:{side}') or tags.get('parking:both')
        if v:
            out[side] = 0 if v in ('no', 'no_parking', 'no_stopping', 'separate') else 1
    return out.get('left'), out.get('right')


def fit_room(report, paths, tar, lines, tree, stats, route=None):
    """Shrink widths so that parallel neighbours keep GAP between their edges. `motorway` / `trunk` carriageways are never
    shrunk (their width is approved); between two flexible roads both are scaled. The stage road (`route`, a LineString)
    counts as a fixed neighbour ROUTE_W wide that keeps GAP_ROUTE. Re-fits the layout of what changed."""
    ent = {e['path']: e for e in report}
    eff = lambda pi: paths[pi]['width'] if pi not in ent or paths[pi]['kind'] in FIXED else ent[pi]['curbWidth']  # noqa: E731
    for _ in range(2):
        changed = False
        for pi, e in ent.items():
            if paths[pi]['kind'] in FIXED:
                continue
            xy = np.array(paths[pi]['pts']).reshape(-1, 2)
            pts, along = resample(xy, STEP)
            tang = tangents(pts)
            L = along[-1]
            near = collections.defaultdict(list)
            for k, (c, t) in enumerate(zip(pts, tang)):
                if along[k] < 12 or along[k] > L - 12:
                    continue
                for j in tree.query(Point(c).buffer(25)):
                    qi = tar[j]
                    if qi == pi:
                        continue
                    q = lines[qi]
                    s_ = q.project(Point(c))
                    if s_ < 8 or s_ > q.length - 8:
                        continue
                    a, b = q.interpolate(max(0, s_ - 1.5)), q.interpolate(min(q.length, s_ + 1.5))
                    v = np.array([b.x - a.x, b.y - a.y])
                    n = np.linalg.norm(v)
                    if n > 1e-6 and mean_ang(v / n, t) > 0.85:
                        near[qi].append(q.distance(Point(c)))
                # the way itself further along (a loop / a driveway that turns back beside itself)
                far = np.abs(along - along[k]) > 20
                if far.any():
                    d_self = float(np.min(np.hypot(*(pts[far] - c).T)))
                    if d_self < 25:
                        near['self'].append(d_self)
                if route is not None:
                    d = route.distance(Point(c))
                    if d < 25:
                        s_ = route.project(Point(c))
                        a, b = route.interpolate(max(0, s_ - 1.5)), route.interpolate(min(route.length, s_ + 1.5))
                        v = np.array([b.x - a.x, b.y - a.y])
                        n = np.linalg.norm(v)
                        if n > 1e-6 and mean_ang(v / n, t) > 0.85:
                            near['route'].append(d)
            for qi, ds in near.items():
                # a conflict that holds over most of a long parallel run (a ramp merging in converges only at its end)
                if len(ds) < (2 if qi == 'self' else 6):
                    continue
                d = float(np.percentile(ds, 50))
                if qi == 'route':
                    wi, wj, gap, fixed = eff(pi), ROUTE_W, GAP_ROUTE, True
                elif qi == 'self':
                    # (any crossing of itself counts: the two passes are at different heights)
                    d = float(min(ds))
                    wi, wj, gap, fixed = eff(pi), eff(pi), GAP, True
                else:
                    wi, wj = eff(pi), eff(qi)
                    gap = GAP_CARRIAGEWAY if paths[qi]['kind'] in FIXED else GAP
                    fixed = paths[qi]['kind'] in FIXED or qi not in ent
                if (wi + wj) / 2 + gap <= d:
                    continue
                if qi == 'self':
                    w = d - gap
                elif fixed:
                    w = 2 * (d - wj / 2 - gap)
                else:
                    w = wi * (2 * (d - gap)) / (wi + wj)
                lane_min = 3.0 * max(1, e['layout']['fwd'] + e['layout']['back']) + (0.6 if paths[pi]['kind'] in LINKS else 0)
                # (a way that overlaps itself gets narrower than its lanes: two passes of one ribbon must not overlap)
                w = round(max(w, 3.0 if qi == 'self' else lane_min, 3.6 if paths[pi]['kind'] in LINKS else 3.0), 1)
                if w < e['curbWidth'] - 0.05:
                    e['flags'].append(f'room: {e["curbWidth"]:.1f} -> {w:.1f} beside path {qi}')
                    e['curbWidth'] = w
                    stats['width fitted to the room'] += 1
                    changed = True
        if not changed:
            break
    for e in ent.values():
        if any(f.startswith('room:') for f in e['flags']):
            l = e['layout']
            l['parkL'], l['parkR'], l['bikeL'], l['bikeR'], _ = fit_layout(e['curbWidth'], l['fwd'], l['back'], l['parkL'], l['parkR'], l['bikeL'], l['bikeR'], l['shoulder'])


def build(paths, proj, osm, only=None, log=print):
    """Street model of every tarmac path in the END BOX: (report entries, {path index: fields}, stats).

    `osm` = (nodes, ntags, ways) as parsed by overpass.parse (the bake passes its own). Needs the NYC files of nyc_pull.py.
    """
    tr = world_transform(proj)
    nodes, ntags, ways = osm
    hw = {}
    for wid, w in ways.items():
        if 'highway' in w['tags'] and len(w['refs']) >= 2:
            hw[wid] = {'tags': w['tags'], 'line': LineString([proj.fwd(*nodes[r]) for r in w['refs']]), 'refs': w['refs']}
    osm_items = [((wid, w), w['line']) for wid, w in hw.items()]
    osm = Matcher(osm_items)
    cscl_items = load_cscl(tr)
    cscl = Matcher(cscl_items)
    roadbed = load_union('roadbed', tr)
    sidewalk = load_union('sidewalk', tr)
    log(f'CSCL segments {len(cscl_items)}, roadbed {roadbed.area:.0f} m2, sidewalk {sidewalk.area:.0f} m2, OSM ways {len(hw)}')

    # Every tarmac path (junction test), the ones in the END BOX get the model.
    tar = [i for i, p in enumerate(paths) if p['surface'] == 'tarmac']
    lines = {i: LineString(np.array(paths[i]['pts']).reshape(-1, 2)) for i in tar}
    all_tree = STRtree([lines[i] for i in tar])

    def in_box(i):
        return in_region(np.array(paths[i]['pts']).reshape(-1, 2))

    todo = [i for i in tar if in_box(i) and (not only or i in only)]
    log(f'{len(todo)} tarmac paths in region {REGION} (of {len(paths)})')

    report, stats, models = [], collections.Counter(), {}
    for pi in todo:
        p = paths[pi]
        kind = p['kind']
        xy = np.array(p['pts']).reshape(-1, 2)
        pts, along = resample(xy, STEP)
        tang = tangents(pts)
        flags = []
        # --- OSM way (tags) ---
        votes, miss = osm.vote(pts, tang, OSM_TOL, 0.8)
        way, tags, wid = None, {}, None
        if votes:
            wid, way = osm.items[votes.most_common(1)[0][0]][0]
            tags = way['tags']
        osm_share = sum(votes.values()) / len(pts)
        if osm_share < 0.6:
            flags.append(f'osm-match {osm_share:.0%}')
        # --- CSCL segment(s) ---
        cv, cmiss = cscl.vote(pts, tang, CSCL_TOL, 0.85)
        cprops = []
        for ci, n in cv.items():
            cprops += [cscl.items[ci][0]] * n
        cshare = sum(cv.values()) / len(pts)
        c_width = [num(c.get('streetwidth')) for c in cprops if num(c.get('streetwidth'))]
        c_travel = [int(c['number_travel_lanes']) for c in cprops if c.get('number_travel_lanes')]
        c_park = [int(c['number_park_lanes']) for c in cprops if c.get('number_park_lanes')]
        c_dir = collections.Counter(c.get('trafdir') for c in cprops).most_common(1)
        c_speed = [num(c.get('posted_speed')) for c in cprops if num(c.get('posted_speed'))]
        c_bike = collections.Counter(c.get('bike_lane') for c in cprops if c.get('bike_lane')).most_common(1)
        cscl_w = statistics.median(c_width) * FT if c_width else None
        # --- junction samples: another way crosses nearby ---
        # (a way that continues this one end to end is not a crossing: needs > 30 deg)
        # --- roadbed cross sections ---
        widths, shifts, walls = [], [], {1: [], -1: []}
        # where the sidewalk polygon starts beyond the kerb (m): the tree lawn / tree pit strip
        lawns = {1: [], -1: []}
        n_samples = 0
        for k, (c, t) in enumerate(zip(pts, tang)):
            if k == 0 or k == len(pts) - 1:
                continue
            left = np.array([t[1], -t[0]])
            junction = False
            for j in all_tree.query(Point(c).buffer(JUNCTION_REACH + paths[pi]['width'])):
                qi = tar[j]
                if qi == pi:
                    continue
                q = lines[qi]
                d = q.distance(Point(c))
                if d > JUNCTION_REACH + paths[qi]['width'] / 2:
                    continue
                s = q.project(Point(c))
                a, b = q.interpolate(max(0, s - 1.5)), q.interpolate(min(q.length, s + 1.5))
                v = np.array([b.x - a.x, b.y - a.y])
                nv = np.linalg.norm(v)
                if nv > 1e-6 and mean_ang(v / nv, t) < math.cos(math.radians(30)):
                    junction = True
                    break
            if junction:
                continue
            cross = LineString([c - left * CROSS, c + left * CROSS])  # lateral: -CROSS (right) .. +CROSS (left)
            inter = cross.intersection(roadbed)
            piece = None
            for ln in lines_of(inter):
                a, b = cross.project(ln.interpolate(0)), cross.project(ln.interpolate(ln.length))
                lo, hi = min(a, b) - CROSS, max(a, b) - CROSS
                if lo - 2.0 <= 0 <= hi + 2.0:
                    piece = (lo, hi) if piece is None or (hi - lo) > (piece[1] - piece[0]) else piece
            if piece is None:
                continue
            w = piece[1] - piece[0]
            # reject merged shapes (two carriageways / a junction mouth): far wider than the street data says
            ref = cscl_w or p['width']
            if w > ref * 1.7 + 2 or w < 2.0:
                continue
            n_samples += 1
            widths.append(w)
            shifts.append((piece[0] + piece[1]) / 2)
            for side, edge in ((1, piece[1]), (-1, piece[0])):
                sc = cross.intersection(sidewalk)
                best = 0.0
                for ln in lines_of(sc):
                    a, b = cross.project(ln.interpolate(0)) - CROSS, cross.project(ln.interpolate(ln.length)) - CROSS
                    lo, hi = min(a, b), max(a, b)
                    near, far = (lo, hi) if side == 1 else (-hi, -lo)  # outward distance from the lateral origin
                    start = near - (edge if side == 1 else -edge)
                    if -0.3 <= start <= 1.5:
                        best = max(best, far - near)
                walls[side].append(best)
                gap = None
                for ln in lines_of(sc):
                    a, b = cross.project(ln.interpolate(0)) - CROSS, cross.project(ln.interpolate(ln.length)) - CROSS
                    near = min(a, b) if side == 1 else -max(a, b)
                    start = near - (edge if side == 1 else -edge)
                    if -0.3 <= start <= 2.5 and (gap is None or start < gap):
                        gap = start
                lawns[side].append(gap)
        roadbed_w = statistics.median(widths) if len(widths) >= MIN_SAMPLES else None
        # --- width decision ---
        # A parallel service lane picks up the neighbouring street's CSCL width: CSCL counts for it only as an alley.
        if kind == 'service' and not any(c.get('rw_type') == '10' for c in cprops):
            cscl_w = None
        if roadbed_w and (not cscl_w or 0.75 <= roadbed_w / cscl_w <= 1.3):
            curb, method = roadbed_w, 'roadbed'
        elif cscl_w:
            curb, method = cscl_w, 'cscl'
            if roadbed_w:
                flags.append(f'roadbed {roadbed_w:.1f} vs cscl {cscl_w:.1f}')
        elif roadbed_w:
            curb, method = roadbed_w, 'roadbed-only'
        else:
            curb, method = p['width'], 'baked'
            flags.append('no width data')
        curb = round(curb, 1)
        if kind in LINKS:  # a ramp keeps within its lane count: 3.6 m per lane + shoulders, never under 4.5 m
            curb = round(min(max(curb, 4.5), 3.6 * max(1, lanes_tag(tags, 'lanes') or 1) + 2.4), 1)
        stats[method] += 1
        # --- one way? ---
        osm_ow = tags.get('oneway')
        c_oneway = bool(c_dir) and c_dir[0][0] in ('FT', 'TF')
        oneway = bool(p.get('oneway')) or osm_ow in ('yes', '-1') or tags.get('junction') == 'roundabout'
        if osm_ow == '-1':
            flags.append('oneway=-1 (baked path runs against it)')
        if c_dir and c_oneway != oneway and c_dir[0][0] != 'NV' and cshare > 0.5:
            flags.append(f'oneway osm={oneway} cscl={c_dir[0][0]}')
        # --- lane layout ---
        osm_lanes = lanes_tag(tags, 'lanes')
        osm_fwd, osm_back = lanes_tag(tags, 'lanes:forward'), lanes_tag(tags, 'lanes:backward')
        c_travel_med = int(statistics.median(c_travel)) if c_travel else None
        if kind in BIG:  # the baked width is lanes x 3.3 + 0.8: the lane count must stay consistent with it
            travel = osm_lanes or max(1, round((p['width'] - 0.8) / 3.3))
        else:
            travel = c_travel_med or osm_lanes
            if travel is None:
                travel = 2 if not oneway and curb >= 7.5 else 1
        if oneway:
            fwd, back = travel, 0
        elif osm_fwd is not None and osm_back is not None:
            fwd, back = osm_fwd, osm_back
        else:
            fwd, back = (travel + 1) // 2, travel // 2
        parkL, parkR = parking_sides(tags)
        cpark = int(statistics.median(c_park)) if c_park else None
        if parkL is None and parkR is None:
            if cpark is None:
                cpark = 0 if (kind in BIG or kind in ('service', 'primary_link') or curb < 7.5) else 1
            parkL, parkR = (1, 1) if cpark >= 2 else (0, 1 if cpark == 1 else 0)
        parkL, parkR = parkL or 0, parkR or 0
        if kind in BIG or kind == 'service':
            parkL = parkR = 0
        bikeL, bikeR = bike_sides(tags) if kind not in BIG else (0, 0)
        shoulder = 1.2 if kind in ('motorway_link', 'trunk_link', 'primary_link') else (0.8 if kind in BIG else 0.0)
        parkL, parkR, bikeL, bikeR, dropped = fit_layout(curb, fwd, back, parkL, parkR, bikeL, bikeR, shoulder)
        if dropped:
            stats['layout: ' + '+'.join(dropped)] += 1
        if kind not in BIG and kind != 'service' and curb < (fwd + back) * 2.5 + 2 * shoulder:
            flags.append(f'tight: {fwd + back} lanes in {curb:.1f} m')
        # --- sidewalks ---
        sw = []
        for side in (1, -1):
            v = walls[side]
            share = sum(1 for x in v if x > 0.5) / len(v) if v else 0
            sw.append(round(min(8.0, statistics.median([x for x in v if x > 0.5])), 1) if share >= 0.35 else 0.0)
        # tree lawn: on most cross sections the paved sidewalk starts >= 0.5 m beyond the kerb (a grass strip / tree pits)
        lawn = []
        for side in (1, -1):
            g = [x for x in lawns[side] if x is not None]
            wide = [x for x in g if x >= 0.5]
            ok = sw[0 if side == 1 else 1] > 0 and g and len(wide) / len(g) >= 0.5
            lawn.append(round(min(2.5, statistics.median(wide)), 1) if ok else 0.0)
        # --- surface, speed, marks ---
        surf = tags.get('surface', '')
        # (owner decision 2026-10-06: every street is asphalt; the OSM concrete tag is only counted in the report)
        if surf in ('concrete', 'concrete:plates', 'concrete:lanes'):
            stats['osm concrete -> asphalt'] += 1
        pave = 'asphalt'
        speed = (int(statistics.median(c_speed)) if c_speed else None) or (int(num(tags.get('maxspeed'), 0)) or None)
        two_way_lines = (not oneway) and kind not in BIG and curb >= 7.3 and (fwd + back) >= 2 and kind != 'service'
        marks = {'centre': 'double_yellow' if two_way_lines else 'none', 'stop': [0, 0]}
        if way:
            for end, idx in ((0, 0), (1, len(way['refs']) - 1)):
                pass  # (stop / signal nodes: below)
        # stop bars / signals: a stop / traffic_signals node of the matched way within 12 m of an end of the path
        if way:
            for end, e in ((0, xy[0]), (1, xy[-1])):
                if oneway and end == 0:
                    continue  # traffic arrives at the end of a one-way path
                for r in way['refs']:
                    t = ntags.get(r, {})
                    if t.get('highway') in ('stop', 'traffic_signals', 'give_way'):
                        nx, nz = proj.fwd(*nodes[r])
                        if math.hypot(nx - e[0], nz - e[1]) <= 12:
                            marks['stop'][end] = 1
        tl = tags.get('turn:lanes') or tags.get('turn:lanes:forward')
        if tl and any(x in tl for x in ('left', 'right', 'through', 'slight')):
            marks['turn'] = tl
        tlb = tags.get('turn:lanes:backward')
        if tlb:
            marks['turnBack'] = tlb
        if c_bike and not oneway:
            pass
        layout = {'fwd': fwd, 'back': back, 'parkL': parkL, 'parkR': parkR, 'bikeL': bikeL, 'bikeR': bikeR, 'shoulder': shoulder}
        out = {'curbWidth': curb, 'layout': layout, 'sidewalk': sw, 'pave': pave, 'marks': marks}
        if any(lawn):
            out['lawn'] = lawn
        known = n_samples >= MIN_SAMPLES
        if speed:
            out['speed'] = speed
        entry = {
            'path': pi, 'kind': kind, 'name': tags.get('name') or (cprops[0].get('full_street_name') if cprops else None),
            'ends': [round(v, 1) for v in (p['pts'][0], p['pts'][1], p['pts'][-2], p['pts'][-1])],
            'osmWay': wid, 'osmShare': round(osm_share, 2), 'csclShare': round(cshare, 2),
            'baked': p['width'], 'cscl': round(cscl_w, 1) if cscl_w else None,
            'roadbed': round(roadbed_w, 1) if roadbed_w else None, 'samples': n_samples, 'method': method,
            'shift': round(statistics.median(shifts), 2) if len(shifts) >= MIN_SAMPLES else None,
            'shiftSpread': round(float(np.percentile(shifts, 90) - np.percentile(shifts, 10)), 2) if len(shifts) >= MIN_SAMPLES else None,
            'flags': flags, 'sidewalkKnown': known, **out,
        }  # fmt: skip
        report.append(entry)
        models[pi] = out

    # --- room: a road never grows into the one beside it (a ramp 3 m above a carriageway 2.7 m away lost half its width to the
    # neighbour's terrain carve): parallel neighbours share the space between their centre lines ----------------------------
    route = LineString(np.array(json.load(open(DATA, encoding='utf-8'))['route'], float))
    fit_room(report, paths, tar, lines, all_tree, stats, route)

    # --- short pieces between junctions have no clean cross section: they take the sidewalks of a connected piece of the
    # same street (same name, an end within 4 m), else of a connected piece of the same kind with a similar width -------
    by_pi = {e['path']: e for e in report}
    ends_of = {e['path']: [(e['ends'][0], e['ends'][1]), (e['ends'][2], e['ends'][3])] for e in report}
    for _ in range(3):
        for e in report:
            if e['sidewalkKnown'] or e['kind'] in BIG:
                continue
            best = None
            for o in report:
                if o is e or not o['sidewalkKnown'] or o['kind'] in BIG:
                    continue
                if not any(math.hypot(a[0] - b[0], a[1] - b[1]) <= 4 for a in ends_of[e['path']] for b in ends_of[o['path']]):
                    continue
                named = same_street(e['name'], o['name'])
                similar = o['kind'] == e['kind'] and 0.75 <= o['curbWidth'] / e['curbWidth'] <= 1.33
                if not (named or similar):
                    continue
                score = (named, o['samples'])
                if best is None or score > best[0]:
                    best = (score, o)
            if best:
                e['sidewalk'][:] = best[1]['sidewalk']
                e['sidewalkKnown'] = True
                e['flags'].append(f'sidewalk from path {best[1]["path"]}')
                stats['sidewalk inherited'] += 1

    # the fit pass worked on the report entries: the model that is written takes their widths
    for e in report:
        models[e['path']]['curbWidth'] = e['curbWidth']
    return report, models, stats


def print_report(report, stats):
    """Console summary of `build`."""
    # --- report ---------------------------------------------------------------------------------------------------
    print('\nwidth source:', dict(stats))
    by = collections.defaultdict(list)
    for e in report:
        by[e['kind']].append(e)
    print(f'{"kind":15}{"n":>4}{"baked":>8}{"curb med":>10}{"curb min":>10}{"curb max":>10}{"flagged":>9}')
    for k, v in sorted(by.items(), key=lambda kv: -len(kv[1])):
        cw = [e['curbWidth'] for e in v]
        print(f'{k:15}{len(v):>4}{statistics.median([e["baked"] for e in v]):>8.1f}{statistics.median(cw):>10.1f}{min(cw):>10.1f}{max(cw):>10.1f}{sum(1 for e in v if e["flags"]):>9}')
    big = [e for e in report if abs(e['curbWidth'] - e['baked']) > 3]
    print(f'\npaths whose width changes by more than 3 m: {len(big)}')
    for e in sorted(big, key=lambda e: -abs(e['curbWidth'] - e['baked']))[:25]:
        print(f'  path {e["path"]:4} {e["kind"]:13} {str(e["name"])[:24]:24} baked {e["baked"]:5.1f} -> {e["curbWidth"]:5.1f} ({e["method"]}, roadbed {e["roadbed"]}, cscl {e["cscl"]}, n={e["samples"]})')
    shifted = [e for e in report if e['shift'] is not None and abs(e['shift']) > 0.8 and e['kind'] not in BIG]
    print(f'\nstreets whose OSM centre line is more than 0.8 m off the roadbed mid-line: {len(shifted)} of {len(report)}')
    flagged = [e for e in report if e['flags']]
    print(f'paths with flags: {len(flagged)}')
    cat = lambda f: f.split(':')[0].split(' (')[0] if f.startswith(('tight', 'oneway=')) else ' '.join(w for w in f.split() if not w[0].isdigit() and w[0] != '-')  # noqa: E731
    print('  ', dict(collections.Counter(cat(f) for e in flagged for f in e['flags'])))
    print('osm match < 60 %:', sum(1 for e in report if e['osmShare'] < 0.6), ' cscl match < 50 %:', sum(1 for e in report if e['csclShare'] < 0.5))
    print('pave:', dict(collections.Counter(e['pave'] for e in report)))
    print('layout (fwd/back/park):', dict(collections.Counter((e['layout']['fwd'], e['layout']['back'], e['layout']['parkL'] + e['layout']['parkR']) for e in report).most_common(12)))
    print('sidewalk median per side:', statistics.median([s for e in report for s in e['sidewalk'] if s]) if any(any(e['sidewalk']) for e in report) else 0, ' none on both sides:', sum(1 for e in report if not any(e['sidewalk'])))



def protected(paths):
    """WEST: paths whose width / centre line stay as baked (decks, ramps, streets at the stage road's bridges / portals /
    start: the approved structures). The END BOX has none."""
    if REGION == 'endbox':
        return set()
    near = corridor.near_spans(paths)
    return {i for i, p in enumerate(paths) if i in near or p.get('bridge') or p['kind'] in LINKS} | hairpins(paths)


def hairpins(paths):
    """Ways whose end meets another way's end at a switchback (their legs leave the node less than 35 deg apart): the two
    legs run side by side there, a wider measured width overlaps them (cemetery / park lanes on a hillside)."""
    ends = []
    for i, p in enumerate(paths):
        if p['surface'] != 'tarmac' or len(p['pts']) < 4:
            continue
        q = p['pts']
        for e, (x, z, nx, nz) in enumerate(((q[0], q[1], q[2], q[3]), (q[-2], q[-1], q[-4], q[-3]))):
            d = math.hypot(nx - x, nz - z) or 1
            ends.append((i, x, z, (nx - x) / d, (nz - z) / d))
    out = set()
    for a in range(len(ends)):
        i, x, z, dx, dz = ends[a]
        for b in range(a + 1, len(ends)):
            j, x2, z2, dx2, dz2 = ends[b]
            if i != j and abs(x - x2) < 2.5 and abs(z - z2) < 2.5 and dx * dx2 + dz * dz2 > math.cos(math.radians(35)):
                out |= {i, j}
    return out


def write_shifts(report, paths, out):
    """`street-shifts.json`: the streets whose OSM centre line is more than 0.8 m off the real roadbed mid-line (maps/shared/street-shift.ts).
    The rows of the other region are kept (keyed by the path end points)."""
    keep = []
    if os.path.exists(out):
        for r in json.load(open(out, encoding='utf-8')):
            k = np.array(r['k'], float).reshape(-1, 2)
            if not in_region(k):
                keep.append(r)
    prot = protected(paths)
    rows = []
    for e in report:
        p = paths[e['path']]
        if e['path'] in prot:
            continue
        if e['shift'] is None or e['kind'] in BIG or p['surface'] != 'tarmac' or p.get('bridge'):
            continue
        if not (0.8 < abs(e['shift']) <= 3.0) or (e['shiftSpread'] or 0) >= 1.6 or e['samples'] < 6:
            continue
        pts = p['pts']
        rows.append({'k': [pts[0], pts[1], pts[-2], pts[-1]], 's': e['shift']})
    json.dump(keep + rows, open(out, 'w'), separators=(',', ':'))
    return len(rows)


def apply_models(paths, models, apply_width=False, fields=None):
    """Write the model fields into the paths (in place). `width` only changes with apply_width: streets and links, never the
    motorway / trunk carriageways (their width is lanes x 3.3 + 0.8 and approved); a link is kept within its lane count.
    `fields`: only these keys (a field the model no longer has is removed from the path). A protected path (WEST) keeps its
    width: its layout is re-fitted to it."""
    prot = protected(paths)
    for pi, m in models.items():
        p = paths[pi]
        if pi in prot:
            m = dict(m, curbWidth=p['width'], layout=dict(m['layout']))
            lay = m['layout']
            lay['parkL'], lay['parkR'], lay['bikeL'], lay['bikeR'], _ = fit_layout(
                p['width'], lay['fwd'], lay['back'], lay['parkL'], lay['parkR'], lay['bikeL'], lay['bikeR'], lay['shoulder']
            )
        if fields:
            for k in fields:
                if k in m:
                    p[k] = m[k]
                else:
                    p.pop(k, None)
            continue
        p.update(m)
        if apply_width and p['kind'] not in ('motorway', 'trunk'):
            p['width'] = m['curbWidth']
    return len(models)


def apply(paths, proj, osm, cfg=None):
    """For bake.py (config `"streets": {"regions": [...]}`): the model of each region, written into the freshly baked paths."""
    n = 0
    for region in (cfg or {}).get('regions', ['endbox']):
        set_region(region)
        try:
            report, models, _ = build(paths, proj, osm)
        except FileNotFoundError as e:
            print(f'  streets ({region}): skipped, {e.filename} missing (python scripts/realmap/nyc_pull.py)')
            continue
        n += apply_models(paths, models, bool((cfg or {}).get('applyWidth')))
        print(f'  streets ({region}): {len(models)} paths got the street model')
    set_region('endbox')
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--write', action='store_true', help='add the fields to data.json (in place)')
    ap.add_argument('--apply-width', action='store_true', help='also set width = curbWidth (streets and links, never motorway / trunk)')
    ap.add_argument('--osm', nargs='*', help='Overpass base XML file(s) (default: all in scripts/realmap/.cache/overpass)')
    ap.add_argument('--only', type=int, nargs='*', help='only these path indices (debug)')
    ap.add_argument('--fields', nargs='*', help='with --write: only (re)write these model fields, e.g. lawn')
    ap.add_argument('--region', default='endbox', help='endbox (default) or west')
    args = ap.parse_args()
    set_region(args.region)
    proj = endbox.proj()
    data = json.load(open(DATA, encoding='utf-8'))
    paths = data['paths']
    files = args.osm or cached_osm()
    print('OSM: ' + ', '.join(os.path.relpath(f, ROOT) for f in files))
    nodes, ntags, ways = {}, {}, {}
    for fn in files:
        n, t, w, _ = overpass.parse(fn)
        nodes.update(n)
        ntags.update(t)
        ways.update(w)
    report, models, stats = build(paths, proj, (nodes, ntags, ways), args.only)
    print_report(report, stats)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    json.dump(report, open(report_path(), 'w'), indent=1)
    print(f'\nreport -> {os.path.relpath(report_path(), ROOT)}')
    ns = write_shifts(report, paths, SHIFTS) if args.write and not args.fields else 0
    if ns:
        print(f'street-shifts.json: {ns} streets')
    if not args.write:
        print('(report only: --write adds the fields to data.json)')
        return
    n = apply_models(paths, models, args.apply_width and not args.fields, args.fields)
    data['meta'].setdefault('streets', {})[f'paths{"" if REGION == "endbox" else "_" + REGION}'] = n
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {n} paths into {os.path.relpath(DATA, ROOT)}')


if __name__ == '__main__':
    main()
