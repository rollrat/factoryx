"""Generate FactoryX Ironwind cliff prototype assets with LOD/collision/socket contracts."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_KINDS = {
    "ironwind_cliff_straight_16m": "straight",
    "ironwind_cliff_outer_corner": "corner",
    "ironwind_natural_arch": "arch",
    "ironwind_cliff_arch_transition": "transition",
    "ironwind_talus_cluster": "talus",
    "ironwind_cliff_breached_16m": "breached",
}


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--assets", default="all", help="Comma-separated asset ids or 'all'")
    return parser.parse_args(values)


def new_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def new_empty(
    name: str,
    target: bpy.types.Collection,
    parent: bpy.types.Object | None = None,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    value = bpy.data.objects.new(name, None)
    target.objects.link(value)
    value.parent = parent
    value.location = location
    return value


def new_material(name: str, color: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    return value


class MeshWriter:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.materials: list[int] = []

    def point(self, xyz: tuple[float, float, float] | Vector) -> int:
        self.vertices.append(tuple(xyz))
        return len(self.vertices) - 1

    def face(self, indices: tuple[int, ...], material_index: int = 0) -> None:
        self.faces.append(indices)
        self.materials.append(material_index)

    def box(
        self,
        minimum: tuple[float, float, float],
        maximum: tuple[float, float, float],
        material_index: int = 0,
    ) -> None:
        x0, y0, z0 = minimum
        x1, y1, z1 = maximum
        v = [
            self.point((x0, y0, z0)), self.point((x1, y0, z0)),
            self.point((x1, y1, z0)), self.point((x0, y1, z0)),
            self.point((x0, y0, z1)), self.point((x1, y0, z1)),
            self.point((x1, y1, z1)), self.point((x0, y1, z1)),
        ]
        self.face((v[0], v[3], v[2], v[1]), material_index)
        self.face((v[4], v[5], v[6], v[7]), material_index)
        self.face((v[0], v[1], v[5], v[4]), material_index)
        self.face((v[1], v[2], v[6], v[5]), material_index)
        self.face((v[2], v[3], v[7], v[6]), material_index)
        self.face((v[3], v[0], v[4], v[7]), material_index)

    def talus(
        self,
        center_x: float,
        width: float,
        depth: float,
        height: float,
        seed: float,
        material_index: int,
    ) -> None:
        """Low asymmetric rock wedge used only as a large base anchor."""
        x0, x1 = center_x - width * 0.5, center_x + width * 0.5
        front, rear = -depth, 0.42
        peak_x = center_x + math.sin(seed) * width * 0.16
        peak_y = -depth * (0.42 + math.cos(seed * 1.3) * 0.08)
        base = [
            self.point((x0, front * 0.72, 0.0)), self.point((x1, front, 0.0)),
            self.point((x1 - width * 0.10, rear, 0.0)), self.point((x0 + width * 0.07, rear, 0.0)),
        ]
        crown = [
            self.point((peak_x - width * 0.23, peak_y, height * 0.72)),
            self.point((peak_x + width * 0.20, peak_y * 0.88, height)),
            self.point((peak_x + width * 0.16, rear * 0.55, height * 0.53)),
            self.point((peak_x - width * 0.18, rear * 0.48, height * 0.47)),
        ]
        self.face(tuple(reversed(base)), material_index)
        self.face(tuple(crown), material_index)
        for index in range(4):
            nxt = (index + 1) % 4
            self.face((base[index], base[nxt], crown[nxt], crown[index]), material_index)

    def irregular_band(
        self,
        x0: float,
        x1: float,
        z0: float,
        z1: float,
        depth: float,
        segments: int,
        seed: float,
        material_index: int,
        front_bias: float = 0.0,
    ) -> None:
        """Closed cliff stratum; seam endpoints stay deterministic at +/-8m."""
        front_lower: list[int] = []
        front_upper: list[int] = []
        back_lower: list[int] = []
        back_upper: list[int] = []
        for index in range(segments + 1):
            t = index / segments
            x = x0 + (x1 - x0) * t
            edge_lock = math.sin(math.pi * t)
            broad = math.sin(t * math.tau * 1.35 + seed) * 0.28
            chip = math.sin(t * math.tau * 4.1 + seed * 1.9) * 0.12
            front = front_bias + edge_lock * (broad + chip)
            crown = edge_lock * (
                math.sin(t * math.tau * 2.2 + seed * 0.7) * 0.17
                + math.sin(t * math.tau * 5.3 + seed) * 0.06
            )
            rear = depth + edge_lock * math.sin(t * math.tau * 1.7 + seed) * 0.18
            front_lower.append(self.point((x, front, z0)))
            front_upper.append(self.point((x, front - 0.08, z1 + crown)))
            back_lower.append(self.point((x, rear, z0)))
            back_upper.append(self.point((x, rear, z1 + crown * 0.35)))
        for index in range(segments):
            nxt = index + 1
            self.face((front_lower[index], front_lower[nxt], front_upper[nxt], front_upper[index]), material_index)
            self.face((back_lower[nxt], back_lower[index], back_upper[index], back_upper[nxt]), material_index)
            self.face((front_upper[index], front_upper[nxt], back_upper[nxt], back_upper[index]), material_index)
            self.face((back_lower[index], back_lower[nxt], front_lower[nxt], front_lower[index]), material_index)
        self.face((front_lower[0], front_upper[0], back_upper[0], back_lower[0]), material_index)
        self.face((front_lower[-1], back_lower[-1], back_upper[-1], front_upper[-1]), material_index)

    def arch_wedge(
        self,
        angle0: float,
        angle1: float,
        inner_radius: tuple[float, float],
        outer_radius: tuple[float, float],
        center_z: float,
        depth: float,
        material_index: int,
    ) -> None:
        def pos(angle: float, radius: tuple[float, float], y: float) -> tuple[float, float, float]:
            return (
                math.cos(angle) * radius[0],
                y,
                center_z + math.sin(angle) * radius[1],
            )

        # The arch occupies the upper semicircle. Front faces -Y.
        points = []
        for y in (-depth * 0.5, depth * 0.5):
            points.extend(
                [
                    self.point(pos(angle0, inner_radius, y)),
                    self.point(pos(angle1, inner_radius, y)),
                    self.point(pos(angle1, outer_radius, y)),
                    self.point(pos(angle0, outer_radius, y)),
                ]
            )
        a, b, c, d, e, f, g, h = points
        self.face((a, d, c, b), material_index)
        self.face((e, f, g, h), material_index)
        self.face((a, b, f, e), material_index)
        self.face((b, c, g, f), material_index)
        self.face((c, d, h, g), material_index)
        self.face((d, a, e, h), material_index)

    def object(
        self,
        name: str,
        target: bpy.types.Collection,
        parent: bpy.types.Object,
        materials: list[bpy.types.Material],
    ) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        for item in materials:
            mesh.materials.append(item)
        for polygon, material_index in zip(mesh.polygons, self.materials):
            polygon.material_index = material_index
            polygon.use_smooth = False
        mesh.update()
        value = bpy.data.objects.new(name, mesh)
        target.objects.link(value)
        value.parent = parent
        return value


def add_lod_container(master: bpy.types.Collection, root: bpy.types.Object, lod: int) -> tuple[bpy.types.Collection, bpy.types.Object]:
    target = new_collection(f"VIS_LOD{lod}", master)
    node = new_empty(f"VIS_LOD{lod}", target, root)
    node["fx_asset_role"] = "visual_lod"
    node["fx_lod_level"] = lod
    node["fx_lod_distance_m"] = (0.0, 70.0, 150.0)[lod]
    return target, node


def build_straight(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    band_counts = (7, 5, 3)
    segments = (12, 7, 4)
    for lod in range(3):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        heights = [0.0]
        for index in range(band_counts[lod]):
            heights.append(12.0 * (index + 1) / band_counts[lod])
        for index in range(band_counts[lod]):
            writer.irregular_band(
                -8.0, 8.0, heights[index], heights[index + 1],
                4.2 - index * 0.08, segments[lod], 0.74 + index * 1.37,
                index % 3, front_bias=math.sin(index * 1.7) * 0.12,
            )
        if lod < 2:
            # A few large talus wedges anchor the wall without noisy pebble scatter.
            for index, (x, width, height) in enumerate(((-5.3, 2.7, 2.1), (-0.8, 3.3, 2.8), (4.6, 2.4, 1.8))):
                writer.talus(x, width, 1.5, height, 0.8 + index * 1.7, (index + 1) % 3)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def build_corner(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    band_counts = (7, 5, 3)
    segments = (7, 5, 3)
    for lod in range(3):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        for index in range(band_counts[lod]):
            z0 = index * 12.0 / band_counts[lod]
            z1 = (index + 1) * 12.0 / band_counts[lod]
            writer.irregular_band(-8.0, 0.0, z0, z1, 4.2, segments[lod], 1.1 + index * 1.27, index % 3)
            # Second arm is authored in local X then rotated 90 degrees in object space.
            arm = MeshWriter()
            arm.irregular_band(0.0, 8.0, z0, z1, 4.2, segments[lod], 2.6 + index * 1.19, index % 3)
            offset = len(writer.vertices)
            for x, y, z in arm.vertices:
                writer.vertices.append((-y, x, z))
            writer.faces.extend(tuple(value + offset for value in face) for face in arm.faces)
            writer.materials.extend(arm.materials)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def build_arch(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    segment_counts = (12, 8, 5)
    for lod, count in enumerate(segment_counts):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        # Irregular layered buttresses; the clear opening remains 8m wide x 6.4m high.
        bands = (5, 4, 3)[lod]
        for index in range(bands):
            z0 = index * 5.0 / bands
            z1 = (index + 1) * 5.0 / bands + (0.18 if index == bands - 1 else 0.0)
            inset = 0.08 * index
            writer.box((-8.0 + inset, -2.6, z0), (-4.0, 2.6, z1), index % 3)
            writer.box((4.0, -2.6, z0), (8.0 - inset, 2.6, z1), (index + 1) % 3)
        for index in range(count):
            a0 = index * math.pi / count
            a1 = (index + 1) * math.pi / count
            writer.arch_wedge(a0, a1, (4.0, 3.2), (6.7, 6.0), 3.2, 5.2, index % 3)
        if lod == 0:
            # Two asymmetric shoulder masses stop the arch reading as architecture.
            writer.talus(-6.6, 2.5, 2.7, 3.6, 1.3, 0)
            writer.talus(6.6, 2.1, 2.5, 3.0, 2.8, 1)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def build_transition(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    """Full-height straight seam tapering into the lower shoulder of an arch."""
    for lod, segments in enumerate((9, 6, 4)):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        bands = (7, 5, 3)[lod]
        band_height = 12.0 / bands
        for index in range(bands):
            z0 = index * band_height
            z1 = (index + 1) * band_height
            if z0 < 8.0:
                x1 = 8.0
            else:
                taper = min(1.0, (z0 - 8.0) / 4.0)
                x1 = 5.0 - taper * 3.5
            writer.irregular_band(
                -8.0, x1, z0, z1, 4.2 - index * 0.08,
                max(2, round(segments * (x1 + 8.0) / 16.0)),
                4.2 + index * 1.31, index % 3,
            )
        if lod < 2:
            writer.talus(5.4, 3.0, 1.7, 2.7, 4.1, 1)
            writer.talus(7.0, 2.2, 1.4, 2.0, 5.6, 0)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def build_talus_cluster(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    """Sparse, large-scale cliff-foot cluster; not a pebble scatter."""
    rocks = (
        (-4.7, 3.0, 2.1, 3.2, 0.8), (-1.8, 3.8, 2.5, 3.8, 2.2),
        (1.5, 3.2, 2.2, 2.9, 3.7), (4.3, 2.7, 1.9, 2.5, 5.1),
        (0.0, 2.4, 1.6, 2.0, 6.4),
    )
    limits = (5, 4, 3)
    for lod in range(3):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        for index, (x, width, depth, height, seed) in enumerate(rocks[:limits[lod]]):
            writer.talus(x, width, depth, height, seed, index % 3)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def build_breached(asset_id: str, master: bpy.types.Collection, root: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    """A collapsed 16m wall variant with a readable central break and rubble apron."""
    for lod, segments in enumerate((8, 5, 3)):
        target, parent = add_lod_container(master, root, lod)
        writer = MeshWriter()
        bands = (7, 5, 3)[lod]
        band_height = 12.0 / bands
        for index in range(bands):
            z0 = index * band_height
            z1 = (index + 1) * band_height
            left_end = -1.7 - index * 0.22
            right_start = 2.0 + index * 0.18
            writer.irregular_band(-8.0, left_end, z0, z1, 4.1, max(2, segments - 2), 7.0 + index, index % 3)
            if z0 < 10.3:
                writer.irregular_band(right_start, 8.0, z0, min(z1, 10.4), 4.0, max(2, segments - 2), 9.5 + index, (index + 1) % 3)
        if lod < 2:
            writer.talus(-0.9, 3.4, 2.0, 2.3, 7.8, 1)
            writer.talus(1.5, 3.0, 1.8, 1.9, 9.2, 0)
            writer.talus(0.2, 2.4, 1.5, 1.4, 10.7, 2)
        obj = writer.object(f"{asset_id}_lod{lod}", target, parent, materials)
        obj["fx_asset_role"] = "visual"
        obj["fx_lod_level"] = lod


def collision_box(
    name: str,
    target: bpy.types.Collection,
    parent: bpy.types.Object,
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    writer = MeshWriter()
    writer.box(minimum, maximum)
    obj = writer.object(name, target, parent, [material])
    obj.display_type = "WIRE"
    obj.hide_render = True
    obj["fx_asset_role"] = "collision"
    return obj


def add_collision(asset_id: str, kind: str, master: bpy.types.Collection, root: bpy.types.Object, material: bpy.types.Material) -> None:
    collision_name = "COL_BUILD_EXCLUSION" if kind == "talus" else "COL_WALL"
    wall_collection = new_collection(collision_name, master)
    wall = new_empty(collision_name, wall_collection, root)
    wall["fx_collision_type"] = "build_exclusion" if kind == "talus" else "wall"
    if kind == "straight":
        collision_box(f"{asset_id}_wall", wall_collection, wall, (-8.0, -0.35, 0.0), (8.0, 3.9, 12.0), material)
    elif kind == "corner":
        collision_box(f"{asset_id}_wall_x", wall_collection, wall, (-8.0, -0.35, 0.0), (0.0, 3.9, 12.0), material)
        collision_box(f"{asset_id}_wall_y", wall_collection, wall, (-3.9, 0.0, 0.0), (0.35, 8.0, 12.0), material)
    elif kind == "arch":
        collision_box(f"{asset_id}_wall_left", wall_collection, wall, (-8.0, -2.5, 0.0), (-4.0, 2.5, 8.0), material)
        collision_box(f"{asset_id}_wall_right", wall_collection, wall, (4.0, -2.5, 0.0), (8.0, 2.5, 8.0), material)
        collision_box(f"{asset_id}_wall_crown", wall_collection, wall, (-4.0, -2.5, 6.35), (4.0, 2.5, 11.8), material)
    elif kind == "transition":
        collision_box(f"{asset_id}_wall_lower", wall_collection, wall, (-8.0, -0.3, 0.0), (8.0, 4.0, 8.0), material)
        collision_box(f"{asset_id}_wall_upper", wall_collection, wall, (-8.0, -0.25, 8.0), (2.0, 3.9, 12.0), material)
    elif kind == "breached":
        collision_box(f"{asset_id}_wall_left", wall_collection, wall, (-8.0, -0.3, 0.0), (-1.7, 3.9, 12.0), material)
        collision_box(f"{asset_id}_wall_right", wall_collection, wall, (2.0, -0.3, 0.0), (8.0, 3.9, 10.4), material)
        collision_box(f"{asset_id}_rubble", wall_collection, wall, (-1.8, -1.2, 0.0), (2.4, 0.4, 2.1), material)
    elif kind == "talus":
        collision_box(f"{asset_id}_exclusion_left", wall_collection, wall, (-6.2, -2.4, 0.0), (-0.1, 0.5, 3.6), material)
        collision_box(f"{asset_id}_exclusion_right", wall_collection, wall, (-0.5, -2.2, 0.0), (5.7, 0.5, 3.0), material)

    if kind in {"straight", "corner"}:
        walk_collection = new_collection("COL_WALKABLE", master)
        walkable = new_empty("COL_WALKABLE", walk_collection, root)
        walkable["fx_collision_type"] = "walkable"
        if kind == "straight":
            collision_box(f"{asset_id}_walkable", walk_collection, walkable, (-8.0, 0.0, 11.96), (8.0, 4.0, 12.0), material)
        else:
            collision_box(f"{asset_id}_walkable_x", walk_collection, walkable, (-8.0, 0.0, 11.96), (0.0, 4.0, 12.0), material)
            collision_box(f"{asset_id}_walkable_y", walk_collection, walkable, (-4.0, 0.0, 11.96), (0.0, 8.0, 12.0), material)


def add_sockets(asset_id: str, kind: str, master: bpy.types.Collection, root: bpy.types.Object) -> None:
    target = new_collection("SOCKETS", master)
    parent = new_empty("SOCKETS", target, root)
    parent["fx_asset_role"] = "socket_container"
    if kind == "straight":
        values = {
            "cliff.start": (-8.0, 0.0, 0.0), "cliff.end": (8.0, 0.0, 0.0),
            "cliff.top": (0.0, 2.0, 12.0), "cliff.bottom": (0.0, 0.0, 0.0),
            "talus.attach": (0.0, -0.8, 0.0),
        }
    elif kind == "corner":
        values = {
            "cliff.start": (-8.0, 0.0, 0.0), "cliff.end": (0.0, 8.0, 0.0),
            "cliff.top": (-2.0, 2.0, 12.0), "cliff.bottom": (0.0, 0.0, 0.0),
            "talus.attach": (-0.6, -0.6, 0.0),
        }
    elif kind == "arch":
        values = {
            "cliff.start": (-8.0, 0.0, 0.0), "cliff.end": (8.0, 0.0, 0.0),
            "cliff.top": (0.0, 0.0, 11.8), "cliff.bottom": (0.0, 0.0, 0.0),
            "talus.attach": (-6.0, -2.6, 0.0), "cave.portal": (0.0, 0.0, 3.0),
        }
    elif kind == "transition":
        values = {
            "cliff.start": (-8.0, 0.0, 0.0), "cliff.end": (8.0, 0.0, 0.0),
            "cliff.top": (-3.0, 2.0, 12.0), "cliff.bottom": (0.0, 0.0, 0.0),
            "talus.attach": (5.5, -0.8, 0.0), "arch.attach": (8.0, 0.0, 0.0),
        }
    elif kind == "breached":
        values = {
            "cliff.start": (-8.0, 0.0, 0.0), "cliff.end": (8.0, 0.0, 0.0),
            "cliff.top": (-5.0, 2.0, 12.0), "cliff.bottom": (0.0, 0.0, 0.0),
            "talus.attach": (0.0, -0.9, 0.0), "breach.center": (0.15, 0.0, 0.0),
        }
    else:
        values = {
            "talus.attach": (0.0, 0.0, 0.0),
            "talus.start": (-6.0, 0.0, 0.0), "talus.end": (6.0, 0.0, 0.0),
        }
    for semantic, location in values.items():
        socket = new_empty(semantic, target, parent, location)
        socket["fx_asset_role"] = "socket"
        socket["fx_socket_semantic"] = semantic
        socket["fx_owner_asset_id"] = asset_id


def setup_preview(scene: bpy.types.Scene, master: bpy.types.Collection, asset_id: str) -> tuple[bpy.types.Object, bpy.types.Object]:
    target = new_collection("PREVIEW", master)
    ground_material = new_material("M_PreviewGround", (0.070, 0.086, 0.090), 0.96)
    bpy.ops.mesh.primitive_plane_add(size=70, location=(0.0, 0.0, -0.02))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    target.objects.link(ground)
    ground.data.materials.append(ground_material)

    key_data = bpy.data.lights.new("PREVIEW_Key", "AREA")
    key_data.energy = 4200
    key_data.size = 9.0
    key = bpy.data.objects.new("PREVIEW_Key", key_data)
    key.location = (-12.0, -14.0, 22.0)
    target.objects.link(key)
    fill_data = bpy.data.lights.new("PREVIEW_Fill", "AREA")
    fill_data.energy = 1900
    fill_data.color = (0.46, 0.62, 0.74)
    fill_data.size = 12.0
    fill = bpy.data.objects.new("PREVIEW_Fill", fill_data)
    fill.location = (14.0, 9.0, 14.0)
    target.objects.link(fill)
    sun_data = bpy.data.lights.new("PREVIEW_Sun", "SUN")
    sun_data.energy = 1.6
    sun_data.angle = math.radians(18.0)
    sun = bpy.data.objects.new("PREVIEW_Sun", sun_data)
    sun.rotation_euler = (math.radians(28.0), math.radians(-24.0), math.radians(-35.0))
    target.objects.link(sun)

    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    camera_data.lens = 52
    target.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 1.0
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.045, 0.060, 0.066, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55
    scene.world = world
    return camera, ground


def export_asset(output: Path, root: bpy.types.Object, master: bpy.types.Collection) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for collection in master.children:
        if collection.name == "PREVIEW":
            continue
        for obj in collection.all_objects:
            obj.hide_set(False)
            obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True,
        export_yup=True, export_extras=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False,
    )


def render_views(scene: bpy.types.Scene, camera: bpy.types.Object, output_dir: Path, asset_id: str, target_z: float) -> list[str]:
    positions = {
        "front": (19.5, -25.5, 12.5),
        "left": (-24.0, -17.0, 13.5),
        "right": (24.0, 16.0, 15.0),
        "top": (18.0, -20.0, 28.0),
    }
    outputs = []
    for suffix, location in positions.items():
        camera.location = location
        camera.rotation_euler = (Vector((0.0, 0.9, target_z)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        destination = output_dir / f"{asset_id}_preview_{suffix}.png"
        scene.render.filepath = str(destination)
        bpy.ops.render.render(write_still=True)
        outputs.append(destination.name)
    return outputs


def triangle_count(node_name: str) -> int:
    parent = bpy.data.objects.get(node_name)
    if parent is None:
        return 0
    return sum(
        max(0, len(polygon.vertices) - 2)
        for child in parent.children_recursive if child.type == "MESH"
        for polygon in child.data.polygons
    )


def build_asset(output_dir: Path, asset_id: str, kind: str) -> dict[str, object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.context.preferences.filepaths.save_version = 0
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    master = new_collection(f"FX_{asset_id}", scene.collection)
    root = new_empty(f"FX_{asset_id}", master)
    root["fx_asset_id"] = asset_id
    root["fx_asset_version"] = 1
    root["fx_schema_version"] = 2
    root["fx_asset_role"] = "environment_cliff"
    root["fx_biome_ids"] = "ironwind_faults"
    root["fx_unit_meters"] = 1.0
    root["fx_coordinate_system"] = "right_handed_y_up_glTF"
    root["fx_source_up"] = "+Z"
    root["fx_forward"] = "+Z_glTF"
    root["fx_pivot_convention"] = "ground_center"
    collision_nodes = ["COL_BUILD_EXCLUSION"] if kind == "talus" else ["COL_WALL"]
    if kind in {"straight", "corner"}:
        collision_nodes.append("COL_WALKABLE")
    root["factoryx"] = json.dumps(
        {
            "schemaVersion": 2, "assetId": asset_id, "kind": "environment_cliff",
            "unitMeters": 1, "coordinateSystem": {"handedness": "right", "up": "+Y", "forward": "+Z"},
            "pivotConvention": "ground_center", "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"],
            "collisionNodes": collision_nodes,
            "socketContainer": "SOCKETS", "moduleKind": kind,
        }, separators=(",", ":"),
    )

    rock_dark = new_material("M_Ironwind_DarkStrata", (0.105, 0.125, 0.132), 0.92)
    rock_mid = new_material("M_Ironwind_MidStrata", (0.185, 0.215, 0.220), 0.88)
    rock_light = new_material("M_Ironwind_ExposedEdge", (0.285, 0.315, 0.310), 0.84)
    oxidized = new_material("M_Ironwind_Oxide", (0.17, 0.105, 0.068), 0.9)
    collision = new_material("M_CollisionDebug", (0.8, 0.06, 0.04), 1.0)
    materials = [rock_dark, rock_mid, rock_light, oxidized]
    if kind == "straight":
        build_straight(asset_id, master, root, materials)
    elif kind == "corner":
        build_corner(asset_id, master, root, materials)
    elif kind == "arch":
        build_arch(asset_id, master, root, materials)
    elif kind == "transition":
        build_transition(asset_id, master, root, materials)
    elif kind == "talus":
        build_talus_cluster(asset_id, master, root, materials)
    elif kind == "breached":
        build_breached(asset_id, master, root, materials)
    else:
        raise ValueError(f"unknown cliff module kind {kind}")
    add_collision(asset_id, kind, master, root, collision)
    add_sockets(asset_id, kind, master, root)
    meta_target = new_collection("META", master)
    meta = new_empty("META", meta_target, root)
    meta["fx_family"] = "ironwind_cliff_proto"
    meta["fx_runtime_tags"] = "cliff,strata,macro_landform,prototype"
    meta["fx_material_policy"] = "graybox_large_strata_only"

    camera, _ = setup_preview(scene, master, asset_id)
    blend_path = output_dir / f"{asset_id}.blend"
    glb_path = output_dir / f"{asset_id}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    export_asset(glb_path, root, master)
    target_z = 1.5 if kind == "talus" else (5.0 if kind == "arch" else 5.7)
    previews = render_views(scene, camera, output_dir, asset_id, target_z)
    lod_triangles = [triangle_count(f"VIS_LOD{lod}") for lod in range(3)]
    collision_triangles = sum(triangle_count(node_name) for node_name in collision_nodes)
    return {
        "id": asset_id,
        "kind": f"cliff_{kind}",
        "source": blend_path.name,
        "output": glb_path.name,
        "unitMeters": 1,
        "gltfCoordinateSystem": {"handedness": "right", "up": "+Y", "forward": "+Z"},
        "sourceCoordinateSystem": {"up": "+Z", "note": "Blender source; exporter converts to glTF +Y up"},
        "pivot": "ground_center",
        "lodNodes": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"],
        "lodTriangles": lod_triangles,
        "collisionNodes": collision_nodes,
        "collisionTriangles": collision_triangles,
        "socketContainer": "SOCKETS",
        "previews": previews,
        "glbBytes": glb_path.stat().st_size,
    }


def main() -> None:
    args = arguments()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.assets == "all":
        selected = list(ASSET_KINDS)
    else:
        selected = [value.strip() for value in args.assets.split(",") if value.strip()]
        unknown = [asset_id for asset_id in selected if asset_id not in ASSET_KINDS]
        if unknown:
            raise ValueError(f"unknown assets: {', '.join(unknown)}")
    existing_entries: dict[str, dict[str, object]] = {}
    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        existing_entries = {entry["id"]: entry for entry in existing.get("assets", [])}
    for asset_id in selected:
        existing_entries[asset_id] = build_asset(output_dir, asset_id, ASSET_KINDS[asset_id])
    entries = [existing_entries[asset_id] for asset_id in ASSET_KINDS if asset_id in existing_entries]
    manifest = {
        "schemaVersion": 2,
        "kitId": "ironwind_cliff_proto",
        "status": "graybox_prototype",
        "blenderVersion": bpy.app.version_string,
        "contract": {
            "unitMeters": 1,
            "gltfUp": "+Y",
            "pivot": "ground_center",
            "requiredLods": ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"],
            "collisionByAsset": {entry["id"]: entry["collisionNodes"] for entry in entries},
            "requiredSocketContainer": "SOCKETS",
        },
        "assets": entries,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("FACTORYX_CLIFF_KIT_BUILT=ironwind_cliff_proto")


main()
