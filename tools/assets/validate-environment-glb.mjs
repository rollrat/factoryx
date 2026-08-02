import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , glbPath, reportPath, manifestPath] = process.argv;
if (!glbPath || !reportPath || !manifestPath) {
  throw new Error("usage: node validate-environment-glb.mjs <glb> <blender-report> <manifest>");
}

const binary = await readFile(glbPath);
if (binary.readUInt32LE(0) !== 0x46546c67 || binary.readUInt32LE(4) !== 2) throw new Error("invalid GLB header");
const jsonLength = binary.readUInt32LE(12);
if (binary.readUInt32LE(16) !== 0x4e4f534a) throw new Error("missing GLB JSON chunk");
const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/g, ""));
const blenderReport = JSON.parse(await readFile(reportPath, "utf8"));
const assetId = blenderReport.assetId;
const requiredNodes = [`FX_${assetId}`, "VIS_LOD0", "VIS_LOD1", "VIS_LOD2", "COL_SIMPLE", "SOCKETS", "FX_POINTS", "META"];
const nodeNames = new Set((gltf.nodes ?? []).map(({ name }) => name).filter(Boolean));
const missingNodes = requiredNodes.filter((name) => !nodeNames.has(name));
if (missingNodes.length) throw new Error(`missing GLB nodes: ${missingNodes.join(", ")}`);
if (gltf.asset?.version !== "2.0") throw new Error("GLB must use glTF 2.0");
if (blenderReport.errors.length) throw new Error(`Blender validation failed: ${blenderReport.errors.join(", ")}`);

const root = (gltf.nodes ?? []).find(({ name }) => name === `FX_${assetId}`);
if (!root?.extras || root.extras.fx_asset_id !== assetId) throw new Error("root extras asset id mismatch");
const stat = { bytes: binary.length };
const manifest = {
  schemaVersion: 1,
  generatedAt: "deterministic",
  assets: [{
    id: assetId,
    kind: "environment_prop",
    url: `/assets/environment/models/${path.basename(glbPath)}`,
    previewUrl: `/assets/environment/previews/${assetId}.png`,
    lodNodes: ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"],
    collisionNode: "COL_SIMPLE",
    lodTriangles: blenderReport.lodTriangles,
    collisionTriangles: blenderReport.collisionTriangles,
    bytes: stat.bytes,
  }],
};
await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
