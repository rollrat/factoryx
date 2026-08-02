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
    parser.add_argument("--asset-id", default="rock_windglass_shard_cluster_a")
    return parser.parse_args(args)


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float = 0.0) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return value


def make_empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    target.objects.link(obj)
    obj.parent = parent
    return obj


def shard_cluster_mesh(asset_id: str, lod: int) -> bpy.types.Mesh:
    rng = random.Random(171703 + lod * 919)
    counts = (9, 6, 3)
    sides = (6, 5, 4)
    ring_count = 3 if lod == 0 else 2
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    layouts = [
        (0.00, 0.00, 2.85, 0.42, -0.14, 0.10),
        (-0.52, 0.08, 1.95, 0.31, -0.34, 0.08),
        (0.48, 0.12, 2.15, 0.34, 0.28, 0.06),
        (-0.18, -0.42, 1.48, 0.28, -0.12, -0.30),
        (0.25, -0.38, 1.34, 0.25, 0.22, -0.24),
        (-0.72, -0.22, 1.05, 0.23, -0.42, -0.18),
        (0.71, -0.16, 0.92, 0.22, 0.42, -0.12),
        (-0.55, 0.48, 0.82, 0.20, -0.30, 0.24),
        (0.52, 0.49, 0.72, 0.19, 0.27, 0.26),
    ]

    for shard_index, (origin_x, origin_y, height, radius, lean_x, lean_y) in enumerate(layouts[: counts[lod]]):
        side_count = sides[lod]
        phase = rng.uniform(-math.pi, math.pi)
        base = len(vertices)
        for ring in range(ring_count):
            t = ring / ring_count
            ring_radius = radius * (1.0 - t * (0.34 if lod == 0 else 0.26))
            center_x = origin_x + lean_x * t
            center_y = origin_y + lean_y * t
            z = height * t
            for side in range(side_count):
                angle = phase + side / side_count * math.tau
                asymmetry = 1.0 + math.sin(angle * 2.0 + shard_index) * 0.09 + rng.uniform(-0.045, 0.045)
                vertices.append((
                    center_x + math.cos(angle) * ring_radius * asymmetry,
                    center_y + math.sin(angle) * ring_radius * asymmetry,
                    z,
                ))
        tip_offset = len(vertices)
        vertices.append((
            origin_x + lean_x + rng.uniform(-0.06, 0.06),
            origin_y + lean_y + rng.uniform(-0.06, 0.06),
            height,
        ))
        faces.append(tuple(base + side for side in reversed(range(side_count))))
        for ring in range(ring_count - 1):
            lower = base + ring * side_count
            upper = lower + side_count
            for side in range(side_count):
                next_side = (side + 1) % side_count
                faces.append((lower + side, lower + next_side, upper + next_side, upper + side))
        upper = base + (ring_count - 1) * side_count
        for side in range(side_count):
            faces.append((upper + side, upper + (side + 1) % side_count, tip_offset))

    # A low fractured skirt roots the cluster in the terrain instead of leaving
    # nine mathematically clean prisms touching at a point.
    base_ring = len(vertices)
    base_sides = 10 if lod == 0 else 7 if lod == 1 else 5
    for side in range(base_sides):
        angle = side / base_sides * math.tau
        radius = (1.0 if lod == 0 else 0.94) * (0.88 + rng.random() * 0.24)
        vertices.append((math.cos(angle) * radius, math.sin(angle) * radius * 0.72, rng.uniform(0.01, 0.09)))
    vertices.append((0.0, 0.0, 0.32 if lod == 0 else 0.24))
    center = len(vertices) - 1
    for side in range(base_sides):
        faces.append((base_ring + side, base_ring + (side + 1) % base_sides, center))

    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    return mesh


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, glass: bpy.types.Material) -> None:
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", shard_cluster_mesh(asset_id, lod))
    target.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(glass)
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    for polygon in obj.data.polygons:
        polygon.use_smooth = False


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 1.42))
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    obj.scale = (1.02, 0.82, 1.44)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(collision_material)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "convex"


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewGround", (0.035, 0.052, 0.055), 0.94)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.015))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)

    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 1050
    key_data.shape = "DISK"
    key_data.size = 4.2
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.2, -4.6, 6.2)
    preview.objects.link(key)

    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy = 720
    rim_data.color = (0.12, 0.72, 0.88)
    rim_data.size = 3.0
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (4.0, 1.6, 4.0)
    preview.objects.link(rim)

    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (4.7, -6.2, 3.8)
    camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 62
    preview.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.007, 0.016, 0.021, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.24


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

    glass = material("FX_Windglass", (0.12, 0.34, 0.39), 0.38, 0.08)
    collision_material = material("FX_Collision", (0.7, 0.12, 0.12), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        parent = make_empty(f"VIS_LOD{lod}", target, root)
        make_visual(args.asset_id, lod, target, parent, glass)
    collision_target = collection("COL_SIMPLE", master)
    collision_parent = make_empty("COL_SIMPLE", collision_target, root)
    make_collision(args.asset_id, collision_target, collision_parent, collision_material)
    make_empty("SOCKETS", collection("SOCKETS", master), root)
    make_empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = make_empty("META", collection("META", master), root)
    meta["fx_family"] = "windglass"
    meta["fx_biome_ids"] = "windglass_basin,silicate_sailwood"
    add_preview(scene, master, preview_path)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
