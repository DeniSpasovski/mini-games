"""
Bake trees and shrubs of seven CC BY 4.0 Sketchfab packs by LOLIPOP and two by Jagobo (credits: THIRD-PARTY.md) into the
rally's pack trees (`assets/builders/tree-packs.ts`): the models' own triangles, normals and uvs, three levels of detail
each (the packs' own, else reduced here: `reduce`), their own textures (shrunk) and a far billboard. The packs are not in the repository (git-ignored sources/).

  python scripts/trees/bake-tree-packs.py sources/rally/trees-v3.5 [--preview <dir>]

Writes, under src/games/rally/assets/builders/:
  tree-packs.data.ts            kinds, sizes, texture urls, season tints; the meshes of the EAGER kinds (pine, lilac, bush)
  tree-packs/<kind>.data.ts     the meshes of the other kinds (their own chunks, `loadTreePacks`)
  tree-packs/<kind>-{bark,bark-n,leaf,leaf-n}.webp, <kind>-leaf-<season>.webp, <kind>-board.webp

Every variant stands on the origin (trunk foot, y up, metres). The pack lays the levels side by side: each is moved onto
level 0 by its bark's box. `board` is the level past the meshes: the pack's own billboard (crossed cards) where it has
one, else cards rendered here from the model (`render`); every variant's board texture goes in one atlas per kind.
`--preview` renders each variant's levels and board side by side (checking the picks and the level shifts).

Packed mesh (little endian), per part and level: u32 vertices, f32 lo[3], f32 size[3], f32 uvLo[2], f32 uvSize[2], then
per vertex u16 x3 position (quantised in the box), i8 x3 normal, i8 pad, u16 x2 uv (quantised in the uv box; glTF: origin
top left, the bark tiles), then u32 index count, u16 indices.
"""
import base64
import io
import os
import re
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'car-model'))
from gltfio import accessor, load_glb, node_matrix  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'games', 'rally', 'assets', 'builders')
OUT = os.path.join(ROOT, 'tree-packs.data.ts')
TEX = os.path.join(ROOT, 'tree-packs')

# Per kind: the pack file, bark / leaf material, variants (node name stems), and
#   eager   the meshes live in the main data module (else a chunk of their own)
#   flare   bury wide root flares (the pines'); trunk = the trunk's middle band (m above the foot) its axis is taken from
#   board   'pack' (its own billboard) / 'bake' (rendered here) / None (the last mesh level is the last level)
#   cell    px of one variant's billboard in the kind's atlas (w, h)
#   sizes   px across: bark colour / normal, leaf colour / normal
#   seasons leaf colour of other seasons: a material of the pack (same atlas), 'autumn' (recoloured here, `AUTUMN`) or
#           'blossom' (the lilac's own purple panicles; the summer leaf has them spent)
#   lod     node name of a level (default `<stem>_LOD<n>_...`)
PACKS = {
    'pine': dict(
        glb='pine_trees_pack_lowpoly_game_ready_lods.glb', bark='Bark_Mat', leaf='Clusters_Mat',
        stems=['Pine_medium_1', 'Pine_big_2', 'Pine_large_2'], eager=True, flare=True, trunk=(1.5, 3),
        board='pack', cell=(256, 512), sizes=(512, 512, 1024, 512)),
    'lilac': dict(
        glb='lilac_bush_pack_12_vars_lods_game_ready.glb', bark='Bark_mat', leaf='Brunches_mat',
        stems=['Lilac_bush_3', 'Lilac_small_bush_3', 'Lilac_single_tree_2'], eager=True, sizes=(512, 512, 1024, 512),
        seasons={'spring': 'blossom', 'autumn': 'autumn'}),
    'bush': dict(
        glb='bush_models_pack_gameready_lods.glb', bark='Bark_material', leaf='Brunch_material',
        stems=['Bush_big_002', 'Bush_medium_005', 'Bush_big_005'], eager=True, sizes=(512, 256, 512, 256),
        seasons={'autumn': 'autumn'}),
    # Young to old: a 5 m sapling, two coppice-sized (10-13 m), an upright 20 m oak and a broad, forked 21 m field oak (the
    # pack's 28 m veteran costs 63k triangles over its levels: left out).
    'oak': dict(
        glb='oak_trees_pack_17var_lods_seasons_gameready.glb', bark='Bark_Mat', leaf='Cluster_Mat',
        stems=['Small_oak_tree__002', 'Medium_oak_tree__002', 'Medium_oak_tree__003', 'Big_oak_tree__002',
               'Big_oak_tree__004'],
        trunk=(0.4, 1.4), board='pack', cell=(512, 512), sizes=(512, 512, 1024, 512),
        seasons={'spring': 'Cluster_Mat_Spring_EX', 'autumn': 'Cluster_Mat_Early_autumn_EX'}),
    # Young firs, 4-9 m (the pack's sizes): their branches reach the ground, the axis is the foot of the trunk.
    'fir': dict(
        glb='realistic_fir_trees_pack_lods_gameready.glb', bark='Bark_Mat', leaf='Brunches_Mat',
        stems=['Christmas tree_4', 'Christmas tree_6', 'Christmas tree'],
        trunk=(0, 0.2), board='pack', cell=(512, 512), sizes=(512, 512, 1024, 512)),
    'birch': dict(
        glb='five_birch_trees_pack_lowpoly_lods.glb', bark='Birch_bark', leaf='Birch_Atlas',
        stems=['Birch_2', 'Birch_3', 'Birch_5'],
        trunk=(0.4, 1.4), board='bake', cell=(512, 512), sizes=(512, 512, 1024, 512), seasons={'autumn': 'autumn'},
        lod=lambda stem, n: rf'{re.escape(stem)}_Birch_(bark|Atlas)_0' if n == 0 else rf'{re.escape(stem)}_LOD{n}_.*'),
    'maple': dict(
        glb='maple_trees_pack_lowpoly_game_ready_lods.glb', bark='Bark_Mat', leaf='Cluster_Mat',
        stems=['Acer_small_2', 'Acer_medium_3', 'Acer_medium_2', 'Acer_large_2'],
        trunk=(0.4, 1.4), board='pack', cell=(512, 512), sizes=(512, 512, 1024, 512), seasons={'autumn': 'autumn'}),
    # Models with one (dense) level only, by Jagobo: `nodes` picks a variant's bark and leaf nodes (regex on a node or its
    # parent); `reduce` makes the levels: at most this many bark triangles (meshoptimizer, `simplify.mjs`) and leaf-card
    # triangles (whole cards dropped, the kept ones grown to cover for them) per level.
    # Elms of 21, 24 and 32 m (the collection's 25 / 31 m look-alikes left out).
    'elm': dict(
        glb='high_detail_elm_tree_collection.glb', bark='bark', leaf='foliage', author='Jagobo',
        stems=['007', '008', '006'], nodes=lambda s: rf'(structure|foliage)\.{s}_\d+',
        reduce=[(6000, 9000), (2500, 4000), (1200, 1800)],
        trunk=(0.4, 1.4), board='bake', cell=(512, 512), sizes=(512, 512, 1024, 512), seasons={'autumn': 'autumn'}),
    # Weeping willows of 10, 14 and 19 m (the scene's 27 m one costs 340k triangles: left out). Skinned to a rig: the rest
    # pose, as static meshes (the wind shader sways them).
    'willow': dict(
        glb='rigged__animated_weeping_willows.glb', bark='willow_bark', leaf='willow_foliage', author='Jagobo',
        stems=['3', '1', '2'], nodes=lambda s: rf'GLTF_created_{s}', foot=lambda s: f'GLTF_created_{s}_rootJoint',
        factor=True,
        reduce=[(9000, 12000), (3500, 5000), (1200, 2000)],
        trunk=(0.4, 1.4), board='bake', cell=(512, 512), sizes=(512, 512, 1024, 512), seasons={'autumn': 'autumn'}),
}
# Autumn leaves recoloured from the summer ones (kinds whose pack has no autumn textures): a ramp the leaves spread over
# in soft patches (a card of leaves turns together), least to most turned. Balkan field / Montpellier maples go yellow
# to orange and red, birches gold.
AUTUMN = {
    'maple': ['#7d7a2e', '#b8962e', '#c87a2a', '#c0602a', '#a4462c'],
    'birch': ['#7e8034', '#b0a23a', '#c8aa3c', '#c09a36', '#a88232'],
    'lilac': ['#5e6a34', '#7d7a36', '#9a8a3e', '#8a7040', '#6e5a3e'],
    'bush': ['#5e6a32', '#8a8236', '#a87a36', '#a05a32', '#7e4634'],
    # field / wych elm and white / weeping willow: yellow, the willows keep some green late
    'elm': ['#7a7a34', '#a49a3a', '#c0a43c', '#b8963a', '#9c7e36'],
    'willow': ['#6e7a36', '#8e8e3a', '#aca23e', '#b8a640', '#a89034'],
}


def meshes(g, binary, parent=False):
    """node name -> list of (material name, positions, normals, uvs, indices) in world space; `parent`: also listed under
    the parent node's name (models whose mesh nodes are the unnamed children of a named one). A skinned mesh is posed by
    its joints (the rig's rest pose), as glTF draws it."""
    out = {}
    world = {}

    def place(i, M):
        world[i] = M = M @ node_matrix(g['nodes'][i])
        for c in g['nodes'][i].get('children', []):
            place(c, M)

    def walk(i, up=None):
        n = g['nodes'][i]
        M = world[i]
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                a = p['attributes']
                pos = accessor(g, binary, a['POSITION'])
                nrm = accessor(g, binary, a['NORMAL'])
                if 'skin' in n and 'JOINTS_0' in a:
                    sk = g['skins'][n['skin']]
                    ibm = accessor(g, binary, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
                    J = np.array([world[j] @ ibm[k] for k, j in enumerate(sk['joints'])])
                    w = accessor(g, binary, a['WEIGHTS_0'])
                    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
                    Mv = np.einsum('vk,vkij->vij', w, J[accessor(g, binary, a['JOINTS_0']).astype(np.int64)])
                    P = np.einsum('vij,vj->vi', Mv[:, :3, :3], pos) + Mv[:, :3, 3]
                    nn = np.einsum('vij,vj->vi', Mv[:, :3, :3], nrm)
                else:
                    R = M[:3, :3]
                    P = (R @ pos.T).T + M[:3, 3]
                    nn = (np.linalg.inv(R).T @ nrm.T).T
                nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
                prim = (g['materials'][p['material']]['name'], P, nn, accessor(g, binary, a['TEXCOORD_0']),
                        accessor(g, binary, p['indices']).astype(np.int64).ravel())
                out.setdefault(n.get('name'), []).append(prim)
                if parent and up is not None:
                    out.setdefault(up, []).append(prim)
        for c in n.get('children', []):
            walk(c, n.get('name'))

    for s in g['scenes'][g.get('scene', 0)]['nodes']:
        place(s, np.eye(4))
        walk(s)
    return out


def simplify(P, U, I, target, error):
    """Bark down to about `target` triangles: meshoptimizer (scripts/trees/simplify.mjs, uv seams kept) as far as `error`
    (relative to the tree's size) allows; where that stays over the target (twigs too small to collapse further), the
    smallest pieces dropped whole (mostly hidden in the leaf cards, which draw their own), the trunk foot and the biggest
    kept first. The used vertices and the new indices."""
    # one vertex per position and uv (the models repeat them per face: nothing could collapse)
    _, first, inv = np.unique(np.round(np.c_[P, U], 5), axis=0, return_index=True, return_inverse=True)
    P, U, I = P[first], U[first], inv.ravel()[I]
    js = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'simplify.mjs')
    head = struct.pack('<IIIf', len(P), len(I), target * 3, error)
    data = head + P.astype('<f4').tobytes() + U.astype('<f4').tobytes() + I.astype('<u4').tobytes()
    res = subprocess.run(['node', js], input=data, capture_output=True, check=True,
                         cwd=os.path.join(os.path.dirname(js), '..', '..')).stdout
    n = struct.unpack_from('<I', res, 0)[0]
    tris = np.frombuffer(res, '<u4', n, 4).astype(np.int64).reshape(-1, 3)
    if len(tris) > target:
        # pieces by position (the uv seams split the vertices)
        _, weld = np.unique(np.round(P, 4), axis=0, return_inverse=True)
        wt = weld.ravel()[tris]
        a = np.concatenate([wt[:, 0], wt[:, 1]])
        b = np.concatenate([wt[:, 1], wt[:, 2]])
        nw = weld.max() + 1
        _, label = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(nw, nw)), directed=False)
        piece = label[wt[:, 0]]
        k = label.max() + 1
        lo = np.full((k, 3), np.inf)
        hi = np.full((k, 3), -np.inf)
        np.minimum.at(lo, np.repeat(piece, 3), P[tris.ravel()])
        np.maximum.at(hi, np.repeat(piece, 3), P[tris.ravel()])
        per = np.bincount(piece, minlength=k)
        rank = np.linalg.norm(hi - lo, axis=1) + 1e6 * (lo[:, 1] < P[:, 1].min() + 0.5)
        keep = np.zeros(k, bool)
        room = target
        for p in np.argsort(-rank, kind='stable'):
            if 0 < per[p] <= room:
                keep[p] = True
                room -= per[p]
        tris = tris[keep[piece]]
    used, J = np.unique(tris.ravel(), return_inverse=True)
    return first[used], J


def merge(prims):
    """Several (positions, normals, uvs, indices) as one."""
    off = np.cumsum([0] + [len(p[0]) for p in prims])[:-1]
    return (np.concatenate([p[0] for p in prims]), np.concatenate([p[1] for p in prims]),
            np.concatenate([p[2] for p in prims]), np.concatenate([p[3] + o for p, o in zip(prims, off)]))


def thin_cards(P, N, U, I, target, seed):
    """Leaf cards (each a connected patch of triangles) down to about `target` triangles: whole cards dropped at random,
    the kept ones grown about their middle so the crown keeps its cover (area: 1 / the share kept)."""
    tris = I.reshape(-1, 3)
    if len(tris) <= target:
        return P, N, U, I
    n = len(P)
    a = np.concatenate([tris[:, 0], tris[:, 1]])
    b = np.concatenate([tris[:, 1], tris[:, 2]])
    _, label = connected_components(coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n)), directed=False)
    card = label[tris[:, 0]]
    ids, per = np.unique(card, return_counts=True)
    order = np.random.default_rng(seed).permutation(len(ids))
    keep_n = np.searchsorted(np.cumsum(per[order]), target) + 1
    keep = np.zeros(label.max() + 1, bool)
    keep[ids[order[:keep_n]]] = True
    grow = min(np.sqrt(len(tris) / max(per[order[:keep_n]].sum(), 1)), 2.5)
    kt = tris[keep[card]]
    used, J = np.unique(kt.ravel(), return_inverse=True)
    Q = P[used]
    lab = label[used]
    mid = np.zeros((label.max() + 1, 3))
    cnt = np.bincount(lab, minlength=len(mid))[:, None]
    np.add.at(mid, lab, Q)
    mid /= np.maximum(cnt, 1)
    Q = mid[lab] + (Q - mid[lab]) * grow
    return Q, N[used], U[used], J


def pack(P, N, U, I, origin):
    P = P - origin
    lo = P.min(axis=0)
    size = np.maximum(P.max(axis=0) - lo, 1e-6)
    q = np.round((P - lo) / size * 65535).astype('<u2')
    n8 = np.round(N * 127).astype('i1')
    ulo = U.min(axis=0)
    usize = np.maximum(U.max(axis=0) - ulo, 1e-6)
    u = np.round((U - ulo) / usize * 65535).astype('<u2')
    head = struct.pack('<I3f3f2f2f', len(P), *lo, *size, *ulo, *usize)
    v = np.zeros(len(P), dtype=[('p', '<u2', 3), ('n', 'i1', 3), ('pad', 'i1'), ('uv', '<u2', 2)])
    v['p'], v['n'], v['uv'] = q, n8, u
    return head + v.tobytes() + struct.pack('<I', len(I)) + I.astype('<u2').tobytes()


def texture(g, binary, mat, slot, factor=False):
    """A material's colour (`factor`: times its colour factor) or normal texture; a flat normal where it has none."""
    m = next(x for x in g['materials'] if x['name'] == mat)
    if slot == 'normal' and 'normalTexture' not in m:
        return Image.new('RGB', (64, 64), (128, 128, 255))
    pbr = m['pbrMetallicRoughness']
    t = pbr['baseColorTexture']['index'] if slot == 'color' else m['normalTexture']['index']
    im = g['images'][g['textures'][t]['source']]
    bv = g['bufferViews'][im['bufferView']]
    off = bv.get('byteOffset', 0)
    img = Image.open(io.BytesIO(binary[off:off + bv['byteLength']]))
    f = pbr.get('baseColorFactor', [1, 1, 1, 1])[:3] if slot == 'color' and factor else [1, 1, 1]
    if f != [1, 1, 1]:
        a = np.asarray(img.convert('RGBA')).astype(np.float32)
        a[..., :3] *= np.array(f, np.float32)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA').convert('RGBA' if 'A' in img.mode else 'RGB')
    return img


def shrink(im, px, mode, aspect=False):
    """`px` square, or `aspect`: `px` across the longer side, the texture's own aspect."""
    w, h = im.size
    size = (px * w // max(w, h), px * h // max(w, h)) if aspect else (px, px)
    return im.convert(mode).resize(size, Image.LANCZOS)


def mean_leaf(im):
    """Alpha-weighted mean colour (0..255) of a leaf texture."""
    a = np.asarray(im.convert('RGBA')).astype(np.float64)
    w = a[..., 3:] / 255
    return (a[..., :3] * w).sum(axis=(0, 1)) / max(w.sum(), 1)


def spent_blossom(im):
    """Lilac blooms in late April; the rest of the year the panicles are seed heads. Purple pixels -> olive brown, keeping
    their light and shade."""
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    purple = (b > g + 2) & (r > g + 2)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    seed = np.array([112, 96, 60], np.float32) / 150.0
    for c in range(3):
        a[..., c] = np.where(purple, np.clip(lum * seed[c], 0, 255), a[..., c])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def summer_green(im):
    """The maple pack's leaves are a dark olive with no blue at all (no colour gain makes that green): lift the leaf
    pixels' blue towards half their green, a touch less red."""
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    leaf = (g >= 0.85 * r) & (a[..., 3] > 0)
    a[..., 0] = np.where(leaf, r * 0.92, r)
    a[..., 2] = np.where(leaf, np.maximum(b, 0.5 * g), b)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def autumn(im, ramp, seed, green=0.92):
    """Summer leaves -> autumn: every leaf pixel (green or yellow-green, not the brown twigs or the bark) takes the
    ramp colour of a soft noise patch, keeping its own light and shade. `green`: least green / red of a leaf pixel (the
    birch atlas holds dark bark tiles of a near-neutral olive too)."""
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    sat = (np.max(a[..., :3], axis=2) - np.min(a[..., :3], axis=2)) / np.maximum(np.max(a[..., :3], axis=2), 1)
    leaf = (g >= green * r) & (g > b) & (sat > 0.25) & (a[..., 3] > 0)
    ref = lum[leaf].mean()
    h, w = lum.shape
    rng = np.random.default_rng(seed)
    noise = Image.fromarray((rng.random((h // 32, w // 32)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    t = np.asarray(noise.filter(ImageFilter.GaussianBlur(w / 64))).astype(np.float32) / 255
    t = np.clip((t - t.min()) / max(t.max() - t.min(), 1e-6), 0, 1) * (len(ramp) - 1)
    cols = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in ramp], np.float32)
    k = np.minimum(t.astype(int), len(ramp) - 2)
    f = (t - k)[..., None]
    target = cols[k] * (1 - f) + cols[k + 1] * f
    tl = 0.3 * target[..., 0] + 0.59 * target[..., 1] + 0.11 * target[..., 2]
    out = target * (lum / ref * 0.8 * tl.mean() / np.maximum(tl, 1))[..., None]
    a[..., :3] = np.where(leaf[..., None], np.clip(out, 0, 255), a[..., :3])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def bleed(im):
    """Colour into the clear texels (from their nearest covered ones, a mip pyramid), so filtering never pulls in black."""
    a = np.asarray(im.convert('RGBA')).astype(np.float64)
    h, w = a.shape[:2]
    n = 1 << int(np.ceil(np.log2(max(h, w))))
    c = np.zeros((n, n, 3))
    wt = np.zeros((n, n, 1))
    c[:h, :w] = a[..., :3] * (a[..., 3:] / 255)
    wt[:h, :w] = a[..., 3:] / 255
    levels = [(c, wt)]
    while levels[-1][0].shape[0] > 1:
        c, wt = levels[-1]
        m = c.shape[0] // 2
        levels.append((c.reshape(m, 2, m, 2, 3).sum(axis=(1, 3)), wt.reshape(m, 2, m, 2, 1).sum(axis=(1, 3))))
    fill = levels[-1][0] / np.maximum(levels[-1][1], 1e-9)
    for c, wt in reversed(levels[:-1]):
        up = fill.repeat(2, axis=0).repeat(2, axis=1)
        fill = np.where(wt > 1e-6, c / np.maximum(wt, 1e-9), up)
    out = np.where(a[..., 3:] > 0, a[..., :3], fill[:h, :w])
    return Image.fromarray(np.concatenate([np.clip(out, 0, 255), a[..., 3:]], axis=2).astype(np.uint8), 'RGBA')


def fit(im, size):
    """Resize an alpha texture with premultiplied filtering, then bleed its colours."""
    return bleed(im.convert('RGBA').convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA'))


def render(parts, right, normal, s0, s1, t0, t1, w, h, ss=3):
    """Orthographic view of textured triangles (alpha-tested at 0.5, unlit: like the packs' billboards) onto the plane
    of `right` and +y, seen from +`normal`: RGBA w x h, row 0 at t1."""
    W, H = w * ss, h * ss
    col = np.zeros((H, W, 3), np.float32)
    cov = np.zeros((H, W), np.float32)
    dep = np.full((H, W), -1e9, np.float32)
    for P, U, I, tex, wrap in parts:
        th, tw = tex.shape[:2]
        x = (P @ right - s0) / (s1 - s0) * W
        y = (t1 - P[:, 1]) / (t1 - t0) * H
        d = P @ normal
        for a, b, c in I.reshape(-1, 3):
            xa, xb, xc, ya, yb, yc = x[a], x[b], x[c], y[a], y[b], y[c]
            x0, x1 = int(max(min(xa, xb, xc), 0)), int(min(max(xa, xb, xc) + 1, W))
            y0, y1 = int(max(min(ya, yb, yc), 0)), int(min(max(ya, yb, yc) + 1, H))
            if x0 >= x1 or y0 >= y1:
                continue
            area = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya)
            if abs(area) < 1e-9:
                continue
            px, py = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            w0 = ((xb - px) * (yc - py) - (xc - px) * (yb - py)) / area
            w1 = ((xc - px) * (ya - py) - (xa - px) * (yc - py)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            z = w0 * d[a] + w1 * d[b] + w2 * d[c]
            u = w0 * U[a, 0] + w1 * U[b, 0] + w2 * U[c, 0]
            v = w0 * U[a, 1] + w1 * U[b, 1] + w2 * U[c, 1]
            if wrap:
                tx, ty = (np.floor(u * tw).astype(int) % tw), (np.floor(v * th).astype(int) % th)
            else:
                tx, ty = np.clip((u * tw).astype(int), 0, tw - 1), np.clip((v * th).astype(int), 0, th - 1)
            texel = tex[ty, tx]
            win = dep[y0:y1, x0:x1]
            ok = inside & (texel[..., 3] > 127) & (z > win)
            if not ok.any():
                continue
            win[ok] = z[ok]
            col[y0:y1, x0:x1][ok] = texel[..., :3][ok]
            cov[y0:y1, x0:x1][ok] = 1
    col = col.reshape(h, ss, w, ss, 3)
    cov = cov.reshape(h, ss, w, ss)
    a = cov.mean(axis=(1, 3))
    rgb = (col * cov[..., None]).sum(axis=(1, 3)) / np.maximum(cov.sum(axis=(1, 3)), 1e-6)[..., None]
    return bleed(Image.fromarray(np.concatenate([rgb, a[..., None] * 255], axis=2).astype(np.uint8), 'RGBA'))


# The baked billboard: four views (front, right, back, left) as two crossed planes, one card per side, in a 2 x 2 grid
# of the variant's atlas cell.
VIEWS = 4


def bake_board(parts, height, radius, cell):
    """(card positions, normals, uvs in the cell 0..1, indices), the cell image."""
    cw, ch = cell[0] // 2, cell[1] // 2
    sheet = Image.new('RGBA', cell)
    P, N, U, I = [], [], [], []
    for k in range(VIEWS):
        th = k * np.pi / 2
        n = np.array([np.sin(th), 0, np.cos(th)])
        r = np.array([np.cos(th), 0, -np.sin(th)])
        sheet.paste(render(parts, r, n, -radius, radius, 0, height, cw, ch), ((k % 2) * cw, (k // 2) * ch))
        u0, v0 = (k % 2) / 2, (k // 2) / 2
        base = len(P)
        for s, t in [(-1, 0), (1, 0), (1, 1), (-1, 1)]:
            P.append(r * s * radius + np.array([0, t * height, 0]))
            N.append(n)
            U.append([u0 + (s + 1) / 4, v0 + (1 - t) / 2])
        I += [base, base + 1, base + 2, base, base + 2, base + 3]
    return np.array(P), np.array(N), np.array(U), np.array(I), sheet


def origin_of(cfg, P):
    """The trunk foot (x, ground y, z) of a variant's level-0 bark."""
    y0 = P[:, 1].min()
    if 'trunk' not in cfg:
        c = P[P[:, 1] < y0 + 0.3][:, [0, 2]].mean(axis=0)
        return np.array([c[0], y0, c[1]])
    lo, hi = cfg['trunk']
    band = P[(P[:, 1] > y0 + lo) & (P[:, 1] < y0 + hi)][:, [0, 2]]
    band = band[np.hypot(*(band - np.median(band, axis=0)).T) < 1]
    c = (band.min(axis=0) + band.max(axis=0)) / 2
    if cfg.get('flare'):
        # The pines' root flares spread wide (up to 6 trunk radii) and rise up to 0.8 m: the ground line goes where they
        # reach 2.5 trunk radii, the rest is buried as a real tree's roots are.
        trunk = (band.max(axis=0) - band.min(axis=0)).mean() / 2
        reach = np.hypot(*(P[:, [0, 2]] - c).T)
        wide = P[(reach > 2.5 * trunk) & (P[:, 1] < y0 + 1.2), 1]
        if len(wide):
            y0 = wide.max()
    return np.array([c[0], y0, c[1]])


def node_world(g, name):
    """World position of the node of this name."""
    def walk(i, M):
        M = M @ node_matrix(g['nodes'][i])
        if g['nodes'][i].get('name') == name:
            return M[:3, 3]
        for c in g['nodes'][i].get('children', []):
            r = walk(c, M)
            if r is not None:
                return r
    return next(r for r in (walk(i, np.eye(4)) for i in g['scenes'][g.get('scene', 0)]['nodes']) if r is not None)


def trunk_radius(P, origin):
    """Trunk radius (m) near the foot (the collider): the bark points 0.3-2.5 m up near the axis (the lower quartile:
    low branches reach further; a trunk ring every metre or two)."""
    Q = P - origin
    band = Q[(Q[:, 1] > 0.3) & (Q[:, 1] < 2.5)]
    d = np.hypot(band[:, 0], band[:, 2])
    d = d[d < 1.5]
    return float(np.percentile(d, 25) * 1.05) if len(d) else 0.0


def b64(b):
    return base64.b64encode(b).decode()


def camel(kind, name):
    return kind + ''.join(p.capitalize() for p in name.split('-'))


def main():
    preview = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    args = [a for a in sys.argv[1:] if not a.startswith('--') and a != preview]
    if len(args) != 1:
        sys.exit(__doc__)
    if preview:
        os.makedirs(preview, exist_ok=True)
    src = args[0]
    os.makedirs(TEX, exist_ok=True)
    kinds = list(PACKS)
    imports, textures, tints, sizes, eager = [], [], [], [], []
    total = {}

    def save(im, kind, name, **kw):
        path = os.path.join(TEX, f'{kind}-{name}.webp')
        im.save(path, 'WEBP', method=6, **kw)
        total[kind] = total.get(kind, 0) + os.path.getsize(path)
        print(path, os.path.getsize(path) // 1024, 'KB')
        imports.append(f"import {camel(kind, name)} from './tree-packs/{kind}-{name}.webp';")
        return camel(kind, name)

    for kind, cfg in PACKS.items():
        g, binary = load_glb(os.path.join(src, cfg['glb']))
        ms = meshes(g, binary, parent='nodes' in cfg)
        bark_m, leaf_m, stems = cfg['bark'], cfg['leaf'], cfg['stems']
        bs, bns, ls, lns = cfg['sizes']
        tex = {}
        aspect = 'nodes' in cfg  # (the packs' own textures squared, as they always were)
        tex['bark'] = save(shrink(texture(g, binary, bark_m, 'color', cfg.get('factor')), bs, 'RGB', aspect), kind, 'bark',
                           quality=82)
        tex['barkN'] = save(shrink(texture(g, binary, bark_m, 'normal'), bns, 'RGB', aspect), kind, 'bark-n',
                            quality=82)
        own = shrink(texture(g, binary, leaf_m, 'color', cfg.get('factor')), ls, 'RGBA', aspect)
        leaf = spent_blossom(own) if kind == 'lilac' else summer_green(own) if kind == 'maple' else own
        tex['leaf'] = save(leaf, kind, 'leaf', quality=82, alpha_quality=90)
        tex['leafN'] = save(shrink(texture(g, binary, leaf_m, 'normal'), lns, 'RGB', aspect), kind, 'leaf-n', quality=80)
        summer = mean_leaf(leaf)
        seasons, tint = {}, {}
        for season, how in cfg.get('seasons', {}).items():
            if how == 'autumn':
                im = autumn(leaf, AUTUMN[kind], seed=len(kind) * 31 + 7, green=1.15 if kind == 'birch' else 0.92)
            elif how == 'blossom':
                im = own
            else:
                im = shrink(texture(g, binary, how, 'color'), ls, 'RGBA', aspect)
            seasons[season] = save(im, kind, f'leaf-{season}', quality=82, alpha_quality=90)
            tint[season] = mean_leaf(im) / summer
            print(kind, season, 'leaf mean', np.round(mean_leaf(im)), 'summer', np.round(summer), 'tint', np.round(tint[season], 2))
        if kind == 'oak':
            # The season materials dress the same cluster mesh (a copy of one variant): the same uv atlas.
            a = [p for n, ps in ms.items() if n.startswith('Large_oak_tree_002_LOD0.00') for p in ps if p[0] != bark_m]
            assert all(np.allclose(p[3], a[0][3]) for p in a), 'oak season clusters: uvs differ'

        models, size_rows = [], []
        cols = len(stems) if len(stems) <= 3 else int(np.ceil(np.sqrt(len(stems))))
        rows = (len(stems) + cols - 1) // cols
        cell = cfg.get('cell', (256, 512))
        atlas = Image.new('RGBA', (cell[0] * cols, cell[1] * rows)) if cfg.get('board') else None
        for vi, stem in enumerate(stems):
            name_of = cfg.get('lod', lambda s, n: rf'{re.escape(s)}_LOD{n}_.*')
            levels, raw = [], []
            origin = box0 = None
            if 'nodes' in cfg:
                src0 = {}
                for node, prims in ms.items():
                    if re.fullmatch(cfg['nodes'](stem), node):
                        for mat, P, N, U, I in prims:
                            if mat in (bark_m, leaf_m):
                                src0.setdefault('bark' if mat == bark_m else 'leaf', []).append((P, N, U, I))
                src0 = {k: merge(v) for k, v in src0.items()}
            for lod in range(3):
                parts = {}
                if 'nodes' in cfg:
                    bark_t, leaf_t = cfg['reduce'][lod]
                    P, N, U, I = src0['bark']
                    used, J = simplify(P, U, I, bark_t, (0.002, 0.003, 0.005)[lod])
                    parts['bark'] = (P[used], N[used], U[used], J)
                    parts['leaf'] = thin_cards(*src0['leaf'], leaf_t, seed=vi * 7 + lod)
                for node, prims in ms.items() if 'nodes' not in cfg else []:
                    if re.fullmatch(name_of(stem, lod), node):
                        for mat, P, N, U, I in prims:
                            if mat in (bark_m, leaf_m):
                                parts['bark' if mat == bark_m else 'leaf'] = (P, N, U, I)
                assert all(len(v[0]) < 65536 for v in parts.values()), (kind, stem, lod, 'u16 indices')
                P = parts['bark'][0]
                box = (P.min(axis=0) + P.max(axis=0)) / 2
                if origin is None:
                    box0 = box
                    # (a rigged model: its root joint, where hanging shoots crowd the trunk's foot)
                    origin = node_world(g, cfg['foot'](stem)) if 'foot' in cfg else origin_of(
                        cfg, src0['bark'][0] if 'nodes' in cfg else P)
                    allp = np.concatenate([parts['bark'][0], parts['leaf'][0]]) - origin
                    height = float(allp[:, 1].max())
                    radius = float(np.hypot(allp[:, 0], allp[:, 2]).max())
                    trunk = trunk_radius(P, origin)
                    whole = np.concatenate([parts['bark'][0], parts['leaf'][0]])
                    full0 = (whole.min(axis=0) + whole.max(axis=0)) / 2
                # (a pack lays its levels side by side; reduced levels stand where level 0 does)
                at = origin if 'nodes' in cfg else origin + (box - box0) * [1, 0, 1]
                levels.append((pack(*parts['bark'], at), pack(*parts['leaf'], at)))
                raw.append({k: (v[0] - at, v[1], v[2], v[3]) for k, v in parts.items()})
                tris = len(parts['bark'][3]) // 3 + len(parts['leaf'][3]) // 3
                print(f'{kind} {stem} LOD{lod}: {tris} tris, shift {np.round(box - box0, 2)}')
            print(f'{kind} {stem}: height {height:.2f} radius {radius:.2f} trunk {trunk:.2f} buried {origin[1] - P[:, 1].min():.2f}')
            board = None
            if cfg.get('board') == 'pack':
                hit = [(n, ps[0]) for n, ps in ms.items()
                       if re.fullmatch(rf'{re.escape(stem)}_(Billboard_LOD3|Billboard|LOD3)_.*', n) and 'Billboard' in ps[0][0]]
                assert len(hit) == 1, (stem, [h[0] for h in hit])
                mat, P, N, U, I = hit[0][1]
                # The billboard stands beside the meshes too: moved onto level 0 by the whole tree's box.
                c = (P.min(axis=0) + P.max(axis=0)) / 2
                at = origin + (c - full0) * [1, 0, 1]
                img = fit(texture(g, binary, mat, 'color'), cell)
                bP, bN, bU, bI = P - at, N, U, I
            elif cfg.get('board') == 'bake':
                tx = {
                    'bark': np.asarray(texture(g, binary, bark_m, 'color', cfg.get('factor')).convert('RGBA')),
                    'leaf': np.asarray(texture(g, binary, leaf_m, 'color', cfg.get('factor')).convert('RGBA')),
                }
                bP, bN, bU, bI, img = bake_board(
                    [(p[0], p[2], p[3], tx[k], k == 'bark') for k, p in raw[0].items()], height, radius, cell)
            if cfg.get('board'):
                cx, cy = vi % cols, vi // cols
                atlas.paste(img, (cx * cell[0], cy * cell[1]))
                bU = (np.clip(bU, 0, 1) + [cx, cy]) / [cols, rows]
                # Lit as a crown, not as flat cards (a card turned from the sun went black next to its lit neighbour): the
                # normals lean up, the cards' own facing a third of the way.
                lit = 0.35 * bN + [0, 1, 0]
                board = pack(bP, lit / np.linalg.norm(lit, axis=1, keepdims=True), bU, bI, np.zeros(3))
                # Front faces: glTF counter-clockwise; a card is seen from its own side only (FrontSide).
                tri = bP[bI.reshape(-1, 3)]
                fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
                agree = np.mean(np.sum(fn * bN[bI.reshape(-1, 3)[:, 0]], axis=1) > 0)
                print(f'{kind} {stem} board: {len(bI) // 3} tris, winding agrees with normals {agree:.0%}')
            if preview:
                preview_variant(preview, kind, stem, raw, g, binary, cfg, height, radius,
                                (bP, bU, bI, atlas) if board else None)
            models.append((height, radius, levels, board))
            size_rows.append(f'{{ height: {height:.2f}, radius: {radius:.2f}, trunk: {trunk:.2f} }}')
        if atlas is not None:
            textures_board = save(bleed(atlas), kind, 'board', quality=82, alpha_quality=90)
        sizes.append(f'  {kind}: [{", ".join(size_rows)}],')
        entry = ', '.join(f'{k}: {v}' for k, v in tex.items())
        if seasons:
            entry += ', seasons: { ' + ', '.join(f'{s}: {v}' for s, v in seasons.items()) + ' }'
        if atlas is not None:
            entry += f', board: {textures_board}'
        textures.append(f'  {kind}: {{ {entry} }},')
        if tint:
            tints.append(f'  {kind}: {{ ' + ', '.join(
                f'{s}: [{", ".join(f"{x:.3f}" for x in t)}]' for s, t in tint.items()) + ' },')
        body = []
        for height, radius, levels, board in models:
            body.append(f'  {{ height: {height:.2f}, radius: {radius:.2f}, lods: [')
            for b, lf in levels:
                body.append("    { bark: '%s', leaf: '%s' }," % (b64(b), b64(lf)))
            body.append('  ]' + (", board: '%s' }," % b64(board) if board else ' },'))
        if cfg.get('eager'):
            eager.append(f'  {kind}: [')
            eager += ['  ' + line for line in body]
            eager.append('  ],')
        else:
            path = os.path.join(TEX, f'{kind}.data.ts')
            with open(path, 'w', newline='\n') as f:
                f.write(
                    f'// Generated by scripts/trees/bake-tree-packs.py from a CC BY 4.0 pack by {cfg.get("author", "LOLIPOP")} (THIRD-PARTY.md). Do not edit.\n'
                    "import type { PackModel } from '../tree-packs.data';\n\n"
                    f'/** The {kind} models (`loadTreePacks`). */\n'
                    'export const PACK_MODELS: PackModel[] = [\n' + '\n'.join(body) + '\n];\n')
            total[kind] = total.get(kind, 0) + os.path.getsize(path)
            print(path, os.path.getsize(path) // 1024, 'KB')

    lazy = [k for k in kinds if not PACKS[k].get('eager')]
    lines = [
        '// Generated by scripts/trees/bake-tree-packs.py from CC BY 4.0 packs by LOLIPOP and Jagobo (THIRD-PARTY.md). Do not edit.',
        *imports,
        '',
        'export type PackKind = ' + ' | '.join(f"'{k}'" for k in kinds) + ';',
        '/** Kinds whose models are a chunk of their own (`tree-packs/<kind>.data.ts`, `loadTreePacks`). */',
        'export type LazyPackKind = ' + ' | '.join(f"'{k}'" for k in lazy) + ';',
        'export interface PackLevel {',
        '  /** Packed meshes (layout: see the baker): the bark and the leaf cards. */',
        '  bark: string;',
        '  leaf: string;',
        '}',
        'export interface PackModel {',
        '  /** Height (m) and widest reach from the trunk (m). */',
        '  height: number;',
        '  radius: number;',
        '  /** Level of detail 0 (near) .. 2. */',
        '  lods: PackLevel[];',
        '  /** The far billboard (crossed cards on the kind\'s board atlas), packed like the meshes. */',
        '  board?: string;',
        '}',
        'export interface PackTextures {',
        '  bark: string;',
        '  barkN: string;',
        '  leaf: string;',
        '  leafN: string;',
        '  /** The leaf colour of other seasons (the same atlas). */',
        "  seasons?: Partial<Record<'spring' | 'autumn', string>>;",
        '  /** Every variant\'s billboard. */',
        '  board?: string;',
        '}',
        '',
        '/** Height (m), widest reach (m) and trunk radius 1 m up (m) per variant, at scale 1. */',
        'export const PACK_SIZES: Record<PackKind, { height: number; radius: number; trunk: number }[]> = {',
        *sizes,
        '};',
        '',
        'export const PACK_TEXTURES: Record<PackKind, PackTextures> = {',
        *textures,
        '};',
        '',
        '/** Mean leaf colour of a season\'s texture over the summer one (linear-ish rgb gain): tints the far billboards. */',
        "export const PACK_SEASON_TINT: Partial<Record<PackKind, Partial<Record<'spring' | 'autumn', [number, number, number]>>>> = {",
        *tints,
        '};',
        '',
        '/** The models of the kinds in the main script. */',
        "export const TREE_PACKS: Record<Exclude<PackKind, LazyPackKind>, PackModel[]> = {",
        *eager,
        '};',
    ]
    with open(OUT, 'w', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    total['(eager data)'] = os.path.getsize(OUT)
    print(OUT, os.path.getsize(OUT) // 1024, 'KB')
    for k, v in total.items():
        print(f'total {k}: {v // 1024} KB')


def preview_variant(out, kind, stem, raw, g, binary, cfg, height, radius, board):
    """Each level from the side (x right) and the board as the game draws it, side by side."""
    tx = {
        'bark': np.asarray(texture(g, binary, cfg['bark'], 'color', cfg.get('factor')).convert('RGBA')),
        'leaf': np.asarray(texture(g, binary, cfg['leaf'], 'color', cfg.get('factor')).convert('RGBA')),
    }
    h = 360
    w = max(int(h * 2 * radius / height), 60)
    r, n = np.array([1.0, 0, 0]), np.array([0, 0, 1.0])
    ims = [render([(p[0], p[2], p[3], tx[k], k == 'bark') for k, p in lv.items()], r, n, -radius, radius, 0, height, w, h, ss=2)
           for lv in raw]
    if board:
        bP, bU, bI, atlas = board
        ims.append(render([(bP, bU, bI, np.asarray(atlas), False)], r, n, -radius, radius, 0, height, w, h, ss=2))
    sheet = Image.new('RGB', (len(ims) * (w + 10), h + 10), (150, 170, 200))
    for i, im in enumerate(ims):
        sheet.paste(im, (i * (w + 10) + 5, 5), im)
    sheet.save(os.path.join(out, kind + '-' + re.sub(r'\W', '_', stem) + '.jpg'), quality=88)


main()
