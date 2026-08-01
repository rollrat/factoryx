import assert from "node:assert/strict";
import test from "node:test";

import type { BuildingDefinition, DefinitionRegistry, PortDefinition } from "../../app/game/domain/types.ts";
import { PhysicalPowerRuntime } from "../../app/game/sim/physicalPowerRuntime.ts";
import type { PowerEdge } from "../../app/game/sim/physicalPowerNetwork.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const power = (id: string, direction: PortDefinition["direction"], x: number): PortDefinition => ({
  id,
  direction,
  medium: "power",
  connectorProfile: "power_local",
  connectionCell: { x, z: 0 },
  localPosition: { x: x < 0 ? -0.5 : 0.5, y: 1, z: 0 },
  localFacing: { x: x < 0 ? -1 : 1, z: 0 },
  bufferSlots: 0,
  acceptedItemIds: [],
});

const base = (id: string, ports: readonly PortDefinition[]): BuildingDefinition => ({
  id, name: id, unlockId: "start", placementMode: "buildable",
  footprint: { x: 1, z: 1 }, allowedRotations: [0], ports, recipeIds: [], buildCost: [],
});

const registryFor = (buildings: readonly BuildingDefinition[]): DefinitionRegistry => ({
  items: new Map(), recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(),
});

const createWorld = (buildings: readonly BuildingDefinition[]) => new DataDrivenWorld({
  registry: registryFor(buildings),
  bounds: { minX: 0, maxX: 80, minZ: 0, maxZ: 20 },
});

const place = (world: DataDrivenWorld, buildingId: string, x: number, z = 1) => {
  const result = world.place({ buildingId, position: { x, z }, rotation: 0 });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  return result.instance.id;
};

const poleDefinition = (): BuildingDefinition => ({
  ...base("distribution_pole_mk1", [power("a", "bidirectional", -1), power("b", "bidirectional", 1)]),
  distributionPolicy: { radiusTiles: 3.5, maxConsumers: 4, maxCableConnections: 4 },
});

const fuelWorld = () => {
  const buildings: BuildingDefinition[] = [
    poleDefinition(),
    { ...base("coal_generator", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 60, fuelItemId: "coal", fuelRatePerMinute: 60, minimumLoadRatio: 0, dispatchPriority: 3 } },
    { ...base("gas_generator", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 120, fuelItemId: "fuel_gas", fuelRatePerMinute: 30, minimumLoadRatio: 0, dispatchPriority: 2 } },
    { ...base("thermal_generator", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 180, fuelItemId: "high_density_power_cell", fuelRatePerMinute: 6, minimumLoadRatio: 0, dispatchPriority: 4 } },
    { ...base("coal_load", [power("in", "input", -1)]), activeMW: 30, idleMW: 0 },
    { ...base("gas_load", [power("in", "input", -1)]), activeMW: 60, idleMW: 0 },
    { ...base("thermal_load", [power("in", "input", -1)]), activeMW: 90, idleMW: 0 },
  ];
  const world = createWorld(buildings);
  const groups = [
    { generator: place(world, "coal_generator", 0), pole: place(world, "distribution_pole_mk1", 2), load: place(world, "coal_load", 3), fuel: "coal", initial: 15 },
    { generator: place(world, "gas_generator", 12), pole: place(world, "distribution_pole_mk1", 14), load: place(world, "gas_load", 15), fuel: "fuel_gas", initial: 7.5 },
    { generator: place(world, "thermal_generator", 24), pole: place(world, "distribution_pole_mk1", 26), load: place(world, "thermal_load", 27), fuel: "high_density_power_cell", initial: 1.5 },
  ];
  const edges: PowerEdge[] = groups.map((group, index) => ({
    id: `grid-${index}`,
    from: { ownerId: group.generator, portId: "out" },
    to: { ownerId: group.pole, portId: "a" },
  }));
  return { world, groups, edges };
};

test("independent components dispatch separately and consume each fuel in proportion to generator load", () => {
  const setup = fuelWorld();
  const runtime = new PhysicalPowerRuntime({
    world: setup.world,
    edges: setup.edges,
    initialGeneratorFuel: Object.fromEntries(setup.groups.map(({ generator, initial }) => [generator, initial])),
  });
  const result = runtime.step(1, Object.fromEntries(setup.groups.map(({ load }) => [load, { active: true }])));

  assert.equal(new Set(result.grids.map(({ gridId }) => gridId)).size, 3);
  assert.deepEqual(result.generators.map(({ fuelItemId, consumed, loadRatio }) => [fuelItemId, consumed, loadRatio]), [
    ["coal", 0.5, 0.5],
    ["fuel_gas", 0.25, 0.5],
    ["high_density_power_cell", 0.05, 0.5],
  ]);
  assert.deepEqual(result.grids.map(({ requestedMW, servedMW }) => [requestedMW, servedMW]).sort((a, b) => a[0] - b[0]), [
    [30, 30], [60, 60], [90, 90],
  ]);
});

test("a fueled generator requires a full 15-second startup buffer then runs for 15 seconds at nameplate load", () => {
  const setup = fuelWorld();
  const coal = setup.groups[0];
  const runtime = new PhysicalPowerRuntime({ world: setup.world, edges: [setup.edges[0]], initialGeneratorFuel: { [coal.generator]: 14 } });
  const first = runtime.step(1, { [coal.load]: { active: true } });
  assert.equal(first.grids.find(({ gridId }) => gridId === first.topology.nodes.find(({ instanceId }) => instanceId === coal.load)!.gridId)!.servedMW, 0);
  assert.equal(runtime.generatorFuelState(coal.generator)?.operationState, "start_pending");
  assert.equal(runtime.supplyGeneratorFuel(coal.generator, "coal", 2), 1, "buffer accepts only its remaining one-unit headroom");

  let last = runtime.step(1, { [coal.load]: { active: true, requestedMW: 60 } });
  for (let second = 1; second < 15; second += 1) last = runtime.step(1, { [coal.load]: { active: true, requestedMW: 60 } });
  assert.equal(last.generators.find(({ generatorId }) => generatorId === coal.generator)?.buffered, 0);
  assert.equal(last.generators.find(({ generatorId }) => generatorId === coal.generator)?.operationState, "fuel_starved");
  assert.equal(runtime.step(1, { [coal.load]: { active: true, requestedMW: 60 } }).grids
    .find(({ gridId }) => gridId === last.topology.nodes.find(({ instanceId }) => instanceId === coal.load)!.gridId)!.servedMW, 0);
});

test("battery charge, discharge, and energy survive in the owning physical component", () => {
  const buildings: BuildingDefinition[] = [
    poleDefinition(),
    { ...base("core", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 10, minimumLoadRatio: 1, dispatchPriority: 1 } },
    { ...base("load", [power("in", "input", -1)]), activeMW: 5, idleMW: 0 },
    { ...base("battery", [power("grid", "bidirectional", 1)]), powerStoragePolicy: { capacityMWh: 1, maxChargeMW: 10, maxDischargeMW: 10 } },
  ];
  const world = createWorld(buildings);
  const core = place(world, "core", 0);
  const pole = place(world, "distribution_pole_mk1", 2);
  const load = place(world, "load", 3);
  const battery = place(world, "battery", 4);
  const runtime = new PhysicalPowerRuntime({
    world,
    edges: [
      { id: "core", from: { ownerId: core, portId: "out" }, to: { ownerId: pole, portId: "a" } },
      { id: "battery", from: { ownerId: battery, portId: "grid" }, to: { ownerId: pole, portId: "b" } },
    ],
  });
  const charged = runtime.step(60, { [load]: { active: true } }).grids.find(({ batteryChargeMW }) => batteryChargeMW > 0)!;
  assert.equal(charged.batteryChargeMW, 5);
  assert.ok(Math.abs(charged.batteries[0].storedMWh - 5 / 60) < 1e-9);
  const discharged = runtime.step(60, { [load]: { active: true }, [core]: { enabled: false } }).grids.find(({ batteryDischargeMW }) => batteryDischargeMW > 0)!;
  assert.equal(discharged.batteryDischargeMW, 5);
  assert.equal(discharged.batteries[0].storedMWh, 0);
});

test("main breaker trip and sequential restart state remain local to the deficient grid", () => {
  const buildings: BuildingDefinition[] = [
    poleDefinition(),
    { ...base("weak_core", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 2, minimumLoadRatio: 0, dispatchPriority: 1 } },
    { ...base("strong_core", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 10, minimumLoadRatio: 0, dispatchPriority: 1 } },
    { ...base("critical_load", [power("in", "input", -1)]), activeMW: 4, idleMW: 0 },
    { ...base("normal_load", [power("in", "input", -1)]), activeMW: 2, idleMW: 0 },
  ];
  const world = createWorld(buildings);
  const weak = place(world, "weak_core", 0); const weakPole = place(world, "distribution_pole_mk1", 2); const critical = place(world, "critical_load", 3);
  const strong = place(world, "strong_core", 12); const strongPole = place(world, "distribution_pole_mk1", 14); const normal = place(world, "normal_load", 15);
  const runtime = new PhysicalPowerRuntime({ world, edges: [
    { id: "weak", from: { ownerId: weak, portId: "out" }, to: { ownerId: weakPole, portId: "a" } },
    { id: "strong", from: { ownerId: strong, portId: "out" }, to: { ownerId: strongPole, portId: "a" } },
  ] });
  const overrides = { [critical]: { active: true, priority: 1 as const }, [normal]: { active: true } };
  runtime.step(1, overrides); runtime.step(1, overrides); const tripped = runtime.step(1, overrides);
  const weakGridId = tripped.topology.nodes.find(({ instanceId }) => instanceId === weak)!.gridId;
  const strongGridId = tripped.topology.nodes.find(({ instanceId }) => instanceId === strong)!.gridId;
  assert.equal(tripped.grids.find(({ gridId }) => gridId === weakGridId)?.mainBreakerTripped, true);
  assert.equal(tripped.grids.find(({ gridId }) => gridId === strongGridId)?.servedMW, 2);
  assert.equal(runtime.requestSequentialRestart(strongGridId), false, "healthy grids do not enter restart mode");
  assert.equal(runtime.requestSequentialRestart(weakGridId), true);
  const restoring = runtime.step(1, overrides);
  assert.equal(restoring.restartStates.find(({ gridId }) => gridId === weakGridId)?.state, "restoring");
  runtime.step(1, overrides);
  const retripped = runtime.step(1, overrides);
  assert.equal(retripped.restartStates.find(({ gridId }) => gridId === weakGridId)?.state, "tripped");
});

test("physical breaker controls split and rejoin components without leaking generation", () => {
  const breakerDefinition: BuildingDefinition = {
    ...base("power_breaker", [power("grid_in", "input", -1), power("grid_out", "output", 1)]),
    distributionPolicy: { maxCableConnections: 2 },
  };
  const buildings: BuildingDefinition[] = [
    poleDefinition(), breakerDefinition,
    { ...base("core", [power("out", "output", 1)]), generatorPolicy: { capacityMW: 10, minimumLoadRatio: 0, dispatchPriority: 1 } },
    { ...base("load", [power("in", "input", -1)]), activeMW: 5, idleMW: 0 },
  ];
  const world = createWorld(buildings);
  const core = place(world, "core", 0); const breaker = place(world, "power_breaker", 2); const pole = place(world, "distribution_pole_mk1", 4); const load = place(world, "load", 5);
  const runtime = new PhysicalPowerRuntime({ world, edges: [
    { id: "in", from: { ownerId: core, portId: "out" }, to: { ownerId: breaker, portId: "grid_in" } },
    { id: "out", from: { ownerId: breaker, portId: "grid_out" }, to: { ownerId: pole, portId: "a" } },
  ] });
  assert.equal(runtime.topology().nodes.find(({ instanceId }) => instanceId === core)?.gridId, runtime.topology().nodes.find(({ instanceId }) => instanceId === load)?.gridId);
  runtime.setBreakerState(breaker, "open");
  assert.notEqual(runtime.topology().nodes.find(({ instanceId }) => instanceId === core)?.gridId, runtime.topology().nodes.find(({ instanceId }) => instanceId === load)?.gridId);
  const isolated = runtime.step(1, { [load]: { active: true } });
  const loadGrid = isolated.topology.nodes.find(({ instanceId }) => instanceId === load)!.gridId;
  assert.equal(isolated.grids.find(({ gridId }) => gridId === loadGrid)?.servedMW, 0);
  runtime.setBreakerState(breaker, "closed");
  assert.equal(runtime.step(1, { [load]: { active: true } }).grids.find(({ servedMW }) => servedMW === 5)?.satisfaction, 1);
});

test("snapshot restores component grids, fuel buffers, batteries, and deterministic continuation", () => {
  const setup = fuelWorld();
  const initialFuel = Object.fromEntries(setup.groups.map(({ generator, initial }) => [generator, initial]));
  const active = Object.fromEntries(setup.groups.map(({ load }) => [load, { active: true }]));
  const original = new PhysicalPowerRuntime({ world: setup.world, edges: setup.edges, initialGeneratorFuel: initialFuel });
  original.step(1, active);
  const restored = new PhysicalPowerRuntime({ world: setup.world, snapshot: structuredClone(original.snapshot()) });
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(restored.step(1, active), original.step(1, active));
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
