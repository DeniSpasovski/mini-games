"""Assemble a car printed as a model KIT (parts laid out on a sprue frame) into one oriented body STL.

    python scripts/car-model/assemble-kit.py <model.source.json> <out.stl> [--preview <prefix>] [--list]

Kit STLs (e.g. the 1:64 Rolf Bertz kits) hold every part as its own closed shell on the print bed:
body, chassis plate, wheels, wing, lamps, louvres... Some parts are already in their assembled place
(details glued into the body), others lie flat next to it. The `kit` block of model.source.json says
which shells to take and how to move them:

    kit.source   the kit STL (bed coordinates, usually mm, z = up from the bed)
    kit.origin   bed point that becomes the car origin: [x centre, bed z of the ground line, y between the axles]
    kit.groups   [{ name, box: {x, y, z?: [min, max]}, minZ?, translate?: [dx, dy, dz],
                    rotate?: { axis: 'x'|'y'|'z', deg, pivot: [x, y, z] } }]  - first group wins
        box        a shell belongs to the group when its bounding box lies completely inside (bed coords)
        minZ       drop shells that start below this bed height (sprue gates, parts printed flat under the
                   body) - except the group's largest shell (the body / chassis itself)
        drop       [{ x?, y?, z?: [min, max] }] - leave out the group's shells lying completely in a box (bed coords)
        rotate     applied first (about `pivot`), then `translate`; a list = several rotations in order
        cull       [{ x?, y?, z?: [min, max], facing?: { x|y|z: [min, max] } }] - delete this group's
                   triangles whose centre lies in the box and whose normal is in range, in the OUTPUT
                   frame (car axes, kit units): a body floor coplanar with the chassis floor z-fights
    kit.patches  [{ name, columns: [[bottom xyz, top xyz], ...], facing: [x, y, z], mirror? }] - extra panels
                 in the OUTPUT frame (a strip between consecutive columns), e.g. a grill flush across a vent
    kit.visible  true: drop shells no outside view can see (seats, roll cage, tank under a closed glasshouse)

Output frame (same as orient-tilted-stl.py): x = car left, y = up, z = nose, kit units; the bed's -y is
the nose, its +x the car's left. Feed the result to segment-stl.py / stl-to-glb.mjs (`scale` = metres
per kit unit, e.g. 0.064 for a 1:64 kit in mm). `--list` prints every shell with its bed bounding box
(find group boxes with it); `--preview` renders the assembled car (left / front / rear / top / bottom),
one colour per shell.
"""
import json
import os
import sys

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshview import normals, render  # noqa: E402

DT = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])


def load(path):
    b = open(path, 'rb').read()
    n = int(np.frombuffer(b[80:84], '<u4')[0])
    return np.frombuffer(b[84:84 + n * 50], dtype=DT)['v'].astype(np.float64)


def shells(T):
    """Label of the connected shell (welded at 1e-4 units) of every triangle."""
    q = np.round(T.reshape(-1, 3) * 1e4).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    nv = F.max() + 1
    a = np.concatenate([F[:, 0], F[:, 1]])
    b = np.concatenate([F[:, 1], F[:, 2]])
    _, lab = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(nv, nv)), directed=False)
    return np.unique(lab[F[:, 0]], return_inverse=True)[1].reshape(-1)


def rot(axis, deg):
    c, s = np.cos(np.radians(deg)), np.sin(np.radians(deg))
    i = 'xyz'.index(axis)
    j, k = [m for m in range(3) if m != i]
    R = np.eye(3)
    R[j, j], R[j, k], R[k, j], R[k, k] = c, -s, s, c
    return R


def visible_shells(T, lab, n_shells, px=0.08):
    """Visible sample points per shell: the surface is sampled densely (spacing ~px / 2) and z-buffered
    in orthographic views from 26 directions (axes, edge and corner diagonals)."""
    rng = np.random.default_rng(1)
    area = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
    k = np.ceil(area / (px * px / 4)).astype(int)
    tri = np.repeat(np.arange(len(T)), k)
    r1, r2 = rng.random(len(tri)), rng.random(len(tri))
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    S = T[tri, 0] + r1[:, None] * (T[tri, 1] - T[tri, 0]) + r2[:, None] * (T[tri, 2] - T[tri, 0])
    S = np.concatenate([S, T.mean(1)])
    sl = np.concatenate([lab[tri], lab])
    seen = np.zeros(n_shells, np.int64)
    dirs = [d for d in np.array(np.meshgrid([-1, 0, 1], [-1, 0, 1], [-1, 0, 1])).T.reshape(-1, 3) if np.any(d)]
    for f in dirs:
        f = f / np.linalg.norm(f)
        u = np.cross(f, [0, 1, 0] if abs(f[1]) < 0.9 else [1, 0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(f, u)
        a = ((S @ u) / px).astype(np.int64)
        b = ((S @ v) / px).astype(np.int64)
        d = S @ f
        cell = (a - a.min()) * (b.max() - b.min() + 1) + (b - b.min())
        front = np.full(cell.max() + 1, -np.inf)
        np.maximum.at(front, cell, d)
        hit = d >= front[cell] - px
        seen += np.bincount(sl[hit], minlength=n_shells)
    return seen


def main():
    cfg_path, dst = sys.argv[1:3]
    opts = sys.argv[3:]
    kit = json.load(open(cfg_path))['kit']
    T = load(kit['source'])
    lab = shells(T)
    ns = lab.max() + 1
    lo = np.full((ns, 3), np.inf)
    hi = np.full((ns, 3), -np.inf)
    np.minimum.at(lo, lab, T.min(1))
    np.maximum.at(hi, lab, T.max(1))
    size = np.bincount(lab, minlength=ns)
    print(f'{len(T)} triangles, {ns} shells')
    if '--list' in opts:
        for s in np.argsort(-size):
            print(f'{s:5d} {size[s]:7d}  x {lo[s, 0]:6.1f} {hi[s, 0]:6.1f}  y {lo[s, 1]:6.1f} {hi[s, 1]:6.1f}'
                  f'  z {lo[s, 2]:5.1f} {hi[s, 2]:5.1f}')

    group = np.full(ns, -1)
    for g, G in enumerate(kit['groups']):
        inside = group < 0
        for k, ax in enumerate('xyz'):
            if ax in G['box']:
                inside &= (lo[:, k] >= G['box'][ax][0]) & (hi[:, k] <= G['box'][ax][1])
        for db in G.get('drop', []):  # shells left out on purpose (stray / unwanted kit parts)
            out = np.ones(ns, bool)
            for k, ax in enumerate('xyz'):
                if ax in db:
                    out &= (lo[:, k] >= db[ax][0]) & (hi[:, k] <= db[ax][1])
            inside &= ~out
        if 'minZ' in G and inside.any():
            main_shell = np.flatnonzero(inside)[np.argmax(size[inside])]
            low = inside & (lo[:, 2] < G['minZ'])
            low[main_shell] = False
            inside &= ~low
        group[inside] = g
        print(f"group {G['name']}: {inside.sum()} shells, {size[inside].sum()} triangles")

    keep = group[lab] >= 0
    T, lab, tg = T[keep], lab[keep], group[lab[keep]]
    for g, G in enumerate(kit['groups']):
        m = tg == g
        rots = G.get('rotate', [])
        for r in [rots] if isinstance(rots, dict) else rots:
            p = np.array(r['pivot'], float)
            T[m] = (T[m] - p) @ rot(r['axis'], r['deg']).T + p
        if 'translate' in G:
            T[m] += np.array(G['translate'], float)
    ox, oz, oy = kit['origin']
    C = np.stack([T[..., 0] - ox, T[..., 2] - oz, -(T[..., 1] - oy)], -1)

    # cull: drop triangles of a group by centre box + facing (car frame), e.g. a body floor that lies
    # in the same plane as the chassis floor (they would z-fight)
    drop = np.zeros(len(C), bool)
    Nc, _ = normals(C)
    cen = C.mean(1)
    for g, G in enumerate(kit['groups']):
        for cb in G.get('cull', []):
            m = tg == g
            for k, ax in enumerate('xyz'):
                if ax in cb:
                    m &= (cen[:, k] >= cb[ax][0]) & (cen[:, k] <= cb[ax][1])
            for ax, rng in cb.get('facing', {}).items():
                m &= (Nc[:, 'xyz'.index(ax)] >= rng[0]) & (Nc[:, 'xyz'.index(ax)] <= rng[1])
            drop |= m
            print(f"cull {G['name']}: {m.sum()} triangles")
    C, lab = C[~drop], lab[~drop]

    if kit.get('visible'):
        seen = visible_shells(C, lab, ns)
        vis = seen[lab] >= 20
        hidden = np.unique(lab[~vis])
        print(f'visibility: dropped {len(hidden)} hidden shells, {(~vis).sum()} triangles')
        if '--list' in opts:
            for s in np.unique(lab):
                print(f'  shell {s:4d} {size[s]:7d} tris  group {group[s]}  visible samples {seen[s]}')
        C, lab = C[vis], lab[vis]

    # patches: new flat panels the kit does not have, e.g. a grill flush across a vent opening. A patch is a
    # strip of columns [[bottom xyz, top xyz], ...] in the OUTPUT frame; triangles face `facing`.
    extra = []
    for P in kit.get('patches', []):
        cols = np.array(P['columns'], float)
        sides = [cols] + ([cols * [-1, 1, 1]] if P.get('mirror') else [])
        for cl in sides:
            for a, b in zip(cl[:-1], cl[1:]):
                for tri in ((a[0], b[0], b[1]), (a[0], b[1], a[1])):
                    t = np.array(tri)
                    if np.cross(t[1] - t[0], t[2] - t[0]) @ np.array(P['facing'], float) < 0:
                        t = t[[0, 2, 1]]
                    extra.append(t)
        print(f"patch {P['name']}: {2 * (len(cols) - 1) * len(sides)} triangles")
    if extra:
        C = np.concatenate([C, np.array(extra)])

    d = np.zeros(len(C), DT)
    d['v'] = C
    N, _ = normals(C)
    d['n'] = N
    with open(dst, 'wb') as f:
        f.write(b'assembled kit: x=left, y=up, z=nose'.ljust(80, b' '))
        f.write(np.uint32(len(C)).tobytes())
        f.write(d.tobytes())
    print('wrote', dst, len(C), 'triangles, extent', np.round(C.reshape(-1, 3).min(0), 2), np.round(C.reshape(-1, 3).max(0), 2))

    if '--preview' in opts:
        prefix = opts[opts.index('--preview') + 1]
        rng = np.random.default_rng(5)
        pal = rng.integers(80, 255, (ns, 3)).astype(float)
        for view in ('left', 'front', 'rear', 'top', 'bottom'):
            render(C, N, pal[lab], view, f'{prefix}-{view}.png', scale=14, grid=5)
        print('preview', prefix + '-*.png')


main()
