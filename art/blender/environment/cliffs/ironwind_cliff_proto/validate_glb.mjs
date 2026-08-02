import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve(process.argv[2] ?? ".");
const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const required = ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2", "SOCKETS", "META"];

const results = [];
for (const asset of manifest.assets) {
  const glbPath = path.join(outputDir, asset.output);
  const binary = await readFile(glbPath);
  const errors = [];
  if (binary.readUInt32LE(0) !== 0x46546c67) errors.push("invalid GLB magic");
  if (binary.readUInt32LE(4) !== 2) errors.push("GLB version is not 2");
  if (binary.readUInt32LE(16) !== 0x4e4f534a) errors.push("missing JSON chunk");
  const jsonLength = binary.readUInt32LE(12);
  const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/g, ""));
  const nodes = new Map((gltf.nodes ?? []).filter(({ name }) => name).map((node) => [node.name, node]));
  for (const node of required) if (!nodes.has(node)) errors.push(`missing node: ${node}`);
  for (const node of asset.collisionNodes) if (!nodes.has(node)) errors.push(`missing collision node: ${node}`);
  const root = nodes.get(`FX_${asset.id}`);
  if (!root) errors.push("missing root node");
  if (root?.extras?.fx_asset_id !== asset.id) errors.push("root asset id mismatch");
  const embedded = (() => {
    try { return JSON.parse(root?.extras?.factoryx ?? "{}"); } catch { return {}; }
  })();
  if (embedded.coordinateSystem?.up !== "+Y") errors.push("embedded contract is not +Y up");
  if (embedded.unitMeters !== 1) errors.push("embedded contract is not 1m/unit");
  const socketNames = asset.kind === "cliff_arch"
    ? ["cliff.start", "cliff.end", "cliff.top", "cliff.bottom", "talus.attach", "cave.portal"]
    : asset.kind === "cliff_transition"
      ? ["cliff.start", "cliff.end", "cliff.top", "cliff.bottom", "talus.attach", "arch.attach"]
      : asset.kind === "cliff_breached"
        ? ["cliff.start", "cliff.end", "cliff.top", "cliff.bottom", "talus.attach", "breach.center"]
        : asset.kind === "cliff_talus"
          ? ["talus.attach", "talus.start", "talus.end"]
          : ["cliff.start", "cliff.end", "cliff.top", "cliff.bottom", "talus.attach"];
  for (const socket of socketNames) if (!nodes.has(socket)) errors.push(`missing socket: ${socket}`);
  if (asset.lodTriangles.some((value, index, all) => index > 0 && value >= all[index - 1])) {
    errors.push("LOD triangle counts are not strictly descending");
  }
  results.push({ assetId: asset.id, bytes: binary.length, nodeCount: nodes.size, errors });
}

manifest.validation = {
  validator: "factoryx-cliff-contract-v1",
  passed: results.every(({ errors }) => errors.length === 0),
  results,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (!manifest.validation.passed) {
  console.error(JSON.stringify(manifest.validation, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(manifest.validation, null, 2));
