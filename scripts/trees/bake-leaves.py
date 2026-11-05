"""
Bake the rally trees' photo leaf atlases (src/games/rally/trees/leaves/<style>.webp + <style>-n.webp) and their outlines
(src/games/rally/trees/leaf-photos.data.ts) from the leaf cluster textures of the CC BY 4.0 LOLIPOP Sketchfab packs
(credits: THIRD-PARTY.md). The packs are not in the repository (git-ignored sources/).

  python -I scripts/trees/bake-leaves.py sources/rally/trees-v3.5

Each leaf style is CLUSTER_COLS x CLUSTER_ROWS images in the layout trees/leaftex.ts draws (spec: trees/Foliage.md#sprites):
- a broadleaf / fir image is one leafy spray cut from a pack texture (`STYLES`: rectangle, the stem's base, mirrored or
  not), turned so its stem runs along +x from the base at SPRAY_BASE left of the centre, scaled to fit;
- a pine image is a burst of needle twigs (`PINE_TWIGS`) radiating from the centre.
Colour: each image's mean leaf colour (linear) becomes grey `GAIN` (its hue variation kept within `CHROMA`), so the
sprite's vertex colour (the species palette over `mean`) is what a cluster averages to; seasons come from the palette.
`<style>.webp` = sRGB albedo + alpha; `<style>-n.webp` (half size) = the pack's normal map turned with the image
(x = image right, y = down the rows, OpenGL-style tangent space as the drawn atlas), R / G = x / y, B = thickness
(stacked or shaded leaves and wood: 1, one sunlit leaf: low); z is rebuilt at decode (trees/leafphoto.ts).
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'games', 'rally', 'trees')
OUT_DIR = os.path.join(ROOT, 'leaves')
OUT_DATA = os.path.join(ROOT, 'leaf-photos.data.ts')

COLS, ROWS = 4, 2
ALPHA_TEST = 0.5
# trees/leaftex.ts SPRAY_BASE: a spray's stem starts this share of the image left of its centre.
SPRAY_BASE = 92 / 256
GAIN = 0.62
# A texel's channel / its luminance stays within this of the image's mean leaf hue.
CHROMA = (0.86, 1.16)

PACKS = {
    'oak': 'oak_trees_pack_17var_lods_seasons_gameready.glb',
    'maple': 'maple_trees_pack_lowpoly_game_ready_lods.glb',
    'birch': 'five_birch_trees_pack_lowpoly_lods.glb',
    'bush': 'bush_models_pack_gameready_lods.glb',
    'lilac': 'lilac_bush_pack_12_vars_lods_game_ready.glb',
    'pine': 'pine_trees_pack_lowpoly_game_ready_lods.glb',
    'fir': 'realistic_fir_trees_pack_lods_gameready.glb',
}
MATERIAL = {
    'oak': 'Cluster_Mat',
    'maple': 'Cluster_Mat',
    'birch': 'Birch_Atlas',
    'bush': 'Brunch_material',
    'lilac': 'Brunches_mat',
    'pine': 'Clusters_Mat',
    'fir': 'Brunches_Mat',
}

# Sprays, in the pack texture's pixels (1024 px, y down): (x0, y0, x1, y1) rectangle, stem base (x, y), mirrored.
# Only the parts of the rectangle joined to the base are kept.
S = lambda x0, y0, x1, y1, bx, by, m=False: ((x0, y0, x1, y1), (bx, by), m)  # noqa: E731

STYLES = {
    # Oak, plane: the oak pack's lobed sprays, cut in from their thick log bases.
    'lobed': dict(pack='oak', image=512, scale=0.85, sprays=[
        S(95, 0, 655, 385, 98, 140), S(430, 225, 935, 640, 932, 424), S(90, 450, 700, 1005, 93, 716),
        S(720, 700, 1005, 966, 857, 962), S(95, 0, 655, 385, 98, 140, True), S(430, 225, 935, 640, 932, 424, True),
        S(90, 450, 700, 1005, 93, 716, True), S(720, 700, 1005, 966, 857, 962, True)]),
    # Plane: the maple pack's palmate sprays.
    'palmate': dict(pack='maple', image=512, scale=0.85, sprays=[
        S(550, 8, 940, 492, 775, 16), S(10, 40, 512, 495, 263, 50), S(598, 512, 1006, 812, 995, 635),
        S(50, 518, 566, 1010, 62, 766), S(712, 815, 1010, 1024, 1000, 923), S(550, 8, 940, 492, 775, 16, True),
        S(10, 40, 512, 495, 263, 50, True), S(598, 512, 1006, 812, 995, 635, True)]),
    # Birch, bush, scrub, thicket, locust: the birch pack's small toothed leaves on hanging twigs.
    'small': dict(pack='birch', image=512, scale=0.85, sprays=[
        S(525, 0, 1000, 505, 928, 9), S(0, 525, 447, 1015, 432, 529), S(840, 85, 1000, 470, 893, 93),
        S(530, 10, 870, 380, 860, 130), S(300, 600, 445, 1010, 336, 690), S(20, 610, 350, 790, 345, 660),
        S(525, 0, 1000, 505, 928, 9, True), S(0, 525, 447, 1015, 432, 529, True)]),
    # Beech, sapling: the bush pack's ovate leaves, whole sprays.
    'ovate': dict(pack='bush', image=512, scale=0.85, sprays=[
        S(9, 0, 486, 458, 237, 4), S(536, 0, 988, 500, 730, 4), S(519, 504, 1024, 1006, 1021, 705),
        S(0, 561, 511, 1016, 3, 688), S(9, 0, 486, 458, 237, 4, True), S(536, 0, 988, 500, 730, 4, True),
        S(519, 504, 1024, 1006, 1021, 705, True), S(0, 561, 511, 1016, 3, 688, True)]),
    # Walnut, fruit trees, poplar: the bush pack's forks, so the broad leaves are larger.
    'round': dict(pack='bush', image=512, scale=1.1, sprays=[
        S(20, 40, 225, 445, 222, 66), S(240, 60, 470, 445, 246, 70), S(530, 20, 722, 480, 712, 52),
        S(722, 40, 965, 445, 737, 52), S(590, 705, 945, 985, 918, 712), S(40, 700, 300, 985, 62, 702),
        S(60, 550, 500, 705, 104, 676), S(515, 500, 1000, 705, 1000, 692)]),
    # Hornbeam, hazel, bramble: the lilac pack's leaves (its panicles cut out).
    'serrate': dict(pack='lilac', image=512, scale=0.95, flowers=True, sprays=[
        S(360, 16, 1024, 484, 1020, 218), S(682, 455, 997, 686, 690, 594), S(0, 496, 667, 1008, 3, 766),
        S(755, 754, 1024, 990, 1020, 882), S(0, 250, 282, 340, 3, 262), S(0, 358, 252, 436, 3, 378),
        S(360, 16, 1024, 484, 1020, 218, True), S(0, 496, 667, 1008, 3, 766, True)]),
}

# Pine bursts: needle twigs (rectangle, base) of the pine pack, laid round the image's centre.
PINE_TWIGS = [
    S(826, 404, 998, 669, 968, 662), S(711, 638, 1024, 818, 1020, 786), S(570, 820, 1024, 1009, 1016, 955),
    S(15, 135, 255, 560, 130, 555), S(150, 585, 310, 965, 212, 592), S(560, 300, 790, 600, 600, 560),
]
PINE_IMAGE = 256


def load_texture(path, material, slot):
    data = open(path, 'rb').read()
    n = struct.unpack_from('<I', data, 12)[0]
    g = json.loads(data[20:20 + n])
    binary = data[20 + n + 8:]
    m = next(x for x in g['materials'] if x['name'] == material)
    t = m['pbrMetallicRoughness']['baseColorTexture']['index'] if slot == 'color' else m['normalTexture']['index']
    im = g['images'][g['textures'][t]['source']]
    bv = g['bufferViews'][im['bufferView']]
    off = bv.get('byteOffset', 0)
    out = Image.open(io.BytesIO(binary[off:off + bv['byteLength']]))
    return np.asarray(out.convert('RGBA' if slot == 'color' else 'RGB')).astype(np.float64) / 255


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


class Source:
    """A pack's leaf texture: premultiplied linear colour, alpha, and its tangent-space normal (x right, y down)."""

    def __init__(self, folder, pack, flowers=False):
        path = os.path.join(folder, PACKS[pack])
        col = load_texture(path, MATERIAL[pack], 'color')
        nor = load_texture(path, MATERIAL[pack], 'normal')
        a = col[..., 3].copy()
        rgb = lin(col[..., :3])
        if flowers:
            # Lilac panicles (pink-violet: blue and red over green) are not leaves.
            r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
            a[(b > g * 0.9) & (r > g * 0.85) & (a > 0)] = 0
        self.a = a
        self.rgb = rgb * a[..., None]
        # glTF normal maps: +y up the image; ours run down the rows.
        n = nor * 2 - 1
        self.n = np.stack([n[..., 0], -n[..., 1]], -1) * a[..., None]


def spray_frame(src, rect, base):
    """Mask of the rectangle's parts joined to the base, the snapped base and the spray's axis angle (to its centroid)."""
    x0, y0, x1, y1 = rect
    mask = np.zeros_like(src.a, bool)
    mask[y0:y1, x0:x1] = src.a[y0:y1, x0:x1] > 0.3
    lab, _ = ndimage.label(ndimage.binary_dilation(mask, iterations=3))
    bx, by = base
    ys, xs = np.nonzero(mask[max(0, by - 24):by + 25, max(0, bx - 24):bx + 25])
    if not len(xs):
        raise SystemExit(f'no opaque texel near base {base}')
    xs = xs + max(0, bx - 24)
    ys = ys + max(0, by - 24)
    k = np.argmin((xs - bx) ** 2 + (ys - by) ** 2)
    near = ((xs - xs[k]) ** 2 + (ys - ys[k]) ** 2) <= 36
    sx, sy = xs[near].mean(), ys[near].mean()
    keep = lab == lab[ys[k], xs[k]]
    mask &= keep
    yy, xx = np.nonzero(mask)
    w = src.a[yy, xx]
    cx, cy = (xx * w).sum() / w.sum(), (yy * w).sum() / w.sum()
    return mask, (sx, sy), np.arctan2(cy - sy, cx - sx)


def render(src, mask, base, angle, mirror, size, at, turn, scale, ss=3, cut=0.0):
    """Resample the masked spray: its base to `at` (px of a `size` image), its axis turned to `turn`, `scale` px / px;
    the first `cut` source px along the axis (a bare twig foot) left out."""
    a = src.a * mask
    acc = np.zeros((size, size, 6))
    oy, ox = np.mgrid[0:size, 0:size].astype(np.float64)
    ct, st = np.cos(turn), np.sin(turn)
    ca, sa = np.cos(angle), np.sin(angle)
    m = -1.0 if mirror else 1.0
    for j in range(ss):
        for i in range(ss):
            # Output -> spray frame (q: along the axis, across) -> source.
            px = ox + (i + 0.5) / ss - at[0]
            py = oy + (j + 0.5) / ss - at[1]
            qx = (px * ct + py * st) / scale
            qy = (-px * st + py * ct) / scale * m
            sx = base[0] + qx * ca - qy * sa - 0.5
            sy = base[1] + qx * sa + qy * ca - 0.5
            co = [sy, sx]
            keep = np.clip((qx - cut) / 6 + 1, 0, 1) if cut > 0 else 1.0
            al = ndimage.map_coordinates(a, co, order=1, mode='constant') * keep
            mk = ndimage.map_coordinates(mask.astype(np.float64), co, order=1, mode='constant') * keep
            acc[..., 0] += al
            for c in range(3):
                acc[..., 1 + c] += ndimage.map_coordinates(src.rgb[..., c], co, order=1, mode='constant') * mk
            # The normal turns with the image: spray frame -> output, mirrored across the axis.
            nx = ndimage.map_coordinates(src.n[..., 0], co, order=1, mode='constant') * mk
            ny = ndimage.map_coordinates(src.n[..., 1], co, order=1, mode='constant') * mk
            fx = nx * ca + ny * sa
            fy = (-nx * sa + ny * ca) * m
            acc[..., 4] += fx * ct - fy * st
            acc[..., 5] += fx * st + fy * ct
    return acc / (ss * ss)


def fit_scale(src, mask, base, angle, size, max_scale):
    yy, xx = np.nonzero(mask)
    dx, dy = xx + 0.5 - base[0], yy + 0.5 - base[1]
    along = dx * np.cos(angle) + dy * np.sin(angle)
    across = -dx * np.sin(angle) + dy * np.cos(angle)
    room = (1 - (0.5 - SPRAY_BASE)) * size - 3
    s = min(max_scale, room / max(along.max(), 1), (0.5 * size - 3) / max(np.abs(across).max(), 1))
    back = -along.min()
    if back > 0:
        s = min(s, ((0.5 - SPRAY_BASE) * size - 3) / back)
    return s


def over(dst, src):
    """Composite premultiplied `src` over `dst` (alpha, rgb, normal)."""
    k = 1 - src[..., :1]
    return src + dst * k


def finish(img):
    """Premultiplied image -> albedo (linear, mean leaf hue grey GAIN), alpha, normal xy, thickness, wood mask."""
    a = np.clip(img[..., 0], 0, 1)
    safe = np.maximum(a, 1e-6)[..., None]
    rgb = img[..., 1:4] / safe
    n = img[..., 4:6] / safe
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sat = (rgb.max(-1) - rgb.min(-1)) / np.maximum(rgb.max(-1), 1e-6)
    solid = a >= ALPHA_TEST
    wood = solid & (rgb[..., 1] < rgb[..., 0] * 1.08) & (sat < 0.45)
    leaf = solid & ~wood
    mean = (rgb[leaf] * a[leaf][:, None]).sum(0) / a[leaf].sum()
    ratio = rgb / mean
    rl = ratio @ np.array([0.2126, 0.7152, 0.0722])
    ratio = np.clip(ratio, rl[..., None] * CHROMA[0], rl[..., None] * CHROMA[1])
    # Stacked leaves are dark and dense: thickness from the local cover and the shade.
    dense = ndimage.gaussian_filter(a, 2.5)
    dark = np.clip(1 - lum / max(np.percentile(lum[leaf], 90), 1e-6), 0, 1)
    thick = np.clip(0.15 + 0.55 * dark + 0.35 * dense, 0, 1)
    thick[wood] = 1
    return ratio, a, n, thick, wood


def fill(rgb, a):
    """Spread colour into the transparent texels around the leaves (the bilinear edge of an alpha-tested texel)."""
    w = (a >= ALPHA_TEST).astype(np.float64)
    out = rgb.copy()
    cur = w.copy()
    for _ in range(4):
        s = ndimage.uniform_filter(cur, 3)
        c = np.stack([ndimage.uniform_filter(out[..., k] * cur, 3) for k in range(3)], -1)
        grow = (cur == 0) & (s > 0)
        out[grow] = c[grow] / s[grow][:, None]
        cur = np.maximum(cur, grow.astype(np.float64))
    return out


def outline(alpha, size):
    """trees/leaftex.ts `outline`: 8-direction bounding polygon of the texels passing ALPHA_TEST, grown by a texel."""
    ys, xs = np.nonzero(alpha >= round(ALPHA_TEST * 255))
    u0, u1 = xs / size, (xs + 1) / size
    v0, v1 = ys / size, (ys + 1) / size
    x0, x1, y0, y1 = u0.min(), u1.max(), v0.min(), v1.max()
    s0, s1 = (u0 + v0).min(), (u1 + v1).max()
    d0, d1 = (u0 - v1).min(), (u1 - v0).max()
    m = 1 / size
    x0, y0, s0, d0 = x0 - m, y0 - m, s0 - m, d0 - m
    x1, y1, s1, d1 = x1 + m, y1 + m, s1 + m, d1 + m
    raw = [(s0 - y0, y0), (d1 + y0, y0), (x1, x1 - d1), (x1, s1 - x1), (s1 - y1, y1), (d0 + y1, y1), (x0, x0 - d0),
           (x0, s0 - x0)]
    raw = [(min(1.0, max(0.0, x)), min(1.0, max(0.0, y))) for x, y in raw]
    out = []
    same = lambda p, q: abs(p[0] - q[0]) < 1e-6 and abs(p[1] - q[1]) < 1e-6  # noqa: E731
    for p in raw:
        if not out or not same(out[-1], p):
            out.append(p)
    if len(out) > 1 and same(out[0], out[-1]):
        out.pop()
    return [[round(x, 4), round(y, 4)] for x, y in out]


def spray_images(src, spec):
    size = spec['image']
    at = ((0.5 - SPRAY_BASE) * size, 0.5 * size)
    out = []
    for rect, base, mirror in spec['sprays']:
        mask, b, ang = spray_frame(src, rect, base)
        s = fit_scale(src, mask, b, ang, size, spec['scale'] * size / 512)
        out.append(render(src, mask, b, ang, mirror, size, at, 0.0, s))
    return out


def pine_images(src):
    """Needle bursts: 7-10 twig ends (their bare feet cut off) radiating from the centre in a seeded order, so the
    middle is needles, not wood."""
    size = PINE_IMAGE
    rng = np.random.default_rng(1717)
    twigs = [spray_frame(src, rect, base) for rect, base, _ in PINE_TWIGS]
    lengths = []
    for mask, b, ang in twigs:
        yy, xx = np.nonzero(mask)
        lengths.append(np.max((xx - b[0]) * np.cos(ang) + (yy - b[1]) * np.sin(ang)))
    out = []
    for _ in range(COLS * ROWS):
        n = int(rng.integers(7, 11))
        img = np.zeros((size, size, 6))
        start = rng.random() * 2 * np.pi
        layers = []
        for k in range(n):
            t = start + 2 * np.pi * (k + 0.4 * (rng.random() - 0.5)) / n
            j = int(rng.integers(len(twigs)))
            mask, b, ang = twigs[j]
            cut = lengths[j] * (0.2 + 0.15 * rng.random())
            reach = size * (0.3 + 0.16 * rng.random())
            s = reach / (lengths[j] - cut)
            r0 = size * 0.03 * rng.random()
            # The cut foot ends near the centre.
            at = (size / 2 + (r0 - cut * s) * np.cos(t), size / 2 + (r0 - cut * s) * np.sin(t))
            layers.append((rng.random(), (mask, b, ang, bool(rng.random() < 0.5), at, t, s, cut)))
        for _, (mask, b, ang, m, at, t, s, cut) in sorted(layers, key=lambda x: x[0]):
            img = over(img, render(src, mask, b, ang, m, size, at, t, s, cut=cut))
        out.append(img)
    return out


def bake_style(style, images):
    size = images[0].shape[0]
    W, H = size * COLS, size * ROWS
    albedo = np.zeros((H, W, 4), np.uint8)
    normal = np.zeros((H, W, 3), np.float64)
    finished = [finish(img) for img in images]
    # One gain for the style: the brightest texels (wood, sunlit leaves) stay under 1.
    top = max(np.percentile((r * GAIN)[a >= ALPHA_TEST].max(-1), 99.7) for r, a, _, _, _ in finished)
    gain = GAIN / max(1.0, top)
    outlines = []
    for i, (ratio, a, n, thick, wood) in enumerate(finished):
        oy, ox = (i // COLS) * size, (i % COLS) * size
        col = fill(np.clip(ratio * gain, 0, 1), a)
        a8 = np.round(a * 255).astype(np.uint8)
        albedo[oy:oy + size, ox:ox + size, :3] = np.round(srgb(col) * 255).astype(np.uint8)
        albedo[oy:oy + size, ox:ox + size, 3] = a8
        normal[oy:oy + size, ox:ox + size] = np.dstack([np.clip(n, -1, 1), thick])
        outlines.append(outline(a8, size))
    # The mean the sprites' vertex colour divides by: linear luminance of the opaque texels, as shipped.
    solid = albedo[..., 3] >= round(ALPHA_TEST * 255)
    shade = lin(albedo[..., :3][solid] / 255) @ np.array([0.2126, 0.7152, 0.0722])
    mean = float(shade.mean())
    os.makedirs(OUT_DIR, exist_ok=True)
    Image.fromarray(albedo, 'RGBA').save(os.path.join(OUT_DIR, f'{style}.webp'), quality=88, method=6, alpha_quality=100)
    nrm = np.round(np.dstack([normal[..., :2] * 0.5 + 0.5, normal[..., 2:]]) * 255).astype(np.uint8)
    half = Image.fromarray(nrm, 'RGB').resize((W // 2, H // 2), Image.BOX)
    half.save(os.path.join(OUT_DIR, f'{style}-n.webp'), quality=90, method=6)
    print(f'{style}: {W}x{H}, mean {mean:.3f}, gain {gain:.3f}')
    return {'image': size, 'mean': round(mean, 4), 'outlines': outlines}


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join('sources', 'rally', 'trees-v3.5')
    data = {}
    for style, spec in STYLES.items():
        src = Source(folder, spec['pack'], spec.get('flowers', False))
        data[style] = bake_style(style, spray_images(src, spec))
    data['pine'] = bake_style('pine', pine_images(Source(folder, 'pine')))
    lines = [
        '// Generated by scripts/trees/bake-leaves.py from the CC BY 4.0 LOLIPOP packs (THIRD-PARTY.md). Do not edit.',
        "import type { LeafPhoto } from './leaftex';",
        '',
        '/** Per photo leaf style: image size (px), mean linear shade of its opaque texels, outline per image. */',
        'export const LEAF_PHOTOS: Readonly<Record<string, LeafPhoto>> = {',
    ]
    for style, d in data.items():
        lines.append(f'  {style}: {{')
        lines.append(f"    image: {d['image']},")
        lines.append(f"    mean: {d['mean']},")
        lines.append('    outlines: [')
        for o in d['outlines']:
            lines.append('      ' + json.dumps(o, separators=(', ', ': ')).replace('[[', '[\n        [').replace('], [', '],\n        [').replace(']]', '],\n      ],'))
        lines.append('    ],')
        lines.append('  },')
    lines.append('};')
    with open(OUT_DATA, 'w', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
