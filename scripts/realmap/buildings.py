"""
Building footprints for real-world maps (used by bake.py).

Sources, merged:
  - OpenStreetMap building ways (priority: they carry tags such as building=industrial, building:levels)
  - Microsoft Global ML Building Footprints (ODbL) - per-quadkey CSV.gz from
    https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv

  - config buildings.manual: [{lat, lon, w, d, angleDeg, floors, type, note}] - known buildings no data set has
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
    for wid, w in ways.items():
        if 'building' not in w['tags'] or len(w['refs']) < 4:
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
        tags = {'building': 'house' if m.get('type', 'house') == 'house' else 'roof', 'building:levels': str(m.get('floors', 1))}
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
