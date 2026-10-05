#!/usr/bin/env python3
"""Is this car model worth importing? Scan a body mesh BEFORE building a car on it.

    python scripts/car-model/scan-mesh.py <model.stl | model.glb> [--length 4.3]

Prints the mesh statistics that decide how parts (glass, lamps, grille, wing...) can be split off:

  * already split  - a glTF/GLB with several primitives / materials / named nodes: parts come
                     for free (map material names in cars/shared/part-materials.ts)
  * crease panels  - an STL / single-mesh model whose features are real surfaces meeting at hard
                     edges (CAD / print models like the Fabia): crease segmentation splits it into
                     panels and `seeds` picks grab each part exactly -> IMPORT
  * blob           - a photo / image-to-3D mesh (the GR Yaris): one smooth skin, features are
                     shallow rounded grooves, no edges to follow. Every part border has to be
                     hand-drawn and cut; the result never gets crisp -> ABANDON, find a CAD model

The mesh is scaled so its longest extent is `--length` metres (a car body), so the area
thresholds below are in real centimetres whatever the file's units.
"""
import json
import struct
import sys

import numpy as np

LENGTH = 4.3
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if '--length' in sys.argv:
    LENGTH = float(sys.argv[sys.argv.index('--length') + 1])
if not args:
    print(__doc__)
    sys.exit(1)
path = args[0]


def read_stl(p):
    raw = open(p, 'rb').read()
    n = int(np.frombuffer(raw[80:84], '<u4')[0])
    rec = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    d = np.frombuffer(raw[84:84 + n * 50], dtype=rec)
    return [('stl', d['v'].astype(float))], int(np.unique(d['a']).size)


def read_glb(p):
    glb = open(p, 'rb').read()
    jlen = struct.unpack('<I', glb[12:16])[0]
    gj = json.loads(glb[20:20 + jlen])
    bin0 = 20 + jlen + 8

    def acc(i):
        a = gj['accessors'][i]
        v = gj['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dt = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: '<u1'}[a['componentType']]
        return np.frombuffer(glb, dt, a['count'] * n, bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, n)

    out = []
    for mi, mesh in enumerate(gj.get('meshes', [])):
        for prim in mesh['primitives']:
            pos = acc(prim['attributes']['POSITION']).astype(float)
            idx = acc(prim['indices']).astype(int).reshape(-1, 3) if 'indices' in prim else np.arange(len(pos)).reshape(-1, 3)
            mat = gj['materials'][prim['material']].get('name', f'material {prim["material"]}') if 'material' in prim else 'none'
            out.append((f'{mesh.get("name", f"mesh {mi}")} / {mat}', pos[idx]))
    names = [n.get('name', '') for n in gj.get('nodes', [])]
    return out, names


def normals(T):
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    L = np.linalg.norm(N, axis=1)
    return N / (L[:, None] + 1e-20), L / 2


def crease_panels(T, deg=25):
    """Union-find over edges flatter than `deg`: number of panels > 100 cm2 and the largest one's share."""
    n = len(T)
    N, A = normals(T)
    _, F = np.unique(np.round(T.reshape(-1, 3) / 2e-5).astype(np.int64), axis=0, return_inverse=True)
    F = F.reshape(-1, 3)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(n), 3)
    es = np.sort(e, axis=1)
    key = es[:, 0].astype(np.int64) * (F.max() + 1) + es[:, 1]
    o = np.argsort(key, kind='stable')
    same = key[o][1:] == key[o][:-1]
    f1, f2 = fid[o][:-1][same], fid[o][1:][same]
    cosang = (N[f1] * N[f2]).sum(1)
    hard = (cosang < np.cos(np.radians(60))).mean() * 100
    parent = np.arange(n)

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    for a, b in zip(f1[cosang > np.cos(np.radians(deg))], f2[cosang > np.cos(np.radians(deg))]):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    _, seg = np.unique([find(i) for i in range(n)], return_inverse=True)
    area = np.bincount(seg, weights=A)
    return int((area > 0.01).sum()), float(area.max() / A.sum()), hard, A


if path.lower().endswith('.stl'):
    prims, labels = read_stl(path)
    names = []
    print(f'{path}: binary STL, {len(prims[0][1])} triangles, {labels} attribute value(s)')
else:
    prims, names = read_glb(path)
    print(f'{path}: glTF, {len(prims)} primitive(s), nodes: {", ".join(n for n in names if n)[:200]}')

T = np.concatenate([p[1] for p in prims])
ext = T.reshape(-1, 3).max(0) - T.reshape(-1, 3).min(0)
T = T * (LENGTH / ext.max())
print(f'  scaled to {LENGTH} m long: {len(T)} triangles, extents {np.round(ext / ext.max() * LENGTH, 2)} m')

if len(prims) >= 4 or len({n.lower() for n in names if n}) >= 6:
    print('  VERDICT: already split into parts - import as glTF, map the material / node names to part materials.')
    for name, tri in prims[:40]:
        print(f'    {name:<40} {len(tri):7d} triangles')
    if len(prims) > 40:
        print(f'    ... {len(prims) - 40} more')
    sys.exit(0)

panels, largest, hard, A = crease_panels(T)
L = np.linalg.norm(np.stack([T[:, 1] - T[:, 0], T[:, 2] - T[:, 1], T[:, 0] - T[:, 2]], 1), axis=2)
print(f'  edge length: median {np.median(L) * 100:.2f} cm, p99 {np.percentile(L, 99) * 100:.1f} cm (adaptive CAD meshes have a long tail)')
print(f'  hard edges (> 60 deg): {hard:.2f}% of edges   (CAD ~ 5-10%, image-to-3D < 1%)')
print(f'  crease panels @ 25 deg > 100 cm2: {panels}, largest panel = {largest * 100:.1f}% of the surface')
if panels >= 30 and largest < 0.6 and hard > 2:
    print('  VERDICT: real panel edges - crease segmentation will split glass / lamps / grille / wing. IMPORT (Fabia workflow).')
elif largest > 0.9 or hard < 1:
    print('  VERDICT: one smooth blob, no feature edges (photo / image-to-3D mesh). Parts would have to be hand-cut and never get')
    print('           crisp - ABANDON this model and look for a CAD / print model with real panels.')
else:
    print('  VERDICT: marginal - some panels are real edges, others are soft. Expect hand-drawn outlines for the soft ones;')
    print('           prefer a cleaner model if one exists.')
