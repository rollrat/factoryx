import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildingDefinition,
  DefinitionRegistry,
  ItemDefinition,
  PortDefinition,
  RecipeDefinition,
} from "../../app/game/domain/types.ts";
import { inferAdjacentPowerEdges, type PowerEdge } from "../../app/game/sim/physicalPowerNetwork.ts";
import { PhysicalPowerRuntime } from "../../app/game/sim/physicalPowerRuntime.ts";
import { AdvancedPowerGrid, type PowerGridInputSnapshot } from "../../app/game/sim/powerGrid.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

const EPSILON = 1e-9;

const item = (id: string, medium: "solid" | "fluid"): ItemDefinition => ({
  id,
  name: id,
  category: medium === "fluid" ? "fluid" : "material",
  medium,
  unit: medium === "fluid" ? "m3" : "item",
  unlockId: "start",
  defaultColor: "#777777",
  geometryType: medium === "fluid" ? "fluid" : "component",
  stackSize: 2_000,
  modelKey: id,
});

const logisticsPort = (
  id: string,
  direction: PortDefinition["direction"],
  medium: "solid" | "fluid",
  x: number,
  z: number,
  itemId: string,
): PortDefinition => ({
  id,
  direction,
  medium,
  connectorProfile: medium === "solid" ? "belt_standard" : "pipe_mk1",
  connectionCell: { x, z },
  localPosition: { x, y: 0.5, z },
  localFacing: { x: Math.sign(x), z: Math.sign(z) },
  bufferSlots: 1,
  acceptedItemIds: [itemId],
});

const building = (
  id: string,
  ports: readonly PortDefinition[],
  extras: Partial<BuildingDefinition> = {},
): BuildingDefinition => ({
  id,
  name: id,
  unlockId: "start",
  placementMode: "buildable",
  footprint: { x: 1, z: 1 },
  allowedRotations: [0, 1, 2, 3],
  ports,
  recipeIds: [],
  buildCost: [],
  ...extras,
});

const logisticsRegistry = (): DefinitionRegistry => {
  const ore = item("ore", "solid");
  const coolant = item("coolant", "fluid");
  const straight = (medium: "solid" | "fluid", itemId: string) => [
    logisticsPort("in", "input", medium, -1, 0, itemId),
    logisticsPort("out", "output", medium, 1, 0, itemId),
  ];
  const definitions = [
    building("solid_source", [logisticsPort("out", "output", "solid", 1, 0, ore.id)]),
    building("solid_source_z", [logisticsPort("out", "output", "solid", 0, 1, ore.id)]),
    building("solid_segment", straight("solid", ore.id), { transportPolicy: { throughputPerMinute: 120 } }),
    building("solid_storage", straight("solid", ore.id), {
      storagePolicy: {
        slotCount: 2,
        lockToSingleItem: true,
        supportsInputFilter: true,
        supportsOutputFilter: true,
        defaultRoutingPolicy: "pass_through",
      },
    }),
    building("solid_sink", [logisticsPort("in", "input", "solid", -1, 0, ore.id)]),
    building("solid_sink_z", [logisticsPort("in", "input", "solid", 0, -1, ore.id)]),
    building("splitter", [
      logisticsPort("in", "input", "solid", -1, 0, ore.id),
      logisticsPort("out_a", "output", "solid", 1, 0, ore.id),
      logisticsPort("out_b", "output", "solid", 0, 1, ore.id),
    ]),
    building("merger", [
      logisticsPort("in_a", "input", "solid", -1, 0, ore.id),
      logisticsPort("in_b", "input", "solid", 0, -1, ore.id),
      logisticsPort("out", "output", "solid", 1, 0, ore.id),
    ]),
    building("fluid_source", [logisticsPort("out", "output", "fluid", 1, 0, coolant.id)]),
    building("fluid_segment", straight("fluid", coolant.id), { transportPolicy: { throughputPerMinute: 120 } }),
    building("fluid_storage", straight("fluid", coolant.id), {
      storagePolicy: {
        slotCount: 2,
        lockToSingleItem: true,
        supportsInputFilter: true,
        supportsOutputFilter: true,
        defaultRoutingPolicy: "pass_through",
      },
    }),
    building("fluid_sink", [logisticsPort("in", "input", "fluid", -1, 0, coolant.id)]),
  ];
  return {
    items: new Map([[ore.id, ore], [coolant.id, coolant]]),
    recipes: new Map(),
    buildings: new Map(definitions.map((definition) => [definition.id, definition])),
    projectStages: new Map(),
  };
};

const createWorld = (registry: DefinitionRegistry) => new DataDrivenWorld({
  registry,
  bounds: { minX: -20, maxX: 40, minZ: -20, maxZ: 40 },
});

const place = (
  world: DataDrivenWorld,
  buildingId: string,
  x: number,
  z: number,
  rotation: 0 | 1 | 2 | 3 = 0,
) => {
  const result = world.place({ buildingId, position: { x, z }, rotation });
  assert.equal(result.ok, true, `${buildingId} should be placeable at ${x},${z}`);
  if (!result.ok) throw new Error(`placement failed: ${result.reason}`);
  return result.instance.id;
};

const inventoryTotal = (simulation: WorldProductionSimulation) => (
  simulation.allNodeStates().reduce((total, node) => (
    total
    + node.inputs.reduce((sum, port) => sum + port.amount, 0)
    + node.outputs.reduce((sum, port) => sum + port.amount, 0)
    + (node.process?.workInProgress?.inputs.reduce((sum, stack) => sum + stack.amount, 0) ?? 0)
  ), 0)
);

test("19.1: ten fixed-tick minutes conserve solids and fluids through transport and storage", () => {
  const registry = logisticsRegistry();
  const world = createWorld(registry);
  const solidSource = place(world, "solid_source", 0, 0);
  place(world, "solid_segment", 2, 0);
  place(world, "solid_segment", 4, 0);
  place(world, "solid_storage", 6, 0);
  const solidSink = place(world, "solid_sink", 8, 0);
  const fluidSource = place(world, "fluid_source", 0, 6);
  place(world, "fluid_segment", 2, 6);
  place(world, "fluid_segment", 4, 6);
  place(world, "fluid_storage", 6, 6);
  const fluidSink = place(world, "fluid_sink", 8, 6);
  const simulation = new WorldProductionSimulation(world);

  assert.equal(simulation.deposit(solidSource, "out", "output", "ore", 600), true);
  assert.equal(simulation.deposit(fluidSource, "out", "output", "coolant", 600), true);
  assert.equal(inventoryTotal(simulation), 1_200);
  simulation.advance(10 * 60);

  assert.equal(inventoryTotal(simulation), 1_200);
  assert.ok(simulation.inventory(solidSink, "in", "input").amount >= 599, "at most one solid remains in the final hop");
  assert.ok(simulation.inventory(fluidSink, "in", "input").amount >= 599, "at most one fluid unit remains in the final hop");
});

test("19.1: storage backpressure preserves queued material and resumes after space returns", () => {
  const registry = logisticsRegistry();
  const world = createWorld(registry);
  const source = place(world, "solid_source", 0, 0);
  const storage = place(world, "solid_storage", 2, 0);
  const sink = place(world, "solid_sink", 4, 0);
  const simulation = new WorldProductionSimulation(world);

  assert.equal(simulation.deposit(sink, "in", "input", "ore", 2_000), true);
  assert.equal(simulation.deposit(source, "out", "output", "ore", 100), true);
  simulation.advance(30);
  assert.equal(inventoryTotal(simulation), 2_100);
  assert.ok(simulation.inventory(storage, "in", "input").amount > 0, "full sink must propagate backpressure");

  assert.equal(simulation.withdraw(sink, "in", "input", "ore", 100), true);
  simulation.advance(120);
  assert.equal(inventoryTotal(simulation), 2_000);
  assert.equal(simulation.inventory(sink, "in", "input").amount, 2_000);
  assert.equal(simulation.inventory(storage, "in", "input").amount, 0);
  assert.equal(simulation.inventory(storage, "out", "output").amount, 0);
});

test("19.1: splitter differs by at most one and merger never starves a ready input over ten minutes", () => {
  const registry = logisticsRegistry();

  const splitWorld = createWorld(registry);
  const splitSource = place(splitWorld, "solid_source", 0, 0);
  place(splitWorld, "splitter", 2, 0);
  const sinkA = place(splitWorld, "solid_sink", 4, 0);
  const sinkB = place(splitWorld, "solid_sink_z", 2, 2);
  const splitter = new WorldProductionSimulation(splitWorld);
  assert.equal(splitter.deposit(splitSource, "out", "output", "ore", 600), true);
  splitter.advance(10 * 60);
  const splitAmounts = [
    splitter.inventory(sinkA, "in", "input").amount,
    splitter.inventory(sinkB, "in", "input").amount,
  ];
  assert.ok(Math.abs(splitAmounts[0] - splitAmounts[1]) <= 1, `split was ${splitAmounts.join(":")}`);
  assert.equal(inventoryTotal(splitter), 600);

  const mergeWorld = createWorld(registry);
  const sourceA = place(mergeWorld, "solid_source", 0, 0);
  const sourceB = place(mergeWorld, "solid_source_z", 2, -2);
  const mergerId = place(mergeWorld, "merger", 2, 0);
  place(mergeWorld, "solid_sink", 4, 0);
  const merger = new WorldProductionSimulation(mergeWorld);
  assert.equal(merger.deposit(sourceA, "out", "output", "ore", 600), true);
  assert.equal(merger.deposit(sourceB, "out", "output", "ore", 600), true);
  merger.advance(10 * 60);
  const mergerState = merger.nodeState(mergerId)!;
  const remainingByInput = mergerState.inputs.map(({ amount }) => amount);
  assert.ok(remainingByInput.every((amount) => amount < 600), "every continuously ready input must make progress");
  assert.ok(Math.abs(remainingByInput[0] - remainingByInput[1]) <= 1, `merge remainder was ${remainingByInput.join(":")}`);
  assert.equal(inventoryTotal(merger), 1_200);
});

const gridInput = (
  generatorsMW: number,
  requestedMW: number,
  deltaSeconds = 1,
): PowerGridInputSnapshot => ({
  gridId: "regression-grid",
  deltaSeconds,
  generators: generatorsMW > 0 ? [{ id: "generator", nameplateMW: generatorsMW, dispatchPriority: 1 }] : [],
  consumers: requestedMW > 0 ? [{
    id: "load",
    active: true,
    activeMW: requestedMW,
    idleMW: 0,
    requestedMW,
    priority: 2,
  }] : [],
  batteries: [],
});

test("21.19: a 24 MW battery discharge for 60 seconds removes exactly 0.4 MWh", () => {
  const grid = new AdvancedPowerGrid("regression-grid");
  const beforeMWh = 1;
  const result = grid.step({
    ...gridInput(0, 24, 60),
    batteries: [{ id: "battery", capacityMWh: 1, storedMWh: beforeMWh, maxChargeMW: 24, maxDischargeMW: 24 }],
  });
  const afterMWh = result.batteries[0].storedMWh;
  assert.ok(Math.abs((beforeMWh - afterMWh) - 0.4) < EPSILON);
  assert.ok(Math.abs((result.generationMW + result.batteryDischargeMW)
    - (result.servedMW + result.batteryChargeMW + result.curtailedMW)) < EPSILON);
});

test("21.19: the 80 percent boundary does not chatter shedding or recovery", () => {
  const grid = new AdvancedPowerGrid("regression-grid");
  const consumers = [
    { id: "critical", active: true, activeMW: 6, idleMW: 0, requestedMW: 6, priority: 1 as const },
    { id: "optional", active: true, activeMW: 4, idleMW: 0, requestedMW: 4, priority: 4 as const },
  ];
  const step = (availableMW: number) => grid.step({
    gridId: "regression-grid",
    deltaSeconds: 1,
    generators: [{ id: "generator", nameplateMW: availableMW, dispatchPriority: 1 }],
    consumers,
    batteries: [],
  });

  for (let cycle = 0; cycle < 20; cycle += 1) {
    assert.deepEqual(step(7.99).shedConsumerIds, []);
    assert.deepEqual(step(8).shedConsumerIds, []);
  }
  step(7);
  step(7);
  assert.deepEqual(step(7).shedConsumerIds, ["optional"]);

  for (let cycle = 0; cycle < 20; cycle += 1) {
    step(12);
    assert.deepEqual(step(8).shedConsumerIds, ["optional"]);
  }
  for (let second = 0; second < 9; second += 1) assert.deepEqual(step(12).shedConsumerIds, ["optional"]);
  assert.deepEqual(step(12).shedConsumerIds, []);
});

const powerPort = (
  id: string,
  direction: PortDefinition["direction"],
  x: number,
  z: number,
): PortDefinition => ({
  id,
  direction,
  medium: "power",
  connectorProfile: "power_local",
  connectionCell: { x, z },
  localPosition: { x, y: 1, z },
  localFacing: { x: Math.sign(x), z: Math.sign(z) },
  bufferSlots: 0,
  acceptedItemIds: [],
});

const powerRegistry = (): DefinitionRegistry => {
  const definitions = [
    building("power_source", [powerPort("out", "output", 1, 0)], {
      generatorPolicy: { capacityMW: 24, minimumLoadRatio: 0, dispatchPriority: 1 },
    }),
    building("power_load", [powerPort("in", "input", -1, 0)], { activeMW: 24, idleMW: 0 }),
  ];
  return {
    items: new Map(), recipes: new Map(),
    buildings: new Map(definitions.map((definition) => [definition.id, definition])),
    projectStages: new Map(),
  };
};

test("21.19: adjacent power ports infer the same connection in all four rotations", () => {
  const directions = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }] as const;
  directions.forEach((direction, rotation) => {
    const world = createWorld(powerRegistry());
    place(world, "power_source", 10, 10, rotation as 0 | 1 | 2 | 3);
    place(world, "power_load", 10 + direction.x * 2, 10 + direction.z * 2, rotation as 0 | 1 | 2 | 3);
    const edges = inferAdjacentPowerEdges(world);
    assert.equal(edges.length, 1, `rotation ${rotation} should infer one power edge`);
  });
});

const processRegistry = (): DefinitionRegistry => {
  const ore = item("ore", "solid");
  const product = item("product", "solid");
  const recipe: RecipeDefinition = {
    id: "slow_process",
    name: "slow_process",
    buildingId: "processor",
    inputs: [{ itemId: ore.id, amount: 1, portId: "in" }],
    outputs: [{ itemId: product.id, amount: 1, portId: "out", role: "primary" }],
    durationSeconds: 10,
    unlockId: "start",
  };
  const definitions = [
    building("source", [logisticsPort("out", "output", "solid", 1, 0, ore.id)]),
    building("processor", [
      logisticsPort("in", "input", "solid", -1, 0, ore.id),
      logisticsPort("out", "output", "solid", 1, 0, product.id),
    ], { recipeIds: [recipe.id] }),
    building("sink", [logisticsPort("in", "input", "solid", -1, 0, product.id)]),
  ];
  return {
    items: new Map([[ore.id, ore], [product.id, product]]),
    recipes: new Map([[recipe.id, recipe]]),
    buildings: new Map(definitions.map((definition) => [definition.id, definition])),
    projectStages: new Map(),
  };
};

test("19.1/21.19: save, outage, and restart preserve WIP, buffers, and progress", () => {
  const world = createWorld(processRegistry());
  const source = place(world, "source", 0, 0);
  const processor = place(world, "processor", 2, 0);
  const sink = place(world, "sink", 4, 0);
  const simulation = new WorldProductionSimulation(world);
  assert.equal(simulation.deposit(source, "out", "output", "ore", 1), true);
  simulation.advance(2);
  const beforeOutage = simulation.machine(processor)!;
  assert.ok(beforeOutage.workInProgress);

  simulation.setPowerSatisfaction(processor, 0);
  simulation.advance(60);
  const duringOutage = simulation.machine(processor)!;
  assert.deepEqual(duringOutage.workInProgress, beforeOutage.workInProgress);
  assert.equal(duringOutage.progress, beforeOutage.progress);
  assert.equal(inventoryTotal(simulation), 1);

  const restored = new WorldProductionSimulation(world, structuredClone(simulation.snapshot()));
  assert.deepEqual(restored.snapshot(), simulation.snapshot());
  restored.setPowerSatisfaction(processor, 1);
  restored.advance(12);
  assert.equal(restored.inventory(sink, "in", "input").amount, 1);
  assert.equal(inventoryTotal(restored), 1);
});

test("21.19: blackout snapshot and sequential restart preserve battery and generator fuel", () => {
  const coal = item("coal", "solid");
  const definitions = [
    building("generator", [powerPort("out", "output", 1, 0)], {
      generatorPolicy: { capacityMW: 24, fuelItemId: coal.id, fuelRatePerMinute: 60, minimumLoadRatio: 0, dispatchPriority: 1 },
    }),
    building("pole", [
      powerPort("a", "bidirectional", -1, 0),
      powerPort("b", "bidirectional", 1, 0),
    ], { distributionPolicy: { radiusTiles: 4, maxConsumers: 4, maxCableConnections: 2 } }),
    building("load", [powerPort("in", "input", -1, 0)], { activeMW: 48, idleMW: 0 }),
    building("battery", [powerPort("grid", "bidirectional", 1, 0)], {
      powerStoragePolicy: { capacityMWh: 1, maxChargeMW: 24, maxDischargeMW: 24 },
    }),
  ];
  const registry: DefinitionRegistry = {
    items: new Map([[coal.id, coal]]), recipes: new Map(),
    buildings: new Map(definitions.map((definition) => [definition.id, definition])), projectStages: new Map(),
  };
  const world = createWorld(registry);
  const generator = place(world, "generator", 0, 0);
  const pole = place(world, "pole", 2, 0);
  const load = place(world, "load", 3, 0);
  const battery = place(world, "battery", 4, 0);
  const edges: readonly PowerEdge[] = [
    { id: "generator", from: { ownerId: generator, portId: "out" }, to: { ownerId: pole, portId: "a" } },
    { id: "battery", from: { ownerId: battery, portId: "grid" }, to: { ownerId: pole, portId: "b" } },
  ];
  const runtime = new PhysicalPowerRuntime({
    world,
    edges,
    initialGeneratorFuel: { [generator]: 15 },
    initialBatteryMWh: { [battery]: 1 },
  });
  runtime.step(1, { [load]: { active: true, priority: 1 } });
  runtime.step(3, { [load]: { active: true, priority: 1 }, [generator]: { enabled: false } });
  const trippedSnapshot = structuredClone(runtime.snapshot());
  const gridId = runtime.topology().nodes.find(({ instanceId }) => instanceId === load)!.gridId;
  assert.equal(trippedSnapshot.grids.find((grid) => grid.gridId === gridId)?.mainBreakerTripped, true);
  const storedBeforeRestart = trippedSnapshot.batteries.find(({ id }) => id === battery)!.storedMWh;

  const restored = new PhysicalPowerRuntime({ world, snapshot: trippedSnapshot });
  assert.deepEqual(restored.snapshot(), trippedSnapshot);
  assert.equal(restored.supplyGeneratorFuel(generator, coal.id, 1), 1);
  assert.equal(restored.requestSequentialRestart(gridId), true);
  const restarted = restored.step(1, { [load]: { active: true, requestedMW: 24 } });
  const grid = restarted.grids.find((candidate) => candidate.gridId === gridId)!;
  assert.equal(grid.mainBreakerTripped, false);
  assert.equal(grid.servedMW, 24);
  assert.ok(Math.abs(grid.batteries[0].storedMWh - storedBeforeRestart) < EPSILON);
});
