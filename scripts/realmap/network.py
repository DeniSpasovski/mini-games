"""
Road network importer for the v2 road engine (maps with `MapDef.network`, world/v2/): OpenStreetMap ways -> a graph.

    python scripts/realmap/network.py scripts/realmap/jackie-2.json [--stats] [--survey-only [--runout-only]] [--city-buildings]

--city-buildings  re-runs only the city footprints step (config `cityBuildings`, see data.json below); --dry: counts only
--survey-only  re-applies the config's `survey` to the existing network.json (no OSM fetch: the graph stays as baked),
               then the `runout` (once); with --runout-only too, only the run-out

Writes into the config's `folder`:

  network.json  the graph read by world/v2/network.ts:
                  nodes  [osmId, x, z, flags, stageAlong]   every edge end (flags: 1 = traffic signals, 2 = stop sign;
                                                            stageAlong = m along the stage route when the node is on it,
                                                            else -1)
                  edges  {id, kind, name?, ref?, oneway?, service?, pts: [x0, z0, ...], nodes: [a, b], tags: [[seg, tag]]}
                         one edge = junction to junction: OSM way joints (degree-2 nodes, same class / name / oneway) are
                         chained away; `tags` = runs of per-segment tag sets (index into `tagSets`) starting at segment
                         `seg`, so a bridge or a lane drop inside a street keeps its own segments
                  tagSets  [{bridge?, tunnel?, layer?, lanes?, lanesFwd?, lanesBack?, width?, sidewalk?, parking?,
                           surface?, maxspeed?, turnFwd?, turnBack?}]
                  stage  {cps: route control points, spans: [{kind: bridge | under, from, to, layer}], length}
                Ids are OSM ids (edge id = first way id + piece index): stable across re-imports, so
                network-patches.json survives one.
  data.json     terrain (height grids), land cover, lakes and the buildings within `buildingsCorridor` m of the route,
                copied from the map named by `terrainFrom` (its bake: scripts/realmap/bake.py + extend.py / regrid.py)
                + config `cityBuildings`: the city footprints the bake has no building for (buildings.city_buildings; alone: --city-buildings [--dry])
  horizon.json  copied from `horizonFrom`
  route.json    the stage route's control points (the menus' outline, `info.ts`)

  survey        (config `survey`, network_survey.py): edges' `surveyWidth` (real roadbed curb to curb), the stage's
                `stage.surveyWidth` / `stage.widths`, `survey.heights` (surveyed spot heights the profiles follow),
                `survey.walls` (surveyed retaining walls)
  runout        (config `runout`, m, `extend_stage`): `stage.runout` = {pts, length}, the stage's run-out along the
                parkway past the route's end (before any bridge); the engine samples it as its own piece

Corridor: streets within `corridor.streets` m of the route, motorway / trunk (+ links) within `corridor.highways` m.
"""

import json
import math
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake  # noqa: E402
import buildings  # noqa: E402
import network_survey  # noqa: E402
import overpass as ovp  # noqa: E402

def extend_stage(network, metres):
    """Config `runout` (m): the stage carries on past its end along the edge continuing it (straightest, within 25
    degrees), to that edge's last vertex within `metres` m and before any bridge / tunnel segment. The vertices go to
    `stage.runout` = {pts, length} (the route's own control points stay as they are: the engine samples the run-out as
    a piece of its own, RoadDef.runout); the edge then starts at the new end and the stage's end node moves there.
    Applied once."""
    st = network['stage']
    if metres <= 0 or st.get('runout'):
        return
    cps = st['cps']
    end = max((n for n in network['nodes'] if n[4] >= 0), key=lambda n: n[4])
    ex, ez = cps[-1][0] - cps[-2][0], cps[-1][1] - cps[-2][1]
    el = math.hypot(ex, ez) or 1
    best = None
    for e in network['edges']:
        if e['nodes'][0] != end[0]:
            continue  # (only an edge starting here runs on from the stage end)
        p = np.array(e['pts'], float).reshape(-1, 2)
        d = p[1] - p[0]
        cos = (d[0] * ex + d[1] * ez) / (el * (np.hypot(*d) or 1))
        if cos > math.cos(math.radians(25)) and (best is None or cos > best[0]):
            best = (cos, e, p)
    if best is None:
        print(f'  runout: no edge continues the stage at node {end[0]}')
        return
    _, e, p = best
    sets = network['tagSets']
    seg_tag = []
    for k, (s0, ti) in enumerate(e['tags']):
        s1 = e['tags'][k + 1][0] if k + 1 < len(e['tags']) else len(p) - 1
        seg_tag += [ti] * (s1 - s0)
    acc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    cut = 0
    for i in range(1, len(p)):
        t = sets[seg_tag[i - 1]]
        if acc[i] > metres or t.get('bridge') or t.get('tunnel'):
            break
        cut = i
    if cut == 0 or cut >= len(p) - 1:
        print(f'  runout: edge {e["id"]} too short / starts on a structure, not extended')
        return
    st['runout'] = {
        'pts': [[round(float(p[i, 0]), 2), round(float(p[i, 1]), 2)] for i in range(1, cut + 1)],
        'length': round(float(acc[cut]), 1),
    }
    e['pts'] = [round(float(v), 2) for v in p[cut:].reshape(-1)]
    # (runs that end before the cut drop out; the run holding the cut starts at 0)
    runs = []
    for s0, ti in ([max(0, s0 - cut), ti] for s0, ti in e['tags']):
        if runs and runs[-1][0] == s0:
            runs[-1] = [s0, ti]
        else:
            runs.append([s0, ti])
    e['tags'] = runs
    end[1], end[2] = round(float(p[cut, 0]), 2), round(float(p[cut, 1]), 2)
    end[4] = round(float(st['length'] + acc[cut]), 2)
    print(f'  runout: +{acc[cut]:.1f} m along {e["id"]}')


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache')

KINDS = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'track',
}  # fmt: skip
BIG = {'motorway', 'motorway_link', 'trunk', 'trunk_link'}


def tag_set(t):
    """The per-segment tags the engine reads (absent = default)."""
    s = {}
    if t.get('bridge') not in (None, 'no'):
        s['bridge'] = True
    if t.get('tunnel') not in (None, 'no'):
        s['tunnel'] = True
    lay = t.get('layer', '')
    if lay.lstrip('-').isdigit() and int(lay) != 0:
        s['layer'] = int(lay)
    for k, o in (('lanes', 'lanes'), ('lanes:forward', 'lanesFwd'), ('lanes:backward', 'lanesBack')):
        if t.get(k, '').isdigit():
            s[o] = int(t[k])
    w = t.get('width', '').split(' ')[0]
    try:
        if w:
            s['width'] = round(float(w), 2)
    except ValueError:
        pass
    sw = t.get('sidewalk') or t.get('sidewalk:both') and 'both'
    if sw in ('both', 'left', 'right', 'no', 'none', 'separate'):
        s['sidewalk'] = 'no' if sw == 'none' else sw
    park = [t.get(f'parking:{side}', t.get(f'parking:lane:{side}', '')) for side in ('left', 'right')]
    both = t.get('parking:both', t.get('parking:lane:both', ''))
    if both:
        park = [both, both]
    if any(park):
        s['parking'] = [0 if p in ('', 'no', 'no_parking', 'no_stopping', 'separate') else 1 for p in park]
    if t.get('surface'):
        s['surface'] = t['surface']
    sp = t.get('maxspeed', '').split(' ')[0]
    if sp.isdigit():
        s['maxspeed'] = int(sp)
    if t.get('turn:lanes:forward') or t.get('turn:lanes'):
        s['turnFwd'] = t.get('turn:lanes:forward') or t.get('turn:lanes')
    if t.get('turn:lanes:backward'):
        s['turnBack'] = t['turn:lanes:backward']
    return s


def main():
    cfg_path = sys.argv[1]
    stats = '--stats' in sys.argv
    cfg = json.load(open(cfg_path))
    proj = bake.Proj(*cfg['origin'])
    folder = os.path.join(ROOT, cfg['folder'])
    os.makedirs(folder, exist_ok=True)
    if '--city-buildings' in sys.argv:
        buildings.city_buildings(cfg_path, '--dry' in sys.argv)
        return
    if '--survey-only' in sys.argv:
        fn = os.path.join(folder, 'network.json')
        network = json.load(open(fn))
        if '--runout-only' not in sys.argv:
            network_survey.apply(cfg, ROOT, proj, network, network['stage']['cps'])
        extend_stage(network, cfg.get('runout', 0))
        with open(fn, 'w') as f:
            json.dump(network, f, separators=(',', ':'))
        if '--runout-only' not in sys.argv:
            network_survey.lidar_terrain(cfg, ROOT, proj, network, os.path.join(folder, 'data.json'))
        return

    def ll_box(ext, pad=0):
        la0, lo0 = proj.inv(ext[0] - pad, ext[2] - pad)
        la1, lo1 = proj.inv(ext[1] + pad, ext[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    print('osm...')
    nodes, ntags, ways, _rels = ovp.load_base(ll_box(cfg['osmBox'], 150), CACHE)
    print(f'  {len(nodes)} nodes, {len(ways)} ways')

    print('route...')
    raw, route_ids = bake.route_through(cfg['waypoints'], nodes, ways, proj, opts=cfg.get('route'))
    bake.report_route(route_ids, ways)
    cps, smooth = bake.control_points(raw, cfg['routeSmoothSigma'], cfg['routeTolerance'], cfg.get('minCornerRadius', 12))
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(smooth, axis=0), axis=1))])
    spans = bake.route_spans(route_ids, raw, ways, smooth)
    print(f'  route {acc[-1]:.0f} m, {len(cps)} control points; spans: '
          + ', '.join(f'{s["kind"]} {s["from"]}-{s["to"]}' for s in spans))  # fmt: skip
    route_kd = cKDTree(smooth)
    route_set = set(route_ids)
    route_segs = {(a, b) for a, b in zip(route_ids, route_ids[1:])} | {(b, a) for a, b in zip(route_ids, route_ids[1:])}

    xy = {}

    def pt(n):
        p = xy.get(n)
        if p is None:
            p = xy[n] = proj.fwd(*nodes[n])
        return p

    # 1. Runs: the kept pieces of every road way (stage segments and the parts outside the corridor dropped).
    cor = cfg['corridor']
    drop_service = set(cfg.get('dropService', ()))
    tag_sets, tag_index = [], {}

    def tag_id(t):
        s = tag_set(t)
        key = json.dumps(s, sort_keys=True)
        if key not in tag_index:
            tag_index[key] = len(tag_sets)
            tag_sets.append(s)
        return tag_index[key]

    runs = []  # (way id, refs, tag id)
    for wid, w in ways.items():
        t = w['tags']
        kind = t.get('highway')
        if kind not in KINDS or t.get('area') == 'yes' or len(w['refs']) < 2:
            continue
        if kind == 'service' and t.get('service') in drop_service:
            continue
        refs = list(w['refs'])
        if t.get('oneway') == '-1':
            refs = refs[::-1]
        lim = cor['highways'] if kind in BIG else cor['streets']
        d = route_kd.query(np.array([pt(r) for r in refs]))[0]
        tid = tag_id(t)
        cur = [refs[0]]
        for i, (a, b) in enumerate(zip(refs, refs[1:])):
            keep = (a, b) not in route_segs and min(d[i], d[i + 1]) <= lim
            if keep:
                cur.append(b)
            else:
                if len(cur) > 1:
                    runs.append((wid, cur, tid))
                cur = [b]
        if len(cur) > 1:
            runs.append((wid, cur, tid))
    print(f'  {len(runs)} way runs in the corridor')

    # 2. Split at every node used by another run (or twice by one), or on the stage route.
    occ = {}
    for _, refs, _ in runs:
        for r in refs:
            occ[r] = occ.get(r, 0) + 1
    split = {r for r, c in occ.items() if c > 1} | (set(occ) & route_set)
    pieces = []  # [way id, refs, [tag id per segment]]
    for wid, refs, tid in runs:
        cur = [refs[0]]
        k = 0
        for r in refs[1:]:
            cur.append(r)
            if r in split and r != refs[-1]:
                pieces.append([wid, cur, [tid] * (len(cur) - 1), k])
                cur = [r]
                k += 1
        pieces.append([wid, cur, [tid] * (len(cur) - 1), k])

    # 3. Chain pieces across degree-2 nodes that only join two pieces of the same street (OSM way joints).
    def street_key(wid):
        # (a tunnel is its own edge: down there a street gets a different section)
        t = ways[wid]['tags']
        tunnel = t.get('tunnel') not in (None, 'no')
        return (t.get('highway'), t.get('name', ''), t.get('oneway') in ('yes', '-1', '1', 'true'), t.get('junction', ''), tunnel)

    ends = {}
    for i, p in enumerate(pieces):
        ends.setdefault(p[1][0], []).append((i, False))
        ends.setdefault(p[1][-1], []).append((i, True))
    used = [False] * len(pieces)

    def joinable(n):
        e = ends.get(n, [])
        if len(e) != 2 or n in route_set or occ.get(n, 0) > 2:
            return None
        (i, ai), (j, aj) = e
        if i == j or street_key(pieces[i][0]) != street_key(pieces[j][0]):
            return None
        oneway = street_key(pieces[i][0])[2]
        if oneway and ai == aj:
            return None  # two one-way pieces both ending (or starting) here: opposite directions
        return e

    edges = []
    for i0 in range(len(pieces)):
        if used[i0]:
            continue
        used[i0] = True
        refs = list(pieces[i0][1])
        segs = list(pieces[i0][2])
        wid0, k0 = pieces[i0][0], pieces[i0][3]
        for forward in (True, False):
            while True:
                n = refs[-1] if forward else refs[0]
                e = joinable(n)
                if not e:
                    break
                nxt = [(j, aj) for j, aj in e if not used[j]]
                if not nxt:
                    break
                j, aj = nxt[0]
                used[j] = True
                r2, s2 = list(pieces[j][1]), list(pieces[j][2])
                if forward:
                    if aj:  # piece j ends at n: reverse it
                        r2, s2 = r2[::-1], s2[::-1]
                    refs += r2[1:]
                    segs += s2
                else:
                    if not aj:  # piece j starts at n: reverse it
                        r2, s2 = r2[::-1], s2[::-1]
                    refs = r2[:-1] + refs
                    segs = s2 + segs
                if refs[0] == refs[-1]:
                    break
        edges.append((wid0, k0, refs, segs))

    # 4. Output.
    def sig(n):
        t = ntags.get(n, {})
        return (1 if t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals' else 0) | (
            2 if t.get('highway') == 'stop' else 0
        )

    node_out = {}

    def node_ref(n):
        if n not in node_out:
            x, z = pt(n)
            along = -1.0
            if n in route_set:
                along = round(float(acc[route_kd.query([x, z])[1]]), 2)
            node_out[n] = [int(n), round(x, 2), round(z, 2), sig(n), along]
        return int(n)

    out_edges = []
    seen_ids = {}
    for wid, k, refs, segs in edges:
        t = ways[wid]['tags']
        eid = f'{wid}.{k}'
        if eid in seen_ids:
            seen_ids[eid] += 1
            eid = f'{eid}.{seen_ids[eid]}'
        else:
            seen_ids[eid] = 0
        tags = []
        for s, tid in enumerate(segs):
            if not tags or tags[-1][1] != tid:
                tags.append([s, tid])
        e = {
            'id': eid,
            'kind': t['highway'],
            'pts': [round(v, 2) for r in refs for v in pt(r)],
            'nodes': [node_ref(refs[0]), node_ref(refs[-1])],
            'tags': tags,
        }
        if t.get('name'):
            e['name'] = t['name']
        if t.get('ref'):
            e['ref'] = t['ref']
        if t.get('oneway') in ('yes', '-1', '1', 'true') or t.get('junction') == 'roundabout':
            e['oneway'] = True
        if t.get('service'):
            e['service'] = t['service']
        out_edges.append(e)
    network = {
        'meta': {
            'generated': 'scripts/realmap/network.py ' + os.path.relpath(cfg_path, ROOT).replace(os.sep, '/'),
            'origin': cfg['origin'],
            'source': '(c) OpenStreetMap contributors (ODbL)',
        },
        'stage': {
            'cps': [[round(float(x), 2), round(float(z), 2)] for x, z in cps],
            'spans': spans,
            'length': round(float(acc[-1]), 1),
        },
        'nodes': sorted(node_out.values()),
        'tagSets': tag_sets,
        'edges': out_edges,
    }
    network_survey.apply(cfg, ROOT, proj, network, smooth)
    extend_stage(network, cfg.get('runout', 0))
    with open(os.path.join(folder, 'network.json'), 'w') as f:
        json.dump(network, f, separators=(',', ':'))
    # The menus' light route outline (maps/<id>/info.ts must not import the big files).
    with open(os.path.join(folder, 'route.json'), 'w') as f:
        json.dump({'meta': {'origin': cfg['origin']}, 'route': network['stage']['cps']}, f, separators=(',', ':'))
    kinds = {}
    for e in out_edges:
        kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
    print(f'  network: {len(node_out)} nodes, {len(out_edges)} edges (from {len(runs)} runs), {len(tag_sets)} tag sets')
    print('  ' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])))
    if stats:
        deg = {}
        for e in out_edges:
            for n in e['nodes']:
                deg[n] = deg.get(n, 0) + 1
        hist = {}
        for v in deg.values():
            hist[v] = hist.get(v, 0) + 1
        print('  node degree histogram:', dict(sorted(hist.items())))

    # 5. Terrain, land cover, lakes, buildings from the source map's bake.
    src = json.load(open(os.path.join(ROOT, cfg['terrainFrom'])))
    b = src['buildings']
    xi, zi = b['fields'].index('x'), b['fields'].index('z')
    d = route_kd.query(np.array([[r[xi], r[zi]] for r in b['rows']]))[0]
    keep = d <= cfg['buildingsCorridor']
    rows = [r for r, k in zip(b['rows'], keep) if k]
    ids = {str(r[b['fields'].index('id')]) for r in rows}
    polys = {k: v for k, v in (b.get('polys') or {}).items() if k in ids}
    data = {
        'meta': {
            'name': cfg['name'],
            'origin': cfg['origin'],
            'generated': network['meta']['generated'],
            'sources': src['meta']['sources'],
            'axes': src['meta']['axes'],
            'terrainFrom': cfg['terrainFrom'],
        },
        'heightmap': src['heightmap'],
        'landcover': src['landcover'],
        'lakes': src.get('lakes', []),
        'buildings': {**b, 'rows': rows, 'polys': polys},
    }
    with open(os.path.join(folder, 'data.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  data.json: {len(rows)} of {len(b["rows"])} buildings')
    if cfg.get('cityBuildings'):
        buildings.city_buildings(cfg_path)
    network_survey.lidar_terrain(cfg, ROOT, proj, network, os.path.join(folder, 'data.json'))
    if cfg.get('horizonFrom'):
        with open(os.path.join(ROOT, cfg['horizonFrom'])) as f:
            hz = f.read()
        with open(os.path.join(folder, 'horizon.json'), 'w') as f:
            f.write(hz)


if __name__ == '__main__':
    main()
