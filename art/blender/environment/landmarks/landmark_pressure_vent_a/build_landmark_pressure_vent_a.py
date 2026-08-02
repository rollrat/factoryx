from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_pressure_vent_a"


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
    shader.inputs["Metallic"].default_value = 0.02
    return result


def add_hollow_vent(
    vertices: list[tuple[float, float, float]], faces: list[tuple[tuple[int, ...], int]],
    origin: tuple[float, float], height: float, radius: float, bend: tuple[float, float],
    phase: float, segments: int, sides: int, wall_fraction: float = 0.25,
) -> tuple[float, float, float]:
    outer_rings: list[list[int]] = []
    inner_rings: list[list[int]] = []
    centers: list[Vector] = []
    for level in range(segments + 1):
        t = level / segments
        ease = t * t * (3.0 - 2.0 * t)
        centers.append(Vector((
            origin[0] + bend[0] * ease + 0.08 * math.sin(t * math.pi * 2.0 + phase),
            origin[1] + bend[1] * ease + 0.07 * math.cos(t * math.pi * 1.5 + phase),
            height * t,
        )))
    for level, center in enumerate(centers):
        t = level / segments
        tangent = (centers[min(level + 1, segments)] - centers[max(level - 1, 0)]).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < 0.92 else Vector((1, 0, 0))
        axis_u = tangent.cross(reference).normalized()
        axis_v = tangent.cross(axis_u).normalized()
        collar = 1.0 + 0.19 * max(0.0, (t - 0.76) / 0.24) ** 2
        taper = 1.13 - 0.34 * t + 0.11 * math.sin(t * math.pi * 2.3 + phase)
        outer = radius * collar * taper
        inner = outer * (1.0 - wall_fraction)
        outside: list[int] = []
        inside: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides + phase * 0.16
            mineral_lobe = 1.0 + 0.12 * math.sin(angle * 3.0 + phase) + 0.065 * math.cos(angle * 6.0 - t * 3.0)
            split = 1.0 - 0.20 * max(0.0, math.sin(angle * 4.0 + phase + t * 0.7)) ** 3
            radial = axis_u * math.cos(angle) + axis_v * math.sin(angle) * 0.86
            outside.append(len(vertices))
            crown_break = 0.16 * t ** 8 * math.sin(angle * 3.0 + phase)
            vertices.append(tuple(center + radial * outer * mineral_lobe * split + tangent * crown_break))
            inside.append(len(vertices))
            vertices.append(tuple(center + radial * inner + tangent * crown_break))
        outer_rings.append(outside)
        inner_rings.append(inside)
    for level in range(segments):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append(((outer_rings[level][side], outer_rings[level][nxt], outer_rings[level + 1][nxt], outer_rings[level + 1][side]), 0))
            faces.append(((inner_rings[level][nxt], inner_rings[level][side], inner_rings[level + 1][side], inner_rings[level + 1][nxt]), 1))
    for side in range(sides):
        nxt = (side + 1) % sides
        faces.append(((outer_rings[0][nxt], outer_rings[0][side], inner_rings[0][side], inner_rings[0][nxt]), 0))
        faces.append(((outer_rings[-1][side], outer_rings[-1][nxt], inner_rings[-1][nxt], inner_rings[-1][side]), 0))
    top = centers[-1]
    return top.x, top.y, top.z


def add_pressure_chamber(
    vertices: list[tuple[float, float, float]], faces: list[tuple[tuple[int, ...], int]],
    origin: tuple[float, float], radius: float, height: float, phase: float, rings: int, sides: int,
) -> None:
    bands: list[list[int]] = []
    for level in range(rings + 1):
        t = level / rings
        bulb = math.sin(t * math.pi) ** 0.62
        z = 0.10 + height * t
        band: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides
            irregular = 1.0 + 0.12 * math.sin(angle * 3.0 + phase) + 0.06 * math.sin(angle * 5.0 - level)
            band.append(len(vertices))
            vertices.append((origin[0] + math.cos(angle) * radius * bulb * irregular, origin[1] + math.sin(angle) * radius * bulb * 0.84 * irregular, z))
        bands.append(band)
    for level in range(rings):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append(((bands[level][side], bands[level][nxt], bands[level + 1][nxt], bands[level + 1][side]), 0))


def add_mud_base(vertices: list[tuple[float, float, float]], faces: list[tuple[tuple[int, ...], int]], sides: int) -> None:
    rings: list[list[int]] = []
    for scale, z in ((1.0, 0.018), (0.83, 0.18), (0.57, 0.36)):
        ring: list[int] = []
        for side in range(sides):
            angle = side * math.tau / sides
            wobble = 1.0 + 0.16 * math.sin(angle * 3.0 + 0.4) + 0.09 * math.cos(angle * 6.0)
            ring.append(len(vertices))
            vertices.append((math.cos(angle) * 2.8 * scale * wobble, math.sin(angle) * 2.05 * scale * wobble, z + 0.04 * math.sin(angle * 2.0)))
        rings.append(ring)
    crown = len(vertices)
    vertices.append((0.0, 0.0, 0.46))
    for level in range(2):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append(((rings[level][side], rings[level][nxt], rings[level + 1][nxt], rings[level + 1][side]), 0))
    for side in range(sides):
        faces.append(((rings[-1][side], rings[-1][(side + 1) % sides], crown), 0))


def pressure_vent_mesh(asset_id: str, lod: int) -> tuple[bpy.types.Mesh, tuple[float, float, float]]:
    central_quality = ((18, 18), (11, 12), (7, 8))[lod]
    side_quality = ((10, 12), (6, 8), (4, 6))[lod]
    chamber_quality = ((7, 12), (5, 8), (3, 6))[lod]
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[tuple[int, ...], int]] = []
    add_mud_base(vertices, faces, (20, 13, 9)[lod])
    top = add_hollow_vent(vertices, faces, (0.08, 0.02), 5.35, 0.67, (-0.24, 0.14), 0.42, *central_quality, 0.31)
    for origin, height, radius, bend, phase in [
        ((-1.18, -0.32), 2.35, 0.36, (-0.38, -0.12), 1.2),
        ((0.98, -0.48), 1.82, 0.31, (0.43, -0.08), 2.4),
        ((1.08, 0.68), 1.35, 0.28, (0.18, 0.38), 3.3),
        ((-0.78, 0.92), 1.15, 0.25, (-0.18, 0.36), 4.1),
    ]:
        add_hollow_vent(vertices, faces, origin, height, radius, bend, phase, *side_quality, 0.28)
    for origin, radius, height, phase in [
        ((-0.82, 0.18), 0.72, 1.22, 0.2),
        ((0.67, 0.52), 0.58, 0.98, 1.7),
        ((0.38, -0.88), 0.64, 0.86, 3.3),
    ]:
        add_pressure_chamber(vertices, faces, origin, radius, height, phase, *chamber_quality)
    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(vertices, [], [face for face, _ in faces])
    mesh.materials.append(bpy.data.materials["M_PressureVentMineral"])
    mesh.materials.append(bpy.data.materials["M_PressureVentCavity"])
    mesh.update()
    for polygon, (_, material_index) in zip(mesh.polygons, faces):
        polygon.material_index = material_index
        polygon.use_smooth = lod == 1
    return mesh, top


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object) -> tuple[float, float, float] | None:
    mesh, top = pressure_vent_mesh(asset_id, lod)
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", mesh)
    target.objects.link(obj)
    obj.parent = parent
    obj["fx_asset_role"], obj["fx_lod_level"] = "visual", lod
    obj.hide_render = lod != 0
    return top if lod == 0 else None


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=(0, 0, 2.65))
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    obj.scale = (2.18, 1.62, 2.65)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(collision_material)
    obj.hide_render, obj.display_type = True, "WIRE"
    obj["fx_asset_role"], obj["fx_collision_mode"] = "collision", "convex"


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewBlackwater", (0.008, 0.015, 0.014), 0.31)
    bpy.ops.mesh.primitive_plane_add(size=26, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.name = "PREVIEW_Blackwater"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 1250, "DISK", 6.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-6.2, -6.4, 8.5)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 950, (0.12, 0.60, 0.48), 4.0
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (5.5, 2.5, 6.5)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (8.7, -10.6, 5.7)
    camera.rotation_euler = (Vector((0, 0, 2.25)) - camera.location).to_track_quat("-Z", "Y").to_euler()
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
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.003, 0.010, 0.012, 1)
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
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_landmark", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"]}, separators=(",", ":"))
    root["fx_asset_id"], root["fx_schema_version"] = args.asset_id, 1
    material("M_PressureVentMineral", (0.105, 0.165, 0.126), 0.46)
    material("M_PressureVentCavity", (0.002, 0.008, 0.006), 0.91)
    collision_material = material("M_Collision", (0.70, 0.08, 0.05), 1.0)
    plume_top = None
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        top = make_visual(args.asset_id, lod, target, empty(f"VIS_LOD{lod}", target, root))
        plume_top = top if top is not None else plume_top
    collision_target = collection("COL_SIMPLE", master)
    make_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision_material)
    sockets = collection("SOCKETS", master)
    socket_parent = empty("SOCKETS", sockets, root)
    plume = empty("SOCKET_PLUME_TOP", sockets, socket_parent)
    plume.location = plume_top if plume_top else (0.0, 0.0, 5.4)
    plume["fx_socket_type"], plume["fx_effect"] = "plume", "pressure_steam"
    empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = empty("META", collection("META", master), root)
    meta["fx_family"], meta["fx_landmark_id"], meta["fx_biome_ids"], meta["fx_plume_socket"] = "pressure_vent", "pressure_vent", "blackwater_marsh,thermal_delta", "SOCKET_PLUME_TOP"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
