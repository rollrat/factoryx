"""Build the FactoryX flora_wind_fan_a vegetation prop.

The organism is deliberately asymmetric: four fleshy support ribs grow from a
low, rooted holdfast and sweep toward +X, the declared prevailing-wind
direction.  Broad, opaque fronds grow on just one side of each rib.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "flora_wind_fan_a"


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--asset-id", default=ASSET_ID)
    return parser.parse_args(values)


def create_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    result = bpy.data.collections.new(name)
    parent.children.link(result)
    return result


def make_empty(name: str, target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
    result = bpy.data.objects.new(name, None)
    target.objects.link(result)
    result.parent = parent
    return result


def make_material(name: str, color: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    # This asset intentionally uses opaque sheets until a foliage alpha pass is
    # available in the runtime material library.
    shader.inputs["Alpha"].default_value = 1.0
    result.surface_render_method = "DITHERED"
    return result


def bezier4(points: list[Vector], t: float) -> Vector:
    one = 1.0 - t
    return (points[0] * (one ** 3) + points[1] * (3 * one * one * t) +
            points[2] * (3 * one * t * t) + points[3] * (t ** 3))


class MeshWriter:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def point(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material: int) -> None:
        self.faces.append(indices)
        self.materials.append(material)

    def tube(self, path: list[Vector], radii: list[float], sides: int, material: int, phase: float = 0.0) -> None:
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
                # A slight organic flattening stops the support tissue reading
                # as a manufactured cylinder.
                organic = 1.0 + 0.08 * math.sin(angle * 3.0 + index * 0.7)
                ring.append(self.point(center + (axis * math.cos(angle) + bitangent * math.sin(angle)) * radii[index] * organic))
            rings.append(ring)
        self.face(tuple(reversed(rings[0])), material)
        self.face(tuple(rings[-1]), material)
        for lower, upper in zip(rings, rings[1:]):
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material)

    def blade(self, path: list[Vector], widths: list[float], material: int, thickness: float) -> None:
        """A thick, one-sided wind-swept frond around a structural center rib."""
        left_front: list[int] = []
        right_front: list[int] = []
        left_back: list[int] = []
        right_back: list[int] = []
        for index, center in enumerate(path):
            tangent = (path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]).normalized()
            # Fronds occupy X/Z planes.  The Y shaping is a wind curl, rather
            # than a symmetric billboard placed around the rib.
            normal = Vector((-tangent.z, 0.0, tangent.x)).normalized()
            curl = Vector((0.0, -0.045 - 0.055 * math.sin(index * 0.9), 0.0))
            edge_a = center + normal * widths[index] + curl
            edge_b = center - normal * (widths[index] * 0.58) + curl * 0.35
            left_front.append(self.point(edge_a + Vector((0.0, -thickness * 0.5, 0.0))))
            right_front.append(self.point(edge_b + Vector((0.0, -thickness * 0.5, 0.0))))
            left_back.append(self.point(edge_a + Vector((0.0, thickness * 0.5, 0.0))))
            right_back.append(self.point(edge_b + Vector((0.0, thickness * 0.5, 0.0))))
        for index in range(len(path) - 1):
            self.face((left_front[index], left_front[index + 1], right_front[index + 1], right_front[index]), material)
            self.face((right_back[index], right_back[index + 1], left_back[index + 1], left_back[index]), material)
            self.face((left_front[index], left_back[index], left_back[index + 1], left_front[index + 1]), material)
            self.face((right_front[index + 1], right_back[index + 1], right_back[index], right_front[index]), material)
        self.face((left_front[0], right_front[0], right_back[0], left_back[0]), material)
        self.face((right_front[-1], left_front[-1], left_back[-1], right_back[-1]), material)

    def mound(self, sides: int, material: int, tall: bool) -> None:
        bottom: list[int] = []
        shoulder: list[int] = []
        crown: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            wobble = 1.0 + 0.13 * math.sin(angle * 3.0 + 0.5) + 0.05 * math.cos(angle * 5.0)
            bottom.append(self.point((math.cos(angle) * 0.88 * wobble, math.sin(angle) * 0.57 * wobble, 0.0)))
            shoulder.append(self.point((math.cos(angle) * 0.72 * wobble, math.sin(angle) * 0.45 * wobble, 0.19 if tall else 0.13)))
            crown.append(self.point((math.cos(angle) * 0.36 * wobble, math.sin(angle) * 0.27 * wobble, 0.52 if tall else 0.33)))
        top = self.point((0.08, -0.03, 0.63 if tall else 0.38))
        for side in range(sides):
            nxt = (side + 1) % sides
            self.face((bottom[side], bottom[nxt], shoulder[nxt], shoulder[side]), material)
            self.face((shoulder[side], shoulder[nxt], crown[nxt], crown[side]), material)
            self.face((crown[side], crown[nxt], top), material)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.clear()
        for value in materials:
            mesh.materials.append(value)
        for polygon, slot in zip(mesh.polygons, self.materials):
            polygon.material_index = slot
            polygon.use_smooth = True
        mesh.update()
        result = bpy.data.objects.new(name, mesh)
        target.objects.link(result)
        result.parent = parent
        return result


def fan_paths(detail: int) -> list[list[Vector]]:
    # Four structural ribs; their root positions are deliberately irregular,
    # while every terminal point leans downwind (+X).
    specifications = [
        (Vector((-0.28, -0.38, 0.38)), Vector((0.10, -0.62, 1.34)), Vector((1.34, -0.58, 2.10)), Vector((2.68, -0.48, 2.12))),
        (Vector((-0.12, -0.12, 0.42)), Vector((0.12, -0.24, 1.72)), Vector((1.52, -0.18, 2.78)), Vector((3.28, -0.16, 2.67))),
        (Vector((0.13, 0.18, 0.40)), Vector((0.26, 0.21, 1.48)), Vector((1.38, 0.30, 2.30)), Vector((2.87, 0.36, 2.22))),
        (Vector((0.29, 0.42, 0.37)), Vector((0.45, 0.57, 1.10)), Vector((1.18, 0.67, 1.74)), Vector((2.27, 0.74, 1.71))),
    ]
    return [[bezier4(list(specification), step / (detail - 1)) for step in range(detail)] for specification in specifications]


def build_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> bpy.types.Object:
    writer = MeshWriter()
    segments = (10, 6, 4)[lod]
    paths = fan_paths(segments)
    writer.mound((14, 10, 7)[lod], 1, tall=True)
    for rib_index, path in enumerate(paths):
        rib_radius = [0.115 * (1.0 - 0.58 * index / (segments - 1)) for index in range(segments)]
        writer.tube(path, rib_radius, (7, 5, 4)[lod], 0, phase=rib_index * 0.43)
        broadness = (0.48, 0.39, 0.30, 0.23)[rib_index]
        widths = [broadness * math.sin(math.pi * index / (segments - 1)) ** 0.72 for index in range(segments)]
        writer.blade(path, widths, 1, (0.055, 0.042, 0.032)[lod])
        if lod == 0 and rib_index < 3:
            # Two short branching veins make the membrane anatomical instead of
            # a flat graphic fan; they are removed progressively at distance.
            for start_index in (3, 5):
                root = path[start_index]
                tangent = (path[start_index + 1] - path[start_index - 1]).normalized()
                normal = Vector((-tangent.z, 0.0, tangent.x)).normalized()
                end = root + normal * widths[start_index] * 0.91 + Vector((0.14, -0.015, -0.05))
                writer.tube([root, (root + end) * 0.5 + Vector((0.02, 0.0, 0.035)), end], [0.032, 0.022, 0.012], 5, 0)
    if lod == 0:
        # Root tendrils only matter up close.  They visually lock the holdfast
        # into the terrain without turning the prop into a radial rosette.
        for angle, length in ((-2.55, 0.78), (-1.63, 0.61), (2.68, 0.55)):
            start = Vector((math.cos(angle) * 0.26, math.sin(angle) * 0.20, 0.16))
            end = start + Vector((math.cos(angle) * length, math.sin(angle) * length * 0.62, -0.10))
            writer.tube([start, (start + end) * 0.5 + Vector((0.08, 0.0, 0.03)), end], [0.075, 0.042, 0.018], 6, 0)
    result = writer.object(f"{asset_id}_lod{lod}", materials, target, parent)
    result["fx_asset_role"] = "visual"
    result["fx_lod_level"] = lod
    result["fx_shadow_distance"] = (42, 70, 105)[lod]
    result["fx_wind_response"] = "prevailing_x_sweep"
    return result


def build_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, material: bpy.types.Material) -> None:
    writer = MeshWriter()
    writer.mound(7, 0, tall=False)
    result = writer.object(f"{asset_id}_collision", [material], target, parent)
    result["fx_asset_role"] = "collision"
    result["fx_collision_mode"] = "minimal_grounded_hull"
    result.hide_render = True
    result.display_type = "WIRE"


def add_preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    preview = create_collection("PREVIEW", master)
    floor_material = make_material("M_PreviewGround", (0.025, 0.035, 0.030), 0.96)
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0.35, 0.0, -0.012))
    floor = bpy.context.object
    floor.name = "PREVIEW_Ground"
    for owner in list(floor.users_collection):
        owner.objects.unlink(floor)
    preview.objects.link(floor)
    floor.data.materials.append(floor_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 950
    key_data.shape = "DISK"
    key_data.size = 4.5
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-3.8, -4.4, 6.8)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy = 650
    rim_data.color = (0.25, 0.62, 0.48)
    rim_data.size = 3.5
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (4.5, 1.8, 3.8)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (5.7, -7.2, 3.8)
    camera.rotation_euler = (Vector((0.95, 0.02, 1.38)) - camera.location).to_track_quat("-Z", "Y").to_euler()
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
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.014, 0.012, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.30


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
    master = create_collection(f"FX_{args.asset_id}", scene.collection)
    root = bpy.data.objects.new(f"FX_{args.asset_id}", None)
    master.objects.link(root)
    root["factoryx"] = json.dumps({
        "schemaVersion": 1, "assetId": args.asset_id, "kind": "environment_prop",
        "unitMeters": 1, "pivotConvention": "ground_center",
        "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"], "collisionNodes": ["COL_SIMPLE"],
        "prevailingWind": "+X",
    }, separators=(",", ":"))
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "alien_vegetation"
    root["fx_biome_ids"] = "windglass_basin,ironwind_faults"
    root["fx_runtime_tags"] = "vegetation,wind_swept,opaque"
    root["fx_removable_by_foundation"] = True
    support = make_material("FX_WindFanSupport", (0.20, 0.105, 0.055), 0.82)
    membrane = make_material("FX_WindFanMembrane", (0.12, 0.31, 0.17), 0.72)
    collision_material = make_material("FX_Collision", (0.68, 0.10, 0.08), 1.0)
    for lod in range(3):
        target = create_collection(f"VIS_LOD{lod}", master)
        parent = make_empty(f"VIS_LOD{lod}", target, root)
        build_visual(args.asset_id, lod, target, parent, [support, membrane])
    collision_target = create_collection("COL_SIMPLE", master)
    collision_parent = make_empty("COL_SIMPLE", collision_target, root)
    build_collision(args.asset_id, collision_target, collision_parent, collision_material)
    make_empty("SOCKETS", create_collection("SOCKETS", master), root)
    fx_points = make_empty("FX_POINTS", create_collection("FX_POINTS", master), root)
    fx_points["fx_wind_response"] = "prevailing_x_sweep"
    spore = make_empty("FX_WIND_TIP", fx_points.users_collection[0], fx_points)
    spore.location = (3.28, -0.16, 2.67)
    meta = make_empty("META", create_collection("META", master), root)
    meta["fx_family"] = "alien_vegetation"
    meta["fx_wind_response"] = "prevailing_x_sweep"
    meta["fx_runtime_tags"] = "flora,fan,ribbed,one_sided_wind_sweep"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
