"""Tiny GLB reader for the car-model tools: every triangle primitive baked into world space (node transforms applied)."""
import json
import struct

import numpy as np

CT = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    data = open(path, 'rb').read()
    n = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + n]), data[20 + n + 8:]


def accessor(g, binary, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NC[a['type']]
    dt = np.dtype(CT[a['componentType']])
    stride = bv.get('byteStride', 0)
    if stride and stride != n * dt.itemsize:
        rows = np.frombuffer(binary, np.uint8, a['count'] * stride, off).reshape(a['count'], stride)
        return rows[:, :n * dt.itemsize].copy().view(dt).reshape(a['count'], n).astype(np.float64)
    return np.frombuffer(binary, dt, a['count'] * n, off).reshape(a['count'], n).astype(np.float64)


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M[:3, :3] = R * np.array(n.get('scale', [1, 1, 1]), float)
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def primitives(g, binary):
    """List of (node name, material name, triangles (n, 3, 3) in world space)."""
    out = []

    def walk(i, M):
        n = g['nodes'][i]
        M = M @ node_matrix(n)
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4:
                    continue
                P = accessor(g, binary, p['attributes']['POSITION'])
                P = (M[:3, :3] @ P.T).T + M[:3, 3]
                idx = accessor(g, binary, p['indices']).astype(np.int64).ravel() if 'indices' in p else np.arange(len(P))
                mat = g['materials'][p['material']].get('name', '') if 'material' in p else ''
                out.append((n.get('name', f'node{i}'), mat, P[idx].reshape(-1, 3, 3)))
        for c in n.get('children', []):
            walk(c, M)

    for s in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(s, np.eye(4))
    return out
