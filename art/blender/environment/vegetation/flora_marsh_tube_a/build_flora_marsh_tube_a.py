from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "flora_marsh_tube_a"


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


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float = 0.0) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


def add_ring_mesh(
    vertices: list[tuple[float, float, float]], faces: list[tuple[tuple[int, ...], int]],
    center: Vector, tangent: Vector, outer_radius: float, inner_radius: float, sides: int,
    phase: float, squash: float,
) -> tuple[list[int], list[int]]:
    reference = Vector((0, 0, 1)) if abs(tangent.z) < 0.92 else Vector((1, 0, 0))
    axis_u = tangent.cross(reference).normalized()
    axis_v = tangent.cross(axis_u).normalized()
    outside: list[int] = []
    inside: list[int] = []
    for side in range(sides):
        angle = phase + side * math.tau / sides
        ripple = 1.0 + 0.055 * math.sin(angle * 3.0 + phase * 2.0) + 0.026 * math.sin(angle * 5.0 - phase)
        radial = axis_u * (math.cos(angle) * outer_radius * ripple) + axis_v * (math.sin(angle) * outer_radius * squash)
        outside.append(len(vertices))
        vertices.append(tuple(center + radial))
        inner = axis_u * (math.cos(angle) * inner_radius) + axis_v * (math.sin(angle) * inner_radius * squash)
        inside.append(len(vertices))
        vertices.append(tuple(center + inner))
    return outside, inside


def tube_colony_mesh(asset_id: str, lod: int) -> bpy.types.Mesh:
    # Each tube has a crooked centerline, unequal wall thickness, and a real annular mouth.
    # The stable layouts preserve the colony's recognizable silhouette across all LODs.
    layouts = [
        (-0.18, -0.08, 3.65, 0.31, (0.48, 0.10), 0.20, 0.15),
        (0.52, 0.22, 2.72, 0.27, (-0.22, 0.34), 0.03, 0.56),
        (-0.68, 0.29, 2.38, 0.25, (-0.34, -0.24), 0.32, 0.90),
        (0.15, -0.62, 1.86, 0.23, (0.45, -0.06), -0.15, 1.42),
        (0.72, -0.35, 1.42, 0.20, (-0.18, -0.26), 0.10, 1.98),
        (-0.78, -0.42, 1.08, 0.18, (-0.28, 0.12), 0.00, 2.46),
    ]
    quality = ((6, 13, 12), (5, 8, 8), (4, 5, 6))[lod]
    tube_count, segments, sides = quality
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[tuple[int, ...], int]] = []

    for tube_index, (origin_x, origin_y, height, radius, bend, tilt, phase) in enumerate(layouts[:tube_count]):
        outer_rings: list[list[int]] = []
        inner_rings: list[list[int]] = []
        centers: list[Vector] = []
        for ring in range(segments + 1):
            t = ring / segments
            ease = t * t * (3.0 - 2.0 * t)
            sway = math.sin(t * math.pi) * (0.75 + 0.25 * math.sin(t * math.pi * 1.7 + phase))
            centers.append(Vector((
                origin_x + bend[0] * ease + tilt * t * 0.16,
                origin_y + bend[1] * ease + math.sin(t * math.pi * 1.4 + phase) * 0.055 * sway,
                height * t,
            )))
        for ring, center in enumerate(centers):
            t = ring / segments
            tangent = (centers[min(ring + 1, segments)] - centers[max(ring - 1, 0)]).normalized()
            collar = 1.0 + 0.16 * max(0.0, (t - 0.76) / 0.24) ** 2
            organic = 1.0 + 0.10 * math.sin(t * math.pi * 2.0 + phase) - 0.055 * t
            outer = radius * collar * organic
            wall = radius * (0.22 + 0.025 * math.sin(phase + t * 4.0))
            outside, inside = add_ring_mesh(vertices, faces, center, tangent, outer, outer - wall, sides, phase + t * 0.32, 0.88 + 0.10 * math.sin(phase))
            outer_rings.append(outside)
            inner_rings.append(inside)
        for ring in range(segments):
            for side in range(sides):
                nxt = (side + 1) % sides
                faces.append(((outer_rings[ring][side], outer_rings[ring][nxt], outer_rings[ring + 1][nxt], outer_rings[ring + 1][side]), 0))
                faces.append(((inner_rings[ring][nxt], inner_rings[ring][side], inner_rings[ring + 1][side], inner_rings[ring + 1][nxt]), 1))
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append(((outer_rings[0][nxt], outer_rings[0][side], inner_rings[0][side], inner_rings[0][nxt]), 0))
            faces.append(((outer_rings[-1][side], outer_rings[-1][nxt], inner_rings[-1][nxt], inner_rings[-1][side]), 0))

    # A low, lopsided mud root mass makes the tubes read as a wetland colony rather than pipes.
    base_sides = (18, 12, 8)[lod]
    base_rings: list[list[int]] = []
    for level, (scale, z) in enumerate(((1.0, 0.025), (0.82, 0.19), (0.54, 0.32))):
        ring: list[int] = []
        for side in range(base_sides):
            angle = side * math.tau / base_sides
            wobble = 1.0 + 0.14 * math.sin(angle * 3.0 + 0.6) + 0.08 * math.cos(angle * 5.0 - 0.4)
            radius = scale * wobble
            ring.append(len(vertices))
            vertices.append((math.cos(angle) * radius * 1.22, math.sin(angle) * radius * 0.91, z + 0.025 * math.sin(angle * 2.0)))
        base_rings.append(ring)
    center_index = len(vertices)
    vertices.append((0.0, 0.0, 0.36))
    for level in range(len(base_rings) - 1):
        for side in range(base_sides):
            nxt = (side + 1) % base_sides
            faces.append(((base_rings[level][side], base_rings[level][nxt], base_rings[level + 1][nxt], base_rings[level + 1][side]), 0))
    for side in range(base_sides):
        nxt = (side + 1) % base_sides
        faces.append(((base_rings[-1][side], base_rings[-1][nxt], center_index), 0))

    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(vertices, [], [face for face, _ in faces])
    mesh.materials.append(bpy.data.materials["M_MarshTubeWet"])
    mesh.materials.append(bpy.data.materials["M_MarshTubeCavity"])
    mesh.update()
    for polygon, (_, material_index) in zip(mesh.polygons, faces):
        polygon.material_index = material_index
        polygon.use_smooth = lod < 2
    return mesh


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", tube_colony_mesh(asset_id, lod))
    target.objects.link(obj)
    obj.parent = parent
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    obj.hide_render = lod != 0
    return obj


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 1.63))
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    obj.scale = (1.05, 0.83, 1.63)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(collision_material)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "convex"


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewBlackwater", (0.012, 0.021, 0.019), 0.28)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.name = "PREVIEW_Blackwater"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 950, "DISK", 4.8
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.5, -4.8, 6.8)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 650, (0.09, 0.48, 0.36), 3.4
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (4.2, 1.2, 4.6)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (5.1, -6.6, 3.65)
    camera.rotation_euler = (Vector((0, 0, 1.35)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 58
    preview.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.003, 0.009, 0.008, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22


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
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_prop", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"]}, separators=(",", ":"))
    root["fx_asset_id"], root["fx_schema_version"] = args.asset_id, 1
    material("M_MarshTubeWet", (0.075, 0.155, 0.117), 0.29)
    material("M_MarshTubeCavity", (0.004, 0.010, 0.007), 0.86)
    collision_material = material("M_Collision", (0.65, 0.08, 0.05), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        parent = empty(f"VIS_LOD{lod}", target, root)
        make_visual(args.asset_id, lod, target, parent)
    collision_target = collection("COL_SIMPLE", master)
    make_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision_material)
    empty("SOCKETS", collection("SOCKETS", master), root)
    empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = empty("META", collection("META", master), root)
    meta["fx_family"], meta["fx_biome_ids"], meta["fx_wetness"] = "marsh_tube", "blackwater_marsh,thermal_delta", "high"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
