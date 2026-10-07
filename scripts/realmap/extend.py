"""
Extension ring around an already baked real map: terrain heights + water only (no roads, buildings, land cover).

    python scripts/realmap/extend.py scripts/realmap/jackie.json

Config block (the map's bake config):

    "extend": { "cell": 10, "extent": [x0, x1, z0, z1] }

Edits the map's data.json in place, leaving everything the full bake made untouched (route, paths, buildings, lakes,
the detail grid, the land cover cells - the stage keeps its exact heights):
  - heightmap  a second fine grid over `extent` (same DEM as the bake: config "dem" or Terrarium), inserted between
               the detail grid and the 50 m outer grid; the game blends it in where the detail grid ends
  - paths      OSM water ways (canal / drain / ditch / stream / river / brook) in the ring, i.e. outside the bake's
               land cover box + 300 m (where the bake clipped them); appended, so existing path indices stay
  - lakes      OSM standing water lying wholly outside the land cover box (the bake kept the ones touching it)

  - landcover  the raster grown to `extent`: ring cells from WorldCover as `paved` (built-up) / `open` / `water` -
               cover names no scatter rule uses, so nothing is placed there; the map's `splat` gives them their colour

Re-running replaces what an earlier run added (`meta.extend` records it).
"""

import base64
import json
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass as ovp  # noqa: E402
from bake import (  # noqa: E402
    CACHE,
    ROOT,
    Proj,
    b64_int16,
    grid_coords,
    lake_polygons,
    load_osm,
    resample,
    rle_b64,
    terrarium_sampler,
    usgs3dep_sampler,
    worldcover_sampler,
)

WATER_WIDTH = {'canal': 7, 'drain': 5, 'ditch': 2.5, 'stream': 3, 'river': 12, 'brook': 1}
# Not lakes: treatment plant tanks.
SKIP_LAKES = {'wastewater'}
# Ring land cover: own cover names (no scatter rule uses them, so nothing grows there); the map's `splat` paints them.
RING_COVER = {50: 'paved'}  # WorldCover built-up; water (80) = the map's 'water' zone, the rest 'open'
# The bake keeps paths up to this far outside its land cover box.
CLIP = 300
GAP = 12
# ...and ends this far short of a new lake's shore (its banks clear of the lake basin).
SHORE_GAP = 8


def main():
    cfg = json.load(open(sys.argv[1]))
    ex = cfg['extend']
    ext, cell = ex['extent'], ex.get('cell', 10)
    proj = Proj(*cfg['origin'])
    out = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out))
    meta = data['meta']
    prev = meta.get('extend')
    if prev:  # drop what the previous run added
        data['heightmap']['grids'].pop(1)
        data['paths'] = data['paths'][: prev['paths']]
        for i, pts in prev.get('trimmed', {}).items():
            data['paths'][int(i)]['pts'] = pts
        data['lakes'] = data['lakes'][: prev['lakes']]
        if 'landcover' in prev:
            data['landcover'] = crop_landcover(data['landcover'], prev['landcover'])

    def ll_box(e, pad=0):
        la0, lo0 = proj.inv(e[0] - pad, e[2] - pad)
        la1, lo1 = proj.inv(e[1] + pad, e[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    print('elevation...')
    X, Z = grid_coords(ext, cell)
    lat, lon = proj.inv(X, Z)
    dem_cfg = cfg.get('dem') or {}
    if dem_cfg.get('source') == '3dep':
        dem, _ = usgs3dep_sampler(*ll_box(ext, 120), dem_cfg.get('cell', 5))
    elif dem_cfg:
        sys.exit('extend.py: a local GeoTIFF "dem" is not supported yet (use 3dep or Terrarium)')
    else:
        dem = terrarium_sampler(*ll_box(ext, 200), 15)
    h = gaussian_filter(dem(lat.ravel(), lon.ravel()).reshape(X.shape), 1.1)
    hm = data['heightmap']
    enc = np.clip(np.round((h - hm['base']) / hm['step']), -32768, 32767)
    grid = {'originX': ext[0], 'originZ': ext[2], 'cell': cell, 'cols': X.shape[1], 'rows': X.shape[0], 'data': b64_int16(enc)}
    hm['grids'].insert(1, grid)
    print(f'  grid {cell} m: {X.shape[1]} x {X.shape[0]}, {h.min():.1f}..{h.max():.1f} m')

    print('osm water...')
    box = ll_box(ext, 150)
    if cfg.get('osm', {}).get('source') == 'overpass':
        nodes, _, ways, rels = ovp.load_water(box, CACHE)
    else:
        nodes, _, ways, rels = load_osm(*box)
    lc = data['landcover']
    old = [lc['originX'], lc['originX'] + lc['cols'] * lc['cell'], lc['originZ'], lc['originZ'] + lc['rows'] * lc['cell']]

    def inside(p, e, pad):
        return (p[:, 0] > e[0] - pad) & (p[:, 0] < e[1] + pad) & (p[:, 1] > e[2] - pad) & (p[:, 1] < e[3] + pad)

    def overlaps(p, e):  # bounding box test, as the bake's lake_polygons
        return not (p[:, 0].max() < e[0] or p[:, 0].min() > e[1] or p[:, 1].max() < e[2] or p[:, 1].min() > e[3])

    paths = []

    def add_run(run, ww):
        q = cv2.approxPolyDP(np.round(np.array(run) * 10).astype(np.int32).reshape(-1, 1, 2), 4, False)
        paths.append({'kind': ww, 'width': WATER_WIDTH[ww], 'surface': 'water', 'pts': (q.reshape(-1, 2) / 10).round(1).ravel().tolist()})

    for w in ways.values():
        ww = w['tags'].get('waterway')
        if ww not in WATER_WIDTH:
            continue
        pts = np.array([proj.fwd(*nodes[r]) for r in w['refs']])
        if len(pts) < 2:
            continue
        pts = resample(pts, 4.0)
        # Start GAP m past where the bake cut the way: touching its baked piece would make the two a confluence (the
        # baked channel's water lowered to the new one's, tests/rally/water.test.ts) - the stage data stays as baked.
        keep = inside(pts, ext, 0) & ~inside(pts, old, CLIP + GAP)
        run = []
        for k, p in zip(list(keep) + [False], list(pts) + [None]):
            if k:
                run.append(p)
                continue
            if len(run) > 1:
                add_run(run, ww)
            run = []
    lakes = [
        lk
        for lk in lake_polygons(ways, rels, nodes, proj, ext, min_area=250.0)
        if lk['kind'] not in SKIP_LAKES
        and not overlaps(np.array(lk['pts']).reshape(-1, 2), old) and inside(np.array(lk['pts']).reshape(-1, 2), ext, 0).all()
    ]
    # Lake surface from the DEM inside the outline (lidar is flat on water): the game's default, the median shore
    # height, stands a lake between highway embankments metres too high.
    for lk in lakes:
        poly = np.array(lk['pts']).reshape(-1, 2)
        x0, z0 = poly.min(0)
        x1, z1 = poly.max(0)
        X, Z = grid_coords([x0, x1, z0, z1], 5)
        la, lo = proj.inv(X, Z)
        mask = np.zeros(X.shape, np.uint8)
        cv2.fillPoly(mask, [np.round((poly - [x0, z0]) / 5).astype(np.int32)], 1)
        cv2.erode(mask, np.ones((5, 5), np.uint8), dst=mask)  # off the shore
        hs = dem(la[mask > 0], lo[mask > 0])
        if len(hs):
            lk['level'] = round(float(np.median(hs)), 2)
    meta['extend'] = {'extent': ext, 'cell': cell, 'paths': len(data['paths']), 'lakes': len(data['lakes'])}
    # A water way running through a new lake ends at its shore (SHORE_GAP) (the lake is that water): also baked ones (OSM draws a
    # creek through the lake it feeds). A baked path keeps its index with its longest piece; the original is kept in
    # `meta.extend.trimmed` for a re-run.
    polys = [cv2.UMat(np.array(lk['pts'], np.float32).reshape(-1, 1, 2)).get() for lk in lakes]
    trimmed = {}

    def wet(pt):
        return any(cv2.pointPolygonTest(pg, (float(pt[0]), float(pt[1])), True) >= -SHORE_GAP for pg in polys)

    def pieces(flat):
        pts = resample(np.array(flat).reshape(-1, 2), 4.0)
        out, run = [], []
        for pt in pts:
            if wet(pt):
                if len(run) > 1:
                    out.append(run)
                run = []
            else:
                run.append(pt)
        if len(run) > 1:
            out.append(run)
        return out

    def simplified(run):
        q = cv2.approxPolyDP(np.round(np.array(run) * 10).astype(np.int32).reshape(-1, 1, 2), 4, False)
        return (q.reshape(-1, 2) / 10).round(1).ravel().tolist()

    for i, p in enumerate(data['paths']):
        if p['surface'] != 'water' or not any(wet(pt) for pt in np.array(p['pts']).reshape(-1, 2)):
            continue
        runs = sorted(pieces(p['pts']), key=len, reverse=True)
        trimmed[str(i)] = p['pts']
        p['pts'] = simplified(runs[0]) if runs else p['pts'][:4]
        paths += [{**p, 'pts': simplified(r)} for r in runs[1:]]
    kept = []
    for p in paths:
        if not any(wet(pt) for pt in np.array(p['pts']).reshape(-1, 2)):
            kept.append(p)
            continue
        kept += [{**p, 'pts': simplified(r)} for r in pieces(p['pts'])]
    paths = kept
    meta['extend']['trimmed'] = trimmed
    data['paths'] += paths
    data['lakes'] += lakes
    print(f'  + {len(paths)} water way(s), {len(lakes)} lake(s): '
          + ', '.join(lk.get('name', lk['kind']) for lk in lakes))  # fmt: skip

    print('land cover...')
    meta['extend']['landcover'] = {**{k: lc[k] for k in ('originX', 'originZ', 'cols', 'rows')}, 'zones': len(lc['zones'])}
    data['landcover'] = grow_landcover(lc, ext, worldcover_sampler(*ll_box(ext, 60)), proj)
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {os.path.relpath(out, ROOT)} ({os.path.getsize(out) / 1024:.0f} KB)')


def rle_decode(b64, n):
    b, out, p, o = base64.b64decode(b64), np.zeros(n, np.uint8), 0, 0
    while p < len(b) and o < n:
        v, ln, sh = b[p], 0, 0
        p += 1
        while True:
            c = b[p]
            p += 1
            ln |= (c & 0x7F) << sh
            sh += 7
            if not c & 0x80:
                break
        out[o : o + ln] = v
        o += ln
    return out


def grow_landcover(lc, ext, wc, proj):
    """The bake's land cover raster grown to `ext`: old cells kept, the ring from WorldCover (RING_COVER / 'open')."""
    cell = lc['cell']
    zones = list(lc['zones'])
    zid = {name: len(zones) + k for k, name in enumerate(sorted(set(RING_COVER.values())) + ['open'])}
    zones += [{'cover': name} for name in zid]
    water = next(i for i, z in enumerate(zones) if z['cover'] == 'water')
    X, Z = grid_coords([ext[0] + cell / 2, ext[1] - cell / 2, ext[2] + cell / 2, ext[3] - cell / 2], cell)
    lat, lon = proj.inv(X, Z)
    cls = wc(lat.ravel(), lon.ravel()).reshape(X.shape)
    a = np.full(X.shape, zid['open'], np.uint8)
    for c, name in RING_COVER.items():
        a[cls == c] = zid[name]
    a[cls == 80] = water
    i0, j0 = round((lc['originX'] - ext[0]) / cell), round((lc['originZ'] - ext[2]) / cell)
    a[j0 : j0 + lc['rows'], i0 : i0 + lc['cols']] = rle_decode(lc['rle'], lc['cols'] * lc['rows']).reshape(lc['rows'], lc['cols'])
    print(f'  {a.shape[1]} x {a.shape[0]} cells: ' + ', '.join(f'{n} {np.mean(a == i) * 100:.0f}%' for n, i in zid.items()))
    return {'originX': ext[0], 'originZ': ext[2], 'cell': cell, 'cols': a.shape[1], 'rows': a.shape[0], 'rle': rle_b64(a), 'zones': zones}


def crop_landcover(lc, old):
    """Undo grow_landcover: the bake's raster back out of the grown one."""
    a = rle_decode(lc['rle'], lc['cols'] * lc['rows']).reshape(lc['rows'], lc['cols'])
    i0, j0 = round((old['originX'] - lc['originX']) / lc['cell']), round((old['originZ'] - lc['originZ']) / lc['cell'])
    a = a[j0 : j0 + old['rows'], i0 : i0 + old['cols']]
    keep = {k: old[k] for k in ('originX', 'originZ', 'cols', 'rows')}
    return {**keep, 'cell': lc['cell'], 'rle': rle_b64(a), 'zones': lc['zones'][: old['zones']]}


if __name__ == '__main__':
    main()
