"""Build the FactoryX silicate-sailwood membrane organism.

The plant is an asymmetric holdfast with three swept structural limbs.  Its
opaque membranes are individual, thickened tension-sails rather than a single
billboard, so it has a distinct silhouette from several approach angles.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "flora_sail_membrane_a"


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
    shader.inputs["Alpha"].default_value = 1.0
    result.surface_render_method = "DITHERED"
    return result


class MeshWriter:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.slots: list[int] = []

    def point(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(indices)
        self.slots.append(material_index)

    def tube(self, path: list[Vector], radii: list[float], sides: int, material_index: int, phase: float = 0.0) -> None:
        rings: list[list[int]] = []
        for index, center in enumerate(path):
            tangent = (path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]).normalized()
            axis = tangent.cross(Vector((0.0, 1.0, 0.0)))
            if axis.length < 0.02:
                axis = tangent.cross(Vector((0.0, 0.0, 1.0)))
            axis.normalize()
            bitangent = tangent.cross(axis).normalized()
            ring: list[int] = []
            for side in range(sides):
                angle = phase + math.tau * side / sides
                living_wobble = 1.0 + 0.07 * math.sin(angle * 3.0 + index * 0.58)
                ring.append(self.point(center + (axis * math.cos(angle) + bitangent * math.sin(angle)) * radii[index] * living_wobble))
            rings.append(ring)
        self.face(tuple(reversed(rings[0])), material_index)
        self.face(tuple(rings[-1]), material_index)
        for lower, upper in zip(rings, rings[1:]):
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material_index)

    def sail(self, outline: list[Vector], material_index: int, thickness: float, fullness: float) -> None:
        """Make an opaque, locally curved tension membrane with real edge thickness."""
        front: list[int] = []
        back: list[int] = []
        for point in outline:
            front.append(self.point(point + Vector((0.0, -thickness * 0.5, 0.0))))
            back.append(self.point(point + Vector((0.0, thickness * 0.5, 0.0))))
        center = sum(outline, Vector()) / len(outline)
        # The offset center makes each membrane visibly billow instead of acting
        # as a perfectly flat sheet when light catches it from the side.
        center_front = self.point(center + Vector((0.07, -fullness, 0.055)))
        center_back = self.point(center + Vector((-0.04, fullness * 0.34, -0.025)))
        for side in range(len(outline)):
            nxt = (side + 1) % len(outline)
            self.face((front[side], front[nxt], center_front), material_index)
            self.face((back[nxt], back[side], center_back), material_index)
            self.face((front[side], back[side], back[nxt], front[nxt]), material_index)

    def root_mound(self, sides: int, material_index: int) -> None:
        lower: list[int] = []
        upper: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            wobble = 1.0 + 0.13 * math.sin(angle * 3.0 + 0.4) + 0.05 * math.cos(angle * 5.0)
            lower.append(self.point((math.cos(angle) * 0.82 * wobble, math.sin(angle) * 0.57 * wobble, 0.0)))
            upper.append(self.point((math.cos(angle) * 0.44 * wobble, math.sin(angle) * 0.32 * wobble, 0.32)))
        crown = self.point((0.02, -0.03, 0.52))
        for side in range(sides):
            nxt = (side + 1) % sides
            self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material_index)
            self.face((upper[side], upper[nxt], crown), material_index)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for value in materials:
            mesh.materials.append(value)
        mesh.update()
        for polygon, slot in zip(mesh.polygons, self.slots):
            polygon.material_index = slot
            polygon.use_smooth = slot == 0
        result = bpy.data.objects.new(name, mesh)
        target.objects.link(result)
        result.parent = parent
        return result


def sampled_path(points: list[Vector], count: int) -> list[Vector]:
    """A deterministic quadratic arc through root, shoulder, and wind tip."""
    root, shoulder, tip = points
    result: list[Vector] = []
    for index in range(count):
        t = index / (count - 1)
        result.append(root * ((1 - t) ** 2) + shoulder * (2 * (1 - t) * t) + tip * (t ** 2))
    return result


def build_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    writer = MeshWriter()
    segment_count = (8, 5, 3)[lod]
    tube_sides = (8, 6, 5)[lod]
    writer.root_mound((15, 10, 7)[lod], 0)
    branch_specs = [
        (Vector((-0.22, -0.23, 0.34)), Vector((0.00, -0.24, 1.60)), Vector((0.76, -0.27, 3.04)), 0.135),
        (Vector((0.11, 0.11, 0.36)), Vector((0.31, 0.08, 1.28)), Vector((1.48, 0.18, 2.44)), 0.112),
        (Vector((0.23, 0.34, 0.34)), Vector((0.57, 0.44, 0.95)), Vector((1.96, 0.58, 1.72)), 0.086),
    ]
    branch_count = (3, 3, 2)[lod]
    for index, (root, shoulder, tip, base_radius) in enumerate(branch_specs[:branch_count]):
        path = sampled_path([root, shoulder, tip], segment_count)
        writer.tube(path, [base_radius * (1.0 - 0.63 * step / (segment_count - 1)) for step in range(segment_count)], tube_sides, 0, index * 0.47)
    sails = [
        [Vector((-0.08, -0.28, 0.55)), Vector((0.06, -0.28, 2.18)), Vector((0.75, -0.30, 3.10)), Vector((2.98, -0.42, 2.39)), Vector((2.20, -0.49, 0.80)), Vector((0.57, -0.40, 0.48))],
        [Vector((0.12, 0.08, 0.57)), Vector((0.30, 0.08, 1.68)), Vector((1.43, 0.15, 2.49)), Vector((3.18, 0.27, 1.82)), Vector((2.08, 0.31, 0.62)), Vector((0.67, 0.21, 0.42))],
        [Vector((0.24, 0.38, 0.50)), Vector((0.59, 0.43, 1.18)), Vector((1.88, 0.53, 1.75)), Vector((3.02, 0.69, 1.17)), Vector((1.76, 0.76, 0.34)), Vector((0.61, 0.59, 0.31))],
        [Vector((-0.17, -0.62, 0.42)), Vector((0.04, -0.66, 1.18)), Vector((0.70, -0.73, 1.76)), Vector((1.85, -0.91, 1.28)), Vector((1.20, -0.99, 0.35)), Vector((0.22, -0.79, 0.28))],
    ]
    sail_count = (4, 3, 2)[lod]
    for index, outline in enumerate(sails[:sail_count]):
        writer.sail(outline, 1, (0.045, 0.035, 0.028)[lod], (0.105, 0.072, 0.045)[lod] + index * 0.008)
    if lod < 2:
        # Sparse edge spars sell the idea that membranes are carried by living
        # frame tissue.  They disappear from LOD2, where the sail silhouettes win.
        for index, outline in enumerate(sails[:sail_count]):
            writer.tube([outline[0], outline[1], outline[2]], [0.046, 0.030, 0.014], 5 if lod == 0 else 4, 0, 0.28 + index)
            # A single diagonal spar per sail stays legible at mid range and
            # establishes the membranes as carried anatomy, not loose sheets.
            diagonal_mid = (outline[0] + outline[3]) * 0.5 + Vector((0.0, -0.045, 0.12))
            writer.tube([outline[0] + Vector((0.0, -0.04, 0.0)), diagonal_mid, outline[3] + Vector((0.0, -0.04, 0.0))], [0.034, 0.021, 0.011], 5 if lod == 0 else 4, 0, 1.04 + index)
            if lod == 0 and index < 3:
                writer.tube([outline[0], outline[5], outline[4]], [0.040, 0.024, 0.012], 5, 0, 0.74 + index)
    if lod == 0:
        # Three non-radial ground tendrils make the holdfast feel rooted instead
        # of leaving an isolated upright prop on the terrain.
        for angle, length in ((-2.55, 0.72), (-1.48, 0.58), (2.67, 0.54)):
            root = Vector((math.cos(angle) * 0.23, math.sin(angle) * 0.18, 0.17))
            tip = root + Vector((math.cos(angle) * length, math.sin(angle) * length * 0.62, -0.11))
            writer.tube([root, (root + tip) * 0.5 + Vector((0.06, 0.0, 0.035)), tip], [0.070, 0.038, 0.016], 6, 0, angle)
    obj = writer.object(f"{asset_id}_lod{lod}", materials, target, parent)
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    obj["fx_shadow_distance"] = (42, 72, 118)[lod]
    obj["fx_wind_response"] = "prevailing_x_sweep"
    obj["fx_runtime_tags"] = "flora,sailwood,membrane,opaque,wind_swept"


def build_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0.62, 0.0, 1.25))
    obj = bpy.context.object
    obj.name = f"{asset_id}_collision"
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj.parent = parent
    obj.scale = (1.28, 0.86, 1.25)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(collision_material)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "convex"


def add_preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", master)
    floor_material = material("M_PreviewGround", (0.024, 0.032, 0.040), 0.94)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0.6, 0.0, -0.016))
    floor = bpy.context.object
    floor.name = "PREVIEW_Ground"
    for owner in list(floor.users_collection):
        owner.objects.unlink(floor)
    preview.objects.link(floor)
    floor.data.materials.append(floor_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 1050, "DISK", 4.5
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-4.2, -4.8, 6.6)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 720, (0.32, 0.54, 0.92), 3.8
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (4.4, 2.4, 4.7)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (5.6, -7.4, 3.9)
    camera.rotation_euler = (Vector((1.12, 0.0, 1.45)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 60
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
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.006, 0.010, 0.020, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.27


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
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_prop", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"], "prevailingWind": "+X"}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "silicate_sailwood"
    root["fx_biome_ids"] = "silicate_sailwood,windglass_basin"
    root["fx_removable_by_foundation"] = True
    root["fx_runtime_tags"] = "environment_prop,flora,membrane,opaque"
    frame = material("FX_SailwoodFrame", (0.12, 0.19, 0.17), 0.62, 0.08)
    membrane = material("FX_SailMembrane", (0.32, 0.48, 0.62), 0.78, 0.02)
    collision = material("FX_Collision", (0.65, 0.08, 0.04), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        build_visual(args.asset_id, lod, target, empty(f"VIS_LOD{lod}", target, root), [frame, membrane])
    collision_target = collection("COL_SIMPLE", master)
    build_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    points["fx_wind_response"] = "prevailing_x_sweep"
    tip = empty("FX_WIND_TIP", points.users_collection[0], points)
    tip.location = (3.18, 0.27, 1.82)
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "silicate_sailwood"
    meta["fx_wind_response"] = "prevailing_x_sweep"
    meta["fx_runtime_tags"] = "flora,sailwood,opaque_membrane,prevailing_wind"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
