import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT, EnvironmentRenderer, WorldSourceEnvironmentSampler } from "../../app/game/environment/index.ts";
import { terrainBakeSourceIdentity } from "../../app/game/environment/terrain/TerrainBake.ts";
import { IRONWIND_WORLD_SOURCE_V3 } from "../../app/game/environment/worldSourceV3/index.ts";

type WorldStudioSourcePreviewApi = Readonly<{
  setWorldSourcePreview: (source: typeof IRONWIND_WORLD_SOURCE_V3 | null) => void;
}>;

const createSourcePreviewEnvironment = (scene: THREE.Scene) => {
  const sourceSampler = new WorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3);
  return new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low", {
    terrainBakeSampler: sourceSampler,
    terrainBakeSource: terrainBakeSourceIdentity(sourceSampler.source),
    worldSource: sourceSampler.source,
  });
};

test("World Studio declares the public v3 preview switch contract", async () => {
  const { WorldStudioRuntime } = await import("../../app/game/worldStudio.ts");
  const api = WorldStudioRuntime.prototype as unknown as Partial<WorldStudioSourcePreviewApi>;
  assert.equal(typeof api.setWorldSourcePreview, "function", "WorldStudioRuntime must expose setWorldSourcePreview(source | null)");
});

test("v3 preview handoff has source water/caves and external bake, while legacy restoration has none", () => {
  const scene = new THREE.Scene();
  const legacy = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low");
  assert.equal(legacy.terrain.usesExternalBakeSampler(), false);
  assert.equal(legacy.sourceWater.waterBodyCount(), 0);
  assert.deepEqual(legacy.sourceCaves.renderCounts(), { rooms: 0, corridors: 0, entrances: 0 });
  assert.equal(legacy.caves.surfaceEntrances.visible, true);
  legacy.dispose();
  assert.equal(scene.children.includes(legacy.root), false);

  const preview = createSourcePreviewEnvironment(scene);
  assert.equal(preview.terrain.usesExternalBakeSampler(), true, "preview must use the external WorldSourceV3 terrain bake");
  assert.equal(preview.sourceWater.waterBodyCount(), IRONWIND_WORLD_SOURCE_V3.waterBodies.length);
  assert.deepEqual(preview.sourceCaves.renderCounts(), { rooms: 2, corridors: 1, entrances: 1 });
  assert.equal(preview.caves.surfaceEntrances.visible, false, "v3 cave source replaces legacy entrance markers");
  preview.dispose();
  assert.equal(scene.children.includes(preview.root), false);
  assert.equal(preview.sourceWater.root.children.length, 0);
  assert.equal(preview.sourceCaves.root.children.length, 0);

  const restoredLegacy = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low");
  assert.equal(restoredLegacy.terrain.usesExternalBakeSampler(), false);
  assert.equal(restoredLegacy.sourceWater.waterBodyCount(), 0);
  assert.deepEqual(restoredLegacy.sourceCaves.renderCounts(), { rooms: 0, corridors: 0, entrances: 0 });
  restoredLegacy.dispose();
  assert.equal(scene.children.length, 0);
});

test("repeated legacy to v3 preview handoffs release source roots instead of accumulating them", () => {
  const scene = new THREE.Scene();
  for (let index = 0; index < 3; index += 1) {
    const preview = createSourcePreviewEnvironment(scene);
    assert.equal(scene.children.filter((child) => child === preview.root).length, 1);
    preview.dispose();
    assert.equal(scene.children.length, 0, `v3 preview ${index} leaked a scene root`);

    const legacy = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low");
    assert.equal(scene.children.filter((child) => child === legacy.root).length, 1);
    legacy.dispose();
    assert.equal(scene.children.length, 0, `legacy restoration ${index} leaked a scene root`);
  }
});
