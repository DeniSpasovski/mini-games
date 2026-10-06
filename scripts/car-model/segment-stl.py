"""Label the parts of a car body STL (glass, lights, grille, vents, wing...) by its own creases.

    python scripts/car-model/segment-stl.py <model.source.json> <in.stl> <out.stl>
        [--preview <prefix>] [--by part|segment] [--views front,left,...]
        [--crop a0,a1,b0,b1] [--scale px-per-metre] [--grid metres]

The mesh is split into smooth patches ("segments": faces joined across edges flatter than
`parts.creaseDeg`), then `parts.picks` assign whole segments to a material - so part borders
follow the model's real feature edges instead of cutting through triangles. The material
index is stored in each triangle's 2-byte STL attribute; stl-to-glb.mjs keeps those borders
through simplification and writes one GLB primitive per material.

`parts` block of model.source.json:
    creaseDeg   segment crease angle (25 works for CAD-like print models)
    absorbArea  segments smaller than this (m2) join the neighbour they share most border with
    materials   material names; index 0 is the painted body (everything not picked)
    picks       [{ name, material, mirror? (default true), seeds?, inside? }], first pick wins
        seeds   [[view, a, b], ...] - the segment SEEN at model coordinates (a, b) in that view
                (front / rear: x, y - left / right: z, y - top / bottom: z, x)
        inside  { x?, y?, z?: [min, max] } - every segment lying completely in the box
        mirror  also apply to the other side (x -> -x; left <-> right view)
        maxArea skip seeds that land on a bigger segment (m2) - a guard for small parts
        adjacent { to: material, maxArea?, x?, y?, z?: [min, max] } - every still-unpicked segment that shares an
                edge with a segment already picked as material `to` (an EARLIER pick), is smaller than `maxArea` (m2)
                and lies completely in the optional box: the black surround of window glass (frame strips, the
                engraved gap, belt moulding) without a seed per strip; the big door / roof skins are skipped by `maxArea`
        shells  true: seeds and `inside` take whole connected shells instead of crease segments
                (print KITS, scripts/car-model/assemble-kit.py: lamps, louvres, slats, mirrors are
                separate closed shells; `inside` then tests the shell's bounding box)
        hub     { radius, facing, minAbsX, maxY? } - per TRIANGLE, for wheel arches (their lips are not
                creased the same on both sides): every still-unpicked triangle within `radius`
                of a wheel centre (`wheels.centres`, z / y), further out than `minAbsX`, whose
                normal points back at the hub (radial component < `facing`, e.g. -0.25); `maxY` keeps
                downward-facing body-line steps above the arch out (they turned into black streaks); `exclude`:
                [{ x?, y?, z? }] boxes (x = |x|) the rule skips
        region  per TRIANGLE, for meshes without creases (image-to-3D blobs): { view, poly:
                [[a, b], ...], depth?: [min, max] (along the view's depth axis), facing?: min
                normal component towards the viewer (default 0.05, -1 = any), grow?: metres
                (offset the outline outwards, negative = inwards), any?: true = also cut triangles already labelled by an
                earlier pick (segment picks run first - without it a wheel cut cannot remove what a segment pick took) } - every still-
                unpicked triangle inside the outline; triangles straddling the outline are CUT
                along it (half-plane of the nearest outline edge), so the part border lies exactly
                on the outline instead of a triangle saw-tooth
        tube    per TRIANGLE: { path: [[x, y, z], ...], radius, over?: [material, ...] (also re-label these, e.g. trim
                an earlier segment pick took) } - every triangle whose centre lies
                within `radius` of the polyline (x on |x| when mirrored): a pipe / bar fused into one shell with
                the body and merged with it into one crease segment, picked as its own part by its centreline
        box     per TRIANGLE: { x?, y?, z?: [min, max], facing?: { axis: min | [min, max] } } by
                triangle centre (x on |x| when mirrored); `facing` = normal component range, an
                axis written "|x|" tests the absolute component

Find seeds with `--preview out --by segment` (random colour per segment, 10 cm model-space
grid); check the result with `--by part`. All coordinates are model space (after the config's
axes / scale / offset), the same numbers the game uses.
"""
import json
import os
import sys

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshview import VIEWS, hex_rgb, normals, pick, render  # noqa: E402

cfg_path, src, dst = sys.argv[1:4]
opts = dict(zip(sys.argv[4::2], sys.argv[5::2]))
cfg = json.load(open(cfg_path, encoding='utf8'))
PC = cfg['parts']
MATERIALS = PC['materials']

# --- load, into model space (same transform as stl-to-glb.mjs) -------------------------------
raw = open(src, 'rb').read()
n = int(np.frombuffer(raw[80:84], '<u4')[0])
rec = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
data = np.frombuffer(raw[84:84 + n * 50], dtype=rec).copy()
S = data['v'].astype(np.float64)
ax = [('xyz'.index(a[-1]), -1 if a.startswith('-') else 1) for a in cfg['axes']]
T = np.stack([S[..., i] * s for i, s in ax], -1) * cfg['scale']
off = np.array(cfg['offset'], float)
if cfg.get('groundAtMin'):
    off[1] -= T[..., 1].min()
T = T + off
N, AREA = normals(T)

# --- segments: union faces across flat edges ------------------------------------------------
_, F = np.unique(np.round(T.reshape(-1, 3) / 2e-5).astype(np.int64), axis=0, return_inverse=True)
F = F.reshape(-1, 3)
e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
fid = np.tile(np.arange(n), 3)
es = np.sort(e, axis=1)
key = es[:, 0].astype(np.int64) * (F.max() + 1) + es[:, 1]
o = np.argsort(key, kind='stable')
same = key[o][1:] == key[o][:-1]
f1, f2 = fid[o][:-1][same], fid[o][1:][same]
ev = es[o][:-1][same]
vpos = np.zeros((F.max() + 1, 3))
vpos[F.reshape(-1)] = T.reshape(-1, 3)
elen = np.linalg.norm(vpos[ev[:, 0]] - vpos[ev[:, 1]], axis=1)
flat = (N[f1] * N[f2]).sum(1) > np.cos(np.radians(PC['creaseDeg']))
parent = np.arange(n)


def find(x):
    r = x
    while parent[r] != r:
        r = parent[r]
    while parent[x] != r:
        parent[x], x = r, parent[x]
    return r


for a, b in zip(f1[flat], f2[flat]):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb
_, seg = np.unique([find(i) for i in range(n)], return_inverse=True)
nseg = seg.max() + 1
seg_area = np.bincount(seg, weights=AREA)
lo = np.full((nseg, 3), np.inf)
hi = np.full((nseg, 3), -np.inf)
for k in range(3):
    np.minimum.at(lo, seg, T[:, k])
    np.maximum.at(hi, seg, T[:, k])
print(f'{n} triangles, {nseg} segments at {PC["creaseDeg"]} deg')

# --- shells: connected components (picks with `shells: true`) ---------------------------------
nv = F.max() + 1
_, vshell = connected_components(coo_matrix(
    (np.ones(2 * n), (np.r_[F[:, 0], F[:, 1]], np.r_[F[:, 1], F[:, 2]])), shape=(nv, nv)), directed=False)
shell = np.unique(vshell[F[:, 0]], return_inverse=True)[1].reshape(-1)
nsh = shell.max() + 1
seg_shell = np.zeros(nseg, int)
seg_shell[seg] = shell
sh_lo = np.full((nsh, 3), np.inf)
sh_hi = np.full((nsh, 3), -np.inf)
for k in range(3):
    np.minimum.at(sh_lo[:, k], shell, T[..., k].min(1))
    np.maximum.at(sh_hi[:, k], shell, T[..., k].max(1))

# --- picks ------------------------------------------------------------------------------------
seg_part = np.zeros(nseg, int)  # material index, 0 = body
seg_pick = np.full(nseg, -1)
MIRROR_VIEW = {'left': 'right', 'right': 'left'}
for pi, p in enumerate(PC['picks']):
    m = MATERIALS.index(p['material'])
    mirror = p.get('mirror', True)
    hits = []
    for view, a, b in p.get('seeds', []):
        tries = [(view, a, b)]
        if mirror:
            if view in MIRROR_VIEW:
                tries.append((MIRROR_VIEW[view], a, b))
            elif view in ('front', 'rear'):
                tries.append((view, -a, b))
            else:
                tries.append((view, a, -b))
        for vw, aa, bb in tries:
            t = pick(T, N, vw, aa, bb)
            if t < 0:
                print(f'  ! {p["name"]}: seed {vw} ({aa}, {bb}) hits nothing')
            elif seg_pick[seg[t]] >= 0:
                print(f'  ! {p["name"]}: seed {vw} ({aa}, {bb}) lands on "{PC["picks"][seg_pick[seg[t]]]["name"]}"')
            elif seg_area[seg[t]] > p.get('maxArea', 1e9):
                print(f'  ! {p["name"]}: seed {vw} ({aa}, {bb}) hit a {seg_area[seg[t]] * 1e4:.0f} cm2 segment'
                      f' (> maxArea) - skipped')
            else:
                hits.append(seg[t])
    by_shell = p.get('shells', False)
    if by_shell and hits:  # a seed takes its whole shell
        hits = list(np.flatnonzero(np.isin(seg_shell, seg_shell[hits])))
    box = p.get('inside')
    if box:
        blo, bhi = (sh_lo, sh_hi) if by_shell else (lo, hi)
        ok = np.ones(len(blo), bool)
        for k, axn in enumerate('xyz'):
            if axn not in box:
                continue
            b0, b1 = box[axn]
            if axn == 'x' and mirror:
                ok &= (np.minimum(np.abs(blo[:, 0]), np.abs(bhi[:, 0])) >= b0) & \
                      (np.maximum(np.abs(blo[:, 0]), np.abs(bhi[:, 0])) <= b1)
                if b0 > 0:
                    ok &= blo[:, 0] * bhi[:, 0] > 0
            else:
                ok &= (blo[:, k] >= b0) & (bhi[:, k] <= b1)
        hits.extend(np.flatnonzero(np.isin(seg_shell, np.flatnonzero(ok))) if by_shell else np.flatnonzero(ok))
    adj = p.get('adjacent')
    if adj:
        a_, b_ = seg[f1], seg[f2]
        d_ = a_ != b_
        pa = np.concatenate([a_[d_], b_[d_]])
        pb = np.concatenate([b_[d_], a_[d_]])
        want = seg_part[pb] == MATERIALS.index(adj['to'])
        ok = np.zeros(nseg, bool)
        ok[pa[want]] = True
        ok &= seg_area <= adj.get('maxArea', 1e9)
        for k, axn in enumerate('xyz'):
            if axn in adj:
                ok &= (lo[:, k] >= adj[axn][0]) & (hi[:, k] <= adj[axn][1])
        hits.extend(np.flatnonzero(ok))
    got = [s for s in dict.fromkeys(hits) if seg_pick[s] < 0]
    seg_part[got] = m
    seg_pick[got] = pi
    tri = np.isin(seg, got).sum()
    print(f'  {p["name"]:<22} {p["material"]:<10} {len(got):4d} segments {tri:6d} triangles '
          f'{seg_area[got].sum() * 1e4:8.0f} cm2')

# --- absorb slivers: tiny segments join the neighbour they share most border with ---------------
small = seg_area < PC.get('absorbArea', 0)
if small.any():
    for _ in range(3):
        a, b = seg[f1], seg[f2]
        diff = a != b
        pa = np.concatenate([a[diff], b[diff]])
        pb = np.concatenate([b[diff], a[diff]])
        w = np.concatenate([elen[diff], elen[diff]])
        best = {}
        for s, t, l in zip(pa, pb, w):
            if small[s] and not small[t]:
                d = best.setdefault(s, {})
                d[seg_part[t]] = d.get(seg_part[t], 0) + l
        changed = 0
        for s, d in best.items():
            m = max(d, key=d.get)
            if seg_part[s] != m:
                seg_part[s] = m
                changed += 1
        if not changed:
            break
    print(f'  absorbed slivers (< {PC["absorbArea"] * 1e4:.0f} cm2)')

part = seg_part[seg]

# --- region / box picks: per triangle (no creases to follow), triangles cut along the outline --
CEN = T.mean(1)


def in_poly(P, poly):
    """Even-odd test of points P (n, 2) against polygon poly (m, 2)."""
    x, y = P[:, 0], P[:, 1]
    inside = np.zeros(len(P), bool)
    m = len(poly)
    for i in range(m):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % m]
        cross = (y0 > y) != (y1 > y)
        xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0 + 1e-30)
        inside ^= cross & (x < xi)
    return inside


def grow_poly(poly, d):
    """Offset a polygon outwards by d (vertex normals of a counter-clockwise outline)."""
    P = np.array(poly, float)
    if d == 0:
        return P
    area = 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])
    sgn = 1 if area > 0 else -1
    e = np.roll(P, -1, 0) - P
    nrm = np.stack([e[:, 1], -e[:, 0]], 1) * sgn
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    vn = nrm + np.roll(nrm, 1, 0)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    return P + vn * d


def convex_pieces(P):
    """A counter-clockwise polygon as convex pieces: itself if convex, else ear-clipped triangles."""
    P = np.array(P, float)
    if 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]) < 0:
        P = P[::-1]
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    m = len(P)
    if all(cross(P[i], P[(i + 1) % m], P[(i + 2) % m]) >= -1e-12 for i in range(m)):
        return [P]
    idx = list(range(m))
    out = []
    guard = 0
    while len(idx) > 3 and guard < 10 * m:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            if cross(P[i0], P[i1], P[i2]) <= 1e-12:
                continue  # reflex corner, not an ear
            tri = P[[i0, i1, i2]]
            others = [j for j in idx if j not in (i0, i1, i2)]
            if any(in_poly(P[[j]], tri)[0] for j in others):
                continue
            out.append(tri)
            del idx[k]
            break
    out.append(P[idx])
    return out


def clip_convex(piece, C, h, v):
    """Sutherland-Hodgman: 3D polygon `piece` (list of points) against convex outline C (ccw).

    Returns (inside polygon or None, list of outside polygons)."""
    outs = []
    cur = list(piece)
    for i in range(len(C)):
        e0, e1 = C[i], C[(i + 1) % len(C)]
        ed = e1 - e0
        nrm = np.array([-ed[1], ed[0]]) / (np.linalg.norm(ed) + 1e-30)
        d = [(q[[h, v]] - e0) @ nrm for q in cur]
        if all(x >= 0 for x in d):
            continue
        if all(x < 0 for x in d):
            outs.append(cur)
            return None, outs
        ins, out = [], []
        for k in range(len(cur)):
            j = (k + 1) % len(cur)
            (ins if d[k] >= 0 else out).append(cur[k])
            if (d[k] >= 0) != (d[j] >= 0):
                x = cur[k] + (cur[j] - cur[k]) * (d[k] / (d[k] - d[j]))
                ins.append(x)
                out.append(x)
        if len(out) >= 3:
            outs.append(out)
        cur = ins
    return (cur if len(cur) >= 3 else None), outs


def cut_along(sel_cond, view, poly, hit):
    """Cut every candidate triangle that crosses the outline along it (in the view's plane).

    The outline is clipped exactly (convex pieces, Sutherland-Hodgman), so the part border lies on
    the outline whatever the triangle size. Returns `hit` | the inside mask, re-indexed to the new
    triangle list; T / N / AREA / CEN / part grow.
    """
    global T, N, AREA, CEN, part, n, tri_seg
    (h, _), (v, _), _ = VIEWS[view]
    P = np.array(poly, float)
    V = T[:, :, [h, v]]
    vin = np.stack([in_poly(V[:, k], P) for k in range(3)], 1)
    lo, hi = P.min(0), P.max(0)
    overlap = (V.max(1) > lo).all(1) & (V.min(1) < hi).all(1)
    cand = np.flatnonzero(sel_cond & overlap & ~vin.all(1))
    inside = hit | (sel_cond & vin.all(1))
    if not len(cand):
        return inside
    pieces = convex_pieces(P)
    new_tris, new_in, new_part, new_seg = [], [], [], []
    for ti in cand:
        outs = [list(T[ti])]
        ins_all = []
        for C in pieces:
            nxt = []
            for piece in outs:
                ins, os = clip_convex(piece, C, h, v)
                if ins is not None:
                    ins_all.append(ins)
                nxt += os
            outs = nxt
        if not ins_all:  # never touched the outline after all
            continue
        for group, flag in ((ins_all, True), (outs, False)):
            for pts in group:
                for k in range(1, len(pts) - 1):
                    new_tris.append([pts[0], pts[k], pts[k + 1]])
                    new_in.append(flag)
                    new_part.append(part[ti])  # pieces keep the label of the triangle they were cut from
                    new_seg.append(tri_seg[ti])
        inside[ti] = False
        cand_mask_drop.append(ti)
    if not new_tris:
        return inside
    keep = np.ones(n, bool)
    keep[cand_mask_drop] = False
    cand_mask_drop.clear()
    new_tris = np.array(new_tris)
    T = np.concatenate([T[keep], new_tris])
    part = np.concatenate([part[keep], np.array(new_part, int)])
    tri_seg = np.concatenate([tri_seg[keep], np.array(new_seg, int)])
    N, AREA = normals(T)
    CEN = T.mean(1)
    n = len(T)
    sel = np.concatenate([inside[keep], np.array(new_in)])
    return sel & (AREA > 1e-10)  # zero-area slivers stay body


cand_mask_drop = []
tri_seg = seg.copy()  # segment of every triangle, kept in step with the cuts (preview --by segment)

MIRROR_VIEW = {'left': 'right', 'right': 'left'}
cuts = 0
for p in PC['picks']:
    reg, box, tube = p.get('region'), p.get('box'), p.get('tube')
    if not reg and not box and not tube:
        continue
    m = MATERIALS.index(p['material'])
    mirror = p.get('mirror', True)
    hit = np.zeros(n, bool)
    if reg:
        poly = grow_poly(reg['poly'], reg.get('grow', 0))
        depth = reg.get('depth')
        tries = [(reg['view'], poly, depth)]
        if mirror:
            vw = reg['view']
            if vw in MIRROR_VIEW:  # the other side: same outline, depth (x) mirrored
                tries.append((MIRROR_VIEW[vw], poly, depth and [-depth[1], -depth[0]]))
            elif vw in ('front', 'rear'):
                tries.append((vw, poly * [-1, 1], depth))
            else:
                tries.append((vw, poly * [1, -1], depth))
        for vw, pl, dp in tries:
            (h, _), (v, _), (d, ds) = VIEWS[vw]
            cond = (N[:, d] * ds > reg.get('facing', 0.05)) & ((part == 0) | reg.get('any', False))
            if dp:
                cond &= (CEN[:, d] >= dp[0]) & (CEN[:, d] <= dp[1])
            before = n
            hit = cut_along(cond, vw, pl, hit)
            cuts += n - before
    if box:
        sel = part == 0
        for k, axn in enumerate('xyz'):
            if axn in box:
                c = np.abs(CEN[:, k]) if (axn == 'x' and mirror) else CEN[:, k]
                sel &= (c >= box[axn][0]) & (c <= box[axn][1])
        for axn, rng in box.get('facing', {}).items():
            lo_, hi_ = (rng, 1) if np.isscalar(rng) else rng
            comp = N[:, 'xyz'.index(axn.strip('|'))]
            if axn.startswith('|'):  # "|x|": either direction (both sides of a mirrored part)
                comp = np.abs(comp)
            sel &= (comp >= lo_) & (comp <= hi_)
        hit |= sel
    if tube:
        Q = CEN.copy()
        if mirror:
            Q[:, 0] = np.abs(Q[:, 0])
        path = np.array(tube['path'], float)
        d2 = np.full(n, np.inf)
        for a_, b_ in zip(path[:-1], path[1:]):
            ab = b_ - a_
            t_ = np.clip(((Q - a_) @ ab) / (ab @ ab), 0, 1)
            d2 = np.minimum(d2, (((a_ + t_[:, None] * ab) - Q) ** 2).sum(1))
        free = (part == 0) | np.isin(part, [MATERIALS.index(o) for o in tube.get('over', [])])
        hit |= (d2 <= tube['radius'] ** 2) & free
    part[hit] = m
    print(f'  {p["name"]:<22} {p["material"]:<10} (triangles) {int(hit.sum()):6d} triangles '
          f'{AREA[hit].sum() * 1e4:8.0f} cm2')
if cuts:
    print(f'  cut along outlines: {n} triangles now (+{cuts})')

# --- hub picks: per-triangle, body surfaces inside a wheel arch that face the wheel ------------
for p in PC['picks']:
    hub = p.get('hub')
    if not hub:
        continue
    hit = np.zeros(n, bool)
    for zc, yc in cfg['wheels']['centres']:
        dz, dy = CEN[:, 2] - zc, CEN[:, 1] - yc
        r = np.hypot(dz, dy) + 1e-9
        radial = (N[:, 2] * dz + N[:, 1] * dy) / r
        hit |= (r < hub['radius']) & (radial < hub['facing'])
    hit &= (np.abs(CEN[:, 0]) > hub.get('minAbsX', 0)) & (CEN[:, 1] <= hub.get('maxY', 1e9)) & (part == 0)
    for ex in hub.get('exclude', []):  # boxes the rule skips (|x| when mirrored, like `box`)
        out = np.ones(n, bool)
        for k, axn in enumerate('xyz'):
            if axn in ex:
                c = np.abs(CEN[:, k]) if axn == 'x' else CEN[:, k]
                out &= (c >= ex[axn][0]) & (c <= ex[axn][1])
        hit &= ~out
    part[hit] = MATERIALS.index(p['material'])
    print(f'  {p["name"]:<22} {p["material"]:<10} (hub)       {int(hit.sum()):6d} triangles '
          f'{AREA[hit].sum() * 1e4:8.0f} cm2')

for i, name in enumerate(MATERIALS):
    print(f'  = {name:<10} {int((part == i).sum()):6d} triangles')

# --- write: the (cut) triangles back in source space, material index in the attribute bytes --------
src_v = np.zeros_like(T)
for k, (i, sgn) in enumerate(ax):
    src_v[..., i] = (T[..., k] - off[k]) / cfg['scale'] * sgn
data = np.zeros(n, dtype=rec)
data['v'] = src_v.astype(np.float32)
data['n'] = N.astype(np.float32)
data['a'] = part
with open(dst, 'wb') as f:
    f.write(b'parts: STL attribute = material index (segment-stl.py)'.ljust(80, b' '))
    f.write(np.uint32(n).tobytes())
    f.write(data.tobytes())
print('wrote', dst)

# --- preview ------------------------------------------------------------------------------------
if '--preview' in opts:
    if opts.get('--by', 'part') == 'segment':
        pal = np.random.default_rng(3).integers(60, 255, (nseg, 3)).astype(float)
        col = pal[tri_seg]
    else:
        prev = PC.get('preview', {})
        pal = np.array([hex_rgb(prev.get(m, '#c8ccd0')) for m in MATERIALS], float)
        col = pal[part]
    crop = [float(c) for c in opts['--crop'].split(',')] if '--crop' in opts else None
    for view in opts.get('--views', 'front,rear,left,top').split(','):
        out = f'{opts["--preview"]}-{view}.png'
        print('wrote', out, render(T, N, col, view, out, crop, int(opts.get('--scale', 400)),
                                   float(opts.get('--grid', 0.1))))
