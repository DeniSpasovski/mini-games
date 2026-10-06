"""
Horizon baker: the land far around a real-world map (terrain + land cover only, no roads / buildings), drawn by the
game as a backdrop beyond the streamed terrain (src/games/rally/world/horizon.ts).

    python scripts/realmap/horizon.py scripts/realmap/ajvatovci.json

Reads the map's bake config (origin, bounds via `detail.extent`) and its optional "horizon" block:

    "horizon": { "inner": { "cell": 100, "radius": 8000 }, "outer": { "cell": 300, "radius": 25000 } }

(radius = half the side of a square around the centre of `detail.extent`, metres). Writes
src/games/rally/maps/<id>/horizon.json - two grids, each:
  - heights   int16 LE base64, metres = base + v * step (absolute DEM; the game subtracts the map's heightmap offset)
  - cover     uint16 LE base64 per cell, 4 x 4 bit = share of trees / crops / built + bare / water (grass = the rest)

Sources (same as bake.py, already credited): AWS Terrain Tiles (Terrarium) and ESA WorldCover 2021 (CC BY 4.0).
Downloads are cached in scripts/realmap/.cache/.
"""

import base64
import json
import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj, grid_coords, terrarium_sampler, worldcover_sampler  # noqa: E402

STEP = 0.5
# WorldCover classes -> channel (tree, crop, built / bare, water); grass / shrub / moss = the rest.
CHANNELS = {10: 0, 95: 0, 40: 1, 50: 2, 60: 2, 70: 2, 80: 3, 90: 3}
# Terrarium zoom per grid cell size (finer DEM pixels than the cell).
ZOOM = {100: 12, 300: 10}


def ll_box(proj, ext, pad=0):
    la0, lo0 = proj.inv(ext[0] - pad, ext[2] - pad)
    la1, lo1 = proj.inv(ext[1] + pad, ext[3] + pad)
    return min(la0, la1), max(la0, la1), lo0, lo1


def bake_grid(proj, cx, cz, cell, radius, wc):
    ext = [cx - radius, cx + radius, cz - radius, cz + radius]
    X, Z = grid_coords(ext, cell)
    lat, lon = proj.inv(X, Z)
    dem = terrarium_sampler(*ll_box(proj, ext, 2 * cell), ZOOM.get(cell, 11))
    h = gaussian_filter(dem(lat.ravel(), lon.ravel()).reshape(X.shape), 0.7)
    base = float(np.floor(h.min()))
    hv = np.clip(np.round((h - base) / STEP), -32768, 32767).astype('<i2')

    # Cover shares: 8 x 8 WorldCover samples per cell.
    n = 8
    off = (np.arange(n) + 0.5) / n - 0.5
    shares = np.zeros(X.shape + (4,), np.float32)
    for oz in off:
        for ox in off:
            la, lo = proj.inv(X + ox * cell, Z + oz * cell)
            cls = wc(la.ravel(), lo.ravel()).reshape(X.shape)
            for c, ch in CHANNELS.items():
                shares[..., ch] += cls == c
    shares /= n * n
    q = np.clip(np.round(shares * 15), 0, 15).astype(np.uint16)
    cover = (q[..., 0] | (q[..., 1] << 4) | (q[..., 2] << 8) | (q[..., 3] << 12)).astype('<u2')

    rows, cols = X.shape
    print(f'  grid {cell} m: {cols} x {rows}, heights {h.min():.0f}..{h.max():.0f} m')
    return {
        'originX': ext[0],
        'originZ': ext[2],
        'cell': cell,
        'cols': cols,
        'rows': rows,
        'base': base,
        'step': STEP,
        'heights': base64.b64encode(hv.tobytes()).decode(),
        'cover': base64.b64encode(cover.tobytes()).decode(),
    }


def main():
    cfg_path = sys.argv[1]
    cfg = json.load(open(cfg_path))
    proj = Proj(*cfg['origin'])
    hz = cfg.get('horizon', {})
    inner = hz.get('inner', {'cell': 100, 'radius': 8000})
    outer = hz.get('outer', {'cell': 300, 'radius': 25000})
    d = cfg['detail']['extent']
    cx, cz = (d[0] + d[1]) / 2, (d[2] + d[3]) / 2
    r = outer['radius']
    print('worldcover (horizon box)...')
    wc = worldcover_sampler(*ll_box(proj, [cx - r, cx + r, cz - r, cz + r], 400))
    print('grids...')
    grids = [bake_grid(proj, cx, cz, g['cell'], g['radius'], wc) for g in (inner, outer)]
    out_dir = os.path.dirname(os.path.join(ROOT, cfg['out']))
    out = os.path.join(out_dir, 'horizon.json')
    with open(out, 'w') as f:
        json.dump({'sources': 'Terrarium (AWS Terrain Tiles); ESA WorldCover 2021 (CC BY 4.0)', 'grids': grids}, f)
    print(f'wrote {os.path.relpath(out, ROOT)} ({os.path.getsize(out) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
