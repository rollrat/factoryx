"""Build FactoryX's wind-aligned alien sedimentary plate field."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector


ASSET_ID = "rock_layered_plate_a"


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--asset-id", default=ASSET_ID)
    return parser.parse_args(values)


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    value = bpy.data.objects.new(name, None)
    target.objects.link(value)
    value.parent = parent
    return value


def material(name: str, color: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    return value


class Writer:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_materials: list[int] = []

    def add(self, point: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(point))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(indices)
        self.face_materials.append(material_index)

    def plate(self, center: Vector, length: float, width: float, thickness: float, yaw: float, lift: float, seed: int, top_material: int, side_material: int) -> None:
        """An irregular, genuinely thin slab with a chipped, non-rectangular rim."""
        # The long axis is the common sediment/wind direction (+X), with only
        # small yaw variation across the entire field.
        contour = [
            (-0.54, -0.18), (-0.38, -0.56), (-0.04, -0.61),
            (0.23, -0.52), (0.53, -0.24), (0.49, 0.16),
            (0.34, 0.47), (0.06, 0.55), (-0.21, 0.49),
            (-0.49, 0.24),
        ]
        rotation = Euler((0.0, lift, yaw), "XYZ").to_matrix()
        lower: list[int] = []
        upper: list[int] = []
        for index, (raw_x, raw_y) in enumerate(contour):
            ripple = 1.0 + math.sin((index + 1) * (seed + 1) * 1.71) * 0.055
            local = Vector((raw_x * length * ripple, raw_y * width * ripple, 0.0))
            lower.append(self.add(center + rotation @ (local + Vector((0.0, 0.0, -thickness * 0.5)))))
            upper.append(self.add(center + rotation @ (local + Vector((0.0, 0.0, thickness * 0.5)))))
        self.face(tuple(reversed(lower)), side_material)
        self.face(tuple(upper), top_material)
        for index in range(len(contour)):
            nxt = (index + 1) % len(contour)
            self.face((lower[index], lower[nxt], upper[nxt], upper[index]), side_material)

        # Two shallow, linear bedding scars make the exposed tops read as
        # sedimentary strata, not machined slabs.  They follow the plate axis
        # and are omitted in the distance LODs by the caller.
        if length > 1.4:
            for offset in (-0.20, 0.17):
                a = Vector((-0.29 * length, offset * width, thickness * 0.51))
                b = Vector((0.31 * length, offset * width * 0.83, thickness * 0.51))
                c = b + Vector((0.02, 0.026, 0.002))
                d = a + Vector((-0.02, 0.026, 0.002))
                self.face((self.add(center + rotation @ a), self.add(center + rotation @ b), self.add(center + rotation @ c), self.add(center + rotation @ d)), side_material)

    def holdfast(self, sides: int, material_index: int, compact: bool) -> None:
        bottom: list[int] = []
        upper: list[int] = []
        rise = 0.28 if compact else 0.38
        for index in range(sides):
            angle = math.tau * index / sides
            wobble = 1.0 + 0.14 * math.sin(angle * 3.0 + 0.4) + 0.06 * math.cos(angle * 5.0)
            bottom.append(self.add((math.cos(angle) * 1.14 * wobble, math.sin(angle) * 0.69 * wobble, 0.0)))
            upper.append(self.add((math.cos(angle) * 0.76 * wobble + 0.07, math.sin(angle) * 0.44 * wobble, rise)))
        top = self.add((0.15, 0.02, rise + 0.14))
        for index in range(sides):
            nxt = (index + 1) % sides
            self.face((bottom[index], bottom[nxt], upper[nxt], upper[index]), material_index)
            self.face((upper[index], upper[nxt], top), material_index)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for value in materials:
            mesh.materials.append(value)
        for polygon, material_index in zip(mesh.polygons, self.face_materials):
            polygon.material_index = material_index
            polygon.use_smooth = False
        mesh.update()
        value = bpy.data.objects.new(name, mesh)
        target.objects.link(value)
        value.parent = parent
        return value


def visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> bpy.types.Object:
    writer = Writer()
    writer.holdfast((12, 9, 7)[lod], 1, compact=lod > 0)
    # center X/Y, length, width, thickness, yaw, lift.  All long axes are
    # tightly aligned around +X, while lift and overlap make a plate field.
    plates = [
        ((-0.48, -0.34, 0.36), 2.30, 0.92, 0.15, -0.10, 0.30),
        ((0.06, -0.09, 0.51), 2.72, 1.08, 0.18, 0.05, 0.46),
        ((0.54, 0.34, 0.65), 2.44, 0.93, 0.17, 0.14, 0.55),
        ((-0.12, 0.61, 0.39), 1.92, 0.72, 0.14, -0.16, 0.25),
        ((0.78, -0.57, 0.48), 1.86, 0.70, 0.13, 0.02, 0.39),
        ((1.06, 0.02, 0.82), 1.53, 0.61, 0.12, 0.18, 0.63),
        ((-0.72, 0.18, 0.30), 1.42, 0.60, 0.12, -0.22, 0.18),
    ]
    limits = (7, 5, 3)[lod]
    for index, values in enumerate(plates[:limits]):
        point, length, width, thickness, yaw, lift = values
        writer.plate(Vector(point), length, width, thickness, yaw, lift, index + lod * 9, 0, 1)
    value = writer.object(f"{asset_id}_lod{lod}", materials, target, parent)
    value["fx_asset_role"] = "visual"
    value["fx_lod_level"] = lod
    value["fx_shadow_distance"] = (46, 74, 110)[lod]
    value["fx_wind_response"] = "strata_axis_x"
    return value


def collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, material_value: bpy.types.Material) -> None:
    writer = Writer()
    writer.holdfast(7, 0, compact=True)
    value = writer.object(f"{asset_id}_collision", [material_value], target, parent)
    value.hide_render = True
    value.display_type = "WIRE"
    value["fx_asset_role"] = "collision"
    value["fx_collision_mode"] = "minimal_grounded_hull"


def preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    render_collection = collection("PREVIEW", master)
    ground = material("M_PreviewGround", (0.042, 0.045, 0.039), 0.95)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.012))
    plane = bpy.context.object
    plane.name = "PREVIEW_Ground"
    for owner in list(plane.users_collection):
        owner.objects.unlink(plane)
    render_collection.objects.link(plane)
    plane.data.materials.append(ground)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 1050
    key_data.shape = "DISK"
    key_data.size = 4.6
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.2, -4.7, 6.3)
    render_collection.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy = 520
    rim_data.color = (0.50, 0.32, 0.15)
    rim_data.size = 3.2
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (4.1, 2.2, 4.4)
    render_collection.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (4.7, -6.8, 3.7)
    camera.rotation_euler = (Vector((0.35, 0.0, 0.64)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 60
    render_collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.013, 0.012, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.30


def main() -> None:
    args = arguments()
    source = Path(args.source).resolve()
    output = Path(args.preview).resolve()
    source.parent.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    master = collection(f"FX_{args.asset_id}", scene.collection)
    root = bpy.data.objects.new(f"FX_{args.asset_id}", None)
    master.objects.link(root)
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_prop", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"], "strataDirection": "+X"}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "alien_sedimentary_rock"
    root["fx_biome_ids"] = "ironwind_faults,windglass_basin"
    root["fx_runtime_tags"] = "rock,plates,sedimentary,strata_aligned"
    root["fx_removable_by_foundation"] = True
    top = material("FX_LayeredPlateTop", (0.25, 0.28, 0.24), 0.84)
    strata = material("FX_LayeredPlateStrata", (0.11, 0.13, 0.11), 0.92)
    collision_material = material("FX_Collision", (0.68, 0.10, 0.08), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        node = empty(f"VIS_LOD{lod}", target, root)
        visual(args.asset_id, lod, target, node, [top, strata])
    collision_target = collection("COL_SIMPLE", master)
    collision_node = empty("COL_SIMPLE", collision_target, root)
    collision(args.asset_id, collision_target, collision_node, collision_material)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    points["fx_wind_response"] = "strata_axis_x"
    empty("FX_STRATA_AXIS", points.users_collection[0], points).location = (1.0, 0.0, 0.5)
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "alien_sedimentary_rock"
    meta["fx_runtime_tags"] = "fractured,overlapping_plates,wind_strata"
    preview(scene, master, output)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
