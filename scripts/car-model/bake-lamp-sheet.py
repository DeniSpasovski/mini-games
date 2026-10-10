"""Bake a GLB car's own lamp textures into lamp space: one PNG sheet for `part-materials.ts`.

    python scripts/car-model/bake-lamp-sheet.py <car>/model.source.json

For source models whose lamps are real geometry with their own (photo) texture. The converter throws source UVs away and
gives lamp parts `parts.wrap` 'corner' UVs (u = |x| - |z| from the car's centre outwards, v = y from the top down, fitted
0..1 over the part, stl-to-glb.mjs). This script draws each lamp's source triangles into exactly that space, sampling the
source texture, so the game lamp shows the model's own art. Config (`lampSheet` in model.source.json):

    "lampSheet": {
      "file": "public/models/cars/<car>_lamps.png",
      "pxPerMetre": 600,
      "lamps": [{"name": "head", "nodes": ["headlight_headlights_0", "headlight.001_headlights_0"]}, ...]   # both sides' nodes
    }

Lamps are packed left to right; the script prints each rectangle (x, y, w, h px) for the material's sheet table. The sheet
has three rows, one under the other at the printed pitch: base colour, emissive (black if the material has none) and normal
map (turned into the lamp's UV frame: green = +v, down the sheet). Both sides
share the UVs (|x|): the fit spans both, only the left lamp (x > 0) is drawn. Triangles are painted back to front by how much they face outwards
(round the corner), so the lens wins over the housing behind it.
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('g2s', os.path.join(HERE, 'glb-to-parts-stl.py'))
g2s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g2s)


ROWS = ('base', 'emissive', 'normal')  # sheet rows, top to bottom


def corner(T):
    """Corner-wrap coordinates (u = |x| - |z|, v = y) in metres, as stl-to-glb.mjs `partUv`."""
    return np.stack([np.abs(T[..., 0]) - np.abs(T[..., 2]), T[..., 1]], -1)


def texture(g, bins, mat_name, slot):
    """A material's texture as float RGB (h, w, 3) in 0..1, or None. slot: 'base', 'emissive' or 'normal'."""
    if slot == 'base':
        return g2s.texture_image(g, bins, mat_name)
    import io

    mat = next(m for m in g['materials'] if m.get('name') == mat_name)
    ref = mat.get({'emissive': 'emissiveTexture', 'normal': 'normalTexture'}[slot])
    if ref is None:
        return None
    img = g['images'][g['textures'][ref['index']]['source']]
    bv = g['bufferViews'][img['bufferView']]
    raw = bins[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    return np.asarray(Image.open(io.BytesIO(raw)).convert('RGB'), float) / 255.0


def frames(T, uv):
    """Per-triangle unit tangent (along +u) and bitangent (along +v, i.e. down the texture) of T (n, 3, 3) for UVs (n, 3, 2)."""
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    d1, d2 = uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]
    det = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)[:, None]
    t = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / det
    b = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / det
    return t, b


def ortho(v, n):
    v = v - n * (v * n).sum(1)[:, None]
    return v / (np.linalg.norm(v, axis=1)[:, None] + 1e-12)


def bake(T, UV, texs, W, H, lo, hi):
    """T (n, 3, 3) model-space triangles, UV (n, 3, 2) source UVs -> one (H, W, 3) image per source texture, in corner space
    fitted to lo..hi. texs: [(slot, image or None)]. A 'normal' map (glTF: green = up the texture) is turned from the source UV
    frame into the lamp's (green = +v, down the sheet: three.js derivative tangents with flipY off)."""
    P = corner(T)
    px = np.empty_like(P)
    px[..., 0] = (P[..., 0] - lo[0]) / (hi[0] - lo[0]) * W
    px[..., 1] = (hi[1] - P[..., 1]) / (hi[1] - lo[1]) * H
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-12
    c = T.mean(1)
    out_dir = np.stack([np.sign(c[:, 0]) * 0.6, np.zeros(len(c)), np.sign(c[:, 2])], -1)
    n *= np.where((n * out_dir).sum(1) < 0, -1.0, 1.0)[:, None]  # outward
    order = np.argsort((n * out_dir).sum(1))  # inward-facing first, lens last
    ts, bs = frames(T, UV)
    tt, bt = frames(T, px)
    ts, bs, tt, bt = ortho(ts, n), ortho(bs, n), ortho(tt, n), ortho(bt, n)
    imgs = [np.zeros((H, W, 3)) for _ in texs]
    for (slot, _), img in zip(texs, imgs):
        if slot == 'normal':
            img[:] = (0.5, 0.5, 1.0)
    filled = np.zeros((H, W), bool)
    for t in order:
        a, b, cc = px[t]
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), cc)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), cc)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        q = np.stack([xs + 0.5, ys + 0.5], -1)
        d = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
        if abs(d) < 1e-9:
            continue
        l0 = ((b[1] - cc[1]) * (q[..., 0] - cc[0]) + (cc[0] - b[0]) * (q[..., 1] - cc[1])) / d
        l1 = ((cc[1] - a[1]) * (q[..., 0] - cc[0]) + (a[0] - cc[0]) * (q[..., 1] - cc[1])) / d
        l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not m.any():
            continue
        uv = l0[m, None] * UV[t, 0] + l1[m, None] * UV[t, 1] + l2[m, None] * UV[t, 2]
        for (slot, tex), img in zip(texs, imgs):
            if tex is None:
                continue
            th, tw = tex.shape[:2]
            v = tex[(np.mod(uv[:, 1], 1) * (th - 1)).astype(int), (np.mod(uv[:, 0], 1) * (tw - 1)).astype(int)]
            if slot == 'normal':
                k = v * 2 - 1
                w = k[:, :1] * ts[t] - k[:, 1:2] * bs[t] + k[:, 2:3] * n[t]  # source frame -> model space
                v = np.stack([(w * tt[t]).sum(1), (w * bt[t]).sum(1), (w * n[t]).sum(1)], -1)
                v = v / (np.linalg.norm(v, axis=1)[:, None] + 1e-12) * 0.5 + 0.5
            img[ys[m], xs[m]] = v
        filled[ys[m], xs[m]] = True
    # Grow the art into unfilled texels (mip / filtering bleed at the part's edge).
    for _ in range(4):
        if filled.all():
            break
        take_all = np.zeros_like(filled)
        grown = [im.copy() for im in imgs]
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1)
            take = ~filled & ~take_all & sh
            for im, gi in zip(imgs, grown):
                gi[take] = np.roll(np.roll(im, dy, 0), dx, 1)[take]
            take_all |= take
        imgs, filled = grown, filled | take_all
    return imgs


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    ls = cfg['lampSheet']
    g, bins = g2s.load_glb(cfg['source'].split(' ')[0])
    prims = g2s.primitives(g, bins)
    uvs = g2s.primitive_uvs(g, bins)
    s, off = cfg['scale'], np.array(cfg['offset'], float)
    k = ls.get('pxPerMetre', 600)
    tiles, x = [], 0
    for lamp in ls['lamps']:
        Ts, Us, mat = [], [], None
        for (name, m, _path, T), UV in zip(prims, uvs):
            if name in lamp['nodes'] and UV is not None:
                Ts.append(T * s + off)
                Us.append(UV)
                mat = m
        if not Ts:
            raise SystemExit(f"lampSheet: no source primitive for {lamp['name']}")
        T, UV = np.concatenate(Ts), np.concatenate(Us)
        # Fit over both sides (as the converter does), draw the left lamp only.
        P = corner(T).reshape(-1, 2)
        lo, hi = P.min(0), P.max(0)
        span = hi - lo
        left = T[..., 0].mean(1) > 0
        W, H = max(16, int(span[0] * k)), max(16, int(span[1] * k))
        texs = [(slot, texture(g, bins, mat, slot)) for slot in ROWS]
        tiles.append((x, W, H, bake(T[left], UV[left], texs, W, H, lo, hi)))
        print(f"{lamp['name']}: {{ x: {x}, y: 0, w: {W}, h: {H} }}  ({span[0]:.3f} x {span[1]:.3f} m, {len(T)} triangles)")
        x += W
    row = max(t[2] for t in tiles)
    sheet = np.zeros((row * len(ROWS), x, 3))
    for r, slot in enumerate(ROWS):
        if slot == 'normal':
            sheet[r * row:(r + 1) * row] = (0.5, 0.5, 1.0)
        for x0, W, H, ims in tiles:
            sheet[r * row:r * row + H, x0:x0 + W] = ims[r]
    Image.fromarray((sheet * 255).clip(0, 255).astype(np.uint8)).save(ls['file'], optimize=True)
    print(f"wrote {ls['file']} ({x} x {sheet.shape[0]}; rows {', '.join(ROWS)}, {row} px apart)")


if __name__ == '__main__':
    main()
