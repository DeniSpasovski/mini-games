"""The END BOX of the Jackie map (Kew Gardens end, see maps/jackie/TODO.md "WORK PACKAGE") in lat / lon.

    python scripts/realmap/endbox.py [margin_m]      # prints the polygon + the Socrata / Overpass forms

World box (bake.py Proj, origin from scripts/realmap/jackie.json; +X east, +Z south): x 1500..4300, z -2300..-900.
Other scripts import `box_ll(margin)` / `socrata_polygon(margin)` / `contains(x, z, margin)`.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import Proj  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'jackie.json')
X0, X1, Z0, Z1 = 1500.0, 4300.0, -2300.0, -900.0


def proj():
    return Proj(*json.load(open(CONFIG))['origin'])


def box_world(margin=0.0):
    """Corners (x, z), clockwise from the north-west."""
    return [(X0 - margin, Z0 - margin), (X1 + margin, Z0 - margin), (X1 + margin, Z1 + margin), (X0 - margin, Z1 + margin)]


def box_ll(margin=0.0):
    """Corners as (lat, lon)."""
    p = proj()
    return [p.inv(x, z) for x, z in box_world(margin)]


def bbox_ll(margin=0.0):
    """(south, west, north, east)."""
    ll = box_ll(margin)
    lats, lons = [a for a, _ in ll], [b for _, b in ll]
    return min(lats), min(lons), max(lats), max(lons)


def socrata_polygon(margin=0.0):
    """WKT for `$where=intersects(the_geom, '<wkt>')` (lon lat order, closed ring)."""
    ll = box_ll(margin)
    ring = [f'{lon:.6f} {lat:.6f}' for lat, lon in ll] + [f'{ll[0][1]:.6f} {ll[0][0]:.6f}']
    return f'POLYGON(({", ".join(ring)}))'


def contains(x, z, margin=0.0):
    return X0 - margin <= x <= X1 + margin and Z0 - margin <= z <= Z1 + margin


if __name__ == '__main__':
    m = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    s, w, n, e = bbox_ll(m)
    print(f'END BOX +{m:g} m  x {X0 - m:g}..{X1 + m:g}  z {Z0 - m:g}..{Z1 + m:g}')
    print(f'  bbox south,west,north,east: {s:.6f},{w:.6f},{n:.6f},{e:.6f}')
    print(f'  socrata: {socrata_polygon(m)}')
    print(f'  overpass bbox: ({s:.6f},{w:.6f},{n:.6f},{e:.6f})')
