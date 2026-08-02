import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT } from "../../app/game/environment/data/environment.ts";
import { TerrainRenderer } from "../../app/game/environment/render/TerrainRenderer.ts";
import { terrainClusterExclusionAt, terrainMaterialMaskAt, terrainTriplanarWeights } from "../../app/game/environment/render/TerrainMaterialContract.ts";
import { TerrainSampler } from "../../app/game/environment/terrain/TerrainSampler.ts";
import type { TerrainSample } from "../../app/game/environment/types.ts";

const terrainSample = (surface: TerrainSample["surface"], slopeDegrees: number, normal: TerrainSample["normal"]): TerrainSample => ({
  height: 0, normal, slopeDegrees, biomeId: "test", surface,
  buildability: surface === "stable" ? "allowed" : "restricted", stratumId: "surface",
});

test("terrain material contract deterministically separates water, cliffs, and world-space triplanar weights", () => {
  const stable = terrainSample("stable", 0, { x: 0, y: 1, z: 0 });
  const submerged = terrainSample("submerged", 0, { x: 0, y: 1, z: 0 });
  const cliff = terrainSample("steep", 48, { x: 0.75, y: 0.44, z: 0.49 });

  assert.deepEqual(terrainMaterialMaskAt(stable), terrainMaterialMaskAt(stable));
  assert.equal(terrainClusterExclusionAt(stable).excluded, false);
  assert.deepEqual(terrainClusterExclusionAt(submerged), { excluded: true, reason: "water" });
  assert.deepEqual(terrainClusterExclusionAt(cliff), { excluded: true, reason: "cliff" });
  assert.equal(terrainMaterialMaskAt(submerged).wetness, 1);
  assert.equal(terrainMaterialMaskAt(cliff).clusterSafe, 0);
  const weights = terrainTriplanarWeights(cliff.normal);
  assert.ok(Math.abs(weights.x + weights.y + weights.z - 1) < 0.000001);
  assert.ok(weights.x > 0 && weights.y > 0 && weights.z > 0);
});

test("terrain chunks carry the biome/slope/wetness/exposure mask through all LOD geometry", () => {
  const terrain = new TerrainRenderer(A17_ENVIRONMENT, new TerrainSampler(A17_ENVIRONMENT), "high");
  terrain.updateChunks([{ x: 0, z: 0, distance: 0, lod: 0 }]);
  const mesh = terrain.root.getObjectByName("terrain-chunk:0,0:lod0") as THREE.Mesh;
  const mask = mesh.geometry.getAttribute("terrainMask") as THREE.BufferAttribute;
  assert.equal(mask.itemSize, 4);
  assert.equal(mask.count, (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).count);
  assert.equal((mesh.material as THREE.Material).userData.materialContract, "vertex-biome + slope-wetness-exposure + triplanar-breakup-v1");
  for (let index = 0; index < Math.min(mask.count, 20); index += 1) {
    assert.ok(mask.getX(index) >= 0 && mask.getX(index) <= 1);
    assert.ok(mask.getY(index) >= 0 && mask.getY(index) <= 1);
    assert.ok(mask.getZ(index) >= 0 && mask.getZ(index) <= 1);
    assert.ok(mask.getW(index) === 0 || mask.getW(index) === 1);
  }
  terrain.dispose();
});
