"""Grow a baked real map to the west with the full bake's data (streets, buildings, land cover) - the Jackie start.

    python scripts/realmap/west.py scripts/realmap/jackie.json

Config block (the map's bake config):

    "west": { "landcoverX0": -3500, "box": [-3420, -2600, 1300, 2500], "corridor": 560, "buildingsCorridor": 700 }

Order for a map that has all of them:  bake.py -> extend.py -> east.py -> west.py -> streets.py.

What it does: runs `bake.py` once into a scratch folder (`scripts/realmap/.cache/west/`) with the land cover box grown west to
`landcoverX0`, a second OSM box for the new strip (the old box is cached, so the route and the old area stay exactly as they
were) and wider street / building corridors, then edits the map's data.json (+ buildings.csv) in place:
  - paths      tarmac / dirt ways of the new bake inside `box` (x0, x1, z0, z1) that the old data does not have (the old bake
               cut streets at its corridor): appended, trimmed to the part not covered by an old path. Existing indices stay.
  - buildings  the new bake's buildings inside `box` the old data does not have (no old one within 3 m): appended with new
               ids (+ their buildings.csv rows)
  - landcover  the cells between `landcoverX0` and the old land cover box take the bake's classes (trees, grass, urban ...)
               instead of the ring's `paved` / `open`
The heightmap (the detail grid reaches x -3800), lakes, pylons, railways, the route and its spans are NOT touched.
Re-running replaces an earlier run (`meta.west`; only while its paths / buildings are the last ones).
"""

import csv
import json
import os
import subprocess
import sys

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import CACHE, ROOT, resample, rle_b64  # noqa: E402
from extend import rle_decode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.join(CACHE, 'west')
COVER_TOL = 2.5  # m: a new path closer than this to an old one is the same road
MIN_RUN = 8.0  # m: a shorter leftover next to an old path's cut end is a sliver and dropped
MIN_WAY = 1.5  # m: ... but a short way of its own is kept
SAME_BUILDING = 3.0  # m: a new building this close to an old one is the same building
STEP = 2.0


def scratch_config(cfg):
    w = cfg['west']
    old = cfg['landcover']['extent']
    c = json.loads(json.dumps(cfg))
    c['out'] = os.path.join(SCRATCH, 'data.json')
    for k in ('streets', 'extend', 'east', 'west'):
        c.pop(k, None)
    c['landcover']['extent'] = [w['landcoverX0'], old[1], old[2], old[3]]
    c['osmBoxes'] = [old, [w['landcoverX0'], old[0], old[2], old[3]]]
    c['paths'] = {**c.get('paths', {}), 'corridor': w.get('corridor', 550)}
    c['buildings'] = {**c.get('buildings', {}), 'corridor': w.get('buildingsCorridor', 700)}
    return c


def zone_key(z):
    return (z['cover'], z.get('angle'))


def main():
    cfg_path = sys.argv[1]
    cfg = json.load(open(cfg_path))
    w = cfg['west']
    out = os.path.join(ROOT, cfg['out'])
    csv_path = os.path.join(os.path.dirname(out), 'buildings.csv')
    os.makedirs(SCRATCH, exist_ok=True)
    sc_path = os.path.join(SCRATCH, 'config.json')
    json.dump(scratch_config(cfg), open(sc_path, 'w'), indent=1)
    if '--no-bake' not in sys.argv:
        print('scratch bake (box grown west)...')
        subprocess.run([sys.executable, os.path.join(HERE, 'bake.py'), sc_path], check=True)
    new = json.load(open(os.path.join(SCRATCH, 'data.json')))
    data = json.load(open(out))
    meta = data['meta']
    bld = data['buildings']
    rows_csv = list(csv.reader(open(csv_path, newline='', encoding='utf-8')))

    # --- undo an earlier run (its paths / buildings are the last ones) ------------------------------------------------
    prev = meta.pop('west', None)
    if prev:
        assert prev['pathsFrom'] + prev['paths'] == len(data['paths']), 'paths were appended after the west run'
        del data['paths'][prev['pathsFrom'] :]
        gone = set(prev.get('buildingIds', []))
        bld['rows'] = [r for r in bld['rows'] if r[0] not in gone]
        for i in gone:
            bld['polys'].pop(str(i), None)
        rows_csv = [rows_csv[0]] + [r for r in rows_csv[1:] if int(r[1]) not in gone]

    assert new['route'] == data['route'], 'the scratch bake routes differently: the old OSM box is no longer cached?'
    bx0, bx1, bz0, bz1 = w['box']

    def in_box(x, z):
        return (x >= bx0) & (x <= bx1) & (z >= bz0) & (z <= bz1)

    # --- land cover: the grown strip -------------------------------------------------------------------------------
    lc, nlc = data['landcover'], new['landcover']
    old_x0 = cfg['landcover']['extent'][0]
    assert lc['cell'] == nlc['cell']
    c = lc['cell']
    zones = lc['zones']
    ids = {zone_key(z): k for k, z in enumerate(zones)}
    arr = rle_decode(lc['rle'], lc['cols'] * lc['rows']).reshape(lc['rows'], lc['cols']).copy()
    narr = rle_decode(nlc['rle'], nlc['cols'] * nlc['rows']).reshape(nlc['rows'], nlc['cols'])
    ni1 = round((old_x0 - nlc['originX']) / c)  # strip columns: [0, ni1) of the new raster
    used = set(np.unique(narr[:, :ni1]).tolist())
    remap = np.zeros(256, np.uint8)
    for k, z in enumerate(nlc['zones']):
        if k not in used:
            continue
        if zone_key(z) not in ids:
            ids[zone_key(z)] = len(zones)
            zones.append(z)
        remap[k] = ids[zone_key(z)]
    assert len(zones) < 256
    oi0 = round((nlc['originX'] - lc['originX']) / c)
    oj0 = round((nlc['originZ'] - lc['originZ']) / c)
    strip = remap[narr[:, :ni1]]
    arr[oj0 : oj0 + strip.shape[0], oi0 : oi0 + strip.shape[1]] = strip
    lc['rle'] = rle_b64(arr)
    names = {k: z['cover'] for k, z in enumerate(nlc['zones'])}
    share = {names[k]: float(np.mean(narr[:, :ni1] == k)) for k in names if np.any(narr[:, :ni1] == k)}
    print(f'land cover: {strip.shape[1]} x {strip.shape[0]} cells west of x {old_x0}: '
          + ', '.join(f'{n} {v * 100:.0f}%' for n, v in sorted(share.items(), key=lambda kv: -kv[1])))  # fmt: skip

    # --- paths ----------------------------------------------------------------------------------------------------
    old_paths = data['paths']
    base_n = len(old_paths)
    old_lines = [LineString(np.array(p['pts']).reshape(-1, 2)) for p in old_paths if p['surface'] in ('tarmac', 'dirt')]
    old_union = unary_union(old_lines).buffer(COVER_TOL)

    def runs_of(p):
        xy = np.array(p['pts']).reshape(-1, 2)
        if not in_box(xy[:, 0], xy[:, 1]).any():
            return []
        pts = resample(xy, STEP)
        keep = (~shapely.contains_xy(old_union, pts[:, 0], pts[:, 1])) & in_box(pts[:, 0], pts[:, 1])
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
        keep_runs = []
        for r in runs:
            r = np.array(r)
            L = float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum())
            whole = bool(np.allclose(r[0], pts[0]) and np.allclose(r[-1], pts[-1]))
            if L >= MIN_RUN or (whole and L >= MIN_WAY):
                keep_runs.append(r)
        return keep_runs

    import cv2  # noqa: E402

    added, kinds, length = [], {}, 0.0
    for p in new['paths']:
        if p['surface'] not in ('tarmac', 'dirt'):
            continue
        for r in runs_of(p):
            q = cv2.approxPolyDP(np.round(r * 10).astype(np.int32).reshape(-1, 1, 2), 4, False)
            added.append({**p, 'pts': (q.reshape(-1, 2) / 10).round(1).ravel().tolist()})
            kinds[p['kind']] = kinds.get(p['kind'], 0) + 1
            length += float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum())
    data['paths'] += added
    print(f'paths: +{len(added)} ({length / 1000:.1f} km) inside x {bx0}..{bx1}, z {bz0}..{bz1}: '
          + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])))  # fmt: skip

    # --- buildings ------------------------------------------------------------------------------------------------
    nb = new['buildings']
    assert nb['fields'] == bld['fields'], 'building field list differs'
    f = bld['fields']
    old_xy = np.array([[r[1], r[2]] for r in bld['rows']], float)
    next_id = max(r[0] for r in bld['rows']) + 1
    new_csv = {int(r[1]): r for r in list(csv.reader(open(os.path.join(SCRATCH, 'buildings.csv'), newline='', encoding='utf-8')))[1:]}
    remaps = {}
    for name, field in (('types', 'type'), ('sources', 'src'), ('kinds', 'kind'), ('roofs', 'roof')):
        m = {}
        for k, v in enumerate(nb[name]):
            if v not in bld[name]:
                bld[name].append(v)
            m[k] = bld[name].index(v)
        remaps[f.index(field)] = m
    added_ids = []
    for r in nb['rows']:
        x, z = r[1], r[2]
        if not in_box(x, z):
            continue
        if len(old_xy) and np.min(np.hypot(old_xy[:, 0] - x, old_xy[:, 1] - z)) < SAME_BUILDING:
            continue
        nid = next_id
        next_id += 1
        row = list(r)
        row[0] = nid
        for ci, m in remaps.items():
            row[ci] = m[row[ci]]
        bld['rows'].append(row)
        poly = nb['polys'].get(str(r[0]))
        if poly:
            bld['polys'][str(nid)] = poly
        cr = new_csv.get(r[0])
        if cr:
            cr = list(cr)
            cr[1] = str(nid)
            rows_csv.append(cr)
        added_ids.append(nid)
    print(f'buildings: +{len(added_ids)} inside the box')

    meta['west'] = {'box': w['box'], 'landcoverX0': w['landcoverX0'], 'pathsFrom': base_n, 'paths': len(added), 'buildingIds': added_ids}
    with open(out, 'w') as fo:
        json.dump(data, fo, separators=(',', ':'))
    with open(csv_path, 'w', newline='', encoding='utf-8') as fo:
        csv.writer(fo).writerows(rows_csv)
    print(f'wrote {os.path.relpath(out, ROOT)} ({os.path.getsize(out) / 1024:.0f} KB) + buildings.csv')


if __name__ == '__main__':
    main()
