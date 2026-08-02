"""Build FactoryX's fractured hematite crown-fault landmark.

This is intentionally an incomplete, navigable ring of independently tilted
slabs.  It uses an irregular fault dish at the center, variable sector widths,
and two primary breaches instead of a torus or an evenly repeated crown.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "landmark_crown_fault_a"


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


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


class MeshWriter:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def point(self, value: Vector | tuple[float, float, float]) -> int:
        self.vertices.append(tuple(value))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int) -> None:
        self.faces.append(indices)
        self.materials.append(material_index)

    @staticmethod
    def polar(radius: float, angle: float) -> Vector:
        return Vector((math.cos(angle) * radius, math.sin(angle) * radius, 0.0))

    def crown_slab(self, angle: float, arc: float, inner: float, outer: float, inner_height: float, outer_height: float, phase: float, material_offset: int) -> None:
        """One thick, broken radial slab with a broad inward-facing fault plane."""
        a, b = angle - arc * 0.5, angle + arc * 0.5
        corners = [self.polar(outer, a), self.polar(outer, b), self.polar(inner, b), self.polar(inner, a)]
        top: list[int] = []
        bottom: list[int] = []
        for index, corner in enumerate(corners):
            at_inner = index >= 2
            base_height = inner_height if at_inner else outer_height
            broken = 0.13 * math.sin(phase + index * 2.15) + 0.06 * math.cos(phase * 1.7 + index)
            lateral = Vector((0.10 * math.cos(angle + index * 1.2 + phase), 0.10 * math.sin(angle + index * 1.2 + phase), 0.0))
            top.append(self.point(corner + lateral + Vector((0.0, 0.0, base_height + broken))))
            bottom.append(self.point(corner * 0.98 + lateral * 0.25 + Vector((0.0, 0.0, 0.18 + 0.035 * math.sin(phase + index)))))
        # Upper surface is an actual tilted plateau.  The four side walls take
        # coherent oxide bands, which follow the whole crown's fault history.
        self.face(tuple(top), 1 if material_offset % 3 == 0 else 0)
        self.face(tuple(reversed(bottom)), 0)
        for index in range(4):
            nxt = (index + 1) % 4
            seam = (index + material_offset) % 3 == 1
            self.face((bottom[index], bottom[nxt], top[nxt], top[index]), 1 if seam else 0)

    def fault_dish(self, sides: int) -> None:
        outer: list[int] = []
        middle: list[int] = []
        inner: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            wobble = 1.0 + 0.10 * math.sin(angle * 3.0 + 0.3) + 0.05 * math.cos(angle * 7.0)
            outer.append(self.point(self.polar(2.65 * wobble, angle) + Vector((0.0, 0.0, 0.29 + 0.05 * math.sin(angle * 2.0)))))
            middle.append(self.point(self.polar(1.65 * wobble, angle) + Vector((0.0, 0.0, -0.02 + 0.04 * math.sin(angle * 2.0 + 0.7)))))
            inner.append(self.point(self.polar(0.72 * wobble, angle) + Vector((0.0, 0.0, -0.22 + 0.035 * math.cos(angle * 4.0)))))
        floor = self.point((0.16, -0.10, -0.29))
        for side in range(sides):
            nxt = (side + 1) % sides
            self.face((outer[side], outer[nxt], middle[nxt], middle[side]), 0)
            self.face((middle[side], middle[nxt], inner[nxt], inner[side]), 0)
            self.face((inner[side], inner[nxt], floor), 1 if side in (2, 7, 11) else 0)

    def fractured_base(self, sides: int) -> None:
        outer: list[int] = []
        upper: list[int] = []
        for side in range(sides):
            angle = math.tau * side / sides
            wobble = 1.0 + 0.14 * math.sin(angle * 4.0 + 0.2) + 0.07 * math.cos(angle * 7.0)
            outer.append(self.point(self.polar(6.25 * wobble, angle) + Vector((0.0, 0.0, 0.0))))
            upper.append(self.point(self.polar(5.55 * wobble, angle) + Vector((0.0, 0.0, 0.42 + 0.07 * math.sin(angle * 3.0)))))
        for side in range(sides):
            nxt = (side + 1) % sides
            self.face((outer[side], outer[nxt], upper[nxt], upper[side]), 0)

    def object(self, name: str, materials: list[bpy.types.Material], target: bpy.types.Collection, parent: bpy.types.Object) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for material_value in materials:
            mesh.materials.append(material_value)
        mesh.update()
        for polygon, material_index in zip(mesh.polygons, self.materials):
            polygon.material_index = material_index
            polygon.use_smooth = False
        result = bpy.data.objects.new(name, mesh)
        target.objects.link(result)
        result.parent = parent
        return result


def build_visual(asset_id: str, lod: int, target: bpy.types.Collection, parent: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    writer = MeshWriter()
    writer.fractured_base((32, 18, 11)[lod])
    writer.fault_dish((24, 14, 8)[lod])
    # The wide southeast breach is the navigational invitation; the north-west
    # break makes the silhouette unmistakable when viewed from long distance.
    slabs = [
        (2.88, 0.57, 2.35, 5.78, 3.20, 1.08, 0.31),
        (-2.72, 0.49, 2.42, 5.55, 2.75, 1.26, 0.93),
        (-2.04, 0.41, 2.20, 5.95, 3.70, 1.18, 1.71),
        (-1.37, 0.54, 2.12, 5.68, 2.32, 1.46, 2.52),
        (-0.64, 0.45, 2.38, 6.08, 3.55, 1.00, 3.41),
        (0.10, 0.52, 2.28, 5.64, 2.68, 1.50, 4.06),
        (0.78, 0.42, 2.16, 5.86, 3.18, 1.07, 4.84),
        (1.47, 0.36, 2.42, 6.12, 2.42, 1.34, 5.66),
    ]
    count = (8, 6, 4)[lod]
    for index, values in enumerate(slabs[:count]):
        angle, arc, inner, outer, inner_height, outer_height, phase = values
        writer.crown_slab(angle, arc, inner, outer, inner_height, outer_height, phase, index)
        # Nested offset caps are the visible bedding planes: each is an actual
        # smaller slab, not a texture stripe painted onto a torus-like surface.
        for layer in range((3, 2, 0)[lod]):
            inset = 0.18 + layer * 0.18
            cap_angle = angle + math.sin(phase + layer * 1.8) * 0.055
            cap_arc = arc * (0.76 - layer * 0.10)
            writer.crown_slab(
                cap_angle, cap_arc, inner + inset, outer - inset * 0.84,
                inner_height + 0.24 + layer * 0.17,
                outer_height + 0.12 + layer * 0.08,
                phase + 0.52 + layer * 0.81, index + layer + 1,
            )
    if lod == 0:
        # Close-range fractured crown plates lean across selected seams, adding
        # an alien rhythm without filling the fault or the entry breach.
        for index, values in enumerate(((2.30, 0.18, 2.06, 3.25, 1.82, 0.78, 0.42), (-1.77, 0.20, 2.00, 3.46, 2.18, 0.96, 2.12), (0.47, 0.16, 2.08, 3.12, 1.75, 0.83, 4.38))):
            writer.crown_slab(*values, material_offset=index + 3)
    obj = writer.object(f"{asset_id}_lod{lod}", materials, target, parent)
    obj.hide_render = lod != 0
    obj["fx_asset_role"] = "visual"
    obj["fx_lod_level"] = lod
    obj["fx_shadow_distance"] = (170, 235, 310)[lod]
    obj["fx_runtime_tags"] = "landmark,crown_fault,hematite,central_depression,primary_openings"


def collision_mesh(asset_id: str, material_value: bpy.types.Material) -> bpy.types.Mesh:
    # Four separated low wedge hulls leave the south-east entrance and the
    # opposing break clear for navigation and construction sightlines.
    sectors = ((2.78, 0.82), (-2.42, 0.96), (-0.62, 1.56), (0.90, 0.60))
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for angle, arc in sectors:
        start = len(vertices)
        a, b = angle - arc * 0.5, angle + arc * 0.5
        footprint = [MeshWriter.polar(2.55, a), MeshWriter.polar(5.95, a), MeshWriter.polar(5.95, b), MeshWriter.polar(2.55, b)]
        vertices.extend(tuple(point + Vector((0.0, 0.0, z))) for z in (0.0, 1.65) for point in footprint)
        faces.extend(((start, start + 1, start + 2, start + 3), (start + 4, start + 7, start + 6, start + 5), (start, start + 4, start + 5, start + 1), (start + 1, start + 5, start + 6, start + 2), (start + 2, start + 6, start + 7, start + 3), (start + 3, start + 7, start + 4, start)))
    mesh = bpy.data.meshes.new(f"{asset_id}_collision_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material_value)
    mesh.update()
    return mesh


def make_collision(asset_id: str, target: bpy.types.Collection, parent: bpy.types.Object, material_value: bpy.types.Material) -> None:
    obj = bpy.data.objects.new(f"{asset_id}_collision", collision_mesh(asset_id, material_value))
    target.objects.link(obj)
    obj.parent = parent
    obj.hide_render, obj.display_type = True, "WIRE"
    obj["fx_asset_role"] = "collision"
    obj["fx_collision_mode"] = "segmented_opening_preserving_hulls"


def add_preview(scene: bpy.types.Scene, master: bpy.types.Collection, output: Path) -> None:
    preview = collection("PREVIEW", master)
    ground_material = material("M_PreviewDust", (0.051, 0.028, 0.023), 0.96, 0.0)
    bpy.ops.mesh.primitive_plane_add(size=38, location=(0.4, 0.0, -0.018))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    preview.objects.link(ground)
    ground.data.materials.append(ground_material)
    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy, key_data.shape, key_data.size = 2050, "DISK", 7.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-8.2, -8.4, 12.5)
    preview.objects.link(key)
    rim_data = bpy.data.lights.new("PREVIEW_Rim", "AREA")
    rim_data.energy, rim_data.color, rim_data.size = 1050, (0.42, 0.50, 0.86), 6.0
    rim = bpy.data.objects.new("PREVIEW_Rim", rim_data)
    rim.location = (7.5, 4.0, 9.0)
    preview.objects.link(rim)
    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera.location = (11.8, -14.2, 10.0)
    camera.rotation_euler = (Vector((0.25, 0.0, 1.95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
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
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.015, 0.022, 0.042, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.29


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
    root["fx_asset_id"] = args.asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 1
    root["fx_family"] = "hematite_crown_fault"
    root["fx_landmark_id"] = "crown_fault"
    root["fx_biome_ids"] = "hematite_crown,ironwind_faults"
    root["fx_runtime_tags"] = "environment_landmark,crown_fault,hematite,open_ring"
    iron = material("FX_CrownHematite", (0.145, 0.085, 0.064), 0.72, 0.24)
    oxide = material("FX_CrownOxide", (0.34, 0.082, 0.032), 0.85, 0.08)
    collision = material("FX_Collision", (0.70, 0.08, 0.04), 1.0, 0.0)
    for lod in range(3):
        target = collection(f"VIS_LOD{lod}", master)
        build_visual(args.asset_id, lod, target, empty(f"VIS_LOD{lod}", target, root), [iron, oxide])
    collision_target = collection("COL_SIMPLE", master)
    make_collision(args.asset_id, collision_target, empty("COL_SIMPLE", collision_target, root), collision)
    empty("SOCKETS", collection("SOCKETS", master), root)
    points = empty("FX_POINTS", collection("FX_POINTS", master), root)
    points["fx_runtime_tags"] = "fault,wind_scour"
    meta = empty("META", collection("META", master), root)
    meta["fx_family"] = "hematite_crown_fault"
    meta["fx_landmark_id"] = "crown_fault"
    meta["fx_biome_ids"] = "hematite_crown,ironwind_faults"
    add_preview(scene, master, preview)
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    bpy.ops.render.render(write_still=True)
    print(f"FACTORYX_ASSET_BUILT={args.asset_id}")


main()
