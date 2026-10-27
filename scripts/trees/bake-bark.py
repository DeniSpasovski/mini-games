"""Bakes the rally trees' scanned bark tiles (src/games/rally/trees/bark/<kind>.webp) from CC0 Poly Haven scans.

    python3 -I scripts/trees/bake-bark.py sources/rally/bark

The source folder holds the 1k diffuse maps (<asset>_diff_1k.jpg). Each whole (seamless) scan becomes a grey
256 x 512 tile: u once around the branch, v along it (the species' `bark.tiling` repeats per metre). Grey, because it
multiplies the species' bark colour like the procedural tiles did; with its own contrast; trees/materials.ts `BARK_GAIN` (printed here) lifts it to the procedural tiles' mean brightness
(MEAN) so the trunk keeps its colour.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/games/rally/trees/bark"
SIZE = (256, 512)
MEAN = 0.78
# Bark kind -> Poly Haven asset.
KINDS = {
    "furrowed": "jolcham_oak_bark_01",
    "pine": "pine_bark",
    "beech": "chinese_hackberry_bark",
    "plane": "bark_platanus",
}


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "sources/rally/bark")
    OUT.mkdir(parents=True, exist_ok=True)
    for kind, asset in KINDS.items():
        im = Image.open(src / f"{asset}_diff_1k.jpg").convert("L").resize(SIZE, Image.LANCZOS)
        # Brightest 0.5 % to white, the scan's own contrast kept; the material lifts it back to MEAN (`BARK_GAIN`).
        x = np.clip(np.asarray(im, dtype=np.float64) / np.percentile(im, 99.5), 0, 1)
        Image.fromarray(np.round(x * 255).astype(np.uint8)).save(OUT / f"{kind}.webp", quality=88, method=6)
        # sRGB tile, linear lighting: the gain is on the linear mean.
        lin = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
        print(f"{kind}: {MEAN ** 2.2 / lin.mean():.2f},  // {asset}")


if __name__ == "__main__":
    main()
