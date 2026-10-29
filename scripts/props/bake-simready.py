"""
Bakes NVIDIA SimReady props (CC BY 4.0, https://huggingface.co/datasets/nvidia/simready-assets) for the rally service
park into src/games/rally/assets/builders/simready-models.data.ts.

  blender -b --python scripts/props/bake-simready.py -- sources/rally/simready

Each asset folder (as downloaded, `simready_usd/sm_<name>_01.usd` + payloads + Textures) is imported, every part
coloured by its material (the Principled base colour, or the mean of its albedo tile: the materials are generic tiles,
so a colour per part keeps the look), joined, decimated to the triangle budgets in ASSETS, smoothed by angle and packed:
Y up, origin centred on the footprint at ground level, front along +Z (ASSETS `turn`).

Packed mesh (little endian, base64): u16 vertex count, u16 0, then per vertex i16 x3 position (/ 8192 m), i8 x3
normal, u8 x3 colour (sRGB), then u16 indices.
"""

import base64
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# name -> (folder, triangle budget per level, turn about the vertical (deg) so the front faces +Z).
ASSETS = {
    "tool_chest": ("equipment_rolling_tool_chest_cabinet_combo_d01", [8000, 1500], -90),
    "tyre_rack": ("storage_tire_rack_a01", [3000, 600], 0),
    "floor_jack": ("vehicleSupport_floor_jack_a01", [4000, 800], 0),
}
SCALE = 8192

args = sys.argv[sys.argv.index("--") + 1 :]
src = os.path.abspath(args[0])
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def material_colour(mat):
    """sRGB 0..1 colour of a material: its base colour, or the mean of the image feeding it."""
    if not mat or not mat.node_tree:
        return (0.5, 0.5, 0.5)
    for n in mat.node_tree.nodes:
        if n.type != "BSDF_PRINCIPLED":
            continue
        sock = n.inputs["Base Color"]
        if sock.is_linked:
            node = sock.links[0].from_node
            if node.type == "TEX_IMAGE" and node.image:
                img = node.image.copy()
                img.scale(16, 16)
                px = list(img.pixels)
                bpy.data.images.remove(img)
                lin = [sum(px[c::4]) / (len(px) / 4) for c in range(3)]
                return tuple(to_srgb(v) for v in lin) if node.image.colorspace_settings.name != "sRGB" else tuple(lin)
        v = sock.default_value
        return tuple(to_srgb(v[c]) for c in range(3))
    return (0.5, 0.5, 0.5)


def to_srgb(v):
    return 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055


def bake(name, folder, budgets, turn):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    usd = [f for f in os.listdir(os.path.join(src, folder, "simready_usd")) if f.startswith("sm_") and f.endswith(".usd")][0]
    bpy.ops.wm.usd_import(filepath=os.path.join(src, folder, "simready_usd", usd), import_materials=True)
    # Parts are instanced (empties pointing at hidden prototype collections): make them real meshes first.
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.instance_type == "COLLECTION":
            o.select_set(True)
    bpy.ops.object.duplicates_make_real()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()
    # Colour every face by its material, then join.
    for o in meshes:
        me = o.data
        attr = me.color_attributes.new("col", "BYTE_COLOR", "CORNER")
        cols = [material_colour(s.material) for s in o.material_slots] or [(0.5, 0.5, 0.5)]
        for poly in me.polygons:
            c = cols[min(poly.material_index, len(cols) - 1)]
            for li in poly.loop_indices:
                attr.data[li].color_srgb = (*c, 1.0)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = obj.data
    me.materials.clear()
    # Blender Z up -> three Y up, footprint centred, base on y = 0, turned so the front faces +Z.
    lo = Vector((min(v.co[i] for v in me.vertices) for i in range(3)))
    hi = Vector((max(v.co[i] for v in me.vertices) for i in range(3)))
    centre = Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    me.transform(Matrix.Rotation(math.radians(turn), 4, "Z") @ centre)
    full = len(me.polygons)
    lods = []
    src_obj = obj
    for budget in budgets:
        # Each level from the one before (the decimator stops short on a big jump); up to three passes to reach it.
        o = src_obj.copy()
        o.data = src_obj.data.copy()
        bpy.context.collection.objects.link(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        if lods:
            o = drop_small_parts(o, 0.04)
        for _ in range(3):
            tris = len(o.data.polygons)
            if tris <= budget * 1.15:
                break
            mod = o.modifiers.new("dec", "DECIMATE")
            mod.ratio = budget / tris
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier="dec")
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        lods.append(pack(o.data))
        src_obj = o
        print(f"{name} lod {len(lods) - 1}: {lods[-1][1]} tris (budget {budget}, source {full})")
    size = [round(hi[i] - lo[i], 3) for i in (0, 2, 1)]
    return {"name": name, "folder": folder, "size": size, "lods": [l[0] for l in lods]}


def drop_small_parts(o, size):
    """Far levels: delete loose pieces smaller than `size` m across (screws, clips; the decimator cannot shrink them)."""
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = list(bpy.context.selected_objects)
    keep = []
    for p in parts:
        lo = Vector((min(v.co[i] for v in p.data.vertices) for i in range(3)))
        hi = Vector((max(v.co[i] for v in p.data.vertices) for i in range(3)))
        if (hi - lo).length < size and len(parts) > 1:
            bpy.data.objects.remove(p)
        else:
            keep.append(p)
    bpy.ops.object.select_all(action="DESELECT")
    for p in keep:
        p.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    if len(keep) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def pack(me):
    me.calc_loop_triangles()
    col = me.color_attributes["col"]
    normals = me.corner_normals
    verts, index, out = {}, [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            v = me.vertices[me.loops[li].vertex_index].co
            n = normals[li].vector
            c = col.data[li].color_srgb
            # Blender (x, y, z) -> three (x, z, -y).
            key = (
                round(v.x * SCALE), round(v.z * SCALE), round(-v.y * SCALE),
                round(n.x * 127), round(n.z * 127), round(-n.y * 127),
                round(c[0] * 255), round(c[1] * 255), round(c[2] * 255),
            )
            if key not in verts:
                verts[key] = len(out)
                out.append(key)
            index.append(verts[key])
    buf = bytearray(struct.pack("<HH", len(out), 0))
    for k in out:
        buf += struct.pack("<hhhbbbBBB", *k)
    buf += struct.pack(f"<{len(index)}H", *index)
    return base64.b64encode(bytes(buf)).decode(), len(index) // 3


assets = [bake(n, *spec) for n, spec in ASSETS.items()]
ts = [
    '// Generated by scripts/props/bake-simready.py from NVIDIA SimReady Assets (CC BY 4.0). Do not edit.',
    'export interface SimreadyModelData {',
    '  /** Bounding size (m): width (x), height (y), depth (z). */',
    '  size: [number, number, number];',
    '  /** Packed mesh per level of detail (layout: see the baker). */',
    '  lods: string[];',
    '}',
    '',
    'export const SIMREADY_MODELS: Record<string, SimreadyModelData> = {',
]
for a in assets:
    ts.append(f"  // {a['folder']}")
    ts.append(f"  {a['name']}: {{ size: {a['size']}, lods: [{', '.join(repr(l) for l in a['lods'])}] }},")
ts.append("};")
out = os.path.join(root, "src", "games", "rally", "assets", "builders", "simready-models.data.ts")
with open(out, "w", encoding="utf8", newline="\n") as f:
    f.write("\n".join(ts) + "\n")
print("wrote", out)
