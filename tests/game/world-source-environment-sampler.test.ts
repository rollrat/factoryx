import assert from "node:assert/strict";
import test from "node:test";

import { WorldSourceEnvironmentSampler, createWorldSourceEnvironmentSampler } from "../../app/game/environment/index.ts";
import { IRONWIND_WORLD_SOURCE_V3 } from "../../app/game/environment/worldSourceV3/index.ts";

test("WorldSourceEnvironmentSampler is a strict, deterministic TerrainBakeSampler adapter", () => {
  const first = createWorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3);
  const second = new WorldSourceEnvironmentSampler(structuredClone(IRONWIND_WORLD_SOURCE_V3));
  assert.deepEqual(first.sample(45, -48), second.sample(45, -48));
  assert.deepEqual(first.sample(45, -48), {
    height: first.terrain.sample(45, -48).height,
    normal: first.terrain.sample(45, -48).normal,
    slopeDegrees: first.terrain.sample(45, -48).slopeDegrees,
    biomeId: first.terrain.sample(45, -48).biome.biomeId ?? "unassigned",
    surface: "stable",
    buildability: "allowed",
    stratumId: "surface",
  });
  assert.throws(() => createWorldSourceEnvironmentSampler({ ...IRONWIND_WORLD_SOURCE_V3, schemaVersion: 99 }), /Invalid WorldSourceV3/);
});

test("WorldSourceEnvironmentSampler applies water, route/build zones, slope, and cave clearance deterministically", () => {
  const sampler = new WorldSourceEnvironmentSampler(IRONWIND_WORLD_SOURCE_V3);
  const water = sampler.sample(70, 60);
  assert.equal(water.surface, "hazard", "the higher-priority hazard zone owns the marsh classification");
  assert.equal(water.buildability, "restricted");
  const waterWithoutHazardZone = new WorldSourceEnvironmentSampler({ ...IRONWIND_WORLD_SOURCE_V3, gameplayZones: [] });
  assert.equal(waterWithoutHazardZone.sample(60, 60).surface, "submerged");
  assert.equal(sampler.sample(-98, -86).surface, "steep");
  assert.deepEqual(sampler.sample(44, -31), {
    ...sampler.sample(44, -31), surface: "stable", buildability: "allowed",
  }, "an authored route stays buildable even where its graded slope would otherwise require a foundation");
  assert.deepEqual(sampler.sample(4, 116, "rift_depths"), {
    height: -22,
    normal: { x: 0, y: 1, z: 0 },
    slopeDegrees: 0,
    biomeId: sampler.terrain.sample(4, 116, "rift_depths").biome.biomeId ?? "unassigned",
    surface: "cave_floor",
    buildability: "allowed",
    stratumId: "rift_depths",
  });
  assert.equal(sampler.caveSpaceAt(4, 116, "rift_depths")?.clearance, 13);
  assert.deepEqual(sampler.caveSpaceAt(9, 107.2, "rift_depths"), {
    graphId: "thermal-rift-cave", roomId: null, corridorId: "rift-entry-corridor", floorHeight: -20.037837837837838, clearance: 6,
  });
  const lowClearance = new WorldSourceEnvironmentSampler({
    ...IRONWIND_WORLD_SOURCE_V3,
    caves: IRONWIND_WORLD_SOURCE_V3.caves.map((cave) => ({
      ...cave,
      corridors: cave.corridors.map((corridor) => ({ ...corridor, clearance: 2 })),
    })),
  });
  assert.equal(lowClearance.sample(9, 107.2, "rift_depths").buildability, "restricted");
  const outsideCave = sampler.sample(70, 70, "rift_depths");
  assert.equal(outsideCave.surface, "steep");
  assert.equal(outsideCave.buildability, "restricted");
});
