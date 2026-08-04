from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parent
blend_path = ROOT / "factoryx_miner.blend"
output_path = ROOT / "factoryx_miner_animation.mp4"
frames_dir = ROOT / "_animation_frames"
frames_dir.mkdir(exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(blend_path))

scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 49
scene.render.fps = 24
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(frames_dir / "frame_")

bpy.ops.render.render(animation=True)
print(f"Animation frames saved: {frames_dir}")
