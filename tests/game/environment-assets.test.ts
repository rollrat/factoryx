import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../../public/assets/environment/manifests/environment-assets.json", import.meta.url);
const catalogUrl = new URL("../../art/catalog.json", import.meta.url);
const modelUrl = (assetId: string) => new URL(`../../public/assets/environment/models/${assetId}.glb`, import.meta.url);

test("the Blender environment assets ship validated LOD GLBs", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    schemaVersion: number;
    assets: Array<{
      id: string;
      kind: string;
      url: string;
      lodNodes: string[];
      lodTriangles: number[];
      collisionNode: string;
      collisionNodes?: string[];
      collisionTriangles: number;
      socketNode?: string;
    }>;
  };
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8")) as {
    assets: Array<{ id: string; lodTriangleCaps: number[]; collisionTriangleCap: number }>;
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(
    manifest.assets.map(({ id }) => id).sort(),
    catalog.assets.map(({ id }) => id).sort(),
    "catalog and runtime manifest must cover the same assets",
  );
  for (const { id: assetId, lodTriangleCaps, collisionTriangleCap } of catalog.assets) {
    const asset = manifest.assets.find(({ id }) => id === assetId);
    assert.ok(asset);
    assert.deepEqual(asset.lodNodes, ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"]);
    assert.ok(asset.lodTriangles[0] > asset.lodTriangles[1]);
    assert.ok(asset.lodTriangles[1] > asset.lodTriangles[2]);
    asset.lodTriangles.forEach((triangles, lod) => assert.ok(triangles <= lodTriangleCaps[lod], `${assetId} LOD${lod} exceeds cap`));
    assert.ok(asset.collisionTriangles <= collisionTriangleCap);

    const binary = await readFile(modelUrl(assetId));
    assert.equal(binary.readUInt32LE(0), 0x46546c67);
    assert.equal(binary.readUInt32LE(4), 2);
    const jsonLength = binary.readUInt32LE(12);
    const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/g, "")) as {
      nodes: Array<{ name?: string; extras?: Record<string, unknown> }>;
    };
    const names = new Set(gltf.nodes.map(({ name }) => name));
    const collisionNodes = asset.collisionNodes ?? [asset.collisionNode];
    for (const name of [
      `FX_${assetId}`, "VIS_LOD0", "VIS_LOD1", "VIS_LOD2",
      ...collisionNodes, asset.socketNode ?? "SOCKETS", "META",
      `${assetId}_lod0`, `${assetId}_lod1`, `${assetId}_lod2`,
    ]) assert.ok(names.has(name), `missing ${name}`);
    if (asset.kind !== "environment_cliff") assert.ok(names.has("FX_POINTS"), `missing FX_POINTS`);
    const root = gltf.nodes.find(({ name }) => name === `FX_${assetId}`);
    assert.equal(root?.extras?.fx_asset_id, assetId);
  }
});

test("the Ironwind cliff kit publishes its collision and socket contracts", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    assets: Array<{ id: string; kind: string; collisionNode: string; collisionNodes?: string[]; socketNode?: string }>;
  };
  const expected = new Map<string, string[]>([
    ["ironwind_cliff_straight_16m", ["COL_WALL", "COL_WALKABLE"]],
    ["ironwind_cliff_outer_corner", ["COL_WALL", "COL_WALKABLE"]],
    ["ironwind_natural_arch", ["COL_WALL"]],
  ]);
  for (const [id, collisions] of expected) {
    const asset = manifest.assets.find((candidate) => candidate.id === id);
    assert.ok(asset, `missing ${id}`);
    assert.equal(asset.kind, "environment_cliff");
    assert.equal(asset.collisionNode, "COL_WALL");
    assert.deepEqual(asset.collisionNodes, collisions);
    assert.equal(asset.socketNode, "SOCKETS");
  }
});
