"""
Road-side features from OpenStreetMap: park furniture, barriers across ways, single trees, signs, and barrier lines
(fences, walls, kerbs, guard rails). Config `"osm": {"features": {"corridor": 300}}` (Overpass maps only); bake.py calls
`bake_features()` and writes the result as `data.json` "features" (ODbL like the rest).

    python scripts/realmap/features.py scripts/realmap/<map>.json   # re-bakes only the "features" key of data.json

Output (world metres, +X east, +Z south):
  points: [kind, x, z, yaw, osm node id]   yaw = heading of the way a barrier / sign sits on (rad, atan2(dz, dx)), else 0
  lines:  {kind, pts: [x, z, ...], id, (type)}   kind fence | wall | kerb | guard_rail | retaining_wall | hedge
Only features within `corridor` m of the stage route are kept.
"""

import json
import math
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import overpass as ovp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache')

# node tags -> kind (first match wins)
POINT_RULES = [
    ('leisure', 'picnic_table', 'picnic_table'),
    ('amenity', 'bench', 'bench'),
    ('leisure', 'bench', 'bench'),
    ('amenity', 'shelter', 'shelter'),
    ('tourism', 'viewpoint', 'viewpoint'),
    ('amenity', 'drinking_water', 'drinking_water'),
    ('amenity', 'waste_basket', 'waste_basket'),
    ('barrier', 'lift_gate', 'lift_gate'),
    ('barrier', 'gate', 'gate'),
    ('barrier', 'swing_gate', 'gate'),
    ('barrier', 'block', 'block'),
    ('barrier', 'bollard', 'bollard'),
    ('natural', 'tree', 'tree'),
    ('natural', 'spring', 'spring'),
    ('highway', 'give_way', 'give_way'),
    ('highway', 'stop', 'stop'),
    ('highway', 'street_lamp', 'street_lamp'),
]
LINE_KINDS = {'fence', 'wall', 'kerb', 'guard_rail', 'retaining_wall', 'hedge'}


def point_kind(t):
    if t.get('tourism') == 'information':
        return 'guidepost' if t.get('information') == 'guidepost' else 'board'
    for k, v, kind in POINT_RULES:
        if t.get(k) == v:
            return kind
    return None


def query(box):
    s, n, w, e = box
    bb = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
    return f"""[out:xml][timeout:300];
(
  node["leisure"~"^(picnic_table|bench)$"]({bb});
  node["amenity"~"^(bench|shelter|drinking_water|waste_basket)$"]({bb});
  way["amenity"="shelter"]({bb});
  node["tourism"~"^(viewpoint|information)$"]({bb});
  node["barrier"]({bb});
  way["barrier"]({bb});
  node["natural"~"^(tree|spring)$"]({bb});
  node["highway"~"^(give_way|stop|street_lamp)$"]({bb});
)->.f;
(.f; way(bn.f)["highway"];);
(._; >;);
out;"""


def bake_features(cfg, proj, ll_box, route_xy):
    fcfg = cfg.get('osm', {}).get('features')
    if not fcfg:
        return None
    nodes, ntags, ways, _ = ovp.parse(ovp.run(query(ll_box(cfg['landcover']['extent'], 150)), CACHE, 'features'))
    corridor = fcfg.get('corridor', 300)
    route = np.asarray(route_xy, float)
    # dense route samples (1 m) for the corridor test
    seg = [np.linspace(a, b, max(2, int(np.hypot(*(b - a))) + 1)) for a, b in zip(route[:-1], route[1:])]
    kd = cKDTree(np.concatenate(seg))
    xy = lambda nid: proj.fwd(*nodes[nid])  # noqa: E731
    near = lambda p: kd.query(p)[0] <= corridor  # noqa: E731

    # heading of the highway each node lies on (barriers, signs)
    heading = {}
    for w in ways.values():
        if 'highway' not in w['tags']:
            continue
        r = w['refs']
        for i, nid in enumerate(r):
            a, b = r[max(0, i - 1)], r[min(len(r) - 1, i + 1)]
            if a == b:
                continue
            (x0, z0), (x1, z1) = xy(a), xy(b)
            heading.setdefault(nid, round(math.atan2(z1 - z0, x1 - x0), 3))

    points = []
    for nid, t in ntags.items():
        kind = point_kind(t)
        if not kind:
            continue
        p = xy(nid)
        if not near(p):
            continue
        points.append([kind, round(p[0], 1), round(p[1], 1), heading.get(nid, 0), int(nid)])
    lines = []
    for wid, w in ways.items():
        t = w['tags']
        if t.get('amenity') == 'shelter' and 'barrier' not in t:
            ps = [xy(r) for r in w['refs']]
            if not ps:
                continue
            c = np.mean(ps[:-1] if w['closed'] else ps, axis=0)
            if near(c):
                # a shelter drawn as an outline: its centre, long side as yaw
                (x0, z0), (x1, z1) = ps[0], ps[1] if len(ps) > 1 else ps[0]
                points.append(['shelter', round(float(c[0]), 1), round(float(c[1]), 1), round(math.atan2(z1 - z0, x1 - x0), 3), -int(wid)])
            continue
        kind = t.get('barrier')
        if kind not in LINE_KINDS:
            continue
        ps = [xy(r) for r in w['refs']]
        if len(ps) < 2 or not any(near(p) for p in ps):
            continue
        rec = {'kind': kind, 'pts': [round(v, 1) for p in ps for v in p], 'id': int(wid)}
        for k in ('fence_type', 'wall', 'material'):
            if k in t:
                rec['type'] = t[k]
                break
        lines.append(rec)
    # a shelter mapped twice (outline + node): keep the outline
    outlines = [p for p in points if p[0] == 'shelter' and p[4] < 0]
    points = [
        p for p in points
        if not (p[0] == 'shelter' and p[4] > 0 and any(math.hypot(p[1] - q[1], p[2] - q[2]) < 6 for q in outlines))
    ]  # fmt: skip
    points.sort(key=lambda p: (p[0], p[4]))
    lines.sort(key=lambda l: (l['kind'], l['id']))
    counts = {}
    for p in points:
        counts[p[0]] = counts.get(p[0], 0) + 1
    for line in lines:
        counts['line:' + line['kind']] = counts.get('line:' + line['kind'], 0) + 1
    print(f'  osm.features within {corridor} m: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))
    return {'points': points, 'lines': lines}


def main():
    sys.path.insert(0, HERE)
    from bake import Proj

    cfg = json.load(open(sys.argv[1], encoding='utf8'))
    proj = Proj(*cfg['origin'])

    def ll_box(ext, pad=0):
        la0, lo0 = proj.inv(ext[0] - pad, ext[2] - pad)
        la1, lo1 = proj.inv(ext[1] + pad, ext[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    out = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out, encoding='utf8'))
    feats = bake_features(cfg, proj, ll_box, data['route'])
    if feats is None:
        raise SystemExit('config has no osm.features')
    data['features'] = feats
    with open(out, 'w', newline='\n') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote features into {cfg["out"]}')


if __name__ == '__main__':
    main()
