import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../../public/assets/environment/manifests/environment-assets.json", import.meta.url);
const modelUrl = (assetId: string) => new URL(`../../public/assets/environment/models/${assetId}.glb`, import.meta.url);

test("the Blender environment assets ship validated LOD GLBs", async () => {
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
  for (const assetId of [
    "rock_basalt_medium_a",
    "rock_windglass_shard_cluster_a",
    "rock_hematite_slab_a",
    "flora_wind_fan_a",
    "flora_marsh_tube_a",
  ]) {
    const asset = manifest.assets.find(({ id }) => id === assetId);
    assert.ok(asset);
    assert.deepEqual(asset.lodNodes, ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"]);
    assert.ok(asset.lodTriangles[0] > asset.lodTriangles[1]);
    assert.ok(asset.lodTriangles[1] > asset.lodTriangles[2]);
    assert.ok(asset.collisionTriangles <= 128);

    const binary = await readFile(modelUrl(assetId));
    assert.equal(binary.readUInt32LE(0), 0x46546c67);
    assert.equal(binary.readUInt32LE(4), 2);
    const jsonLength = binary.readUInt32LE(12);
    const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/g, "")) as {
      nodes: Array<{ name?: string; extras?: Record<string, unknown> }>;
    };
    const names = new Set(gltf.nodes.map(({ name }) => name));
    for (const name of [
      `FX_${assetId}`, "VIS_LOD0", "VIS_LOD1", "VIS_LOD2",
      "COL_SIMPLE", "SOCKETS", "FX_POINTS", "META",
      `${assetId}_lod0`, `${assetId}_lod1`, `${assetId}_lod2`,
    ]) assert.ok(names.has(name), `missing ${name}`);
    const root = gltf.nodes.find(({ name }) => name === `FX_${assetId}`);
    assert.equal(root?.extras?.fx_asset_id, assetId);
  }
});
