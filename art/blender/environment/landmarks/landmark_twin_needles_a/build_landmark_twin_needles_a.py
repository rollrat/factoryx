from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_twin_needles_a"


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


def material(name: str, color: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    return result


def add_needle(
    vertices: list[tuple[float, float, float]], faces: list[tuple[int, ...]],
    origin: tuple[float, float], height: float, base_radius: float, lean: tuple[float, float],
    phase: float, segments: int, sides: int,
) -> None:
    rings: list[list[int]] = []
    for level in range(segments + 1):
        t = level / segments
        # A wide buttress, a wind-scoured waist and a broken crown create a stable
        # silhouette rather than a mathematically tapered pillar.
        profile = 1.10 - 0.61 * t + 0.16 * math.sin(t * math.pi * 1.8 + phase) + 0.12 * math.exp(-((t - 0.16) / 0.12) ** 2)
        if t > 0.82:
            profile *= 1.0 - (t - 0.82) * 0.35
        center = Vector((
            origin[0] + lean[0] * (t * t * (3.0 - 2.0 * t)) + 0.15 * math.sin(t * math.pi * 2.1 + phase),
            origin[1] + lean[1] * (t * t * (3.0 - 2.0 * t)) + 0.10 * math.cos(t * math.pi * 1.7 + phase),
            height * t,
        ))
        ring: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides
            broad_lobes = 1.0 + 0.19 * math.sin(angle * 3.0 + phase) + 0.080 * math.sin(angle * 7.0 - phase * 2.0)
            # Five recessed longitudinal channels are cut into the actual profile.
            groove = 1.0 - 0.28 * max(0.0, math.sin(angle * 5.0 + phase + 0.34 * math.sin(t * math.pi))) ** 3
            weathering = 1.0 + 0.052 * math.sin(t * 14.0 + angle * 2.0 + phase)
            radius = base_radius * profile * broad_lobes * groove * weathering
            z = center.z + 0.055 * math.sin(angle * 4.0 + phase) * (0.25 + 0.75 * t)
            ring.append(len(vertices))
            vertices.append((center.x + math.cos(angle) * radius, center.y + math.sin(angle) * radius * 0.86, z))
        rings.append(ring)
    for level in range(segments):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((rings[level][side], rings[level][nxt], rings[level + 1][nxt], rings[level + 1][side]))
    lower_center = len(vertices)
    vertices.append((origin[0], origin[1], 0.0))
    upper_center = len(vertices)
    vertices.append((vertices[rings[-1][0]][0], vertices[rings[-1][0]][1], height + 0.12))
    for side in range(sides):
        nxt = (side + 1) % sides
        faces.append((lower_center, rings[0][nxt], rings[0][side]))
        faces.append((rings[-1][side], rings[-1][nxt], upper_center))


def add_bridge_arm(
    vertices: list[tuple[float, float, float]], faces: list[tuple[int, ...]], points: list[tuple[float, float, float]], radii: list[float], sides: int,
) -> None:
    # Rock arches grow from both needles but fail across a sharp central fracture.
    rings: list[list[int]] = []
    for index, point in enumerate(points):
        if index == 0:
            tangent = Vector(points[1]) - Vector(point)
        elif index == len(points) - 1:
            tangent = Vector(point) - Vector(points[index - 1])
        else:
            tangent = Vector(points[index + 1]) - Vector(points[index - 1])
        tangent.normalize()
        up = Vector((0, 0, 1))
        axis_u = tangent.cross(up)
        if axis_u.length < 0.01:
            axis_u = Vector((0, 1, 0))
        axis_u.normalize()
        axis_v = tangent.cross(axis_u).normalized()
        ring: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides + 0.22
            radius = radii[index] * (1.0 + 0.12 * math.sin(angle * 3.0 + index))
            ring.append(len(vertices))
            vertices.append(tuple(Vector(point) + axis_u * math.cos(angle) * radius + axis_v * math.sin(angle) * radius * 0.78))
        rings.append(ring)
    for level in range(len(rings) - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((rings[level][side], rings[level][nxt], rings[level + 1][nxt], rings[level + 1][side]))
    for ring in (rings[0], rings[-1]):
        center = len(vertices)
        vector_sum = sum((Vector(vertices[index]) for index in ring), Vector()) / len(ring)
        vertices.append(tuple(vector_sum))
        for side in range(sides):
            faces.append((center, ring[side], ring[(side + 1) % sides]))


def add_grounded_skirt(vertices: list[tuple[float, float, float]], faces: list[tuple[int, ...]], sides: int) -> None:
    rings: list[list[int]] = []
    for level, (scale, z) in enumerate(((1.0, 0.02), (0.82, 0.22), (0.58, 0.39))):
        ring: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides
            wobble = 1.0 + 0.16 * math.sin(angle * 3.0 + 0.5) + 0.09 * math.sin(angle * 6.0 - 0.8)
            ring.append(len(vertices))
            vertices.append((math.cos(angle) * 2.58 * scale * wobble, math.sin(angle) * 1.72 * scale * wobble, z + 0.035 * math.sin(angle * 2.0)))
        rings.append(ring)
    crown = len(vertices)
    vertices.append((-0.12, 0.0, 0.47))
    for level in range(2):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((rings[level][side], rings[level][nxt], rings[level + 1][nxt], rings[level + 1][side]))
    for side in range(sides):
        faces.append((rings[-1][side], rings[-1][(side + 1) % sides], crown))


def landmark_mesh(asset_id: str, lod: int) -> bpy.types.Mesh:
    quality = ((32, 24, 9), (16, 12, 6), (7, 7, 5))[lod]
    segments, sides, bridge_sides = quality
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    add_grounded_skirt(vertices, faces, (20, 12, 8)[lod])
    add_needle(vertices, faces, (-0.93, -0.06), 7.55, 0.98, (-0.62, 0.16), 0.36, segments, sides)
    add_needle(vertices, faces, (1.02, 0.18), 5.62, 0.79, (0.31, -0.30), 1.71, segments - 2, sides)
    # Offset arms establish an ancient bridge without making a clean, implausible span.
    add_bridge_arm(vertices, faces, [(-0.80, -0.26, 4.24), (-0.22, -0.38, 4.56), (0.17, -0.34, 4.43)], [0.42, 0.31, 0.19], bridge_sides)
    add_bridge_arm(vertices, faces, [(0.47, -0.30, 4.18), (0.84, -0.28, 4.04), (1.12, -0.10, 3.83)], [0.17, 0.29, 0.37], bridge_sides)
    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(bpy.data.materials["M_TwinNeedlesStone"])
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = lod == 1
    return mesh


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object) -> None:
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", landmark_mesh(asset_id, lod))
    target.objects.link(obj)
    obj.parent = parent
    obj["fx_asset_role"], obj["fx_lod_level"] = "visual", lod
    obj.hide_render = lod != 0


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=(-0.10, 0.0, 3.60))
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    obj.scale = (2.15, 1.36, 3.60)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(collision_material)
    obj.hide_render, obj.display_type = True, "WIRE"
    obj["fx_asset_role"], obj["fx_collision_mode"] = "collision", "convex"


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewDust", (0.075, 0.046, 0.029), 0.95)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 1500, "DISK", 6.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-6.0, -6.5, 10.0)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 1000, (0.30, 0.52, 0.80), 5.5
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (5.5, 2.5, 7.0)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (10.2, -13.2, 7.5)
    camera.rotation_euler = (Vector((0, 0, 3.2)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 61
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
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.018, 0.029, 0.052, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28


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
    root["fx_asset_id"], root["fx_schema_version"] = args.asset_id, 1
    material("M_TwinNeedlesStone", (0.26, 0.135, 0.070), 0.73)
    collision_material = material("M_Collision", (0.70, 0.08, 0.05), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        make_visual(args.asset_id, lod, target, empty(f"VIS_LOD{lod}", target, root))
    collision_target = collection("COL_SIMPLE", master)
    make_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision_material)
    empty("SOCKETS", collection("SOCKETS", master), root)
    empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = empty("META", collection("META", master), root)
    meta["fx_family"], meta["fx_landmark_id"], meta["fx_biome_ids"] = "twin_needles", "twin_needles", "ironwind_faults,blackwater_marsh"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
