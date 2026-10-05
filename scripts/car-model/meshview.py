"""Shared helpers for the car-model Python tools: orthographic shaded views with a metre grid.

Views look at the car in model space (x = left, y = up, z = nose). Every view names its two
picture axes in MODEL coordinates (so crops, grid labels and seed picks all use the same
numbers, whatever way the picture is flipped):

    front / rear   -> (x, y)      left / right -> (z, y)      top / bottom -> (z, x)
"""
import numpy as np
from PIL import Image, ImageDraw

# view -> (horizontal axis, screen sign), (vertical axis, screen sign), (depth axis, sign towards viewer)
VIEWS = {
    'front': ((0, -1), (1, 1), (2, 1)),
    'rear': ((0, 1), (1, 1), (2, -1)),
    'left': ((2, -1), (1, 1), (0, 1)),
    'right': ((2, 1), (1, 1), (0, -1)),
    'top': ((2, -1), (0, -1), (1, 1)),
    'bottom': ((2, -1), (0, 1), (1, -1)),
}
LIGHT = np.array([0.35, 0.6, 0.7]) / np.linalg.norm([0.35, 0.6, 0.7])


def normals(T):
    """Unit normals + areas of triangles T (n, 3, 3)."""
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    L = np.linalg.norm(N, axis=1)
    return N / (L[:, None] + 1e-20), L / 2


def render(T, N, col, view, out, crop=None, scale=400, grid=0.1):
    """Painter's-algorithm render of triangles T with per-triangle RGB `col`.

    crop = [a0, a1, b0, b1] in model coordinates of the view's two axes; grid = line spacing (m).
    """
    (h, hs), (v, vs), (d, ds) = VIEWS[view]
    if crop is None:
        crop = [T[..., h].min() - 0.05, T[..., h].max() + 0.05,
                T[..., v].min() - 0.05, T[..., v].max() + 0.05]
    a0, a1, b0, b1 = crop
    W = int((a1 - a0) * scale)
    Hh = int((b1 - b0) * scale)
    # screen x grows with model h when hs > 0, else flipped (same for y, which grows downwards)
    sx = lambda a: (a - a0) * scale if hs > 0 else (a1 - a) * scale
    sy = lambda b: (b1 - b) * scale if vs > 0 else (b - b0) * scale
    img = Image.new('RGB', (W, Hh), (40, 40, 44))
    dr = ImageDraw.Draw(img)
    shade = 0.5 + 0.5 * np.clip(np.abs(N @ LIGHT), 0, 1)
    A, B, D = T[..., h], T[..., v], T[..., d] * ds
    vis = (N[:, d] * ds > -0.05) & (A.max(1) > a0) & (A.min(1) < a1) & (B.max(1) > b0) & (B.min(1) < b1)
    idx = np.flatnonzero(vis)
    idx = idx[np.argsort(D[idx].mean(1))]
    for t in idx:
        pts = [(sx(A[t, k]), sy(B[t, k])) for k in range(3)]
        dr.polygon(pts, fill=tuple(int(x) for x in col[t] * shade[t]))
    fmt = '{:.1f}' if grid >= 0.1 else '{:.2f}'
    major = lambda k: abs(k * grid * 2 - round(k * grid * 2)) < 1e-6  # every 0.5 m
    for k in range(int(np.floor(a0 / grid)), int(np.ceil(a1 / grid)) + 1):
        px = sx(k * grid)
        dr.line([(px, 0), (px, Hh)], fill=(255, 60, 60) if major(k) else (110, 40, 40))
        dr.text((px + 2, 2), fmt.format(k * grid), fill=(255, 220, 120))
    for k in range(int(np.floor(b0 / grid)), int(np.ceil(b1 / grid)) + 1):
        py = sy(k * grid)
        dr.line([(0, py), (W, py)], fill=(255, 60, 60) if major(k) else (110, 40, 40))
        dr.text((2, py + 2), fmt.format(k * grid), fill=(120, 220, 255))
    dr.text((W - 150, Hh - 14), f'{view}: {"xyz"[h]} across, {"xyz"[v]} up', fill=(255, 255, 255))
    img.save(out)
    return img.size


def pick(T, N, view, a, b):
    """Index of the triangle seen at model coordinates (a, b) of `view` (front-most), or -1."""
    (h, _), (v, _), (d, ds) = VIEWS[view]
    P = T[..., [h, v]]
    p = np.array([a, b])
    v0, v1, v2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0], p - P[:, 0]
    den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
    ok = np.abs(den) > 1e-14
    den = np.where(ok, den, 1)
    u = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / den
    w = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / den
    hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (N[:, d] * ds > 0.02)
    idx = np.flatnonzero(hit)
    if not len(idx):
        return -1
    depth = (T[idx, 0, d] + u[idx] * (T[idx, 1, d] - T[idx, 0, d]) + w[idx] * (T[idx, 2, d] - T[idx, 0, d])) * ds
    return int(idx[np.argmax(depth)])


def hex_rgb(c):
    return [int(c[k:k + 2], 16) for k in (1, 3, 5)]
