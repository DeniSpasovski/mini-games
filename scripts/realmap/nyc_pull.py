"""Download NYC Open Data layers for the Jackie maps into sources/maps/jackie/ (git-ignored): the END BOX (the Kew Gardens
end, ENDBOX below) and the WEST corridor (the rest of the route, chunks along it).

    python scripts/realmap/nyc_pull.py [--force] [layer ...]
    python scripts/realmap/nyc_pull.py --region west [--force] [layer ...]   # the WEST corridor: west-<layer>.*

Layers (Socrata dataset ids in LAYERS, checked in the catalog 2026-10-06): NYC Planimetric Database (OTI) polygons /
lines / points, CSCL Centerline (DOT), Street Tree Census 2015 (Parks).
Files: sources/maps/jackie/nyc-planimetrics/endbox-<layer>.geojson (trees: .json). Cached: an existing file is kept unless
--force. NYC Open Data has no use restrictions; credit "NYC Office of Technology and Innovation (OTI)" / DOT / Parks.
"""

import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import Proj  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'nyc-planimetrics')
MARGIN = 100  # m around the END BOX
PAGE = 20000
# The END BOX (world x0, x1, z0, z1; bake.py Proj at jackie.json's origin, +X east, +Z south) and the WEST corridor: the
# v1 route (maps/jackie/data.json) in CHUNK m pieces, each grown by REACH m (boxes wholly inside the END BOX skipped).
ENDBOX = (1500.0, 4300.0, -2300.0, -900.0)
ROUTE = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'data.json')
REACH = 560.0
CHUNK = 600.0


def proj():
    return Proj(*json.load(open(os.path.join(HERE, 'jackie.json')))['origin'])


def corners_ll(x0, z0, x1, z1):
    p = proj()
    return [p.inv(x, z) for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]]


def wkt(ll):
    """WKT for `$where=intersects(the_geom, '<wkt>')` (lon lat order, closed ring)."""
    ring = [f'{lon:.6f} {lat:.6f}' for lat, lon in ll + ll[:1]]
    return f'POLYGON(({", ".join(ring)}))'


def bbox(ll):
    """(south, west, north, east)."""
    lats, lons = [a for a, _ in ll], [b for _, b in ll]
    return min(lats), min(lons), max(lats), max(lons)


def endbox_ll(margin):
    x0, x1, z0, z1 = ENDBOX
    return corners_ll(x0 - margin, z0 - margin, x1 + margin, z1 + margin)


def west_chunks(margin=40.0):
    """World boxes (x0, z0, x1, z1) of the WEST corridor's pull chunks."""
    r = np.array(json.load(open(ROUTE, encoding='utf-8'))['route'], float)
    along = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(r, axis=0).T))])
    ex0, ex1, ez0, ez1 = ENDBOX
    out = []
    for a0 in np.arange(0, along[-1], CHUNK):
        pts = r[(along >= a0 - 30) & (along <= a0 + CHUNK + 30)]
        (x0, z0), (x1, z1) = pts.min(axis=0) - REACH - margin, pts.max(axis=0) + REACH + margin
        if not (x0 >= ex0 and x1 <= ex1 and z0 >= ez0 and z1 <= ez1):
            out.append((x0, z0, x1, z1))
    return out

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
    'footprints': '5zhs-2jue',  # Building Footprints (OTI): bin, height_roof (ft), construction_year, feature_code
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
                    '--data-urlencode', f"$where=intersects(the_geom, '{wkt(endbox_ll(MARGIN))}')",
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
    s, w, n, e = bbox(endbox_ll(MARGIN))
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
# The roadbed, sidewalks, medians and centrelines (the v2 survey's widths and lines) and the trees.
WEST_LAYERS = ('roadbed', 'sidewalk', 'median', 'cscl')


def pull_geo_west(name, dataset, force):
    fn = os.path.join(OUT, f'west-{name}.geojson')
    if os.path.exists(fn) and not force:
        print(f'  {name}: cached ({os.path.getsize(fn) // 1024} KB)')
        return
    feats = {}
    for poly in (wkt(corners_ll(*c)) for c in west_chunks()):
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
    for s, w, n, e in (bbox(corners_ll(*c)) for c in west_chunks()):
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
    print(f'WEST corridor: {len(west_chunks())} chunks')
    for name in args or [*WEST_LAYERS, 'trees']:
        if name == 'trees':
            pull_trees_west(force)
        else:
            pull_geo_west(name, LAYERS[name], force)

if __name__ == '__main__' and '--region' not in sys.argv:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    todo = args or [*LAYERS, 'trees']
    print(f'END BOX +{MARGIN} m: {wkt(endbox_ll(MARGIN))}')
    for name in todo:
        if name == 'trees':
            pull_trees(force)
        else:
            pull_geo(name, LAYERS[name], force)
