"""Street markings of a v2 map from NYC open data: protected bike lanes (NYC DOT Bike Routes, `NetworkDef.bikeLanes`)
and painted medians (NYC Planimetric median sub_code 360010, `NetworkDef.paintedMedians`).

    python scripts/realmap/nyc_lanes.py scripts/realmap/jackie-2.json sources/maps/jackie-2/nyc/kew-bike-routes.geojson \
        sources/maps/jackie/nyc-planimetrics/endbox-median.geojson --out src/games/rally/maps/jackie-2/markings.json

- lanes: each on-street segment with a `Protected` facility in a direction (`ft_facilit` = along the line, `tf_facilit`
  = against it) becomes [side, x0, z0, x1, z1, ...] on the street's centreline (CSCL): side 1 = the lane on the line's
  right (traffic along it), -1 = on its left. The engine puts it on the roadway beside the line (v2/mesh.ts `bikeLanes`).
  Segments with the same line and side are kept once.
- painted: each painted median's outline [x0, z0, ...], hatched on the paving under it (v2/mesh.ts `paintIsland`).
"""

import json
import os
import sys

from shapely.geometry import shape
from shapely.ops import linemerge, transform

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake  # noqa: E402

PAINTED = '360010'


def main(cfg_path, routes, medians, out):
    cfg = json.load(open(cfg_path))
    proj = bake.Proj(*cfg['origin'])

    def to_world(g):
        return transform(lambda lon, lat, z=None: proj.fwd(lat, lon), shape(g))

    seen = set()
    lanes = []
    for f in json.load(open(routes, encoding='utf-8'))['features']:
        p = f['properties']
        if p.get('onoffst') != 'ON' or not f.get('geometry'):
            continue
        g = to_world(f['geometry'])
        if g.geom_type == 'MultiLineString':
            g = linemerge(g)
        for side, key in ((1, 'ft_facilit'), (-1, 'tf_facilit')):
            if p.get(key) != 'Protected':
                continue
            for part in getattr(g, 'geoms', [g]):
                pts = [round(v, 2) for xy in part.coords for v in xy]
                k = (side, tuple(pts))
                if k in seen:
                    continue
                seen.add(k)
                lanes.append([side, *pts])
    painted = []
    for f in json.load(open(medians, encoding='utf-8'))['features']:
        if f['properties'].get('sub_code') != PAINTED or not f.get('geometry'):
            continue
        g = to_world(f['geometry']).buffer(0)
        for part in getattr(g, 'geoms', [g]):
            if part.area >= 2:
                painted.append([round(v, 2) for xy in list(part.simplify(0.1).exterior.coords)[:-1] for v in xy])
    res = {
        'source': 'NYC DOT Bike Routes (mzxg-pwib), NYC Planimetric Database median (ees7-4ufv) - NYC Open Data',
        'lanes': lanes,
        'painted': painted,
    }
    with open(out, 'w', newline='\n') as fh:
        json.dump(res, fh)
    print(f'{len(lanes)} protected lane segments, {len(painted)} painted medians -> {out}')


if __name__ == '__main__':
    # (the output only behind --out, so a call with too few inputs never writes over one of them)
    args = sys.argv[1:]
    if len(args) != 5 or args[3] != '--out' or not args[4].endswith('.json'):
        sys.exit('usage: nyc_lanes.py <config> <bike-routes.geojson> <median.geojson> --out <markings.json>')
    main(args[0], args[1], args[2], args[4])
