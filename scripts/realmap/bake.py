"""
Real-world rally map baker.

    python scripts/realmap/bake.py scripts/realmap/ajvatovci.json [--preview]

Downloads (cached in scripts/realmap/.cache/) and bakes into one JSON module
that a MapDef imports (see src/games/rally/maps/ajvatovci/map.ts):

  - elevation   AWS Terrain Tiles (Terrarium PNG, SRTM/EU-DEM based, public), or - config "dem" - a local
                GeoTIFF (e.g. Copernicus GLO-30 from OpenTopography, kept in sources/maps/<id>/; a .tar.gz
                with the .tif inside works too), feathered into Terrarium where the file ends
                -> two int16 grids (detail ~10 m + outer horizon ~50 m)
                Surface model: tree canopy / roofs are partly subtracted using land cover.
  - land cover  ESA WorldCover 2021 10 m (CC BY 4.0) + OpenStreetMap landuse (ODbL)
                -> 5 m zone raster (RLE) + zone table (cover class, orchard row angle)
  - stage road  shortest drivable OSM path through the config waypoints (+ config "extraWays" for roads
                OSM doesn't have, see trace_route.py)
                -> smoothed Catmull-Rom control points
  - paths       other OSM roads / tracks / canals (ribbons, splat paint, canal carving); config "waterways"
                [{kind, note, pts: [[lat, lon], ...]}] adds streams OSM lacks (see dem_stream.py)
                Side roads are cut a few metres short of the stage road; the game joins them to it and
                closes the mouth with barriers (world/junctions.ts). Ways that only pass over / under the
                stage road (no shared OSM node, e.g. a motorway under a bridge) get "junction": false.
                Config "msRoads" {country, clearance, minLength, stageClearance?}: + roads OSM lacks from Microsoft
                ML Road Detections (ODbL, see msroads.py), as dirt tracks; kept off OSM roads and railways, and
                `stageClearance` m from the stage road (no new junctions on a finished stage).
  - buildings   OSM + Microsoft ML footprints as oriented boxes, typed house / flat, numbered along the
                route (stable ids) -> also <map folder>/buildings.csv (see buildings.py)
  - power       OSM pylons + lines

World axes: +X east, +Z SOUTH (north = -Z), metres from config.origin (lat, lon).
three.js is right-handed: with +Y up, +X east and +Z north the world would be mirrored.
Requires: numpy, scipy, Pillow, opencv-python (cv2).
"""

import base64
import heapq
import json
import math
import os
import io
import struct
import sys
import tarfile
import time
import urllib.request
import xml.etree.ElementTree as ET
import zlib

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

import buildings as bld
import msroads
import overpass as ovp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache')
UA = {'User-Agent': 'MiniGamePortal-rally-mapbaker/1.0'}
# A way turning more than this at one node (deg) is split there (see add_way).
HAIRPIN = 120


# --- projection -------------------------------------------------------------------


class Proj:
    """Local equirectangular projection (accurate to < 1 m over ~10 km)."""

    def __init__(self, lat0, lon0):
        p = math.radians(lat0)
        self.lat0, self.lon0 = lat0, lon0
        self.my = 111132.92 - 559.82 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
        self.mx = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p)

    def fwd(self, lat, lon):
        """-> world (x, z): +X east, +Z south."""
        return ((lon - self.lon0) * self.mx, (self.lat0 - lat) * self.my)

    def inv(self, x, z):
        return (self.lat0 - z / self.my, self.lon0 + x / self.mx)


def fetch(url, path, headers=None):
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print('  retry', url, e)
            time.sleep(3 + attempt * 4)
    with open(path, 'wb') as f:
        f.write(data)
    return path


# --- elevation (Terrarium tiles) -----------------------------------------------------


def merc_px(lat, lon, z):
    n = 2**z * 256
    x = (lon + 180) / 360 * n
    lr = np.radians(lat)
    y = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n
    return x, y


def terrarium_sampler(lat0, lat1, lon0, lon1, z):
    """Returns f(lat[], lon[]) -> metres, bilinear on a stitched tile mosaic."""
    x0, y1 = merc_px(lat0, lon0, z)
    x1, y0 = merc_px(lat1, lon1, z)
    tx0, tx1, ty0, ty1 = int(x0 // 256), int(x1 // 256), int(y0 // 256), int(y1 // 256)
    mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            fn = fetch(
                f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png',
                os.path.join(CACHE, 'terrarium', f'{z}_{tx}_{ty}.png'),
            )
            a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float32)
            h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            mos[(ty - ty0) * 256 : (ty - ty0 + 1) * 256, (tx - tx0) * 256 : (tx - tx0 + 1) * 256] = h

    def sample(lat, lon):
        px, py = merc_px(lat, lon, z)
        return map_coordinates(mos, [py - ty0 * 256 - 0.5, px - tx0 * 256 - 0.5], order=1, mode='nearest')

    return sample


def geotiff_sampler(path, member=None):
    """Local north-up WGS84 GeoTIFF (or a .tar.gz holding one) -> (f(lat[], lon[]) -> metres, bilinear;
    w(lat[], lon[]) -> 0..1 coverage weight, 0 outside, 1 more than `feather` px inside; label)."""
    a, lon0, lat1, sx, sy = read_geotiff(path, member)
    print(f'  local DEM {os.path.basename(path)}')
    return raster_sampler(a, lon0, lat1, sx, sy)


def read_geotiff(path, member=None):
    """North-up WGS84 GeoTIFF (or a .tar.gz holding one) -> (float32 array, lon0, lat1, sx, sy): outer corner of
    pixel (0, 0) and the pixel size in degrees."""
    if path.endswith(('.tar.gz', '.tgz', '.tar')):
        tf = tarfile.open(path)
        names = [m.name for m in tf.getmembers() if m.name.lower().endswith(('.tif', '.tiff'))]
        name = member or names[0]
        im = Image.open(io.BytesIO(tf.extractfile(name).read()))
    else:
        im = Image.open(path)
    sx, sy = im.tag_v2[33550][:2]  # ModelPixelScale (deg / px)
    tie = im.tag_v2[33922]  # ModelTiepoint: raster (i, j) -> (lon, lat)
    lon0, lat1 = tie[3] - tie[0] * sx, tie[4] + tie[1] * sy  # outer corner of pixel (0, 0)
    return np.asarray(im).astype(np.float32), lon0, lat1, sx, sy


def usgs3dep_sampler(lat0, lat1, lon0, lon1, cell_m):
    """USGS 3DEP bare-earth DEM (lidar where available, public domain) for a lat / lon box, from the
    3DEPElevation ImageServer: the box is fetched in <= 2000 px tiles of ~cell_m metres (cached as .npy)
    and mosaicked -> same (sample, weight) pair as geotiff_sampler. US only.
    The server keeps the requested image size but makes the pixels square in degrees, widening the box's narrow side
    about its centre: the tiles ask for square pixels (cell_m north-south, finer east-west), so they come back as asked."""
    sx = sy = cell_m / 111132.0
    cols = int(math.ceil((lon1 - lon0) / sx))
    rows = int(math.ceil((lat1 - lat0) / sy))
    a = np.zeros((rows, cols), np.float32)
    T = 2000
    for r0 in range(0, rows, T):
        for c0 in range(0, cols, T):
            r1, c1 = min(rows, r0 + T), min(cols, c0 + T)
            n_, w_ = lat1 - r0 * sy, lon0 + c0 * sx  # tile north / west edge
            s_, e_ = lat1 - r1 * sy, lon0 + c1 * sx
            fn = os.path.join(CACHE, '3dep', f'{cell_m:g}m_{s_:.5f}_{w_:.5f}_{r1 - r0}x{c1 - c0}.npy')
            if not os.path.exists(fn):
                url = (f'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
                       f'?bbox={w_:.7f},{s_:.7f},{e_:.7f},{n_:.7f}&bboxSR=4326&imageSR=4326&size={c1 - c0},{r1 - r0}'
                       f'&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image')  # fmt: skip
                tmp = fetch(url, fn + '.tif')
                t = np.asarray(Image.open(tmp)).astype(np.float32)
                assert t.shape == (r1 - r0, c1 - c0), f'3DEP tile size {t.shape}'
                np.save(fn, t)
                os.remove(tmp)
            a[r0:r1, c0:c1] = np.load(fn)
    bad = int((a < -50).sum())
    print(f'  USGS 3DEP {cell_m:g} m: {cols}x{rows}, {a.min():.1f}..{a.max():.1f} m ({bad} no-data px)')
    if bad:
        a[a < -50] = np.median(a[a > -50])
    return raster_sampler(a, lon0, lat1, sx, sy)


def raster_sampler(a, lon0, lat1, sx, sy):
    """North-up WGS84 raster (outer corner of pixel (0, 0) = lon0 / lat1, pixel sx x sy deg) ->
    (f(lat[], lon[]) -> value, bilinear; w(lat[], lon[]) -> 0..1 coverage weight)."""
    rows, cols = a.shape
    print(f'  raster {cols}x{rows}, {lon0:.4f}..{lon0 + cols * sx:.4f} E, '
          f'{lat1 - rows * sy:.4f}..{lat1:.4f} N, {a.min():.0f}..{a.max():.0f} m')  # fmt: skip

    def px(lat, lon):
        return (lat1 - lat) / sy - 0.5, (lon - lon0) / sx - 0.5

    def sample(lat, lon):
        r, c = px(lat, lon)
        return map_coordinates(a, [r, c], order=1, mode='nearest')

    def weight(lat, lon, feather=12):
        r, c = px(lat, lon)
        e = np.minimum(np.minimum(r, rows - 1 - r), np.minimum(c, cols - 1 - c))
        t = np.clip(e / feather, 0, 1)
        return t * t * (3 - 2 * t)

    return sample, weight


def grid_coords(ext, cell):
    x0, x1, z0, z1 = ext
    cols = int(round((x1 - x0) / cell)) + 1
    rows = int(round((z1 - z0) / cell)) + 1
    xs = x0 + np.arange(cols) * cell
    zs = z0 + np.arange(rows) * cell
    return np.meshgrid(xs, zs)  # [rows, cols], row 0 = minZ


# --- WorldCover (10 m COG on AWS, read with HTTP range requests) ---------------------

WC_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif'
WC_RES = 12000  # px per degree


def http_range(url, a, b):
    req = urllib.request.Request(url, headers={**UA, 'Range': f'bytes={a}-{b}'})
    return urllib.request.urlopen(req, timeout=120).read()


def cog_window(url, r0, r1, c0, c1):
    """Minimal tiled-GeoTIFF reader (DEFLATE, uint8) for the WorldCover COGs."""
    head = http_range(url, 0, 65535)
    bo = '<' if head[:2] == b'II' else '>'
    off = struct.unpack(bo + 'I', head[4:8])[0]
    n = struct.unpack(bo + 'H', head[off : off + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8}
    fmts = {1: 'B', 3: 'H', 4: 'I', 16: 'Q'}
    tags = {}
    for i in range(n):
        e = head[off + 2 + i * 12 : off + 14 + i * 12]
        tag, typ, cnt = struct.unpack(bo + 'HHI', e[:8])
        if typ not in fmts:
            continue
        sz = sizes[typ] * cnt
        if sz <= 4:
            data = e[8 : 8 + sz]
        else:
            vo = struct.unpack(bo + 'I', e[8:12])[0]
            data = head[vo : vo + sz] if vo + sz <= len(head) else http_range(url, vo, vo + sz - 1)
        tags[tag] = struct.unpack(bo + fmts[typ] * cnt, data)
    W = tags[256][0]
    tw, th = tags[322][0], tags[323][0]
    offs, cnts = tags[324], tags[325]
    assert tags[259][0] == 8, 'expected DEFLATE'
    tpr = (W + tw - 1) // tw
    out = np.zeros((r1 - r0, c1 - c0), np.uint8)
    for tr in range(r0 // th, (r1 - 1) // th + 1):
        for tc in range(c0 // tw, (c1 - 1) // tw + 1):
            i = tr * tpr + tc
            a = np.frombuffer(zlib.decompress(http_range(url, offs[i], offs[i] + cnts[i] - 1)), np.uint8)
            a = a.reshape(th, tw)
            ys, ye = max(r0, tr * th), min(r1, (tr + 1) * th)
            xs, xe = max(c0, tc * tw), min(c1, (tc + 1) * tw)
            out[ys - r0 : ye - r0, xs - c0 : xe - c0] = a[ys - tr * th : ye - tr * th, xs - tc * tw : xe - tc * tw]
    return out


def worldcover_sampler(lat0, lat1, lon0, lon1):
    """Returns f(lat[], lon[]) -> WorldCover class (nearest). Handles 3-degree tile seams."""
    key = f'{lat0:.4f}_{lat1:.4f}_{lon0:.4f}_{lon1:.4f}'
    fn = os.path.join(CACHE, 'worldcover', key + '.npy')
    tlon = math.floor(lon0 / 3) * 3
    assert math.floor(lon1 / 3) * 3 == tlon, 'window spans a tile column seam (not supported)'
    # Row 0 of the window = first full pixel row at/below lat1 in the top tile.
    tl_top = math.floor((lat1 - 1e-9) / 3) * 3
    lat_top = tl_top + 3 - int((tl_top + 3 - lat1) * WC_RES) / WC_RES
    if not os.path.exists(fn):
        os.makedirs(os.path.dirname(fn), exist_ok=True)
        parts = []
        lat_hi = lat1
        while lat_hi > lat0:
            tl = math.floor((lat_hi - 1e-9) / 3) * 3  # tile lower lat
            lat_lo = max(lat0, tl)
            name = f'{"N" if tl >= 0 else "S"}{abs(tl):02d}{"E" if tlon >= 0 else "W"}{abs(tlon):03d}'
            c0, c1 = int((lon0 - tlon) * WC_RES), int(math.ceil((lon1 - tlon) * WC_RES))
            r0, r1 = int((tl + 3 - lat_hi) * WC_RES), int(math.ceil((tl + 3 - lat_lo) * WC_RES))
            print('  worldcover', name, r0, r1, c0, c1)
            parts.append(cog_window(WC_URL.format(name), r0, r1, c0, c1))
            lat_hi = lat_lo
        np.save(fn, np.vstack(parts))
    wc = np.load(fn)
    lon_base = tlon + int((lon0 - tlon) * WC_RES) / WC_RES

    def sample(lat, lon):
        r = np.clip(((lat_top - lat) * WC_RES).astype(int), 0, wc.shape[0] - 1)
        c = np.clip(((lon - lon_base) * WC_RES).astype(int), 0, wc.shape[1] - 1)
        return wc[r, c]

    return sample


# --- OSM ---------------------------------------------------------------------------------


def load_osm(lat0, lat1, lon0, lon1):
    fn = fetch(
        f'https://api.openstreetmap.org/api/0.6/map?bbox={lon0:.5f},{lat0:.5f},{lon1:.5f},{lat1:.5f}',
        os.path.join(CACHE, 'osm', f'{lat0:.4f}_{lat1:.4f}_{lon0:.4f}_{lon1:.4f}.xml'),
    )
    r = ET.parse(fn).getroot()
    nodes, ntags = {}, {}
    for n in r.iter('node'):
        nodes[n.get('id')] = (float(n.get('lat')), float(n.get('lon')))
        t = {k.get('k'): k.get('v') for k in n.iter('tag')}
        if t:
            ntags[n.get('id')] = t
    ways = {}
    for w in r.iter('way'):
        t = {k.get('k'): k.get('v') for k in w.iter('tag')}
        refs = [nd.get('ref') for nd in w.iter('nd')]
        ways[w.get('id')] = {'tags': t, 'refs': [x for x in refs if x in nodes], 'closed': refs[0] == refs[-1]}
    rels = []
    for rel in r.iter('relation'):
        t = {k.get('k'): k.get('v') for k in rel.iter('tag')}
        mem = [(m.get('type'), m.get('ref'), m.get('role')) for m in rel.iter('member')]
        rels.append({'tags': t, 'members': mem})
    return nodes, ntags, ways, rels


def merge_osm(parts):
    """Merge OSM downloads (nodes, ntags, ways, rels) of several boxes: the first one that has an element wins."""
    if len(parts) == 1:
        return parts[0]
    nodes, ntags, ways, rels = {}, {}, {}, []
    seen = set()
    for n, nt, w, r in parts:
        for k, v in n.items():
            nodes.setdefault(k, v)
        for k, v in nt.items():
            ntags.setdefault(k, v)
        for k, v in w.items():
            ways.setdefault(k, v)  # the API returns whole ways (all their nodes): any box's copy is complete
        for rel in r:
            key = json.dumps(rel, sort_keys=True)
            if key not in seen:
                seen.add(key)
                rels.append(rel)
    return nodes, ntags, ways, rels


DRIVABLE = {
    'tertiary', 'secondary', 'primary', 'unclassified', 'residential', 'service',
    'track', 'living_street', 'tertiary_link', 'secondary_link',
}  # fmt: skip
# Config route.highways: parkways / motorways may carry the stage. They are one-way carriageways: the
# route only follows their direction of travel (the stage is driven on the carriageway the real drive uses).
HIGHWAYS = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary_link'}


def route_through(waypoints, nodes, ways, proj, extra=(), snap=80.0, opts=None):
    """Shortest drivable OSM path through the waypoints. `extra` = config "extraWays": roads OSM doesn't
    have ([{pts: [[lat, lon], ...]}], e.g. from trace_route.py); each end is joined to the nearest OSM
    road node within `snap` m (an end with no road near it - the route end - stays open).
    `opts` = config "route": {highways: bool, offHighwayCost: x} - x > 1 makes leaving the motorway /
    parkway class expensive, so the stage stays on it instead of cutting through side streets."""
    opts = opts or {}
    use_hw = opts.get('highways', False)
    off_cost = opts.get('offHighwayCost', 1.0)
    G, xy = {}, {}

    def edge(a, b, mult=1.0, both=True):
        L = math.dist(xy[a], xy[b]) * mult
        G.setdefault(a, []).append((b, L))
        if both:
            G.setdefault(b, []).append((a, L))

    for wid, w in ways.items():
        hw = w['tags'].get('highway')
        is_hw = use_hw and hw in HIGHWAYS
        if hw not in DRIVABLE and not is_hw:
            continue
        refs = w['refs']
        oneway = is_hw and w['tags'].get('oneway') in ('yes', '1', 'true')
        mult = 1.0 if is_hw else off_cost
        for a, b in zip(refs, refs[1:]):
            xy[a], xy[b] = proj.fwd(*nodes[a]), proj.fwd(*nodes[b])
            edge(a, b, mult, both=not oneway)
    if extra:
        okeys = list(xy)
        otree = cKDTree([xy[k] for k in okeys])
        for wi, w in enumerate(extra):
            pts = [proj.fwd(la, lo) for la, lo in w['pts']]
            joins = []
            for end in (0, -1):
                d, i = otree.query(pts[end])
                joins.append(okeys[i] if d <= snap else None)
            # Start exactly on the OSM node: drop traced points right next to it (no zig-zag at the join).
            if joins[0]:
                pts = [p for p in pts if math.dist(p, xy[joins[0]]) > 25]
            if joins[1]:
                pts = [p for p in pts if math.dist(p, xy[joins[1]]) > 25]
            ids = [f'x{wi}_{k}' for k in range(len(pts))]
            for k, p in zip(ids, pts):
                xy[k] = p
            chain = ([joins[0]] if joins[0] else []) + ids + ([joins[1]] if joins[1] else [])
            for a, b in zip(chain, chain[1:]):
                edge(a, b)
            L = sum(math.dist(xy[a], xy[b]) for a, b in zip(chain, chain[1:]))
            print(f'  extra way {wi}: {L:.0f} m, joined to OSM at {"start" if joins[0] else "-"} / {"end" if joins[1] else "-"}')
    keys = list(xy)
    tree = cKDTree([xy[k] for k in keys])
    ends = [keys[tree.query(proj.fwd(*wp))[1]] for wp in waypoints]
    path = [ends[0]]
    for s, t in zip(ends, ends[1:]):
        dist, prev, pq = {s: 0}, {}, [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == t:
                break
            if d > dist[u]:
                continue
            for v, L in G.get(u, []):
                if d + L < dist.get(v, 1e18):
                    dist[v], prev[v] = d + L, u
                    heapq.heappush(pq, (d + L, v))
        if t not in dist:
            raise SystemExit(f'no drivable route between waypoints {ends.index(s)} and {ends.index(t)} (one-way roads?)')
        seg = [t]
        while seg[-1] != s:
            seg.append(prev[seg[-1]])
        path += seg[::-1][1:]
    return np.array([xy[n] for n in path]), path


def report_route(route_ids, ways):
    """Print the OSM roads the route follows (name / class, metres of nodes) - check it against the user's link."""
    node_way = {}
    for wid, w in ways.items():
        for a, b in zip(w['refs'], w['refs'][1:]):
            node_way.setdefault((a, b), wid)
            node_way.setdefault((b, a), wid)
    runs = []
    for a, b in zip(route_ids, route_ids[1:]):
        wid = node_way.get((a, b))
        t = ways[wid]['tags'] if wid else {}
        label = (t.get('name') or t.get('ref') or '(unnamed)', t.get('highway', '-'), t.get('oneway', ''), t.get('bridge', ''), t.get('layer', ''))  # fmt: skip
        if runs and runs[-1][0] == label:
            runs[-1][1] += 1
        else:
            runs.append([label, 1, wid])
    print('  route follows:')
    for label, n, wid in runs:
        print(f'    {n:4d} nodes  {label[0]} [{label[1]}{" oneway" if label[2] == "yes" else ""}{" bridge" if label[3] else ""}{" layer " + label[4] if label[4] else ""}]  way {wid}')  # fmt: skip


def route_spans(route_ids, raw, ways, smooth):
    """Where the stage road runs on a bridge (OSM bridge=yes) or under something (layer < 0): list of
    {kind: 'bridge' | 'under', from, to} in metres along the smoothed route, adjacent pieces merged."""
    node_way = {}
    for wid, w in ways.items():
        for a, b in zip(w['refs'], w['refs'][1:]):
            node_way.setdefault((a, b), wid)
            node_way.setdefault((b, a), wid)
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(smooth, axis=0), axis=1))])
    kd = cKDTree(smooth)
    spans = []
    for i, (a, b) in enumerate(zip(route_ids, route_ids[1:])):
        wid = node_way.get((a, b))
        t = ways[wid]['tags'] if wid else {}
        layer = int(t['layer']) if t.get('layer', '').lstrip('-').isdigit() else 0
        kind = 'bridge' if t.get('bridge') not in (None, 'no') else ('under' if layer < 0 else None)
        if not kind:
            continue
        ia, ib = kd.query(raw[i])[1], kd.query(raw[i + 1])[1]
        lo, hi = float(acc[min(ia, ib)]), float(acc[max(ia, ib)])
        if spans and spans[-1]['kind'] == kind and lo - spans[-1]['to'] < 4:
            spans[-1]['to'] = max(spans[-1]['to'], hi)
        else:
            spans.append({'kind': kind, 'from': lo, 'to': hi, 'layer': layer or 1})
    return [{**sp, 'from': round(sp['from']), 'to': round(sp['to'])} for sp in spans if sp['to'] - sp['from'] >= 3]


def resample(poly, step):
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(0, d[-1], step)
    t = np.append(t, d[-1])
    return np.stack([np.interp(t, d, poly[:, 0]), np.interp(t, d, poly[:, 1])], 1)


def catmull_rom(points, per_seg=24):
    """Centripetal Catmull-Rom (same family as three.js CatmullRomCurve3 'centripetal')."""
    P = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        d = lambda a, b: max(1e-4, np.linalg.norm(b - a) ** 0.5)  # noqa: E731
        t0, t1 = 0, d(p0, p1)
        t2 = t1 + d(p1, p2)
        t3 = t2 + d(p2, p3)
        for t in np.linspace(t1, t2, per_seg, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(points[-1])
    return np.array(out)


def control_points(poly, sigma, tol, min_radius):
    """Smooth the OSM polyline (rounds junction corners) and pick spline control points."""
    p = resample(poly, 1.0)
    n = len(p)
    # Pad by reflection so the ends stay put.
    pad = int(sigma * 4)
    ext = np.vstack([2 * p[0] - p[pad:0:-1], p, 2 * p[-1] - p[-2 : -pad - 2 : -1]])
    sm = np.stack([gaussian_filter(ext[:, 0], sigma), gaussian_filter(ext[:, 1], sigma)], 1)[pad : pad + n]
    sm = limit_radius(sm, min_radius)
    n = len(sm)

    # Douglas-Peucker on the smooth line.
    def dp(a, b, keep):
        if b <= a + 1:
            return
        seg = sm[b] - sm[a]
        L = np.linalg.norm(seg) or 1e-9
        rel = sm[a + 1 : b] - sm[a]
        dist = np.abs(rel[:, 0] * seg[1] - rel[:, 1] * seg[0]) / L
        i = int(np.argmax(dist))
        if dist[i] > tol:
            keep.add(a + 1 + i)
            dp(a, a + 1 + i, keep)
            dp(a + 1 + i, b, keep)

    keep = {0, n - 1}
    dp(0, n - 1, keep)
    idx = sorted(keep)
    # Max spacing 60 m, then refine until the spline matches the smooth line.
    filled = [idx[0]]
    for a, b in zip(idx, idx[1:]):
        k = int(math.ceil((b - a) / 60))
        filled += [a + (b - a) * j // k for j in range(1, k)] + [b]
    idx = filled
    kd = cKDTree(sm)
    for _ in range(300):
        idx = even_spacing(idx)
        cr = catmull_rom(sm[idx])
        dev, near = kd.query(cr)
        worst = int(np.argmax(dev))
        if dev[worst] < tol * 1.5:
            break
        j = int(near[worst])
        if j in idx:
            break
        idx = sorted(set(idx) | {j})
    return sm[idx], sm


def even_spacing(idx, ratio=2.2, min_len=8):
    """Split segments much longer than a neighbour: uneven spacing makes Catmull-Rom loop."""
    idx = list(idx)
    for _ in range(50):
        L = np.diff(idx)
        add = set()
        for i, l in enumerate(L):
            nb = min(L[i - 1] if i > 0 else 1e9, L[i + 1] if i + 1 < len(L) else 1e9)
            if l > min_len and l > ratio * nb:
                add.add(idx[i] + l // 2)
        if not add:
            break
        idx = sorted(set(idx) | add)
    return idx


def turn_curvature(p, h=3):
    """|curvature| (1/m) of a ~1 m polyline from the heading change over +-h samples."""
    d = np.diff(p, axis=0)
    a = np.arctan2(d[:, 1], d[:, 0])
    k = np.zeros(len(p))
    for i in range(len(p)):
        i0, i1 = max(0, i - h), min(len(d) - 1, i + h - 1)
        da = (a[i1] - a[i0] + np.pi) % (2 * np.pi) - np.pi
        k[i] = abs(da) / max(1, i1 - i0 + 1)
    return k


def limit_radius(p, min_radius):
    """Widen corners tighter than min_radius with local Laplacian smoothing (keeps the rest)."""
    for it in range(400):
        k = turn_curvature(p)
        bad = k > 1 / min_radius
        if not bad.any():
            break
        w = gaussian_filter(bad.astype(float), 4) > 0.02
        w[0] = w[-1] = False
        lap = (p[:-2] + p[2:]) / 2 - p[1:-1]
        p[1:-1][w[1:-1]] += 0.6 * lap[w[1:-1]]
        if it % 8 == 7:
            p = resample(p, 1.0)
    print(f'  corner radius limit {min_radius} m: {it} smoothing passes, min radius {1 / max(turn_curvature(p).max(), 1e-6):.1f} m')
    return p


# --- encoding helpers ------------------------------------------------------------------


def b64_int16(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<i2').tobytes()).decode()


def rle_b64(a):
    """Runs of (value byte, LEB128 length)."""
    flat = a.ravel()
    out = bytearray()
    i = 0
    n = len(flat)
    change = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], change])
    ends = np.concatenate([change, [n]])
    for s, e in zip(starts, ends):
        out.append(int(flat[s]))
        L = int(e - s)
        while True:
            b = L & 0x7F
            L >>= 7
            out.append(b | (0x80 if L else 0))
            if not L:
                break
        i = e
    return base64.b64encode(bytes(out)).decode()


# --- land cover ---------------------------------------------------------------------------

# Cover classes. Zones 0..len-1 are these; orchard zones with their own row angle follow.
COVERS = ['grass', 'crop', 'shrub', 'pine', 'trees', 'orchard', 'urban', 'industrial', 'bare', 'water', 'vineyard', 'cemetery', 'hazelnut']  # fmt: skip
C = {c: i for i, c in enumerate(COVERS)}
WC_MAP = {10: 'trees', 20: 'shrub', 30: 'grass', 40: 'crop', 50: 'urban', 60: 'bare', 80: 'water', 90: 'grass', 95: 'trees', 100: 'grass'}  # fmt: skip
OSM_COVER = {
    ('landuse', 'farmland'): ('crop', False), ('landuse', 'meadow'): ('grass', False),
    ('landuse', 'grass'): ('grass', False), ('natural', 'grassland'): ('grass', False),
    ('natural', 'heath'): ('shrub', False), ('natural', 'scrub'): ('shrub', True),
    ('landuse', 'orchard'): ('orchard', True), ('landuse', 'vineyard'): ('vineyard', True),
    ('natural', 'wood'): ('pine', True), ('landuse', 'forest'): ('pine', True),
    ('landuse', 'residential'): ('urban', False), ('landuse', 'industrial'): ('industrial', False),
    ('landuse', 'commercial'): ('industrial', False), ('landuse', 'construction'): ('bare', True),
    ('landuse', 'cemetery'): ('cemetery', True), ('landuse', 'allotments'): ('crop', False),
    ('natural', 'water'): ('water', True), ('landuse', 'brownfield'): ('bare', True),
    ('leisure', 'park'): ('grass', False), ('leisure', 'golf_course'): ('grass', False),
    ('leisure', 'pitch'): ('grass', False), ('leisure', 'garden'): ('grass', False),
    ('leisure', 'recreation_ground'): ('grass', False), ('leisure', 'nature_reserve'): ('grass', False),
    ('leisure', 'playground'): ('bare', False), ('leisure', 'cemetery'): ('cemetery', True),
    ('landuse', 'retail'): ('industrial', False), ('landuse', 'railway'): ('bare', False),
    ('landuse', 'recreation_ground'): ('grass', False), ('landuse', 'village_green'): ('grass', False),
}  # fmt: skip
# Paint order: weak covers first, strong last. Second value: overrides WorldCover trees too.


def landcover(cfg, proj, nodes, ways, rels, wc_sample, raw_dem):
    lc = cfg['landcover']
    cell = lc['cell']
    X, Z = grid_coords(lc['extent'], cell)
    rows, cols = X.shape
    lat, lon = proj.inv(X, Z)
    wc = wc_sample(lat, lon)
    cover = np.full(X.shape, C['grass'], np.uint8)
    for k, v in WC_MAP.items():
        cover[wc == k] = C[v]
    wc_trees = wc == 10

    def to_px(pts):
        xy = np.array([proj.fwd(*nodes[r]) for r in pts])
        return np.round((xy - [lc['extent'][0], lc['extent'][2]]) / cell).astype(np.int32)

    polys = []
    for w in ways.values():
        if not w['closed'] or len(w['refs']) < 4:
            continue
        for (k, v), (name, strong) in OSM_COVER.items():
            if w['tags'].get(k) == v:
                polys.append((name, strong, [w['refs']]))
    for r in rels:
        for (k, v), (name, strong) in OSM_COVER.items():
            if r['tags'].get(k) == v:
                rings = [ways[m[1]]['refs'] for m in r['members'] if m[0] == 'way' and m[2] == 'outer' and m[1] in ways and ways[m[1]]['closed']]  # fmt: skip
                if rings:
                    polys.append((name, strong, rings))
    order = ['crop', 'grass', 'shrub', 'urban', 'industrial', 'bare', 'vineyard', 'orchard', 'pine', 'trees', 'cemetery', 'water']  # fmt: skip
    # OSM woods are mapped as conifer plantations by default; config landcover.osmWood = "trees" = broadleaf.
    polys = [(lc.get('osmWood', 'pine') if nm == 'pine' else nm, st, rg) for nm, st, rg in polys]
    polys.sort(key=lambda p: order.index(p[0]))
    for name, strong, rings in polys:
        m = np.zeros(X.shape, np.uint8)
        cv2.fillPoly(m, [to_px(rg) for rg in rings], 1)
        sel = m.astype(bool) if strong else (m.astype(bool) & ~wc_trees)
        cover[sel] = C[name]

    # Hand-traced cover polygons (lat / lon rings, config landcover.manualCover): land use that neither OSM nor
    # WorldCover has (e.g. orchards WorldCover reads as cropland). Painted last, they win over everything.
    for mc in lc.get('manualCover', ()):
        m = np.zeros(X.shape, np.uint8)
        xy = np.array([proj.fwd(la, lo) for la, lo in mc['ring']])
        q = np.round((xy - [lc['extent'][0], lc['extent'][2]]) / cell).astype(np.int32)
        cv2.fillPoly(m, [q], 1)
        cover[m.astype(bool)] = C[mc['cover']]

    # WorldCover tree patches that OSM doesn't name: pines on the hills, orchards in the plain,
    # broadleaf (poplar / oak / garden trees) elsewhere.
    elev = raw_dem(X, Z)
    trees = (cover == C['trees']).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(trees, connectivity=8)
    urban_near = cv2.dilate((cover == C['urban']).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    plain = np.percentile(elev, 10)
    for i in range(1, n):
        sel = lab == i
        area = stats[i, cv2.CC_STAT_AREA] * cell * cell
        if urban_near[sel].mean() > 0.4:
            continue
        if elev[sel].mean() > plain + 55:
            # Hill woods: conifer plantations by default; config landcover.highTrees = "trees" keeps broadleaf.
            cover[sel] = C[lc.get('highTrees', 'pine')]
        elif lc.get('plainOrchards', True) and area > 12000 and elev[sel].mean() < plain + 30:
            # Large lowland tree patch = orchard (farmland maps); config landcover.plainOrchards = false keeps real woods,
            # landcover.plainTreesAs = "shrub" makes them scrub (a valley of bushes with lone tall trees).
            cover[sel] = C[lc.get('plainTreesAs', 'orchard')]

    # Orchard zones (fruit + hazelnut, `hazelnut` only from manualCover) with a row direction (long side of the
    # min-area rectangle).
    zones = [{'cover': c} for c in COVERS]
    zid = cover.astype(np.int32)
    for kind in ('orchard', 'hazelnut'):
        orch = (cover == C[kind]).astype(np.uint8)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(orch, connectivity=8)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 20 or len(zones) >= 255:
                continue
            ys, xs = np.nonzero(lab == i)
            (cx, cy), (w, h), ang = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
            a = math.radians(ang if w >= h else ang + 90)
            zones.append({'cover': kind, 'angle': round(a % math.pi, 3)})
            zid[lab == i] = len(zones) - 1
    return zid.astype(np.uint8), zones, cover, wc


# --- main -----------------------------------------------------------------------------------


# Water areas that are part of a river / canal (already a carved channel from its waterway line).
RIVER_AREAS = {'river', 'stream', 'canal', 'oxbow', 'ditch', 'drain', 'stream_pool', 'rapids'}


def lake_polygons(ways, rels, nodes, proj, ext, min_area=150.0):
    """
    Standing water (natural=water: lakes, ponds, reservoirs, basins; landuse=reservoir / basin) as
    world-space polygons: closed ways and the closed outer rings of multipolygon relations. River /
    canal areas are skipped (their waterway line is the carved channel). Inner rings (islands) ignored.
    """

    def kind_of(t):
        if t.get('waterway') == 'riverbank' or t.get('water') in RIVER_AREAS:
            return None
        if t.get('natural') == 'water':
            return t.get('water') or 'lake'
        if t.get('landuse') in ('reservoir', 'basin'):
            return t['landuse']
        return None

    rings = []
    for w in ways.values():
        k = kind_of(w['tags'])
        if k and w['closed']:
            rings.append((k, w['tags'].get('name'), w['refs']))
    for rel in rels:
        k = kind_of(rel['tags'])
        if not k or rel['tags'].get('type') != 'multipolygon':
            continue
        for typ, ref, role in rel['members']:
            w = ways.get(ref)
            if typ == 'way' and role == 'outer' and w and w['closed']:
                rings.append((k, rel['tags'].get('name'), w['refs']))
    out = []
    for kind, name, refs in rings:
        pts = np.array([proj.fwd(*nodes[r]) for r in refs])
        if len(pts) < 4:
            continue
        x, z = pts[:, 0], pts[:, 1]
        area = 0.5 * abs(np.dot(x, np.roll(z, 1)) - np.dot(z, np.roll(x, 1)))
        if area < min_area or x.max() < ext[0] or x.min() > ext[1] or z.max() < ext[2] or z.min() > ext[3]:
            continue
        pts = pts[:-1] if np.allclose(pts[0], pts[-1]) else pts
        out.append({'kind': kind, **({'name': name} if name else {}), 'area': round(float(area)),
                    'pts': pts.round(1).ravel().tolist()})  # fmt: skip
    return out


def railway_lines(ways, nodes, proj, ext, pad=300.0):
    """OSM `railway=rail` ways (main lines, sidings, spurs; not tunnels) inside the baked box + `pad` m, clipped to it:
    {pts, electrified?, service?}. Rail bridges are kept as ordinary track (the game bridges small channels with the
    track bed); `service` = OSM siding / spur / yard (no catenary unless tagged electrified)."""
    out = []
    lo_x, hi_x, lo_z, hi_z = ext[0] - pad, ext[1] + pad, ext[2] - pad, ext[3] + pad
    for w in ways.values():
        t = w['tags']
        if t.get('railway') != 'rail' or t.get('tunnel') not in (None, 'no'):
            continue
        pts = np.array([proj.fwd(*nodes[r]) for r in w['refs'] if r in nodes])
        if len(pts) < 2:
            continue
        inside = (pts[:, 0] > lo_x) & (pts[:, 0] < hi_x) & (pts[:, 1] > lo_z) & (pts[:, 1] < hi_z)
        if not inside.any():
            continue
        # Keep the inside run(s) plus one point beyond each end, so the track leaves the box instead of stopping short.
        keep = inside | np.r_[inside[1:], False] | np.r_[False, inside[:-1]]
        run = []
        for k, p in zip(keep, pts):
            if k:
                run.append(p)
                continue
            if len(run) > 1:
                out.append((run, t))
            run = []
        if len(run) > 1:
            out.append((run, t))
    rows = []
    for run, t in out:
        row = {'pts': np.array(run).round(1).ravel().tolist()}
        if t.get('electrified') not in (None, 'no'):
            row['electrified'] = True
        if t.get('service'):
            row['service'] = t['service']
        rows.append(row)
    return rows


def main():
    cfg_path = sys.argv[1]
    preview = '--preview' in sys.argv
    cfg = json.load(open(cfg_path))
    proj = Proj(*cfg['origin'])
    t0 = time.time()

    # Fetch extents (lat/lon) from the world-space extents.
    def ll_box(ext, pad=0):
        la0, lo0 = proj.inv(ext[0] - pad, ext[2] - pad)
        la1, lo1 = proj.inv(ext[1] + pad, ext[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    det, out_g, lcc = cfg['detail'], cfg['outer'], cfg['landcover']
    # OSM download boxes: config "osmBoxes" (default: the land cover box). Each box is downloaded / cached on its
    # own and merged, the first box winning: a map grows by ADDING a box for the new strip, so the cached data of the
    # old area (route, roads, buildings) stays exactly as it was. Everything is then clipped to the land cover box.
    osm_boxes = cfg.get('osmBoxes', [lcc['extent']])
    print('elevation...')
    dem_cfg = cfg.get('dem')
    elev_credit = 'Elevation: AWS Terrain Tiles (Terrarium; SRTM / EU-DEM derived)'
    if dem_cfg:
        # Local GeoTIFF for everything it covers; Terrarium (coarse) only beyond its edge.
        if dem_cfg.get('source') == '3dep':
            # Bare-earth lidar DEM straight from USGS (US): box = detail grid + margin.
            loc, loc_w = usgs3dep_sampler(*ll_box(det['extent'], 120), dem_cfg.get('cell', 5))
        else:
            loc, loc_w = geotiff_sampler(os.path.join(ROOT, dem_cfg['file']), dem_cfg.get('member'))
        ter_lo = terrarium_sampler(*ll_box(out_g['extent'], 200), 12)
        elev_credit = dem_cfg.get('credit', 'Elevation: local DEM') + '; horizon: AWS Terrain Tiles (Terrarium)'

        def dem_hi(lat, lon):
            w = loc_w(lat, lon)
            assert w.min() > 0.999, 'detail grid must lie inside the local DEM'
            return loc(lat, lon)

        def dem_lo(lat, lon):
            w = loc_w(lat, lon)
            return loc(lat, lon) * w + ter_lo(lat, lon) * (1 - w)

    else:
        dem_hi = terrarium_sampler(*ll_box(det['extent'], 200), 15)
        dem_lo = terrarium_sampler(*ll_box(out_g['extent'], 200), 12)

    def raw_dem(X, Z):
        lat, lon = proj.inv(X, Z)
        return dem_hi(lat.ravel(), lon.ravel()).reshape(X.shape)

    print('osm...')
    use_overpass = cfg.get('osm', {}).get('source') == 'overpass'
    if use_overpass:
        osm = merge_osm([ovp.load_base(ll_box(b, 150), CACHE) for b in osm_boxes])
        nodes, ntags, ways, rels = osm
        print(f'  base: {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations')
    else:
        nodes, ntags, ways, rels = merge_osm([load_osm(*ll_box(b, 150)) for b in osm_boxes])
    print('worldcover...')
    wc_sample = worldcover_sampler(*ll_box(lcc['extent'], 60))

    print('landcover...')
    zid, zones, cover, wc_raw = landcover(cfg, proj, nodes, ways, rels, wc_sample, raw_dem)

    # Detail heightmap: DEM -> smooth tile seams / SRTM stair steps -> subtract canopy & roofs.
    X, Z = grid_coords(det['extent'], det['cell'])
    h = gaussian_filter(raw_dem(X, Z), 1.1)
    canopy = np.zeros(X.shape, np.float32)
    lc_x0, lc_z0 = lcc['extent'][0], lcc['extent'][2]
    ci = np.clip(((X - lc_x0) / lcc['cell']).astype(int), 0, cover.shape[1] - 1)
    cj = np.clip(((Z - lc_z0) / lcc['cell']).astype(int), 0, cover.shape[0] - 1)
    inside = (X >= lc_x0) & (X <= lcc['extent'][1]) & (Z >= lc_z0) & (Z <= lcc['extent'][3])
    cv_at = cover[cj, ci]
    for name, height in cfg['canopy'].items():
        canopy[(cv_at == C[name]) & inside] = height
    h -= gaussian_filter(canopy, 2.0)

    # Outer horizon grid (coarse) - blended with the detail grid at runtime.
    XO, ZO = grid_coords(out_g['extent'], out_g['cell'])
    lat, lon = proj.inv(XO, ZO)
    ho = gaussian_filter(dem_lo(lat.ravel(), lon.ravel()).reshape(XO.shape), 0.8)

    base, step = cfg['heightBase'], 0.05
    enc = lambda a: np.clip(np.round((a - base) / step), -32768, 32767)  # noqa: E731

    print('route...')
    raw, route_ids = route_through(cfg['waypoints'], nodes, ways, proj, cfg.get('extraWays', ()), opts=cfg.get('route'))
    report_route(route_ids, ways)
    cps, smooth = control_points(raw, cfg["routeSmoothSigma"], cfg["routeTolerance"], cfg.get("minCornerRadius", 12))
    length = float(np.sum(np.linalg.norm(np.diff(smooth, axis=0), axis=1)))
    sp = np.linalg.norm(np.diff(cps, axis=0), axis=1)
    print(f'  route {length:.0f} m, {len(cps)} control points (spacing {sp.min():.0f}..{sp.max():.0f} m)')
    spans = route_spans(route_ids, raw, ways, smooth)
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(smooth, axis=0), axis=1))])
    print('  stage road on bridges / under structures: ' + ', '.join(f'{sp["kind"]} {sp["from"]}-{sp["to"]} m' for sp in spans))
    # Self-proximity check (terrain carving blends to the nearest road part).
    s5 = smooth[::5]
    kd = cKDTree(s5)
    worst = 1e9
    for i, p in enumerate(s5):
        for j in kd.query_ball_point(p, 60):
            if abs(i - j) * 5 > 200:
                worst = min(worst, float(np.linalg.norm(s5[j] - p)))
    print(f'  closest approach of non-adjacent road parts: {worst if worst < 1e9 else ">60"} m')

    # Other paths (not the stage road).
    route_kd = cKDTree(smooth)
    widths = {
        'motorway': 11, 'motorway_link': 6, 'trunk': 9, 'primary': 8, 'secondary': 7, 'tertiary': 6,
        'unclassified': 5.5, 'residential': 5, 'living_street': 4.5, 'service': 4, 'track': 3,
        'path': 1.4, 'footway': 1.6, 'pedestrian': 4, 'cycleway': 2.5,
    }  # fmt: skip
    paved = {'asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'concrete:plates'}
    ext = lcc['extent']
    paths = []
    # A side road really meets the stage road where it shares an OSM node with it. Roads that only pass
    # over / under (bridge, no shared node) don't. Traced parts of the route (extraWays) have no OSM nodes,
    # so there any road reaching the line counts.
    route_nodes = set(route_ids)
    # Segments of the stage route (both directions): a way the route follows for a stretch keeps the rest.
    route_segs = {(a, b) for a, b in zip(route_ids, route_ids[1:])} | {(b, a) for a, b in zip(route_ids, route_ids[1:])}
    traced = np.array([proj.fwd(la, lo) for w in cfg.get('extraWays', ()) for la, lo in w['pts']]).reshape(-1, 2)
    traced_kd = cKDTree(resample(traced, 5.0)) if len(traced) > 1 else None
    no_junction = 0
    pcfg = cfg.get('paths', {})
    stage_hw = cfg.get('route', {}).get('width', 7.4) / 2
    corridor = pcfg.get('corridor')  # keep other roads only this close to the stage road (m); None = all
    hw_corridor = pcfg.get('highwayCorridor', corridor)  # same for motorway / trunk (+ links)
    big_kinds = ('motorway', 'motorway_link', 'trunk', 'trunk_link')
    def add_way(t, refs, pts=None, detected=False, branch=False):
        """One road / water way -> runs of `paths` (cut short of the stage road unless grade-separated)."""
        # A way folding back on itself (a V drawn as one way, > HAIRPIN deg at a node) or coming back to one of its own
        # nodes (a "P": a street looping round a block back onto itself): split there into ways meeting at that node,
        # each with its own surface - one ribbon passing a spot twice is two heights in one place.
        if pts is None and len(refs) > 2:
            xy = np.array([proj.fwd(*nodes[r]) for r in refs])
            a, b = xy[1:-1] - xy[:-2], xy[2:] - xy[1:-1]
            na, nb = np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=1)
            cos = (a * b).sum(1) / np.maximum(na * nb, 1e-9)
            folds = {int(k) + 1 for k in np.nonzero((cos < math.cos(math.radians(HAIRPIN))) & (na > 1e-6) & (nb > 1e-6))[0]}
            seen = {}
            for k, r in enumerate(refs):
                if r in seen and not (seen[r] == 0 and k == len(refs) - 1):  # a closed ring is fine
                    folds |= {seen[r], k}
                seen.setdefault(r, k)
            folds = sorted(k for k in folds if 0 < k < len(refs) - 1)
            if folds:
                for s, e in zip([0] + folds, folds + [len(refs) - 1]):
                    add_way(t, refs[s : e + 1], detected=detected, branch=branch)
                return
        hw, ww = t.get('highway'), t.get('waterway')
        is_tunnel = t.get('tunnel') in ('yes', 'building_passage', 'culvert') and ww is None
        if is_tunnel and hw not in big_kinds + ('primary', 'secondary'):
            return  # underground: nothing to draw on the surface
        if hw in widths:
            kind = hw
            width = float(t.get('width', widths[hw]).split()[0]) if t.get('width', '').replace('.', '').isdigit() else widths[hw]  # fmt: skip
            if hw in big_kinds + ('primary',) and t.get('lanes', '').isdigit() and 'width' not in t:
                # Carriageway: lanes + edge strips (parkway lanes are narrow: 3.3 m).
                width = int(t['lanes']) * (3.3 if hw in big_kinds else 3.5) + (0.8 if hw in big_kinds else 1.0)
            surf = t.get('surface')
            asphalt = surf in paved if surf else hw not in ('track', 'path', 'footway')
            surface = 'tarmac' if asphalt else 'dirt'
        elif ww in ('canal', 'drain', 'ditch', 'stream', 'river', 'brook'):
            kind = ww
            width = {'canal': 7, 'drain': 5, 'ditch': 2.5, 'stream': 3, 'river': 12, 'brook': 1}[ww]
            surface = 'water'
        else:
            return
        if pts is None:
            pts = np.array([proj.fwd(*nodes[r]) for r in refs])
        if len(pts) < 2:
            return
        if surface != 'water' and not branch and sum(r in route_nodes for r in refs) >= 2:
            # The route follows this way for a stretch: only that stretch is the stage road. The parts before / after
            # it are kept as roads of their own ("branches"), ending short of the stage road WITHOUT a junction (no
            # mouth / barrier added to a finished stage) - except near the start / finish (start row, hilltop).
            if any((a, b) in route_segs for a, b in zip(refs, refs[1:])):
                run = [refs[0]]
                runs = []
                for a, b in zip(refs, refs[1:]):
                    if (a, b) in route_segs:
                        if len(run) > 1:
                            runs.append(run)
                        run = [b]
                    else:
                        run.append(b)
                if len(run) > 1:
                    runs.append(run)
                for r in runs:
                    rp = np.array([proj.fwd(*nodes[x]) for x in r])
                    dd, ii = route_kd.query(rp)
                    at = float(acc[ii[dd.argmin()]])
                    if min(at, acc[-1] - at) > 60:
                        add_way(t, r, branch=True)
            return  # a piece of the stage road itself (the route follows it)
        pts = resample(pts, 4.0)
        d, ri = route_kd.query(pts)
        # Beside the stage road and parallel to it all along (the sunken service lanes of a parkway, e.g. the inner
        # Union Turnpike beside the Jackie): kept whole like a carriageway, never cut short as a side road.
        beside = False
        if surface != 'water' and len(pts) > 2 and np.percentile(d, 90) < 30:
            rt = smooth[np.minimum(ri + 1, len(smooth) - 1)] - smooth[np.maximum(ri - 1, 0)]
            wt = np.gradient(pts, axis=0)
            cos = np.abs((rt * wt).sum(1)) / (np.linalg.norm(rt, axis=1) * np.linalg.norm(wt, axis=1) + 1e-9)
            beside = float(np.mean(cos > 0.95)) > 0.8 and float(np.percentile(d, 10)) > stage_hw + 0.5
        if is_tunnel and (np.percentile(d, 10) > 40 or (hw not in big_kinds and not beside)):
            return  # a tunnel away from the stage road (or a street crossing under it)
        # The stage road runs through its own tunnels as an `under` span (portal structure); the other carriageway
        # of the divided highway beside it is kept as an ordinary path in that trench, else it ends at the portal.
        is_deck = t.get('bridge') not in (None, 'no')
        # Within reach of the stage road. Divided highway: the opposite carriageway runs close beside it.
        near = d <= (width / 2 + 2 if kind in big_kinds else width / 2 + 5)
        mainline = kind in ('motorway', 'trunk')
        if mainline and np.percentile(d, 10) < 40:
            # The other carriageway of the divided highway: never wider than the room beside the stage road
            # (its ribbon would run under our lanes and the median barrier).
            room = 2 * (float(np.percentile(d, 10)) - stage_hw - 0.9)
            width = min(width, max(6.0, room))
        # Cut by the stage road without being connected to it: grade-separated, not a junction.
        # A detected road (msRoads) has no OSM nodes: reaching the stage road is a junction, like a traced part.
        # A branch (rest of a way the route follows) is never a junction: it stays clear of the finished stage.
        joins = not branch and (detected or any(r in route_nodes for r in refs) or (
            traced_kd is not None and traced_kd.query(pts[near])[0].min(initial=1e9) < 30
        ))
        flag = surface != 'water' and near.any() and not joins
        nonlocal no_junction
        no_junction += flag
        # Every other road is cut short of the stage road (the game joins it to it) - except bridge decks
        # (an overpass spans the stage road) and streets under a stage-road bridge: they run across it.
        under_bridge = np.zeros(len(pts), bool)
        for sp in spans:
            if sp['kind'] == 'bridge':
                under_bridge |= (acc[ri] >= sp['from'] - 4) & (acc[ri] <= sp['to'] + 4)
        # Mainline carriageways beside the stage road are kept whole (only pieces ON the route are cut).
        cut = (d <= 2.5) if mainline or beside else near
        cutoff = cut & ~under_bridge if not is_deck else np.zeros(len(pts), bool)
        keep = ~cutoff | (surface == 'water')
        lim = hw_corridor if kind in big_kinds else corridor
        if lim is not None and surface != 'water':
            keep &= d <= lim
        keep &= (pts[:, 0] > ext[0] - 300) & (pts[:, 0] < ext[1] + 300) & (pts[:, 1] > ext[2] - 300) & (pts[:, 1] < ext[3] + 300)  # fmt: skip
        extra = {}
        if t.get('bridge') not in (None, 'no'):
            extra['bridge'] = True
        if t.get('layer', '').lstrip('-').isdigit() and int(t['layer']) != 0 and not is_tunnel:
            extra['layer'] = int(t['layer'])  # a kept tunnel carriageway lies on the ground (layer -1 would sink it)
        if t.get('oneway') == 'yes':
            extra['oneway'] = True
        if t.get('lanes', '').isdigit():
            extra['lanes'] = int(t['lanes'])
        if t.get('name') and kind in big_kinds + ('primary', 'secondary'):
            extra['name'] = t['name']
        # Split into runs of kept points.
        run = []
        for k, p in zip(keep, pts):
            if k:
                run.append(p)
            elif len(run) > 1:
                paths.append((kind, width, surface, np.array(run), flag, extra))
                run = []
            else:
                run = []
        if len(run) > 1:
            paths.append((kind, width, surface, np.array(run), flag, extra))
    for w in ways.values():
        add_way(w['tags'], w['refs'])
    # Roads OSM lacks (Microsoft ML Road Detections): untagged, so treated as dirt tracks.
    ms_cfg = cfg.get('msRoads')
    ms_runs = []
    if ms_cfg:
        lines = [np.array([proj.fwd(la, lo) for lo, la in c]) for c in msroads.load(ms_cfg['country'], CACHE, fetch, ll_box(ext, 300))]
        # Railways count as known too: the imagery detections often trace a track bed as a "road".
        rails_known = [np.array(r['pts']).reshape(-1, 2) for r in railway_lines(ways, nodes, proj, ext)]
        known = [p for _, _, s, p, _, _ in paths if s != 'water'] + [smooth] + rails_known
        ms_runs = msroads.missing_roads(lines, known, resample, ms_cfg.get('clearance', 15.0), ms_cfg.get('minLength', 40.0))
        # Optional "stageClearance" (m): cut detections back from the stage road - no new junctions on a finished stage.
        if ms_cfg.get('stageClearance'):
            keep_d, trimmed = ms_cfg['stageClearance'], []
            for run in ms_runs:
                far = route_kd.query(run)[0] > keep_d
                i = 0
                while i < len(run):
                    if not far[i]:
                        i += 1
                        continue
                    j = i
                    while j + 1 < len(run) and far[j + 1]:
                        j += 1
                    piece = run[i : j + 1]
                    if len(piece) > 1 and np.linalg.norm(np.diff(piece, axis=0), axis=1).sum() >= ms_cfg.get('minLength', 40.0):
                        trimmed.append(piece)
                    i = j + 1
            ms_runs = trimmed
        for run in ms_runs:
            add_way({'highway': 'track'}, (), run, detected=True)
        print(f'  msRoads: {len(lines)} detections, {len(ms_runs)} roads OSM lacks ({sum(float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum()) for r in ms_runs) / 1000:.1f} km)')
    # Water ways OSM lacks (config "waterways", e.g. from dem_stream.py): added last, so the other paths keep their index.
    for w in cfg.get('waterways', ()):
        add_way({'waterway': w.get('kind', 'stream')}, (), np.array([proj.fwd(la, lo) for la, lo in w['pts']]))
    print(f'  {no_junction} way(s) pass the stage road without a junction (bridge / not connected)')

    def simplify(p, tol=0.4):
        approx = cv2.approxPolyDP(np.round(p * 10).astype(np.int32).reshape(-1, 1, 2), tol * 10, False)
        return (approx.reshape(-1, 2) / 10).round(1)

    path_json = [
        {'kind': k, 'width': w, 'surface': s, 'pts': simplify(p).ravel().tolist(), **({'junction': False} if nj else {}), **ex}
        for k, w, s, p, nj, ex in paths
    ]
    print(f'  {len(path_json)} paths ({sum(1 for q in path_json if q.get("bridge"))} on bridges)')
    if 'streets' in cfg:  # city street model of the END BOX (real widths, lanes, sidewalks, paving): streets.py
        import streets

        streets.apply(path_json, proj, (nodes, ntags, ways), cfg['streets'])
    paths = [q[:4] for q in paths]

    print('buildings...')
    lc_ext = lcc['extent']
    if use_overpass:
        # Only a corridor around the stage road is modelled (a city has ~90 000 buildings in the box).
        r_corr = cfg.get('buildings', {}).get('corridor', 220)
        rl = [proj.inv(*p) for p in smooth[::40]] + [proj.inv(*smooth[-1])]
        ovp.merge((nodes, ntags, ways, rels), ovp.load_buildings(rl, r_corr, CACHE))
        print(f'  + buildings within {r_corr} m of the route: {sum(1 for w in ways.values() if "building" in w["tags"])} ways')

    def cover_at(x, z):
        i = int((x - lc_ext[0]) / lcc['cell'])
        j = int((z - lc_ext[2]) / lcc['cell'])
        if 0 <= i < cover.shape[1] and 0 <= j < cover.shape[0]:
            return COVERS[cover[j, i]]
        return None

    buildings = bld.build(
        cfg, proj, nodes, ways, ll_box, ext, fetch, CACHE, smooth, paths, cover_at,
        os.path.dirname(os.path.join(ROOT, cfg['out'])),
        built=((wc_raw == 50)[::2, ::2], lc_ext[0], lc_ext[2], lcc['cell'] * 2),
    )  # fmt: skip
    # ODbL attribution for the Microsoft footprints, only when the map actually uses some.
    src_col, ms_src = bld.FIELDS.index('src'), bld.SOURCES.index('ms')
    ms_credit = (
        ['Building footprints where OSM has none: Microsoft Global ML Building Footprints (ODbL)']
        if any(r[src_col] == ms_src for r in buildings['rows'])
        else []
    )

    lakes =lake_polygons(ways, rels, nodes, proj, ext)
    print(f'  {len(lakes)} lake(s) / pond(s) / reservoir(s)')

    pylons = [
        [round(v, 1) for v in proj.fwd(*nodes[k])]
        for k, t in ntags.items()
        if t.get('power') in ('tower', 'pole')
    ]
    pylons = [p for p in pylons if ext[0] - 300 < p[0] < ext[1] + 300 and ext[2] - 300 < p[1] < ext[3] + 300]
    lines = []
    for w in ways.values():
        if w['tags'].get('power') in ('line', 'minor_line'):
            lines.append(np.array([proj.fwd(*nodes[r]) for r in w['refs']]).round(1).ravel().tolist())
    railways = railway_lines(ways, nodes, proj, ext)
    # Config "railways.drop": [{"service": [...], "box": [x0, x1, z0, z1]}] - leave out tracks of those services lying
    # wholly inside the box (e.g. the spur fan of a freight yard: the track bed cannot level a yard of parallel tracks).
    for rule in cfg.get('railways', {}).get('drop', []):
        x0, x1, z0, z1 = rule['box']
        inside = lambda r: all(x0 <= x <= x1 and z0 <= z <= z1 for x, z in zip(r['pts'][0::2], r['pts'][1::2]))  # noqa: E731
        before = len(railways)
        railways = [r for r in railways if not (r.get('service', 'main') in rule['service'] and inside(r))]
        print(f'  railways.drop {rule["service"]} in {rule["box"]}: {before - len(railways)} left out')
    print(f'  {len(railways)} railway way(s), {sum(1 for r in railways if r.get("electrified"))} electrified')

    data = {
        'meta': {
            'name': cfg['name'],
            'origin': cfg['origin'],
            'generated': time.strftime('%Y-%m-%d'),
            'sources': [
                elev_credit,
                'Land cover: ESA WorldCover 10 m 2021 v200 (CC BY 4.0)',
                'Roads, railways, land use, buildings, power: (c) OpenStreetMap contributors (ODbL)',
            ]
            + ms_credit
            + ([msroads.CREDIT] if ms_runs else []),
            'axes': '+X east, +Z south (north = -Z), metres from origin',
            'routeLength': round(length, 1),
        },
        'heightmap': {
            'base': base,
            'step': step,
            'grids': [
                {'originX': det['extent'][0], 'originZ': det['extent'][2], 'cell': det['cell'],
                 'cols': X.shape[1], 'rows': X.shape[0], 'data': b64_int16(enc(h))},
                {'originX': out_g['extent'][0], 'originZ': out_g['extent'][2], 'cell': out_g['cell'],
                 'cols': XO.shape[1], 'rows': XO.shape[0], 'data': b64_int16(enc(ho))},
            ],
        },  # fmt: skip
        'landcover': {
            'originX': ext[0], 'originZ': ext[2], 'cell': lcc['cell'],
            'cols': zid.shape[1], 'rows': zid.shape[0], 'rle': rle_b64(zid), 'zones': zones,
        },  # fmt: skip
        'route': cps.round(1).tolist(),
        'routeSpans': spans,
        'paths': path_json,
        'buildings': buildings,
        'lakes': lakes,
        'pylons': pylons,
        'powerLines': lines,
        'railways': railways,
    }
    out = os.path.join(ROOT, cfg['out'])
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    # route.json (next to data.json): the small part that is loaded eagerly (meta, route, railways) - menus' route outline
    # (maps/<id>/info.ts) and the hand-modelled landmarks (world/landmarks.ts); data.json is a lazy chunk
    with open(os.path.join(os.path.dirname(out), 'route.json'), 'w') as f:
        json.dump({k: data[k] for k in ('meta', 'route', 'railways') if k in data}, f, separators=(',', ':'))
    print(f'wrote {os.path.relpath(out, ROOT) if os.path.splitdrive(out)[0] == os.path.splitdrive(ROOT)[0] else out} ({os.path.getsize(out) / 1024:.0f} KB) in {time.time() - t0:.1f} s')
    print(f'  {len(path_json)} paths, {len(buildings["rows"])} buildings, {len(pylons)} pylons, {len(zones)} zones')

    if preview:
        pv = os.path.join(CACHE, f'{cfg["id"]}_preview.png')
        pal = np.array(
            [[200, 190, 110], [170, 120, 90], [120, 140, 60], [20, 70, 30], [50, 110, 40], [90, 160, 60],
             [210, 120, 110], [160, 140, 190], [220, 210, 190], [40, 90, 200], [150, 60, 150], [100, 100, 100]],
            np.uint8,
        )  # fmt: skip
        img = pal[cover].copy()  # row 0 = min z = north: north up
        for k, w, s, p in paths:
            q = ((p - [ext[0], ext[2]]) / lcc['cell']).astype(np.int32)
            cv2.polylines(img, [q], False, (255, 255, 255) if s != 'water' else (0, 0, 255), 1)
        q = ((smooth - [ext[0], ext[2]]) / lcc['cell']).astype(np.int32)
        cv2.polylines(img, [q], False, (0, 0, 0), 2)
        Image.fromarray(img).save(pv)
        print('preview', pv)


if __name__ == '__main__':
    main()
