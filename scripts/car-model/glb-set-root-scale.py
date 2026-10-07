"""Rewrite a GLB's node matrix scale (Sketchfab FBX exports often carry a 0.01 root scale on a model that is already in metres).

    python scripts/car-model/glb-set-root-scale.py <in.glb> <out.glb> <node-index> <factor>

Multiplies the 3x3 part of node <node-index>'s `matrix` by <factor> (translation untouched). Only the JSON chunk is rewritten.
"""
import json
import struct
import sys

src, dst, node, factor = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
d = open(src, 'rb').read()
jl = struct.unpack_from('<I', d, 12)[0]
j = json.loads(d[20:20 + jl])
m = j['nodes'][node]['matrix']
for c in range(3):
    for r in range(3):
        m[c * 4 + r] *= factor
pad = lambda b, p: b + p * (-len(b) % 4)
js = pad(json.dumps(j, separators=(',', ':')).encode(), b' ')
rest = d[20 + jl:]
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<I4s', len(js), b'JSON') + js + rest
open(dst, 'wb').write(out)
