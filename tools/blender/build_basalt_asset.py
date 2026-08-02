from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--asset-id", default="rock_basalt_medium_a")
    return parser.parse_args(args)


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def material(name: str, color: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.04
    return value


def link_only(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)


def make_empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    target.objects.link(obj)
    obj.parent = parent
    return obj


def deform_rock(obj: bpy.types.Object, seed: int, lod: int) -> None:
    rng = random.Random(seed)
    for vertex in obj.data.vertices:
        point = vertex.co.copy()
        direction = point.normalized()
        angle = math.atan2(direction.y, direction.x)
        strata = math.sin(direction.z * 9.5 + angle * 2.7) * 0.075
        fracture = math.sin(angle * 5.0 + direction.z * 3.0) * 0.09
        jitter = (rng.random() - 0.5) * (0.12 if lod == 0 else 0.08)
        radial = 1.0 + strata + fracture + jitter
        point *= radial
        point.x *= 1.26
        point.y *= 0.92
        point.z *= 1.08
        point.x += point.z * 0.12
        if point.z < -0.58:
            point.z = -0.58 + (point.z + 0.58) * 0.12
        vertex.co = point
    minimum = min(vertex.co.z for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z -= minimum
    obj.data.update()


def make_rock(
    asset_id: str,
    lod: int,
    subdivisions: int,
    target: bpy.types.Collection,
    parent: bpy.types.Object,
    rock_material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0)
    obj = bpy.context.object
    obj.name = f"{asset_id}_lod{lod}"
    link_only(obj, target)
    obj.parent = parent
    deform_rock(obj, 171703 + lod * 97, lod)
    obj.data.materials.append(rock_material)
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    for polygon in obj.data.polygons:
        polygon.use_smooth = lod < 2
    if lod == 0:
        bevel = obj.modifiers.new("FX_EdgeSoftening", "BEVEL")
        bevel.width = 0.025
        bevel.segments = 1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def make_collision(
    asset_id: str,
    target: bpy.types.Collection,
    parent: bpy.types.Object,
    collision_material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0)
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    link_only(obj, target)
    obj.parent = parent
    obj.scale = (1.14, 0.82, 0.94)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    minimum = min(vertex.co.z for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z -= minimum
    obj.data.materials.append(collision_material)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "convex"
    return obj


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, source: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewGround", (0.035, 0.052, 0.055), 0.94)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.015))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    link_only(ground, preview)
    ground.data.materials.append(ground_material)

    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 900
    key_data.shape = "DISK"
    key_data.size = 4.5
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.2, -4.8, 6.5)
    preview.objects.link(key)

    fill_data = bpy.data.lights.new("PREVIEW_Fill", "AREA")
    fill_data.energy = 480
    fill_data.color = (0.18, 0.62, 0.72)
    fill_data.size = 3.5
    fill = bpy.data.objects.new("PREVIEW_Fill", fill_data)
    fill.location = (4.5, 1.0, 3.2)
    preview.objects.link(fill)

    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (4.6, -5.8, 3.7)
    camera.rotation_euler = (Vector((0, 0, 0.8)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 58
    preview.objects.link(camera)
    scene.camera = camera

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(source)
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.018, 0.022, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28


def main() -> None:
    args = arguments()
    source_path = Path(args.source).resolve()
    preview_path = Path(args.preview).resolve()
    source_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    master = collection(f"FX_{args.asset_id}", scene.collection)
    root = bpy.data.objects.new(f"FX_{args.asset_id}", None)
    master.objects.link(root)
    root["factoryx"] = json.dumps({
        "schemaVersion": 1,
        "assetId": args.asset_id,
        "kind": "environment_prop",
        "unitMeters": 1,
        "pivotConvention": "ground_center",
        "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"],
        "collisionNodes": ["COL_SIMPLE"],
    }, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_schema_version"] = 1

    rock_material = material("FX_Basalt", (0.105, 0.135, 0.14), 0.9)
    collision_material = material("FX_Collision", (0.7, 0.12, 0.12), 1.0)
    for lod, subdivisions in enumerate((3, 2, 1)):
        target = collection(f"VIS_LOD{lod}", master)
        parent = make_empty(f"VIS_LOD{lod}", target, root)
        make_rock(args.asset_id, lod, subdivisions, target, parent, rock_material)

    collision_target = collection("COL_SIMPLE", master)
    collision_parent = make_empty("COL_SIMPLE", collision_target, root)
    make_collision(args.asset_id, collision_target, collision_parent, collision_material)
    make_empty("SOCKETS", collection("SOCKETS", master), root)
    make_empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = make_empty("META", collection("META", master), root)
    meta["fx_family"] = "basalt"
    meta["fx_biome_ids"] = "windglass_basin,ironwind_faults,thermal_rift"

    add_preview(scene, master, preview_path)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
