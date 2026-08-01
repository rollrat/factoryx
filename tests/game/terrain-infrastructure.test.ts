import assert from "node:assert/strict";
import test from "node:test";

import { START_REGISTRY } from "../../app/game/data/index.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";
import { A17_ENVIRONMENT, TerrainSampler, evaluateTerrainPlacement, resolveTerrainMovement } from "../../app/game/environment/index.ts";
import { RESOURCE_ANCHORS } from "../../app/game/data/resourceAnchors.ts";
import { buildPhysicalPowerTopology, createPowerGridInputs, inferAdjacentPowerEdges } from "../../app/game/sim/physicalPowerNetwork.ts";
import { SHAFT_PAIRS } from "../../app/game/data/shaftPairs.ts";
import { AdvancedPowerGrid } from "../../app/game/sim/powerGrid.ts";

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

test("cross-stratum ports require the two authored endpoints of one shaft pair", () => {
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

  const arbitrarySurface = world.place({ buildingId: "shaft_logistics_socket", position: { x: 40, z: 40 }, rotation: 0 });
  const arbitraryCave = world.place({ buildingId: "shaft_logistics_socket", position: { x: 44, z: 40 }, rotation: 0, stratumId: "rift_depths", elevation: -12 });
  assert.ok(arbitrarySurface.ok && arbitraryCave.ok);
  production = new WorldProductionSimulation(world);
  assert.equal(production.connections().length, 0);
  assert.equal(inferAdjacentPowerEdges(world).length, 0);
  if (arbitrarySurface.ok && arbitraryCave.ok) {
    assert.throws(() => buildPhysicalPowerTopology(world, [{
      id: "invalid-cross-stratum-cable",
      from: { ownerId: arbitrarySurface.instance.id, portId: "shaft_power_out" },
      to: { ownerId: arbitraryCave.instance.id, portId: "shaft_power_in" },
    }]), /authored shaft pair/);
  }
  if (arbitrarySurface.ok) world.demolish(arbitrarySurface.instance.id);
  if (arbitraryCave.ok) world.demolish(arbitraryCave.instance.id);

  const pair = SHAFT_PAIRS[0];
  const surfaceShaft = world.place({
    buildingId: "shaft_logistics_socket",
    position: pair.surface.position,
    rotation: pair.surface.rotation,
    stratumId: pair.surface.stratumId,
  });
  const caveShaft = world.place({
    buildingId: "shaft_logistics_socket",
    position: pair.underground.position,
    rotation: pair.underground.rotation,
    stratumId: pair.underground.stratumId,
    elevation: -5,
  });
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

test("a surface generator powers a cave consumer through the authored shaft pair", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: A17_ENVIRONMENT.constructionBounds,
    constructionInventory: inventoryFor("combined_fuel_turbine", "shaft_logistics_socket", "substation", "arc_smelter"),
  });
  world.unlock("phase_2_complete");
  world.unlock("phase_3_complete");
  world.unlock("thermal_verified");
  const pair = SHAFT_PAIRS[0];
  const turbine = world.place({ buildingId: "combined_fuel_turbine", position: { x: 4, z: 99 }, rotation: 0 });
  const surfaceShaft = world.place({ buildingId: "shaft_logistics_socket", ...pair.surface });
  const caveShaft = world.place({ buildingId: "shaft_logistics_socket", ...pair.underground, elevation: -5 });
  const substation = world.place({ buildingId: "substation", position: { x: 17, z: 99 }, rotation: 0, stratumId: "rift_depths", elevation: -5 });
  const consumer = world.place({ buildingId: "arc_smelter", position: { x: 22, z: 99 }, rotation: 0, stratumId: "rift_depths", elevation: -5 });
  assert.ok(turbine.ok && surfaceShaft.ok && caveShaft.ok && substation.ok && consumer.ok,
    JSON.stringify({ turbine, surfaceShaft, caveShaft, substation, consumer }));
  if (!turbine.ok || !substation.ok || !consumer.ok) return;
  const edges = [
    ...inferAdjacentPowerEdges(world),
    {
      id: "cave-local-feed",
      from: { ownerId: substation.instance.id, portId: "local_out" },
      to: { ownerId: consumer.instance.id, portId: "power_in" },
      cableType: "power_local",
      enabled: true,
    },
  ];
  const topology = buildPhysicalPowerTopology(world, edges);
  assert.equal(
    topology.nodes.find(({ instanceId }) => instanceId === turbine.instance.id)?.gridId,
    topology.nodes.find(({ instanceId }) => instanceId === consumer.instance.id)?.gridId,
  );
  const input = createPowerGridInputs(world, topology, 1, {
    [turbine.instance.id]: { fuelAvailable: true, enabled: true },
    [consumer.instance.id]: { active: true },
  }).find(({ consumers }) => consumers.some(({ id }) => id === consumer.instance.id))!;
  const grid = new AdvancedPowerGrid(input.gridId);
  grid.step(input);
  grid.step(input);
  const result = grid.step(input);
  assert.equal(result.consumers.find(({ id }) => id === consumer.instance.id)?.satisfaction, 1);
});

test("multi-cell machines require one compatible support elevation across every cell", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -48, maxX: 48, minZ: -48, maxZ: 48 },
    constructionInventory: inventoryFor("foundation_2m", "foundation_2m", "industrial_storage"),
    terrainPlacement: () => ({ ok: true }),
  });
  world.unlock("phase_2_complete");
  for (const [x, z, elevation] of [[20, 20, 0], [22, 20, 0], [20, 22, 0], [22, 22, 2]] as const) {
    assert.equal(world.place({ buildingId: "foundation_2m", position: { x, z }, rotation: 0, elevation }).ok, true);
  }
  const incompatible = world.place({ buildingId: "industrial_storage", position: { x: 20, z: 20 }, rotation: 0, elevation: 0 });
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.equal(incompatible.reason, "terrain_clearance");

  const flatWorld = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -48, maxX: 48, minZ: -48, maxZ: 48 },
    constructionInventory: inventoryFor("foundation_2m", "foundation_2m", "industrial_storage"),
    terrainPlacement: () => ({ ok: true }),
  });
  flatWorld.unlock("phase_2_complete");
  for (const [x, z] of [[20, 20], [22, 20], [20, 22], [22, 22]] as const) {
    assert.equal(flatWorld.place({ buildingId: "foundation_2m", position: { x, z }, rotation: 0, elevation: 2 }).ok, true);
  }
  assert.equal(flatWorld.place({ buildingId: "industrial_storage", position: { x: 20, z: 20 }, rotation: 0, elevation: 2 }).ok, true);
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

test("conveyor lifts and powered pipe pumps preserve cargo across a three metre riser", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
    constructionInventory: inventoryFor("conveyor_mk1", "conveyor_lift", "pipe_mk1", "pipe_pump", "pipe_riser"),
  });
  world.unlock("phase_1_complete");
  world.unlock("phase_3_complete");
  const place = (buildingId: string, x: number, z: number, elevation: number) => world.place({ buildingId, position: { x, z }, rotation: 1, elevation });
  const lowerBelt = place("conveyor_mk1", 20, -2, 0);
  const lift = world.place({ buildingId: "conveyor_lift", position: { x: 20, z: 0 }, rotation: 0, elevation: 0 });
  const upperBelt = place("conveyor_mk1", 20, 2, 3);
  const lowerPipe = place("pipe_mk1", 30, -4, 0);
  const pump = place("pipe_pump", 30, -2, 0);
  const riser = world.place({ buildingId: "pipe_riser", position: { x: 30, z: 0 }, rotation: 0, elevation: 0 });
  const upperPipe = place("pipe_mk1", 30, 2, 3);
  assert.ok(lowerBelt.ok && lift.ok && upperBelt.ok && lowerPipe.ok && pump.ok && riser.ok && upperPipe.ok,
    JSON.stringify({ lowerBelt, lift, upperBelt, lowerPipe, pump, riser, upperPipe }));
  if (!lowerBelt.ok || !upperBelt.ok || !lowerPipe.ok || !upperPipe.ok) return;
  const production = new WorldProductionSimulation(world);
  assert.equal(production.deposit(lowerBelt.instance.id, "solid_out", "output", "iron_ore", 1), true);
  assert.equal(production.deposit(lowerPipe.instance.id, "pipe_out", "output", "crude_oil", 3), true);
  production.advance(4);
  const upperSolid = ["solid_in", "solid_out"].reduce((sum, portId) => sum + production.inventory(upperBelt.instance.id, portId, portId === "solid_in" ? "input" : "output").amount, 0);
  const upperFluid = ["pipe_in", "pipe_out"].reduce((sum, portId) => sum + production.inventory(upperPipe.instance.id, portId, portId === "pipe_in" ? "input" : "output").amount, 0);
  assert.equal(upperSolid, 1);
  const fluidNodes = production.snapshot().nodes.filter(({ instanceId }) => [lowerPipe.instance.id, pump.ok ? pump.instance.id : "", riser.ok ? riser.instance.id : "", upperPipe.instance.id].includes(instanceId));
  const totalFluid = fluidNodes.reduce((sum, node) => sum + node.outputs.reduce((portSum, port) => portSum + port.amount, 0), 0);
  assert.ok(upperFluid > 0);
  assert.equal(totalFluid, 3);
});

test("an unpumped rise stalls and a pump outage preserves fluid below the riser", () => {
  const makeWorld = (withPump: boolean) => {
    const world = new DataDrivenWorld({
      registry: START_REGISTRY,
      bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 },
      constructionInventory: inventoryFor("pipe_mk1", "pipe_riser", ...(withPump ? ["pipe_pump"] : [])),
    });
    world.unlock("phase_3_complete");
    const place = (buildingId: string, z: number, elevation: number) => world.place({
      buildingId, position: { x: 30, z }, rotation: buildingId === "pipe_riser" ? 0 : 1, elevation,
    });
    const lower = place("pipe_mk1", withPump ? -4 : -2, 0);
    const pump = withPump ? place("pipe_pump", -2, 0) : null;
    const riser = place("pipe_riser", 0, 0);
    const upper = place("pipe_mk1", 2, 3);
    assert.ok(lower.ok && (!pump || pump.ok) && riser.ok && upper.ok);
    if (!lower.ok || !riser.ok || !upper.ok || (pump && !pump.ok)) throw new Error("fluid head fixture placement failed");
    return { world, lower: lower.instance.id, pump: pump?.instance.id ?? null, riser: riser.instance.id, upper: upper.instance.id };
  };
  const upperAmount = (simulation: WorldProductionSimulation, id: string) => (
    simulation.inventory(id, "pipe_in", "output").amount + simulation.inventory(id, "pipe_out", "output").amount
  );

  const unpumped = makeWorld(false);
  const stalled = new WorldProductionSimulation(unpumped.world);
  assert.equal(stalled.deposit(unpumped.lower, "pipe_out", "output", "crude_oil", 3), true);
  stalled.advance(8);
  assert.equal(upperAmount(stalled, unpumped.upper), 0);
  const stalledSnapshot = stalled.snapshot();
  assert.equal(stalledSnapshot.nodes
    .filter(({ instanceId }) => [unpumped.lower, unpumped.riser, unpumped.upper].includes(instanceId))
    .reduce((sum, node) => sum + node.outputs.reduce((subtotal, port) => subtotal + port.amount, 0), 0), 3);

  const pumped = makeWorld(true);
  const outage = new WorldProductionSimulation(pumped.world);
  assert.ok(pumped.pump);
  outage.setPowerSatisfaction(pumped.pump!, 1);
  assert.equal(outage.deposit(pumped.lower, "pipe_out", "output", "crude_oil", 3), true);
  outage.advance(8);
  assert.equal(upperAmount(outage, pumped.upper), 3);
  for (const portId of ["pipe_in", "pipe_out"] as const) {
    const amount = outage.inventory(pumped.upper, portId, "output").amount;
    if (amount > 0) assert.equal(outage.withdraw(pumped.upper, portId, "output", "crude_oil", amount), true);
  }
  outage.setPowerSatisfaction(pumped.pump!, 0);
  assert.equal(outage.deposit(pumped.lower, "pipe_out", "output", "crude_oil", 3), true);
  outage.advance(8);
  assert.equal(upperAmount(outage, pumped.upper), 0);
  const pumpInput = outage.inventory(pumped.pump!, "fluid_in", "input").amount;
  const lowerHeld = outage.inventory(pumped.lower, "pipe_in", "output").amount
    + outage.inventory(pumped.lower, "pipe_out", "output").amount;
  assert.equal(pumpInput + lowerHeld, 3, "outage must retain every cubic metre below the inactive pump");
});

test("powered pumps contribute cumulative head across consecutive rises", () => {
  const world = new DataDrivenWorld({
    registry: START_REGISTRY,
    bounds: A17_ENVIRONMENT.constructionBounds,
    constructionInventory: inventoryFor("pipe_mk1", "pipe_pump", "pipe_riser"),
  });
  world.unlock("phase_3_complete");
  const place = (buildingId: string, z: number, elevation: number) => world.place({
    buildingId, position: { x: 40, z }, rotation: buildingId === "pipe_riser" ? 0 : 1, elevation,
  });
  const lower = place("pipe_mk1", -10, 0);
  const firstPump = place("pipe_pump", -8, 0);
  place("pipe_riser", -6, 0);
  place("pipe_mk1", -4, 3);
  const secondPump = place("pipe_pump", -2, 3);
  place("pipe_riser", 0, 3);
  const upper = place("pipe_mk1", 2, 6);
  assert.ok(lower.ok && firstPump.ok && secondPump.ok && upper.ok);
  if (!lower.ok || !firstPump.ok || !secondPump.ok || !upper.ok) return;
  const simulation = new WorldProductionSimulation(world);
  simulation.setPowerSatisfaction(firstPump.instance.id, 1);
  simulation.setPowerSatisfaction(secondPump.instance.id, 0);
  assert.equal(simulation.deposit(lower.instance.id, "pipe_out", "output", "crude_oil", 3), true);
  simulation.advance(10);
  assert.equal(simulation.inventory(upper.instance.id, "pipe_in", "output").amount, 0);
  simulation.setPowerSatisfaction(secondPump.instance.id, 1);
  simulation.advance(10);
  assert.equal(simulation.inventory(upper.instance.id, "pipe_in", "output").amount, 3);
});

test("hazard extraction requires a nearby stabilizer and cave placement samples its own stratum", () => {
  const stabilizerDefinition = START_REGISTRY.buildings.get("hazard_stabilizer")!;
  assert.equal(stabilizerDefinition.activeMW, 8);
  assert.equal(stabilizerDefinition.idleMW, 8);
  const sampler = new TerrainSampler(A17_ENVIRONMENT);
  let stabilizerPowered = false;
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
  world.setHazardServiceResolver(() => stabilizerPowered);
  world.unlock("phase_3_complete");
  world.unlock("thermal_verified");
  const oil = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "crude_oil")!;
  const oilElevation = sampler.constructionHeightAt(oil.position.x, oil.position.z);
  assert.equal(world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0, elevation: oilElevation }).reason, "terrain_hazard");
  assert.equal(world.place({ buildingId: "hazard_stabilizer", position: { x: oil.position.x + 4, z: oil.position.z }, rotation: 0, elevation: oilElevation }).ok, true);
  assert.equal(world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0, elevation: oilElevation }).reason, "terrain_hazard");
  stabilizerPowered = true;
  const extractor = world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0, elevation: oilElevation });
  assert.equal(extractor.ok, true);
  if (extractor.ok) {
    const production = new WorldProductionSimulation(world);
    stabilizerPowered = false;
    production.advance(0.25);
    assert.equal(production.machine(extractor.instance.id)?.runtimeState, "paused");
    assert.equal(production.machine(extractor.instance.id)?.workInProgress, null);
  }

  const tungsten = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "tungsten_ore")!;
  assert.equal(world.place({ buildingId: "vein_miner", position: tungsten.position, rotation: 0, stratumId: "surface", elevation: 0 }).reason, "invalid_resource_anchor");
  assert.equal(world.place({ buildingId: "vein_miner", position: tungsten.position, rotation: 0, stratumId: tungsten.stratumId, elevation: tungsten.elevation }).ok, true);
});
