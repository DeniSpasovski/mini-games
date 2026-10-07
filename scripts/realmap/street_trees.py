"""Street trees of the Jackie map from the NYC Street Tree Census 2015 -> maps/jackie/street-trees.json.

    python scripts/realmap/street_trees.py

Alive trees of `sources/maps/jackie/nyc-planimetrics/endbox-trees.json` (inside the END BOX) and `west-trees.json` (inside the
WEST corridor, corridor.py) - both from nyc_pull.py - as a flat [x, z, trunk diameter in inches, ...] list (world metres).
Trees standing on the roadbed (census points off by a few metres) are dropped. Credit: NYC Parks, NYC Open Data (no
restrictions on use).
"""

import json
import os
import sys

from shapely.geometry import Point
from shapely.prepared import prep

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corridor  # noqa: E402
import endbox  # noqa: E402
import streets  # noqa: E402

OUT = os.path.join(streets.ROOT, 'src', 'games', 'rally', 'maps', 'jackie', 'street-trees.json')


def main():
    proj = endbox.proj()
    tr = streets.world_transform(proj)
    out, dropped = [], 0
    for region in ('endbox', 'west'):
        fn = os.path.join(streets.NYC, f'{region}-trees.json')
        if not os.path.exists(fn):
            print(f'{region}: no trees file (python scripts/realmap/nyc_pull.py{" --region west" if region == "west" else ""})')
            continue
        streets.set_region(region)
        road = prep(streets.load_union('roadbed', tr).buffer(-0.3))
        n0 = len(out)
        for t in json.load(open(fn, encoding='utf-8')):
            if t.get('status') != 'Alive':
                continue
            x, z = proj.fwd(float(t['latitude']), float(t['longitude']))
            if region == 'endbox' and not endbox.contains(x, z):
                continue
            if region == 'west' and not corridor.contains(x, z):
                continue
            if road.contains(Point(x, z)):
                dropped += 1
                continue
            out += [round(x, 1), round(z, 1), int(float(t.get('tree_dbh') or 0))]
        print(f'{region}: {(len(out) - n0) // 3} trees')
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(out) // 3} trees ({dropped} on the roadbed dropped) -> {os.path.relpath(OUT, streets.ROOT)}')


if __name__ == '__main__':
    main()
