"""
Aerial photo of a stage area on the game's own grid, to compare with a top-down render of the map.

    python scripts/realmap/satellite.py scripts/realmap/jackie.json --box -500 500 -500 500 --mpp 0.5
    python scripts/realmap/satellite.py scripts/realmap/vodno.json --image sources/maps/vodno/ortho/sheet.tif --box ...

Writes sources/maps/<id>/satellite/<source>-<box>-<mpp>.png (git-ignored, never committed or served): north-up,
`mpp` metres per pixel, pixel (i, j) = world (x0 + i * mpp, z0 + j * mpp), the same +X east / +Z south
projection as the bake and `worldToGeo`. Sources: `usgs` tiles (USGS National Map imagery, US only, public domain;
cached in scripts/realmap/.cache/tiles/) or `--image`: a downloaded orthophoto with its world file (.tfw / .jgw /
.pgw / .wld) in `--epsg` (default 6316, the North Macedonian national grid of the cadastre agency's orthophotos; needs
pyproj). Tracing rules and credits: AGENTS.md "Reference material". Compare with `scripts/realmap/overlay.py`.
"""

import argparse
import json
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, ".cache", "tiles")

SOURCES = {
    "usgs": "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
}
MAX_ZOOM = {"usgs": 16}


def metres_per_degree(lat):
    """Same constants as worldToGeo (world/real-data.ts) and bake.py."""
    p = math.radians(lat)
    my = 111132.92 - 559.82 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
    mx = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p)
    return mx, my


def world_to_geo(origin, x, z):
    mx, my = metres_per_degree(origin[0])
    return origin[0] - z / my, origin[1] + x / mx


def merc_px(lat, lon, zoom):
    """WGS84 -> web mercator pixel (256 px tiles) at the zoom."""
    n = 256 * 2**zoom
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def fetch(source, z, x, y):
    path = os.path.join(CACHE, source, str(z), str(x), f"{y}.jpg")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = SOURCES[source].format(z=z, x=x, y=y)
        req = urllib.request.Request(url, headers={"User-Agent": "mini-games-stage-check"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    print(f"tile {z}/{x}/{y} failed: {e}", file=sys.stderr)
                    return None
        with open(path, "wb") as f:
            f.write(data)
    try:
        return np.asarray(Image.open(path).convert("RGB"))
    except Exception:  # noqa: BLE001
        return None


def from_tiles(source, lats, lons, mpp, origin, z0, z1, my, w, h):
    """Mosaic of web-mercator tiles sampled at the lat / lon grid (separable: lats per row, lons per column)."""
    # Zoom: finest tile pixel not coarser than the output pixel, capped by the source.
    lat_mid = origin[0] - (z0 + z1) / 2 / my
    zoom = int(math.ceil(math.log2(156543.03 * math.cos(math.radians(lat_mid)) / mpp)))
    zoom = max(1, min(zoom, MAX_ZOOM[source]))

    px0 = np.array([merc_px(lats[0], lon, zoom)[0] for lon in (lons[0], lons[-1])])
    py0 = np.array([merc_px(lat, lons[0], zoom)[1] for lat in (lats[0], lats[-1])])
    tx0, tx1 = int(px0.min() // 256) - 0, int(px0.max() // 256)
    ty0, ty1 = int(py0.min() // 256) - 0, int(py0.max() // 256)
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print(f"zoom {zoom}, {len(tiles)} tiles, output {w}x{h} px at {mpp} m/px", file=sys.stderr)

    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    with ThreadPoolExecutor(8) as ex:
        for (tx, ty), img in zip(tiles, ex.map(lambda t: fetch(source, zoom, t[0], t[1]), tiles)):
            if img is not None and img.shape[:2] == (256, 256):
                mosaic[(ty - ty0) * 256 : (ty - ty0 + 1) * 256, (tx - tx0) * 256 : (tx - tx0 + 1) * 256] = img

    # Per-column mercator x (depends on lon only), per-row mercator y (depends on lat only): the grid is separable.
    cols = np.array([merc_px(lats[0], lon, zoom)[0] for lon in lons]) - tx0 * 256 - 0.5
    rows = np.array([merc_px(lat, lons[0], zoom)[1] for lat in lats]) - ty0 * 256 - 0.5
    C, R = np.meshgrid(cols, rows)
    return bilinear(mosaic, R, C)


def bilinear(img, rows, cols):
    """Sample an H x W x 3 image at fractional pixel rows / cols (arrays of the same shape); black outside."""
    H, W = img.shape[:2]
    inside = (rows >= 0) & (rows <= H - 1) & (cols >= 0) & (cols <= W - 1)
    r0 = np.clip(np.floor(rows).astype(int), 0, H - 2)
    c0 = np.clip(np.floor(cols).astype(int), 0, W - 2)
    fr = np.clip(rows - r0, 0, 1)[..., None]
    fc = np.clip(cols - c0, 0, 1)[..., None]
    m = img.astype(np.float32)
    top = m[r0, c0] * (1 - fc) + m[r0, c0 + 1] * fc
    bot = m[r0 + 1, c0] * (1 - fc) + m[r0 + 1, c0 + 1] * fc
    out = np.clip(top * (1 - fr) + bot * fr, 0, 255).astype(np.uint8)
    out[~inside] = 0
    return out


def from_image(path, epsg, lats, lons):
    """Sample a georeferenced orthophoto (world file next to it) at the given lat / lon grids."""
    from pyproj import Transformer

    stem = os.path.splitext(path)[0]
    ext = os.path.splitext(path)[1].lower()
    cands = [stem + e for e in (ext[:2] + ext[-1] + "w", ".tfw", ".jgw", ".pgw", ".wld")]
    wf = next((c for c in cands if os.path.exists(c)), None)
    if not wf:
        sys.exit(f"no world file next to {path} (tried {', '.join(cands)})")
    a, d, b, e, c, f = [float(v) for v in open(wf).read().split()[:6]]
    Image.MAX_IMAGE_PIXELS = None
    img = np.asarray(Image.open(path).convert("RGB"))
    t = Transformer.from_crs(4326, epsg, always_xy=True)
    E, N = t.transform(lons, lats)
    # World file: E = a * col + b * row + c, N = d * col + e * row + f (pixel centres).
    det = a * e - b * d
    cols = (e * (E - c) - b * (N - f)) / det
    rows = (a * (N - f) - d * (E - c)) / det
    return bilinear(img, rows, cols)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config", help="bake config (scripts/realmap/<map>.json): reads id and origin")
    ap.add_argument("--box", type=float, nargs=4, metavar=("X0", "X1", "Z0", "Z1"), required=True, help="world metres")
    ap.add_argument("--mpp", type=float, default=1.0, help="metres per output pixel")
    ap.add_argument("--source", choices=sorted(SOURCES), default="usgs")
    ap.add_argument("--image", help="local orthophoto with a world file, instead of --source tiles")
    ap.add_argument("--epsg", type=int, default=6316, help="the --image's projection (default 6316: North Macedonia)")
    ap.add_argument("--out", help="output png (default under sources/maps/<id>/satellite/)")
    a = ap.parse_args()

    cfg = json.load(open(a.config))
    origin = cfg["origin"]
    x0, x1, z0, z1 = a.box
    w, h = int(round((x1 - x0) / a.mpp)), int(round((z1 - z0) / a.mpp))
    if w * h > 60_000_000:
        sys.exit(f"{w}x{h} px is too large: raise --mpp or shrink --box")

    # World pixel centres -> lat / lon -> mercator pixels (linear in the box corners' lat/lon only per axis: exact here).
    xs = x0 + (np.arange(w) + 0.5) * a.mpp
    zs = z0 + (np.arange(h) + 0.5) * a.mpp
    mx, my = metres_per_degree(origin[0])
    lons = origin[1] + xs / mx
    lats = origin[0] - zs / my

    if a.image:
        LON, LAT = np.meshgrid(lons, lats)
        out = from_image(a.image, a.epsg, LAT, LON)
        source = "image-" + os.path.splitext(os.path.basename(a.image))[0]
    else:
        out = from_tiles(a.source, lats, lons, a.mpp, origin, z0, z1, my, w, h)
        source = a.source

    name = a.out or os.path.join(
        ROOT, "sources", "maps", cfg["id"], "satellite",
        f"{source}-{int(x0)}_{int(x1)}_{int(z0)}_{int(z1)}-{a.mpp:g}.png",
    )
    os.makedirs(os.path.dirname(name), exist_ok=True)
    Image.fromarray(out).save(name)
    print(name)


if __name__ == "__main__":
    main()
