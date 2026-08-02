from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def arguments() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(args)


def triangle_count(obj: bpy.types.Object) -> int:
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def main() -> None:
    args = arguments()
    errors: list[str] = []
    root = bpy.data.objects.get(f"FX_{args.asset_id}")
    if root is None:
        errors.append("missing asset root")
    lod_counts: list[int] = []
    for lod in range(3):
        node = bpy.data.objects.get(f"VIS_LOD{lod}")
        mesh = bpy.data.objects.get(f"{args.asset_id}_lod{lod}")
        if node is None or mesh is None or mesh.type != "MESH":
            errors.append(f"missing VIS_LOD{lod} hierarchy")
            lod_counts.append(0)
            continue
        lod_counts.append(triangle_count(mesh))
        if any(abs(value - 1) > 1e-6 for value in mesh.scale):
            errors.append(f"LOD{lod} has unapplied scale")
        if mesh.data.materials.__len__() > 2:
            errors.append(f"LOD{lod} exceeds material budget")
    collision = bpy.data.objects.get(f"{args.asset_id}_collision")
    collision_triangles = triangle_count(collision) if collision and collision.type == "MESH" else 0
    if collision_triangles == 0 or collision_triangles > 128:
        errors.append("collision mesh missing or too dense")
    if not (lod_counts[0] > lod_counts[1] > lod_counts[2] > 0):
        errors.append("LOD triangle counts must strictly decrease")
    if root is not None and root.get("fx_asset_id") != args.asset_id:
        errors.append("root asset id mismatch")

    report = {
        "schemaVersion": 1,
        "assetId": args.asset_id,
        "blenderVersion": bpy.app.version_string,
        "lodTriangles": lod_counts,
        "collisionTriangles": collision_triangles,
        "errors": errors,
    }
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    if errors:
        raise RuntimeError("; ".join(errors))


main()
