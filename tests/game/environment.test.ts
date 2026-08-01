import assert from "node:assert/strict";
import test from "node:test";

import {
  A17_DAY_LENGTH_SECONDS,
  A17_ENVIRONMENT,
  BIOMES,
  EnvironmentCycle,
  TerrainChunkManager,
  TerrainSampler,
  chooseEnvironmentQuality,
  parseWorldStudioDocument,
} from "../../app/game/environment/index.ts";
import { createEnvironmentSnapshot, isEnvironmentSnapshotCompatible } from "../../app/game/environment/persistence/environmentSnapshot.ts";
import { migrateWorldSnapshotBounds } from "../../app/game/sim/world.ts";

test("A-17 defines the six authored production biomes inside a 256m sector", () => {
  assert.equal(BIOMES.length, 6);
  assert.deepEqual(A17_ENVIRONMENT.worldBounds, { minX: -128, maxX: 127, minZ: -128, maxZ: 127 });
  assert.deepEqual(A17_ENVIRONMENT.constructionBounds, { minX: -128, maxX: 127, minZ: -128, maxZ: 127 });
  assert.deepEqual(new Set(BIOMES.flatMap(({ resourceAffinity }) => resourceAffinity)), new Set([
    "iron_ore", "copper_ore", "limestone", "coal", "quartz", "crude_oil", "bauxite", "tungsten_ore",
  ]));
});

test("legacy 25m saves expand to the terrain MVP bounds without changing contents", () => {
  const snapshot = {
    version: 1 as const,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    nextInstanceId: 4,
    unlockedIds: ["start"],
    constructionInventory: [],
    instances: [],
  };
  const migrated = migrateWorldSnapshotBounds(snapshot, A17_ENVIRONMENT.constructionBounds);
  assert.deepEqual(migrated.bounds, A17_ENVIRONMENT.constructionBounds);
  assert.equal(migrated.nextInstanceId, snapshot.nextInstanceId);
  assert.deepEqual(migrated.instances, snapshot.instances);
  assert.throws(() => migrateWorldSnapshotBounds(migrated, snapshot.bounds), /only expand/);
});

test("terrain sampling is deterministic and preserves the starting survey pad", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  assert.deepEqual(sampler.sample(3, -4), sampler.sample(3, -4));
  assert.equal(sampler.sample(0, 0).height, -0.5);
  assert.equal(sampler.sample(0, 0).biomeId, "windglass_basin");
  assert.equal(sampler.sample(72, -48).biomeId, "ironwind_faults");
  assert.equal(sampler.sample(-72, 18).biomeId, "silicate_sailwood");
  assert.equal(sampler.sample(74, 58).biomeId, "blackwater_marsh");
  assert.equal(sampler.sample(-62, -72).biomeId, "hematite_crown");
  assert.equal(sampler.sample(12, 96).biomeId, "thermal_rift");
  assert.equal(sampler.sample(4, 108, "rift_depths").surface, "cave_floor");
  assert.equal(sampler.sample(60, 60, "rift_depths").surface, "steep");
});

test("terrain chunks stay within the 5x5 and 3x3 performance budgets", () => {
  const chunks = new TerrainChunkManager(A17_ENVIRONMENT);
  assert.equal(chunks.update(0, 0, "high").length, 25);
  assert.equal(chunks.update(0, 0, "low").length, 9);
  assert.ok(chunks.update(126, 126, "high").length < 25);
});

test("environment persistence stores only deterministic identity and player deltas", () => {
  const snapshot = createEnvironmentSnapshot(A17_ENVIRONMENT, {
    removedPropIds: ["rock-9", "rock-2", "rock-9"],
    stabilizedHazardIds: ["vent-a"],
  });
  assert.deepEqual(snapshot.removedPropIds, ["rock-2", "rock-9"]);
  assert.equal(isEnvironmentSnapshotCompatible(snapshot, A17_ENVIRONMENT), true);
  assert.equal(isEnvironmentSnapshotCompatible({ ...snapshot, environmentId: "other" }, A17_ENVIRONMENT), false);
});

test("the authored clock completes one A-17 day in 36 real minutes", () => {
  const cycle = new EnvironmentCycle(0, 0);
  const before = cycle.state();
  const after = cycle.advance(A17_DAY_LENGTH_SECONDS);
  assert.ok(Math.abs(before.timeOfDay - after.timeOfDay) < 1e-9);
});

test("environment quality respects low-memory and reduced-motion hardware", () => {
  assert.equal(chooseEnvironmentQuality({ deviceMemory: 4, hardwareConcurrency: 16 }), "low");
  assert.equal(chooseEnvironmentQuality({ deviceMemory: 16, hardwareConcurrency: 12, pixelRatio: 1 }), "high");
  assert.equal(chooseEnvironmentQuality({ reducedMotion: true }), "low");
});

test("world-studio strokes drive the same runtime terrain sampler", () => {
  const document = parseWorldStudioDocument({
    format: "factoryx-world-studio", version: 1, environmentId: A17_ENVIRONMENT.id,
    environmentVersion: 1, seed: A17_ENVIRONMENT.seed,
    strokes: [
      { brush: "raise", x: 30, z: 30, radius: 4, strength: 2 },
      { brush: "surface", x: 30, z: 30, radius: 3, strength: 1, surface: "hazard" },
      { brush: "biome", x: 30, z: 30, radius: 3, strength: 1, biomeId: "silicate_sailwood" },
    ],
    timeOfDay: 0.5, fogDensity: 0.01, weather: "clear", weatherStrength: 0,
  }, A17_ENVIRONMENT.id);
  assert.ok(document);
  const base = new TerrainSampler(A17_ENVIRONMENT);
  const authored = new TerrainSampler(A17_ENVIRONMENT, document.strokes);
  assert.ok(authored.heightAt(30, 30) > base.heightAt(30, 30) + 1.9);
  assert.equal(authored.sample(30, 30).surface, "hazard");
  assert.equal(authored.sample(30, 30).biomeId, "silicate_sailwood");
});
