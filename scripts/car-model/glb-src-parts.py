"""Append source primitives that keep their own UVs + texture (lamp art) to a converted car GLB.

    python scripts/car-model/glb-src-parts.py <car>/model.source.json <source.glb>

Run after stl-to-glb.mjs (it rewrites `output`). The STL route has no UVs, so parts whose look IS their texture - a lamp
whose reflectors, bulbs and lens pattern are painted into the model's lamp sheet - would come out as one flat colour. This
copies those primitives from the source GLB as they are (node transforms + the config's `scale` / `offset`, source
normals and TEXCOORD_0) and writes the source images they use next to the GLB. Config block:

    "srcParts": {
      "textures": [{"material": "lights", "out": "public/models/cars/<car>_lamps.png"}],  # source materials whose base colour images ship
      "parts": [                                                                      # in draw order: what sits behind first
        {"node": "<primitive name>", "material": "src:lamp:<car>_lamps.png"},
        {"node": "<primitive name>", "z": [-3, 0], "material": "src:tail:<car>_lamps.png"}   # optional x / y / z box on triangle centres
      ],
      "shells": [{"nodes": [...], "x": [..], "y": [..], "z": [..], "mirror": true, "material": "src:shell"}]  # optional
    }

`shells`: a closed back for open source shells (a seat that is one sheet seen from the front): the rear-facing faces of the
convex hull of those nodes' vertices in the box (`mirror` = also the box mirrored in x), drawn as dark plastic (`src:shell`).

Each `material` becomes one primitive; the game builds it from the name (cars/shared/part-materials.ts `srcPart`: `lamp` = the
sheet with a glow from its bright pixels, `tail` = brake lamp, red pixels glow, `int` = plain matt sheet: seats, cockpit). List the same primitives in `gltf.drop` so the
STL route does not take them too. The GLB keeps one buffer and no images (meshopt compression and side-profile.mjs read it).
"""
import importlib.util
import json
import os
import struct
import sys

import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('g2s', os.path.join(here, 'glb-to-parts-stl.py'))
g2s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g2s)

cfg_path, src_path = sys.argv[1], sys.argv[2]
cfg = json.load(open(cfg_path, encoding='utf-8'))
sp = cfg['srcParts']
if cfg.get('axes', ['x', 'y', 'z']) != ['x', 'y', 'z']:
    raise SystemExit('glb-src-parts.py: only axes ["x", "y", "z"] are supported')
scale = float(cfg.get('scale', 1))
offset = np.array(cfg.get('offset', [0, 0, 0]), float)

g, bins = g2s.load_glb(src_path)

# --- every source primitive by name: positions, normals, UVs, indices in world space ---------------------------------
prims = {}


def walk(i, M):
    n = g['nodes'][i]
    M = M @ g2s.node_matrix(n)
    if 'mesh' in n:
        for p in g['meshes'][n['mesh']]['primitives']:
            a = p['attributes']
            P = g2s.accessor(g, bins, a['POSITION'])
            P = (M[:3, :3] @ P.T).T + M[:3, 3]
            N = g2s.accessor(g, bins, a['NORMAL']) @ np.linalg.inv(M[:3, :3])  # inverse transpose
            N /= np.linalg.norm(N, axis=1)[:, None] + 1e-20
            UV = g2s.accessor(g, bins, a['TEXCOORD_0'])
            I = g2s.accessor(g, bins, p['indices']).astype(np.int64).ravel() if 'indices' in p else np.arange(len(P))
            prims[n.get('name', f'node{i}')] = (P * scale + offset, N, UV, I.reshape(-1, 3), p.get('material'))
    for c in n.get('children', []):
        walk(c, M)


for s in g['scenes'][g.get('scene', 0)]['nodes']:
    walk(s, np.eye(4))

# --- group by material ------------------------------------------------------------------------------------------------
groups = {}
for r in sp['parts']:
    if r['node'] not in prims:
        raise SystemExit(f'no primitive named {r["node"]}')
    P, N, UV, T, _ = prims[r['node']]
    c = P[T].mean(1)
    keep = np.ones(len(T), bool)
    for ax, k in (('x', 0), ('y', 1), ('z', 2)):
        if ax in r:
            keep &= (c[:, k] >= r[ax][0]) & (c[:, k] <= r[ax][1])
    T = T[keep]
    used = np.unique(T)
    remap = np.full(len(P), -1)
    remap[used] = np.arange(len(used))
    groups.setdefault(r['material'], []).append((P[used], N[used], UV[used], remap[T]))

# --- closed backs: rear-facing faces of a convex hull round open shells (a source seat is one sheet seen from the front) ---
for sh in sp.get('shells', []):
    from scipy.spatial import ConvexHull

    for side in (1, -1) if sh.get('mirror') else (1,):
        V = []
        for nm in sh['nodes']:
            P, _, _, T, _ = prims[nm]
            q = P[np.unique(T)]
            m = np.ones(len(q), bool)
            for ax, k in (('x', 0), ('y', 1), ('z', 2)):
                if ax in sh:
                    lo, hi = sh[ax]
                    if k == 0 and side < 0:
                        lo, hi = -hi, -lo
                    m &= (q[:, k] >= lo) & (q[:, k] <= hi)
            V.append(q[m])
        V = np.concatenate(V)
        hull = ConvexHull(V)
        F = []
        for f, eq in zip(hull.simplices, hull.equations):
            if eq[2] < -sh.get('minBack', 0.3):  # outward normal towards the rear
                a, b, c = V[f]
                F.append(f if np.dot(np.cross(b - a, c - a), eq[:3]) > 0 else f[[0, 2, 1]])
        F = np.array(F)
        used = np.unique(F)
        remap = np.full(len(V), -1)
        remap[used] = np.arange(len(used))
        Pv = V[used]
        # vertex normals: area-weighted face normals; pulled 3 mm in so the shell sits just under the source's own back
        Nv = np.zeros_like(Pv)
        for f in remap[F]:
            Nv[f] += np.cross(Pv[f[1]] - Pv[f[0]], Pv[f[2]] - Pv[f[0]])
        Nv /= np.linalg.norm(Nv, axis=1)[:, None] + 1e-20
        groups.setdefault(sh['material'], []).append((Pv - Nv * 0.003, Nv, np.zeros((len(Pv), 2)), remap[F]))

# --- append to the converted GLB ---------------------------------------------------------------------------------------
out = cfg['output']
d = open(out, 'rb').read()
jl = struct.unpack_from('<I', d, 12)[0]
j = json.loads(d[20:20 + jl])
bin0 = bytearray(d[20 + jl + 8:20 + jl + 8 + struct.unpack_from('<I', d, 20 + jl)[0]])
mesh = j['meshes'][j['nodes'][0]['mesh']]
# re-running replaces the earlier copy
keepPrims = [p for p in mesh['primitives'] if not j['materials'][p['material']]['name'].startswith('src:')]
if len(keepPrims) != len(mesh['primitives']):
    raise SystemExit(f'{out} already has src: parts - re-run stl-to-glb.mjs first')


def add_view(arr, target):
    while len(bin0) % 4:
        bin0.append(0)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin0), 'byteLength': arr.nbytes, 'target': target})
    bin0.extend(arr.tobytes())
    return len(j['bufferViews']) - 1


def add_acc(arr, typ, ctype, target, minmax=False):
    a = {'bufferView': add_view(arr, target), 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax:
        a['min'] = arr.min(0).tolist()
        a['max'] = arr.max(0).tolist()
    j['accessors'].append(a)
    return len(j['accessors']) - 1


for name, parts in groups.items():
    P, N, UV, T, base = [], [], [], [], 0
    for p, n, uv, t in parts:
        P.append(p), N.append(n), UV.append(uv), T.append(t + base)
        base += len(p)
    P = np.concatenate(P).astype(np.float32)
    N = np.concatenate(N).astype(np.float32)
    UV = np.concatenate(UV).astype(np.float32)
    T = np.concatenate(T).astype(np.uint32).ravel()
    j['materials'].append({'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'roughnessFactor': 0.5}})
    mesh['primitives'].append({
        'attributes': {
            'POSITION': add_acc(P, 'VEC3', 5126, 34962, True),
            'NORMAL': add_acc(N, 'VEC3', 5126, 34962),
            'TEXCOORD_0': add_acc(UV, 'VEC2', 5126, 34962),
        },
        'indices': add_acc(T, 'SCALAR', 5125, 34963),
        'material': len(j['materials']) - 1,
    })
    print(f'{name}: {len(T) // 3} triangles')

while len(bin0) % 4:
    bin0.append(0)
j['buffers'][0]['byteLength'] = len(bin0)
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin0)) + struct.pack('<I4s', len(js), b'JSON') + js
glb += struct.pack('<I4s', len(bin0), b'BIN\0') + bytes(bin0)
open(out, 'wb').write(glb)
print(f'wrote {out} ({len(glb) / 1e6:.2f} MB)')

# --- the textures ----------------------------------------------------------------------------------------------------
for tx in sp['textures']:
    mat = next(m for m in g['materials'] if m.get('name') == tx['material'])
    img = g['images'][g['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
    bv = g['bufferViews'][img['bufferView']]
    png = bins[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    if img.get('mimeType') != 'image/png':
        raise SystemExit(f'texture is {img.get("mimeType")}, expected image/png')
    open(tx['out'], 'wb').write(png)
    print(f'wrote {tx["out"]} ({len(png) / 1e3:.0f} kB)')
