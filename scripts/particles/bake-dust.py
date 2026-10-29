"""Bakes the rally dust sprite atlas (src/games/rally/engine/particles/dust.webp) from Kenney's Particle Pack 1.1 (CC0).

    python3 -I scripts/particles/bake-dust.py sources/rally/kenney

The source folder holds smoke_02/04/07/08.png (512 px, white with alpha) from the pack
(https://github.com/Calinou/kenney-particle-pack). They become a 2 x 2 atlas of 256 px cells, white RGB, the alpha
levelled so every puff has the mean opacity (MEAN) of the old procedural puff and faded to 0 at the cell border (no mip bleed between cells).
game/dust.ts picks a cell per particle.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/games/rally/engine/particles/dust.webp"
FRAMES = ["smoke_02", "smoke_04", "smoke_07", "smoke_08"]
CELL = 256
MEAN = 0.13


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "sources/rally/kenney")
    alpha = np.zeros((CELL * 2, CELL * 2))
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    r = np.hypot(xx + 0.5 - CELL / 2, yy + 0.5 - CELL / 2) / (CELL / 2)
    edge = np.clip((1 - r) / 0.12, 0, 1)
    for i, name in enumerate(FRAMES):
        a = np.asarray(Image.open(src / f"{name}.png").convert("RGBA").resize((CELL, CELL), Image.LANCZOS))[..., 3] / 255
        a = np.clip(a * MEAN / a.mean(), 0, 1) * edge
        y, x = divmod(i, 2)
        alpha[y * CELL : (y + 1) * CELL, x * CELL : (x + 1) * CELL] = a
        print(name, f"mean {a.mean():.3f}")
    rgba = np.full((CELL * 2, CELL * 2, 4), 255, np.uint8)
    rgba[..., 3] = np.round(alpha * 255)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(OUT, lossless=True)


if __name__ == "__main__":
    main()
