"""
Satellite check: each top-down picture from `topdown.mjs` beside the aerial photo of the same box (`satellite.py`),
and a 50 % blend of the two, to spot a wrong road line / width, forest edges, ground colours and buildings.

    python scripts/realmap/overlay.py scripts/realmap/jackie.json [--mpp 0.5]
    python scripts/realmap/overlay.py scripts/realmap/vodno.json --image sources/maps/vodno/ortho/sheet.tif

Reads sources/maps/<id>/topdown/tiles*.json, writes sources/maps/<id>/satellite-check/<along>.jpg (git-ignored: aerial
photos are never committed or shipped).
"""

import argparse
import glob
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config")
    ap.add_argument("--source", default="usgs")
    ap.add_argument("--image", help="local orthophoto with a world file (see satellite.py)")
    ap.add_argument("--epsg", type=int, default=6316)
    ap.add_argument("--mpp", type=float, help="aerial photo resolution (default: the top-down picture's)")
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    tdir = os.path.join(ROOT, "sources", "maps", cfg["id"], "topdown")
    out_dir = os.path.join(ROOT, "sources", "maps", cfg["id"], "satellite-check")
    os.makedirs(out_dir, exist_ok=True)
    tiles = [t for f in sorted(glob.glob(os.path.join(tdir, "tiles*.json"))) for t in json.load(open(f))]
    font = ImageFont.load_default(size=20)
    for t in tiles:
        x0, x1, z0, z1 = t["box"]
        game = Image.open(os.path.join(ROOT, t["file"])).convert("RGB")
        mpp = a.mpp or t["mpp"]
        sat_path = subprocess.run(
            [sys.executable, os.path.join(HERE, "satellite.py"), a.config, "--source", a.source,
             "--box", str(x0), str(x1), str(z0), str(z1), "--mpp", str(mpp)]
            + (["--image", a.image, "--epsg", str(a.epsg)] if a.image else []),
            check=True, capture_output=True, text=True,
        ).stdout.strip().splitlines()[-1]
        sat = Image.open(sat_path).convert("RGB").resize(game.size, Image.LANCZOS)
        blend = Image.blend(sat, game, 0.5)
        W, H = game.size
        sheet = Image.new("RGB", (W * 3 + 20, H + 30), (20, 20, 20))
        for i, (img, label) in enumerate(((sat, "satellite"), (game, "game"), (blend, "50 % blend"))):
            sheet.paste(img, (i * (W + 10), 30))
            ImageDraw.Draw(sheet).text((i * (W + 10) + 6, 4), label, fill=(240, 240, 240), font=font)
        along = t["along"]
        name = f"{int(along):05d}" if along is not None else f"{x0}_{x1}_{z0}_{z1}"
        path = os.path.join(out_dir, f"{name}.jpg")
        sheet.save(path, quality=88)
        print(path)


if __name__ == "__main__":
    main()
