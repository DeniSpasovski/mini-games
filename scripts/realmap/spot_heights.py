"""
Jackie's surveyed heights: NYC Planimetric Database spot elevations (feature code 3000, ground spots; 3020 are roofs)
-> src/games/rally/maps/jackie/spot-heights.json, [x, z, y] each (world m, y = m above NAVD88):
  - route    on the stage carriageway: the road follows them where the bare-earth DEM misses it (bridge decks and their
             approach fills; `RoadDef.heights`)
  - streets  on the other roads (within REACH m of a path): their profiles are corrected to them (`MapDef.streetHeights`)

    python scripts/realmap/spot_heights.py

Needs the elevation files nyc_pull.py writes (`sources/maps/jackie/nyc-planimetrics/{west,endbox}-elevation.geojson`).
A route spot counts when it lies on the carriageway (LATERAL m of the route) and agrees with the DEM, stands above it on
a bridge span (the deck) or lines up with the spots before and after it (a fill / slab the DEM smooths away): a spot on
a street crossing over the parkway (an overpass, the Queens Blvd portal) stands metres above both and is left out.
Under a wide structure (an `under` span: the lidar reads its top as ground) only the line counts. The game sorts the
street spots onto the streets / decks itself (terrain-gen.ts `streetCorrections`).
"""

import base64
import json
import os
import sys

import numpy as np
from scipy.ndimage import map_coordinates
from shapely.geometry import LineString, shape
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402
import streets  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MAP = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie')
NYC = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'nyc-planimetrics')
OUT = os.path.join(MAP, 'spot-heights.json')
LATERAL = 3.5
# A route spot this far above / below the DEM (m) is on a structure: kept on a bridge span (the stage road's deck) or
# in line with its neighbours (within LINE m of the line between the DEM-agreeing spots up to NEIGHBOUR m either side).
ABOVE = 2.5
BELOW = 3.0
LINE = 1.0
NEIGHBOUR = 150.0
SPAN_MARGIN = 10.0
# Street spots: within this distance of a path's edge (m).
REACH = 1.0


def main():
    data = json.load(open(os.path.join(MAP, 'data.json'), encoding='utf-8'))
    hm = data['heightmap']
    g = hm['grids'][0]
    dem = np.frombuffer(base64.b64decode(g['data']), dtype='<i2').reshape(g['rows'], g['cols']).astype(float)
    dem = dem * hm['step'] + hm['base']
    line = LineString(np.array(data['route'], float))
    spans = [(s['from'] - SPAN_MARGIN, s['to'] + SPAN_MARGIN) for s in data.get('routeSpans', []) if s['kind'] == 'bridge']
    unders = [(s['from'] - SPAN_MARGIN, s['to'] + SPAN_MARGIN) for s in data.get('routeSpans', []) if s['kind'] == 'under']
    lines = [LineString(np.array(p['pts']).reshape(-1, 2)).buffer(p['width'] / 2 + REACH) for p in data['paths']
             if len(p['pts']) >= 4 and p.get('surface', 'tarmac') == 'tarmac']  # fmt: skip
    tree = STRtree(lines)
    tr = streets.world_transform(endbox.proj())
    seen, spots, street = set(), [], []
    for region in ('west', 'endbox'):
        for f in json.load(open(os.path.join(NYC, f'{region}-elevation.geojson'), encoding='utf-8'))['features']:
            if f['properties'].get('feat_code') != '3000' or not f['geometry']:
                continue
            p = tr(shape(f['geometry']))
            key = (round(p.x, 1), round(p.y, 1))
            if key in seen:
                continue
            seen.add(key)
            y = round(float(f['properties']['elevation']) * 0.3048, 2)
            a = line.project(p)
            if 1 < a < line.length - 1 and line.distance(p) <= LATERAL:
                d = y - float(map_coordinates(dem, [[(p.y - g['originZ']) / g['cell']], [(p.x - g['originX']) / g['cell']]], order=1)[0])  # fmt: skip
                spots.append((a, key[0], key[1], y, d))
            elif len(tree.query(p, predicate='intersects')):
                street.append([key[0], key[1], y])
    spots.sort()
    under = [any(s0 <= a <= s1 for s0, s1 in unders) for a, *_ in spots]
    anchors = [(a, y) for (a, _, _, y, d), u in zip(spots, under) if -BELOW <= d <= ABOVE and not u]
    route, dropped = [], []
    for (a, x, z, y, d), u in zip(spots, under):
        ok = not u and (-BELOW <= d <= ABOVE or (d > 0 and any(s0 <= a <= s1 for s0, s1 in spans)))
        if not ok:
            prev = [(pa, py) for pa, py in anchors if a - NEIGHBOUR <= pa < a]
            nxt = [(na, ny) for na, ny in anchors if a < na <= a + NEIGHBOUR]
            if prev and nxt:
                (pa, py), (na, ny) = prev[-1], nxt[0]
                ok = abs(y - (py + (ny - py) * (a - pa) / (na - pa))) <= LINE
        if ok:
            route.append([x, z, y])
        else:
            dropped.append((a, d))
    street.sort()
    with open(OUT, 'w') as f:
        json.dump(
            {
                'source': 'NYC Planimetric Database: elevation points, feature code 3000 (NYC Open Data); '
                'scripts/realmap/spot_heights.py',
                'route': route,
                'streets': street,
            },
            f,
            separators=(',', ':'),
        )
    print(f'{len(route)} route heights, {len(street)} street heights -> {OUT}')
    print('route spots left out (along, m above the DEM):', ', '.join(f'{a:.0f} {d:+.1f}' for a, d in dropped))


if __name__ == '__main__':
    main()
