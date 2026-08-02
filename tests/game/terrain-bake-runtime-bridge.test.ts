import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { A17_ENVIRONMENT, EnvironmentRenderer } from "../../app/game/environment/index.ts";
import { TerrainRenderer } from "../../app/game/environment/render/TerrainRenderer.ts";
import { TerrainSampler } from "../../app/game/environment/terrain/TerrainSampler.ts";
import type { TerrainBakeSampler } from "../../app/game/environment/terrain/TerrainBake.ts";
import { WorldSourceEnvironmentSampler } from "../../app/game/environment/worldSourceSampler/WorldSourceEnvironmentSampler.ts";
import { IRONWIND_WORLD_SOURCE_V3 } from "../../app/game/environment/worldSourceV3/index.ts";
import { terrainBakeSourceIdentity } from "../../app/game/environment/terrain/TerrainBake.ts";

const bakedHeight = 37.25;
const externalSampler: TerrainBakeSampler = {
  sample: (x, z) => ({
    height: bakedHeight + x * 0.01 + z * 0.02,
    normal: { x: 0, y: 1, z: 0 },
    slopeDegrees: 0,
    biomeId: "windglass_basin",
    surface: "stable",
    buildability: "allowed",
    stratumId: "surface",
  }),
};

test("TerrainRenderer streams resident chunk geometry from an optional TerrainBakeSampler", () => {
  const terrain = new TerrainRenderer(A17_ENVIRONMENT, new TerrainSampler(A17_ENVIRONMENT), "high", externalSampler);
  terrain.updateChunks([{ x: 0, z: 0, distance: 0, lod: 0 }]);
  const mesh = terrain.root.getObjectByName("terrain-chunk:0,0:lod0") as THREE.Mesh;
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const normals = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
  assert.equal(terrain.usesExternalBakeSampler(), true);
  assert.equal(mesh.geometry.userData.externalBake, true);
  assert.equal(positions.getY(0), bakedHeight);
  assert.ok(Math.abs(positions.getY(64) - (bakedHeight + 0.32)) < 0.00001);
  assert.deepEqual([normals.getX(0), normals.getY(0), normals.getZ(0)], [0, 1, 0]);
  terrain.dispose();
});

test("EnvironmentRenderer accepts bake injection without changing the legacy TerrainSampler dependency", () => {
  const scene = new THREE.Scene();
  const environment = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low", { terrainBakeSampler: externalSampler });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 0);
  environment.update(1 / 60, camera);
  const mesh = environment.terrain.root.getObjectByName("terrain-chunk:0,0:lod0") as THREE.Mesh;
  assert.equal(environment.terrain.usesExternalBakeSampler(), true);
  assert.equal((mesh.geometry.getAttribute("position") as THREE.BufferAttribute).getY(0), bakedHeight);
  assert.equal(environment.sampler instanceof TerrainSampler, true, "props, weather, and legacy gameplay stay on the existing sampler");
  environment.dispose();
});

test("strict WorldSource bake samplers receive clamped halo coordinates at sector edges", () => {
  const terrain = new TerrainRenderer(
    A17_ENVIRONMENT,
    new TerrainSampler(A17_ENVIRONMENT),
    "high",
    new WorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3),
  );
  assert.doesNotThrow(() => terrain.updateChunks([{ x: -4, z: -4, distance: 0, lod: 0 }]));
  terrain.dispose();
});

test("EnvironmentRenderer composes authored water and cave layers from the same WorldSource", () => {
  const scene = new THREE.Scene();
  const sourceSampler = new WorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3);
  const environment = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low", {
    terrainBakeSampler: sourceSampler,
    terrainBakeSource: terrainBakeSourceIdentity(sourceSampler.source),
    worldSource: sourceSampler.source,
  });

  assert.ok(environment.sourceWater.waterBodyCount() > 0);
  assert.deepEqual(environment.sourceCaves.renderCounts(), { rooms: 2, corridors: 1, entrances: 1 });
  assert.equal(environment.sourceWater.root.visible, true);
  assert.equal(environment.sourceCaves.root.visible, false);
  assert.equal(environment.caves.surfaceEntrances.visible, false, "authored source caves replace legacy cave markers");
  assert.equal(environment.props.root.visible, false, "legacy scatter stays hidden from source-authored terrain");
  assert.equal(environment.surfaceFeatures.root.visible, false, "legacy water and cliff features do not overlap source layers");

  environment.setStratum("thermal_rift_subsurface");
  assert.equal(environment.sourceWater.root.visible, false);
  assert.equal(environment.sourceCaves.root.visible, true);
  environment.setStratum("surface");
  environment.setCaveCutaway(true);
  assert.equal(environment.sourceWater.root.visible, false);
  assert.equal(environment.sourceCaves.root.visible, true);

  environment.dispose();
});

test("source-preview environment disposal is safe before a legacy editor environment is rebuilt", () => {
  const scene = new THREE.Scene();
  const sourceSampler = new WorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3);
  const preview = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low", {
    terrainBakeSampler: sourceSampler,
    terrainBakeSource: terrainBakeSourceIdentity(sourceSampler.source),
    worldSource: sourceSampler.source,
  });
  preview.dispose();
  const legacy = new EnvironmentRenderer(scene, A17_ENVIRONMENT, "low");
  assert.equal(legacy.terrain.usesExternalBakeSampler(), false);
  assert.equal(legacy.sourceWater.waterBodyCount(), 0);
  legacy.dispose();
});
