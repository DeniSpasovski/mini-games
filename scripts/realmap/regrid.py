"""
Re-samples a baked map's heightmap grids from its DEM, in place - nothing else in data.json changes (route, paths,
buildings, land cover): after a DEM fix, without re-baking the roads.

    python scripts/realmap/regrid.py scripts/realmap/jackie.json

Each grid is rebuilt the way the script that made it built it:
  - the detail grid (bake.py): config "dem" (3DEP) over `detail.extent`, gaussian 1.1 cells
  - the "east" grid (east.py): the same over the scratch bake's widened detail box, cropped to `east.grid`
  - the extension ring (extend.py): config "dem" over `extend.extent`, gaussian 1.1 cells
  - the outer grid (bake.py): the DEM blended into Terrarium past its edge, gaussian 0.8 cells
and the extension ring's lakes get their surface again (median DEM height inside the outline, as extend.py).
"""

import base64
import json
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj, b64_int16, grid_coords, terrarium_sampler, usgs3dep_sampler  # noqa: E402


def dec16(g):
    return np.frombuffer(base64.b64decode(g['data']), dtype='<i2').reshape(g['rows'], g['cols'])


def main():
    cfg = json.load(open(sys.argv[1]))
    dem_cfg = cfg.get('dem') or {}
    if dem_cfg.get('source') != '3dep':
        sys.exit('regrid.py: only a 3DEP "dem" is supported (re-bake a Terrarium / GeoTIFF map)')
    if cfg.get('canopy'):
        sys.exit('regrid.py: canopy subtraction is not supported')
    proj = Proj(*cfg['origin'])
    out = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out))
    hm = data['heightmap']
    base, step = hm['base'], hm['step']
    dem_cell = dem_cfg.get('cell', 5)

    def ll_box(e, pad=0):
        la0, lo0 = proj.inv(e[0] - pad, e[2] - pad)
        la1, lo1 = proj.inv(e[1] + pad, e[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    def sample(f, X, Z):
        lat, lon = proj.inv(X, Z)
        return f(lat.ravel(), lon.ravel()).reshape(X.shape)

    def put(g, h, label):
        enc = np.clip(np.round((h - base) / step), -32768, 32767)
        assert enc.shape == (g['rows'], g['cols']), f'{label}: {enc.shape} != {(g["rows"], g["cols"])}'
        old = dec16(g).astype(float) * step + base
        g['data'] = b64_int16(enc)
        d = h - old
        print(f'  {label}: {g["cols"]} x {g["rows"]} cells of {g["cell"]} m, {h.min():.1f}..{h.max():.1f} m, '
              f'change median {np.median(d):+.2f} m, p5 / p95 {np.percentile(d, 5):+.2f} / {np.percentile(d, 95):+.2f} m')  # fmt: skip

    det, out_g = cfg['detail'], cfg['outer']
    grids = hm['grids']
    print('detail grid...')
    loc, loc_w = usgs3dep_sampler(*ll_box(det['extent'], 120), dem_cell)
    X, Z = grid_coords(det['extent'], det['cell'])
    put(grids[0], gaussian_filter(sample(loc, X, Z), 1.1), 'detail')

    east = next((g for g in grids if g.get('tag') == 'east'), None)
    if east is not None:
        print('east grid...')
        e = cfg['east']
        ext = [det['extent'][0], max(det['extent'][1], e['grid'][1] + 100), det['extent'][2], det['extent'][3]]
        f, _ = usgs3dep_sampler(*ll_box(ext, 120), dem_cell)
        X, Z = grid_coords(ext, det['cell'])
        h = gaussian_filter(sample(f, X, Z), 1.1)
        x0, x1, z0, z1 = e['grid']
        i0, i1 = round((x0 - ext[0]) / det['cell']), round((x1 - ext[0]) / det['cell'])
        j0, j1 = round((z0 - ext[2]) / det['cell']), round((z1 - ext[2]) / det['cell'])
        put(east, h[j0:j1, i0:i1], 'east')

    ring_dem = None
    if 'extend' in cfg:
        ex = cfg['extend']
        ext, cell = ex['extent'], ex.get('cell', 10)
        ring = next(g for g in grids if g['originX'] == ext[0] and g['originZ'] == ext[2] and g['cell'] == cell)
        print('extension ring...')
        ring_dem, _ = usgs3dep_sampler(*ll_box(ext, 120), dem_cell)
        X, Z = grid_coords(ext, cell)
        put(ring, gaussian_filter(sample(ring_dem, X, Z), 1.1), 'ring')

    print('outer grid...')
    oe = out_g['extent']
    outer = next(g for g in grids if g['originX'] == oe[0] and g['originZ'] == oe[2] and g['cell'] == out_g['cell'])
    ter_lo = terrarium_sampler(*ll_box(oe, 200), 12)

    def dem_lo(lat, lon):
        w = loc_w(lat, lon)
        return loc(lat, lon) * w + ter_lo(lat, lon) * (1 - w)

    X, Z = grid_coords(oe, out_g['cell'])
    put(outer, gaussian_filter(sample(dem_lo, X, Z), 0.8), 'outer')

    if ring_dem is not None:
        n = 0
        for lk in data['lakes']:
            if 'level' not in lk:
                continue
            poly = np.array(lk['pts']).reshape(-1, 2)
            x0, z0 = poly.min(0)
            x1, z1 = poly.max(0)
            X, Z = grid_coords([x0, x1, z0, z1], 5)
            mask = np.zeros(X.shape, np.uint8)
            cv2.fillPoly(mask, [np.round((poly - [x0, z0]) / 5).astype(np.int32)], 1)
            cv2.erode(mask, np.ones((5, 5), np.uint8), dst=mask)
            la, lo = proj.inv(X, Z)
            hs = ring_dem(la[mask > 0], lo[mask > 0])
            if len(hs):
                old, lk['level'] = lk['level'], round(float(np.median(hs)), 2)
                print(f'  lake {lk.get("name") or lk["kind"]}: level {old} -> {lk["level"]}')
                n += 1
        print(f'  {n} lake levels')

    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'-> {out}')


if __name__ == '__main__':
    main()
