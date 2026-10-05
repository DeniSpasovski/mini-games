"""
OpenStreetMap through the Overpass API, for dense city areas where the plain `/api/0.6/map` call is
refused (it allows at most 50 000 nodes per request). Used by bake.py when the config has
`"osm": {"source": "overpass"}`.

Two queries, merged into one (nodes, ntags, ways, rels) tuple like `bake.load_osm`:

  base       roads, rail, land use / natural / leisure polygons, waterways, power - the whole bbox
  buildings  `way[building]` within `radius` m of the stage route polyline - AFTER the route is known
             (a city has ~90 000 buildings in a 7 x 5 km box; the game only models a corridor)

Answers are cached in scripts/realmap/.cache/overpass/ (keyed by the query text).
"""

import hashlib
import math
import os
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

UA = {'User-Agent': 'MiniGamePortal-rally-mapbaker/1.0'}
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

HIGHWAYS = (
    'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track'
    '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
)
LEISURE = 'park|golf_course|pitch|garden|playground|nature_reserve|recreation_ground|cemetery'


def run(query, cache_dir, label):
    """POST an Overpass QL query, cache the XML answer, return its path."""
    key = hashlib.sha1(query.encode()).hexdigest()[:16]
    fn = os.path.join(cache_dir, 'overpass', f'{label}_{key}.xml')
    if os.path.exists(fn):
        return fn
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    # curl, not urllib: Python's bundled TLS roots reject overpass-api.de's certificate chain on some Windows
    # setups, curl uses the OS trust store (verification stays ON).
    with tempfile.NamedTemporaryFile('w', suffix='.ql', delete=False, encoding='utf8') as qf:
        qf.write(query)
    last = None
    try:
        for attempt in range(6):
            url = ENDPOINTS[attempt % len(ENDPOINTS)]
            print(f'  overpass {label} ({url.split("/")[2]})...', flush=True)
            r = subprocess.run(
                ['curl', '-sS', '-m', '900', '-A', UA['User-Agent'], '--data-urlencode', f'data@{qf.name}', url, '-o', fn + '.part'],
                capture_output=True, text=True,
            )  # fmt: skip
            head = open(fn + '.part', 'rb').read(2000) if os.path.exists(fn + '.part') else b''
            if r.returncode == 0 and b'<osm' in head:
                os.replace(fn + '.part', fn)
                print(f'    {os.path.getsize(fn) / 1e6:.1f} MB', flush=True)
                return fn
            last = r.stderr.strip() or head[:300].decode('utf8', 'replace')
            print('  retry:', last[:200], flush=True)
            time.sleep(8 + attempt * 8)
    finally:
        os.unlink(qf.name)
    raise RuntimeError(f'overpass failed: {last}')


def parse(fn):
    """Overpass / OSM XML -> (nodes {id: (lat, lon)}, ntags, ways, rels), same shape as bake.load_osm."""
    nodes, ntags, ways, rels = {}, {}, {}, []
    for _, el in ET.iterparse(fn, events=('end',)):
        if el.tag == 'node':
            nid = el.get('id')
            nodes[nid] = (float(el.get('lat')), float(el.get('lon')))
            t = {k.get('k'): k.get('v') for k in el.iter('tag')}
            if t:
                ntags[nid] = t
            el.clear()
        elif el.tag == 'way':
            t = {k.get('k'): k.get('v') for k in el.iter('tag')}
            refs = [nd.get('ref') for nd in el.iter('nd')]
            ways[el.get('id')] = {'tags': t, 'refs': [x for x in refs if x in nodes],
                                  'closed': len(refs) > 2 and refs[0] == refs[-1]}  # fmt: skip
            el.clear()
        elif el.tag == 'relation':
            t = {k.get('k'): k.get('v') for k in el.iter('tag')}
            mem = [(m.get('type'), m.get('ref'), m.get('role')) for m in el.iter('member')]
            rels.append({'tags': t, 'members': mem})
            el.clear()
    return nodes, ntags, ways, rels


def merge(a, b):
    """Merge two parse() results (b wins)."""
    a[0].update(b[0])
    a[1].update(b[1])
    a[2].update(b[2])
    a[3].extend(b[3])
    return a


def load_base(box, cache_dir):
    """box = (lat0, lat1, lon0, lon1). Everything except buildings."""
    s, n, w, e = box
    bb = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
    q = f"""[out:xml][timeout:600];
(
  way["highway"~"^({HIGHWAYS})$"]({bb});
  way["railway"~"^(rail|subway|light_rail|narrow_gauge)$"]({bb});
  way["landuse"]({bb});
  way["natural"]({bb});
  way["leisure"~"^({LEISURE})$"]({bb});
  way["waterway"]({bb});
  way["power"~"^(line|minor_line|tower|pole)$"]({bb});
  rel["landuse"]({bb});
  rel["natural"]({bb});
  rel["leisure"~"^({LEISURE})$"]({bb});
);
(._;>;);
out;"""
    return parse(run(q, cache_dir, 'base'))


def load_buildings(route_ll, radius, cache_dir, chunk=1500.0):
    """Buildings within `radius` m of the route polyline [(lat, lon), ...], queried in `chunk` m pieces
    (a long `around` polyline makes Overpass slow / refuse)."""
    out = ({}, {}, {}, [])
    pieces, cur, acc = [], [route_ll[0]], 0.0
    for p, q in zip(route_ll, route_ll[1:]):
        acc += math.hypot((q[0] - p[0]) * 111132.0, (q[1] - p[1]) * 111320.0 * math.cos(math.radians(p[0])))
        cur.append(q)
        if acc >= chunk:
            pieces.append(cur)
            cur, acc = [q], 0.0
    if len(cur) > 1:
        pieces.append(cur)
    for i, pc in enumerate(pieces):
        line = ','.join(f'{la:.5f},{lo:.5f}' for la, lo in pc)
        q = f"""[out:xml][timeout:300];
way["building"](around:{radius:.0f},{line});
(._;>;);
out;"""
        merge(out, parse(run(q, cache_dir, f'buildings{i:02d}')))
    return out
