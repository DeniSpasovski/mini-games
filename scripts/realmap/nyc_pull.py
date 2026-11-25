"""Download NYC Open Data layers for the Jackie END BOX (scripts/realmap/endbox.py) into sources/maps/jackie/ (git-ignored).

    python scripts/realmap/nyc_pull.py [--force] [layer ...]
    python scripts/realmap/nyc_pull.py --region west [--force] [layer ...]   # the WEST corridor (corridor.py): west-<layer>.*

Layers (Socrata dataset ids in LAYERS, checked in the catalog 2026-10-06): NYC Planimetric Database (OTI) polygons /
lines / points, CSCL Centerline (DOT), Street Tree Census 2015 (Parks).
Files: sources/maps/jackie/nyc-planimetrics/endbox-<layer>.geojson (trees: .json). Cached: an existing file is kept unless
--force. NYC Open Data has no use restrictions; credit "NYC Office of Technology and Innovation (OTI)" / DOT / Parks.
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corridor  # noqa: E402
import endbox  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'nyc-planimetrics')
MARGIN = 100  # m around the END BOX
PAGE = 20000

LAYERS = {
    'roadbed': 'i36f-5ih7',  # Planimetric: Roadbed (polygons: every carriageway, ramps, the parkway)
    'sidewalk': '52n9-sdep',  # Planimetric: Sidewalk polygons
    'curbs': '5xvt-8cbk',  # Planimetric: Curbs (lines)
    'pavement-edge': 'vs44-rznx',  # Planimetric: Pavement Edge (lines)
    'median': 'ees7-4ufv',  # Planimetric: Median polygons
    'elevation': '9uxf-ng6q',  # Planimetric: Elevation Points (spot heights, points)
    'parking-lot': '7cgt-uhhz',  # Planimetric: Parking Lot polygons
    'transport': 'r9cu-9r7b',  # Planimetric: Transportation Structures (bridges, overpasses, ramps' structures)
    'retaining-wall': 's2pi-ccum',  # Planimetric: Retaining Wall
    'misc': '92m5-3pwp',  # Planimetric: Miscellaneous Structures
    'cscl': 'inkn-q76z',  # CSCL street Centerline: streetwidth (ft), number_*_lanes, trafdir, rw_type, posted_speed
}
TREES = 'uvpi-gqnh'  # 2015 Street Tree Census (JSON, latitude / longitude columns)


def curl_json(url):
    r = subprocess.run(['curl', '-sS', '-m', '300', '-A', 'MiniGamePortal-rally-mapbaker/1.0', '-G', url[0], *url[1]], capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode('utf8', 'replace'))
    return json.loads(r.stdout)


def pull_geo(name, dataset, force):
    fn = os.path.join(OUT, f'endbox-{name}.geojson')
    if os.path.exists(fn) and not force:
        print(f'  {name}: cached ({os.path.getsize(fn) // 1024} KB)')
        return
    feats, off = [], 0
    while True:
        j = curl_json(
            (
                f'https://data.cityofnewyork.us/resource/{dataset}.geojson',
                [
                    '--data-urlencode', f"$where=intersects(the_geom, '{endbox.socrata_polygon(MARGIN)}')",
                    '--data-urlencode', f'$limit={PAGE}',
                    '--data-urlencode', f'$offset={off}',
                    '--data-urlencode', '$order=:id',
                ],
            )
        )  # fmt: skip
        if 'features' not in j:
            raise RuntimeError(f'{name}: unexpected answer {str(j)[:300]}')
        feats += j['features']
        if len(j['features']) < PAGE:
            break
        off += PAGE
    os.makedirs(OUT, exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(fn, 'w'), separators=(',', ':'))
    print(f'  {name}: {len(feats)} features -> {os.path.basename(fn)} ({os.path.getsize(fn) // 1024} KB)')


def pull_trees(force):
    fn = os.path.join(OUT, 'endbox-trees.json')
    if os.path.exists(fn) and not force:
        print(f'  trees: cached ({os.path.getsize(fn) // 1024} KB)')
        return
    s, w, n, e = endbox.bbox_ll(MARGIN)
    rows, off = [], 0
    while True:
        j = curl_json(
            (
                f'https://data.cityofnewyork.us/resource/{TREES}.json',
                [
                    '--data-urlencode', f'$where=latitude > {s} AND latitude < {n} AND longitude > {w} AND longitude < {e}',
                    '--data-urlencode', f'$limit={PAGE}',
                    '--data-urlencode', f'$offset={off}',
                    '--data-urlencode', '$order=tree_id',
                ],
            )
        )  # fmt: skip
        if not isinstance(j, list):
            raise RuntimeError(f'trees: unexpected answer {str(j)[:300]}')
        rows += j
        if len(j) < PAGE:
            break
        off += PAGE
    os.makedirs(OUT, exist_ok=True)
    json.dump(rows, open(fn, 'w'), separators=(',', ':'))
    print(f'  trees: {len(rows)} -> {os.path.basename(fn)} ({os.path.getsize(fn) // 1024} KB)')


# --- the WEST corridor: one query per pull chunk, features merged (chunks overlap) ------------------------------------
# What the street model (streets.py) and the street trees need there.
WEST_LAYERS = ('roadbed', 'sidewalk', 'median', 'cscl')


def pull_geo_west(name, dataset, force):
    fn = os.path.join(OUT, f'west-{name}.geojson')
    if os.path.exists(fn) and not force:
        print(f'  {name}: cached ({os.path.getsize(fn) // 1024} KB)')
        return
    feats = {}
    for poly in corridor.socrata_polys():
        off = 0
        while True:
            j = curl_json(
                (
                    f'https://data.cityofnewyork.us/resource/{dataset}.geojson',
                    [
                        '--data-urlencode', f"$where=intersects(the_geom, '{poly}')",
                        '--data-urlencode', f'$limit={PAGE}',
                        '--data-urlencode', f'$offset={off}',
                        '--data-urlencode', '$order=:id',
                    ],
                )
            )  # fmt: skip
            if 'features' not in j:
                raise RuntimeError(f'{name}: unexpected answer {str(j)[:300]}')
            for f in j['features']:
                feats[json.dumps(f['geometry'], sort_keys=True)] = f
            if len(j['features']) < PAGE:
                break
            off += PAGE
    os.makedirs(OUT, exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': list(feats.values())}, open(fn, 'w'), separators=(',', ':'))
    print(f'  {name}: {len(feats)} features -> {os.path.basename(fn)} ({os.path.getsize(fn) // 1024} KB)')


def pull_trees_west(force):
    fn = os.path.join(OUT, 'west-trees.json')
    if os.path.exists(fn) and not force:
        print(f'  trees: cached ({os.path.getsize(fn) // 1024} KB)')
        return
    rows = {}
    for s, w, n, e in corridor.bbox_ll_chunks():
        off = 0
        while True:
            j = curl_json(
                (
                    f'https://data.cityofnewyork.us/resource/{TREES}.json',
                    [
                        '--data-urlencode', f'$where=latitude > {s} AND latitude < {n} AND longitude > {w} AND longitude < {e}',
                        '--data-urlencode', f'$limit={PAGE}',
                        '--data-urlencode', f'$offset={off}',
                        '--data-urlencode', '$order=tree_id',
                    ],
                )
            )  # fmt: skip
            if not isinstance(j, list):
                raise RuntimeError(f'trees: unexpected answer {str(j)[:300]}')
            for t in j:
                rows[t.get('tree_id')] = t
            if len(j) < PAGE:
                break
            off += PAGE
    os.makedirs(OUT, exist_ok=True)
    json.dump(list(rows.values()), open(fn, 'w'), separators=(',', ':'))
    print(f'  trees: {len(rows)} -> {os.path.basename(fn)} ({os.path.getsize(fn) // 1024} KB)')


if __name__ == '__main__' and '--region' in sys.argv:
    region = sys.argv[sys.argv.index('--region') + 1]
    if region != 'west':
        sys.exit(f'unknown region {region} (west)')
    args = [a for a in sys.argv[1:] if not a.startswith('--') and a != region]
    force = '--force' in sys.argv
    print(f'WEST corridor: {len(corridor.socrata_polys())} chunks')
    for name in args or [*WEST_LAYERS, 'trees']:
        if name == 'trees':
            pull_trees_west(force)
        else:
            pull_geo_west(name, LAYERS[name], force)

if __name__ == '__main__' and '--region' not in sys.argv:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    todo = args or [*LAYERS, 'trees']
    print(f'END BOX +{MARGIN} m: {endbox.socrata_polygon(MARGIN)}')
    for name in todo:
        if name == 'trees':
            pull_trees(force)
        else:
            pull_geo(name, LAYERS[name], force)
