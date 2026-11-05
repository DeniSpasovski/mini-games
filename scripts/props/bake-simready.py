"""
Bakes NVIDIA SimReady props (CC BY 4.0, https://huggingface.co/datasets/nvidia/simready-assets) and Poly Haven models
(CC0, https://polyhaven.com, 1k glTF in sources/rally/polyhaven/<id>/) for rally, one group (ASSETS key) at a time, into
src/games/rally/assets/builders/simready-<group>.data.ts.

  blender -b --python scripts/props/bake-simready.py -- sources/rally/simready <group>

Each asset folder (as downloaded, `simready_usd/sm_<name>_01.usd` + payloads + Textures) is imported, every part
coloured by its material (the Principled base colour, or the mean of its albedo tile: the materials are generic tiles,
so a colour per part keeps the look; a Poly Haven model has one baked atlas, so each face takes the atlas colour under
its UVs instead), joined, decimated to the triangle budgets in ASSETS, smoothed by angle and packed:
Y up, origin centred on the footprint at ground level, front along +Z (ASSETS `turn`).

Packed mesh (little endian, base64): u16 vertex count, u16 shift k, then per vertex i16 x3 position (/ (8192 >> k) m:
k = 0 up to 4 m from the origin, more for a taller model), i8 x3 normal, u8 x3 colour (sRGB)[, u16 x2 uv (/ 65535) when
the header's bit 8 is set: a textured group, TEXTURED], then u16 indices.
"""

import base64
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# group -> name -> (folder, triangle budget per level, turn about the vertical (deg) so the front faces +Z[, options]).
# Options: a tuple = `drop`, or a dict of
#   drop: materials whose name contains one of these are left out (printed labels, which a colour per part turns into blobs);
#   keep: the only objects used (a kit: pick its pieces by name);
#   place: {object or "*": (dx, dy, dz, sx, sy, sz)} moved by d, then scaled about the origin (assembles kit pieces);
#   copy: {new name: (object, (dx, dy, dz, sx, sy, sz))} a second placed copy of a kit piece (a negative scale mirrors it);
#   tile: keep the model's own colour + normal textures (a Poly Haven model with one material) as this tile of the
#     group's atlas (TEXTURED), white vertex colour; the UVs are packed too;
#   smooth: the smoothing angle (deg, default 35): a decimated organic scan wants a wider one or it shows its facets;
#   gain: (r, g, b) linear gain on the tile's colour map (a scan that reads too pale or blue in game).
ASSETS = {
    "service": {
        "tool_chest": ("equipment_rolling_tool_chest_cabinet_combo_d01", [8000, 1500], -90),
        "tyre_rack": ("storage_tire_rack_a01", [3000, 600], 0),
        "floor_jack": ("vehicleSupport_floor_jack_a01", [4000, 800], 0),
    },
    "park": {
        "table_chairs": ("../polyhaven/outdoor_table_chair_set_01", [3500, 700], 0),
        "generator": ("../polyhaven/portable_generator", [4000, 800], 0),
        "wall_lamp": ("../polyhaven/industrial_wall_lamp", [1200, 300], 0),
        # 10 m wooden pole (the kit's 7 m pole stretched, 22 cm thick) with a steel cross arm: three insulators each way
        # along the line with their jumpers; the arm runs along Z after the turn.
        "power_pole": (
            "../polyhaven/modular_electricity_poles",
            [2500, 400],
            90,
            {
                "keep": ["pole_large", "connection_large_01"],
                "place": {
                    "pole_large": (-5.7, 0, 0, 1.6, 1.6, 10 / 7),
                    "connection_large_01": (-2.7, 0, 1.0, 1.6, 1.6, 1.6),
                },
            },
        ),
        "jerrycan": ("../polyhaven/metal_jerrycan_green", [800, 160], 0),
        "jack_stand": ("vehicleSupport_jack_stand_b01", [800, 160], 0),
        "pail": ("pail_plastic_red_a02", [600, 120], 0),
        "tyre_rack_b": ("storage_tire_rack_b01", [1500, 300], 0),
        "tripod_light": ("lighting_taskLight_tripodFlood_a01", [5000, 900], -90),
        "extinguisher_stand": ("fireExtinguisher_stand_a01", [1500, 300], 0, ("paper",)),
        "wheelbarrow": ("construction_wheelbarrow_metal_a01", [3000, 600], 180),
        "hand_truck": ("handTruck_convertible_steel_red_a01", [3500, 700], 0),
        "step_ladder": ("ladder_step_aluminium_a06", [1800, 400], 0),
        "wheelie_bin": ("trashCan_wheeled_green_a01", [2500, 500], 0),
    },
    "village": {
        "utility_box": ("../polyhaven/utility_box_01", [1500, 300], 0),
        "utility_box_wide": ("../polyhaven/utility_box_02", [2000, 400], 0),
        "bin": (
            "../polyhaven/metal_trash_can",
            [1500, 300],
            0,
            {"keep": ["metal_trash_can", "metal_trash_can_handle_left", "metal_trash_can_handle_right", "metal_trash_can_lid"]},
        ),
        "bench": (
            "../polyhaven/modular_street_seating",
            [2000, 400],
            0,
            # The kit ships its pieces apart: the end leg moves in under the back upright and the arm rest down onto the
            # leg, shortened so it starts in front of the upright's curve; a mirrored copy of both closes the right end. The
            # seat slats and crossbar reach into the leg posts, the back slats end on the uprights' inner flange, and the
            # middle support with its crossbar rises 10 cm to hold the seat. Scales are about the bench's middle (x -1.16).
            {
                "keep": [
                    "seat", "seat_back", "back_support_l", "back_support_r", "arm_rest_01", "legs_single", "crossbar",
                    "suspended_support_01",
                ],
                "place": {
                    "legs_single": (0.18, 0, 0, 1, 1, 1),
                    "arm_rest_01": (0.2, -0.06, -0.1, 1, 0.833, 1),
                    "seat": (0.0307, 0, 0, 1.0272, 1, 1),
                    "seat_back": (0.1179, 0, 0, 1.1131, 1, 1),
                    "suspended_support_01": (0, 0, 0.1, 1, 1, 1),
                    "crossbar": (0.035, 0, 0.1, 1.0311, 1, 1),
                },
                "copy": {
                    "legs_single_r": ("legs_single", (2.5, 0, 0, -1, 1, 1)),
                    "arm_rest_r": ("arm_rest_01", (2.52, -0.06, -0.1, -1, 0.833, 1)),
                },
            },
        ),
        "picnic_table": ("../polyhaven/wooden_picnic_table", [2500, 500], 90),
    },
    "yard": {
        "pallet_euro": ("pallet_a01", [2500, 500], 0),
        "pallet_block": ("pallet_block_a01", [2000, 400], 0),
        "pallet_plain": ("pallet_wood_recycled_a05", [2000, 400], 0),
        "drum_steel": ("drum_steel_a01", [1500, 300], 0),
        "drum_blue": ("drum_plastic_blue_a01", [1500, 300], 0),
        "barrel_blue": ("warehouse_barrel_plastic_a01", [1500, 300], 0),
        "ibc_tank": ("ibcTank_a02", [4000, 800], 0),
        "crate": ("crate_plywood_b01", [1500, 300], 0),
        "forklift": ("vehicle_forklift_orange_a01", [6000, 1200], 0),
        "pallet_jack": ("palletJack_heavyDuty_a01", [3500, 700], 0),
    },
    # Forest-floor debris (Poly Haven scans), scattered by the hundred: three levels each.
    "forest": {
        "stump_a": ("../polyhaven/tree_stump_01", [1600, 450, 140], 0, {"tile": 0, "smooth": 70}),
        "stump_b": ("../polyhaven/tree_stump_02", [1600, 450, 140], 0, {"tile": 1, "smooth": 70}),
        "log": ("../polyhaven/dead_tree_trunk", [1200, 350, 100], 0, {"tile": 2, "smooth": 70}),
        "trunk": ("../polyhaven/dead_tree_trunk_02", [2400, 600, 180], 0, {"tile": 3, "smooth": 70}),
        # The scan is a cool grey (blue / green 0.8): warmed and darkened to weathered brown-grey deadwood (~0.62, lum 0.062).
        "branches": ("../polyhaven/dry_branches_medium_01", [1500, 450, 150], 0, {"tile": 4, "smooth": 70, "gain": (0.92, 0.86, 0.67)}),
        "roots_a": ("../polyhaven/pine_roots", [1400, 400, 120], 0, {"tile": 5, "smooth": 70, "keep": ["pine_roots_a"]}),
        "roots_b": ("../polyhaven/pine_roots", [1400, 400, 120], 0, {"tile": 6, "smooth": 70, "keep": ["pine_roots_b"]}),
    },
}
# group -> (columns, rows, colour tile px, normal tile px): the groups whose models keep their own textures (option
# `tile`), packed into src/games/rally/engine/props/simready-<group>.color.webp + .normal.webp.
TEXTURED = {"forest": (4, 2, 512, 256)}
SCALE = 8192

args = sys.argv[sys.argv.index("--") + 1 :]
src = os.path.abspath(args[0])
group = args[1]
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


ATLAS = 48


def atlas(mat):
    """Sampler (u, v) -> sRGB colour of the image feeding a material's base colour, blurred by scaling it to ATLAS px."""
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Base Color"].is_linked:
            node = n.inputs["Base Color"].links[0].from_node
            if node.type != "TEX_IMAGE" or not node.image:
                return None
            img = node.image.copy()
            img.scale(ATLAS, ATLAS)
            px = list(img.pixels)
            bpy.data.images.remove(img)
            srgb = node.image.colorspace_settings.name == "sRGB"

            def sample(u, v):
                x = min(ATLAS - 1, max(0, int((u % 1) * ATLAS)))
                y = min(ATLAS - 1, max(0, int((v % 1) * ATLAS)))
                i = (y * ATLAS + x) * 4
                return tuple(px[i + c] if srgb else to_srgb(px[i + c]) for c in range(3))

            return sample
    return None


def to_srgb(v):
    return 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055


def bake(name, folder, budgets, turn, opts=()):
    opts = opts if isinstance(opts, dict) else {"drop": opts}
    drop = opts.get("drop", ())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    base = os.path.normpath(os.path.join(src, folder))
    gltf = [f for f in os.listdir(base) if f.endswith(".gltf")]
    if gltf:
        bpy.ops.import_scene.gltf(filepath=os.path.join(base, gltf[0]))
    else:
        usd = [f for f in os.listdir(os.path.join(base, "simready_usd")) if f.startswith("sm_") and f.endswith(".usd")][0]
        bpy.ops.wm.usd_import(filepath=os.path.join(base, "simready_usd", usd), import_materials=True)
    # Parts are instanced (empties pointing at hidden prototype collections): make them real meshes first.
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.instance_type == "COLLECTION":
            o.select_set(True)
    bpy.ops.object.duplicates_make_real()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if "keep" in opts:
        for o in [o for o in meshes if o.name not in opts["keep"]]:
            meshes.remove(o)
            bpy.data.objects.remove(o)
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()
    for new, (of, p) in opts.get("copy", {}).items():
        o = next(m for m in meshes if m.name == of).copy()
        o.data = o.data.copy()
        o.name = new
        bpy.context.collection.objects.link(o)
        m = Matrix.Diagonal((*p[3:], 1)) @ Matrix.Translation(p[:3]) @ o.matrix_world
        o.data.transform(m)
        if m.determinant() < 0:
            o.data.flip_normals()
        o.matrix_world = Matrix.Identity(4)
        meshes.append(o)
    for o in meshes:
        p = opts.get("place", {}).get(o.name) or opts.get("place", {}).get("*")
        if p:
            o.matrix_world = Matrix.Diagonal((*p[3:], 1)) @ Matrix.Translation(p[:3]) @ o.matrix_world
    for o in list(meshes):
        gone = {i for i, s in enumerate(o.material_slots) if s.material and any(d in s.material.name.lower() for d in drop)}
        if not gone:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in gone], context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        if not o.data.polygons:
            meshes.remove(o)
            bpy.data.objects.remove(o)
    tile = opts.get("tile")
    if tile is not None:
        use_tile(meshes, tile)
        if "gain" in opts:
            gains[tile] = opts["gain"]
    # Colour every face by its material, then join.
    for o in meshes:
        me = o.data
        attr = me.color_attributes.new("col", "BYTE_COLOR", "CORNER")
        cols = [material_colour(s.material) for s in o.material_slots] or [(0.5, 0.5, 0.5)]
        atlases = [atlas(s.material) if gltf and tile is None else None for s in o.material_slots]
        uv = me.uv_layers.active
        for poly in me.polygons:
            mi = min(poly.material_index, len(cols) - 1)
            c = cols[mi]
            if tile is not None:
                c = (1.0, 1.0, 1.0)
            if atlases and atlases[mi] and uv:
                u = sum(uv.data[li].uv[0] for li in poly.loop_indices) / poly.loop_total
                v = sum(uv.data[li].uv[1] for li in poly.loop_indices) / poly.loop_total
                c = atlases[mi](u, v)
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
    if tile is not None:
        # The glTF import splits a scan's vertices along its UV seams: weld them, or the decimator opens cracks there.
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
    # Blender Z up -> three Y up, footprint centred, base on y = 0, turned so the front faces +Z.
    lo = Vector((min(v.co[i] for v in me.vertices) for i in range(3)))
    hi = Vector((max(v.co[i] for v in me.vertices) for i in range(3)))
    centre = Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    me.transform(Matrix.Rotation(math.radians(turn), 4, "Z") @ centre)
    full = len(me.polygons)
    lods = []
    src_obj = obj
    for budget in budgets:
        # Each level from the one before (the decimator stops short on a big jump); up to three passes to reach it;
        # far levels drop bigger and bigger loose parts while the decimator stays short (a part cannot shrink below a few faces).
        o = src_obj.copy()
        o.data = src_obj.data.copy()
        bpy.context.collection.objects.link(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        for small in (0.04, 0.08, 0.15) if lods else (0,):
            if small:
                o = drop_small_parts(o, small)
            for _ in range(3):
                tris = len(o.data.polygons)
                if tris <= budget * 1.15:
                    break
                mod = o.modifiers.new("dec", "DECIMATE")
                mod.ratio = budget / tris
                mod.use_collapse_triangulate = True
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier="dec")
            if len(o.data.polygons) <= budget * 1.15:
                break
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(opts.get("smooth", 35)))
        lods.append(pack(o.data, tile is not None))
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


TILE_PAD = 0.01
tiles = {}
gains = {}


def use_tile(meshes, tile):
    """Map a textured model's UVs into its atlas tile (TILE_PAD in from the edges) and note the tile's two images."""
    mats = {s.material for o in meshes for s in o.material_slots if s.material}
    assert len(mats) == 1, f"tile {tile}: one material expected, got {[m.name for m in mats]}"
    nodes = mats.pop().node_tree.nodes
    path = lambda n: bpy.path.abspath(n.image.filepath)
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    nor = next(n for n in nodes if n.type == "NORMAL_MAP").inputs["Color"].links[0].from_node
    tiles[tile] = (path(bsdf.inputs["Base Color"].links[0].from_node), path(nor))
    cols, rows = TEXTURED[group][:2]
    c, r = tile % cols, tile // cols
    for o in meshes:
        for d in o.data.uv_layers.active.data:
            u, v = (min(1, max(0, x)) for x in d.uv)
            # Tile rows count from the image top; Blender's v from its bottom.
            d.uv = ((c + TILE_PAD + u * (1 - 2 * TILE_PAD)) / cols, (rows - 1 - r + TILE_PAD + v * (1 - 2 * TILE_PAD)) / rows)


def write_atlas():
    """The group's colour and normal atlases (webp) from the tiles' images, scaled to the tile size."""
    import numpy as np

    cols, rows, *px = TEXTURED[group]
    for k, (kind, size, fill) in enumerate((("color", px[0], (0.3, 0.25, 0.2)), ("normal", px[1], (0.5, 0.5, 1.0)))):
        buf = np.ones((rows * size, cols * size, 4), np.float32)
        buf[..., :3] = fill
        for t, paths in tiles.items():
            img = bpy.data.images.load(paths[k])
            img.scale(size, size)
            tile = np.empty(size * size * 4, np.float32)
            img.pixels.foreach_get(tile)
            if k == 0 and t in gains:
                # The byte image's pixels are sRGB: the gain is linear.
                px = tile.reshape(-1, 4)[:, :3]
                lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4) * np.array(gains[t], np.float32)
                lin = np.clip(lin, 0, 1)
                px[:] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
            y = (rows - 1 - t // cols) * size  # pixel rows count from the bottom
            buf[y : y + size, (t % cols) * size : (t % cols + 1) * size] = tile.reshape(size, size, 4)
        img = bpy.data.images.new(f"{group}-{kind}", cols * size, rows * size, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(buf.ravel())
        img.filepath_raw = os.path.join(root, "src", "games", "rally", "engine", "props", f"simready-{group}.{kind}.webp")
        img.file_format = "WEBP"
        img.save(quality=82)
        print("wrote", img.filepath_raw)


def pack(me, textured=False):
    me.calc_loop_triangles()
    col = me.color_attributes["col"]
    uv = me.uv_layers.active.data if textured else None
    normals = me.corner_normals
    verts, index, out = {}, [], []
    reach = max(abs(c) for v in me.vertices for c in v.co)
    shift = 0
    while reach * (SCALE >> shift) > 32767:
        shift += 1
    scale = SCALE >> shift
    for tri in me.loop_triangles:
        for li in tri.loops:
            v = me.vertices[me.loops[li].vertex_index].co
            n = normals[li].vector
            c = col.data[li].color_srgb
            # Blender (x, y, z) -> three (x, z, -y).
            key = (
                round(v.x * scale), round(v.z * scale), round(-v.y * scale),
                round(n.x * 127), round(n.z * 127), round(-n.y * 127),
                round(c[0] * 255), round(c[1] * 255), round(c[2] * 255),
            )
            if uv is not None:
                t = uv[li].uv
                key += (round(min(1, max(0, t[0])) * 65535), round(min(1, max(0, t[1])) * 65535))
            if key not in verts:
                verts[key] = len(out)
                out.append(key)
            index.append(verts[key])
    buf = bytearray(struct.pack("<HH", len(out), shift | (0x100 if textured else 0)))
    for k in out:
        buf += struct.pack("<hhhbbbBBBHH" if textured else "<hhhbbbBBB", *k)
    buf += struct.pack(f"<{len(index)}H", *index)
    return base64.b64encode(bytes(buf)).decode(), len(index) // 3


assets = [bake(n, *spec) for n, spec in ASSETS[group].items()]
ts = [
    '// Generated by scripts/props/bake-simready.py from NVIDIA SimReady Assets (CC BY 4.0) and Poly Haven models (CC0). Do not edit.',
    'export interface SimreadyModelData {',
    '  /** Bounding size (m): width (x), height (y), depth (z). */',
    '  size: [number, number, number];',
    '  /** Packed mesh per level of detail (layout: see the baker). */',
    '  lods: string[];',
    '}',
    '',
    f'export const SIMREADY_{group.upper()}: Record<string, SimreadyModelData> = {{',
]
for a in assets:
    ts.append(f"  // {a['folder']}")
    ts.append(f"  {a['name']}: {{ size: {a['size']}, lods: [{', '.join(repr(l) for l in a['lods'])}] }},")
ts.append("};")
out = os.path.join(root, "src", "games", "rally", "assets", "builders", f"simready-{group}.data.ts")
with open(out, "w", encoding="utf8", newline="\n") as f:
    f.write("\n".join(ts) + "\n")
print("wrote", out)
if group in TEXTURED:
    write_atlas()
