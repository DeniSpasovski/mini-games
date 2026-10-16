"""
River baker: a far river as a centreline + width, drawn by the game on the horizon backdrop
(src/games/rally/world/horizon.ts, `HorizonDef.rivers`). Run after horizon.py; it adds the "rivers" list to horizon.json.

    python scripts/realmap/rivers.py scripts/realmap/vodno.json

Reads the bake config's optional "rivers" block:

    "rivers": [{ "name": "Vardar", "extent": [minX, maxX, minZ, maxZ], "from": [x, z], "to": [x, z] }]

The river is the cheapest route between `from` and `to` (world metres, +Z south) over ESA WorldCover (CC BY 4.0) water
pixels (10 m) inside `extent`;
gaps (tree cover hides the water) are crossed by the cheapest straight route, the width follows the water where it shows.
Output per river: pts = flat [x, z, width, ...] metres, ordered along the river, ~40 m apart.
"""

import json
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter1d, label
from skimage.graph import route_through_array

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj, grid_coords, worldcover_sampler  # noqa: E402
from horizon import ll_box  # noqa: E402

CELL = 10
WATER = 80


def simplify(pts, tol):
    c = np.asarray(pts, np.float32).reshape(-1, 1, 2)
    return cv2.approxPolyDP(c, tol, False).reshape(-1, 2)


def bake_river(proj, wc, r):
    ext = r['extent']
    X, Z = grid_coords(ext, CELL)
    lat, lon = proj.inv(X, Z)
    water = (wc(lat.ravel(), lon.ravel()).reshape(X.shape) == WATER)
    lab, n = label(water, structure=np.ones((3, 3)))
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    keep = np.isin(lab, np.nonzero(sizes >= r.get('minPixels', 25))[0])
    # Cheapest route between the two ends: along the water where it shows, straight across where it is hidden.
    def snap(pt):
        ys, xs = np.nonzero(keep)
        d = (ext[0] + xs * CELL - pt[0]) ** 2 + (ext[2] + ys * CELL - pt[1]) ** 2
        k = d.argmin()
        return int(ys[k]), int(xs[k])

    cost = np.where(keep, 1.0, float(r.get('gapCost', 12)))
    path, _ = route_through_array(cost, snap(r['from']), snap(r['to']), fully_connected=True, geometric=True)
    path = np.array(path, float)  # (row, col)
    dt = distance_transform_edt(~keep) * CELL  # distance to real water
    wdt = distance_transform_edt(keep) * CELL * 2  # width where there is water
    p = np.stack([gaussian_filter1d(path[:, 1], 6, mode='nearest'), gaussian_filter1d(path[:, 0], 6, mode='nearest')], 1)
    p = simplify(p, 0.4)
    # Resample every ~40 m.
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)]) * CELL
    t = np.arange(0, s[-1], 40.0)
    cx = np.interp(t, s, p[:, 0])
    cz = np.interp(t, s, p[:, 1])
    ci = np.clip(cz.round().astype(int), 0, wdt.shape[0] - 1)
    cj = np.clip(cx.round().astype(int), 0, wdt.shape[1] - 1)
    # Width: the local water width within a few pixels of the line, smoothed; the median where the water is hidden.
    w = np.array([wdt[max(0, i - 2):i + 3, max(0, j - 2):j + 3].max() for i, j in zip(ci, cj)])
    seen = dt[ci, cj] < 15
    med = float(np.median(w[seen])) if seen.any() else 40.0
    w = np.where(seen, w, med)
    w = np.clip(gaussian_filter1d(w, 4), r.get('minWidth', 36), r.get('maxWidth', 110))
    wx = ext[0] + cx * CELL
    wz = ext[2] + cz * CELL
    if t[-1] < r.get('minLength', 0):
        raise SystemExit(f'river {r["name"]}: only {t[-1]:.0f} m found')
    print(f'  {r["name"]}: {len(t)} points, {t[-1] / 1000:.1f} km, width {w.min():.0f}..{w.max():.0f} m (median {med:.0f} m)')
    pts = np.stack([wx, wz, w], 1).round(1).ravel().tolist()
    return {'name': r['name'], 'pts': pts}


def main():
    cfg_path = sys.argv[1]
    cfg = json.load(open(cfg_path))
    proj = Proj(*cfg['origin'])
    rivers = cfg['rivers']
    box = [
        min(r['extent'][0] for r in rivers),
        max(r['extent'][1] for r in rivers),
        min(r['extent'][2] for r in rivers),
        max(r['extent'][3] for r in rivers),
    ]
    wc = worldcover_sampler(*ll_box(proj, box, 100))
    out = [bake_river(proj, wc, r) for r in rivers]
    path = os.path.join(ROOT, os.path.dirname(cfg['out']), 'horizon.json')
    hz = json.load(open(path))
    hz['rivers'] = out
    with open(path, 'w') as f:
        json.dump(hz, f)
    print(f'wrote rivers to {os.path.relpath(path, ROOT)}')


if __name__ == '__main__':
    main()
