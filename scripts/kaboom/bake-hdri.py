"""Bake the small environment-light HDRIs of 3, 2, 1 Kabooom (src/games/kaboom/assets/hdri/<level>.hdr) from Poly Haven (CC0).

usage: python3 scripts/kaboom/bake-hdri.py <dir with <id>_1k.hdr> [out dir]

Each 1k equirect is box-filtered down to 128 x 64 (diffuse and blurry reflections need no more) and written as plain
uncompressed Radiance RGBE, about 32 KB. The sun is clipped out (the game has its own sun light, from its own direction),
the ground below the horizon dimmed, and the mean brightness set to 1, so one `environmentIntensity` per level reads the
same. The game prefilters it once at load (PMREM) on High quality only.
"""
import os
import sys

import numpy as np

W, H = 128, 64
# the photo's ground is not ours (the game lights its own floor): keep only a little of its bounce
GROUND = 0.45
# level: Poly Haven id
HDRIS = {
    'quarry': 'goegap',
    'valley': 'meadow_2',
    'sea': 'small_harbour_morning',
}


def read_hdr(path):
    with open(path, 'rb') as f:
        data = f.read()
    end = data.index(b'\n\n')
    rest = data[end + 2:]
    nl = rest.index(b'\n')
    dims = rest[:nl].split()
    h, w = int(dims[1]), int(dims[3])
    buf = rest[nl + 1:]
    img = np.zeros((h, w, 4), np.uint8)
    p = 0
    for y in range(h):
        if buf[p] == 2 and buf[p + 1] == 2:  # new-style RLE scanline
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = buf[p]
                    p += 1
                    if n > 128:
                        n -= 128
                        img[y, x:x + n, c] = buf[p]
                        p += 1
                    else:
                        img[y, x:x + n, c] = np.frombuffer(buf, np.uint8, n, p)
                        p += n
                    x += n
        else:
            img[y] = np.frombuffer(buf, np.uint8, w * 4, p).reshape(w, 4)
            p += w * 4
    e = img[..., 3].astype(np.float64)
    scale = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(int)), 0.0)
    return img[..., :3].astype(np.float64) * scale[..., None]


def write_hdr(path, rgb):
    v = rgb.max(axis=2)
    m, ex = np.frexp(v)
    scale = np.where(v > 1e-32, m * 256.0 / np.maximum(v, 1e-32), 0.0)
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(v > 1e-32, ex + 128, 0).astype(np.uint8)
    h, w = rgb.shape[:2]
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode())
        f.write(out.tobytes())


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else 'src/games/kaboom/assets/hdri'
    os.makedirs(dst, exist_ok=True)
    for level, pid in HDRIS.items():
        img = read_hdr(os.path.join(src, f'{pid}_1k.hdr'))
        h, w = img.shape[:2]
        small = img.reshape(H, h // H, W, w // W, 3).mean(axis=(1, 3))
        small[H // 2:] *= GROUND
        lum = small @ [0.2126, 0.7152, 0.0722]
        cap = np.percentile(lum, 97)
        small *= np.minimum(1.0, cap / np.maximum(lum, 1e-9))[..., None]
        small /= (small @ [0.2126, 0.7152, 0.0722]).mean()
        write_hdr(os.path.join(dst, f'{level}.hdr'), small)
        print(level, pid, small.mean(axis=(0, 1)).round(3))


if __name__ == '__main__':
    main()
