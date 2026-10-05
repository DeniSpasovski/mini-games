"""
Trace a route drawn on a map screenshot (e.g. the purple Google Maps directions line) and list the parts
that OpenStreetMap has no drivable way for, as lat/lon polylines for the bake config ("extraWays").

    python scripts/realmap/trace_route.py scripts/realmap/petralica.json

Config block "trace": image (path from the repo root), startPx / endPx = pixel of the first / last waypoint
marker in the image (the image is georeferenced by those two points: north-up screenshot, no rotation),
color [r, g, b] of the route line, tol (colour distance), gap (m from an OSM way that counts as "missing").
Accuracy is limited by the screenshot (a 5 m / px image gives roughly +-10..25 m, tight hairpins are
rounded off) - replace the traced parts when OSM gets the road or a closer screenshot is available.
"""

import heapq
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

import bake


def centreline(mask, start, end):
    """Cheapest 8-connected pixel path start -> end that stays in the middle of the mask."""
    dt = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    cost = np.where(mask, 1 + 40 / (0.5 + dt) ** 2, 400.0)  # leaving the line is possible but dear
    H, W = mask.shape
    s, t = (start[1], start[0]), (end[1], end[0])
    dist = {s: 0.0}
    prev = {}
    pq = [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t:
            break
        if d > dist[u]:
            continue
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                v = (u[0] + dy, u[1] + dx)
                if (dy or dx) and 0 <= v[0] < H and 0 <= v[1] < W:
                    nd = d + cost[v] * (1.4142 if dy and dx else 1)
                    if nd < dist.get(v, 1e18):
                        dist[v] = nd
                        prev[v] = u
                        heapq.heappush(pq, (nd, v))
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return np.array(path[::-1], float)[:, ::-1]  # [n, (x, y)]


def main():
    cfg = json.load(open(sys.argv[1]))
    tr = cfg['trace']
    proj = bake.Proj(*cfg['origin'])
    img = np.asarray(Image.open(os.path.join(bake.ROOT, tr['image'])).convert('RGB')).astype(int)
    mask = np.linalg.norm(img - np.array(tr['color']), axis=2) < tr.get('tol', 90)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
    px = centreline(mask, tr['startPx'], tr['endPx'])
    # Georeference: the two waypoint markers.
    w0, w1 = proj.fwd(*cfg['waypoints'][0]), proj.fwd(*cfg['waypoints'][-1])
    (sx, sy), (ex, ey) = tr['startPx'], tr['endPx']
    kx, kz = (w1[0] - w0[0]) / (ex - sx), (w1[1] - w0[1]) / (ey - sy)
    world = np.stack([w0[0] + (px[:, 0] - sx) * kx, w0[1] + (px[:, 1] - sy) * kz], 1)
    world = bake.resample(world, 2.0)
    k = int(round(tr.get('smooth', 14) / 2))  # moving average: pixel staircase -> smooth line
    pad = np.vstack([np.repeat(world[:1], k, 0), world, np.repeat(world[-1:], k, 0)])
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    world = np.stack([np.convolve(pad[:, 0], ker, 'valid'), np.convolve(pad[:, 1], ker, 'valid')], 1)
    length = np.linalg.norm(np.diff(world, axis=0), axis=1).sum()
    print(f'scale {kx:.2f} x {abs(kz):.2f} m/px, traced line {length:.0f} m')

    # OSM drivable ways near the trace.
    box = [f(v) for f, v in zip((min, max, min, max), zip(*[
        (la - 0.01, la + 0.01, lo - 0.015, lo + 0.015) for la, lo in (proj.inv(*p) for p in world[::50])]))]  # fmt: skip
    lcc = cfg['landcover']['extent']
    la0, lo0 = proj.inv(lcc[0] - 150, lcc[3] + 150)
    la1, lo1 = proj.inv(lcc[1] + 150, lcc[2] - 150)
    nodes, _, ways, _ = bake.load_osm(la0, la1, lo0, lo1)
    pts = []
    for w in ways.values():
        if w['tags'].get('highway') in bake.DRIVABLE:
            p = np.array([proj.fwd(*nodes[r]) for r in w['refs']])
            if len(p) > 1:
                pts.append(bake.resample(p, 3.0))
    osm = np.vstack(pts)
    d, near = cKDTree(osm).query(world)
    covered = d < tr.get('gap', 45)
    off = osm[near] - world  # trace -> OSM where both exist
    print(f'OSM covers {covered.mean() * 100:.0f}% of the traced line; median offset where covered {np.median(d[covered]):.1f} m')
    out = []
    i = 0
    n = len(world)
    over = 30  # samples (60 m) of overlap so the traced way reaches the OSM way it continues
    win = 150  # samples (300 m) of covered line next to a gap used to measure the local trace -> OSM offset

    def local_offset(a, b):
        m = covered[max(0, a) : max(0, b)]
        return np.median(off[max(0, a) : max(0, b)][m], axis=0) if m.sum() > 10 else None
    while i < n:
        if covered[i]:
            i += 1
            continue
        j = i
        while j < n and not covered[j]:
            j += 1
        if (j - i) * 2 > tr.get('minGap', 400):
            a, b = max(0, i - over), min(n, j + over)
            # Rubber-sheet the gap onto the OSM roads it joins: blend the offsets measured on both sides
            # (a side with no OSM road - the route end - keeps the screenshot georeference).
            oa, ob = local_offset(i - win, i), local_offset(j, j + win)
            oa = np.zeros(2) if oa is None else oa
            ob = np.zeros(2) if ob is None else ob
            t = np.clip((np.arange(a, b) - i) / max(1, j - i), 0, 1)[:, None]
            seg = world[a:b] + oa * (1 - t) + ob * t
            print(f'    offsets applied: start {oa.round(1)}, end {ob.round(1)} m')
            approx = cv2.approxPolyDP(np.round(seg * 10).astype(np.int32).reshape(-1, 1, 2), 15, False).reshape(-1, 2) / 10
            ll = [[round(v, 6) for v in proj.inv(x, z)] for x, z in approx]
            print(f'  missing in OSM: {i * 2} .. {j * 2} m along the trace ({(j - i) * 2} m) -> {len(ll)} points')
            out.append({'note': f'traced from {os.path.basename(tr["image"])} ({i * 2}-{j * 2} m along the route)', 'pts': ll})
        i = j
    print('"extraWays": ' + json.dumps(out))
    np.save(os.path.join(bake.CACHE, f'{cfg["id"]}_trace.npy'), world)


if __name__ == '__main__':
    main()
