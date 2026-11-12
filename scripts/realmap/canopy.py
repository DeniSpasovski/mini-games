"""
Canopy baker: the woods' real structure from the Meta / WRI "High Resolution Canopy Height Maps" (1 m canopy height
model, CC BY 4.0, from 2018-2020 Maxar imagery). Run after bake.py and leaf_type.py:

    python scripts/realmap/canopy.py scripts/realmap/vodno.json [--cache DIR]

Writes `maps/<id>/canopy.json` (the map's `landcover.canopy` + `realTrees`, maps/shared/types.ts) and the credit line
into the map's data.json `meta.sources`:
- `grid`: per 10 m cell the canopy share (pixels >= 2 m, in quarters) and the stand height (90th percentile of the
  canopy pixels, 2 m steps). Scatter rules with `canopy` thin and size the woods by it (world/scatter.ts).
- `trees`: x, z, height (m) of every crown outside the wood covers (gardens, hedgerows, field trees) and of the lone
  ones inside them (clearings, edges). The CHM's real resolution is ~3-5 m: it merges the crowns of a closed coppice
  stand, so the game keeps its scatter there (thinned by the share) and places only these as they stand.

Reads the bake config's optional "canopyHeight" block:

    "canopyHeight": { "tile": "120233330", "cache": "sources/maps/vodno/canopy", "minHeight": 3,
                      "woods": ["pine", "mixed", "oakwood", "trees"] }

`tile` = the zoom-9 Web Mercator quadkey tile holding the map (index: `tiles.geojson` next to `chm/` in the bucket,
acquisition dates in `metadata/<tile>.geojson`). A tile is 65536 px square (~0.9 m ground pixels, uint8 metres, one
DEFLATE strip per row): only the map's rows are read with HTTP range requests and cached as .npz under `cache` (git-ignored,
in sources/; `--cache` overrides it, e.g. the main checkout's from a worktree). `woods` = the covers whose closed stands
stay scatter; `loneCover` / `loneSigma` = what counts as a lone crown there (canopy share within ~sigma m).
"""

import base64
import json
import math
import os
import struct
import sys
import warnings
import zlib

import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates, maximum_filter, watershed_ift

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import ROOT, Proj, grid_coords, http_range, rle_b64  # noqa: E402
from leaf_type import rle_decode  # noqa: E402

CHM_URL = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/{layer}/{tile}.tif{ext}'
MERC_R = 6378137.0


def merc(lat, lon):
    """WGS84 -> Web Mercator (EPSG:3857) metres."""
    return np.radians(lon) * MERC_R, MERC_R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def tiff_ifd(url):
    """First IFD of a TIFF or BigTIFF -> {tag: values}; offset arrays are left as (type, count, offset) to read lazily."""
    head = http_range(url, 0, 16383)
    bo = '<' if head[:2] == b'II' else '>'
    big = struct.unpack(bo + 'H', head[2:4])[0] == 43
    fmts = {1: ('B', 1), 2: ('s', 1), 3: ('H', 2), 4: ('I', 4), 12: ('d', 8), 16: ('Q', 8)}
    off = struct.unpack(bo + ('Q' if big else 'I'), head[8:16] if big else head[4:8])[0]
    cnt_f, ent, val = ('Q', 20, 8) if big else ('H', 12, 4)
    n = struct.unpack(bo + cnt_f, head[off : off + struct.calcsize(cnt_f)])[0]
    base = off + struct.calcsize(cnt_f)
    tags = {}
    for i in range(n):
        e = head[base + i * ent : base + (i + 1) * ent]
        tag, typ = struct.unpack(bo + 'HH', e[:4])
        cnt = struct.unpack(bo + ('Q' if big else 'I'), e[4 : 4 + val])[0]
        if typ not in fmts:
            continue
        f, s = fmts[typ]
        raw = e[4 + val : 4 + 2 * val]
        if s * cnt <= val:
            data = raw[: s * cnt]
        else:
            vo = struct.unpack(bo + ('Q' if big else 'I'), raw)[0]
            if cnt > 64:
                tags[tag] = (typ, cnt, vo)
                continue
            data = http_range(url, vo, vo + s * cnt - 1)
        tags[tag] = data if typ == 2 else struct.unpack(bo + f * cnt, data)
    return tags, bo


def strip_window(url, r0, r1, c0, c1):
    """Rows r0..r1, columns c0..c1 of a striped uint8 TIFF (DEFLATE, optional horizontal predictor), one strip per row.
    Neighbouring strips are fetched in one range request (they are stored in row order)."""
    tags, bo = tiff_ifd(url)
    assert tags[258][0] == 8 and tags[259][0] in (8, 32946), 'expected DEFLATE uint8'
    assert tags.get(278, (1,))[0] == 1, 'expected one row per strip'
    W = tags[256][0]
    pred = tags.get(317, (1,))[0]

    def arr(t):
        typ, _, vo = tags[t]
        s, f = (8, 'Q') if typ == 16 else (4, 'I')
        return np.array(struct.unpack(bo + f * (r1 - r0), http_range(url, vo + r0 * s, vo + r1 * s - 1)), np.int64)

    offs, cnts = arr(273), arr(279)
    out = np.zeros((r1 - r0, c1 - c0), np.uint8)
    i = 0
    while i < len(offs):
        j = i
        while j + 1 < len(offs) and offs[j + 1] == offs[j] + cnts[j] and offs[j + 1] + cnts[j + 1] - offs[i] < 8 << 20:
            j += 1
        blob = http_range(url, int(offs[i]), int(offs[j] + cnts[j] - 1))
        for k in range(i, j + 1):
            a = np.frombuffer(zlib.decompress(blob[offs[k] - offs[i] : offs[k] - offs[i] + cnts[k]]), np.uint8)[:W]
            if pred == 2:
                a = np.cumsum(a, dtype=np.uint8)
            out[k] = a[c0:c1]
        print(f'\r  rows {r0 + j + 1 - r0}/{r1 - r0}', end='', flush=True)
        i = j + 1
    print()
    geo = (tags[33922][3], tags[33922][4], tags[33550][0])
    return out, geo


def load_chm(cfg, cache):
    ch = cfg['canopyHeight']
    proj = Proj(*cfg['origin'])
    x0, x1, z0, z1 = cfg['landcover']['extent']
    m = 40
    lat, lon = proj.inv(np.array([x0 - m, x1 + m, x0 - m, x1 + m]), np.array([z0 - m, z0 - m, z1 + m, z1 + m]))
    mx, my = merc(lat, lon)
    url = CHM_URL.format(layer='chm', tile=ch['tile'], ext='')
    tags, _ = tiff_ifd(url)
    gx, gy, px = tags[33922][3], tags[33922][4], tags[33550][0]
    c0, c1 = int((mx.min() - gx) // px), int((mx.max() - gx) // px) + 2
    r0, r1 = int((gy - my.max()) // px), int((gy - my.min()) // px) + 2
    fn = os.path.join(cache, f'chm_{ch["tile"]}_{r0}_{r1}_{c0}_{c1}.npz')
    if not os.path.exists(fn):
        os.makedirs(cache, exist_ok=True)
        print('  canopy height', ch['tile'], r0, r1, c0, c1)
        chm, _ = strip_window(url, r0, r1, c0, c1)
        np.savez_compressed(fn, chm=chm, geo=np.array([gx + c0 * px, gy - r0 * px, px]))
    d = np.load(fn)
    return deseam(d['chm'], r0, c0), tuple(d['geo'])


def deseam(chm, r0, c0, block=1024, reach=16):
    """The model ran on 1024 px blocks of the tile: their edges show as straight steps (~3x the usual pixel step,
    ~1 km apart). Level each edge: half the step (smoothed along the edge) is taken off either side, fading out over
    `reach` px."""
    a = chm.astype(np.float32)
    ramp = np.clip(1 - np.arange(reach) / reach, 0, 1) / 2
    for axis in (0, 1):
        n, off = a.shape[axis], (r0, c0)[axis]
        for b in range(block - off % block, n, block):
            if b < reach or b > n - reach:
                continue
            lo, hi = np.take(a, b - 1, axis), np.take(a, b, axis)
            # the step across the edge, less the slope of its neighbours
            step = gaussian_filter((hi - lo) - 0.5 * ((lo - np.take(a, b - 2, axis)) + (np.take(a, b + 1, axis) - hi)), 25)
            for k in range(reach):
                if axis == 0:
                    a[b - 1 - k] += step * ramp[k]
                    a[b + k] -= step * ramp[k]
                else:
                    a[:, b - 1 - k] += step * ramp[k]
                    a[:, b + k] -= step * ramp[k]
            # and blur the 4 px across it (the two blocks' crowns do not match pixel for pixel)
            sl = [slice(None)] * 2
            sl[axis] = slice(b - 6, b + 6)
            blur = gaussian_filter1d(a[tuple(sl)], 1.5, axis=axis)
            sl[axis] = slice(b - 2, b + 2)
            a[tuple(sl)] = blur[(slice(4, 8), slice(None)) if axis == 0 else (slice(None), slice(4, 8))]
    return np.clip(a, 0, None)


def to_map_grid(chm, geo, proj, ext, cell=1.0):
    """CHM resampled onto the map's own x / z grid (bilinear; Mercator pixels are square on the ground)."""
    X, Z = grid_coords(ext, cell)
    lat, lon = proj.inv(X, Z)
    mx, my = merc(lat, lon)
    gx, gy, px = geo
    return map_coordinates(chm.astype(np.float32), [(gy - my) / px - 0.5, (mx - gx) / px - 0.5], order=1, mode='nearest')


def disk(r):
    k = int(math.ceil(r))
    y, x = np.mgrid[-k : k + 1, -k : k + 1]
    return x * x + y * y <= r * r


def crowns(h, min_h=3.0, cell=1.0):
    """Tree tops = local maxima of the smoothed CHM within a window that grows with height; crowns = watershed of the
    canopy (h >= 2 m) from those tops. -> rows, cols, heights, crown radii (m), label image."""
    s = gaussian_filter(h, 1.0 / cell)
    # Search radius by height: coppice 4-8 m tall has 2-3 m crowns, 20 m pines 3-4 m (the crowns of a closed stand touch).
    radii = [1.5, 2.0, 2.5, 3.0, 3.5]
    edges = [0, 6, 10, 15, 20, 1e9]
    top = np.zeros(h.shape, bool)
    for r, lo, hi in zip(radii, edges[:-1], edges[1:]):
        band = (s >= max(lo, min_h)) & (s < hi)
        if band.any():
            top |= band & (s >= maximum_filter(s, footprint=disk(r / cell)) - 1e-4)
    # Plateaus (uint8 metres, a flat crown) give several equal maxima: keep one per connected blob.
    from scipy.ndimage import label, center_of_mass

    lab, n = label(top)
    cm = np.array(center_of_mass(top, lab, range(1, n + 1))).reshape(-1, 2)
    rr, cc = np.round(cm[:, 0]).astype(int), np.round(cm[:, 1]).astype(int)
    canopy = s >= 2.0
    markers = np.zeros(h.shape, np.int32)
    markers[rr, cc] = np.arange(1, len(rr) + 1)
    markers[~canopy] = -1
    inv = (255 - np.clip(s * 8, 0, 255)).astype(np.uint8)
    seg = watershed_ift(inv, markers)
    seg[~canopy] = 0
    area = np.bincount(seg.ravel()[seg.ravel() > 0], minlength=len(rr) + 1)[1:] * cell * cell
    # A segment in a closed stand can hold several crowns the smooth CHM merged: cap the radius by height.
    rad = np.minimum(np.sqrt(area / np.pi), 1.5 + 0.3 * s[rr, cc])
    return rr, cc, s[rr, cc], rad, seg, s


GRID = 10
SOURCE = ('Canopy height: Meta and World Resources Institute, High Resolution Canopy Height Maps (CC BY 4.0), imagery (c) '
          'Maxar 2018-2020')


def blocks(a, cell):
    """(rows, cols) 1 m grid -> (rows', cols', cell * cell) windows centred on every `cell`-th sample (edge padded)."""
    r, c = (a.shape[0] - 1) // cell + 1, (a.shape[1] - 1) // cell + 1
    h = cell // 2
    p = np.pad(a, ((h, r * cell - a.shape[0] - h), (h, c * cell - a.shape[1] - h)), mode='edge')
    return p.reshape(r, cell, c, cell).swapaxes(1, 2).reshape(r, c, cell * cell)


def main(cfg_path, cache=None):
    cfg = json.load(open(cfg_path))
    ch = cfg['canopyHeight']
    cache = cache or os.path.join(ROOT, ch['cache'])
    proj = Proj(*cfg['origin'])
    ext = cfg['landcover']['extent']
    chm, geo = load_chm(cfg, cache)
    print(f'  chm window {chm.shape}, px {geo[2]:.3f} m (merc), max {chm.max()} m')
    h = to_map_grid(chm, geo, proj, ext)
    rr, cc, th, rad, seg, s = crowns(h, ch.get('minHeight', 3))
    x0, z0 = ext[0], ext[2]
    xs, zs = x0 + cc, z0 + rr

    out_path = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out_path))
    lc = data['landcover']
    zid = rle_decode(lc['rle'], lc['rows'] * lc['cols']).reshape(lc['rows'], lc['cols'])
    names = [zn['cover'] for zn in lc['zones']]
    # the cell World's Landcover.zoneAt reads at each tree (floor from the origin)
    ci = np.clip(np.floor((zs - lc['originZ']) / lc['cell']).astype(int), 0, lc['rows'] - 1)
    cj = np.clip(np.floor((xs - lc['originX']) / lc['cell']).astype(int), 0, lc['cols'] - 1)
    cover = zid[ci, cj]

    # Canopy share per 10 m cell, stand height (p90 of the canopy pixels) per 20 m cell: sample points x0 + cell i,
    # z0 + cell j. The stand height changes over a stand, not a crown: the coarser grid halves the file.
    canopy = s >= 2.0
    share = blocks(canopy, GRID).mean(axis=2)
    hb = np.where(blocks(canopy, 2 * GRID), blocks(s, 2 * GRID), np.nan)
    with np.errstate(all='ignore'), warnings.catch_warnings():
        warnings.simplefilter('ignore')
        stand = np.nan_to_num(np.nanpercentile(hb, 90, axis=2))
    del hb
    lit = blocks(canopy, 2 * GRID).mean(axis=2) >= 0.125
    stand = np.where(lit, np.clip(np.round(stand / 2), 1, 20), 0).astype(np.uint8)

    def raster(a, cell, scale):
        return {'originX': x0, 'originZ': z0, 'cell': cell, 'cols': int(a.shape[1]), 'rows': int(a.shape[0]),
                'rle': rle_b64(a), 'scale': scale}

    # The trees placed as they stand: every crown outside the wood covers, and the lone ones in them (little canopy
    # within ~loneSigma m: clearings, edges).
    near = gaussian_filter(canopy.astype(np.float32), ch.get('loneSigma', 8))[rr, cc]
    woods = np.isin(cover, [i for i, n in enumerate(names) if n in ch.get('woods', ['pine', 'mixed', 'oakwood', 'trees'])])
    lone = (near < ch.get('loneCover', 0.45)) | ~woods
    out = {
        # share in quarters, height in 2 m steps
        'cover': raster(np.round(share * 4).astype(np.uint8), GRID, 0.25),
        'height': raster(stand, 2 * GRID, 2),
        # x, z, height (whole metres: the CHM's own steps)
        'trees': [int(v) for t in zip(xs[lone], zs[lone], np.round(th[lone])) for v in t],
    }
    fn = os.path.join(ROOT, ch.get('out', os.path.join(os.path.dirname(cfg['out']), 'canopy.json')))
    with open(fn, 'w', newline='\n') as f:
        json.dump(out, f, separators=(',', ':'))
    data['meta']['sources'] = [s for s in data['meta']['sources'] if not s.startswith('Canopy height:')] + [SOURCE]
    with open(out_path, 'w', newline='\n') as f:
        json.dump(data, f, separators=(',', ':'))

    np.savez_compressed(os.path.join(cache, 'trees.npz'), x=xs.astype(np.float32), z=zs.astype(np.float32),
                        h=th.astype(np.float32), r=rad.astype(np.float32), cover=cover.astype(np.uint8), names=np.array(names))
    print(f'  {len(xs)} crowns ({len(xs) / ((ext[1] - ext[0]) * (ext[3] - ext[2]) / 1e4):.0f} / ha), {lone.sum()} placed')
    cz = np.clip(np.round((np.arange(lc['rows']) * lc['cell'] + lc['originZ'] - z0) / GRID).astype(int), 0, share.shape[0] - 1)
    cx = np.clip(np.round((np.arange(lc['cols']) * lc['cell'] + lc['originX'] - x0) / GRID).astype(int), 0, share.shape[1] - 1)
    share5 = share[np.ix_(cz, cx)]
    for k in np.unique(zid):
        sel = cover == k
        print(f'    {names[k]:10s} canopy {100 * share5[zid == k].mean():3.0f} %, {sel.sum():6d} crowns, {(sel & lone).sum():6d} placed'
              + (f', h p50 {np.median(th[sel]):4.1f} m' if sel.any() else ''))
    print(f'  {fn}: {os.path.getsize(fn) / 1024:.0f} kB (cover {len(out["cover"]["rle"]) / 1024:.0f} kB,'
          f' height {len(out["height"]["rle"]) / 1024:.0f} kB)')


if __name__ == '__main__':
    a = sys.argv[1:]
    main(a[0], a[a.index('--cache') + 1] if '--cache' in a else None)
