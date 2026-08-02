import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  A17_ENVIRONMENT,
  BIOMES,
  PROP_SCATTER_PROFILES,
  ROCK_PROP_KEYS,
  TerrainChunkManager,
  TerrainSampler,
  VEGETATION_PROP_KEYS,
  choosePropModel,
  propScatterProfileForBiome,
} from "../../app/game/environment/index.ts";
import { PropScatterRenderer } from "../../app/game/environment/render/PropScatterRenderer.ts";
import { CaveRenderer } from "../../app/game/environment/render/CaveRenderer.ts";

test("every A-17 biome has a normalized mix of three rock and four vegetation families", () => {
  assert.equal(ROCK_PROP_KEYS.length, 3);
  assert.equal(VEGETATION_PROP_KEYS.length, 4);
  for (const biome of BIOMES) {
    const profile = propScatterProfileForBiome(biome.id);
    assert.equal(profile, PROP_SCATTER_PROFILES[biome.id]);
    const rockTotal = ROCK_PROP_KEYS.reduce((sum, key) => sum + (profile.rockWeights[key] ?? 0), 0);
    const vegetationTotal = VEGETATION_PROP_KEYS.reduce((sum, key) => sum + (profile.vegetationWeights[key] ?? 0), 0);
    assert.ok(Math.abs(rockTotal - 1) < 1e-9, `${biome.id} rock weights`);
    assert.ok(Math.abs(vegetationTotal - 1) < 1e-9, `${biome.id} vegetation weights`);
  }
  assert.equal(choosePropModel(PROP_SCATTER_PROFILES.silicate_sailwood, "rock", 0.99), "silicate");
  assert.equal(choosePropModel(PROP_SCATTER_PROFILES.blackwater_marsh, "vegetation", 0.5), "tube");
});

test("cave geometry carries diegetic exit/depth guidance and microbial floor detail", () => {
  const scene = new THREE.Scene();
  const caves = new CaveRenderer(scene, new TerrainSampler(A17_ENVIRONMENT));
  const names: string[] = [];
  caves.root.traverse((child) => { if (child.name) names.push(child.name); });
  assert.ok(names.includes("cave-guide:exit"));
  assert.ok(names.includes("cave-guide:depth"));
  assert.ok(names.includes("cave-portal:surface"));
  assert.ok(names.includes("cave-portal:deep"));
  assert.ok(names.filter((name) => name === "cave-biofilm").length >= 8);
  caves.dispose();
});

test("scatter visibility counts only active, uncleared prop instances", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const renderer = new PropScatterRenderer(A17_ENVIRONMENT, sampler, "high");
  const renderedFamilies = new Set(renderer.root.children
    .map((child) => child.userData.modelKey as string | undefined)
    .filter((modelKey): modelKey is string => Boolean(modelKey)));
  assert.deepEqual(renderedFamilies, new Set([...ROCK_PROP_KEYS, ...VEGETATION_PROP_KEYS]));
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 8, 0);
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT).update(0, 0, "high");
  renderer.update(1 / 60, camera, chunks);
  const visibleBeforeClearing = renderer.visibleInstanceCount();
  assert.ok(visibleBeforeClearing > 0);
  assert.ok(visibleBeforeClearing < renderer.instanceCount);

  const firstVisibleMesh = renderer.root.children.find((child): child is THREE.InstancedMesh => (
    child instanceof THREE.InstancedMesh && child.visible && child.count > 1
  ));
  assert.ok(firstVisibleMesh);
  const beforeDensityChange = renderer.visibleInstanceCount();
  firstVisibleMesh.count -= 1;
  assert.equal(renderer.visibleInstanceCount(), beforeDensityChange - 1);

  renderer.applyFoundationClearing([A17_ENVIRONMENT.worldBounds]);
  assert.equal(renderer.visibleInstanceCount(), 0);
  assert.equal(renderer.obstaclesOutside([A17_ENVIRONMENT.worldBounds]).length, 0);
  renderer.dispose();
});

test("prop ids remain stable across quality levels and saved clearing is reapplied", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const high = new PropScatterRenderer(A17_ENVIRONMENT, sampler, "high");
  const low = new PropScatterRenderer(A17_ENVIRONMENT, sampler, "low");
  const highIds = new Set(high.propIds());
  assert.ok(highIds.size > low.propIds().length);
  assert.equal(low.propIds().every((id) => highIds.has(id)), true);

  const persistedId = high.propIds().find((id) => !low.propIds().includes(id))!;
  low.applyClearedPropIds([persistedId, "prop:a17_folded_by_wind:rock:999999", "not-a-prop"]);
  assert.deepEqual(low.clearedPropIds(), [persistedId], "low quality must retain deltas for currently uninstantiated props");
  const restoredHigh = new PropScatterRenderer(A17_ENVIRONMENT, sampler, "high");
  restoredHigh.applyClearedPropIds(low.clearedPropIds());
  assert.deepEqual(restoredHigh.clearedPropIds(), [persistedId]);

  const total = restoredHigh.propIds().length;
  restoredHigh.applyFoundationClearing([A17_ENVIRONMENT.worldBounds]);
  assert.equal(restoredHigh.clearedPropIds().length, total);
  restoredHigh.applyFoundationClearing([]);
  assert.equal(restoredHigh.clearedPropIds().length, total, "foundation-cleared props are persistent environment deltas");
  high.dispose();
  low.dispose();
  restoredHigh.dispose();
});

test("authored rock and vegetation clusters create deterministic runtime instances", () => {
  const strokes = [
    { brush: "rock_scatter" as const, x: 34, z: 28, radius: 10, strength: 1.2 },
    { brush: "vegetation_scatter" as const, x: -42, z: 22, radius: 12, strength: 1.4 },
  ];
  const first = new PropScatterRenderer(A17_ENVIRONMENT, new TerrainSampler(A17_ENVIRONMENT, strokes), "high");
  const second = new PropScatterRenderer(A17_ENVIRONMENT, new TerrainSampler(A17_ENVIRONMENT, strokes), "high");
  const firstAuthored = first.propIds().filter((id) => id.startsWith("authored-prop:"));
  const secondAuthored = second.propIds().filter((id) => id.startsWith("authored-prop:"));
  assert.ok(firstAuthored.length >= 2);
  assert.deepEqual(firstAuthored, secondAuthored);
  assert.ok(first.root.children.some((child) => child instanceof THREE.InstancedMesh && child.userData.authoredCluster === true));

  const before = first.instanceCount;
  first.setDensity(0.5);
  first.setAuthoringClusters();
  assert.equal(first.instanceCount, before);
  first.dispose();
  second.dispose();
});
