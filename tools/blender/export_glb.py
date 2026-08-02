from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(args)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    values = [root]
    for child in root.children:
        values.extend(descendants(child))
    return values


def main() -> None:
    args = arguments()
    root = bpy.data.objects.get(f"FX_{args.asset_id}")
    if root is None:
        raise RuntimeError(f"missing FX_{args.asset_id}")
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = descendants(root)
    for obj in export_objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    print(f"FACTORYX_GLB_EXPORTED={output}")


main()
