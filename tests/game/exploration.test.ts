import test from "node:test";
import assert from "node:assert/strict";
import { START_REGISTRY } from "../../app/game/data/index.ts";
import { EXPLORATION_SITES, ExplorationTracker, isExplorationSnapshot } from "../../app/game/environment/exploration.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

test("exploration discovery respects distance and stratum and remains idempotent", () => {
  const tracker = new ExplorationTracker();
  const site = EXPLORATION_SITES[0];
  assert.deepEqual(tracker.discoverNear(site.position.x, site.position.z, "rift_depths"), []);
  assert.deepEqual(tracker.discoverNear(site.position.x + site.discoveryRadius + 0.01, site.position.z, site.stratumId), []);
  assert.equal(tracker.discoverNear(site.position.x + site.discoveryRadius, site.position.z, site.stratumId)[0]?.id, site.id);
  assert.deepEqual(tracker.discoverNear(site.position.x, site.position.z, site.stratumId), []);
  assert.equal(tracker.snapshot().discoveredSiteIds.length, 1);
});

test("exploration snapshots restore known sites and reject unknown or duplicate ids", () => {
  const ids = [EXPLORATION_SITES[1].id, EXPLORATION_SITES[0].id];
  const tracker = new ExplorationTracker({ version: 1, discoveredSiteIds: ids });
  assert.deepEqual(tracker.snapshot().discoveredSiteIds, [...ids].sort());
  assert.equal(isExplorationSnapshot(tracker.snapshot()), true);
  assert.equal(isExplorationSnapshot({ version: 1, discoveredSiteIds: [ids[0], ids[0]] }), false);
  assert.equal(isExplorationSnapshot({ version: 1, discoveredSiteIds: ["unknown"] }), false);
});

test("survey alternate recipe remains locked until its exploration knowledge is granted", () => {
  const world = new DataDrivenWorld({ registry: START_REGISTRY, bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 } });
  const placed = world.place({ buildingId: "arc_smelter", position: { x: 20, z: 20 }, rotation: 0, waiveBuildCost: true });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  const production = new WorldProductionSimulation(world);
  assert.equal(production.selectRecipe(placed.instance.id, "alt_direct_cast_iron_plate"), false);
  world.unlock("survey_casting");
  assert.equal(production.selectRecipe(placed.instance.id, "alt_direct_cast_iron_plate"), true);
  assert.equal(production.nodeState(placed.instance.id)?.selectedRecipeId, "alt_direct_cast_iron_plate");
});
