"""Split a multi-vehicle pack GLB into one vehicle per cluster, with a colour per vertex sampled from its base colour.

    python scripts/car-model/street-pack-extract.py <pack.glb> <out.json> [--margin 0.15] [--skip <node-name part>] [--seeds <body suffix>]

Primitives whose world bounding boxes touch (within --margin m) form one vehicle. Output: a list of
{name, bbox, mesh: [{node, pos, idx, col, tcol, uv, img}]} (world space, Y up, colours 0-255; `uv` per vertex and `img`
= index of the base colour image, -1 without one). `--images <prefix>` also writes every image as <prefix>_<i>.png.
Feeds bake-street-cars.mjs and bake-trucks.mjs.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltfio import accessor, load_glb, node_matrix  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
skip = sys.argv[sys.argv.index('--skip') + 1] if '--skip' in sys.argv else None
margin = float(sys.argv[sys.argv.index('--margin') + 1]) if '--margin' in sys.argv else 0.15
g, binary = load_glb(src)

images = []
for im in g.get('images', []):
    bv = g['bufferViews'][im['bufferView']]
    raw = binary[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    images.append(np.asarray(Image.open(io.BytesIO(raw)).convert('RGBA')))


if '--images' in sys.argv:
    prefix = sys.argv[sys.argv.index('--images') + 1]
    for i, arr in enumerate(images):
        Image.fromarray(arr[..., :3]).save(f'{prefix}_{i}.png')


def base_colour(mi):
    """(factor, texture ref) of a material's base colour: metallic-roughness, or the diffuse of KHR_materials_pbrSpecularGlossiness."""
    m = g['materials'][mi]
    sg = m.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness')
    if sg is not None:
        return sg.get('diffuseFactor', [1, 1, 1, 1]), sg.get('diffuseTexture')
    pbr = m.get('pbrMetallicRoughness', {})
    return pbr.get('baseColorFactor', [1, 1, 1, 1]), pbr.get('baseColorTexture')


def image_of(mi):
    tex = base_colour(mi)[1]
    return -1 if tex is None else g['textures'][tex['index']]['source']


def material_sampler(mi):
    factor, tex = base_colour(mi)
    factor = np.array(factor[:3])
    if tex is None:
        return lambda uv, n: np.tile(factor, (n, 1)) * 255
    img = images[g['textures'][tex['index']]['source']]
    scale = tex.get('extensions', {}).get('KHR_texture_transform', {}).get('scale', [1, 1])
    h, w = img.shape[:2]

    def sample(uv, n):
        u = (uv[:, 0] * scale[0]) % 1.0
        v = (uv[:, 1] * scale[1]) % 1.0
        px = img[np.clip((v * h).astype(int), 0, h - 1), np.clip((u * w).astype(int), 0, w - 1), :3]
        return px * factor
    return sample


def srgb_keep(c):
    return np.clip(c, 0, 255).astype(np.uint8)


prims = []


def walk(i, M):
    n = g['nodes'][i]
    M = M @ node_matrix(n)
    if 'mesh' in n:
        for p in g['meshes'][n['mesh']]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            if skip and skip in n.get('name', ''):
                continue
            P = accessor(g, binary, p['attributes']['POSITION'])
            P = (M[:3, :3] @ P.T).T + M[:3, 3]
            idx = accessor(g, binary, p['indices']).astype(np.int64).ravel()
            uv = accessor(g, binary, p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else np.zeros((len(P), 2))
            col = material_sampler(p['material'])(uv, len(P)) if 'material' in p else np.full((len(P), 3), 128.0)
            mat = g['materials'][p['material']].get('name', '') if 'material' in p else ''
            # One colour per triangle, sampled at the middle of its UVs (flat panels have colours only at their corners).
            tuv = uv[idx.reshape(-1, 3)].mean(axis=1)
            tcol = material_sampler(p['material'])(tuv, len(tuv)) if 'material' in p else np.full((len(tuv), 3), 128.0)
            prims.append(dict(node=n.get('name', f'node{i}'), mat=mat, pos=P, idx=idx, col=srgb_keep(col), tcol=srgb_keep(tcol),
                              uv=uv, img=image_of(p['material']) if 'material' in p else -1))
    for c in n.get('children', []):
        walk(c, M)


for s in g['scenes'][g.get('scene', 0)]['nodes']:
    walk(s, np.eye(4))

if '--seeds' in sys.argv:
    # Packs whose bodies overlap: seed = prims named "<vehicle>_Body_0"; "<vehicle>_*" prims follow it; every other prim
    # (optics, glass, wheels) goes to the nearest seed that still has fewer than 6 of them (optics, glass, 4 wheels).
    tail = sys.argv[sys.argv.index('--seeds') + 1]
    seeds = {p['node'][:-len(tail)]: [p] for p in prims if p['node'].endswith(tail) and not p['node'].startswith('Wheel')}
    rest = []
    for p in prims:
        if p['node'].endswith(tail) and not p['node'].startswith('Wheel'):
            continue
        base = p['node'].rsplit('_', 2)[0] if p['node'].count('_') >= 2 else None
        if base in seeds:
            seeds[base].append(p)
        else:
            rest.append(p)
    ctr = {k: np.mean([v[0]['pos'].min(0), v[0]['pos'].max(0)], 0) for k, v in seeds.items()}
    pairs = sorted((np.linalg.norm((np.mean([p['pos'].min(0), p['pos'].max(0)], 0) - ctr[k])[[0, 2]]), id(p), k)
                   for p in rest for k in seeds)
    taken, count = set(), {k: 0 for k in seeds}
    byid = {id(p): p for p in rest}
    for dist, pid, k in pairs:
        wheel = byid[pid]
        if pid in taken:
            continue
        if count[k] >= 6 and not wheel['node'].endswith('Body_0'):
            continue
        taken.add(pid)
        if not wheel['node'].endswith('Body_0'):
            count[k] += 1
        seeds[k].append(wheel)
    ordered = list(seeds.values())
    prims[:] = [p for grp in ordered for p in grp]
    n = 0
    parent = list(range(len(prims)))
    for grp in ordered:
        first = n
        for _ in grp:
            parent[n] = first
            n += 1
    bb = [(p['pos'].min(0), p['pos'].max(0)) for p in prims]
else:
    bb = [(p['pos'].min(0) - margin, p['pos'].max(0) + margin) for p in prims]
    parent = list(range(len(prims)))
# Union-find on touching bounding boxes.
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for a in range(0 if '--seeds' in sys.argv else len(prims)):
    for b in range(a + 1, len(prims)):
        if np.all(bb[a][0] <= bb[b][1]) and np.all(bb[b][0] <= bb[a][1]):
            parent[find(a)] = find(b)

groups = {}
for i in range(len(prims)):
    groups.setdefault(find(i), []).append(i)

vehicles = []
for ids in groups.values():
    lo = np.min([prims[i]['pos'].min(0) for i in ids], 0)
    hi = np.max([prims[i]['pos'].max(0) for i in ids], 0)
    vehicles.append(dict(
        name=prims[ids[0]]['node'],
        bbox=[lo.round(3).tolist(), hi.round(3).tolist()],
        tris=int(sum(len(prims[i]['idx']) for i in ids) // 3),
        mesh=[dict(node=prims[i]['node'], mat=prims[i]['mat'], pos=prims[i]['pos'].round(4).tolist(),
                   idx=prims[i]['idx'].tolist(), col=prims[i]['col'].tolist(),
                   tcol=prims[i]['tcol'].tolist(), uv=prims[i]['uv'].round(5).tolist(),
                   img=prims[i]['img']) for i in ids]))
vehicles.sort(key=lambda v: (round(v['bbox'][0][2] / 4), v['bbox'][0][0]))
json.dump(vehicles, open(out, 'w'))
for k, v in enumerate(vehicles):
    size = np.array(v['bbox'][1]) - np.array(v['bbox'][0])
    print(k, v['name'], v['tris'], 'tris', size.round(2).tolist(), len(v['mesh']), 'prims')
