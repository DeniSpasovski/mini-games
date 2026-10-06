"""Junction area of a city map: the street space around a junction box, from NYC open data + OpenStreetMap.

Inputs (kept in `sources/maps/<map>/`, never shipped):
  - NYC Planimetric Database GeoJSON (NYC Open Data, OTI): `<prefix>-roadbed / sidewalk / median.geojson`
    (Socrata `intersects(the_geom, <polygon>)` query - `within_box` misses the big polygons);
  - NYC Street Tree Census 2015 JSON: `<prefix>-trees.json` (optional);
  - an Overpass JSON extract of the junction (all ways + tagged nodes, OSM, ODbL) (optional).

Output `maps/<map>/junction.json` (world frame of `bake.py` Proj: +X east, +Z south):
  - `area`: the street space (roadbed + sidewalks + medians) within REACH m of the junction box outline -> `junctionPlazas`;
  - `islands`: medians / traffic islands (`island`, raised), painted medians (`painted`), sidewalks (`sidewalk`, raised),
    clipped to the area -> `plazaIslands`;
  - `crosswalks`: OSM ways tagged `crossing:markings=zebra` touching the area -> `plazaCrosswalks`;
  - `trees`: census street trees on the area's sidewalks (`[x, z, dbh_inch, ...]`);
  - `signals`: OSM traffic signal nodes in the area (`[x, z, ...]`).

    python scripts/realmap/plaza_islands.py scripts/realmap/jackie.json sources/maps/jackie/nyc-planimetrics/kew-gardens \\
        src/games/rally/maps/jackie/junction.json 2650.8,-1815.9,2668,-1840,... sources/maps/jackie/osm-kew-gardens-junction.json \
        2652.7,-1812.4,2737.6,-1844.7,2749.7,-1809.1,2670.9,-1779.5

Optional 7th argument: the reach around the clip polygon (default REACH). The 6th argument is the game's portal slab
footprint (`-` for none) (the headwall corners: World.gen.portals rows, latL / latR at the
span ends): it is added to the area.
"""

import json
import os
import sys

from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import transform, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import Proj  # noqa: E402

# Street space kept around the junction box (m).
REACH = 80
CROSS_REACH = 2
# Planimetric sub codes -> island kinds (Capture_Rules.md: 360080 traffic island, 360020 curb median, 360010 painted).
KINDS = {'360080': 'island', '360020': 'island', '360010': 'painted', '380000': 'sidewalk', '380010': 'sidewalk'}
MIN_AREA = 1.0
SIMPLIFY = 0.15


def flat(poly):
    return [round(v, 2) for p in list(poly.exterior.coords)[:-1] for v in p]


def main(config, prefix, out, clip, osm=None, slab=None, reach=None):
    proj = Proj(*json.load(open(config))['origin'])
    tr = lambda g: transform(lambda lon, lat, z=None: proj.fwd(lat, lon), g)  # noqa: E731
    c = [float(v) for v in clip.split(',')]
    box = Polygon(list(zip(c[0::2], c[1::2]))).buffer(0)
    layers = {}
    for layer in ('roadbed', 'sidewalk', 'median'):
        layers[layer] = [(f['properties'], tr(shape(f['geometry'])).buffer(0)) for f in json.load(open(f'{prefix}-{layer}.geojson'))['features']]
    space = unary_union([g for fs in layers.values() for _, g in fs]).buffer(0.05).buffer(-0.05)
    area = space.intersection(box.buffer(float(reach) if reach else REACH))
    if slab and slab != '-':
        # The game's portal slab (its headwall corners): all of it is paved, even where it is wider than the real deck.
        s = [float(v) for v in slab.split(',')]
        area = area.union(Polygon(list(zip(s[0::2], s[1::2]))).buffer(0.3, join_style=2))
    area = area.simplify(SIMPLIFY)
    if area.geom_type != 'Polygon':
        area = max(area.geoms, key=lambda g: g.area)
    islands = []
    for layer in ('median', 'sidewalk'):
        for props, geom in layers[layer]:
            kind = KINDS.get(props.get('sub_code', ''))
            if not kind:
                continue
            part = geom.intersection(area).simplify(SIMPLIFY)
            for poly in getattr(part, 'geoms', [part]):
                if poly.geom_type == 'Polygon' and poly.area >= MIN_AREA:
                    islands.append({'kind': kind, 'pts': flat(poly)})
    trees = []
    if os.path.exists(f'{prefix}-trees.json'):
        walks = unary_union([g for _, g in layers['sidewalk']]).intersection(area).buffer(0.5)
        for t in json.load(open(f'{prefix}-trees.json')):
            if t.get('status') != 'Alive':
                continue
            x, z = proj.fwd(float(t['latitude']), float(t['longitude']))
            if walks.contains(Point(x, z)):
                trees += [round(x, 2), round(z, 2), int(t.get('tree_dbh') or 0)]
    crosswalks, signals = [], []
    if osm:
        els = json.load(open(osm, encoding='utf-8'))['elements']
        nodes = {e['id']: e for e in els if e['type'] == 'node'}
        near = area.buffer(CROSS_REACH)
        for e in els:
            t = e.get('tags', {})
            if e['type'] == 'way' and t.get('crossing:markings') == 'zebra':
                pts = [proj.fwd(nodes[n]['lat'], nodes[n]['lon']) for n in e['nodes'] if n in nodes]
                if len(pts) > 1 and LineString(pts).intersects(near):
                    crosswalks.append([round(v, 2) for p in pts for v in p])
            if e['type'] == 'node' and t.get('highway') == 'traffic_signals':
                x, z = proj.fwd(e['lat'], e['lon'])
                if near.contains(Point(x, z)):
                    signals += [round(x, 2), round(z, 2)]
    json.dump(
        {
            'source': 'NYC Planimetric Database (roadbed, sidewalk, median) and NYC Street Tree Census 2015 - NYC Open Data, '
            'Office of Technology and Innovation; crosswalks, signals: OpenStreetMap contributors (ODbL)',
            'area': flat(area),
            'islands': islands,
            'crosswalks': crosswalks,
            'trees': trees,
            'signals': signals,
        },
        open(out, 'w'),
        separators=(',', ':'),
    )
    print(f'area {area.area:.0f} m2 ({len(area.exterior.coords)} pts), {len(islands)} islands, {len(crosswalks)} crosswalks, '
          f'{len(trees) // 3} trees, {len(signals) // 2} signals -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:8])
