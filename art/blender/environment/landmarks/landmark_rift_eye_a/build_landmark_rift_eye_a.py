"""Build FactoryX's rift-eye thermal sinkhole landmark."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_rift_eye_a"


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


def material(name: str, color: tuple[float, float, float], roughness: float, emission: float = 0.0) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Emission Color"].default_value = (*color, 1.0)
    shader.inputs["Emission Strength"].default_value = emission
    return value


class Writer:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def add(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(indices)
        self.materials.append(material_index)

    def profile(self, sides: int, radius_x: float, radius_y: float, z: float, phase: float, drift: Vector, safe_approach: bool = False) -> list[int]:
        result: list[int] = []
        for index in range(sides):
            angle = math.tau * index / sides
            fracture = 1.0 + 0.11 * math.sin(angle * 3.0 + phase) + 0.055 * math.cos(angle * 5.0 - phase * 0.7)
            # The near (-Y) side is intentionally lower and broader, creating a
            # readable safe path instead of a uniformly dangerous crater rim.
            near = max(0.0, math.cos(angle + math.pi / 2.0))
            approach_drop = near * (0.46 if safe_approach else 0.13)
            result.append(self.add((
                drift.x + math.cos(angle) * radius_x * fracture,
                drift.y + math.sin(angle) * radius_y * fracture,
                z - approach_drop + 0.10 * math.sin(angle * 4.0 + phase),
            )))
        return result

    def band(self, upper: list[int], lower: list[int], material_index: int) -> None:
        for index in range(len(upper)):
            nxt = (index + 1) % len(upper)
            self.face((upper[index], upper[nxt], lower[nxt], lower[index]), material_index)

    def tube(self, path: list[Vector], radii: list[float], sides: int, material_index: int, cap: bool = True) -> None:
        rings: list[list[int]] = []
        for index, center in enumerate(path):
            tangent = (path[min(index + 1, len(path) - 1)] - path[max(0, index - 1)]).normalized()
            axis = tangent.cross(Vector((0.0, 1.0, 0.0)))
            if axis.length < 0.01:
                axis = tangent.cross(Vector((0.0, 0.0, 1.0)))
            axis.normalize()
            bitangent = tangent.cross(axis).normalized()
            ring: list[int] = []
            for side in range(sides):
                angle = math.tau * side / sides
                facet = 1.0 + 0.08 * math.sin(angle * 3.0 + index)
                ring.append(self.add(center + (axis * math.cos(angle) + bitangent * math.sin(angle)) * radii[index] * facet))
            rings.append(ring)
        if cap:
            self.face(tuple(reversed(rings[0])), material_index)
            self.face(tuple(rings[-1]), material_index)
        for lower, upper in zip(rings, rings[1:]):
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material_index)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object, smooth: bool) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for value in materials:
            mesh.materials.append(value)
        for polygon, material_index in zip(mesh.polygons, self.materials):
            polygon.material_index = material_index
            polygon.use_smooth = smooth
        mesh.update()
        value = bpy.data.objects.new(name, mesh)
        target.objects.link(value)
        value.parent = parent
        return value


def build_rift(writer: Writer, lod: int) -> None:
    sides = (18, 12, 8)[lod]
    rim_outer = writer.profile(sides, 5.6, 4.45, 0.22, 0.1, Vector((0.0, 0.0, 0.0)), safe_approach=True)
    rim_inner = writer.profile(sides, 2.78, 2.23, -0.22, 0.6, Vector((0.05, 0.04, 0.0)), safe_approach=True)
    writer.band(rim_outer, rim_inner, 0)
    # Offset, differently sized rings create a fractured throat that visibly
    # descends in steps rather than reading as a cone or torus.
    layers = [
        (2.22, 1.78, -1.06, 1.4, Vector((-0.13, 0.08, 0.0))),
        (1.68, 1.38, -2.12, 2.1, Vector((0.20, -0.09, 0.0))),
        (1.16, 0.92, -3.38, 2.9, Vector((-0.09, 0.11, 0.0))),
        (0.72, 0.58, -4.82, 3.7, Vector((0.14, 0.02, 0.0))),
    ]
    previous = rim_inner
    for layer_index, (radius_x, radius_y, z, phase, drift) in enumerate(layers[:(4, 3, 2)[lod]]):
        next_ring = writer.profile(sides, radius_x, radius_y, z, phase, drift, safe_approach=(layer_index == 0))
        writer.band(previous, next_ring, 1)
        # Recessed thermal lips catch overhead light in an overview and make
        # each descent step physically readable instead of a single dark hole.
        if lod == 0 or (lod == 1 and layer_index == 0):
            lip_path = [Vector(writer.vertices[vertex]) for vertex in next_ring]
            lip_path.append(lip_path[0].copy())
            writer.tube(lip_path, [0.075] * len(lip_path), 6 if lod == 0 else 5, 1, cap=False)
        previous = next_ring
    if lod < 2:
        # Two internal terraces catch a little light and advertise depth from
        # overhead, while leaving the central shaft open and clearly cavernous.
        for radius_x, radius_y, z, phase, drift in ((1.90, 1.48, -1.38, 0.4, Vector((-0.16, 0.08, 0.0))), (1.30, 1.05, -2.55, 1.6, Vector((0.17, -0.08, 0.0))))[:(2 if lod == 0 else 1)]:
            outer = writer.profile(sides, radius_x, radius_y, z, phase, drift)
            inner = writer.profile(sides, radius_x * 0.72, radius_y * 0.70, z - 0.18, phase + 0.8, drift + Vector((0.06, -0.03, 0.0)))
            writer.band(outer, inner, 1)
    # A dark terminal ring preserves the visible void without fake flat water.
    terminal = writer.profile(sides, 0.46, 0.38, -5.18 if lod == 0 else -3.72, 4.5, Vector((0.08, 0.02, 0.0)))
    center = writer.add((0.08, 0.02, -5.38 if lod == 0 else -3.92))
    for index in range(sides):
        writer.face((terminal[index], terminal[(index + 1) % sides], center), 1)

    # Three vented buttresses stand off the rim.  Their uneven roots make the
    # crater feel formed by mineral pressure, not by a circular cut tool.
    buttresses = [
        [Vector((-3.78, 1.52, 0.10)), Vector((-3.05, 1.12, 0.70)), Vector((-2.36, 0.88, 1.24))],
        [Vector((3.42, 1.88, 0.12)), Vector((2.92, 1.37, 0.68)), Vector((2.26, 1.02, 1.07))],
        [Vector((3.95, -0.78, 0.08)), Vector((3.24, -0.54, 0.56)), Vector((2.56, -0.42, 0.86))],
    ]
    for index, path in enumerate(buttresses[:(3, 2, 1)[lod]]):
        writer.tube(path, [0.62, 0.45, 0.24], (8, 6, 5)[lod], 0)
        if lod == 0:
            vent = [path[0] + Vector((0.0, 0.0, 0.14)), path[1] + Vector((0.08, 0.03, 0.42))]
            writer.tube(vent, [0.16, 0.11], 6, 1, cap=False)


def visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> bpy.types.Object:
    writer = Writer()
    build_rift(writer, lod)
    result = writer.object(f"{asset_id}_lod{lod}", materials, target, parent, smooth=False)
    result["fx_asset_role"] = "visual"
    result["fx_lod_level"] = lod
    result["fx_shadow_distance"] = (360, 560, 820)[lod]
    result["fx_wind_response"] = "thermal_updraft"
    return result


def collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    writer = Writer()
    # Three short barriers defend the side/back rim. The near (-Y) section is
    # intentionally omitted so navigation can enter through the safe approach.
    arcs = [
        [Vector((-4.2, -0.05, 0.18)), Vector((-4.4, 1.70, 0.42)), Vector((-3.32, 3.08, 0.36))],
        [Vector((-1.62, 3.82, 0.28)), Vector((0.36, 4.12, 0.50)), Vector((2.12, 3.38, 0.38))],
        [Vector((3.76, 2.18, 0.22)), Vector((4.28, 0.45, 0.42)), Vector((3.72, -1.15, 0.30))],
    ]
    for path in arcs:
        writer.tube(path, [0.34, 0.37, 0.30], 4, 0)
    result = writer.object(f"{asset_id}_collision", [collision_material], target, parent, smooth=False)
    result.hide_render = True
    result.display_type = "WIRE"
    result["fx_asset_role"] = "collision"
    result["fx_collision_mode"] = "rim_barriers_safe_approach"


def preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    render = collection("PREVIEW", master)
    ground = material("M_PreviewGround", (0.030, 0.026, 0.023), 0.96)
    # Unlike ordinary props, a flat preview floor would seal this below-grade
    # landmark.  Keep a square cutout wider than the fractured rim.
    floor_mesh = bpy.data.meshes.new("PREVIEW_Ground_mesh")
    floor_vertices = [(-17, -17, -0.015), (17, -17, -0.015), (17, 17, -0.015), (-17, 17, -0.015), (-6.2, -5.3, -0.015), (6.2, -5.3, -0.015), (6.2, 5.3, -0.015), (-6.2, 5.3, -0.015)]
    floor_mesh.from_pydata(floor_vertices, [], [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    plane = bpy.data.objects.new("PREVIEW_Ground", floor_mesh)
    render.objects.link(plane)
    plane.data.materials.append(ground)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 1500
    key_data.shape = "DISK"
    key_data.size = 8.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-5.5, -7.5, 12.0)
    render.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy = 720
    rim_data.color = (0.85, 0.22, 0.08)
    rim_data.size = 6.0
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (7.0, 3.0, 7.0)
    render.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    # A higher three-quarter overview exposes the nested throat terraces while
    # retaining the low, navigable near-side approach.
    camera.location = (8.8, -11.8, 14.4)
    camera.rotation_euler = (Vector((0.0, 0.0, -1.35)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 54
    render.objects.link(camera)
    throat_data = bpy.data.lights.new("PREVIEW_ThroatGlow", "POINT")
    throat_data.energy = 430
    throat_data.color = (1.0, 0.22, 0.055)
    throat_data.shadow_soft_size = 1.3
    throat = bpy.data.objects.new("PREVIEW_ThroatGlow", throat_data)
    throat.location = (0.05, 0.02, -2.15)
    render.objects.link(throat)
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
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.009, 0.006, 0.004, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.34


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
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_landmark", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"], "safeApproach": "-Y"}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "thermal_rift_landmark"
    root["fx_biome_ids"] = "thermal_rift,ironwind_faults"
    root["fx_runtime_tags"] = "landmark,rift_eye,cave_descent,safe_approach_y_negative"
    root["fx_removable_by_foundation"] = False
    rim_material = material("FX_RiftRim", (0.17, 0.105, 0.072), 0.92)
    throat_material = material("FX_RiftThroat", (0.22, 0.040, 0.012), 0.78, emission=0.28)
    collision_material = material("FX_Collision", (0.68, 0.10, 0.08), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        node = empty(f"VIS_LOD{lod}", target, root)
        visual(args.asset_id, lod, target, node, [rim_material, throat_material])
    collision_target = collection("COL_SIMPLE", master)
    collision_node = empty("COL_SIMPLE", collision_target, root)
    collision(args.asset_id, collision_target, collision_node, collision_material)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    vent = empty("FX_THERMAL_VENT", points.users_collection[0], points)
    vent.location = (-2.36, 0.88, 1.24)
    points["fx_wind_response"] = "thermal_updraft"
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "thermal_rift_landmark"
    meta["fx_safe_approach"] = "negative_y"
    meta["fx_runtime_tags"] = "fractured_rim,descending_throat,vented_buttresses"
    preview(scene, master, output)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
