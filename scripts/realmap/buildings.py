"""
Building footprints for real-world maps (used by bake.py).

Sources, merged:
  - OpenStreetMap building ways (priority: they carry tags such as building=industrial, building:levels)
  - Microsoft Global ML Building Footprints (ODbL) - per-quadkey CSV.gz from
    https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv

  - config buildings.dropWays: [OSM way ids] - ways a landmark asset draws instead (a 155 m antenna mast mapped as a building)
  - config buildings.manual: [{lat, lon, w, d, angleDeg, floors, type, building?, note}] - known buildings no data set has
    (source 'manual')
  - fallback where neither has footprints (config buildings.worldcover): houses generated from the ESA
    WorldCover 10 m built-up class - real built-up spots, but invented sizes / exact positions (source 'wc')

Each footprint -> oriented rectangle (centre, long side w, short side d, long-side direction angle),
classified as 'house' (sloped roof) or 'flat' (flat roof: sheds, shops, unfinished blocks, industrial halls),
with a wall height from tags / size. Buildings are pushed clear of the stage road and other roads / canals
(or dropped), then numbered along the stage route. Ids are stable across re-bakes: a building whose centre is
within 2.5 m of one in the previous data.json keeps its id ("stage 1 - building 12 - lat, lon").
"""

import csv
import gzip
import json
import math
import os
import sys

import cv2
import numpy as np
from scipy.spatial import cKDTree

MS_LINKS = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv'
TYPES = ['house', 'flat']
SOURCES = ['osm', 'ms', 'wc', 'manual']
# Richer classes for the game's mesh buildings (OSM tags + neighbours): see classify_kind().
KINDS = ['house', 'row', 'apartment', 'commercial', 'industrial', 'garage', 'church', 'tomb']
ROOFS = ['flat', 'gable']
FIELDS = ['id', 'x', 'z', 'w', 'd', 'angle', 'h', 'floors', 'type', 'src', 'along', 'kind', 'roof']
FLAT_TAGS = {
    'industrial', 'warehouse', 'commercial', 'retail', 'manufacture', 'roof', 'apartments', 'school',
    'public', 'train_station', 'garage', 'garages', 'shed', 'service', 'hangar', 'kiosk', 'office',
}  # fmt: skip


def quadkey(lat, lon, z=9):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    lr = math.radians(lat)
    y = int((1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n)
    s = ''
    for i in range(z, 0, -1):
        m = 1 << (i - 1)
        s += str((1 if x & m else 0) + (2 if y & m else 0))
    return s


def load_ms(box, fetch, cache):
    """Microsoft footprints with centroid inside box (lat0, lat1, lon0, lon1) -> list of [(lat, lon), ...]."""
    lat0, lat1, lon0, lon1 = box
    keys = {quadkey(la, lo) for la in np.linspace(lat0, lat1, 4) for lo in np.linspace(lon0, lon1, 4)}
    links = fetch(MS_LINKS, os.path.join(cache, 'msbuildings', 'dataset-links.csv'))
    urls = []
    with open(links, newline='') as f:
        for row in csv.DictReader(f):
            if row['QuadKey'] in keys:
                urls.append((row['QuadKey'], row['Url']))
    out = []
    for qk, url in urls:
        fn = fetch(url, os.path.join(cache, 'msbuildings', f'{qk}_{os.path.basename(url)}'))
        for line in gzip.open(fn, 'rt'):
            ring = json.loads(line)['geometry']['coordinates'][0]
            la = sum(p[1] for p in ring) / len(ring)
            lo = sum(p[0] for p in ring) / len(ring)
            if lat0 < la < lat1 and lon0 < lo < lon1:
                out.append([(p[1], p[0]) for p in ring])
    print(f'  microsoft footprints: {len(out)} in area (quadkeys {sorted(k for k, _ in urls)})')
    return out


def from_builtup(built, x0, z0, cell, taken, road_pts, seed=29):
    """Houses for built-up land cover cells that have no real footprint.

    built: bool raster (row 0 = min z) of WorldCover class 50; taken: [n,2] centres of real footprints.
    One house per ~260 m2 of built-up ground (roofs + yards), on cells spread >= 15 m apart, long side
    parallel to the nearest road (within 70 m) -> list of rect [cx, cz, w, d, angle].
    """
    n, lab, stats, _ = cv2.connectedComponentsWithStats(built.astype(np.uint8), connectivity=8)
    tk = cKDTree(taken) if len(taken) else None
    rk = cKDTree(road_pts)
    out = []
    for i in range(1, n):
        ys, xs = np.nonzero(lab == i)
        area = len(xs) * cell * cell
        if area < 90:
            continue  # single 10 m pixel fragments: noise
        want = max(1, int(round(area / 260)))
        order = sorted(range(len(xs)), key=lambda k: h01(int(xs[k]) * 7 + i, int(ys[k]) * 13 + seed))
        placed = []
        for k in order:
            if len(placed) >= want:
                break
            jx, jz = h01(int(xs[k]), int(ys[k]) + seed) - 0.5, h01(int(ys[k]), int(xs[k]) + seed) - 0.5
            x, z = x0 + (xs[k] + 0.5 + jx * 0.6) * cell, z0 + (ys[k] + 0.5 + jz * 0.6) * cell
            if any(math.hypot(x - px, z - pz) < 15 for px, pz in placed):
                continue
            if tk is not None and tk.query([x, z])[0] < 18:
                continue
            placed.append((x, z))
            r1, r2 = h01(int(x * 3), int(z * 3) + seed), h01(int(z * 5), int(x * 5) + seed)
            w, d = 8.5 + r1 * 4.5, 6.5 + r2 * 2.5
            dist, j = rk.query([x, z])
            if dist < 70:
                ang = math.atan2(road_pts[j][1] - z, road_pts[j][0] - x) + math.pi / 2
            else:
                ang = r1 * math.pi
            out.append([float(x), float(z), w, d, (ang + math.pi / 2) % math.pi - math.pi / 2])
    return out


def rect(xy):
    """Oriented rectangle: centre, long side w, short side d, direction of the long side (rad, x->z)."""
    (cx, cz), (a, b), ang = cv2.minAreaRect(np.asarray(xy, np.float32))
    t = math.radians(ang)
    if a >= b:
        w, d, dirn = a, b, t
    else:
        w, d, dirn = b, a, t + math.pi / 2
    return [float(cx), float(cz), float(w), float(d), (dirn + math.pi / 2) % math.pi - math.pi / 2]


def rect_dist(r, pts):
    """Distance from points [n,2] to rectangle r (0 inside)."""
    cx, cz, w, d, a = r
    ca, sa = math.cos(a), math.sin(a)
    dx, dz = pts[:, 0] - cx, pts[:, 1] - cz
    u = dx * ca + dz * sa  # along w
    v = -dx * sa + dz * ca  # along d
    return np.hypot(np.maximum(np.abs(u) - w / 2, 0), np.maximum(np.abs(v) - d / 2, 0))


def inside(r, x, z, margin=0.0):
    cx, cz, w, d, a = r
    u = (x - cx) * math.cos(a) + (z - cz) * math.sin(a)
    v = -(x - cx) * math.sin(a) + (z - cz) * math.cos(a)
    return abs(u) <= w / 2 + margin and abs(v) <= d / 2 + margin


def h01(a, b):
    """Deterministic 0..1 hash of two ints."""
    return ((a * 73856093) ^ (b * 19349663)) % 10007 / 10007


def classify(r, tags, cover, seed):
    """-> (type, wall height m, floors)."""
    w, d = r[2], r[3]
    area = w * d
    bt = (tags or {}).get('building', 'yes')
    lv = (tags or {}).get('building:levels', '')
    levels = int(lv) if lv.isdigit() else 0
    rnd = h01(int(r[0] * 10), int(r[1] * 10) + seed)
    flat = bt in FLAT_TAGS or area > 300 or area < 30 or (cover == 'industrial' and area > 120)
    if flat:
        if levels:
            return 'flat', round(levels * 3.2 + 0.4, 1), levels
        if area < 30:
            return 'flat', 2.7, 1  # garage / shed
        if area < 300:
            fl = 2 if rnd < 0.5 else 1
            return 'flat', 3.0 * fl + 0.4, fl  # shop / unfinished block
        if area < 1500:
            return 'flat', 7.0, 1  # workshop
        return 'flat', 9.0, 1  # industrial hall
    fl = levels or (2 if (rnd < 0.55 and area > 60) else 1)
    return 'house', round(2.9 * fl + 0.4, 1), fl



GARAGE_TAGS = {'garage', 'garages', 'shed', 'roof', 'carport', 'greenhouse', 'service', 'kiosk', 'hut', 'cabin'}
COMMERCIAL_TAGS = {'commercial', 'retail', 'office', 'school', 'hospital', 'public', 'civic', 'government', 'university', 'college', 'kindergarten', 'supermarket', 'hotel'}  # fmt: skip
INDUSTRIAL_TAGS = {'industrial', 'warehouse', 'manufacture', 'hangar', 'factory', 'storage_tank'}


def height_of(tags):
    """OSM height (NYC roof height) in metres, or None."""
    h = (tags or {}).get('height', '')
    try:
        return float(h.split()[0].replace(',', '.'))
    except (ValueError, IndexError):
        return None


def simplify_poly(pts, tol=0.6, max_pts=22):
    """World-space footprint ring [(x, z), ...] (closed or open) -> simplified open ring, or None if it is a plain box."""
    a = np.asarray(pts, np.float32)
    if len(a) > 1 and np.allclose(a[0], a[-1]):
        a = a[:-1]
    t = tol
    for _ in range(6):
        ap = cv2.approxPolyDP(a.reshape(-1, 1, 2), t, True).reshape(-1, 2)
        if len(ap) <= max_pts:
            break
        t *= 1.6
    return ap if len(ap) >= 3 else None


def classify_kind(r, tags, cover, attached):
    """-> (kind, roof, wall height m, floors, legacy type). `attached` = shares a side wall with a neighbour."""
    w, d = r[2], r[3]
    area = w * d
    t = tags or {}
    bt = t.get('building', 'yes')
    h = height_of(t)
    lv = t.get('building:levels', '')
    levels = int(lv) if lv.isdigit() else 0
    if t.get('historic') == 'tomb' or (cover == 'cemetery' and area < 70 and (h or 4) < 9):
        kind = 'tomb'
    elif bt in GARAGE_TAGS or (area < 45 and (h or 3) < 4.5):
        kind = 'garage'
    elif t.get('amenity') == 'place_of_worship' or bt in ('church', 'chapel', 'cathedral', 'temple', 'mosque', 'synagogue'):
        kind = 'church'
    elif bt in INDUSTRIAL_TAGS or (cover == 'industrial' and area > 150):
        kind = 'industrial'
    elif bt == 'apartments' or (h or 0) >= 16 or levels >= 5:
        kind = 'apartment'
    elif bt in COMMERCIAL_TAGS or area > 600:
        kind = 'commercial'
    elif attached and w >= 7:
        kind = 'row'
    else:
        kind = 'house'
    default_h = {'house': 7.0, 'row': 9.5, 'apartment': 16.0, 'commercial': 7.0, 'industrial': 8.5, 'garage': 3.2, 'church': 11.0, 'tomb': 3.5}[kind]  # fmt: skip
    top = h if h else (levels * 3.1 + 0.8 if levels else default_h)
    top = max(2.4, min(top, 150.0))
    roof = 'gable' if kind in ('house', 'church', 'tomb') else 'flat'
    # Pitched roofs: `top` is the ridge, the wall (eaves) is lower.
    wall = top * (0.74 if roof == 'gable' else 1.0)
    floor_h = 3.0 if kind in ('house', 'row') else 3.4
    floors = 1 if kind in ('garage', 'tomb') else max(1, int(round(wall / floor_h)))
    return kind, roof, round(wall, 1), floors, ('house' if roof == 'gable' else 'flat'), round(top, 1)


def attached_flags(rects):
    """Per building: shares a side wall with a neighbour (terraced / row house)."""
    c = np.array([r[:2] for r in rects]).reshape(-1, 2)
    out = [False] * len(rects)
    if not len(c):
        return out
    kd = cKDTree(c)
    for i, r in enumerate(rects):
        cx, cz, w, d, a = r
        ux, uz = math.cos(a), math.sin(a)
        for j in kd.query_ball_point([cx, cz], w / 2 + 30):
            if j == i:
                continue
            o = rects[j]
            if abs(math.sin(a - o[4])) > 0.25:
                continue
            dx, dz = o[0] - cx, o[1] - cz
            along, across = dx * ux + dz * uz, -dx * uz + dz * ux
            if abs(abs(across) - (d + o[3]) / 2) < 1.3 and abs(along) < (w + o[2]) / 2 * 0.7:
                out[i] = True
                break
    return out


def build(cfg, proj, nodes, ways, ll_box, ext, fetch, cache, route, paths, cover_at, out_dir, built=None):
    """route: smoothed 1 m stage polyline [n,2]; paths: [(kind, width, surface, pts)]."""
    seed = 17
    foot = []  # (rect, src, tags, osm id)
    drop_ways = {str(i) for i in cfg.get('buildings', {}).get('dropWays', [])}
    for wid, w in ways.items():
        if 'building' not in w['tags'] or len(w['refs']) < 4 or wid in drop_ways:
            continue
        ring = [proj.fwd(*nodes[r]) for r in w['refs']]
        rc = rect(ring)
        tg = dict(w['tags'])
        poly = simplify_poly(ring)
        # Polygon relative to the rectangle centre (the rectangle may be nudged clear of roads later).
        if poly is not None and not (len(poly) <= 5 and cv2.contourArea(np.asarray(poly, np.float32)) > 0.9 * rc[2] * rc[3]):
            tg['_poly'] = [(float(x - rc[0]), float(z - rc[1])) for x, z in poly]
        foot.append((rc, 'osm', tg, wid))
    osm_rects = [f[0] for f in foot]
    n_osm = len(foot)
    if cfg.get('buildings', {}).get('microsoft', True):
        for ring in load_ms(ll_box(ext, 50), fetch, cache):
            r = rect([proj.fwd(la, lo) for la, lo in ring])
            if any(inside(o, r[0], r[1], 1.5) or inside(r, o[0], o[1], 0.5) for o in osm_rects if abs(o[0] - r[0]) < 60 and abs(o[1] - r[1]) < 60):  # fmt: skip
                continue
            foot.append((r, 'ms', None, None))
    if cfg.get('buildings', {}).get('worldcover') and built is not None:
        mask, bx0, bz0, bcell = built
        road_pts = np.vstack([route[::4]] + [np.asarray(p) for k, wd, sf, p in paths if sf != 'water'])
        gen = from_builtup(mask, bx0, bz0, bcell, np.array([f[0][:2] for f in foot]).reshape(-1, 2), road_pts)
        print(f'  worldcover built-up: {len(gen)} generated houses (no real footprint there)')
        foot += [(r, 'wc', None, None) for r in gen]
    for m in cfg.get('buildings', {}).get('manual', []):
        x, z = proj.fwd(m['lat'], m['lon'])
        tags = {'building': m.get('building') or ('house' if m.get('type', 'house') == 'house' else 'roof'), 'building:levels': str(m.get('floors', 1))}
        foot.append(([x, z, m.get('w', 12), m.get('d', 8), math.radians(m.get('angleDeg', 0))], 'manual', tags, None))
    foot = [f for f in foot if ext[0] < f[0][0] < ext[1] and ext[2] < f[0][1] < ext[3] and f[0][2] * f[0][3] >= 12]

    # Obstacles with the clearance each needs from a footprint (m).
    pts, req = [route], [np.full(len(route), cfg.get('buildings', {}).get('roadClearance', 5.0))]
    for kind, width, surface, p in paths:
        q = np.asarray(p)
        seg = []
        for a, b in zip(q, q[1:]):
            n = max(1, int(np.linalg.norm(b - a) / 2))
            seg.append(a + (b - a) * np.linspace(0, 1, n, endpoint=False)[:, None])
        q = np.vstack(seg + [q[-1:]])
        pts.append(q)
        req.append(np.full(len(q), width / 2 + (2.5 if surface == 'water' else 0.4)))
    pts, req = np.vstack(pts), np.concatenate(req)
    kd = cKDTree(pts)
    kept, moved, dropped = [], 0, 0
    for r, src, tags, oid in foot:
        r = list(r)
        shift = 0.0
        ok = False
        for _ in range(5):
            idx = kd.query_ball_point(r[:2], r[2] / 2 + r[3] / 2 + req.max())
            if not idx:
                ok = True
                break
            idx = np.array(idx)
            viol = req[idx] - rect_dist(r, pts[idx])
            k = int(np.argmax(viol))
            if viol[k] <= 0:
                ok = True
                break
            p = pts[idx[k]]
            dv = np.array(r[:2]) - p
            L = np.linalg.norm(dv) or 1
            step = viol[k] + 0.1
            r[0] += dv[0] / L * step
            r[1] += dv[1] / L * step
            shift += step
            if shift > 3:
                break
        if not ok:
            dropped += 1
            continue
        moved += shift > 0
        kept.append((r, src, tags, oid))

    # Along-route order + stable ids.
    rkd = cKDTree(route)
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(route, axis=0), axis=1))])
    rows = []
    attached = attached_flags([k[0] for k in kept])
    for (r, src, tags, oid), att in zip(kept, attached):
        dist, i = rkd.query(r[:2])
        i = min(i, len(route) - 2)
        t = route[i + 1] - route[i]
        t /= np.linalg.norm(t) or 1
        lat = (r[0] - route[i][0]) * t[1] - (r[1] - route[i][1]) * t[0]  # + = left of travel (road.ts)
        typ, h, fl = classify(r, tags, cover_at(r[0], r[1]), seed)
        kind, roof, kh, kfl, ktyp, top = classify_kind(r, tags, cover_at(r[0], r[1]), att)
        if src == 'osm' and tags.get('height'):
            # Real (NYC roof) heights win over the guessed ones.
            typ, h, fl = ktyp, kh, kfl
        poly = tags.get('_poly') if tags else None
        rows.append({'r': r, 'src': src, 'tags': tags, 'osm': oid, 'along': float(acc[i]), 'lat': float(lat),
                     'dist': float(dist), 'type': typ, 'h': h, 'floors': fl, 'kind': kind, 'roof': roof,
                     'top': top, 'poly': poly})  # fmt: skip
    rows.sort(key=lambda b: (round(b['along']), abs(b['lat'])))
    prev = previous_ids(os.path.join(out_dir, 'data.json'))
    used = set()
    if prev is not None and len(prev):
        pkd = cKDTree(prev[:, 1:3])
        for b in rows:
            d, j = pkd.query(b['r'][:2])
            pid = int(prev[j, 0])
            if d < 2.5 and pid not in used:
                b['id'] = pid
                used.add(pid)
    nxt = max(used, default=0) + 1
    for b in rows:
        if 'id' not in b:
            b['id'] = nxt
            nxt += 1
    cnt = {k: sum(b['src'] == k for b in rows) for k in SOURCES}
    print(f'  buildings: {len(rows)} kept ({cnt["osm"]} osm of {n_osm}, {cnt["ms"]} microsoft, {cnt["wc"]} generated, {cnt["manual"]} manual), '
          f'{moved} nudged clear of roads, {dropped} dropped (on a road / canal)')  # fmt: skip
    write_csv(cfg, proj, rows, os.path.join(out_dir, 'buildings.csv'))
    data_rows = [
        [b['id'], round(b['r'][0], 1), round(b['r'][1], 1), round(b['r'][2], 1), round(b['r'][3], 1),
         round(b['r'][4], 3), b['h'], b['floors'], TYPES.index(b['type']), SOURCES.index(b['src']), round(b['along']),
         KINDS.index(b['kind']), ROOFS.index(b['roof'])]
        for b in sorted(rows, key=lambda b: b['id'])
    ]  # fmt: skip
    # Real footprint outlines (relative to the rectangle centre) for the buildings that are not plain boxes.
    polys = {str(b['id']): [round(v, 1) for p in b['poly'] for v in p] for b in rows if b['poly']}
    kc = {k: sum(b['kind'] == k for b in rows) for k in KINDS}
    print('  kinds: ' + ', '.join(f'{k} {v}' for k, v in kc.items()) + f'; {len(polys)} real outlines')
    return {'fields': FIELDS, 'types': TYPES, 'sources': SOURCES, 'kinds': KINDS, 'roofs': ROOFS, 'rows': data_rows, 'polys': polys}


def previous_ids(path):
    if not os.path.exists(path):
        return None
    try:
        b = json.load(open(path)).get('buildings')
    except (OSError, ValueError):
        return None
    if not isinstance(b, dict) or b.get('fields', [None])[0] != 'id':
        return None
    return np.array([[row[0], row[1], row[2]] for row in b['rows']], float)


def write_csv(cfg, proj, rows, path):
    stage = cfg.get('stage', 1)
    with open(path, 'w', newline='', encoding='utf8') as f:
        wr = csv.writer(f)
        wr.writerow(['ref', 'id', 'lat', 'lon', 'along_m', 'side', 'road_dist_m', 'type', 'floors', 'width_m',
                     'depth_m', 'wall_height_m', 'source', 'osm_way', 'osm_building', 'kind', 'roof', 'roof_height_m'])  # fmt: skip
        for b in sorted(rows, key=lambda b: b['id']):
            la, lo = proj.inv(b['r'][0], b['r'][1])
            wr.writerow([f'stage {stage} - building {b["id"]} - {la:.6f}, {lo:.6f}', b['id'], f'{la:.6f}', f'{lo:.6f}',
                         round(b['along']), 'L' if b['lat'] > 0 else 'R', round(b['dist'], 1), b['type'], b['floors'],
                         round(b['r'][2], 1), round(b['r'][3], 1), b['h'], b['src'], b['osm'] or '',
                         (b['tags'] or {}).get('building', ''), b.get('kind', ''), b.get('roof', ''), b.get('top', '')])  # fmt: skip

# --- city footprints for a v2 road-engine map (network.py) ---------------------------------------------------------
# City building footprints for a v2 road-engine map: adds the NYC buildings its bake has no building for.
#
#     python scripts/realmap/network.py scripts/realmap/jackie-2.json --city-buildings [--dry]
#
# The map's data.json takes its buildings from the source map's bake (network.py step 5: OpenStreetMap + Microsoft
# footprints, buildings.py). The bake reads single OSM outlines only and drops footprints that touch one of its roads, so
# some real buildings are missing (119-14 Union Tpke is a multi-part outline). This step reads NYC Building Footprints
# (OTI, dataset 5zhs-2jue: `python scripts/realmap/nyc_pull.py footprints`) and adds, as source 'nyc', every footprint
# inside the pulled box and within `buildingsCorridor` m of the route that the baked buildings cover less than `maxCover`
# of. Wall height = the city's roof height; kind / roof from classify_kind. A footprint that lies on the city
# roadbed (planimetric `roadbed`) by more than `maxOnRoad` of its area is left out (structures over a road).
#
# Re-runnable: rows with source 'nyc' are replaced; a footprint within 2.5 m of a previous 'nyc' row keeps its id.
# network.py runs it after writing data.json, so a re-import keeps the city buildings.
#
# Footprints past `buildingsCorridor` (out to `corridor` m from route metre `corridorFrom`: the far skyline) are first matched against the source map's
# bake (`terrainFrom`): the baked buildings that cover one are copied in, and only the rest become city buildings.
#
# Config `cityBuildings`: {footprints, roadbed (paths from the repo root), corridor (m, default buildingsCorridor),
# corridorFrom (route m, default 0), maxCover 0.3, maxOnRoad 0.15, minArea 12}.

PX = 0.5  # m per pixel for the cover / roadbed tests
FT = 0.3048


def rings_of(geom):
    """GeoJSON (Multi)Polygon -> outer rings [[lon, lat], ...]."""
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    if geom['type'] == 'MultiPolygon':
        return [p[0] for p in geom['coordinates']]
    return []


def outline(r, poly):
    """Baked building (rect [cx, cz, w, d, a], relative poly or None) -> world ring [n, 2]."""
    cx, cz, w, d, a = r
    if poly:
        p = np.asarray(poly, float).reshape(-1, 2)
        return p + [cx, cz]
    ca, sa = math.cos(a), math.sin(a)
    u, v = np.array([ca, sa]), np.array([-sa, ca])
    return np.array([[cx, cz] + u * su * w / 2 + v * sv * d / 2 for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def share_covered(ring, others):
    """Share of `ring`'s area inside the union of `others` (world rings), on a PX grid."""
    lo = ring.min(0) - 1
    hi = ring.max(0) + 1
    size = np.ceil((hi - lo) / PX).astype(int) + 1
    to_px = lambda q: np.round((np.asarray(q) - lo) / PX).astype(np.int32)  # noqa: E731
    me = np.zeros((size[1], size[0]), np.uint8)
    cv2.fillPoly(me, [to_px(ring)], 1)
    them = np.zeros_like(me)
    for o in others:
        cv2.fillPoly(them, [to_px(o)], 1)
    n = int(me.sum())
    return float((me & them).sum()) / n if n else 1.0


def city_buildings(cfg_path, dry=False):
    """See the section comment above."""
    from bake import Proj  # (bake imports this module)

    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    cfg = json.load(open(cfg_path))
    cb = cfg['cityBuildings']
    proj = Proj(*cfg['origin'])
    folder = os.path.join(root, cfg['folder'])
    data_path = os.path.join(folder, 'data.json')
    data = json.load(open(data_path))
    b = data['buildings']
    F = b['fields']
    col = {k: F.index(k) for k in F}
    if 'nyc' not in b['sources']:
        b['sources'] = [*b['sources'], 'nyc']
    nyc = b['sources'].index('nyc')
    prev = [r for r in b['rows'] if r[col['src']] == nyc]
    rows = [r for r in b['rows'] if r[col['src']] != nyc]
    polys = {k: v for k, v in (b.get('polys') or {}).items() if int(k) in {r[col['id']] for r in rows}}
    baked = [
        outline([r[col['x']], r[col['z']], r[col['w']], r[col['d']], r[col['angle']]], polys.get(str(r[col['id']])))
        for r in rows
    ]  # fmt: skip
    bkd = cKDTree(np.array([[r[col['x']], r[col['z']]] for r in rows]))
    # The source map's bake past `buildingsCorridor` (network.py keeps only the corridor): its buildings are copied
    # in where they cover a footprint out to `corridor` m, before any city building is added.
    src = json.load(open(os.path.join(root, cfg['terrainFrom'])))['buildings']
    assert src['fields'] == F, 'source map building columns differ'
    have = {r[col['id']] for r in rows}
    spolys = src.get('polys') or {}
    srows = [r for r in src['rows'] if r[col['id']] not in have and src['sources'][r[col['src']]] == b['sources'][r[col['src']]]]
    souts = [outline([r[col['x']], r[col['z']], r[col['w']], r[col['d']], r[col['angle']]], spolys.get(str(r[col['id']]))) for r in srows]  # fmt: skip
    skd = cKDTree(np.array([[r[col['x']], r[col['z']]] for r in srows]))
    copied = {}
    route = np.asarray(json.load(open(os.path.join(folder, 'network.json')))['stage']['cps'], float).reshape(-1, 2)
    # Dense route for the along / corridor tests (control points are ~10-30 m apart).
    seg = [a + (c - a) * np.linspace(0, 1, max(1, int(np.linalg.norm(c - a))), endpoint=False)[:, None] for a, c in zip(route, route[1:])]  # fmt: skip
    route = np.vstack(seg + [route[-1:]])
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(route, axis=0), axis=1))])
    rkd = cKDTree(route)

    road = []
    for f in json.load(open(os.path.join(root, cb['roadbed'])))['features']:
        for ring in rings_of(f['geometry'] or {'type': ''}):
            road.append(np.array([proj.fwd(la, lo) for lo, la in ring]))
    road_c = cKDTree(np.array([q.mean(0) for q in road]))
    road_r = np.array([np.linalg.norm(q - q.mean(0), axis=1).max() for q in road])

    feet = []
    stats = {'far': 0, 'covered': 0, 'road': 0, 'small': 0}
    for f in json.load(open(os.path.join(root, cb['footprints'])))['features']:
        p = f['properties']
        if 'demolition' in str(p.get('last_status_type') or '').lower():
            continue
        for ring in rings_of(f['geometry'] or {'type': ''}):
            xy = np.array([proj.fwd(la, lo) for lo, la in ring])
            if len(xy) > 1 and np.allclose(xy[0], xy[-1]):
                xy = xy[:-1]
            if len(xy) < 3:
                continue
            if abs(cv2.contourArea(xy.astype(np.float32))) < cb.get('minArea', 12):
                stats['small'] += 1
                continue
            c = xy.mean(0)
            dist, i = rkd.query(c)
            far = cb.get('corridor', cfg['buildingsCorridor']) if acc[i] >= cb.get('corridorFrom', 0) else cfg['buildingsCorridor']
            if dist > far:
                stats['far'] += 1
                continue
            feet.append((xy, c, np.linalg.norm(xy - c, axis=1).max(), p, float(acc[i])))

    def uncovered(outs, kd):
        out = []
        for ft in feet:
            xy, c, reach = ft[:3]
            if share_covered(xy, [outs[j] for j in kd.query_ball_point(c, reach + 60)]) < cb.get('maxCover', 0.3):
                out.append(ft)
        return out

    # 1. The source bake's buildings that cover a footprint this map has none for.
    for xy, c, reach, p, along in uncovered(baked, bkd):
        near = [j for j in skd.query_ball_point(c, reach + 60) if share_covered(souts[j], [xy]) > 0.3]
        if near and share_covered(xy, [souts[j] for j in near]) >= cb.get('maxCover', 0.3):
            for j in near:
                copied[srows[j][col['id']]] = j
    outs = baked + [souts[j] for j in copied.values()]
    okd = cKDTree(np.array([o.mean(0) for o in outs]))
    # 2. City buildings for the rest, unless they stand on the roadbed.
    cand = []
    rest = uncovered(outs, okd)
    stats['covered'] = len(feet) - len(rest)
    for xy, c, reach, p, along in rest:
        on = [j for j in road_c.query_ball_point(c, reach + road_r.max()) if np.linalg.norm(road[j].mean(0) - c) < reach + road_r[j]]  # fmt: skip
        if on and share_covered(xy, [road[j] for j in on]) > cb.get('maxOnRoad', 0.15):
            stats['road'] += 1
            print(f'  on the roadbed, left out: bin {p.get("bin")} at {c[0]:.0f}, {c[1]:.0f}')
            continue
        h = float(p.get('height_roof') or 0) * FT
        cand.append((xy, c, h, p, along))

    # Rows like the bake's (py): oriented box + real outline, kind from the city roof height.
    rects = [rect(xy) for xy, *_ in cand]
    attached = attached_flags(rects)
    pkd = cKDTree(np.array([[r[col['x']], r[col['z']]] for r in prev])) if prev else None
    used = set()
    # New ids above every id of this map and of the source map's bake (its rows can be copied in later).
    taken = {r[col['id']] for r in rows} | {r[col['id']] for r in srows}
    ids = [None] * len(cand)
    for k, r in enumerate(rects):
        if pkd is not None:
            d, j = pkd.query(r[:2])
            pid = prev[j][col['id']]
            if d < 2.5 and pid not in used and pid not in taken:
                ids[k] = pid
                used.add(pid)
    nxt = max(taken | used, default=0) + 1
    for k in range(len(ids)):
        if ids[k] is None:
            ids[k] = nxt
            nxt += 1
    added = []
    for k, ((xy, c, h, p, along), r, att) in enumerate(zip(cand, rects, attached)):
        code = str(p.get('feature_code') or '')
        tags = {'building': 'garage' if code == '5110' else 'yes'}
        if h > 0:
            tags['height'] = f'{h:.1f}'
        kind, roof, wall, floors, typ, _top = classify_kind(r, tags, None, att)
        bid = ids[k]
        row = [0] * len(F)
        vals = {
            'id': bid, 'x': round(r[0], 1), 'z': round(r[1], 1), 'w': round(r[2], 1), 'd': round(r[3], 1),
            'angle': round(r[4], 3), 'h': wall, 'floors': floors, 'type': TYPES.index(typ), 'src': nyc,
            'along': round(along), 'kind': KINDS.index(kind), 'roof': ROOFS.index(roof),
        }  # fmt: skip
        for k, v in vals.items():
            row[col[k]] = v
        added.append(row)
        poly = simplify_poly(xy)
        if poly is not None and not (len(poly) <= 5 and cv2.contourArea(np.asarray(poly, np.float32)) > 0.9 * r[2] * r[3]):
            polys[str(bid)] = [round(float(v), 1) for q in poly for v in (q[0] - r[0], q[1] - r[1])]
    for j in copied.values():
        rows.append(srows[j])
        sp = spolys.get(str(srows[j][col['id']]))
        if sp:
            polys[str(srows[j][col['id']])] = sp
    print(f'  city footprints: {len(added)} added (no baked building), {len(copied)} baked ones copied from '
          f'{cfg["terrainFrom"]} (past the corridor), {stats["covered"]} already baked (or copied), '
          f'{stats["road"]} on the roadbed, {stats["far"]} outside the corridor, {stats["small"]} under minArea')  # fmt: skip
    if dry:
        return
    b['rows'] = sorted(rows + added, key=lambda r: r[col['id']])
    b['polys'] = dict(sorted(polys.items(), key=lambda kv: int(kv[0])))
    with open(data_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  {os.path.relpath(data_path, root)}: {len(b["rows"])} buildings')
