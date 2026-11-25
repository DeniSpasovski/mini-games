"""A small city park from NYC open data + OpenStreetMap: its lawn, footpaths and fountain (v2 maps, `NetworkDef.parks`).

    python scripts/realmap/park_block.py scripts/realmap/jackie-2.json sources/maps/jackie/nyc-planimetrics/endbox \
        sources/maps/jackie/osm-kew-gardens-junction.json src/games/rally/maps/jackie-2/park-kew.json 2806,-1800

- block: the land holding the seed point between the NYC Planimetric roadbeds (within REACH m);
- lawn: the block minus the planimetric sidewalks (`landcover.paint` grass);
- paths: the OSM footways (not sidewalks / crossings) inside the block, PATH_W wide;
- fountain: a closed OSM footway ring in the block is the walk round a fountain; the basin fills it to RIM_GAP m inside
  the path (no NYC layer has the fountain).
"""

import json
import math
import os
import sys

from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import transform, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake  # noqa: E402

REACH = 90.0
PATH_W = 2.4
RIM_GAP = 1.0


def main(cfg_path, prefix, osm_path, out, seed):
    cfg = json.load(open(cfg_path))
    proj = bake.Proj(*cfg['origin'])
    sx, sz = (float(v) for v in seed.split(','))
    seed_pt = Point(sx, sz)
    box = seed_pt.buffer(REACH)

    def load(layer):
        polys = []
        for f in json.load(open(f'{prefix}-{layer}.geojson', encoding='utf-8'))['features']:
            if f.get('geometry'):
                g = transform(lambda lon, lat, z=None: proj.fwd(lat, lon), shape(f['geometry'])).buffer(0)
                if g.intersects(box):
                    polys.append(g)
        return unary_union(polys)

    free = box.difference(load('roadbed').buffer(0.05))
    block = next(p for p in getattr(free, 'geoms', [free]) if p.contains(seed_pt))
    lawn = block.difference(load('sidewalk'))
    lawns = [p for p in getattr(lawn, 'geoms', [lawn]) if p.area > 50]

    osm = json.load(open(osm_path, encoding='utf-8'))['elements']
    nodes = {e['id']: e for e in osm if e['type'] == 'node'}
    paths = []
    fountains = []
    for e in osm:
        t = e.get('tags', {})
        if e['type'] != 'way' or t.get('highway') != 'footway' or t.get('footway'):
            continue
        pts = [proj.fwd(nodes[n]['lat'], nodes[n]['lon']) for n in e['nodes'] if n in nodes]
        if len(pts) < 2:
            continue
        line = LineString(pts).intersection(block)
        for part in getattr(line, 'geoms', [line]):
            if part.geom_type == 'LineString' and part.length > 3:
                paths.append([round(v, 2) for p in part.coords for v in p])
        if e['nodes'][0] == e['nodes'][-1] and len(pts) > 6:
            ring = Polygon(pts)
            if block.contains(ring):
                c = ring.centroid
                r = math.sqrt(ring.area / math.pi)
                fountains.append({'x': round(c.x, 2), 'z': round(c.y, 2), 'r': round(r - PATH_W / 2 - RIM_GAP, 2)})

    def flat(p):
        return [round(v, 2) for xy in list(p.simplify(0.2).exterior.coords)[:-1] for v in xy]

    res = {
        'source': 'NYC Planimetric Database (roadbed, sidewalk) - NYC Open Data, Office of Technology and Innovation; '
        'footpaths: OpenStreetMap contributors (ODbL)',
        'lawn': [flat(p) for p in lawns],
        'paths': paths,
        'pathWidth': PATH_W,
        'fountains': fountains,
    }
    with open(out, 'w', newline='\n') as f:
        json.dump(res, f)
    print(f'block {block.area:.0f} m2, {len(lawns)} lawns, {len(paths)} paths, {len(fountains)} fountains -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:6])
