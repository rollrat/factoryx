import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";
import { A17_ENVIRONMENT, TerrainSampler, evaluateTerrainPlacement, resolveTerrainMovement } from "../../app/game/environment/index.ts";
import { RESOURCE_ANCHORS } from "../../app/game/data/resourceAnchors.ts";
import { inferAdjacentPowerEdges } from "../../app/game/sim/physicalPowerNetwork.ts";

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

  const surfaceShaft = world.place({ buildingId: "shaft_logistics_socket", position: { x: 40, z: 40 }, rotation: 0 });
  const caveShaft = world.place({ buildingId: "shaft_logistics_socket", position: { x: 44, z: 40 }, rotation: 0, stratumId: "rift_depths", elevation: -12 });
  assert.ok(surfaceShaft.ok && caveShaft.ok);
  production = new WorldProductionSimulation(world);
  assert.deepEqual(new Set(production.connections().map(({ medium }) => medium)), new Set(["solid", "fluid"]));
  assert.ok(inferAdjacentPowerEdges(world).some((edge) => edge.from.ownerId !== edge.to.ownerId));
  if (!surfaceShaft.ok || !caveShaft.ok) return;
  assert.equal(production.deposit(surfaceShaft.instance.id, "solid_out", "output", "iron_ore", 2), true);
  assert.equal(production.deposit(surfaceShaft.instance.id, "shaft_fluid_out", "output", "crude_oil", 3), true);
  production.advance(3);
  const caveNode = production.snapshot().nodes.find(({ instanceId }) => instanceId === caveShaft.instance.id)!;
  assert.ok([...caveNode.inputs, ...caveNode.outputs].some(({ itemId, amount }) => itemId === "iron_ore" && amount > 0));
  assert.ok(caveNode.outputs.some(({ itemId, amount }) => itemId === "crude_oil" && amount > 0));
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

test("bridges share their support layer with belts and ramps provide a traversable rise", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
    constructionInventory: inventoryFor("short_bridge", "conveyor_mk1"),
    terrainPlacement: (_definition, _position, _rotation, context) => context.foundationCoverage
      ? { ok: true } : { ok: true },
  });
  world.unlock("phase_1_complete");
  assert.equal(world.place({ buildingId: "short_bridge", position: { x: 24, z: 24 }, rotation: 0, elevation: 0 }).ok, true);
  assert.equal(world.place({ buildingId: "conveyor_mk1", position: { x: 24, z: 24 }, rotation: 0, elevation: 2 }).ok, true);
  assert.equal(world.allInstances().filter(({ position }) => position.x === 24 && position.z === 24).length, 2);

  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const ramp = [{ minX: 0, maxX: 2, minZ: 0, maxZ: 4, baseElevation: -0.5, rise: 2, rotation: 0 as const, kind: "ramp" as const }];
  let position = { x: 1, z: 0 };
  let elevation = -0.5;
  for (let step = 1; step <= 8; step += 1) {
    const moved = resolveTerrainMovement(sampler, position, { x: 1, z: step * 0.5 }, "surface", ramp);
    position = moved.position;
    elevation = moved.elevation;
  }
  assert.equal(position.z, 4);
  assert.ok(elevation > 1.4);
});

test("conveyor lifts and pipe risers preserve cargo across a three metre elevation", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
    constructionInventory: inventoryFor("conveyor_mk1", "conveyor_lift", "pipe_mk1", "pipe_riser"),
  });
  world.unlock("phase_1_complete");
  world.unlock("phase_3_complete");
  const place = (buildingId: string, x: number, z: number, elevation: number) => world.place({ buildingId, position: { x, z }, rotation: 1, elevation });
  const lowerBelt = place("conveyor_mk1", 20, -2, 0);
  const lift = world.place({ buildingId: "conveyor_lift", position: { x: 20, z: 0 }, rotation: 0, elevation: 0 });
  const upperBelt = place("conveyor_mk1", 20, 2, 3);
  const lowerPipe = place("pipe_mk1", 30, -2, 0);
  const riser = world.place({ buildingId: "pipe_riser", position: { x: 30, z: 0 }, rotation: 0, elevation: 0 });
  const upperPipe = place("pipe_mk1", 30, 2, 3);
  assert.ok(lowerBelt.ok && lift.ok && upperBelt.ok && lowerPipe.ok && riser.ok && upperPipe.ok,
    JSON.stringify({ lowerBelt, lift, upperBelt, lowerPipe, riser, upperPipe }));
  if (!lowerBelt.ok || !upperBelt.ok || !lowerPipe.ok || !upperPipe.ok) return;
  const production = new WorldProductionSimulation(world);
  assert.equal(production.deposit(lowerBelt.instance.id, "solid_out", "output", "iron_ore", 1), true);
  assert.equal(production.deposit(lowerPipe.instance.id, "pipe_out", "output", "crude_oil", 3), true);
  production.advance(4);
  const upperSolid = ["solid_in", "solid_out"].reduce((sum, portId) => sum + production.inventory(upperBelt.instance.id, portId, portId === "solid_in" ? "input" : "output").amount, 0);
  const upperFluid = ["pipe_in", "pipe_out"].reduce((sum, portId) => sum + production.inventory(upperPipe.instance.id, portId, portId === "pipe_in" ? "input" : "output").amount, 0);
  assert.equal(upperSolid, 1);
  const fluidNodes = production.snapshot().nodes.filter(({ instanceId }) => [lowerPipe.instance.id, riser.ok ? riser.instance.id : "", upperPipe.instance.id].includes(instanceId));
  const totalFluid = fluidNodes.reduce((sum, node) => sum + node.outputs.reduce((portSum, port) => portSum + port.amount, 0), 0);
  assert.ok(upperFluid > 0);
  assert.equal(totalFluid, 3);
});

test("hazard extraction requires a nearby stabilizer and cave placement samples its own stratum", () => {
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: A17_ENVIRONMENT.constructionBounds,
    constructionInventory: inventoryFor("fluid_extractor", "hazard_stabilizer", "vein_miner"),
    terrainPlacement: (definition, position, rotation, context) => {
      const verdict = evaluateTerrainPlacement(sampler, definition, position, rotation, context.stratumId);
      if (definition.terrainPolicy?.role === "hazard_stabilizer") return { ok: true };
      if (verdict.reason === "terrain_hazard" && context.hazardStabilized) return { ok: true };
      return verdict.allowed ? { ok: true } : { ok: false, reason: verdict.reason ?? "terrain_clearance" };
    },
  });
  world.unlock("phase_3_complete");
  world.unlock("thermal_verified");
  const oil = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "crude_oil")!;
  const oilElevation = sampler.constructionHeightAt(oil.position.x, oil.position.z);
  assert.equal(world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0, elevation: oilElevation }).reason, "terrain_hazard");
  assert.equal(world.place({ buildingId: "hazard_stabilizer", position: { x: oil.position.x + 4, z: oil.position.z }, rotation: 0, elevation: oilElevation }).ok, true);
  assert.equal(world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0, elevation: oilElevation }).ok, true);

  const tungsten = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "tungsten_ore")!;
  assert.equal(world.place({ buildingId: "vein_miner", position: tungsten.position, rotation: 0, stratumId: "surface", elevation: 0 }).reason, "invalid_resource_anchor");
  assert.equal(world.place({ buildingId: "vein_miner", position: tungsten.position, rotation: 0, stratumId: tungsten.stratumId, elevation: tungsten.elevation }).ok, true);
});
