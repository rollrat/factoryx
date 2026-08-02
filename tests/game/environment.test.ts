import assert from "node:assert/strict";
import test from "node:test";

import {
  A17_DAY_LENGTH_SECONDS,
  A17_DAY_PHASES,
  A17_ENVIRONMENT,
  BIOMES,
  EnvironmentCycle,
  TerrainChunkManager,
  TerrainSampler,
  SURFACE_ACCESS_ROUTES,
  chooseEnvironmentQuality,
  createTerrainPlacementValidator,
  a17SolarElevationAt,
  parseWorldStudioDocument,
} from "../../app/game/environment/index.ts";
import { RESOURCE_ANCHORS } from "../../app/game/data/resourceAnchors.ts";
import { resolveTerrainMovement } from "../../app/game/environment/collision/TerrainCollision.ts";
import { createEnvironmentSnapshot, isEnvironmentSnapshotCompatible } from "../../app/game/environment/persistence/environmentSnapshot.ts";
import { migrateWorldSnapshotBounds } from "../../app/game/sim/world.ts";
import { START_REGISTRY } from "../../app/game/data/index.ts";

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

test("authored preplaced survey-pad structures remain restorable across terrain migrations", () => {
  const validator = createTerrainPlacementValidator(new TerrainSampler(A17_ENVIRONMENT));
  const projectDock = START_REGISTRY.buildings.get("project_dock")!;
  assert.deepEqual(validator(projectDock, { x: 8, z: -2 }, 0, {
    foundationCoverage: false,
    hazardStabilized: false,
    stratumId: "surface",
  }), { ok: true });
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

test("terrain height is continuous across the former four-meter noise cells", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  for (let boundary = -120; boundary <= 120; boundary += 4) {
    const acrossX = Math.abs(sampler.heightAt(boundary - 0.001, 47.3) - sampler.heightAt(boundary + 0.001, 47.3));
    const acrossZ = Math.abs(sampler.heightAt(-39.7, boundary - 0.001) - sampler.heightAt(-39.7, boundary + 0.001));
    assert.ok(acrossX < 0.01, `x=${boundary} jumped ${acrossX}m`);
    assert.ok(acrossZ < 0.01, `z=${boundary} jumped ${acrossZ}m`);
  }
});

test("blackwater has authored water while survey pads and access routes stay dry", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  assert.equal(sampler.waterLevelAt(0, 0), null);
  assert.equal(sampler.waterLevelAt(44, 35), null);
  const level = sampler.waterLevelAt(48, 25);
  assert.ok(level !== null);
  assert.ok(level > sampler.heightAt(48, 25));
  assert.ok(["submerged", "hazard"].includes(sampler.sample(48, 25).surface));
});

test("authored cave shortcut corridors participate in floor-height interpolation", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const shortcutMidpoint = { x: 4, z: 108.5 };
  assert.equal(sampler.isCaveFloorAt(shortcutMidpoint.x, shortcutMidpoint.z, "rift_depths"), true);
  assert.ok(Math.abs(sampler.caveHeightAt(shortcutMidpoint.x, shortcutMidpoint.z, "rift_depths") - (-13.5)) < 1e-9);
  assert.equal(sampler.caveSpaceAt(shortcutMidpoint.x, shortcutMidpoint.z, "rift_depths").shortcut, true);
});

test("cave ceiling and shortcut grade admit logistics but reject oversized machines", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const validator = createTerrainPlacementValidator(sampler);
  const conveyor = START_REGISTRY.buildings.get("conveyor_mk1")!;
  const thermalPlant = START_REGISTRY.buildings.get("high_density_thermal_plant")!;
  const context = { foundationCoverage: false, hazardStabilized: false, stratumId: "rift_depths", elevation: sampler.caveHeightAt(4, 108, "rift_depths") };
  assert.deepEqual(validator(conveyor, { x: 4, z: 108 }, 0, context), { ok: true });
  const oversized = validator(thermalPlant, { x: 1.5, z: 106 }, 0, context);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.reason, "terrain_clearance");
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

test("A-17 light phases preserve the authored 4m dawn, 22m day, 4m dusk, and 6m night", () => {
  assert.deepEqual(A17_DAY_PHASES, {
    dawnStart: 3 / 36,
    dayStart: 7 / 36,
    duskStart: 29 / 36,
    nightStart: 33 / 36,
  });
  assert.ok(a17SolarElevationAt(A17_DAY_PHASES.dayStart) > 0);
  assert.ok(a17SolarElevationAt(0) < 0);
  assert.ok(a17SolarElevationAt(35 / 36) < 0);
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
  }, A17_ENVIRONMENT);
  assert.ok(document);
  const base = new TerrainSampler(A17_ENVIRONMENT);
  const authored = new TerrainSampler(A17_ENVIRONMENT, document.strokes);
  assert.ok(authored.heightAt(30, 30) > base.heightAt(30, 30) + 1.9);
  assert.equal(authored.sample(30, 30).surface, "hazard");
  assert.equal(authored.sample(30, 30).biomeId, "silicate_sailwood");
});

test("authored access corridors keep every required surface resource and cave portal reachable", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  SURFACE_ACCESS_ROUTES.forEach((waypoints) => waypoints.slice(1).forEach((to, index) => {
    const from = waypoints[index];
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    let previous = { x: from.x, z: from.z };
    for (let step = 1; step <= Math.ceil(distance); step += 1) {
      const progress = Math.min(1, step / Math.ceil(distance));
      const desired = {
        x: from.x + (to.x - from.x) * progress,
        z: from.z + (to.z - from.z) * progress,
      };
      const result = resolveTerrainMovement(sampler, previous, desired, "surface", [], (position) => (
        Math.hypot(position.x - 73, position.z - 59) <= 8
      ));
      assert.equal(result.blocked, false, `access route blocked near ${desired.x},${desired.z}`);
      previous = result.position;
    }
  }));
  const routeEnds = SURFACE_ACCESS_ROUTES.map((route) => route[route.length - 1]);
  RESOURCE_ANCHORS.filter(({ stratumId }) => stratumId === "surface").forEach((anchor) => {
    const onStartingPad = Math.max(Math.abs(anchor.position.x), Math.abs(anchor.position.z)) <= 12;
    assert.ok(onStartingPad || routeEnds.some((end) => Math.hypot(end.x - (anchor.position.x + 1), end.z - (anchor.position.z + 1)) <= 5), `${anchor.id} must have an authored route`);
  });
  assert.ok(routeEnds.some((end) => Math.hypot(end.x - 12, end.z - 99) <= 3), "rift portal must have an authored route");
});

test("world-studio v1 drafts migrate to the strict v2 authoring schema", () => {
  const document = parseWorldStudioDocument({
    format: "factoryx-world-studio", version: 1, environmentId: A17_ENVIRONMENT.id,
    environmentVersion: 1, seed: A17_ENVIRONMENT.seed, strokes: [],
    timeOfDay: 4, fogDensity: -1, weather: "not-weather", weatherStrength: 9,
  }, A17_ENVIRONMENT);
  assert.ok(document);
  assert.equal(document.version, 2);
  assert.equal(document.timeOfDay, 1);
  assert.equal(document.fogDensity, 0);
  assert.equal(document.weather, "clear");
  assert.equal(document.weatherStrength, 1);
  assert.equal(document.scatterDensity, 1);
  assert.equal(document.quality, "high");

  assert.equal(parseWorldStudioDocument({
    ...document,
    strokes: [{ brush: "raise", x: Number.NaN, z: 0, radius: 4, strength: 1 }],
  }, A17_ENVIRONMENT), null);
  const { quality: _quality, ...missingRequiredV2Field } = document;
  assert.equal(parseWorldStudioDocument(missingRequiredV2Field, A17_ENVIRONMENT), null);

  assert.equal(parseWorldStudioDocument({ ...document, environmentVersion: A17_ENVIRONMENT.version + 1 }, A17_ENVIRONMENT), null);
  assert.equal(parseWorldStudioDocument({ ...document, seed: A17_ENVIRONMENT.seed + 1 }, A17_ENVIRONMENT), null);
  assert.equal(parseWorldStudioDocument({
    ...document,
    strokes: [{ brush: "biome", x: 10, z: 10, radius: 4, strength: 1, biomeId: "unknown_biome" }],
  }, A17_ENVIRONMENT), null);
  assert.equal(parseWorldStudioDocument({
    ...document,
    landmarkOffsets: { unknown_landmark: { x: 0, z: 0, rotation: 0 } },
  }, A17_ENVIRONMENT), null);
  assert.equal(parseWorldStudioDocument({
    ...document,
    strokes: [{ brush: "raise", x: A17_ENVIRONMENT.worldBounds.maxX + 1, z: 0, radius: 4, strength: 1 }],
  }, A17_ENVIRONMENT), null);
});

test("live authoring replaces sampler state and smooth uses a real neighborhood", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const x = 48;
  const z = 43;
  const neighborhoodMean = () => [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]]
    .reduce((sum, [dx, dz]) => sum + sampler.heightAt(x + dx, z + dz), 0) / 8;
  const beforeDeviation = Math.abs(sampler.heightAt(x, z) - neighborhoodMean());
  sampler.setAuthoringStrokes([{ brush: "smooth", x, z, radius: 8, strength: 2 }]);
  const afterDeviation = Math.abs(sampler.heightAt(x, z) - neighborhoodMean());
  assert.equal(sampler.authoringRevision(), 1);
  assert.ok(afterDeviation < beforeDeviation);
  sampler.setAuthoringStrokes([{ brush: "surface", x, z, radius: 4, strength: 1, surface: "hazard" }]);
  assert.equal(sampler.sample(x, z).surface, "hazard");
});

test("world-studio scatter brushes survive parsing and expose biome-driven clusters", () => {
  const document = parseWorldStudioDocument({
    format: "factoryx-world-studio", version: 2, environmentId: A17_ENVIRONMENT.id,
    environmentVersion: A17_ENVIRONMENT.version, seed: A17_ENVIRONMENT.seed,
    strokes: [
      { brush: "rock_scatter", x: 28, z: 24, radius: 9, strength: 0.8 },
      { brush: "vegetation_scatter", x: -36, z: 18, radius: 12, strength: 1.2 },
    ],
    timeOfDay: 0.5, sunAzimuth: 0, fogDensity: 0.01, weather: "clear", weatherStrength: 0,
    scatterDensity: 1, landmarksVisible: true, resourceAnchorsVisible: true, quality: "high", landmarkOffsets: {},
  }, A17_ENVIRONMENT);
  assert.ok(document);
  const sampler = new TerrainSampler(A17_ENVIRONMENT, document.strokes);
  assert.deepEqual(sampler.scatterClusters().map(({ brush }) => brush), ["rock_scatter", "vegetation_scatter"]);
});
