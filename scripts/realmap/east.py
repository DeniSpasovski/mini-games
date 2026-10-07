"""Grow a baked real map to the east with the full bake's data (roads, land cover, 10 m terrain) - the Jackie interchange.

    python scripts/realmap/east.py scripts/realmap/jackie.json

Config block (the map's bake config):

    "east": { "landcoverX1": 4500, "grid": [3500, 4700, -2700, -500], "pathsBox": [3300, 4500, -2500, -700], "highwayCorridor": 2200,
             "corridor": 1700, "streetsNearHighway": 350, "grassAlongHighways": { "fromX": 2950, "reach": 26 } }

Order for a map that has all of them:  bake.py -> extend.py -> east.py -> streets.py.  (extend.py drops what east.py added.)

What it does: runs `bake.py` once into a scratch folder (`scripts/realmap/.cache/east/`) with the land cover / detail box
grown to `landcoverX1` and a second OSM box for the new strip (the old box is cached, so the route and the old area stay
exactly as they were), then edits the map's data.json in place and leaves everything the first bake made untouched:
  - heightmap  a 10 m grid over `grid` (x0, x1, z0, z1), tagged "east", inserted right after the detail grid: the game blends
               the detail grid into it where it ends (the same DEM, so the heights agree)
  - landcover  the cells east of the old land cover box (`landcover` extent of the config minus the grown part) take the
               bake's classes (trees, grass, urban ...) instead of the ring's `paved` / `open`
  - paths      tarmac / dirt ways of the new bake inside `pathsBox` (x0, x1, z0, z1) that the old data does not have (the old bake cut roads
               at its 900 m corridor and its box edge): appended, trimmed to the part not covered by an old path. Streets only
               within `streetsNearHighway` m of a motorway / link path (the interchange and the streets it serves). Water ways
               stay as extend.py made them. Existing path indices stay.
  - grass      `grassAlongHighways`: built-up / paved / open cells within `reach` m of a motorway or ramp east of `fromX` become
               grass (WorldCover calls the roads built-up, so the verges and embankments read as pavement)
Buildings, lakes, pylons, railways, the route and its spans are NOT touched. Re-running replaces an earlier run (`meta.east`).
"""

import base64
import json
import os
import subprocess
import sys

import cv2
import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import CACHE, ROOT, b64_int16, resample, rle_b64  # noqa: E402
from extend import rle_decode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.join(CACHE, 'east')
COVER_TOL = 2.5  # m: a new path closer than this to an old one is the same road
MIN_RUN = 8.0  # m: a shorter leftover next to an old path's cut end is a sliver and dropped
MIN_WAY = 1.5  # m: ... but a short way of its own (a connector between a bridge end and a junction) is kept
STEP = 2.0


def scratch_config(cfg):
    e = cfg['east']
    old = cfg['landcover']['extent']
    c = json.loads(json.dumps(cfg))
    c['out'] = os.path.join(SCRATCH, 'data.json')
    for k in ('streets', 'extend'):
        c.pop(k, None)
    c['detail']['extent'] = [c['detail']['extent'][0], max(c['detail']['extent'][1], e['grid'][1] + 100), c['detail']['extent'][2], c['detail']['extent'][3]]
    c['landcover']['extent'] = [old[0], e['landcoverX1'], old[2], old[3]]
    c['osmBoxes'] = [old, [old[1], e['landcoverX1'], old[2], old[3]]]
    c['paths'] = {**c.get('paths', {}), 'highwayCorridor': e.get('highwayCorridor', 2200), 'corridor': e.get('corridor', 350)}
    return c


def dec16(g):
    return np.frombuffer(base64.b64decode(g['data']), dtype='<i2').reshape(g['rows'], g['cols'])


def zone_key(z):
    return (z['cover'], z.get('angle'))


def main():
    cfg_path = sys.argv[1]
    cfg = json.load(open(cfg_path))
    e = cfg['east']
    out = os.path.join(ROOT, cfg['out'])
    os.makedirs(SCRATCH, exist_ok=True)
    sc_path = os.path.join(SCRATCH, 'config.json')
    json.dump(scratch_config(cfg), open(sc_path, 'w'), indent=1)
    if '--no-bake' not in sys.argv:
        print('scratch bake (widened box)...')
        subprocess.run([sys.executable, os.path.join(HERE, 'bake.py'), sc_path], check=True)
    new = json.load(open(os.path.join(SCRATCH, 'data.json')))
    data = json.load(open(out))
    meta = data['meta']

    # --- undo an earlier run ----------------------------------------------------------------------------------------
    prev = meta.pop('east', None)
    gs = data['heightmap']['grids']
    gs[:] = [g for g in gs if g.get('tag') != 'east']
    if prev:
        del data['paths'][prev['pathsFrom'] :]

    # --- sanity: the new bake reproduces the old area ---------------------------------------------------------------
    assert new['route'] == data['route'], 'the scratch bake routes differently: the old OSM box is no longer cached?'

    # --- heightmap: the 10 m grid over `grid` ------------------------------------------------------------------------
    d0, n0 = data['heightmap']['grids'][0], new['heightmap']['grids'][0]
    assert d0['cell'] == n0['cell'] and d0['originX'] == n0['originX'] and d0['originZ'] == n0['originZ']
    cell = n0['cell']
    x0, x1, z0, z1 = e['grid']
    i0, i1 = round((x0 - n0['originX']) / cell), round((x1 - n0['originX']) / cell)
    j0, j1 = round((z0 - n0['originZ']) / cell), round((z1 - n0['originZ']) / cell)
    a = dec16(n0)[j0:j1, i0:i1]
    grid = {'originX': x0, 'originZ': z0, 'cell': cell, 'cols': a.shape[1], 'rows': a.shape[0], 'data': b64_int16(a), 'tag': 'east'}
    gs.insert(1, grid)
    print(f'heightmap: {a.shape[1]} x {a.shape[0]} cells of {cell} m over x {x0}..{x1}, z {z0}..{z1}')

    # --- land cover: the grown strip ---------------------------------------------------------------------------------
    lc, nlc = data['landcover'], new['landcover']
    old_x1 = cfg['landcover']['extent'][1]
    assert lc['cell'] == nlc['cell']
    c = lc['cell']
    zones = lc['zones']
    ids = {zone_key(z): k for k, z in enumerate(zones)}
    arr = rle_decode(lc['rle'], lc['cols'] * lc['rows']).reshape(lc['rows'], lc['cols']).copy()
    narr = rle_decode(nlc['rle'], nlc['cols'] * nlc['rows']).reshape(nlc['rows'], nlc['cols'])
    remap = np.zeros(256, np.uint8)
    ni0 = round((old_x1 - nlc['originX']) / c)  # first strip column in the new raster
    used = set(np.unique(narr[:, ni0:]).tolist())  # only zones the strip uses (the map's splat table lacks the others)
    for k, z in enumerate(nlc['zones']):
        if k not in used:
            continue
        if zone_key(z) not in ids:
            ids[zone_key(z)] = len(zones)
            zones.append(z)
        remap[k] = ids[zone_key(z)]
    assert len(zones) < 256
    oi0 = round((old_x1 - lc['originX']) / c)
    oj0 = round((nlc['originZ'] - lc['originZ']) / c)
    strip = remap[narr[:, ni0:]]
    arr[oj0 : oj0 + strip.shape[0], oi0 : oi0 + strip.shape[1]] = strip
    g = e.get('grassAlongHighways')
    if g:
        # Paths after this run's (the new ones are appended below): old ones + the new bake's motorways in the box.
        names = {z['cover']: k for k, z in enumerate(zones)}
        mask = np.zeros(arr.shape, np.uint8)
        hw_paths = [p for p in data['paths'][: prev['pathsFrom'] if prev else len(data['paths'])] if p['kind'] in ('motorway', 'motorway_link', 'trunk') and p['surface'] == 'tarmac']
        hw_paths += [p for p in new['paths'] if p['kind'] in ('motorway', 'motorway_link', 'trunk') and p['surface'] == 'tarmac']
        for p in hw_paths:
            xy = np.array(p['pts']).reshape(-1, 2)
            px = np.round((xy - [lc['originX'], lc['originZ']]) / c).astype(np.int32)
            cv2.polylines(mask, [px.reshape(-1, 1, 2)], False, 255, 1)
        dist = cv2.distanceTransform(255 - mask, cv2.DIST_L2, 3) * c
        cols = (np.arange(arr.shape[1]) * c + lc['originX'])[None, :]
        paved = np.isin(arr, [names[n] for n in ('urban', 'paved', 'open', 'industrial', 'bare') if n in names])
        sel = (dist <= g['reach']) & (cols >= g['fromX']) & paved
        arr[sel] = names['grass']
        print(f'grass along highways: {int(sel.sum())} cells ({sel.sum() * c * c / 1e4:.1f} ha) within {g["reach"]} m of a motorway / ramp east of x {g["fromX"]}')
    lc['rle'] = rle_b64(arr)
    names = {k: z['cover'] for k, z in enumerate(nlc['zones'])}
    share = {names[k]: float(np.mean(narr[:, ni0:] == k)) for k in names if np.any(narr[:, ni0:] == k)}
    print(f'land cover: {strip.shape[1]} x {strip.shape[0]} cells east of x {old_x1}: ' + ', '.join(f'{n} {v * 100:.0f}%' for n, v in sorted(share.items(), key=lambda kv: -kv[1])))

    # --- paths ----------------------------------------------------------------------------------------------------
    old_paths = data['paths']
    base_n = len(old_paths)
    old_lines = [LineString(np.array(p['pts']).reshape(-1, 2)) for p in old_paths if p['surface'] in ('tarmac', 'dirt')]
    old_union = unary_union(old_lines).buffer(COVER_TOL) if old_lines else None
    bx0, bx1, bz0, bz1 = e['pathsBox']
    from_x = bx0
    added, kinds, length = [], {}, 0.0
    big = ('motorway', 'motorway_link', 'trunk', 'trunk_link')
    near = e.get('streetsNearHighway', 350)
    hw_lines = [LineString(np.array(p['pts']).reshape(-1, 2)) for p in old_paths if p['kind'] in big]
    hw_union = None

    def runs_of(p):
        xy = np.array(p['pts']).reshape(-1, 2)
        if xy[:, 0].max() < from_x:
            return []
        pts = resample(xy, STEP)
        covered = shapely.contains_xy(old_union, pts[:, 0], pts[:, 1]) if old_union is not None else np.zeros(len(pts), bool)
        keep = (~covered) & (pts[:, 0] >= bx0) & (pts[:, 0] <= bx1) & (pts[:, 1] >= bz0) & (pts[:, 1] <= bz1)
        run, runs = [], []
        for k, q in enumerate(pts):
            if keep[k]:
                if not run and k > 0:
                    run.append(pts[k - 1])  # join the covered end (the old path's cut end)
                run.append(q)
            else:
                if len(run) > 1:
                    run.append(q)
                    runs.append(run)
                run = []
        if len(run) > 1:
            runs.append(run)
        out = []
        for r in runs:
            r = np.array(r)
            L = float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum())
            # a leftover touching a covered stretch is a sliver under MIN_RUN; a whole short way is kept
            whole = bool(np.allclose(r[0], pts[0]) and np.allclose(r[-1], pts[-1]))
            if L >= MIN_RUN or (whole and L >= MIN_WAY):
                out.append(r)
        return out

    candidates = [p for p in new['paths'] if p['surface'] in ('tarmac', 'dirt')]
    # the interchange (motorway / link) first: the streets are then kept by their distance to it
    for p in sorted(candidates, key=lambda p: p['kind'] not in big):
        if p['kind'] in big:
            hw_union = None  # (rebuilt below)
        for r in runs_of(p):
            L = float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum())
            if p['kind'] not in big:
                if hw_union is None:
                    hw_union = unary_union(hw_lines).buffer(near) if hw_lines else None
                if hw_union is None or not shapely.contains_xy(hw_union, r[:, 0], r[:, 1]).any():
                    continue
            q = cv2.approxPolyDP(np.round(r * 10).astype(np.int32).reshape(-1, 1, 2), 4, False)
            added.append({**p, 'pts': (q.reshape(-1, 2) / 10).round(1).ravel().tolist()})
            if p['kind'] in big:
                hw_lines.append(LineString(r))
            kinds[p['kind']] = kinds.get(p['kind'], 0) + 1
            length += L
    data['paths'] += added
    print(f'paths: +{len(added)} ({length / 1000:.1f} km) inside x {bx0}..{bx1}, z {bz0}..{bz1}: ' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])))
    meta['east'] = {'grid': e['grid'], 'landcoverX1': e['landcoverX1'], 'pathsFrom': base_n, 'paths': len(added)}
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {os.path.relpath(out, ROOT)} ({os.path.getsize(out) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
