"""
Lidar canopy: the woods along the stage road from the survey lidar (survey.lidar, network_survey.py), tree by tree.

    python scripts/realmap/lidar_canopy.py scripts/realmap/jackie-2.json

Reads the bake config's "lidarCanopy" block:

    "lidarCanopy": { "from": 1000, "to": 5600, "reach": 110, "verge": 30, "overhang": 7, "minHeight": 3,
                     "out": "src/games/rally/maps/jackie-2/canopy.json" }

- The canopy height model: per 1 m cell the 95th percentile of every return but noise, buildings, water and overlap
  ground, less the ground (the lidar's own ground grid, network_survey.lidar_ground); building footprints are cut out.
  Cached per lidar region as `top-<box>.npz` beside the ground grids (git-ignored, in sources/).
- `trees`: x, z, height (m) of every crown (canopy.crowns) within `reach` m of the stage line between `from` and `to`
  (stage metres): the map's `realTrees`. A crown over the stage's carriageway or its right verge (closer than
  `overhang` m) is a tree beside it leaning in: it is moved out to `overhang` m. `lawns` ([from, to, width], stage
  metres and m from the line): a mown lawn on the right there - its cells `verge`, its trees moved out to its far edge.
- The land cover (data.json) within that band is redrawn from the canopy: cells under closed canopy become `woods`
  (forest floor; the trees are the real ones), open cells within `verge` m of the stage line that the raster calls
  built-up or bare become `verge` (mown grass), as do open wood and grass cells. Cemeteries, water and cells with a
  building are kept.
"""

import json
import math
import os
import sys
from itertools import pairwise

import numpy as np
from scipy.ndimage import maximum_filter, uniform_filter
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj, rle_b64  # noqa: E402
from canopy import crowns  # noqa: E402
from leaf_type import rle_decode  # noqa: E402
from network_survey import LIDAR_NOISE, lidar_ground, lidar_points, lidar_regions  # noqa: E402

# Returns that are not canopy: building, low noise, water, overlap ground (this survey's classes: 17 holds the overlap
# flight lines' unclassified returns, trees among them).
NOT_CANOPY = (6, 7, 9, 18)
SOURCE = 'Tree heights: USGS 3DEP lidar, NY New York City 2017 (public domain)'


def stage_line(network):
    p = np.asarray(network['stage']['cps'], float)[:, :2]
    seg = [a + (b - a) * np.linspace(0, 1, max(1, int(np.linalg.norm(b - a))), endpoint=False)[:, None] for a, b in pairwise(p)]  # fmt: skip
    p = np.vstack([*seg, p[-1:]])
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    return p, s


def top_grid(lc, proj, box):
    """The 1 m canopy top (95th percentile of the canopy returns) of a lidar box, cached."""
    x0, x1, z0, z1 = box
    fn = os.path.join(ROOT, lc['cache'], f'top-{x0}_{x1}_{z0}_{z1}.npz')
    if os.path.exists(fn):
        return np.load(fn)['top']
    pts = lidar_points(lc['ept'], proj, box)
    cls, n = np.unique(pts[:, 3], return_counts=True)
    pz = {int(c): np.percentile(pts[pts[:, 3] == c, 2], [10, 50, 90]).round(1).tolist() for c in cls}
    print(f'  {box}: {len(pts)} points, classes {dict(zip(cls.astype(int).tolist(), n.tolist()))}, height p10/50/90 {pz}')
    pts = pts[~np.isin(pts[:, 3], NOT_CANOPY) & (pts[:, 3] != LIDAR_NOISE)]
    cols, rows = int(x1 - x0) + 1, int(z1 - z0) + 1
    ix = np.clip(np.round(pts[:, 0] - x0).astype(int), 0, cols - 1)
    iz = np.clip(np.round(pts[:, 1] - z0).astype(int), 0, rows - 1)
    key = iz * cols + ix
    order = np.lexsort((pts[:, 2], key))
    key, y = key[order], pts[order, 2]
    u, start, cnt = np.unique(key, return_index=True, return_counts=True)
    top = np.full(rows * cols, np.nan, np.float32)
    top[u] = y[start + np.minimum(cnt - 1, np.floor(cnt * 0.95).astype(int))]
    top = top.reshape(rows, cols)
    np.savez_compressed(fn, top=top)
    return top


def building_mask(b, x0, z0, rows, cols):
    """1 m cells under a building (data.json `buildings` rows: centre, width, depth, angle), grown 1 m."""
    f = {k: i for i, k in enumerate(b['fields'])}
    m = np.zeros((rows, cols), bool)
    for r in b['rows']:
        x, z, w, d, ang = r[f['x']], r[f['z']], r[f['w']], r[f['d']], r[f['angle']]
        rad = math.hypot(w, d) / 2 + 1
        if x + rad < x0 or x - rad > x0 + cols or z + rad < z0 or z - rad > z0 + rows:
            continue
        i0, i1 = max(0, int(x - rad - x0)), min(cols - 1, int(x + rad - x0) + 1)
        j0, j1 = max(0, int(z - rad - z0)), min(rows - 1, int(z + rad - z0) + 1)
        gx, gz = np.meshgrid(np.arange(i0, i1 + 1) + x0 - x, np.arange(j0, j1 + 1) + z0 - z)
        c, s = math.cos(ang), math.sin(ang)
        u, v = gx * c + gz * s, -gx * s + gz * c
        m[j0 : j1 + 1, i0 : i1 + 1] |= (np.abs(u) <= w / 2 + 1) & (np.abs(v) <= d / 2 + 1)
    return m


def main(cfg_path):
    cfg = json.load(open(cfg_path))
    lcfg = cfg['lidarCanopy']
    lc = cfg['survey']['lidar']
    proj = Proj(*cfg['origin'])
    folder = os.path.join(ROOT, cfg['folder'])
    network = json.load(open(os.path.join(folder, 'network.json')))
    line, s = stage_line(network)
    a, b, reach = lcfg['from'], lcfg['to'], lcfg['reach']
    part = line[(s >= a) & (s <= b)]
    kd = cKDTree(part)
    full = cKDTree(line)

    # The canopy mosaic over the band's bounding box.
    X0, Z0 = int(part[:, 0].min() - reach - 2), int(part[:, 1].min() - reach - 2)
    X1, Z1 = int(part[:, 0].max() + reach + 2), int(part[:, 1].max() + reach + 2)
    rows, cols = Z1 - Z0 + 1, X1 - X0 + 1
    chm = np.full((rows, cols), np.nan, np.float32)
    for box in lidar_regions(lc, network['stage']['cps']):
        bx0, bx1, bz0, bz1 = box
        if bx1 < X0 or bx0 > X1 or bz1 < Z0 or bz0 > Z1:
            continue
        gx, gz = np.meshgrid(np.linspace(bx0, bx1, 12), np.linspace(bz0, bz1, 12))
        if kd.query(np.c_[gx.ravel(), gz.ravel()])[0].min() > reach + 60:
            continue
        top = top_grid(lc, proj, box)
        gx0, gz0, ground, _ = lidar_ground(lc, ROOT, proj, None, None, box)
        h = np.clip(np.nan_to_num(top - ground, nan=0.0), 0, 45)
        i0, j0 = max(0, int(gx0) - X0), max(0, int(gz0) - Z0)
        i1, j1 = min(cols, int(gx0) + h.shape[1] - X0), min(rows, int(gz0) + h.shape[0] - Z0)
        if i1 <= i0 or j1 <= j0:
            continue
        piece = h[j0 + Z0 - int(gz0) : j1 + Z0 - int(gz0), i0 + X0 - int(gx0) : i1 + X0 - int(gx0)]
        cur = chm[j0:j1, i0:i1]
        chm[j0:j1, i0:i1] = np.where(np.isnan(cur), piece, np.fmax(cur, piece))
    have = ~np.isnan(chm)
    chm = np.nan_to_num(chm)

    data_path = os.path.join(folder, 'data.json')
    data = json.load(open(data_path))
    blds = building_mask(data['buildings'], X0, Z0, rows, cols)
    chm[blds] = 0

    rr, cc, th, rad, _, sm = crowns(chm, lcfg.get('minHeight', 3))
    # (the tree's height: the highest return near its top, not the smoothed peak the tops are found on)
    th = np.maximum(th, maximum_filter(chm, footprint=np.ones((5, 5), bool))[rr, cc])
    xs, zs = X0 + cc, Z0 + rr
    d, _ = kd.query(np.c_[xs, zs])
    # (in the band, on lidar, a real crown: not a lamp head or a sign - those are a cell or two wide)
    keep = (d <= reach) & have[rr, cc] & (rad >= lcfg.get('minRadius', 1.2))
    # (and nearest this stretch of the stage, not another part of it passing by)
    dfull, ifull = full.query(np.c_[xs, zs])
    keep &= (s[ifull] >= a - 1) & (s[ifull] <= b + 1)
    xs, zs, th = xs[keep].astype(float), zs[keep].astype(float), th[keep]
    # A crown over the stage's own carriageway or its right verge grows from a trunk beside it (the left is the other
    # carriageway): its tree stands out past the verge, `overhang` m from the line, and leans in (map.ts `lean`).
    ovh = lcfg.get('overhang')
    if ovh:
        i = np.clip(ifull[keep], 1, len(line) - 2)
        t = line[i + 1] - line[i - 1]
        t /= np.linalg.norm(t, axis=1)[:, None]
        lat = (xs - line[i, 0]) * -t[:, 1] + (zs - line[i, 1]) * t[:, 0]
        # (a mown lawn beside the road, `lawns` [from, to, width]: its trees stand at the lawn's far edge)
        st = s[i]
        out = np.full(len(xs), float(ovh))
        for l0, l1, lw in lcfg.get('lawns', []):
            out[(st >= l0) & (st <= l1)] = np.maximum(out[(st >= l0) & (st <= l1)], lw)
        mv = (lat > -2) & (lat < out)
        xs[mv] += -t[mv, 1] * (out[mv] - lat[mv])
        zs[mv] += t[mv, 0] * (out[mv] - lat[mv])
        print(f'  {mv.sum()} crowns over the carriageway / verge / lawns: trees moved out to {ovh} m (lawns: their width)')
    print(f'  {len(xs)} crowns within {reach} m of {a}-{b} m (h p50 {np.median(th):.1f}, p90 {np.percentile(th, 90):.1f} m)')

    # The land cover in the band, from the canopy.
    L = data['landcover']
    names = [zn['cover'] for zn in L['zones']]
    for n in ('woods', 'verge'):
        if n not in names:
            L['zones'].append({'cover': n})
            names.append(n)
    zid = rle_decode(L['rle'], L['rows'] * L['cols']).reshape(L['rows'], L['cols'])
    cell = L['cell']
    share = uniform_filter((sm >= 2.0).astype(np.float32), size=cell * 2 + 1)
    jj, ii = np.mgrid[0 : L['rows'], 0 : L['cols']]
    cx = L['originX'] + (ii + 0.5) * cell
    cz = L['originZ'] + (jj + 0.5) * cell
    inb = (cx >= X0) & (cx <= X1) & (cz >= Z0) & (cz <= Z1)
    sel = np.flatnonzero(inb.ravel())
    px, pz = cx.ravel()[sel], cz.ravel()[sel]
    dd, _ = kd.query(np.c_[px, pz])
    df, idf = full.query(np.c_[px, pz])
    ok = (dd <= reach) & (s[idf] >= a - 1) & (s[idf] <= b + 1)
    sel, px, pz, dd = sel[ok], px[ok], pz[ok], dd[ok]
    gi = np.clip(np.round(px - X0).astype(int), 0, cols - 1)
    gj = np.clip(np.round(pz - Z0).astype(int), 0, rows - 1)
    on_lidar = have[gj, gi]
    sel, px, pz, dd, gi, gj = sel[on_lidar], px[on_lidar], pz[on_lidar], dd[on_lidar], gi[on_lidar], gj[on_lidar]
    flat = zid.ravel()
    cur = flat[sel]
    nm = np.asarray(names)
    kept = np.isin(nm[cur], ['cemetery', 'water', 'industrial', 'paved']) | blds[gj, gi]
    closed = share[gj, gi] >= lcfg.get('closed', 0.5)
    built = np.isin(nm[cur], ['urban', 'bare'])
    woodsy = np.isin(nm[cur], ['trees', 'pine', 'shrub', 'grass', 'open', 'crop', 'orchard'])
    new = cur.copy()
    new[~kept & closed & (woodsy | (built & (dd <= lcfg.get('verge', 30))))] = names.index('woods')
    new[~kept & ~closed & built & (dd <= lcfg.get('verge', 30))] = names.index('verge')
    # (open wood and grass in the band: mown `verge` too - its trees are the lidar's, the generated scatter adds none)
    new[~kept & ~closed & np.isin(nm[cur], ['trees', 'pine', 'grass', 'open'])] = names.index('verge')
    # (the mown lawns beside the road, `lawns`: verge from the line out to their width on the right, whatever the canopy)
    if lcfg.get('lawns'):
        ip = np.clip(idf[ok][on_lidar], 1, len(line) - 2)
        tp = line[ip + 1] - line[ip - 1]
        tp /= np.linalg.norm(tp, axis=1)[:, None]
        latp = (px - line[ip, 0]) * -tp[:, 1] + (pz - line[ip, 1]) * tp[:, 0]
        for l0, l1, lw in lcfg['lawns']:
            new[~kept & (s[ip] >= l0) & (s[ip] <= l1) & (latp > 0) & (latp <= lw)] = names.index('verge')
    before = {n: int((nm[cur] == n).sum()) for n in np.unique(nm[cur])}
    after = {n: int((nm[new] == n).sum()) for n in np.unique(nm[new])}
    flat[sel] = new
    L['rle'] = rle_b64(flat.reshape(L['rows'], L['cols']).astype(np.uint8))
    print(f'  land cover in the band (cells of {cell} m): {before} -> {after}')
    data['meta']['sources'] = [x for x in data['meta']['sources'] if not x.startswith('Tree heights:')] + [SOURCE]
    with open(data_path, 'w', newline='\n') as f:
        json.dump(data, f, separators=(',', ':'))

    out = {'trees': [int(v) for t in zip(np.round(xs), np.round(zs), np.round(th)) for v in t]}
    fn = os.path.join(ROOT, lcfg['out'])
    with open(fn, 'w', newline='\n') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'  {os.path.relpath(fn, ROOT)}: {os.path.getsize(fn) / 1024:.0f} kB')


if __name__ == '__main__':
    main(sys.argv[1])
