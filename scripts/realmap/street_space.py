"""City street space beside a stage road: NYC Planimetric roadbed, sidewalk and median polygons near the route, for the
v2 road engine's `streetSpace` (NetField: paved under every road, sidewalk and junction, so no land shows between them).

Inputs (kept in `sources/maps/<map>/`, never shipped): `<prefix>-roadbed / sidewalk / median.geojson` (NYC Open Data,
OTI; Socrata `intersects(the_geom, <polygon>)` query on i36f-5ih7 / 52n9-sdep / ees7-4ufv).

Output (world frame of `bake.py` Proj: +X east, +Z south), cut into TILE m squares (one mesh per square):
  - `road`: roadbed + medians, `walk`: sidewalks, each {area, holes} (the survey plazas' own areas left out);
  - `medians`: raised medians / traffic islands (sub codes 360080, 360020) as outlines.

    python scripts/realmap/street_space.py scripts/realmap/jackie-2.json sources/maps/jackie-2/nyc/kew/kew \\
        src/games/rally/maps/jackie-2/street-space.json 150 6800
"""

import json
import os
import sys

from shapely.geometry import LineString, Polygon, box, shape
from shapely.ops import substring, transform, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj  # noqa: E402

TILE = 100.0
SIMPLIFY = 0.15
MIN_AREA = 1.0
# Planimetric median sub codes that stand raised (360010 painted medians are paint: `paintedMedians`).
RAISED = ('360080', '360020')
# The survey plazas' areas are left out, less this overlap (m): the street space runs on under their rims.
PLAZA_OVERLAP = 0.5
# Viewer metres = route metres + this (the HUD starts here).
VIEWER_OFFSET = 175.0


def flat(ring):
    return [round(v, 2) for p in list(ring.coords)[:-1] for v in p]


def parts(g):
    return [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'Polygon' and p.area >= MIN_AREA]


def main(config, prefix, out, reach='150', start='0'):
    cfg = json.load(open(config))
    proj = Proj(*cfg['origin'])
    folder = os.path.join(ROOT, cfg['folder'])
    route = LineString(json.load(open(os.path.join(folder, 'route.json')))['route'])
    s0 = max(0.0, float(start) - VIEWER_OFFSET)
    near = substring(route, s0, route.length).buffer(float(reach))
    tr = lambda g: transform(lambda lon, lat, z=None: proj.fwd(lat, lon), g)  # noqa: E731
    layers = {}
    for layer in ('roadbed', 'sidewalk', 'median'):
        layers[layer] = [
            (f['properties'], tr(shape(f['geometry'])).buffer(0))
            for f in json.load(open(f'{prefix}-{layer}.geojson'))['features']
            if f['geometry']
        ]
    plazas = []
    for name in ('../jackie/junction.json', '../jackie/junction-lane-start.json', 'junction-qb-east.json'):
        a = json.load(open(os.path.join(folder, name)))['area']
        plazas.append(Polygon(list(zip(a[0::2], a[1::2]))).buffer(0))
    keep_out = unary_union(plazas).buffer(-PLAZA_OVERLAP)

    def union(gs):
        return unary_union(gs).buffer(0.05).buffer(-0.05).intersection(near).difference(keep_out)

    road = union([g for _, g in layers['roadbed']] + [g for _, g in layers['median']])
    walk = union([g for _, g in layers['sidewalk']]).difference(road)
    medians = [
        g.intersection(near).difference(keep_out)
        for p, g in layers['median']
        if p.get('sub_code') in RAISED
    ]
    x0, z0, x1, z1 = near.bounds
    tiles = []
    gx = int(x0 // TILE)
    while gx * TILE < x1:
        gz = int(z0 // TILE)
        while gz * TILE < z1:
            tiles.append(box(gx * TILE, gz * TILE, (gx + 1) * TILE, (gz + 1) * TILE))
            gz += 1
        gx += 1

    def cut(g):
        res = []
        for t in tiles:
            for p in parts(g.intersection(t).simplify(SIMPLIFY)):
                res.append({'area': flat(p.exterior), 'holes': [flat(r) for r in p.interiors if Polygon(r).area >= MIN_AREA]})
        return res

    out_road, out_walk = cut(road), cut(walk)
    out_med = [flat(p.exterior) for m in medians for p in parts(m.simplify(SIMPLIFY))]
    json.dump(
        {
            'source': 'NYC Planimetric Database (roadbed, sidewalk, median) - NYC Open Data, Office of Technology and '
            'Innovation; scripts/realmap/street_space.py',
            'road': out_road,
            'walk': out_walk,
            'medians': out_med,
        },
        open(out, 'w'),
        separators=(',', ':'),
    )
    print(
        f'road {road.area:.0f} m2 ({len(out_road)} pieces), walk {walk.area:.0f} m2 ({len(out_walk)} pieces), '
        f'{len(out_med)} raised medians -> {out}'
    )


if __name__ == '__main__':
    main(*sys.argv[1:6])
