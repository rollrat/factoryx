import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

const inventoryFor = (...buildingIds: string[]) => {
  const totals = new Map<string, number>();
  buildingIds.forEach((id) => START_REGISTRY.buildings.get(id)!.buildCost.forEach(({ itemId, amount }) => {
    totals.set(itemId, (totals.get(itemId) ?? 0) + amount * 3);
  }));
  return [...totals].map(([itemId, amount]) => ({ itemId, amount }));
};

test("foundations use a support layer and allow a building on the same cells", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -48, maxX: 48, minZ: -48, maxZ: 48 },
    constructionInventory: inventoryFor("foundation_2m", "arc_smelter"),
    terrainPlacement: (definition, _position, _rotation, context) => (
      definition.placementMode === "preplaced_unique" || definition.terrainPolicy?.role === "foundation" || context.foundationCoverage
        ? { ok: true }
        : { ok: false, reason: "foundation_required" }
    ),
  });
  const foundation = world.place({ buildingId: "foundation_2m", position: { x: 20, z: 20 }, rotation: 0 });
  assert.equal(foundation.ok, true);
  const smelter = world.place({ buildingId: "arc_smelter", position: { x: 20, z: 20 }, rotation: 0 });
  assert.equal(smelter.ok, true);
  assert.equal(world.allInstances().filter(({ position }) => position.x === 20 && position.z === 20).length, 2);
  assert.equal(world.instanceAt({ x: 20, z: 20 })?.definitionId, "arc_smelter");
  if (smelter.ok) world.demolish(smelter.instance.id);
  assert.equal(world.instanceAt({ x: 20, z: 20 })?.definitionId, "foundation_2m");
});

test("ports do not connect across strata unless both endpoints are shaft sockets", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
    constructionInventory: inventoryFor("conveyor_mk1", "shaft_logistics_socket"),
  });
  world.unlock("thermal_verified");
  assert.equal(world.place({ buildingId: "conveyor_mk1", position: { x: 30, z: 30 }, rotation: 0 }).ok, true);
  assert.equal(world.place({ buildingId: "conveyor_mk1", position: { x: 32, z: 30 }, rotation: 0, stratumId: "rift_depths", elevation: -12 }).ok, true);
  let production = new WorldProductionSimulation(world);
  assert.equal(production.connections().length, 0);

  assert.equal(world.place({ buildingId: "shaft_logistics_socket", position: { x: 40, z: 40 }, rotation: 0 }).ok, true);
  assert.equal(world.place({ buildingId: "shaft_logistics_socket", position: { x: 44, z: 40 }, rotation: 0, stratumId: "rift_depths", elevation: -12 }).ok, true);
  production = new WorldProductionSimulation(world);
  assert.ok(production.connections().some((connection) => connection.fromInstanceId !== connection.toInstanceId));
});

test("surface and cave strata may safely occupy the same x/z coordinates", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -48, maxX: 48, minZ: -48, maxZ: 48 },
    constructionInventory: inventoryFor("conveyor_mk1"),
  });
  const surface = world.place({ buildingId: "conveyor_mk1", position: { x: 24, z: 24 }, rotation: 0 });
  const cave = world.place({ buildingId: "conveyor_mk1", position: { x: 24, z: 24 }, rotation: 0, elevation: -12, stratumId: "rift_depths" });
  assert.equal(surface.ok, true);
  assert.equal(cave.ok, true);
  assert.equal(world.instanceAt({ x: 24, z: 24 }, "surface")?.id, surface.ok ? surface.instance.id : null);
  assert.equal(world.instanceAt({ x: 24, z: 24 }, "rift_depths")?.id, cave.ok ? cave.instance.id : null);
  const restored = new DataDrivenWorld({ registry: START_REGISTRY, bounds: world.bounds, snapshot: world.snapshot() });
  assert.equal(restored.instanceAt({ x: 24, z: 24 }, "surface")?.definitionId, "conveyor_mk1");
  assert.equal(restored.instanceAt({ x: 24, z: 24 }, "rift_depths")?.stratumId, "rift_depths");
});
