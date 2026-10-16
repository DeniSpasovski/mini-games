"""Turn a GLB's scene about the vertical axis (a car modelled at an angle) so the nose points to +z.

    python scripts/car-model/glb-orient.py <in.glb> <out.glb> --heading <deg> [--shift x,y,z] [--scale k]

`--heading` = the angle of the car's nose direction measured from +z towards +x in the file's own frame (from the front / rear
wheel centres: atan2(dx, dz)). A new root node carries the rotation (and the optional shift in metres, applied after it), so
glb-to-parts-stl.py rules can then use boxes in the car's own axes. `--scale k` multiplies the model first (a FBX export in
centimetres: 100), so the shift and the rules are in metres. Only the JSON chunk is rewritten.
"""
import json
import math
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
opts = dict(zip(sys.argv[3::2], sys.argv[4::2]))
phi = -math.radians(float(opts['--heading']))
shift = [float(v) for v in opts.get('--shift', '0,0,0').split(',')]
scale = float(opts.get('--scale', 1))

d = open(src, 'rb').read()
jl = struct.unpack_from('<I', d, 12)[0]
j = json.loads(d[20:20 + jl])
scene = j['scenes'][j.get('scene', 0)]
j['nodes'].append(
    {
        'name': 'orient',
        'rotation': [0, math.sin(phi / 2), 0, math.cos(phi / 2)],
        'translation': shift,
        'scale': [scale, scale, scale],
        'children': scene['nodes'],
    }
)
scene['nodes'] = [len(j['nodes']) - 1]
pad = lambda b, p: b + p * (-len(b) % 4)
js = pad(json.dumps(j, separators=(',', ':')).encode(), b' ')
rest = d[20 + jl:]
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<I4s', len(js), b'JSON') + js + rest
open(dst, 'wb').write(out)
