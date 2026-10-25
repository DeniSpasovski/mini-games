"""Where the rally door plate goes on an imported car: prints `model.doorBadge` (z, y, tilt) from its GLB.

    python scripts/car-model/door-plate.py public/models/cars/<car>.glb [--png out.png] [--front z]

The rule (real rally door panels: on the front door's leading part, horizontal along the body, top 7 - 10 cm
under the window - FIA rally sporting regulations, "front door panels"):
- window line = top of the door paint under the front side window (glass + its seal, seen from the side);
- tilt = the window line's slope over the plate's length, so the plate runs parallel to it;
- height: the plate's top edge sits GAP (10 cm) under the window line;
- front edge: FRONT_K (5 cm) behind the front of the door mirror, so the plate starts under the mirror.
  `--front z` sets the front edge instead (a car whose mirror is not on the door's front corner).
Then look at both sides in the car viewer and nudge only for the car's own lines (a moulding, a handle, a crease).

`--png` writes the side view (outermost part per cm cell, left side) with the window line, mirror and plate drawn on it.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltfio import load_glb, primitives  # noqa: E402

# Plate size: cars/shared/rally-badge.ts (BADGE_WIDTH 0.6 m, canvas 768 x 416).
W = 0.6
H = W * 416 / 768
GAP = 0.10
FRONT_K = 0.05
STEP = 0.01


def side_map(path):
    """Outermost hit (x, part index, |normal x|) for rays along -x from the car's left, per (y, z) cell."""
    g, b = load_glb(path)
    names, tris, mats = [], [], []
    for _, m, t in primitives(g, b):
        k = m.split(':')[0]
        if k not in names:
            names.append(k)
        tris.append(t)
        mats.append(np.full(len(t), names.index(k)))
    T = np.concatenate(tris)
    M = np.concatenate(mats)
    keep = T[:, :, 0].max(1) > 0.05
    T, M = T[keep], M[keep]
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    NXT = np.abs(nrm[:, 0]) / (np.linalg.norm(nrm, axis=1) + 1e-12)
    zs = np.arange(-2.4, 2.4, STEP)
    ys = np.arange(0.0, 1.6, STEP)
    X = np.full((len(ys), len(zs)), -9.0)
    MAT = np.full((len(ys), len(zs)), -1)
    NX = np.zeros((len(ys), len(zs)))
    zmin, zmax = T[:, :, 2].min(1), T[:, :, 2].max(1)
    for j, z in enumerate(zs):
        s = (zmin <= z) & (zmax >= z)
        if not s.any():
            continue
        A, B, C, m, nx = T[s, 0], T[s, 1], T[s, 2], M[s], NXT[s]
        d = (B[:, 2] - A[:, 2]) * (C[:, 1] - A[:, 1]) - (C[:, 2] - A[:, 2]) * (B[:, 1] - A[:, 1])
        ok = np.abs(d) > 1e-12
        A, B, C, m, nx, d = A[ok], B[ok], C[ok], m[ok], nx[ok], d[ok]
        Y = ys[:, None]
        u = ((z - A[:, 2]) * (C[:, 1] - A[:, 1]) - (C[:, 2] - A[:, 2]) * (Y - A[:, 1])) / d
        v = ((B[:, 2] - A[:, 2]) * (Y - A[:, 1]) - (z - A[:, 2]) * (B[:, 1] - A[:, 1])) / d
        x = np.where((u >= 0) & (v >= 0) & (u + v <= 1), A[:, 0] + (B[:, 0] - A[:, 0]) * u + (C[:, 0] - A[:, 0]) * v, -9)
        i = x.argmax(1)
        r = np.arange(len(ys))
        X[:, j] = x[r, i]
        hit = X[:, j] > -9
        MAT[:, j] = np.where(hit, m[i], -1)
        NX[:, j] = np.where(hit, nx[i], 0)
    return zs, ys, X, MAT, NX, names


def window_line(zs, ys, MAT, NX, names):
    """Per z: top of the paint under the side windows (nan where there is no side glass)."""
    glass = names.index('glass') if 'glass' in names else -2
    body = names.index('body')
    side = (MAT == glass) & (NX > 0.6) & (ys[:, None] > 0.6)
    belt = np.full(len(zs), np.nan)
    for j in range(len(zs)):
        if not side[:, j].any():
            continue
        i = int(np.argmax(side[:, j]))
        k = i
        while k > 0 and MAT[k - 1, j] != body and i - k < 5:  # down through the seal (<= 5 cm)
            k -= 1
        if MAT[k - 1, j] == body:
            belt[j] = ys[k]
    return belt


def mirror_front(zs, ys, X, belt):
    """z of the mirror's front: the part sticking out past the door skin and reaching above the window line."""
    skin = np.median(X[(ys > 0.5) & (ys < 0.75)][:, (zs > -0.3) & (zs < 0.3)])
    line = np.nanmedian(belt[(zs > -0.5) & (zs < 0.6)])
    band = (ys > line - 0.08) & (ys < line + 0.35)
    out = X[band] > skin + 0.05
    top = np.where(out.any(0), ys[band][::-1][np.argmax(out[::-1], axis=0)], 0)
    cols = np.where(out.any(0) & (top >= line) & (zs > -0.4) & (zs < 1.0))[0]
    return round(float(zs[cols].max()), 2) if len(cols) else None


def fit_line(z, y):
    """Robust line y = a + s z (median of pairwise slopes), then least squares over the points within 1.5 cm of it,
    so a mirror base or a seal corner in the span does not tip the line."""
    i, j = np.triu_indices(len(z), 1)
    dz = z[j] - z[i]
    ok = np.abs(dz) > 0.05
    s = np.median((y[j] - y[i])[ok] / dz[ok])
    a = np.median(y - s * z)
    keep = np.abs(y - (a + s * z)) < 0.015
    s, a = np.polyfit(z[keep], y[keep], 1)
    return a, s


def main():
    path = sys.argv[1]
    opts = dict(zip(sys.argv[2::2], sys.argv[3::2]))
    zs, ys, X, MAT, NX, names = side_map(path)
    belt = window_line(zs, ys, MAT, NX, names)
    mf = mirror_front(zs, ys, X, belt)
    if '--front' in opts:
        front = float(opts['--front'])
    elif mf is not None:
        front = mf + FRONT_K
    else:
        sys.exit('no mirror found: pass --front <z of the plate front edge>')
    zc = front - W / 2
    span = (zs <= front) & (zs >= front - W) & ~np.isnan(belt)
    a, s = fit_line(zs[span], belt[span])
    yc = a + s * zc - GAP - H / 2
    # + tilt = front edge down (the window line rises towards the rear).
    tilt = -np.degrees(np.arctan(s))
    print(f'mirror front z {mf}, window line at the plate centre y {a + s * zc:.3f}, slope {s:+.3f}')
    print(f'doorBadge: {{ z: {zc:.2f}, y: {yc:.2f}, tilt: {tilt:.1f} }}')
    if '--png' in opts:
        from PIL import Image, ImageDraw

        pal = np.array([(200, 60, 60), (80, 80, 80), (60, 140, 220), (230, 200, 40), (40, 180, 90), (200, 90, 200),
                        (240, 140, 40), (120, 220, 220), (150, 100, 60), (255, 255, 255), (100, 100, 200), (30, 30, 30)])
        img = pal[MAT % len(pal)] * np.clip((X - 0.3) / 0.6, 0.3, 1)[..., None]
        img[MAT < 0] = 255
        k = 3
        im = Image.fromarray(img[::-1, ::-1].astype(np.uint8)).resize((len(zs) * k, len(ys) * k), Image.NEAREST)
        dr = ImageDraw.Draw(im)

        def px(z, y):
            return ((zs[-1] - z) / STEP * k, (ys[-1] - y) / STEP * k)

        for z in zs[span]:
            dr.point(px(z, a + s * z), fill=(255, 255, 0))
        if mf is not None:
            dr.line([px(mf, 0.5), px(mf, 1.3)], fill=(255, 0, 255))
        corners = [(front, 1), (front - W, 1), (front - W, 0), (front, 0)]
        dr.polygon([px(z, a + s * z - GAP - H * (1 - t)) for z, t in corners], outline=(0, 255, 0))
        im.save(opts['--png'])


if __name__ == '__main__':
    main()
