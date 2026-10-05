"""Orthographic shaded views of a car GLB written by stl-to-glb.mjs, with a metre grid.

    python scripts/car-model/view-glb.py <model.source.json> <out-prefix>
        [--views front,left,...] [--crop a0,a1,b0,b1] [--scale px-per-metre] [--grid metres]

Writes <out-prefix>-<view>.png. Each primitive is drawn in its material's `parts.preview`
colour (body = light grey), so this shows what the game will get after simplification:
check that part borders survived and nothing is mislabelled. Views, crops and grid labels
are in model space (see meshview.py): front / rear = (x, y), left / right = (z, y),
top / bottom = (z, x).
"""
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshview import hex_rgb, normals, render  # noqa: E402

cfg_path, prefix = sys.argv[1], sys.argv[2]
opts = dict(zip(sys.argv[3::2], sys.argv[4::2]))
cfg = json.load(open(cfg_path, encoding='utf8'))
glb = open(cfg['output'], 'rb').read()
jlen = struct.unpack('<I', glb[12:16])[0]
gj = json.loads(glb[20:20 + jlen])
bin0 = 20 + jlen + 8


def acc(i):
    a = gj['accessors'][i]
    v = gj['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']]
    off = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(glb, dt, a['count'] * n, off).reshape(-1, n)


preview = cfg.get('parts', {}).get('preview', {})
tris, cols = [], []
for prim in gj['meshes'][0]['primitives']:
    name = gj['materials'][prim['material']]['name']
    pos = acc(prim['attributes']['POSITION']).astype(float)
    idx = acc(prim['indices']).astype(int).reshape(-1, 3)
    tris.append(pos[idx])
    cols.append(np.tile(np.array(hex_rgb(preview.get(name, '#c8ccd0')), float), (len(idx), 1)))
    print(f'{name:<10} {len(idx):6d} triangles')
T = np.concatenate(tris)
col = np.concatenate(cols)
N, _ = normals(T)
crop = [float(c) for c in opts['--crop'].split(',')] if '--crop' in opts else None
for view in opts.get('--views', 'front,rear,left,right,top').split(','):
    out = f'{prefix}-{view}.png'
    print('wrote', out, render(T, N, col, view, out, crop, int(opts.get('--scale', 400)),
                               float(opts.get('--grid', 0.1))))
