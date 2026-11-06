"""
Culverts where the elevation data says water crosses the stage road (OpenStreetMap has none on these roads) ->
maps/<id>/culverts.json. Drainage on the map's own baked height grid (data.json "heightmap": the detail grid, the outer
grid round it), so the folds are the ones the player sees.

    python scripts/realmap/culverts.py scripts/realmap/vodno.json [--min-area 2] [--min-fold 0.6] [--preview out.png] [--dry]

Method:
- sinks filled (priority flood), multiple-flow-direction accumulation (Freeman, slope^1.1 over the lower neighbours):
  flow spreads on a plain slope and gathers in a fold, so D8's parallel lines on a smooth hillside never read as gullies;
- the catchment (ha) along the route line (the largest within one cell); a culvert where it peaks: >= --min-area,
  the highest within --merge m and --prominence x the low on both sides (a fold, not a slope draining along the road);
- kept in a fold (--min-fold m: the land 20-50 m either side across the flow above the flow line, or the route line
  dipping below the line between its points 15-40 m either side), where the flow crosses the road (at most --max-skew
  degrees off square: a flow along the road is its ditch), up to --max-area (more is a stream: a bridge), off built-up
  ground (--skip-covers: streets drain to sewers) and away from OSM water ways (bridged / culverted already) and bridge
  spans;
- the flow direction there (MFD flow vector round the point) = the pipe's direction.
The engine projects every point onto the game road (world/culverts.ts): the file holds world points, not distances.
"lines" = the D8 links where the MFD catchment is >= --line-area ha within --line-reach m of the route (map viewer
`drain=1`).
"""

import argparse
import base64
import heapq
import json
import math
import os

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree

import bake

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def decode_grid(g, base, step):
    v = np.frombuffer(base64.b64decode(g['data']), '<i2').astype(np.float64) * step + base
    return v.reshape(g['rows'], g['cols'])


def composite(hm, bbox, margin):
    """The detail grid at its own cell, the outer grid (bilinear) round it out to bbox + margin."""
    det, out = hm['grids'][0], hm['grids'][-1]
    cell = det['cell']
    D = decode_grid(det, hm['base'], hm['step'])
    O = decode_grid(out, hm['base'], hm['step'])
    x0 = max(out['originX'], bbox[0] - margin)
    z0 = max(out['originZ'], bbox[1] - margin)
    x1 = min(out['originX'] + (out['cols'] - 1) * out['cell'], bbox[2] + margin)
    z1 = min(out['originZ'] + (out['rows'] - 1) * out['cell'], bbox[3] + margin)
    x0 = det['originX'] + math.floor((x0 - det['originX']) / cell) * cell
    z0 = det['originZ'] + math.floor((z0 - det['originZ']) / cell) * cell
    W = int((x1 - x0) / cell) + 1
    H = int((z1 - z0) / cell) + 1
    zz, xx = np.mgrid[0:H, 0:W]
    a = map_coordinates(
        O,
        [(z0 + zz * cell - out['originZ']) / out['cell'], (x0 + xx * cell - out['originX']) / out['cell']],
        order=1,
        mode='nearest',
    )
    i0 = int(round((det['originX'] - x0) / cell))
    j0 = int(round((det['originZ'] - z0) / cell))
    jj0, ii0 = max(0, j0), max(0, i0)
    jj1, ii1 = min(H, j0 + det['rows']), min(W, i0 + det['cols'])
    a[jj0:jj1, ii0:ii1] = D[jj0 - j0 : jj1 - j0, ii0 - i0 : ii1 - i0]
    return a, float(x0), float(z0), float(cell)


def fill(a):
    """Priority flood from the border: every pit filled to its spill height + a tiny slope (so flats drain)."""
    H, W = a.shape
    f = a.astype(np.float64).copy()
    done = np.zeros((H, W), bool)
    done[[0, -1], :] = done[:, [0, -1]] = True
    pq = [(f[i, j], i, j) for i, j in zip(*np.nonzero(done))]
    heapq.heapify(pq)
    while pq:
        h, i, j = heapq.heappop(pq)
        for di, dj in N8:
            u, v = i + di, j + dj
            if 0 <= u < H and 0 <= v < W and not done[u, v]:
                done[u, v] = True
                f[u, v] = max(f[u, v], h + 1e-3)
                heapq.heappush(pq, (f[u, v], u, v))
    return f


def mfd(f, cell, p=1.1):
    """Multiple-flow-direction accumulation (cells) + the weights per direction + the D8 receiver (lines)."""
    H, W = f.shape
    w = np.zeros((8, H, W))
    best = np.zeros((H, W))
    rec = np.full((H, W), -1, np.int64)
    rows, cols = np.mgrid[0:H, 0:W]
    for k, (di, dj) in enumerate(N8):
        u, v = rows + di, cols + dj
        ok = (u >= 0) & (u < H) & (v >= 0) & (v < W)
        uc, vc = np.clip(u, 0, H - 1), np.clip(v, 0, W - 1)
        dist = math.hypot(di, dj) * cell
        s = np.where(ok, (f - f[uc, vc]) / dist, 0)
        # Quinn: contour length 0.5 (cardinal) / 0.354 (diagonal) cells
        w[k] = np.where(s > 0, np.maximum(s, 0) ** p * (0.5 if di == 0 or dj == 0 else 0.354), 0)
        m = ok & (s > best)
        best[m] = s[m]
        rec[m] = (uc * W + vc)[m]
    tot = w.sum(0)
    w /= np.where(tot > 0, tot, 1)
    acc = np.ones(H * W)
    wf = [w[k].ravel().tolist() for k in range(8)]
    offs = [di * W + dj for di, dj in N8]
    accl = acc.tolist()
    for c in np.argsort(-f, axis=None).tolist():
        v = accl[c]
        for k in range(8):
            wk = wf[k][c]
            if wk > 0:
                accl[c + offs[k]] += v * wk
    return np.array(accl), w, rec.ravel()


def decode_rle(rle, n):
    b = base64.b64decode(rle)
    out = np.zeros(n, np.uint8)
    p = o = 0
    while p < len(b) and o < n:
        v = b[p]
        p += 1
        ln = shift = 0
        while True:
            c = b[p]
            p += 1
            ln |= (c & 0x7F) << shift
            shift += 7
            if not c & 0x80:
                break
        out[o : min(n, o + ln)] = v
        o += ln
    return out


def seg_intersect(p, q, a, b):
    """Parameters (t on p->q, u on a->b) where the segments cross, or None."""
    r = q - p
    s = b - a
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9:
        return None
    w = a - p
    t = (w[0] * s[1] - w[1] * s[0]) / den
    u = (w[0] * r[1] - w[1] * r[0]) / den
    return (t, u) if 0 <= t <= 1 and 0 <= u <= 1 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--min-area', type=float, default=2.0, help='catchment (ha) a culvert needs')
    ap.add_argument('--min-fold', type=float, default=0.6, help='fold depth (m)')
    ap.add_argument('--max-area', type=float, default=200.0, help='a larger catchment is a stream: a bridge, not a pipe (ha)')
    ap.add_argument('--skip-covers', default='urban', help='land covers with no culvert (comma list: built-up ground drains to sewers)')
    ap.add_argument('--max-skew', type=float, default=60.0, help='flow this far off square to the road (deg) runs along it')
    ap.add_argument('--merge', type=float, default=120.0, help='one culvert per peak within this distance along (m)')
    ap.add_argument('--prominence', type=float, default=1.6, help='peak / low on both sides within --merge')
    ap.add_argument('--water-gap', type=float, default=40.0, help='no culvert this close to an OSM water way crossing (m)')
    ap.add_argument('--line-area', type=float, default=1.0, help='drainage lines drawn from this catchment (ha)')
    ap.add_argument('--thalweg', type=float, default=1.3, help='a drawn line starts where the catchment is this x its neighbours across')
    ap.add_argument('--line-reach', type=float, default=400.0, help='drainage lines drawn within this distance of the route (m)')
    ap.add_argument('--from', dest='frm', type=float, default=0.0, help='only past this distance along the route (m)')
    ap.add_argument('--to', type=float, default=1e9, help='... and before this one (m)')
    ap.add_argument('--preview', help='PNG: hillshade, drainage lines, route, culverts')
    ap.add_argument('--dry', action='store_true', help='print only')
    args = ap.parse_args()
    cfg = json.load(open(args.config, encoding='utf-8'))
    data_path = os.path.join(bake.ROOT, cfg['out'])
    data = json.load(open(data_path, encoding='utf-8'))
    route = np.array(data['route'], np.float64)
    seg = np.linalg.norm(np.diff(route, axis=0), axis=1)
    cum = np.r_[0, np.cumsum(seg)]
    a, x0, z0, cell = composite(data['heightmap'], (*route.min(0), *route.max(0)), 1500)
    H, W = a.shape
    print(f'grid {W} x {H} @ {cell} m')
    f = fill(a)
    acc, wts, rec = mfd(f, cell)
    area = acc * cell * cell / 1e4  # ha

    def world(k):
        return np.array([x0 + (k % W) * cell, z0 + (k // W) * cell])

    def sample(px, pz, g=a, order=3):
        return map_coordinates(g, [(np.asarray(pz) - z0) / cell, (np.asarray(px) - x0) / cell], order=order, mode='nearest')

    # route samples every 2 m
    al = np.linspace(0, cum[-1], int(cum[-1] / 2) + 1)
    rx = np.interp(al, cum, route[:, 0])
    rz = np.interp(al, cum, route[:, 1])
    rh = sample(rx, rz)
    tree = cKDTree(np.c_[rx, rz])

    # catchment along the route: the largest of the cells within one cell of each sample
    A = area.reshape(H, W)
    prof = np.zeros(len(al))
    for n, (x, z) in enumerate(zip(rx, rz)):
        i = int(round((x - x0) / cell))
        j = int(round((z - z0) / cell))
        prof[n] = A[max(0, j - 1) : j + 2, max(0, i - 1) : i + 2].max()

    # OSM water ways crossing the route, bridge spans
    water_al = []
    for p in data.get('paths', []):
        if p.get('surface') != 'water':
            continue
        pts = np.array(p['pts'], np.float64).reshape(-1, 2)
        for i in range(len(pts) - 1):
            for j in tree.query_ball_point((pts[i] + pts[i + 1]) / 2, np.linalg.norm(pts[i + 1] - pts[i]) / 2 + 20):
                ki = np.searchsorted(cum, al[j]) - 1
                for kk in range(max(0, ki - 2), min(len(route) - 1, ki + 3)):
                    hit = seg_intersect(pts[i], pts[i + 1], route[kk], route[kk + 1])
                    if hit:
                        water_al.append(cum[kk] + hit[1] * seg[kk])
    spans = [(s['from'], s['to']) for s in data.get('routeSpans', []) if 'from' in s]

    def dip_at(along):
        best = -1e9
        h0 = np.interp(along, al, rh)
        for L in (15, 25, 40):
            if along - L >= 0 and along + L <= cum[-1]:
                best = max(best, (np.interp(along - L, al, rh) + np.interp(along + L, al, rh)) / 2 - h0)
        return best

    def fold_at(x, z, d):
        """Depth of the fold the water runs in: the land 20 / 35 / 50 m either side across the flow above its line, at the
        crossing and 20 / 40 m upstream (the road's own cut / fill blurs the crossing itself)."""
        nrm = np.array([-d[1], d[0]])
        best = -1e9
        for up in (0, 20, 40):
            c = np.array([x, z]) - d * up
            for L in (20, 35, 50):
                pts = np.array([c, c + nrm * L, c - nrm * L])
                h = sample(pts[:, 0], pts[:, 1])
                best = max(best, (h[1] + h[2]) / 2 - h[0])
        return best

    lc = data['landcover']
    zones = decode_rle(lc['rle'], lc['cols'] * lc['rows'])

    def cover_at(x, z):
        i = int((x - lc['originX']) / lc['cell'])
        j = int((z - lc['originZ']) / lc['cell'])
        if 0 <= i < lc['cols'] and 0 <= j < lc['rows']:
            return lc['zones'][zones[j * lc['cols'] + i]]['cover']
        return '?'

    def flow_dir(x, z, r=25.0):
        """Catchment-weighted MFD flow vector round (x, z) (unit, downstream)."""
        i0 = int(round((x - x0) / cell))
        j0 = int(round((z - z0) / cell))
        rr = int(math.ceil(r / cell))
        v = np.zeros(2)
        for j in range(max(0, j0 - rr), min(H, j0 + rr + 1)):
            for i in range(max(0, i0 - rr), min(W, i0 + rr + 1)):
                if math.hypot(i - i0, j - j0) * cell > r:
                    continue
                k = j * W + i
                for n, (di, dj) in enumerate(N8):
                    wk = wts[n, j, i]
                    if wk > 0:
                        v += acc[k] * wk * np.array([dj, di]) / math.hypot(di, dj)
        return v / (np.linalg.norm(v) or 1)

    # peaks of the catchment along the route
    half = int(args.merge / 2 / 2)
    win = int(args.merge / 2)
    peaks = []
    for n in range(len(al)):
        if prof[n] < args.min_area:
            continue
        lo, hi = max(0, n - half), min(len(al), n + half + 1)
        if prof[n] < prof[lo:hi].max() or (peaks and n - peaks[-1] <= half):
            continue
        left = prof[max(0, n - win) : n + 1].min()
        right = prof[n : n + win + 1].min()
        peaks.append(n)
    found = []
    for n in peaks:
        along = al[n]
        if not args.frm <= along <= args.to:
            continue
        left = prof[max(0, n - win) : n + 1].min()
        right = prof[n : n + win + 1].min()
        d = flow_dir(rx[n], rz[n])
        t = np.array([np.interp(along + 2, al, rx) - rx[n], np.interp(along + 2, al, rz) - rz[n]])
        t /= np.linalg.norm(t) or 1
        found.append(
            {
                'along': along,
                'x': float(rx[n]),
                'z': float(rz[n]),
                'dir': d,
                'skew': math.degrees(math.asin(min(1, abs(float(d @ t))))),
                'area': float(prof[n]),
                'prom': float(prof[n] / max(left, right, 1e-3)),
                'dip': float(dip_at(along)),
                'fold': float(fold_at(rx[n], rz[n], d)),
                'cover': cover_at(rx[n], rz[n]),
                'water': any(abs(along - w) < args.water_gap for w in water_al),
                'span': any(fr - 20 < along < to + 20 for fr, to in spans),
            }
        )
    keep = []
    print(f'{len(found)} catchment peaks >= {args.min_area} ha along the route')
    for c in found:
        why = []
        if c['prom'] < args.prominence:
            why.append(f'prominence {c["prom"]:.1f}')
        if c['area'] > args.max_area:
            why.append('stream (bridge)')
        if c['cover'] in args.skip_covers.split(','):
            why.append(c['cover'])
        if c['skew'] > args.max_skew:
            why.append(f'skew {c["skew"]:.0f}')
        if max(c['dip'], c['fold']) < args.min_fold:
            why.append(f'no fold ({max(c["dip"], c["fold"]):.1f} m)')
        if c['water']:
            why.append('OSM water way')
        if c['span']:
            why.append('bridge')
        c['keep'] = not why
        print(
            f'  {c["along"]:7.0f} m  {c["area"]:7.1f} ha  x{c["prom"]:4.1f}  dip {c["dip"]:4.1f} fold {c["fold"]:4.1f} m  skew {c["skew"]:3.0f}  '
            f'{c["cover"]:<8} ({c["x"]:.0f}, {c["z"]:.0f}) {"KEEP" if not why else "drop (" + ", ".join(why) + ")"}'
        )
        if not why:
            keep.append(c)
    print(f'{len(keep)} culverts')

    # drainage lines near the route (map viewer overlay): D8 links where the MFD catchment is >= line-area
    ys, xs = np.mgrid[0:H, 0:W]
    dist, _ = tree.query(np.c_[(x0 + xs * cell).ravel(), (z0 + ys * cell).ravel()], distance_upper_bound=args.line_reach)
    on = np.isfinite(dist) & (area >= args.line_area)
    # A line starts on a thalweg (the catchment well above its neighbours across the flow): a plain slope's parallel
    # D8 runs never start one; from there it follows D8 downstream.
    A2 = area.reshape(H, W)
    rr, cc = np.divmod(np.where(rec >= 0, rec, np.arange(H * W)), W)
    di = (rr - np.arange(H * W) // W).reshape(H, W)
    dj = (cc - np.arange(H * W) % W).reshape(H, W)
    rows, cols = np.mgrid[0:H, 0:W]
    side = lambda s: A2[np.clip(rows + s * dj, 0, H - 1), np.clip(cols - s * di, 0, W - 1)]
    valley = on & ((A2 / np.maximum((side(1) + side(-1)) / 2, 1e-6)).ravel() >= args.thalweg)
    fed = np.zeros(H * W, bool)
    src = np.nonzero(valley & (rec >= 0))[0]
    fed[rec[src]] = True
    lines = []
    seen = np.zeros(H * W, bool)
    for k in sorted(np.nonzero(valley & ~fed)[0].tolist(), key=lambda k: -area[k]):
        run = [k]
        while rec[k] >= 0 and on[rec[k]] and not seen[rec[k]]:
            k = int(rec[k])
            run.append(k)
        if rec[k] >= 0 and on[rec[k]]:
            run.append(int(rec[k]))  # join the line it flows into
        seen[run[:-1]] = True
        if len(run) < 4:
            continue
        flat = []
        # straight D8 runs: their end points only
        run = [r for n, r in enumerate(run) if n in (0, len(run) - 1) or run[n + 1] - r != r - run[n - 1]]
        for r in run:
            p = world(r)
            flat += [round(float(p[0]), 1), round(float(p[1]), 1)]
        lines.append({'area': round(float(area[run[-1]]), 1), 'pts': flat})

    out = {
        'meta': {
            'about': 'Culverts estimated from the elevation data (scripts/realmap/culverts.py): MFD drainage of the '
            'baked height grid, catchment peaks where the stage road crosses a fold. Elevation credits: data.json meta.sources.',
            'minArea': args.min_area,
            'minFold': args.min_fold,
            'maxSkew': args.max_skew,
            'maxArea': args.max_area,
            'merge': args.merge,
            'prominence': args.prominence,
        },
        'culverts': [
            {
                'x': round(c['x'], 1),
                'z': round(c['z'], 1),
                'dir': [round(float(c['dir'][0]), 3), round(float(c['dir'][1]), 3)],
                'area': round(c['area'], 1),
            }
            for c in keep
        ],
        'lines': lines,
    }
    if args.preview:
        from PIL import Image, ImageDraw

        gz, gx = np.gradient(a, cell)
        shade = np.clip(0.55 + (gx + gz) * -0.6, 0, 1)
        img = Image.fromarray((shade * 200 + 30).astype(np.uint8)).convert('RGB')
        S = 3
        img = img.resize((W * S, H * S), Image.BILINEAR)
        dr = ImageDraw.Draw(img)

        def px(x, z):
            return ((x - x0) / cell * S, (z - z0) / cell * S)

        for ln in lines:
            p = ln['pts']
            dr.line([px(p[i], p[i + 1]) for i in range(0, len(p), 2)], fill=(40, 110, 230), width=1 if ln['area'] < 10 else 3)
        dr.line([px(x, z) for x, z in route], fill=(240, 200, 40), width=3)
        for c in found:
            cx, cz = px(c['x'], c['z'])
            col = (230, 30, 30) if c['keep'] else (150, 150, 150)
            r = 9 if c['keep'] else 5
            dr.ellipse([cx - r, cz - r, cx + r, cz + r], outline=col, width=3)
            dr.text((cx + 10, cz - 6), f'{c["along"]:.0f}', fill=col)
        img.save(args.preview)
        print('preview', args.preview)
    if not args.dry:
        path = os.path.join(os.path.dirname(data_path), 'culverts.json')
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(out, fh, separators=(',', ':'))
            fh.write('\n')
        print('wrote', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
