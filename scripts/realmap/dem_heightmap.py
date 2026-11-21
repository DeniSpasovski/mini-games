"""Re-bake ONLY the heightmap of a baked map (`data.json` "heightmap") from the config's local DEM (config "dem"), keeping
everything else as it is: the OSM paths keep their index, so hand-tuned map code keyed by them still holds.

    python scripts/realmap/dem_heightmap.py scripts/realmap/vodno.json

The DEM is a surface model (Copernicus GLO-30: radar sees the crowns, not the floor), so the woods are lowered by
`dem.canopyShare` x the real stand height x the canopy share (`canopy.json`, scripts/realmap/canopy.py: run it first);
roofs and orchards by the config "canopy" heights per land cover class, as bake.py does. Calibrate `canopyShare` with
`--calibrate`: the share that leaves the least descent along a road known to climb all the way (`dem.climb`:
[from, to] m along the route).
"""

import json
import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bake import C, ROOT, Proj, b64_int16, geotiff_sampler, grid_coords, terrarium_sampler  # noqa: E402
from leaf_type import rle_decode  # noqa: E402


def raster(r):
    """canopy.json raster -> f(x[], z[]) bilinear (world metres)."""
    v = rle_decode(r['rle'], r['rows'] * r['cols']).reshape(r['rows'], r['cols']).astype(np.float32) * r['scale']

    def f(x, z):
        return map_coordinates(
            v, [(np.asarray(z) - r['originZ']) / r['cell'] - 0.5, (np.asarray(x) - r['originX']) / r['cell'] - 0.5],
            order=1, mode='nearest')  # fmt: skip

    return f


def route_line(route, step=5.0):
    """Control points -> polyline resampled every `step` m (Catmull-Rom is close enough for a height profile)."""
    p = np.array(route, np.float64)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    acc = np.concatenate([[0], np.cumsum(seg)])
    s = np.arange(0, acc[-1], step)
    return s, np.interp(s, acc, p[:, 0]), np.interp(s, acc, p[:, 1])


def main():
    cfg = json.load(open(sys.argv[1]))
    dem = cfg['dem']
    out_path = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out_path, encoding='utf8'))
    proj = Proj(*cfg['origin'])
    det, out_g, lcc = cfg['detail'], cfg['outer'], cfg['landcover']
    loc, loc_w = geotiff_sampler(os.path.join(ROOT, dem['file']))
    canopy = json.load(open(os.path.join(os.path.dirname(out_path), 'canopy.json')))
    cov, hgt = raster(canopy['cover']), raster(canopy['height'])

    def surface(X, Z):
        lat, lon = proj.inv(X, Z)
        w = loc_w(lat.ravel(), lon.ravel())
        assert w.min() > 0.999, 'detail grid must lie inside the local DEM'
        return loc(lat.ravel(), lon.ravel()).reshape(X.shape)

    def crowns(X, Z):
        return hgt(X, Z) * cov(X, Z)

    if '--calibrate' in sys.argv:
        s, x, z = route_line(data['route'])
        m = (s > dem['climb'][0]) & (s < dem['climb'][1])
        g, c = surface(x, z), crowns(x, z)
        for k in np.arange(0, 1.01, 0.1):
            dy = np.diff(gaussian_filter1d(g - k * c, 6)[m])
            print(f'  share {k:.1f}: descent {-dy[dy < 0].sum():6.1f} m, climb {dy[dy > 0].sum():6.1f} m')
        return

    # Detail grid: DEM -> smooth tile seams -> lower the crowns (real stand heights) and roofs / orchards (by class).
    X, Z = grid_coords(det['extent'], det['cell'])
    h = gaussian_filter(surface(X, Z), 1.1)
    h -= dem['canopyShare'] * gaussian_filter(crowns(X, Z), 1.0)
    lc = data['landcover']
    zid = rle_decode(lc['rle'], lc['rows'] * lc['cols']).reshape(lc['rows'], lc['cols'])
    cover = np.array([C.get(zn['cover'], 255) for zn in lc['zones']] + [255] * (256 - len(lc['zones'])), np.uint8)[zid]
    ci = np.clip(((X - lc['originX']) / lc['cell']).astype(int), 0, cover.shape[1] - 1)
    cj = np.clip(((Z - lc['originZ']) / lc['cell']).astype(int), 0, cover.shape[0] - 1)
    inside = (X >= lcc['extent'][0]) & (X <= lcc['extent'][1]) & (Z >= lcc['extent'][2]) & (Z <= lcc['extent'][3])
    roofs = np.zeros(X.shape, np.float32)
    for name in ('urban', 'orchard', 'industrial'):
        if name in cfg['canopy']:
            roofs[(cover[cj, ci] == C[name]) & inside] = cfg['canopy'][name]
    h -= gaussian_filter(roofs, 2.0)

    def ll_box(ext, pad=0):
        la0, lo0 = proj.inv(ext[0] - pad, ext[2] - pad)
        la1, lo1 = proj.inv(ext[1] + pad, ext[3] + pad)
        return min(la0, la1), max(la0, la1), lo0, lo1

    # Built-up land (`dem.keep`: land cover classes) keeps bake.py's Terrarium heights - a surface model reads the
    # blocks as hills, and the streets, pads and walls there are tuned to the old shape - lifted by the DEM's offset
    # around it (smoothed over `dem.keepOffset` m) and blended over `dem.keepBlend` m.
    keep = dem.get('keep')
    if keep:
        ter = terrarium_sampler(*ll_box(det['extent'], 200), 15)
        lat, lon = proj.inv(X, Z)
        old = gaussian_filter(ter(lat.ravel(), lon.ravel()).reshape(X.shape), 1.1)
        # bake.py's canopy by class (the woods split by leaf_type.py count as the class they came from)
        heights = {**{n: cfg['canopy'][f] for n, f in (('mixed', 'pine'), ('oakwood', 'pine')) if f in cfg['canopy']},
                   **cfg['canopy']}  # fmt: skip
        by_class = np.zeros(X.shape, np.float32)
        names = [zn['cover'] for zn in lc['zones']]
        zone_at = zid[cj, ci]
        for z, name in enumerate(names):
            if name in heights:
                by_class[(zone_at == z) & inside] = heights[name]
        old -= gaussian_filter(by_class, 2.0)
        town = np.isin(zone_at, [z for z, n in enumerate(names) if n in keep]) & inside
        w = np.clip(gaussian_filter(town.astype(np.float32), dem.get('keepBlend', 60) / det['cell']) * 2, 0, 1)
        far = (w < 0.01).astype(np.float32)
        sig = dem.get('keepOffset', 150) / det['cell']
        off = gaussian_filter((h - old) * far, sig) / np.maximum(gaussian_filter(far, sig), 1e-3)
        h = h * (1 - w) + (old + off) * w

    # Outer horizon grid: the DEM where it reaches, Terrarium past its edge.

    ter_lo = terrarium_sampler(*ll_box(out_g['extent'], 200), 12)
    XO, ZO = grid_coords(out_g['extent'], out_g['cell'])
    lat, lon = proj.inv(XO, ZO)
    w = loc_w(lat.ravel(), lon.ravel())
    ho = loc(lat.ravel(), lon.ravel()) * w + ter_lo(lat.ravel(), lon.ravel()) * (1 - w)
    ho = gaussian_filter(ho.reshape(XO.shape), 0.8)

    hm = data['heightmap']
    base, step = hm['base'], hm['step']
    enc = lambda a: np.clip(np.round((a - base) / step), -32768, 32767)  # noqa: E731
    old = hm['grids'][0]
    assert (old['cols'], old['rows']) == (X.shape[1], X.shape[0]), 'detail grid changed: run bake.py'
    hm['grids'][0]['data'] = b64_int16(enc(h))
    hm['grids'][1]['data'] = b64_int16(enc(ho))
    src = data['meta']['sources']
    src[0] = dem['credit'] + '; the town and the horizon past its edge: AWS Terrain Tiles (Terrarium)'
    with open(out_path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  {out_path}: heightmap re-baked from {os.path.basename(dem["file"])} (canopy share {dem["canopyShare"]})')


if __name__ == '__main__':
    main()
