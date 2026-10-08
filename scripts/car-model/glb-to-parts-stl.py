"""glTF / GLB (already split into parts) -> labelled binary STL for stl-to-glb.mjs.

    python scripts/car-model/glb-to-parts-stl.py <car>/model.source.json <in.glb> <out.stl> [--list]

For downloaded models that come as separate meshes / materials (scan-mesh.py verdict "already split"):
every primitive is baked into world space (node transforms applied) and written as triangles whose
2-byte STL attribute is the index into `parts.materials` of the config - the same labelled STL
segment-stl.py writes, so stl-to-glb.mjs then re-orients, simplifies, builds the livery atlas UVs
and one primitive per material as usual (`.claude/skills/rally-car-import/SKILL.md`).

Which primitive becomes which material is the `gltf` block of model.source.json:

    "gltf": {
      "drop": ["Wheels_0", "TIRES.001"],                 # node or material names removed entirely
      "parts": [                                          # first matching rule wins
        {"node": "Object_17", "material": "body"},
        {"mat": "mat_24", "material": "glass"},
        {"mat": "mat_7", "z": [0.5, 3], "material": "headlight"},   # optional x / y / z box (world coords)
        {"mat": "mat_7", "material": "tail"}
      ],
      "default": "trim"                                   # unmatched primitives (omit = error)
    }

`node` can also be a list of node names. `move: [dx, dy, dz]` (source units) shifts the rule's triangles - e.g. the model's own
springs / dampers pulled in to the game's wheel track when the physics track is narrower than the model's (cars/subie-22b/).

A rule can also be an exact outline cut - `"region": {"view": "front", "poly": [[x, y], ...], "depth": [zmin, zmax], "mirror": true}` in
MODEL coordinates (after the config's offset), convex polygon: the primitive's triangles are CLIPPED along the outline and the
pieces inside (and inside `depth` along the view axis) get the material, the rest keep looking - clean part borders on big
skin triangles (a centre-based box leaves saw teeth). Views: front / rear (x, y), left / right (z, y), top (z, x).

A rule can also take `"uv": [u0, u1, v0, v1]` (glTF TEXCOORD_0 of the source primitive, v down): it matches triangles whose UV
centroid lies in the box - lamps that the model paints into its body texture (the lamp crop of that texture is the lamp's
own map: `uv` box = the texture rectangle to cut out). Put it before any `region` rule of the same primitive (a cut drops the UVs).

A rule can also take `"near": {"mat": "mat_25", "z": [0.8, 1.5], "d": 0.05}`: it then only matches triangles whose
centroid lies within `d` metres of the triangles of that source material (optionally cut to an x / y / z box) - used
for the black border round a windscreen without hand-placed boxes.

Rules and `near` blocks can also take `"facing": {"y": [0.3, 1], "|x|": [0, 0.7]}`: the triangle's unit normal component
must lie in the range (a scalar = minimum; "|x|" tests the absolute value). In a `near` block it filters the sampled
triangles (windscreen + rear screen glass without the side windows of the same material).

`"arch": {"axles": [1.32, -1.27], "y": 0.31, "r": [0.28, 0.48], "toward": 0.3, "|x|": [0.45, 1], "dy": -0.06}` (source
coordinates) matches the wheel-arch liners and the inner faces of the flares: triangles within `r` of a hub line whose normal
points at it (`arch_mask`) - send them to `trim` so the arches are black, not painted.

`"texture": {"maxLum": 0.22, "maxSat": 0.1, "blur": 9, "refine": 0.015, "exclude": [[u0, u1, v0, v1], ...]}` matches
triangles whose base-colour texels are dark and unsaturated (`dark_mask`, blurred so thin streaks drop out), after splitting them
along that texture border down to `refine` metres - black rubbers, vents and carbon painted into the body texture. `exclude`
blanks UV rectangles (v down) first: emblems drawn in the same ink.

`"whole": true` makes the x / y / z box test whole connected islands (triangles sharing vertices, computed on the full
primitive) instead of triangle centres: an island matches only when its bounding box lies inside the box - picks a wing,
scoop or mirror glass that is welded into a bigger primitive without nibbling the panel next to it. `"islandTris": [min, max]`
keeps islands with that many triangles (separates a lamp housing from the bowls inside it).

`"tube": {"r": [0.012, 0.024], "score": 0.15, "length": 0.3}` keeps whole islands shaped like a tube of radius r (metres)
at least `length` long - a roll cage modelled into the same primitive as the seats and door cards. The test
(`tube_scores`): every vertex moves inward along its normal by d; on a tube of radius d the edges round each ring collapse
onto the axis, so `score` = the share of the island's edges that shrink below 25 % (tube ~0.2 - 0.5, panel / seat ~0).
Steering columns and gear rods pass too: send them elsewhere with an earlier rule.

After the labelling it prints two sanity reports (a leftover brake disc shipped as black `trim` plates in the Skoda import):
  * `defaulted`: every primitive (or part of one) that matched no rule and fell to `gltf.default` - check each is really trim;
  * `disc-like islands`: round flat plates (< 5 cm thick, 0.25 - 0.7 m across, roughly square the other two) in the output - brake discs,
    hub caps, wheel faces or tyre-wall remnants. The game builds its own wheels, tyres, discs and calipers, so drop them
    (`gltf.drop` by node / material name) unless they are a real body part.

`--list` prints every primitive (node, material, triangles, world bbox) and exits - run it first.
"""
import json
import struct
import sys

import numpy as np

CT = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    data = open(path, 'rb').read()
    if data[:4] == b'glTF':
        ln = struct.unpack_from('<I', data, 12)[0]
        g = json.loads(data[20:20 + ln])
        bins = [data[20 + ln + 8:]]
    else:
        g = json.loads(data)
        bins = []
        for b in g['buffers']:
            bins.append(open(path.rsplit('/', 1)[0] + '/' + b['uri'], 'rb').read())
    return g, bins


def accessor(g, bins, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    buf = bins[bv.get('buffer', 0)]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NC[a['type']]
    dt = np.dtype(CT[a['componentType']])
    stride = bv.get('byteStride', 0)
    if stride and stride != n * dt.itemsize:
        rows = np.frombuffer(buf, np.uint8, a['count'] * stride, off).reshape(a['count'], stride)
        return rows[:, :n * dt.itemsize].copy().view(dt).reshape(a['count'], n).astype(np.float64)
    return np.frombuffer(buf, dt, a['count'] * n, off).reshape(a['count'], n).astype(np.float64)


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    t = n.get('translation', [0, 0, 0])
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M[:3, :3] = R * np.array(s, float)
    M[:3, 3] = t
    return M


def primitives(g, bins):
    """Yield (node name, material name, triangles (n, 3, 3) in world space, world bbox) per primitive."""
    nodes = g['nodes']
    out = []

    def walk(i, M, path):
        n = nodes[i]
        M = M @ node_matrix(n)
        name = n.get('name', f'node{i}')
        path = path + [name]
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4:
                    continue
                P = accessor(g, bins, p['attributes']['POSITION'])
                P = (M[:3, :3] @ P.T).T + M[:3, 3]
                if 'indices' in p:
                    I = accessor(g, bins, p['indices']).astype(np.int64).ravel()
                else:
                    I = np.arange(len(P))
                T = P[I].reshape(-1, 3, 3)
                mat = g['materials'][p['material']].get('name', f"mat{p['material']}") if 'material' in p else ''
                out.append((name, mat, path, T))
        for c in n.get('children', []):
            walk(c, M, path)

    for s in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(s, np.eye(4), [])
    return out


def primitive_uvs(g, bins):
    """TEXCOORD_0 triangles (n, 3, 2) per primitive, in the same order as primitives() (None without UVs)."""
    out = []

    def walk(i):
        n = g['nodes'][i]
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4:
                    continue
                if 'TEXCOORD_0' not in p['attributes']:
                    out.append(None)
                    continue
                UV = accessor(g, bins, p['attributes']['TEXCOORD_0'])
                I = accessor(g, bins, p['indices']).astype(np.int64).ravel() if 'indices' in p else np.arange(len(UV))
                out.append(UV[I].reshape(-1, 3, 2))
        for c in n.get('children', []):
            walk(c)

    for s in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(s)
    return out


def texture_image(g, bins, mat_name):
    """A material's base-colour texture as float RGB (h, w, 3) in 0..1 (sRGB bytes / 255)."""
    import io

    from PIL import Image

    mat = next(m for m in g['materials'] if m.get('name') == mat_name)
    ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    img = g['images'][g['textures'][ti]['source']]
    bv = g['bufferViews'][img['bufferView']]
    raw = bins[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    return np.asarray(Image.open(io.BytesIO(raw)).convert('RGB'), float) / 255.0


BARY = np.array([[1/3, 1/3, 1/3], [.7, .15, .15], [.15, .7, .15], [.15, .15, .7],
                 [.45, .45, .1], [.1, .45, .45], [.45, .1, .45]])


def texture_samples(im, uv):
    """Texels (n, 7[, 3]) at 7 barycentric points of each UV triangle (n, 3, 2)."""
    h, w = im.shape[:2]
    pts = np.einsum('sk,nkc->nsc', BARY, uv)
    px = (np.mod(pts[..., 0], 1.0) * (w - 1)).astype(int)
    py = (np.mod(pts[..., 1], 1.0) * (h - 1)).astype(int)
    return im[py, px]


def dark_mask(im, tx):
    """Texture -> 0..1 "is this texel of the picked kind" (luminance / saturation window), box-blurred (`blur` px,
    default 9) so scratches and dirt in the texture do not speckle the cut border."""
    lum = im @ np.array([0.2126, 0.7152, 0.0722])
    sat = im.max(-1) - im.min(-1)
    m = ((lum <= tx.get('maxLum', 1)) & (lum >= tx.get('minLum', 0)) & (sat <= tx.get('maxSat', 1))).astype(float)
    k = int(tx.get('blur', 9))
    if k > 1:
        ker = np.ones(k) / k
        for ax in (0, 1):
            for _ in range(2):
                m = np.apply_along_axis(lambda v: np.convolve(np.pad(v, k // 2, mode='wrap'), ker, 'valid')[:len(v)], ax, m)
    return m


def refine_by_texture(T, uv, mask, tx, min_edge):
    """Split triangles whose texture crosses the dark / light classification (1 -> 4, repeatedly) until edges are
    shorter than min_edge: the carbon / paint border of the original texture becomes a triangle border."""
    while True:
        cls = texture_samples(mask, uv) >= 0.5
        mixed = cls.any(1) & ~cls.all(1)
        edge = np.max([np.linalg.norm(T[:, i] - T[:, (i + 1) % 3], axis=1) for i in range(3)], axis=0)
        split = mixed & (edge > min_edge)
        if not split.any():
            return T, uv
        Ts, Us = T[split], uv[split]
        out_T, out_U = [T[~split]], [uv[~split]]
        m01, m12, m20 = (Ts[:, 0] + Ts[:, 1]) / 2, (Ts[:, 1] + Ts[:, 2]) / 2, (Ts[:, 2] + Ts[:, 0]) / 2
        u01, u12, u20 = (Us[:, 0] + Us[:, 1]) / 2, (Us[:, 1] + Us[:, 2]) / 2, (Us[:, 2] + Us[:, 0]) / 2
        for ta, ua in (((Ts[:, 0], m01, m20), (Us[:, 0], u01, u20)), ((m01, Ts[:, 1], m12), (u01, Us[:, 1], u12)),
                       ((m20, m12, Ts[:, 2]), (u20, u12, Us[:, 2])), ((m01, m12, m20), (u01, u12, u20))):
            out_T.append(np.stack(ta, 1))
            out_U.append(np.stack(ua, 1))
        T, uv = np.concatenate(out_T), np.concatenate(out_U)


def facing_mask(T, facing):
    """True for triangles T (n, 3, 3) whose unit normal components lie in the `facing` ranges."""
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    N /= np.linalg.norm(N, axis=1)[:, None] + 1e-20
    keep = np.ones(len(T), bool)
    for axn, rng in facing.items():
        lo, hi = (rng, 1) if np.isscalar(rng) else rng
        comp = N[:, 'xyz'.index(axn.strip('|'))]
        if axn.startswith('|'):
            comp = np.abs(comp)
        keep &= (comp >= lo) & (comp <= hi)
    return keep


def islands(T):
    """Connected islands of T (triangles sharing a welded vertex): id per triangle, per-island bbox lo / hi and size."""
    _, inv = np.unique(np.round(T.reshape(-1, 3) / 1e-5).astype(np.int64), axis=0, return_inverse=True)
    inv = inv.reshape(-1, 3)
    parent = np.arange(inv.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in inv:
        ra = find(a)
        parent[find(b)] = ra
        parent[find(c)] = ra
    _, iid = np.unique([find(a) for a in inv[:, 0]], return_inverse=True)
    n = iid.max() + 1
    P = T.reshape(-1, 3)
    vid = np.repeat(iid, 3)
    lo = np.full((n, 3), np.inf)
    hi = np.full((n, 3), -np.inf)
    np.minimum.at(lo, vid, P)
    np.maximum.at(hi, vid, P)
    return iid, lo, hi, np.bincount(iid, minlength=n)


def tube_scores(T, iid, n):
    """Per island (ids iid, n islands): best tube score and the radius d it was found at (see the `tube` rule)."""
    _, first, vid = np.unique(np.round(T.reshape(-1, 3) / 1e-5).astype(np.int64), axis=0, return_index=True,
                              return_inverse=True)
    P = T.reshape(-1, 3)[first]
    vid = vid.reshape(-1, 3)
    FN = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])  # area weighted
    VN = np.zeros_like(P)
    for k in range(3):
        np.add.at(VN, vid[:, k], FN)
    VN /= np.linalg.norm(VN, axis=1)[:, None] + 1e-20
    E = np.unique(np.sort(np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]], vid[:, [2, 0]]]), axis=1), axis=0)
    viid = np.zeros(len(P), int)
    viid[vid.ravel()] = np.repeat(iid, 3)
    ei = viid[E[:, 0]]
    L0 = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
    ne = np.maximum(np.bincount(ei, minlength=n), 1)
    best, bestd = np.zeros(n), np.zeros(n)
    for d in np.arange(0.004, 0.05, 0.001):
        for s in (1, -1):  # outward or inward normals
            Q = P - s * d * VN
            L = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1)
            sc = np.bincount(ei, (L < 0.25 * L0).astype(float), minlength=n) / ne
            upd = sc > best
            best[upd], bestd[upd] = sc[upd], d
    return best, bestd


VIEW_AXES = {'front': (0, 1, 2), 'rear': (0, 1, 2), 'left': (2, 1, 0), 'right': (2, 1, 0), 'top': (2, 0, 1)}


def _clip(pts, p, q, inside=True):
    """Sutherland-Hodgman: keep the part of polygon pts (list of 3D points, view axes h, v passed via global) on one side
    of the 2D line p -> q (left side = inside)."""
    h, v = _clip.axes
    out = []
    def side(pt):
        return ((q[0] - p[0]) * (pt[v] - p[1]) - (q[1] - p[1]) * (pt[h] - p[0])) * (1 if inside else -1)
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        sa, sb = side(a), side(b)
        if sa >= 0:
            out.append(a)
        if (sa >= 0) != (sb >= 0):
            out.append(a + (b - a) * (sa / (sa - sb)))
    return out


def region_cut(T, r, off):
    """Clip triangles T (GLB space) along the convex outline r['poly'] (model space); returns (inside, outside) arrays."""
    h, v, d = VIEW_AXES[r['view']]
    polys = [np.array(r['poly'], float)]
    if r.get('mirror'):
        m = polys[0].copy()
        m[:, 0] *= -1
        polys.append(m[::-1])
    inside, outside = [], []
    M = T + off
    for tri_i in range(len(T)):
        tri = M[tri_i]
        pieces_out = [list(tri)]
        pieces_in = []
        for poly in polys:
            area = 0.5 * np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
            if area < 0:
                poly = poly[::-1]
            lo, hi = poly.min(0), poly.max(0)
            _clip.axes = (h, v)
            nxt = []
            for pc in pieces_out:
                a = np.array(pc)
                if a[:, h].max() < lo[0] or a[:, h].min() > hi[0] or a[:, v].max() < lo[1] or a[:, v].min() > hi[1]:
                    nxt.append(pc)
                    continue
                rest = pc
                n = len(poly)
                for i in range(n):
                    p0, p1 = poly[i], poly[(i + 1) % n]
                    out_part = _clip(rest, p0, p1, inside=False)
                    if len(out_part) >= 3:
                        nxt.append(out_part)
                    rest = _clip(rest, p0, p1, inside=True)
                    if len(rest) < 3:
                        rest = []
                        break
                if len(rest) >= 3:
                    pieces_in.append(rest)
            pieces_out = nxt
        for group, dest in ((pieces_in, inside), (pieces_out, outside)):
            for pc in group:
                for k in range(1, len(pc) - 1):
                    t = np.array([pc[0], pc[k], pc[k + 1]])
                    if np.linalg.norm(np.cross(t[1] - t[0], t[2] - t[0])) < 1e-12:
                        continue
                    dest.append(t - off)
    ins = np.array(inside).reshape(-1, 3, 3)
    out = np.array(outside).reshape(-1, 3, 3)
    if 'depth' in r and len(ins):
        dc = (ins + off).mean(1)[:, d]
        ok = (dc >= r['depth'][0]) & (dc <= r['depth'][1])
        out = np.concatenate([out, ins[~ok]])
        ins = ins[ok]
    return ins, out


def arch_mask(T, a):
    """Wheel-arch liner: triangles round an axle (hub line along x at y, one per `axles` z) within `r` of it, at
    least `dy` above the hub, with |x| in `|x|` and the normal pointing at the hub line (radial share >= `toward`)."""
    c = T.mean(1)
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-20
    ax = np.abs(c[:, 0])
    out = np.zeros(len(T), bool)
    for z in a['axles']:
        dy, dz = c[:, 1] - a['y'], c[:, 2] - z
        r = np.hypot(dy, dz)
        toward = -(n[:, 1] * dy + n[:, 2] * dz) / (r + 1e-9)
        out |= (r >= a['r'][0]) & (r <= a['r'][1]) & (toward >= a.get('toward', 0.3)) & (dy >= a.get('dy', -0.05))
    lo, hi = a.get('|x|', [0, 9])
    return out & (ax >= lo) & (ax <= hi)


def near_mask(prims, near, C):
    """True for centroids C (n, 3) within near['d'] of the triangles of near['mat'] (inside the optional x / y / z box)."""
    from scipy.spatial import cKDTree
    pts = []
    for _, mat, _, T in prims:
        if mat != near['mat']:
            continue
        c = T.mean(1)
        k = np.ones(len(T), bool)
        for ax, i in (('x', 0), ('y', 1), ('z', 2)):
            if ax in near:
                k &= (c[:, i] >= near[ax][0]) & (c[:, i] <= near[ax][1])
        if 'facing' in near:
            k &= facing_mask(T, near['facing'])
        T = T[k]
        # barycentric grid over every triangle so big glass triangles sample densely
        w = [(a, b, 1 - a - b) for a in np.linspace(0, 1, 7) for b in np.linspace(0, 1, 7) if a + b <= 1 + 1e-9]
        for a, b, c3 in w:
            pts.append(T[:, 0] * a + T[:, 1] * b + T[:, 2] * c3)
    if not pts:
        return np.zeros(len(C), bool)
    d, _ = cKDTree(np.vstack(pts)).query(C)
    return d <= near['d']


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    cfg = json.load(open(args[0], encoding='utf-8'))
    g, bins = load_glb(args[1])
    prims = primitives(g, bins)
    uvs = primitive_uvs(g, bins) if any('texture' in r or 'uv' in r for r in cfg.get('gltf', {}).get('parts', [])) else None
    if '--list' in sys.argv or len(args) < 3:
        for name, mat, path, T in prims:
            lo, hi = T.reshape(-1, 3).min(0), T.reshape(-1, 3).max(0)
            print(f"{name:14s} {mat:16s} tris={len(T):7d}  x[{lo[0]:7.3f},{hi[0]:7.3f}] "
                  f"y[{lo[1]:6.3f},{hi[1]:6.3f}] z[{lo[2]:7.3f},{hi[2]:7.3f}]  ({' / '.join(path[:-1])})")
        return
    rules = cfg['gltf']
    mats = cfg['parts']['materials']
    drop = set(rules.get('drop', []))
    default = rules.get('default')
    tris, labels, used = [], [], {}
    defaulted = []
    for pi, (name, mat, path, T) in enumerate(prims):
        if drop & set(path) or mat in drop:
            continue
        label = None
        move = None
        c = T.mean(1)
        uvt = uvs[pi] if uvs is not None and uvs[pi] is not None and len(uvs[pi]) == len(T) else None  # UVs aligned with T (None after a region cut)
        im = None
        isl = None  # (island id per triangle, island bbox lo / hi, island size) - computed on first use
        for r in rules['parts']:
            if 'node' in r and name not in ([r['node']] if isinstance(r['node'], str) else r['node']):
                continue
            if 'mat' in r and r['mat'] != mat:
                continue
            if ('texture' in r or 'uv' in r) and uvt is None:
                continue
            if 'region' in r:
                ins, rest = region_cut(T, r['region'], np.array(cfg['offset'], float))
                if len(ins):
                    tris.append(ins)
                    labels.append(np.full(len(ins), mats.index(r['material']), np.uint16))
                    used[r['material']] = used.get(r['material'], 0) + len(ins)
                T = rest
                c = T.mean(1)
                isl = None
                uvt = None
                continue
            keep = np.ones(len(T), bool)
            if r.get('whole') or 'islandTris' in r or 'tube' in r:
                if isl is None:
                    isl = islands(T)
                iid, ilo, ihi, isz = isl
                ok = np.ones(len(isz), bool)
                if 'islandTris' in r:
                    ok &= (isz >= r['islandTris'][0]) & (isz <= r['islandTris'][1])
                if 'tube' in r:
                    tb = r['tube']
                    score, rad = tube_scores(T, iid, len(isz))
                    ok &= (rad >= tb['r'][0]) & (rad <= tb['r'][1]) & (score >= tb.get('score', 0.15))
                    ok &= (ihi - ilo).max(1) >= tb.get('length', 0)
                for ax, k in (('x', 0), ('y', 1), ('z', 2)):
                    if ax in r and r.get('whole'):
                        ok &= (ilo[:, k] >= r[ax][0]) & (ihi[:, k] <= r[ax][1])
                keep &= ok[iid]
            for ax, k in (('x', 0), ('y', 1), ('z', 2)):
                if ax in r and not r.get('whole'):
                    keep &= (c[:, k] >= r[ax][0]) & (c[:, k] <= r[ax][1])
            if 'uv' in r:
                uc = uvt.mean(1)
                u0, u1, v0, v1 = r['uv']
                keep &= (uc[:, 0] >= u0) & (uc[:, 0] <= u1) & (uc[:, 1] >= v0) & (uc[:, 1] <= v1)
            if 'texture' in r:
                tx = r['texture']
                if im is None:
                    im = dark_mask(texture_image(g, bins, mat), tx)
                    h, w = im.shape[:2]
                    for u0, u1, v0, v1 in tx.get('exclude', []):  # logos / emblems drawn in the same dark ink
                        im[int(v0 * h):int(v1 * h), int(u0 * w):int(u1 * w)] = 0
                if tx.get('refine'):
                    # split the box's triangles along the texture border first (T / UVs re-built, other rules see the new list)
                    box = keep.copy()
                    if box.any():
                        Tn, Un = refine_by_texture(T[box], uvt[box], im, tx, tx['refine'])
                        T, uvt = np.concatenate([T[~box], Tn]), np.concatenate([uvt[~box], Un])
                        c = T.mean(1)
                        keep = np.concatenate([np.zeros((~box).sum(), bool), np.ones(len(Tn), bool)])
                        isl = None
                cls = texture_samples(im, uvt) >= 0.5
                keep &= cls.mean(1) >= 0.5
            if 'facing' in r:
                keep &= facing_mask(T, r['facing'])
            if 'near' in r:
                keep &= near_mask(prims, r['near'], c)
            if 'arch' in r:
                keep &= arch_mask(T, r['arch'])
            if not keep.any():
                continue
            if keep.all():
                label = r['material']
                move = r.get('move')
                break
            # box rule: split the primitive - matching triangles now, the rest keep looking
            tris.append(T[keep] + np.array(r.get('move', [0, 0, 0]), float))
            labels.append(np.full(keep.sum(), mats.index(r['material']), np.uint16))
            used[r['material']] = used.get(r['material'], 0) + int(keep.sum())
            T, c = T[~keep], c[~keep]
            if uvt is not None:
                uvt = uvt[~keep]
            if isl is not None:
                isl = (isl[0][~keep],) + isl[1:]
        if label is None:
            if default is None:
                raise SystemExit(f'no gltf.parts rule matches {name} / {mat} - add one or gltf.default')
            label = default
            defaulted.append((name, mat, T))
        if label not in mats:
            raise SystemExit(f'material {label!r} is not in parts.materials')
        tris.append(T if move is None else T + np.array(move, float))
        labels.append(np.full(len(T), mats.index(label), np.uint16))
        used[label] = used.get(label, 0) + len(T)
    T = np.vstack(tris).astype(np.float32)
    L = np.concatenate(labels)
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    N /= np.linalg.norm(N, axis=1)[:, None] + 1e-20
    rec = np.zeros(len(T), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    rec['n'], rec['v'], rec['a'] = N, T, L
    with open(args[2], 'wb') as f:
        f.write(b'parts: STL attribute = material index (glb-to-parts-stl.py)'.ljust(80, b' '))
        f.write(struct.pack('<I', len(T)))
        f.write(rec.tobytes())
    print(f'wrote {args[2]}: {len(T)} triangles')
    for m, n in sorted(used.items(), key=lambda kv: -kv[1]):
        print(f'  {m:12s} {n:8d}')
    report_defaulted(defaulted, default)
    report_discs(T, L, mats)


def report_defaulted(defaulted, default):
    """Primitives that matched no rule and silently became `default`: the place stray source parts hide."""
    if not defaulted:
        return
    print(f'\ndefaulted to {default!r} (no rule matched - check each is really {default}):')
    for name, mat, T in defaulted:
        lo, hi = T.reshape(-1, 3).min(0), T.reshape(-1, 3).max(0)
        print(f'  {name:12s} {mat:14s} tris={len(T):7d}  x[{lo[0]:7.3f},{hi[0]:7.3f}] y[{lo[1]:6.3f},{hi[1]:6.3f}] '
              f'z[{lo[2]:7.3f},{hi[2]:7.3f}]')


def report_discs(T, L, mats):
    """Warn about round flat plates in the output (brake discs, hub caps, wheel faces): the game builds its own."""
    iid, lo, hi, isz = islands(T.astype(np.float64))
    ext = hi - lo
    found = []
    for i in range(len(isz)):
        if isz[i] < 24:
            continue
        thin = int(np.argmin(ext[i]))
        a, b = [ext[i][k] for k in range(3) if k != thin]
        if ext[i][thin] < 0.05 and 0.25 <= min(a, b) and max(a, b) <= 0.7 and max(a, b) / min(a, b) < 1.15:
            lab = np.bincount(L[iid == i]).argmax()
            found.append((mats[lab], isz[i], lo[i], hi[i], 'xyz'[thin]))
    if not found:
        return
    print(f'\nWARNING disc-like islands ({len(found)}): round flat plates, thin axis shown - brake disc / hub cap / wheel face?')
    print('  The game draws its own wheels, discs and calipers: drop these (gltf.drop, node or material name) unless they are body.')
    for mat, n, l, h, ax in found:
        print(f'  {mat:10s} tris={n:5d} thin={ax}  x[{l[0]:7.3f},{h[0]:7.3f}] y[{l[1]:6.3f},{h[1]:6.3f}] z[{l[2]:7.3f},{h[2]:7.3f}]')


if __name__ == '__main__':
    main()
