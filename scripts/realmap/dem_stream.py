"""
Derive a stream OpenStreetMap lacks from the map's elevation file (config "dem"): flow routing on the DEM, the
main stem through a picked point, refined onto the valley floor -> a lat / lon polyline for the bake config
("waterways", added like an OSM waterway=stream).

    python scripts/realmap/dem_stream.py scripts/realmap/petralica.json --at -35,2418 [--min-area 0.1] [--kind stream]

--at = a world point (x, z) on the creek (map viewer camera link / "Picked point"). The line starts where its
catchment reaches --min-area km2 and runs downstream until it meets a water way already in the baked data.json
(snapped onto it, so the engine joins the two channels) or leaves the detail grid. It follows the 30 m DEM, so it
is a modelled line: the real bed can be 10-30 m off - check it against imagery and list it in the map DETAILS.md.
"""

import argparse
import heapq
import json
import math
import os

import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates
from scipy.spatial import cKDTree

import bake

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def flow(a, cy, cx):
    """Depression-filled D8 flow: (receiver index per cell, -1 at outlets; upstream cell count per cell)."""
    H, W = a.shape
    filled = a.astype(np.float64)
    done = np.zeros((H, W), bool)
    done[[0, -1], :] = done[:, [0, -1]] = True
    pq = [(filled[i, j], i, j) for i, j in zip(*np.nonzero(done))]
    heapq.heapify(pq)
    while pq:  # priority flood from the border: every pit is filled to its spill height (+ a tiny slope)
        h, i, j = heapq.heappop(pq)
        for di, dj in N8:
            u, v = i + di, j + dj
            if 0 <= u < H and 0 <= v < W and not done[u, v]:
                done[u, v] = True
                filled[u, v] = max(filled[u, v], h + 1e-4)
                heapq.heappush(pq, (filled[u, v], u, v))
    rec = np.full(H * W, -1, np.int64)
    best = np.zeros((H, W))
    rows, cols = np.mgrid[0:H, 0:W]
    for di, dj in N8:
        u, v = np.clip(rows + di, 0, H - 1), np.clip(cols + dj, 0, W - 1)
        s = (filled - filled[u, v]) / math.hypot(di * cy, dj * cx)
        m = (s > best) & (rows + di == u) & (cols + dj == v)
        best[m] = s[m]
        rec[m.ravel()] = (u * W + v)[m]
    acc = np.ones(H * W)
    for k in np.argsort(-filled, axis=None):
        if rec[k] >= 0:
            acc[rec[k]] += acc[k]
    return rec, acc


def resample(p, step):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    s = np.linspace(0, d[-1], max(2, int(d[-1] / step) + 1))
    return np.c_[np.interp(s, d, p[:, 0]), np.interp(s, d, p[:, 1])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--at', required=True, help='x,z world point on the stream')
    ap.add_argument('--min-area', type=float, default=0.1, help='catchment (km2) where the stream starts')
    ap.add_argument('--kind', default='stream')
    args = ap.parse_args()
    cfg = json.load(open(args.config, encoding='utf-8'))
    proj = bake.Proj(*cfg['origin'])
    a, lon0, lat1, sx, sy = bake.read_geotiff(os.path.join(bake.ROOT, cfg['dem']['file']), cfg['dem'].get('member'))
    H, W = a.shape
    cy = sy * proj.my
    cx = sx * proj.mx
    rec, acc = flow(a, cy, cx)
    area = cx * cy / 1e6

    def cell_xz(k):
        i, j = divmod(int(k), W)
        return proj.fwd(lat1 - (i + 0.5) * sy, lon0 + (j + 0.5) * sx)

    def height(p):  # world points -> DEM metres (bilinear)
        lat, lon = proj.inv(p[:, 0], p[:, 1])
        return map_coordinates(a, [(lat1 - lat) / sy - 0.5, (lon - lon0) / sx - 0.5], order=1, mode='nearest')

    # The cell with the largest catchment within ~3 cells of the picked point.
    x, z = map(float, args.at.split(','))
    lat, lon = proj.inv(x, z)
    i0, j0 = int((lat1 - lat) / sy), int((lon - lon0) / sx)
    win = acc.reshape(H, W)[i0 - 3 : i0 + 4, j0 - 3 : j0 + 4]
    di, dj = np.unravel_index(np.argmax(win), win.shape)
    k0 = (i0 - 3 + di) * W + (j0 - 3 + dj)
    print(f'picked cell: catchment {acc[k0] * area:.2f} km2')

    # Upstream along the biggest tributary while the catchment is >= min-area; downstream to the outlet.
    parents = {}
    for k in np.nonzero(rec >= 0)[0]:
        parents.setdefault(int(rec[k]), []).append(int(k))
    up = [k0]
    while parents.get(up[-1]):
        nxt = max(parents[up[-1]], key=lambda q: acc[q])
        if acc[nxt] * area < args.min_area:
            break
        up.append(nxt)
    down = [k0]
    while rec[down[-1]] >= 0:
        down.append(int(rec[down[-1]]))
    cells = np.array([cell_xz(k) for k in up[::-1] + down[1:]])

    # Valley floor: smooth the stair-stepped cell line, then pull it sideways onto the lowest ground (twice).
    p = gaussian_filter1d(resample(cells, 10), 2.5, axis=0, mode='nearest')
    offs = np.arange(-40, 41, 2.0)
    for _ in range(2):
        t = np.gradient(p, axis=0)
        n = np.c_[-t[:, 1], t[:, 0]] / (np.linalg.norm(t, axis=1)[:, None] + 1e-9)
        hs = np.stack([height(p + n * o) for o in offs], axis=1)
        shift = gaussian_filter1d(offs[np.argmin(hs, axis=1)], 4, mode='nearest')
        p = gaussian_filter1d(resample(p + n * shift[:, None], 10), 2, axis=0, mode='nearest')

    # End where it meets a water way of the baked map (snapped onto it), or where it leaves the detail grid.
    data = json.load(open(os.path.join(bake.ROOT, cfg['out']), encoding='utf-8'))
    water = [np.array(q['pts']).reshape(-1, 2) for q in data['paths'] if q['surface'] == 'water']
    end = len(p)
    if water:
        wpts = np.concatenate([resample(w, 2) for w in water])
        d, wi = cKDTree(wpts).query(p)
        hit = np.nonzero(d < 6)[0]
        if len(hit):
            end = hit[0] + 1
            p = p[:end].copy()
            p[-1] = wpts[wi[end - 1]]
            print('ends in an existing water way')
    x0, x1, z0, z1 = cfg['detail']['extent']
    inside = (p[:, 0] > x0) & (p[:, 0] < x1) & (p[:, 1] > z0) & (p[:, 1] < z1)
    p = p[: np.argmin(inside) if not inside.all() else len(p)]

    simp = bake.cv2.approxPolyDP(np.round(p * 10).astype(np.int32).reshape(-1, 1, 2), 15, False).reshape(-1, 2) / 10
    length = float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())
    hs = height(p)
    print(f'{args.kind}: {length:.0f} m, {hs[0]:.0f} -> {hs[-1]:.0f} m, {len(simp)} points')
    ll = [[round(v, 6) for v in proj.inv(q[0], q[1])] for q in simp]
    entry = {
        'kind': args.kind,
        'note': f'derived from the DEM (flow line through {x:.0f}, {z:.0f}, from {args.min_area} km2 catchment; dem_stream.py)',
        'pts': ll,
    }
    print(json.dumps(entry))


if __name__ == '__main__':
    main()
