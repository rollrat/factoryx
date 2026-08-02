"""Build the FactoryX great-sail hero landmark.

An eroded silicate sail is held upright by a forked mineral frame.  All panel
surfaces are currently opaque, but named and shaped for a later translucency pass.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_great_sail_a"


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
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
    shader.inputs["Metallic"].default_value = 0.04
    shader.inputs["Alpha"].default_value = 1.0
    return result


def curve(points: list[Vector], t: float) -> Vector:
    u = 1.0 - t
    return points[0] * u**3 + points[1] * (3 * u*u*t) + points[2] * (3*u*t*t) + points[3] * t**3


class Writer:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def add(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, vertices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(vertices)
        self.materials.append(material_index)

    def tube(self, path: list[Vector], radii: list[float], sides: int, material_index: int, phase: float = 0.0) -> None:
        rings: list[list[int]] = []
        for index, center in enumerate(path):
            tangent = (path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]).normalized()
            axis = tangent.cross(Vector((0, 1, 0)))
            if axis.length < 0.01:
                axis = tangent.cross(Vector((0, 0, 1)))
            axis.normalize()
            bitangent = tangent.cross(axis).normalized()
            ring = []
            for side in range(sides):
                angle = phase + math.tau * side / sides
                ridge = 1.0 + 0.09 * math.sin(angle * 3.0 + index * 1.7)
                ring.append(self.add(center + (axis * math.cos(angle) + bitangent * math.sin(angle)) * radii[index] * ridge))
            rings.append(ring)
        self.face(tuple(reversed(rings[0])), material_index)
        self.face(tuple(rings[-1]), material_index)
        for lower, upper in zip(rings, rings[1:]):
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material_index)

    def panel(self, contour: list[tuple[float, float]], base_y: float, thickness: float, material_index: int, panel_index: int, detail: bool) -> None:
        """A thick, curved glass/silicate panel, deliberately not a flat plane."""
        front: list[int] = []
        rear: list[int] = []
        for index, (x, z) in enumerate(contour):
            curl = math.sin(index * 1.73 + panel_index * 0.8) * 0.12 + (x - contour[0][0]) * 0.018
            front.append(self.add((x, base_y + curl - thickness * 0.5, z)))
            rear.append(self.add((x, base_y + curl + thickness * 0.5, z)))
        # Triangulated fans preserve deliberate fracture/facet changes across
        # the broad sail faces and avoid a single, overly perfect polygon.
        average = Vector((sum(point[0] for point in contour) / len(contour), base_y, sum(point[1] for point in contour) / len(contour)))
        center_front = self.add(average + Vector((0.06, -thickness * 0.56, 0.03)))
        center_rear = self.add(average + Vector((-0.04, thickness * 0.56, -0.02)))
        for index in range(len(contour)):
            nxt = (index + 1) % len(contour)
            self.face((center_front, front[index], front[nxt]), material_index)
            self.face((center_rear, rear[nxt], rear[index]), material_index)
            self.face((front[index], rear[index], rear[nxt], front[nxt]), material_index)
        if detail:
            # Mineral edge stubs make torn points and cracks read even from the
            # mid-distance, without alpha cards or flat decal work.
            for index in (1, 4, 7):
                point = Vector((contour[index][0], base_y, contour[index][1]))
                next_point = Vector((contour[(index + 1) % len(contour)][0], base_y, contour[(index + 1) % len(contour)][1]))
                direction = (next_point - point).normalized()
                self.tube([point, point + direction * 0.33], [0.065, 0.025], 5, material_index, phase=index * 0.4)

    def root_mound(self, sides: int, material_index: int) -> None:
        base: list[int] = []
        rim: list[int] = []
        for index in range(sides):
            angle = math.tau * index / sides
            wobble = 1.0 + 0.12 * math.sin(angle * 3 + 0.6)
            base.append(self.add((math.cos(angle) * 1.35 * wobble, math.sin(angle) * 0.88 * wobble, 0)))
            rim.append(self.add((math.cos(angle) * 0.85 * wobble, math.sin(angle) * 0.55 * wobble, 0.42)))
        crown = self.add((0.0, 0.0, 0.72))
        for index in range(sides):
            nxt = (index + 1) % sides
            self.face((base[index], base[nxt], rim[nxt], rim[index]), material_index)
            self.face((rim[index], rim[nxt], crown), material_index)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object, smooth: bool = True) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for material_value in materials:
            mesh.materials.append(material_value)
        for polygon, material_index in zip(mesh.polygons, self.materials):
            polygon.material_index = material_index
            polygon.use_smooth = smooth
        mesh.update()
        result = bpy.data.objects.new(name, mesh)
        target.objects.link(result)
        result.parent = parent
        return result


def path_from_controls(controls: list[Vector], count: int) -> list[Vector]:
    return [curve(controls, step / (count - 1)) for step in range(count)]


def visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> bpy.types.Object:
    writer = Writer()
    writer.root_mound((16, 11, 8)[lod], 0)
    segments = (15, 9, 5)[lod]
    sides = (10, 7, 5)[lod]
    fork_paths = [
        [Vector((-0.48, -0.34, 0.42)), Vector((-0.68, -0.38, 2.7)), Vector((0.20, -0.31, 5.0)), Vector((1.15, -0.25, 8.4))],
        [Vector((0.42, 0.30, 0.42)), Vector((0.20, 0.36, 2.9)), Vector((1.00, 0.31, 5.4)), Vector((2.60, 0.25, 7.95))],
        [Vector((0.02, 0.00, 0.65)), Vector((0.72, 0.01, 2.25)), Vector((2.05, 0.02, 4.25)), Vector((4.10, 0.05, 5.45))],
    ]
    for index, controls in enumerate(fork_paths):
        path = path_from_controls(controls, segments)
        radius_start = (0.48, 0.42, 0.32)[index]
        radii = [radius_start * (1.0 - 0.68 * step / (segments - 1)) for step in range(segments)]
        writer.tube(path, radii, sides, 0, index * 0.47)
    # A few sparse cross-braces integrate the panel roots with the mineral fork.
    if lod < 2:
        braces = [
            (Vector((0.05, -0.03, 2.10)), Vector((1.64, -0.08, 3.35))),
            (Vector((0.43, 0.05, 4.35)), Vector((2.75, 0.02, 5.25))),
            (Vector((0.70, 0.00, 5.82)), Vector((2.15, 0.02, 7.05))),
        ]
        for index, (start, end) in enumerate(braces):
            mid = (start + end) * 0.5 + Vector((0.10, 0.0, 0.12))
            writer.tube([start, mid, end], [0.16, 0.11, 0.075], max(5, sides - 2), 0, index * 0.6)
    panels = [
        # large upper wing, torn toward the prevailing wind (+X)
        ([(0.18, 2.20), (0.58, 5.95), (1.48, 8.72), (2.32, 9.55), (3.22, 8.88), (2.92, 7.45), (4.02, 6.31), (2.55, 5.58), (1.55, 3.06), (0.70, 2.32)], -0.11, 0.28),
        ([(0.08, 1.52), (0.52, 3.86), (1.58, 5.96), (2.80, 6.77), (3.75, 6.08), (3.25, 5.07), (4.18, 4.22), (2.56, 3.62), (1.20, 1.72)], 0.13, 0.25),
        ([(1.06, 3.42), (1.76, 5.36), (3.35, 6.31), (5.15, 5.70), (5.56, 4.62), (4.42, 4.03), (5.08, 2.97), (3.02, 3.08), (1.58, 2.70)], -0.02, 0.23),
        ([(0.18, 0.96), (0.46, 2.34), (1.24, 3.02), (2.48, 2.72), (3.46, 1.70), (2.65, 1.22), (1.76, 1.36), (0.93, 0.78)], 0.24, 0.20),
    ]
    for index, (shape, y, thickness) in enumerate(panels[:(4, 3, 2)[lod]]):
        writer.panel(shape, y, thickness * (1.0 if lod == 0 else 0.84 if lod == 1 else 0.70), 1, index, lod == 0)
    result = writer.object(f"{asset_id}_lod{lod}", materials, target, parent, smooth=(lod == 0))
    result["fx_asset_role"] = "visual"
    result["fx_lod_level"] = lod
    result["fx_shadow_distance"] = (360, 580, 820)[lod]
    result["fx_wind_response"] = "prevailing_x_sail"
    result["fx_translucency_ready"] = True
    return result


def collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, collision_material: bpy.types.Material) -> None:
    writer = Writer()
    writer.root_mound(6, 0)
    # The collision hugs only the climbable mineral fork, leaving the thin sail
    # sheets non-solid for runtime navigation.
    paths = [
        [Vector((-0.38, 0.0, 0.35)), Vector((-0.22, 0.0, 3.2)), Vector((0.75, 0.0, 6.35))],
        [Vector((0.38, 0.0, 0.35)), Vector((0.48, 0.0, 2.75)), Vector((2.18, 0.0, 5.65))],
    ]
    for index, path in enumerate(paths):
        writer.tube(path, [0.36, 0.25, 0.13], 4, 0, index * 0.25)
    result = writer.object(f"{asset_id}_collision", [collision_material], target, parent, smooth=False)
    result.hide_render = True
    result.display_type = "WIRE"
    result["fx_asset_role"] = "collision"
    result["fx_collision_mode"] = "forked_landmark_hull"


def preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    render = collection("PREVIEW", master)
    ground_material = material("M_PreviewGround", (0.018, 0.026, 0.028), 0.96)
    bpy.ops.mesh.primitive_plane_add(size=35, location=(1.9, 0.0, -0.012))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    render.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 1600
    key_data.shape = "DISK"
    key_data.size = 7.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-5.0, -7.0, 12.0)
    render.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy = 1050
    rim_data.color = (0.16, 0.64, 0.75)
    rim_data.size = 5.5
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (8.5, 2.5, 9.0)
    render.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (12.8, -17.0, 9.6)
    camera.rotation_euler = (Vector((1.9, 0.0, 4.75)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 58
    render.objects.link(camera)
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
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.010, 0.013, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32


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
    root["factoryx"] = json.dumps({"schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_landmark", "unitMeters": 1, "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"], "prevailingWind": "+X"}, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "windglass_silicate_landmark"
    root["fx_biome_ids"] = "windglass_basin,thermal_rift"
    root["fx_runtime_tags"] = "landmark,great_sail,windglass,translucency_ready"
    root["fx_removable_by_foundation"] = False
    frame = material("FX_GreatSailMineralFrame", (0.12, 0.16, 0.15), 0.70)
    panel = material("FX_GreatSailOpaquePanel", (0.13, 0.43, 0.47), 0.38)
    collision_material = material("FX_Collision", (0.68, 0.10, 0.08), 1.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        node = empty(f"VIS_LOD{lod}", target, root)
        visual(args.asset_id, lod, target, node, [frame, panel])
    collision_target = collection("COL_SIMPLE", master)
    collision_node = empty("COL_SIMPLE", collision_target, root)
    collision(args.asset_id, collision_target, collision_node, collision_material)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    wind_tip = empty("FX_WIND_TIP", points.users_collection[0], points)
    wind_tip.location = (5.56, 0.0, 4.62)
    points["fx_wind_response"] = "prevailing_x_sail"
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "windglass_silicate_landmark"
    meta["fx_translucency_ready"] = True
    meta["fx_runtime_tags"] = "forked_frame,thick_panels,torn_silhouette"
    preview(scene, master, output)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
