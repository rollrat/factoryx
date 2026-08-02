"""Build a directional, iron-rich rib escarpment for FactoryX.

The landmark is a set of individually proportioned, wind-leaning fins growing
out of one fractured foot.  Every rib uses the same regional strata direction,
but changing height, root placement, lean, and break profile preserve gaps and
avoid a copied-spike silhouette.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_iron_ribs_a"


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--asset-id", default=ASSET_ID)
    return parser.parse_args(values)


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    parent.children.link(result)
    return result


def empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    result = bpy.data.objects.new(name, None)
    target.objects.link(result)
    result.parent = parent
    return result


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


class MeshWriter:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def point(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(indices)
        self.materials.append(material_index)

    def fin(self, origin: Vector, height: float, width: float, thickness: float, lean: Vector, phase: float, levels: int, material_offset: int = 0) -> None:
        """An asymmetrical flattened rock fin with actual layered cross-sections."""
        rings: list[list[int]] = []
        profile = ((-1.00, -0.32), (-0.54, -1.00), (0.22, -0.82), (1.00, -0.26), (0.80, 0.57), (0.11, 1.00), (-0.67, 0.75), (-1.00, 0.22))
        for level in range(levels + 1):
            t = level / levels
            eased = t * t * (3.0 - 2.0 * t)
            # Broad buttresses, tapering upper plate, and uneven strata make
            # each fin read as sheared geology rather than an oversized cone.
            taper = 1.04 - 0.59 * t + 0.095 * math.sin(t * math.pi * 3.0 + phase)
            if t > 0.80:
                taper *= 1.0 - (t - 0.80) * (1.25 + 0.22 * math.sin(phase))
            center = origin + lean * eased + Vector((0.10 * math.sin(t * math.pi * 2.3 + phase), 0.055 * math.cos(t * math.pi * 1.7 + phase), height * t))
            ring: list[int] = []
            for side, (px, py) in enumerate(profile):
                stratum_jitter = 1.0 + 0.055 * math.sin(side * 2.7 + level * 0.82 + phase)
                local_width = width * taper * stratum_jitter
                local_thickness = thickness * (0.92 + 0.12 * math.sin(level * 0.71 + phase))
                broken_top = (0.09 * math.sin(side * 2.0 + phase)) * max(0.0, (t - 0.70) / 0.30)
                ring.append(self.point(center + Vector((px * local_width, py * local_thickness, broken_top))))
            rings.append(ring)
        self.face(tuple(reversed(rings[0])), 0)
        self.face(tuple(rings[-1]), 0)
        for level in range(levels):
            # Oxide seams occur in coherent band elevations but shift by fin so
            # weathering is regional rather than a repeated painted pattern.
            band = ((level + material_offset) % 5 == 2) or (level > levels * 0.68 and (level + material_offset) % 4 == 0)
            for side in range(len(profile)):
                nxt = (side + 1) % len(profile)
                self.face((rings[level][side], rings[level][nxt], rings[level + 1][nxt], rings[level + 1][side]), 1 if band and side in (0, 1, 4, 5) else 0)

    def base(self, sides: int) -> None:
        rings: list[list[int]] = []
        for ring_index, (scale, z) in enumerate(((1.0, 0.0), (0.88, 0.38), (0.62, 0.82))):
            ring: list[int] = []
            for side in range(sides):
                angle = math.tau * side / sides
                wobble = 1.0 + 0.15 * math.sin(angle * 3.0 + 0.4) + 0.075 * math.cos(angle * 6.0 - 0.6)
                x = math.cos(angle) * 5.75 * scale * wobble + 0.18 * math.sin(angle * 2.0)
                y = math.sin(angle) * 2.00 * scale * wobble
                ring.append(self.point((x, y, z + 0.08 * math.sin(angle * 2.0 + ring_index))))
            rings.append(ring)
        crown = self.point((0.30, -0.12, 1.12))
        for ring_index in range(2):
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((rings[ring_index][side], rings[ring_index][nxt], rings[ring_index + 1][nxt], rings[ring_index + 1][side]), 1 if ring_index == 1 and side % 4 == 1 else 0)
        for side in range(sides):
            self.face((rings[-1][side], rings[-1][(side + 1) % sides], crown), 0)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for material_value in materials:
            mesh.materials.append(material_value)
        mesh.update()
        for polygon, material_index in zip(mesh.polygons, self.materials):
            polygon.material_index = material_index
            polygon.use_smooth = False
        result = bpy.data.objects.new(name, mesh)
        target.objects.link(result)
        result.parent = parent
        return result


def landmark_mesh(asset_id: str, lod: int, materials: list[bpy.types.Material]) -> bpy.types.Mesh:
    writer = MeshWriter()
    writer.base((28, 16, 10)[lod])
    all_fins = [
        # x, y, height, width, thickness, lean x, lean y, phase
        (-4.15, -0.55, 6.35, 0.88, 0.34, 1.55, -0.16, 0.20),
        (-2.72, 0.12, 9.15, 1.08, 0.43, 2.52, 0.17, 1.05),
        (-1.15, -0.36, 5.55, 0.73, 0.30, 1.82, -0.14, 2.32),
        (0.48, 0.30, 8.05, 1.00, 0.40, 2.78, 0.10, 3.42),
        (2.07, -0.20, 4.78, 0.65, 0.27, 1.54, -0.11, 4.16),
        (3.48, 0.38, 7.08, 0.86, 0.35, 2.18, 0.15, 5.05),
        (4.72, -0.22, 3.82, 0.55, 0.24, 1.10, -0.08, 5.91),
    ]
    fin_count = (7, 6, 4)[lod]
    level_count = (18, 9, 4)[lod]
    for index, (x, y, height, width, thickness, lean_x, lean_y, phase) in enumerate(all_fins[:fin_count]):
        writer.fin(Vector((x, y, 0.56)), height, width, thickness, Vector((lean_x, lean_y, 0.0)), phase, level_count, index)
    if lod == 0:
        # A few short fracture plates are only visible near the landmark. Their
        # odd spacing breaks the regularity of the primary rib cadence.
        for index, values in enumerate(((-3.35, 0.62, 2.35, 0.36, 0.16, 0.72), (1.14, -0.72, 2.62, 0.42, 0.18, 0.94), (3.96, -0.62, 1.76, 0.29, 0.13, 0.51))):
            x, y, height, width, thickness, lean_x = values
            writer.fin(Vector((x, y, 0.42)), height, width, thickness, Vector((lean_x, -0.06, 0.0)), 0.75 + index * 1.8, 7, index + 2)
    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(writer.vertices, [], writer.faces)
    for material_value in materials:
        mesh.materials.append(material_value)
    mesh.update()
    for polygon, material_index in zip(mesh.polygons, writer.materials):
        polygon.material_index = material_index
        polygon.use_smooth = False
    return mesh


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", landmark_mesh(asset_id, lod, materials))
    target.objects.link(obj)
    obj.parent = parent
    obj.hide_render = lod != 0
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    obj["fx_shadow_distance"] = (160, 220, 300)[lod]
    obj["fx_runtime_tags"] = "landmark,iron_ribs,escarpment,passable_gaps"


def collision_mesh(asset_id: str, collision_material: bpy.types.Material) -> bpy.types.Mesh:
    # Three low hulls preserve the two largest rib gaps as readable, passable
    # spaces instead of covering the entire escarpment with one giant collider.
    ranges = ((-5.4, -2.25), (-1.45, 1.55), (2.20, 5.65))
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for left, right in ranges:
        start = len(vertices)
        for z in (0.0, 2.35):
            vertices.extend(((left, -1.08, z), (right, -1.08, z), (right, 1.08, z), (left, 1.08, z)))
        faces.extend(((start, start + 1, start + 2, start + 3), (start + 4, start + 7, start + 6, start + 5), (start, start + 4, start + 5, start + 1), (start + 1, start + 5, start + 6, start + 2), (start + 2, start + 6, start + 7, start + 3), (start + 3, start + 7, start + 4, start)))
    mesh = bpy.data.meshes.new(f"{asset_id}_collision_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(collision_material)
    mesh.update()
    return mesh


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    obj = bpy.data.objects.new(f"{asset_id}_collision", collision_mesh(asset_id, collision_material))
    target.objects.link(obj)
    obj.parent = parent
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "segmented_convex_hulls"


def add_preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", master)
    ground_material = material("M_PreviewDust", (0.062, 0.032, 0.023), 0.96, 0.0)
    bpy.ops.mesh.primitive_plane_add(size=36, location=(0.8, 0.0, -0.018))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 1750, "DISK", 7.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-8.0, -8.5, 12.0)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 1150, (0.32, 0.52, 0.84), 6.0
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (7.0, 3.5, 9.0)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (13.5, -16.0, 9.2)
    camera.rotation_euler = (Vector((0.75, 0.0, 4.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 59
    preview.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.016, 0.024, 0.042, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.29


def main() -> None:
    args = arguments()
    source, preview = Path(args.source).resolve(), Path(args.preview).resolve()
    source.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1.0
    master = collection(f"FX_{args.asset_id}", scene.collection)
    root = bpy.data.objects.new(f"FX_{args.asset_id}", None)
    master.objects.link(root)
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_landmark", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"]}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "iron_ribs_escarpment"
    root["fx_landmark_id"] = "iron_ribs"
    root["fx_biome_ids"] = "ironwind_faults,hematite_crown"
    root["fx_runtime_tags"] = "environment_landmark,iron_ribs,diagonal_fins,passable"
    dark_iron = material("FX_IronRibDark", (0.12, 0.077, 0.059), 0.76, 0.16)
    oxide = material("FX_IronRibOxide", (0.27, 0.078, 0.031), 0.86, 0.06)
    collision = material("FX_Collision", (0.70, 0.08, 0.04), 1.0, 0.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        make_visual(args.asset_id, lod, target, empty(f"VIS_LOD{lod}", target, root), [dark_iron, oxide])
    collision_target = collection("COL_SIMPLE", master)
    make_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    points["fx_runtime_tags"] = "landmark,wind_scour"
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "iron_ribs_escarpment"
    meta["fx_landmark_id"] = "iron_ribs"
    meta["fx_biome_ids"] = "ironwind_faults,hematite_crown"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
