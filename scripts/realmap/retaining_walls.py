"""
Jackie's retaining walls beside the parkway: NYC Planimetric Database retaining walls (feature code 2460) near the stage
road -> src/games/rally/maps/jackie/retaining-walls.json ({walls: [[x0, z0, x1, z1, ...], ...]}, world m). The game
steps the terrain at each line (land held at its top on one side, at its foot on the other) and builds the wall there
(`MapDef.retainingWalls`).

    python scripts/realmap/retaining_walls.py

Needs the files nyc_pull.py writes (`sources/maps/jackie/nyc-planimetrics/{west,endbox}-retaining-wall.geojson`).
Kept: walls within REACH m of the route up to UNTIL m along it (START_REACH round the start bridges); the sunken end of
the parkway (the Union Tpke overlook, the Kew Gardens trench, the Queens Blvd portal) has its own walls (cut walls of
the carriageways, portals). Two pieces that continue each other (ends JOIN_GAP m apart at most, in line, on the same side
of the route, no road through the gap) are one wall: the survey splits a wall at joints, and the land fell into the gap.
Under a bridge deck (DECK_GAP) the two pieces either side are the abutment's wing walls: joined whatever their direction.
"""

import json
import os
import sys

import numpy as np
from shapely.geometry import LineString, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endbox  # noqa: E402
import streets  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MAP = os.path.join(ROOT, 'src', 'games', 'rally', 'maps', 'jackie')
NYC = os.path.join(ROOT, 'sources', 'maps', 'jackie', 'nyc-planimetrics')
OUT = os.path.join(MAP, 'retaining-walls.json')
REACH = 60.0
START_REACH = 240.0
UNTIL = 6700.0
MIN_LEN = 8.0
SIMPLIFY = 0.25
JOIN_GAP = 25.0
JOIN_COS = 0.9
DECK_GAP = 30.0  # m: pieces either side of a bridge deck (wing walls) are joined under it, whatever their end direction


def join_walls(walls, route, roads, decks, lanes):
    """Merge wall pieces that continue each other (see the file comment)."""
    walls = [np.array(w, float).reshape(-1, 2) for w in walls]

    def side(xy):
        mid = LineString(xy).interpolate(0.5, normalized=True)
        a = route.project(mid)
        p = np.array(route.interpolate(a).coords[0])
        q = np.array(route.interpolate(min(route.length, a + 1)).coords[0])
        t = q - p
        return np.sign(t[0] * (mid.y - p[1]) - t[1] * (mid.x - p[0]))

    def unit(v):
        return v / (np.linalg.norm(v) or 1)

    merged = True
    while merged:
        merged = False
        for i in range(len(walls)):
            for j in range(len(walls)):
                if i == j or side(walls[i]) != side(walls[j]):
                    continue
                # (a piece may run either way)
                for a, b in (
                    (walls[i], walls[j]),
                    (walls[i], walls[j][::-1]),
                    (walls[i][::-1], walls[j]),
                    (walls[i][::-1], walls[j][::-1]),
                ):
                    gap = b[0] - a[-1]
                    g = np.linalg.norm(gap)
                    if g > max(JOIN_GAP, DECK_GAP):
                        continue
                    if g > 0.5:
                        d = unit(gap)
                        gap_line = LineString([a[-1], b[0]])
                        # under a bridge deck the pieces are the abutment's wing walls: the face runs between them
                        under = (
                            g <= DECK_GAP
                            and gap_line.interpolate(0.5, normalized=True).distance(decks) < 3
                            and gap_line.distance(lanes) > 0.5  # never across a carriageway / ramp
                            and gap_line.distance(route) > 6
                        )
                        if not under and (
                            g > JOIN_GAP
                            or np.dot(unit(a[-1] - a[-2]), d) < JOIN_COS
                            or np.dot(unit(b[1] - b[0]), d) < JOIN_COS
                        ):
                            continue
                        # (under a deck the streets at its ends run above the wall)
                        if not under and gap_line.distance(roads) < 3:
                            continue
                    walls[i] = np.concatenate([a, b[1:] if g <= 0.5 else b])
                    del walls[j]
                    merged = True
                    break
                if merged:
                    break
            if merged:
                break
    return [[round(float(v), 2) for v in w.ravel()] for w in walls]


def main():
    data = json.load(open(os.path.join(MAP, 'data.json'), encoding='utf-8'))
    route = LineString(np.array(data['route'], float))
    tr = streets.world_transform(endbox.proj())
    seen, walls = set(), []
    for region in ('west', 'endbox'):
        for f in json.load(open(os.path.join(NYC, f'{region}-retaining-wall.geojson'), encoding='utf-8'))['features']:
            if not f['geometry']:
                continue
            g = tr(shape(f['geometry']))
            for ln in g.geoms if g.geom_type.startswith('Multi') else [g]:
                ln = ln.simplify(SIMPLIFY)
                key = tuple(np.round(np.array(ln.coords).ravel(), 1))
                if key in seen or ln.length < MIN_LEN:
                    continue
                seen.add(key)
                mid = ln.interpolate(0.5, normalized=True)
                a = route.project(mid)
                reach = START_REACH if a < 1 else REACH
                if a > UNTIL or route.distance(ln) > reach:
                    continue
                walls.append([round(v, 2) for xy in ln.coords for v in xy])
    roads = unary_union([
        LineString(np.array(p['pts']).reshape(-1, 2)).buffer(p['width'] / 2)
        for p in data['paths'] if p['surface'] == 'tarmac' and not p.get('bridge') and len(p['pts']) >= 4
    ])  # fmt: skip
    n0 = len(walls)
    decks = unary_union([
        LineString(np.array(p['pts']).reshape(-1, 2)).buffer(p['width'] / 2)
        for p in data['paths'] if p.get('bridge') and len(p['pts']) >= 4
    ])  # fmt: skip
    lanes = unary_union([
        LineString(np.array(p['pts']).reshape(-1, 2)).buffer(p['width'] / 2)
        for p in data['paths']
        if not p.get('bridge') and len(p['pts']) >= 4 and p['kind'] in ('motorway', 'trunk', 'motorway_link', 'trunk_link')
    ])  # fmt: skip
    walls = join_walls(walls, route, roads, decks, lanes)
    print(f'joined {n0 - len(walls)} wall pieces')
    walls.sort(key=lambda w: route.project(LineString(np.array(w).reshape(-1, 2)).interpolate(0.5, normalized=True)))
    with open(OUT, 'w') as f:
        json.dump(
            {
                'source': 'NYC Planimetric Database: retaining walls (NYC Open Data); scripts/realmap/retaining_walls.py',
                'walls': walls,
            },
            f,
            separators=(',', ':'),
        )
    total = sum(LineString(np.array(w).reshape(-1, 2)).length for w in walls)
    print(f'{len(walls)} walls, {total:.0f} m -> {OUT}')


if __name__ == '__main__':
    main()
