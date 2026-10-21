"""
Leaf type baker: splits a map's woods into evergreen / mixed / broadleaf from two Sentinel-2 scenes (a leafless winter
one and a full-leaf summer one). OSM rarely tags leaf_type, so bake.py paints every hill wood as one class (`pine`); this
step repaints it from the satellite. Run after bake.py (it rewrites the land cover in the map's data.json).

    python scripts/realmap/leaf_type.py scripts/realmap/vodno.json

Reads the bake config's optional "landcover.leafType" block:

    "leafType": {
      "winter": "S2B_34TEM_20250306_0_L2A", "summer": "S2B_34TEM_20250704_0_L2A",
      "from": ["pine"], "evergreen": "pine", "mixed": "mixed", "broadleaf": "oakwood", "split": [0.35, 0.65]
    }

Scenes are Sentinel-2 L2A COGs (Copernicus data, free and open) from the AWS open data bucket `sentinel-cogs`; pick a
cloud- and snow-free winter scene after leaf fall / before leaf-out. Per 10 m pixel the evergreen share is unmixed from
the winter NDVI and the winter / summer NDVI ratio between the map's own darkest and greenest tree pixels; `split` = the
share where mixed starts and where evergreen starts.
"""

import base64
import json
import math
import os
import struct
import sys
import zlib

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import CACHE, ROOT, Proj, grid_coords, http_range, rle_b64  # noqa: E402

S2_URL = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/{z}/{b}/{sq}/{y}/{m}/{scene}/{band}.tif'


def utm(lat, lon, zone):
    """WGS84 -> UTM north (easting, northing), Krueger series (mm accuracy)."""
    a, f = 6378137.0, 1 / 298.257223563
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n * n / 4 + n**4 / 64)
    al = [n / 2 - 2 * n * n / 3 + 5 * n**3 / 16, 13 * n * n / 48 - 3 * n**3 / 5, 61 * n**3 / 240]
    phi, lam = np.radians(lat), np.radians(lon - (zone * 6 - 183))
    e = 2 * math.sqrt(n) / (1 + n)
    t = np.sinh(np.arctanh(np.sin(phi)) - e * np.arctanh(e * np.sin(phi)))
    xi, eta = np.arctan2(t, np.cos(lam)), np.arctanh(np.sin(lam) / np.sqrt(1 + t * t))
    E = eta + sum(al[j] * np.cos(2 * (j + 1) * xi) * np.sinh(2 * (j + 1) * eta) for j in range(3))
    N = xi + sum(al[j] * np.sin(2 * (j + 1) * xi) * np.cosh(2 * (j + 1) * eta) for j in range(3))
    return 500000 + 0.9996 * A * E, 0.9996 * A * N


def cog_u16(url, r0, r1, c0, c1):
    """Window of a tiled uint16 GeoTIFF (DEFLATE, horizontal predictor) + its (x0, y0, pixel size)."""
    head = http_range(url, 0, 65535)
    bo = '<' if head[:2] == b'II' else '>'
    off = struct.unpack(bo + 'I', head[4:8])[0]
    sizes = {1: 1, 3: 2, 4: 4, 12: 8, 16: 8}
    fmts = {1: 'B', 3: 'H', 4: 'I', 12: 'd', 16: 'Q'}
    tags = {}
    for i in range(struct.unpack(bo + 'H', head[off : off + 2])[0]):
        e = head[off + 2 + i * 12 : off + 14 + i * 12]
        tag, typ, cnt = struct.unpack(bo + 'HHI', e[:8])
        if typ not in fmts:
            continue
        sz = sizes[typ] * cnt
        vo = struct.unpack(bo + 'I', e[8:12])[0]
        data = e[8 : 8 + sz] if sz <= 4 else head[vo : vo + sz] if vo + sz <= len(head) else http_range(url, vo, vo + sz - 1)
        tags[tag] = struct.unpack(bo + fmts[typ] * cnt, data)
    W, tw, th = tags[256][0], tags[322][0], tags[323][0]
    assert tags[259][0] == 8 and tags[258][0] == 16, 'expected DEFLATE uint16'
    pred = tags.get(317, (1,))[0]
    geo = (tags[33922][3], tags[33922][4], tags[33550][0])
    if r1 is None:
        return geo
    tpr = (W + tw - 1) // tw
    out = np.zeros((r1 - r0, c1 - c0), np.uint16)
    for tr in range(r0 // th, (r1 - 1) // th + 1):
        for tc in range(c0 // tw, (c1 - 1) // tw + 1):
            i = tr * tpr + tc
            a = np.frombuffer(zlib.decompress(http_range(url, tags[324][i], tags[324][i] + tags[325][i] - 1)), bo + 'u2')
            a = a.reshape(th, tw).astype(np.uint16)
            if pred == 2:
                a = np.cumsum(a, axis=1, dtype=np.uint16)
            ys, ye = max(r0, tr * th), min(r1, (tr + 1) * th)
            xs, xe = max(c0, tc * tw), min(c1, (tc + 1) * tw)
            out[ys - r0 : ye - r0, xs - c0 : xe - c0] = a[ys - tr * th : ye - tr * th, xs - tc * tw : xe - tc * tw]
    return out, geo


def ndvi(scene, E, N):
    """NDVI of a scene sampled at UTM points E, N (bilinear on the 10 m bands), cached per scene and window."""
    tile = scene.split('_')[1]
    date = scene.split('_')[2]
    z, b, sq = tile[:2], tile[2], tile[3:]
    url = lambda band: S2_URL.format(z=z, b=b, sq=sq, y=date[:4], m=int(date[4:6]), scene=scene, band=band)
    x0, y0, px = cog_u16(url('B04'), 0, None, 0, 0)
    c0, c1 = int((E.min() - x0) // px) - 2, int((E.max() - x0) // px) + 3
    r0, r1 = int((y0 - N.max()) // px) - 2, int((y0 - N.min()) // px) + 3
    fn = os.path.join(CACHE, 'sentinel2', f'{scene}_{r0}_{r1}_{c0}_{c1}.npz')
    if not os.path.exists(fn):
        os.makedirs(os.path.dirname(fn), exist_ok=True)
        print('  sentinel-2', scene, r0, r1, c0, c1)
        np.savez_compressed(fn, red=cog_u16(url('B04'), r0, r1, c0, c1)[0], nir=cog_u16(url('B08'), r0, r1, c0, c1)[0])
    d = np.load(fn)
    red, nir = d['red'].astype(np.float32), d['nir'].astype(np.float32)
    v = (nir - red) / np.maximum(nir + red, 1)
    rows = (y0 - N) / px - r0 - 0.5
    cols = (E - x0) / px - c0 - 0.5
    return map_coordinates(v, [rows, cols], order=1, mode='nearest')


def rle_decode(s, n):
    b = base64.b64decode(s)
    out = np.zeros(n, np.uint8)
    p = o = 0
    while p < len(b) and o < n:
        v = b[p]
        p += 1
        L = sh = 0
        while True:
            c = b[p]
            p += 1
            L |= (c & 0x7F) << sh
            sh += 7
            if not c & 0x80:
                break
        out[o : o + L] = v
        o += L
    return out


def main(cfg_path):
    cfg = json.load(open(cfg_path))
    lt = cfg['landcover']['leafType']
    out = os.path.join(ROOT, cfg['out'])
    data = json.load(open(out))
    lc = data['landcover']
    proj = Proj(*cfg['origin'])
    X, Z = grid_coords(cfg['landcover']['extent'], lc['cell'])
    assert X.shape == (lc['rows'], lc['cols']), 'land cover grid does not match the config extent'
    lat, lon = proj.inv(X, Z)
    zone = int(lt['winter'].split('_')[1][:2])
    E, N = utm(lat, lon, zone)
    win, summ = ndvi(lt['winter'], E, N), ndvi(lt['summer'], E, N)

    # Endmembers from the map's own trees (summer-green pixels): darkest winter = leafless, greenest = evergreen.
    tree = summ > 0.6
    lo, hi = np.percentile(win[tree], [3, 97])
    ratio = win / np.maximum(summ, 0.3)
    rlo, rhi = np.percentile(ratio[tree], [3, 97])
    share = (np.clip((win - lo) / (hi - lo), 0, 1) + np.clip((ratio - rlo) / (rhi - rlo), 0, 1)) / 2
    # The 10 m pixels mix crowns: smooth to stand scale so a class edge follows stands, not single pixels. Weighted by
    # summer green, so a road, a clearing or a roof (leafless-looking in both scenes) never reads as broadleaf.
    w = np.clip((summ - 0.4) / 0.2, 0, 1)
    sig = lt.get('smooth', 10) / lc['cell']
    share = gaussian_filter(share * w, sig) / np.maximum(gaussian_filter(w, sig), 1e-3)

    names = [zn['cover'] for zn in lc['zones']]
    targets = [lt['evergreen'], lt['mixed'], lt['broadleaf']]
    for c in targets:
        if c not in names:
            lc['zones'].append({'cover': c})
            names.append(c)
    zid = rle_decode(lc['rle'], lc['rows'] * lc['cols']).reshape(lc['rows'], lc['cols'])
    src = np.isin(zid, [i for i, zn in enumerate(lc['zones']) if zn['cover'] in set(lt['from']) | set(targets) and 'angle' not in zn])
    lo_s, hi_s = lt.get('split', [0.35, 0.65])
    cls = np.where(share >= hi_s, 2, np.where(share >= lo_s, 1, 0))
    for k, c in enumerate([lt['broadleaf'], lt['mixed'], lt['evergreen']]):
        zid[src & (cls == k)] = names.index(c)
    lc['rle'] = rle_b64(zid)
    note = 'Leaf type: Copernicus Sentinel-2 L2A (contains modified Copernicus Sentinel data)'
    data['meta']['sources'] = [s for s in data['meta']['sources'] if not s.startswith('Leaf type:')] + [note]
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    tot = src.sum()
    print(f'  endmembers ndvi {lo:.2f}-{hi:.2f}, ratio {rlo:.2f}-{rhi:.2f}; woods {tot * lc["cell"] ** 2 / 1e4:.0f} ha: '
          + ', '.join(f'{c} {100 * np.mean(cls[src] == k):.0f} %' for k, c in enumerate([lt['broadleaf'], lt['mixed'], lt['evergreen']])))
    print(f'  evergreen share of the woods {100 * share[src].mean():.0f} %')


if __name__ == '__main__':
    main(sys.argv[1])
