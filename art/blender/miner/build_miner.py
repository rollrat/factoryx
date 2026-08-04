from pathlib import Path
import math

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
ROOT.mkdir(parents=True, exist_ok=True)
TEXTURE_ROOT = ROOT / "textures"
TEXTURE_ROOT.mkdir(exist_ok=True)


def make_material(name, color, metallic=0.0, roughness=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


def _smooth_noise(values, rounds):
    result = values
    for _ in range(rounds):
        result = (
            result
            + np.roll(result, 1, axis=0)
            + np.roll(result, -1, axis=0)
            + np.roll(result, 1, axis=1)
            + np.roll(result, -1, axis=1)
        ) / 5.0
    return result


def _save_texture(name, rgb, non_color=False):
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    rgba = np.concatenate((np.clip(rgb, 0, 1), np.ones((height, width, 1))), axis=2)
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.filepath_raw = str(TEXTURE_ROOT / f"{name}.png")
    image.file_format = "PNG"
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image.save()
    return image


def add_wear_textures(mat, base_color, surface):
    """Create real bitmap maps so wear survives glTF export, not just the Blender render."""
    size = 512
    seed = sum((index + 1) * ord(char) for index, char in enumerate(mat.name))
    rng = np.random.default_rng(seed)
    fine = rng.random((size, size))
    micro = _smooth_noise(rng.random((size, size)), 2)
    coarse = _smooth_noise(rng.random((size, size)), 22)
    coarse = np.clip((coarse - coarse.min()) / max(coarse.max() - coarse.min(), 1e-5), 0, 1)

    scratches = np.zeros((size, size), dtype=np.float32)
    scratch_count = 42 if surface == "paint" else 65 if surface == "steel" else 24
    for _ in range(scratch_count):
        x0 = rng.integers(0, size)
        y0 = rng.integers(0, size)
        length = rng.integers(8, 66)
        angle = rng.normal(0.15 if surface == "steel" else 0.0, 0.35)
        thickness = 1 if rng.random() < 0.82 else 2
        for step in range(length):
            x = int(x0 + math.cos(angle) * step) % size
            y = int(y0 + math.sin(angle) * step) % size
            scratches[max(0, y - thickness):min(size, y + thickness + 1), x] = 1

    base = np.array(base_color, dtype=np.float32)
    albedo = np.ones((size, size, 3), dtype=np.float32) * base
    height_map = (micro - 0.5) * 0.13 + (coarse - 0.5) * 0.16

    if surface == "paint":
        mottling = 0.96 + micro[..., None] * 0.09
        albedo *= mottling
        grime = np.clip((coarse - 0.61) * 0.9, 0, 0.16)[..., None]
        albedo = albedo * (1 - grime) + np.array((0.055, 0.04, 0.028)) * grime
        chips = ((fine > 0.9975).astype(np.float32) + scratches * 0.34).clip(0, 0.72)[..., None]
        exposed = np.array((0.16, 0.18, 0.175)) * (0.84 + micro[..., None] * 0.2)
        albedo = albedo * (1 - chips) + exposed * chips
        roughness = np.clip(0.34 + coarse * 0.24 + scratches * 0.15, 0.22, 0.78)
        height_map -= scratches * 0.12
    elif surface == "steel":
        brush = np.sin(np.arange(size, dtype=np.float32)[None, :] * 0.72) * 0.018
        brush = np.repeat(brush, size, axis=0)
        albedo *= (0.93 + micro[..., None] * 0.13 + brush[..., None])
        dark_streaks = np.clip(scratches * 0.16 + (coarse > 0.79) * 0.06, 0, 0.24)[..., None]
        albedo *= 1 - dark_streaks
        roughness = np.clip(0.22 + micro * 0.18 + scratches * 0.17, 0.16, 0.58)
        height_map += brush * 0.55 - scratches * 0.1
    elif surface == "rubber":
        pores = (fine > 0.77).astype(np.float32)
        albedo *= 0.72 + micro[..., None] * 0.32
        albedo += pores[..., None] * 0.018
        roughness = np.clip(0.72 + coarse * 0.2, 0.68, 0.98)
        height_map += pores * 0.11
    elif surface == "ore":
        veins = np.clip(np.sin((np.indices((size, size))[0] * 0.045) + coarse * 8) * 0.5 + 0.5, 0, 1)
        albedo *= 0.55 + coarse[..., None] * 0.7
        oxide = np.array((0.32, 0.075, 0.025))
        vein_mix = (veins ** 4 * 0.5)[..., None]
        albedo = albedo * (1 - vein_mix) + oxide * vein_mix
        roughness = np.clip(0.62 + coarse * 0.3, 0.55, 0.98)
        height_map += (coarse - 0.5) * 0.42 + (fine > 0.82) * 0.08
    else:
        albedo *= 0.93 + micro[..., None] * 0.12
        grime = np.clip((coarse - 0.66) * 0.75, 0, 0.12)[..., None]
        albedo *= 1 - grime
        roughness = np.clip(0.42 + coarse * 0.28 + scratches * 0.1, 0.36, 0.82)

    gradient_x = np.roll(height_map, -1, axis=1) - np.roll(height_map, 1, axis=1)
    gradient_y = np.roll(height_map, -1, axis=0) - np.roll(height_map, 1, axis=0)
    normal_strength = 4.5 if surface in {"rubber", "ore"} else 2.8
    normal = np.dstack((-gradient_x * normal_strength, -gradient_y * normal_strength, np.ones_like(height_map)))
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-5)
    normal = normal * 0.5 + 0.5

    albedo_image = _save_texture(f"T_{mat.name}_BaseColor", albedo)
    roughness_rgb = np.repeat(roughness[..., None], 3, axis=2)
    roughness_image = _save_texture(f"T_{mat.name}_Roughness", roughness_rgb, True)
    normal_image = _save_texture(f"T_{mat.name}_Normal", normal, True)

    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    color_node = nodes.new("ShaderNodeTexImage")
    color_node.name = f"{mat.name}_BaseColor"
    color_node.image = albedo_image
    color_node.location = (-620, 160)
    links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
    rough_node = nodes.new("ShaderNodeTexImage")
    rough_node.name = f"{mat.name}_Roughness"
    rough_node.image = roughness_image
    rough_node.location = (-620, -40)
    links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])
    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = f"{mat.name}_Normal"
    normal_node.image = normal_image
    normal_node.location = (-620, -250)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.62 if surface in {"paint", "steel"} else 0.85
    normal_map.location = (-350, -220)
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])


def tag(obj, role="visual"):
    obj["fx_asset_role"] = role
    return obj


def box(name, size, location, mat, rotation=(0, 0, 0), bevel=0.04, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = tag(bpy.context.object)
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Edge highlights", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    if parent:
        obj.parent = parent
    return obj


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), vertices=16, parent=None):
    # Author in Three.js-style Y-up coordinates; Blender cylinders start on Z.
    rotation = (rotation[0] + math.pi / 2, rotation[1], rotation[2])
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = tag(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def torus(name, major, minor, location, mat, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=20, minor_segments=6,
        location=location, rotation=rotation
    )
    obj = tag(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def beam(name, start, end, width, mat, parent=None):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    obj = box(name, (width, direction.length, width), (start + end) / 2, mat, bevel=width * 0.18, parent=parent)
    obj.rotation_euler = direction.to_track_quat("Y", "Z").to_euler()
    return obj


def cylinder_between(name, start, end, radius, mat, vertices=16, parent=None):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(start + end) / 2)
    obj = tag(bpy.context.object)
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def sphere(name, radius, location, mat, parent=None, segments=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=8, radius=radius, location=location)
    obj = tag(bpy.context.object)
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def cable(name, points, mat, thickness=0.045, parent=None):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = thickness
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for handle, point in zip(spline.bezier_points, points):
        handle.co = point
        handle.handle_left_type = "AUTO"
        handle.handle_right_type = "AUTO"
    obj = tag(bpy.data.objects.new(name, data))
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def helix(name, center, radius, y_min, y_max, turns, mat, thickness=0.055, parent=None):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = thickness
    data.bevel_resolution = 2
    steps = turns * 18
    spline = data.splines.new("POLY")
    spline.points.add(steps)
    for i, point in enumerate(spline.points):
        ratio = i / steps
        angle = ratio * turns * math.tau
        point.co = (
            center[0] + math.cos(angle) * radius,
            y_min + (y_max - y_min) * ratio,
            center[2] + math.sin(angle) * radius,
            1,
        )
    obj = tag(bpy.data.objects.new(name, data))
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def label(name, text, location, scale, mat, parent=None, rotation=(0, 0, 0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.extrude = 0.018
    obj.data.bevel_depth = 0.006
    obj.scale = (scale, scale, scale)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    tag(obj)
    if parent:
        obj.parent = parent
    return obj


def empty(name, location=(0, 0, 0), parent=None):
    obj = tag(bpy.data.objects.new(name, None), "animation")
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    if parent:
        obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# FactoryX palette: dark structural mass, warm hazard accents, cool machine feedback.
dark = make_material("M_StructuralDark", (0.025, 0.038, 0.042), 0.72, 0.3)
steel = make_material("M_BrushedSteel", (0.18, 0.235, 0.24), 0.82, 0.27)
pale = make_material("M_CeramicGuard", (0.38, 0.46, 0.46), 0.35, 0.38)
orange = make_material("M_HazardOrange", (0.78, 0.22, 0.035), 0.38, 0.33)
rubber = make_material("M_Rubber", (0.008, 0.012, 0.014), 0.0, 0.82)
cyan = make_material("M_StatusCyan", (0.02, 0.32, 0.31), 0.1, 0.2, ((0.04, 0.95, 0.82), 4.0))
amber = make_material("M_StatusAmber", (0.55, 0.12, 0.015), 0.15, 0.25, ((1.0, 0.18, 0.02), 3.0))
ore = make_material("M_IronOre", (0.24, 0.095, 0.045), 0.22, 0.75)
ground_mat = make_material("M_PreviewGround", (0.022, 0.034, 0.037), 0.0, 0.95)

for textured_material, color, surface_kind in (
    (dark, (0.025, 0.038, 0.042), "dark"),
    (steel, (0.18, 0.235, 0.24), "steel"),
    (pale, (0.38, 0.46, 0.46), "paint"),
    (orange, (0.78, 0.22, 0.035), "paint"),
    (rubber, (0.008, 0.012, 0.014), "rubber"),
    (ore, (0.24, 0.095, 0.045), "ore"),
):
    add_wear_textures(textured_material, color, surface_kind)

root = empty("FX_Miner_Root")
root["footprint_cells"] = "2x2"
root["output_axis"] = "+X"
# Convert the authored Y-up asset into Blender's Z-up preview space.
root.rotation_euler.x = math.pi / 2

# Foundation skid and four readable load-bearing feet.
box("BaseDeck", (3.55, 0.22, 3.25), (0, 0.26, 0), dark, bevel=0.1, parent=root)
box("DeckInset", (2.95, 0.12, 2.65), (0, 0.4, 0), steel, bevel=0.06, parent=root)
for x in (-1.68, 1.68):
    for z in (-1.53, 1.53):
        box(f"Foot_{x}_{z}", (0.62, 0.2, 0.62), (x, 0.11, z), dark, bevel=0.08, parent=root)
        cylinder(f"FootBolt_{x}_{z}", 0.075, 0.08, (x, 0.25, z), orange, vertices=10, parent=root)

# Central collection bowl around the vein.
cylinder("CollectorLower", 0.86, 0.38, (-0.25, 0.58, 0), dark, vertices=16, parent=root)
cylinder("CollectorUpper", 0.67, 0.3, (-0.25, 0.86, 0), steel, vertices=16, parent=root)
torus("CollectorHazardRing", 0.72, 0.07, (-0.25, 1.03, 0), orange, rotation=(math.pi / 2, 0, 0), parent=root)

# Four-legged mast: wide at the floor, tight around the drive head.
for z in (-1.15, 1.15):
    beam(f"RearMast_{z}", (-1.25, 0.45, z), (-0.62, 4.4, z * 0.48), 0.2, dark, root)
    beam(f"FrontBrace_{z}", (0.9, 0.45, z), (-0.48, 3.7, z * 0.5), 0.14, steel, root)
    beam(f"CrossBrace_{z}", (-1.08, 1.5, z * 0.88), (0.2, 2.65, z * 0.68), 0.09, orange, root)
box("MastCrown", (1.55, 0.3, 1.55), (-0.52, 4.5, 0), dark, bevel=0.09, parent=root)
box("CrownArmor", (1.15, 0.18, 1.2), (-0.52, 4.7, 0), orange, bevel=0.06, parent=root)

# Drive motor and exposed reduction wheel make the force path legible.
cylinder("MainMotor", 0.47, 1.35, (-0.55, 4.95, 0), dark, rotation=(math.pi / 2, 0, 0), vertices=20, parent=root)
for z in (-0.71, 0.71):
    cylinder(f"MotorCap_{z}", 0.49, 0.1, (-0.55, 4.95, z), orange, rotation=(math.pi / 2, 0, 0), vertices=20, parent=root)
drive_wheel = empty("ANIM_DriveWheel", (-0.55, 4.95, 0.79), root)
torus("DriveWheelRim", 0.38, 0.065, (0, 0, 0), steel, parent=drive_wheel)
for angle in (0, math.pi / 2):
    box(f"DriveSpoke_{angle}", (0.65, 0.08, 0.08), (0, 0, 0), orange,
        rotation=(0, 0, angle), bevel=0.02, parent=drive_wheel)

# Reciprocating carriage and rotating auger.
carriage = empty("ANIM_Carriage", (0, 0, 0), root)
cylinder("CarriageBody", 0.58, 0.58, (-0.25, 3.45, 0), pale, vertices=16, parent=carriage)
torus("CarriageBand", 0.6, 0.065, (-0.25, 3.42, 0), orange, rotation=(math.pi / 2, 0, 0), parent=carriage)
box("CarriageGuideL", (0.25, 0.78, 0.22), (-0.88, 3.45, 0), dark, bevel=0.05, parent=carriage)
box("CarriageGuideR", (0.25, 0.78, 0.22), (0.38, 3.45, 0), dark, bevel=0.05, parent=carriage)

drill = empty("ANIM_Drill", (-0.25, 0, 0), root)
cylinder("DrillShaft", 0.17, 2.75, (0, 2.1, 0), steel, vertices=16, parent=drill)
for index, y in enumerate((0.95, 1.22, 1.49, 1.76, 2.03, 2.3)):
    torus(f"AugerFlight_{index}", 0.34, 0.065, (0, y, 0), dark,
          rotation=(math.pi / 2, 0, index * 0.5), parent=drill)
bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.43, radius2=0.13, depth=0.72, location=(0, 0.62, 0), rotation=(math.pi / 2, 0, 0))
bit = tag(bpy.context.object)
bit.name = "DrillBit"
bit.data.materials.append(orange)
bit.parent = drill
for angle in range(0, 360, 90):
    rad = math.radians(angle)
    box(f"CuttingTooth_{angle}", (0.15, 0.17, 0.26),
        (math.cos(rad) * 0.36, 0.55, math.sin(rad) * 0.36), steel,
        rotation=(0, rad, 0), bevel=0.025, parent=drill)

# Ore hopper and +X conveyor output, aligned for belt snapping.
box("HopperBody", (1.25, 0.82, 1.25), (0.75, 1.25, 0), dark, rotation=(0, 0, math.radians(-10)), bevel=0.12, parent=root)
box("HopperArmor", (1.12, 0.2, 1.08), (0.68, 1.7, 0), orange, bevel=0.06, parent=root)
box("OutputBed", (1.75, 0.22, 0.82), (1.65, 0.88, 0), rubber, bevel=0.04, parent=root)
for z in (-0.5, 0.5):
    box(f"OutputRail_{z}", (1.85, 0.34, 0.1), (1.65, 1.05, z), pale, bevel=0.035, parent=root)
for index, x in enumerate((0.9, 1.35, 1.8, 2.25)):
    roller = cylinder(f"OutputRoller_{index}", 0.1, 0.9, (x, 1.02, 0), steel,
                      rotation=(math.pi / 2, 0, 0), vertices=12, parent=root)
    roller["animation_role"] = "output_roller"
box("OUTPUT_Port", (0.12, 0.72, 0.82), (2.58, 1.0, 0), orange, bevel=0.035, parent=root)
box("OutputSignal", (0.04, 0.16, 0.56), (2.66, 1.35, 0), cyan, bevel=0.02, parent=root)

# Control cabinet and secondary detail pass.
box("ControlCabinet", (0.75, 1.25, 0.48), (-1.42, 1.25, 0.92), dark, bevel=0.09, parent=root)
box("ControlScreen", (0.5, 0.38, 0.035), (-1.42, 1.43, 1.18), cyan,
    rotation=(math.radians(-8), 0, 0), bevel=0.025, parent=root)
for i in range(3):
    box(f"CabinetVent_{i}", (0.42, 0.035, 0.045), (-1.42, 0.98 - i * 0.11, 1.17), steel, bevel=0.01, parent=root)
cylinder("BeaconStem", 0.055, 0.36, (-1.42, 2.07, 0.92), dark, vertices=10, parent=root)
cylinder("Beacon", 0.11, 0.22, (-1.42, 2.34, 0.92), amber, vertices=12, parent=root)
cable("MainPowerCable", [(-1.42, 0.7, 0.92), (-1.6, 0.52, 0.45), (-0.9, 0.45, -1.25), (-0.55, 3.9, -0.8)], rubber, 0.07, root)
cable("SensorCable", [(-1.42, 1.5, 0.92), (-1.05, 2.4, 1.0), (-0.55, 3.45, 0.72)], orange, 0.045, root)

# A few visible fasteners prevent broad surfaces from reading as toy blocks.
for x in (-1.25, 1.25):
    for z in (-1.08, 1.08):
        cylinder(f"DeckFastener_{x}_{z}", 0.055, 0.035, (x, 0.49, z), steel, vertices=10, parent=root)

# --- Mechanical detail pass -------------------------------------------------
# Independent stabilizer jacks make the machine look anchored before drilling.
for index, (x, z) in enumerate(((-1.72, -1.5), (-1.72, 1.5), (1.72, -1.5), (1.72, 1.5))):
    cylinder(f"JackOuter_{index}", 0.13, 0.52, (x, 0.56, z), dark, vertices=16, parent=root)
    cylinder(f"JackRam_{index}", 0.075, 0.42, (x, 0.25, z), steel, vertices=16, parent=root)
    cylinder(f"JackPad_{index}", 0.27, 0.08, (x, 0.03, z), dark, vertices=14, parent=root)
    torus(f"JackSeal_{index}", 0.13, 0.025, (x, 0.33, z), orange,
          rotation=(math.pi / 2, 0, 0), parent=root)

# Twin mast rails and sliding shoes clarify how the heavy carriage is constrained.
for z in (-0.56, 0.56):
    box(f"GuideRail_{z}", (0.13, 3.35, 0.12), (-0.55, 2.7, z), steel, bevel=0.025, parent=root)
    for y in (2.95, 3.58):
        box(f"GuideShoe_{z}_{y}", (0.34, 0.25, 0.25), (-0.55, y, z), orange, bevel=0.045, parent=carriage)

# Hydraulic lift cylinders: outer barrel, polished rod, pins and fluid hoses.
for side in (-1, 1):
    z = side * 0.88
    barrel_start = (-0.9, 1.05, z)
    barrel_end = (-0.72, 2.55, z * 0.7)
    rod_end = (-0.55, 3.55, z * 0.58)
    cylinder_between(f"LiftBarrel_{side}", barrel_start, barrel_end, 0.13, dark, 18, root)
    cylinder_between(f"LiftRod_{side}", barrel_end, rod_end, 0.075, steel, 16, root)
    sphere(f"LiftPinLower_{side}", 0.17, barrel_start, orange, root, 12)
    sphere(f"LiftPinUpper_{side}", 0.14, rod_end, orange, root, 12)
    cable(f"HydraulicHose_{side}", [(-1.35, 1.0, side * 0.72), (-1.18, 1.8, side * 1.0),
          (-0.92, 2.6, side * 0.86), (-0.62, 3.38, side * 0.66)], rubber, 0.055, root)

# Reduction gearbox under the motor, with bearing caps and an inspection window.
box("GearboxHousing", (1.2, 0.7, 1.0), (-0.55, 4.32, 0), pale, bevel=0.16, parent=root)
box("GearboxLower", (0.9, 0.28, 0.78), (-0.55, 3.91, 0), dark, bevel=0.08, parent=root)
for z in (-0.54, 0.54):
    cylinder(f"GearboxBearing_{z}", 0.25, 0.12, (-0.55, 4.3, z), dark,
             rotation=(math.pi / 2, 0, 0), vertices=18, parent=root)
    torus(f"GearboxFlange_{z}", 0.27, 0.045, (-0.55, 4.3, z * 1.03), orange, parent=root)
box("OilSightGlass", (0.28, 0.28, 0.035), (0.08, 4.22, 0.22), amber, bevel=0.035, parent=root)

# Motor cooling fins and rear fan guard.
for i in range(9):
    z = -0.48 + i * 0.12
    torus(f"MotorCoolingFin_{i}", 0.48, 0.025, (-0.55, 4.95, z), steel, parent=root)
torus("FanGuardOuter", 0.4, 0.035, (-0.55, 4.95, -0.79), orange, parent=root)
for angle in (0, math.pi / 3, math.pi * 2 / 3):
    box(f"FanGuardBar_{angle}", (0.72, 0.035, 0.035), (-0.55, 4.95, -0.8), steel,
        rotation=(0, 0, angle), bevel=0.01, parent=root)

# Service ladder and waist-height maintenance platform.
for x in (-1.58, -1.22):
    box(f"LadderRail_{x}", (0.08, 2.15, 0.08), (x, 2.0, -1.33), orange, bevel=0.02, parent=root)
for i in range(8):
    box(f"LadderRung_{i}", (0.44, 0.055, 0.065), (-1.4, 1.05 + i * 0.28, -1.33), steel,
        bevel=0.015, parent=root)
box("ServicePlatform", (1.2, 0.12, 0.8), (-1.0, 3.02, -0.95), dark, bevel=0.04, parent=root)
for x in (-1.55, -0.45):
    box(f"PlatformPost_{x}", (0.065, 0.72, 0.065), (x, 3.42, -1.3), orange, bevel=0.015, parent=root)
box("PlatformHandrail", (1.18, 0.065, 0.065), (-1.0, 3.76, -1.3), orange, bevel=0.015, parent=root)

# Perforated-looking drive guard, built as a frame and repeated ribs for low cost.
box("DriveGuardTop", (1.34, 0.08, 0.08), (-0.55, 5.56, 0.86), orange, bevel=0.02, parent=root)
box("DriveGuardBottom", (1.34, 0.08, 0.08), (-0.55, 4.35, 0.86), orange, bevel=0.02, parent=root)
for i in range(7):
    x = -1.13 + i * 0.19
    box(f"DriveGuardRib_{i}", (0.045, 1.12, 0.045), (x, 4.95, 0.86), steel,
        rotation=(0, 0, math.radians(-12)), bevel=0.01, parent=root)

# Hydraulic manifold, valves and pressure gauge next to the operator cabinet.
box("HydraulicManifold", (0.58, 0.3, 0.42), (-1.32, 2.32, 0.28), steel, bevel=0.055, parent=root)
for i, x in enumerate((-1.5, -1.32, -1.14)):
    cylinder(f"ValveStem_{i}", 0.04, 0.18, (x, 2.56, 0.28), steel, vertices=10, parent=root)
    box(f"ValveHandle_{i}", (0.18, 0.04, 0.05), (x, 2.68, 0.28), orange,
        rotation=(0, i * 0.5, 0), bevel=0.012, parent=root)
cylinder("PressureGaugeBody", 0.18, 0.08, (-1.32, 2.52, -0.02), dark,
         rotation=(math.pi / 2, 0, 0), vertices=20, parent=root)
cylinder("PressureGaugeFace", 0.14, 0.015, (-1.32, 2.52, -0.07), pale,
         rotation=(math.pi / 2, 0, 0), vertices=20, parent=root)

# Flexible cable chain following the carriage path.
for i in range(13):
    phase = i / 12
    y = 1.25 + phase * 2.45
    x = -1.03 + math.sin(phase * math.pi) * 0.18
    box(f"CableChainLink_{i}", (0.18, 0.13, 0.27), (x, y, -0.64), rubber,
        rotation=(0, 0, -0.1 + phase * 0.2), bevel=0.025, parent=root)

# Dust skirt and sacrificial wear plates around the drilling throat.
for angle in range(0, 360, 30):
    rad = math.radians(angle)
    box(f"DustSkirt_{angle}", (0.24, 0.42, 0.08),
        (-0.25 + math.cos(rad) * 0.78, 0.66, math.sin(rad) * 0.78), rubber,
        rotation=(0, rad, 0), bevel=0.02, parent=root)
for angle in range(0, 360, 45):
    rad = math.radians(angle)
    cylinder(f"CollectorBolt_{angle}", 0.045, 0.075,
             (-0.25 + math.cos(rad) * 0.7, 1.08, math.sin(rad) * 0.7), steel,
             vertices=10, parent=root)

# Real ore pieces ride on the final rollers to sell the machine's purpose.
for i, x in enumerate((1.15, 1.58, 2.02)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.17 + i * 0.015, location=(x, 1.23, (-0.16 + i * 0.17)))
    chunk = tag(bpy.context.object)
    chunk.name = f"OreChunk_{i}"
    chunk.scale = (1.25, 0.7, 0.9)
    chunk.rotation_euler = (i * 0.4, i * 0.7, i * 0.23)
    chunk.data.materials.append(ore)
    chunk.parent = root

# Small labels and button hierarchy on the control face.
for i, color in enumerate((cyan, amber, orange)):
    cylinder(f"ControlButton_{i}", 0.045, 0.025, (-1.63 + i * 0.16, 1.1, 1.185), color,
             rotation=(math.pi / 2, 0, 0), vertices=12, parent=root)
box("EmergencyStopCollar", (0.22, 0.07, 0.22), (-1.18, 1.1, 1.18), pale, bevel=0.03, parent=root)
cylinder("EmergencyStop", 0.085, 0.07, (-1.18, 1.1, 1.23), amber,
         rotation=(math.pi / 2, 0, 0), vertices=16, parent=root)

# --- Readability and construction refinement --------------------------------
# A visible coupling stack closes the mechanical gap from motor to drill head.
cylinder("DriveOutputShaft", 0.16, 0.95, (-0.55, 4.38, 0), steel, vertices=18, parent=root)
torus("UpperThrustBearing", 0.28, 0.055, (-0.55, 3.94, 0), orange,
      rotation=(math.pi / 2, 0, 0), parent=root)
torus("LowerThrustBearing", 0.28, 0.055, (-0.55, 3.76, 0), steel,
      rotation=(math.pi / 2, 0, 0), parent=root)
for angle in range(0, 360, 60):
    rad = math.radians(angle)
    cylinder(f"ThrustBolt_{angle}", 0.035, 0.08,
             (-0.55 + math.cos(rad) * 0.29, 3.84, math.sin(rad) * 0.29), steel,
             vertices=10, parent=root)

# Replace the ring-like auger impression with a continuous helical cutting flight.
helix("ContinuousAugerFlight", (0, 0, 0), 0.33, 0.78, 2.48, 5, orange, 0.075, drill)
helix("GreaseLineOnShaft", (0, 0, 0), 0.205, 2.55, 3.28, 2, rubber, 0.022, drill)

# Grease distributor and four feed tubes around the thrust bearing.
cylinder("GreaseDistributor", 0.18, 0.18, (0.02, 3.68, 0), orange, vertices=14, parent=root)
for index, angle in enumerate((0.3, 1.8, 3.3, 4.8)):
    end = (-0.25 + math.cos(angle) * 0.4, 3.52, math.sin(angle) * 0.4)
    cable(f"GreaseTube_{index}", [(0.02, 3.68, 0), (-0.02, 3.62, math.sin(angle) * 0.25), end],
          rubber, 0.018, root)

# Hydraulic power pack: reservoir, pump, fill cap, level glass and finned oil cooler.
box("HydraulicTank", (1.02, 1.05, 0.86), (0.96, 1.42, -1.02), pale, bevel=0.13, parent=root)
box("HydraulicTankLower", (1.08, 0.2, 0.92), (0.96, 0.86, -1.02), dark, bevel=0.05, parent=root)
cylinder("HydraulicFillCap", 0.12, 0.1, (0.72, 2.01, -1.05), orange, vertices=14, parent=root)
box("OilLevelGlass", (0.08, 0.46, 0.035), (1.5, 1.42, -0.82), amber, bevel=0.018, parent=root)
cylinder("HydraulicPumpMotor", 0.26, 0.72, (1.08, 1.16, -1.55), dark,
         rotation=(math.pi / 2, 0, 0), vertices=18, parent=root)
for i in range(7):
    box(f"OilCoolerFin_{i}", (0.055, 0.72, 0.62), (0.48 + i * 0.1, 1.42, -1.5), steel,
        bevel=0.012, parent=root)
cable("HydraulicSupply", [(0.85, 1.1, -1.42), (0.15, 0.85, -1.35), (-0.7, 1.1, -1.15), (-1.2, 2.3, -0.7)], rubber, 0.065, root)
cable("HydraulicReturn", [(1.15, 1.15, -1.42), (0.7, 0.72, -1.28), (-0.45, 0.8, -1.3), (-1.08, 2.2, -0.6)], orange, 0.04, root)

# Real conveyor anatomy: continuous belt, raised cleats, tensioner and geared drive.
box("OutputBeltSurface", (1.72, 0.055, 0.67), (1.65, 1.14, 0), rubber, bevel=0.018, parent=root)
for i, x in enumerate((0.92, 1.22, 1.52, 1.82, 2.12, 2.4)):
    box(f"BeltCleat_{i}", (0.055, 0.065, 0.62), (x, 1.205, 0), steel, bevel=0.012, parent=root)
cylinder("OutputDriveMotor", 0.23, 0.62, (2.18, 0.63, -0.63), dark,
         rotation=(math.pi / 2, 0, 0), vertices=18, parent=root)
cylinder("OutputGearbox", 0.29, 0.25, (2.18, 0.82, -0.48), orange,
         rotation=(math.pi / 2, 0, 0), vertices=14, parent=root)
cylinder("BeltTensioner", 0.13, 0.92, (0.78, 0.88, 0), steel,
         rotation=(math.pi / 2, 0, 0), vertices=14, parent=root)
for z in (-0.52, 0.52):
    beam(f"TensionArm_{z}", (0.72, 0.67, z), (0.78, 0.9, z), 0.075, orange, root)

# Hopper receives a sloped throat, wear liners and fastening rows instead of a plain box.
box("HopperThroat", (0.62, 0.58, 0.72), (0.3, 1.18, 0), dark,
    rotation=(0, 0, math.radians(-18)), bevel=0.08, parent=root)
for z in (-0.57, 0.57):
    box(f"HopperWearRail_{z}", (1.05, 0.08, 0.075), (0.72, 1.63, z), steel,
        rotation=(0, 0, math.radians(-10)), bevel=0.02, parent=root)
    for i, x in enumerate((0.28, 0.62, 0.96, 1.3)):
        cylinder(f"HopperBolt_{z}_{i}", 0.033, 0.045, (x, 1.69, z * 1.03), steel,
                 rotation=(math.pi / 2, 0, 0), vertices=10, parent=root)

# Body seams, access panels, raised asset ID and diagonal safety markings.
box("MainAccessPanel", (0.82, 0.72, 0.035), (0.78, 1.36, 0.66), dark, bevel=0.04, parent=root)
for x in (0.42, 1.14):
    for y in (1.08, 1.64):
        cylinder(f"AccessPanelBolt_{x}_{y}", 0.028, 0.035, (x, y, 0.69), steel,
                 rotation=(math.pi / 2, 0, 0), vertices=8, parent=root)
label("AssetID", "FX-M1", (0.78, 1.45, 0.695), 0.22, pale, root)
for i in range(5):
    box(f"HazardStripe_{i}", (0.18, 0.045, 0.38), (-0.03 + i * 0.2, 0.56, 1.64), orange,
        rotation=(math.radians(28), 0, 0), bevel=0.008, parent=root)

# Exhaust/filter cluster and task lights provide scale and maintenance logic.
cylinder("BreatherCanister", 0.2, 0.72, (1.42, 2.36, -1.12), dark, vertices=18, parent=root)
for i in range(5):
    torus(f"BreatherRib_{i}", 0.2, 0.022, (1.42, 2.08 + i * 0.13, -1.12), steel,
          rotation=(math.pi / 2, 0, 0), parent=root)
cylinder("BreatherCap", 0.25, 0.1, (1.42, 2.76, -1.12), orange, vertices=16, parent=root)
for index, (x, z) in enumerate(((-0.9, 0.92), (0.72, 0.92))):
    box(f"WorkLightBody_{index}", (0.36, 0.24, 0.16), (x, 3.1, z), dark, bevel=0.055, parent=root)
    box(f"WorkLightLens_{index}", (0.25, 0.14, 0.025), (x, 3.1, z + 0.095), cyan, bevel=0.025, parent=root)

# Dense but cheap fastening rows on the base skid and mast crown.
for x in (-1.42, -0.72, 0, 0.72, 1.42):
    for z in (-1.38, 1.38):
        cylinder(f"SkidBolt_{x}_{z}", 0.035, 0.045, (x, 0.45, z), steel, vertices=8, parent=root)
for x in (-1.05, -0.55, -0.05):
    for z in (-0.55, 0.55):
        cylinder(f"CrownBolt_{x}_{z}", 0.035, 0.05, (x, 4.82, z), steel, vertices=8, parent=root)

# Looping 2-second animation, exported inside the GLB.
drill.rotation_euler.y = 0
drill.keyframe_insert("rotation_euler", frame=1, index=1)
drill.rotation_euler.y = -math.pi * 4
drill.keyframe_insert("rotation_euler", frame=49, index=1)
drive_wheel.rotation_euler.z = 0
drive_wheel.keyframe_insert("rotation_euler", frame=1, index=2)
drive_wheel.rotation_euler.z = -math.pi * 2
drive_wheel.keyframe_insert("rotation_euler", frame=49, index=2)
carriage.location.y = 0.12
carriage.keyframe_insert("location", frame=1, index=1)
carriage.location.y = -0.14
carriage.keyframe_insert("location", frame=25, index=1)
carriage.location.y = 0.12
carriage.keyframe_insert("location", frame=49, index=1)
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 49
scene.render.fps = 24

# Preview-only stage.
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=5.2, depth=0.25, location=(0, 0.02, 0))
preview_ground = bpy.context.object
preview_ground.name = "PREVIEW_Ground"
preview_ground.data.materials.append(ground_mat)

key_data = bpy.data.lights.new("Key", "AREA")
key_data.energy = 3300
key_data.shape = "DISK"
key_data.size = 5
key = bpy.data.objects.new("Key", key_data)
key.location = (-5, -6, 9)
key.rotation_euler = (Vector((0, 0, 2.2)) - key.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.collection.objects.link(key)

rim_data = bpy.data.lights.new("CyanRim", "AREA")
rim_data.energy = 1850
rim_data.color = (0.12, 0.75, 0.82)
rim_data.size = 4
rim = bpy.data.objects.new("CyanRim", rim_data)
rim.location = (5, 3, 6)
rim.rotation_euler = (Vector((0, 0, 2.4)) - rim.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.collection.objects.link(rim)

front_data = bpy.data.lights.new("FrontFill", "AREA")
front_data.energy = 2400
front_data.color = (0.95, 0.72, 0.5)
front_data.size = 4.5
front = bpy.data.objects.new("FrontFill", front_data)
front.location = (2.5, -7.5, 4.2)
front.rotation_euler = (Vector((0, 0, 2.1)) - front.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.collection.objects.link(front)

camera_data = bpy.data.cameras.new("PreviewCamera")
camera = bpy.data.objects.new("PreviewCamera", camera_data)
camera.location = (9.8, -12.2, 8.0)
camera.rotation_euler = (Vector((0.15, 0, 2.25)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.lens = 58
bpy.context.collection.objects.link(camera)
scene.camera = camera

world = scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.006, 0.014, 0.017, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.48

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(ROOT / "factoryx_miner_preview.png")
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0.65
scene.frame_set(13)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "factoryx_miner.blend"))
bpy.ops.render.render(write_still=True)

# A second, closer render is used to judge construction detail before game integration.
camera.location = (6.3, -7.6, 5.35)
camera.rotation_euler = (Vector((0.2, 0, 2.45)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.lens = 64
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.filepath = str(ROOT / "factoryx_miner_detail.png")
bpy.ops.render.render(write_still=True)

# Export only tagged asset objects; lights, camera and preview floor stay behind.
bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    if obj.get("fx_asset_role") in {"visual", "animation"}:
        obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=str(ROOT / "factoryx_miner.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_animations=True,
    export_materials="EXPORT",
)

for obj in bpy.context.selected_objects:
    if obj.type == "MESH":
        obj.data.calc_loop_triangles()
triangles = sum(len(obj.data.loop_triangles) for obj in bpy.context.selected_objects if obj.type == "MESH")
print(f"FactoryX miner complete: {triangles} triangles")
