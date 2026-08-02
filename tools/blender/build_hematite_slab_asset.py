from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "rock_hematite_slab_a"


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--asset-id", default=ASSET_ID)
    return parser.parse_args(args)


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    parent.children.link(result)
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


def make_empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    result = bpy.data.objects.new(name, None)
    target.objects.link(result)
    result.parent = parent
    return result


def slab_mesh(asset_id: str, lod: int) -> tuple[bpy.types.Mesh, list[int]]:
    """Build fractured, stacked low slabs rather than a deformed primitive.

    Each stratum is an asymmetric six-sided prism.  Layer offsets, changing
    footprint, and a common diagonal shear give the cluster geological rhythm
    while its near-horizontal ledges remain clearly readable at distance.
    """
    layers_by_lod = (
        [
            # cx, cy, base z, x radius, y radius, thickness, clockwise shear, oxide material
            (-0.10, 0.00, 0.00, 1.48, 0.73, 0.30, -0.15, 0),
            (0.08, -0.04, 0.25, 1.34, 0.68, 0.24, 0.20, 1),
            (-0.20, 0.05, 0.47, 1.25, 0.62, 0.28, -0.28, 0),
            (0.13, 0.02, 0.71, 1.08, 0.56, 0.23, 0.31, 1),
            (-0.08, -0.02, 0.94, 0.98, 0.49, 0.25, -0.24, 0),
            (0.22, 0.06, 1.17, 0.83, 0.43, 0.27, 0.22, 1),
            (-0.02, 0.02, 1.44, 0.69, 0.37, 0.30, -0.18, 0),
            (-0.21, 0.10, 1.70, 0.51, 0.31, 0.24, 0.26, 1),
            (0.12, -0.08, 0.63, 0.57, 0.34, 0.16, -0.36, 0),
            (-0.73, -0.17, 0.28, 0.52, 0.29, 0.17, 0.18, 1),
        ],
        [
            (-0.10, 0.00, 0.00, 1.48, 0.73, 0.30, -0.15, 0),
            (-0.20, 0.05, 0.47, 1.25, 0.62, 0.28, -0.28, 0),
            (0.13, 0.02, 0.71, 1.08, 0.56, 0.23, 0.31, 1),
            (-0.08, -0.02, 0.94, 0.98, 0.49, 0.25, -0.24, 0),
            (0.22, 0.06, 1.17, 0.83, 0.43, 0.27, 0.22, 1),
            # Keep the same crown landmark as LOD0; LOD1 removes an
            # intermediate layer rather than shortening the asset silhouette.
            (-0.21, 0.10, 1.70, 0.51, 0.31, 0.24, 0.26, 1),
        ],
        [
            (-0.10, 0.00, 0.00, 1.48, 0.73, 0.30, -0.15, 0),
            # Far LOD carries a base, a mid shelf, and the true crown.  This
            # deliberately preserves the full footprint and vertical profile.
            (-0.08, -0.02, 0.94, 0.98, 0.49, 0.25, -0.24, 0),
            (-0.21, 0.10, 1.70, 0.51, 0.31, 0.24, 0.26, 1),
        ],
    )
    # Six deliberately irregular perimeter samples.  These preserve a broad,
    # bedded silhouette without reading as either a cube or a crystal.
    outline = (
        (-1.00, -0.38), (-0.60, -0.91), (0.16, -0.83), (0.98, -0.42),
        (0.79, 0.33), (0.28, 0.87), (-0.57, 0.72), (-0.94, 0.22),
    )
    side_count = len(outline)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    face_materials: list[int] = []
    for index, (cx, cy, base, rx, ry, thickness, shear, material_index) in enumerate(layers_by_lod[lod]):
        start = len(vertices)
        angle = math.radians(-8.0 + index * 2.2)
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        for z, top in ((base, False), (base + thickness, True)):
            for point_index, (ox, oy) in enumerate(outline):
                # A planar but diagonally tilted top and a less even fractured underside.
                twist = (point_index - 2.5) * 0.014
                local_x = ox * rx
                local_y = oy * ry
                x = cx + local_x * cos_a - local_y * sin_a
                y = cy + local_x * sin_a + local_y * cos_a
                z_offset = (local_x * shear * 0.075) + (local_y * 0.028) + (twist if top else 0.0)
                vertices.append((x, y, max(0.0, z + z_offset)))
        # Bottom and top are n-gons; the side walls are the visual fracture planes.
        faces.append(tuple(start + side for side in reversed(range(side_count))))
        face_materials.append(0)
        faces.append(tuple(start + side_count + side for side in range(side_count)))
        face_materials.append(material_index)
        for side in range(side_count):
            next_side = (side + 1) % side_count
            faces.append((start + side, start + next_side, start + side_count + next_side, start + side_count + side))
            face_materials.append(material_index if side in (1, 4, 6) else 0)

    mesh = bpy.data.meshes.new(f"{asset_id}_lod{lod}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    return mesh, face_materials


def make_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    mesh, face_materials = slab_mesh(asset_id, lod)
    obj = bpy.data.objects.new(f"{asset_id}_lod{lod}", mesh)
    target.objects.link(obj)
    obj.parent = parent
    for value in materials:
        mesh.materials.append(value)
    for polygon, material_index in zip(mesh.polygons, face_materials):
        polygon.material_index = material_index
        polygon.use_smooth = False
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    obj["fx_shadow_distance"] = 38
    obj["fx_runtime_tags"] = "rock,hematite,layered,oxidized"
    if lod < 2:
        bevel = obj.modifiers.new("FX_FractureEdgeSoftening", "BEVEL")
        bevel.width = 0.018 if lod == 0 else 0.012
        bevel.segments = 1


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    outline = ((-1.48, -0.44), (-0.78, -0.79), (0.98, -0.66), (1.38, 0.18), (0.54, 0.69), (-1.12, 0.58))
    vertices = [(x, y, 0.0) for x, y in outline] + [(x, y, 1.70) for x, y in outline]
    faces: list[tuple[int, ...]] = [tuple(reversed(range(6))), tuple(range(6, 12))]
    faces.extend((side, (side + 1) % 6, 6 + (side + 1) % 6, 6 + side) for side in range(6))
    mesh = bpy.data.meshes.new(f"{asset_id}_collision_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"{asset_id}_collision", mesh)
    target.objects.link(obj)
    obj.parent = parent
    mesh.materials.append(collision_material)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "convex"


def add_preview(scene: bpy.types.Scene, root_collection: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", root_collection)
    ground_material = material("M_PreviewGround", (0.027, 0.031, 0.028), 0.96, 0.0)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.012))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)

    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 900
    key_data.shape = "DISK"
    key_data.size = 4.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.0, -4.6, 5.8)
    preview.objects.link(key)
    fill_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    fill_data.energy = 480
    fill_data.color = (0.64, 0.18, 0.07)
    fill_data.size = 3.0
    fill = bpy.data.objects.new("PREVIEW_Rim", fill_data)
    fill.location = (3.9, 1.5, 3.8)
    preview.objects.link(fill)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (4.5, -6.1, 3.2)
    camera.rotation_euler = (Vector((0.0, 0.0, 0.85)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 58
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
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.009, 0.012, 0.011, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28


def main() -> None:
    args = arguments()
    source = Path(args.source).resolve()
    preview = Path(args.preview).resolve()
    source.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    master = collection(f"FX_{args.asset_id}", scene.collection)
    root = bpy.data.objects.new(f"FX_{args.asset_id}", None)
    master.objects.link(root)
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_prop", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"]}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "hematite"
    root["fx_biome_ids"] = "hematite_crown,ironwind_faults"
    root["fx_removable_by_foundation"] = True
    root["fx_runtime_tags"] = "environment_prop,rock,hematite,slab"

    iron = material("FX_Hematite_Iron", (0.075, 0.060, 0.055), 0.70, 0.30)
    oxide = material("FX_Hematite_Oxide", (0.205, 0.057, 0.026), 0.84, 0.10)
    collision_material = material("FX_Collision", (0.65, 0.10, 0.06), 1.0, 0.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        parent = make_empty(f"VIS_LOD{lod}", target, root)
        make_visual(args.asset_id, lod, target, parent, [iron, oxide])
    collision_target = collection("COL_SIMPLE", master)
    collision_parent = make_empty("COL_SIMPLE", collision_target, root)
    make_collision(args.asset_id, collision_target, collision_parent, collision_material)
    make_empty("SOCKETS", collection("SOCKETS", master), root)
    make_empty("FX_POINTS", collection("FX_POINTS", master), root)
    meta = make_empty("META", collection("META", master), root)
    meta["fx_family"] = "hematite"
    meta["fx_biome_ids"] = "hematite_crown,ironwind_faults"
    meta["fx_asset_version"] = 1
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
