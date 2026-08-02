import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../../public/assets/environment/manifests/environment-assets.json", import.meta.url);
const glbUrl = new URL("../../public/assets/environment/models/rock_basalt_medium_a.glb", import.meta.url);

test("the Blender environment vertical slice ships a validated LOD GLB", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    schemaVersion: number;
    assets: Array<{
      id: string;
      url: string;
      lodNodes: string[];
      lodTriangles: number[];
      collisionTriangles: number;
    }>;
  };
  assert.equal(manifest.schemaVersion, 1);
  const asset = manifest.assets.find(({ id }) => id === "rock_basalt_medium_a");
  assert.ok(asset);
  assert.deepEqual(asset.lodNodes, ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"]);
  assert.ok(asset.lodTriangles[0] > asset.lodTriangles[1]);
  assert.ok(asset.lodTriangles[1] > asset.lodTriangles[2]);
  assert.ok(asset.collisionTriangles <= 128);

  const binary = await readFile(glbUrl);
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  assert.equal(binary.readUInt32LE(4), 2);
  const jsonLength = binary.readUInt32LE(12);
  const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/g, "")) as {
    nodes: Array<{ name?: string; extras?: Record<string, unknown> }>;
  };
  const names = new Set(gltf.nodes.map(({ name }) => name));
  for (const name of [
    "FX_rock_basalt_medium_a", "VIS_LOD0", "VIS_LOD1", "VIS_LOD2",
    "COL_SIMPLE", "SOCKETS", "FX_POINTS", "META",
    "rock_basalt_medium_a_lod0", "rock_basalt_medium_a_lod1", "rock_basalt_medium_a_lod2",
  ]) assert.ok(names.has(name), `missing ${name}`);
  const root = gltf.nodes.find(({ name }) => name === "FX_rock_basalt_medium_a");
  assert.equal(root?.extras?.fx_asset_id, "rock_basalt_medium_a");
});
