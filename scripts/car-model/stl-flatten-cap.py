"""Flatten a relief (a badge on a hub cap) in a wheel STL made by glb-rim-extract.py.

    python scripts/car-model/stl-flatten-cap.py <in.stl> <out.stl> --radius 0.028 --z 0.0597

Every vertex closer than `--radius` to the axle (STL z axis, outer face at z max) that lies above `--z` is moved down to `--z`,
so the cap becomes a plain recessed disc. Units are the STL's (metres in the extracted rim).
"""
import struct
import sys

import numpy as np

src, dst = sys.argv[1], sys.argv[2]
opts = dict(zip(sys.argv[3::2], sys.argv[4::2]))
radius, z0 = float(opts['--radius']), float(opts['--z'])
data = bytearray(open(src, 'rb').read())
n = struct.unpack_from('<I', data, 80)[0]
rec = np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')])
tris = np.frombuffer(bytes(data[84:84 + n * rec.itemsize]), rec).copy()
v = tris['v'].reshape(-1, 3, 3)
moved = (np.hypot(v[..., 0], v[..., 1]) < radius) & (v[..., 2] > z0)
v[..., 2][moved] = z0
tris['v'] = v.reshape(-1, 9)
n_flat = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
ln = np.linalg.norm(n_flat, axis=1)
tris['n'] = np.where(ln[:, None] > 1e-12, n_flat / np.maximum(ln, 1e-12)[:, None], tris['n'])
data[84:84 + n * rec.itemsize] = tris.tobytes()
open(dst, 'wb').write(data)
print(f'moved {int(moved.sum())} vertices of {n} triangles to z = {z0}')
