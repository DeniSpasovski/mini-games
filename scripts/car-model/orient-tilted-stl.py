"""De-tilt a body STL that was exported pitched on the print bed (first used on a Rally2 hatch print).

    python scripts/car-model/orient-tilted-stl.py <in.stl> <out.stl> [extra-pitch-deg] [roll-deg]

PCA finds the long axis; the result has x = car left, y = up, z = nose (same units as the
input) and is centred on the body mean. `extra-pitch-deg` (default -3.3 for the Fabia)
levels the front / rear stub axles (the body STL has no wheels). PCA leaves a small roll: `roll-deg` (default
2.4 for the Fabia, + lifts the car's left side) was fitted by left / right symmetry of the
body's height profile. Feed the output to stl-to-glb.mjs.
"""
import sys

import numpy as np

src, dst = sys.argv[1], sys.argv[2]
pitch = np.radians(float(sys.argv[3]) if len(sys.argv) > 3 else -3.3)
roll = np.radians(float(sys.argv[4]) if len(sys.argv) > 4 else 2.4)
b = open(src, 'rb').read()
n = int(np.frombuffer(b[80:84], '<u4')[0])
dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
T = np.frombuffer(b[84:84 + n * 50], dtype=dt)['v'].astype(np.float64)
P = T.reshape(-1, 3)
c = P.mean(0)
_, _, vt = np.linalg.svd(P - c, full_matrices=False)
L, U = vt[0], vt[2]
if U[2] < 0:
    U = -U
X = np.cross(U, L)
q = P - c
l, u, x = q @ L, q @ U, q @ X
uu = u * np.cos(pitch) + l * np.sin(pitch)
ll = l * np.cos(pitch) - u * np.sin(pitch)
xr = x * np.cos(roll) - uu * np.sin(roll)
yr = x * np.sin(roll) + uu * np.cos(roll)
O = np.stack([xr, yr, ll], -1).reshape(-1, 3, 3)
d = np.zeros(n, dt)
d['v'] = O
nn = np.cross(O[:, 1] - O[:, 0], O[:, 2] - O[:, 0])
d['n'] = nn / (np.linalg.norm(nn, axis=1, keepdims=True) + 1e-12)
with open(dst, 'wb') as f:
    f.write(b'oriented: x=left, y=up, z=nose'.ljust(80, b' '))
    f.write(np.uint32(n).tobytes())
    f.write(d.tobytes())
print('wrote', dst, 'extent', O.reshape(-1, 3).min(0), O.reshape(-1, 3).max(0))
