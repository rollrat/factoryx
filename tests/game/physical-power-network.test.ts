import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import type { BuildingDefinition, DefinitionRegistry, PortDefinition } from "../../app/game/domain/types.ts";
import { createPowerCableConnectionModel } from "../../app/game/models/connection.ts";
import { AdvancedPowerGrid } from "../../app/game/sim/powerGrid.ts";
import {
  buildPhysicalPowerTopology,
  createPowerGridInputs,
  createSequentialRestartPlan,
  derivePhysicalPowerStates,
  inferAdjacentPowerEdges,
  type PowerEdge,
} from "../../app/game/sim/physicalPowerNetwork.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";

const powerPort = (
  id: string,
  direction: PortDefinition["direction"],
  profile: "power_local" | "power_high_voltage",
  x: number,
): PortDefinition => ({
  id,
  direction,
  medium: "power",
  connectorProfile: profile,
  connectionCell: { x, z: 0 },
  localPosition: { x: x < 0 ? -0.5 : 0.5, y: profile === "power_high_voltage" ? 2 : 1, z: 0 },
  localFacing: { x: x < 0 ? -1 : 1, z: 0 },
  bufferSlots: 0,
  acceptedItemIds: [],
});

const base = (id: string, ports: readonly PortDefinition[]): BuildingDefinition => ({
  id,
  name: id,
  unlockId: "start",
  placementMode: "buildable",
  footprint: { x: 1, z: 1 },
  allowedRotations: [0, 1, 2, 3],
  ports,
  recipeIds: [],
  buildCost: [],
});

const buildings = [
  { ...base("test_generator", [powerPort("out", "output", "power_high_voltage", 1)]), generatorPolicy: { capacityMW: 2, minimumLoadRatio: 0, dispatchPriority: 1 } },
  {
    ...base("substation", [
      powerPort("high_voltage_in", "input", "power_high_voltage", -1),
      powerPort("local_out", "output", "power_local", 1),
    ]),
    distributionPolicy: { maxCableConnections: 2 },
  },
  {
    ...base("power_breaker", [powerPort("grid_in", "input", "power_local", -1), powerPort("grid_out", "output", "power_local", 1)]),
    distributionPolicy: { maxCableConnections: 2 },
  },
  {
    ...base("priority_switchboard", [
      powerPort("grid_in", "input", "power_local", -1),
      powerPort("priority_1", "output", "power_local", 1),
      powerPort("priority_2", "output", "power_local", 1),
      powerPort("priority_3", "output", "power_local", 1),
      powerPort("priority_4", "output", "power_local", 1),
    ]),
    distributionPolicy: { maxCableConnections: 5 },
  },
  {
    ...base("distribution_pole_mk1", [powerPort("a", "bidirectional", "power_local", -1), powerPort("b", "bidirectional", "power_local", 1)]),
    distributionPolicy: { radiusTiles: 3.5, maxConsumers: 1, maxCableConnections: 2 },
  },
  { ...base("test_consumer", [powerPort("in", "input", "power_local", -1)]), activeMW: 5, idleMW: 0 },
] as const satisfies readonly BuildingDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(),
  recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(),
};

const buildWorld = () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 20 } });
  const place = (buildingId: string, x: number, z: number) => {
    const result = world.place({ buildingId, position: { x, z }, rotation: 0 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error(result.reason);
    return result.instance.id;
  };
  return {
    world,
    generator: place("test_generator", 1, 1),
    substation: place("substation", 4, 1),
    breaker: place("power_breaker", 7, 1),
    switchboard: place("priority_switchboard", 10, 1),
    pole: place("distribution_pole_mk1", 13, 1),
    nearbyConsumer: place("test_consumer", 14, 2),
    overflowConsumer: place("test_consumer", 14, 3),
  };
};

const edgesFor = (ids: ReturnType<typeof buildWorld>): readonly PowerEdge[] => [
  { id: "high", from: { ownerId: ids.generator, portId: "out" }, to: { ownerId: ids.substation, portId: "high_voltage_in" } },
  { id: "local-a", from: { ownerId: ids.substation, portId: "local_out" }, to: { ownerId: ids.breaker, portId: "grid_in" } },
  { id: "local-b", from: { ownerId: ids.breaker, portId: "grid_out" }, to: { ownerId: ids.switchboard, portId: "grid_in" } },
  { id: "priority", from: { ownerId: ids.switchboard, portId: "priority_4" }, to: { ownerId: ids.pole, portId: "a" } },
];

test("physical topology crosses voltage only through a substation and assigns one nearby consumer", () => {
  const ids = buildWorld();
  const topology = buildPhysicalPowerTopology(ids.world, edgesFor(ids));
  const generator = topology.nodes.find(({ instanceId }) => instanceId === ids.generator)!;
  const nearby = topology.nodes.find(({ instanceId }) => instanceId === ids.nearbyConsumer)!;
  const overflow = topology.nodes.find(({ instanceId }) => instanceId === ids.overflowConsumer)!;

  assert.equal(generator.gridId, nearby.gridId);
  assert.equal(nearby.connectionState, "connected");
  assert.equal(nearby.distributionNodeId, ids.pole);
  assert.equal(nearby.priority, 4);
  assert.equal(overflow.connectionState, "disconnected", "pole capacity leaves the second consumer unconnected");
  assert.deepEqual(topology.automaticAssignments, [{ consumerId: ids.nearbyConsumer, distributionNodeId: ids.pole }]);
});

test("open breakers and disabled priority outputs split actual connected components", () => {
  const ids = buildWorld();
  const edges = edgesFor(ids);
  const opened = buildPhysicalPowerTopology(ids.world, edges, { breakers: { [ids.breaker]: "open" } });
  assert.notEqual(
    opened.nodes.find(({ instanceId }) => instanceId === ids.generator)!.gridId,
    opened.nodes.find(({ instanceId }) => instanceId === ids.nearbyConsumer)!.gridId,
  );

  const outputOff = buildPhysicalPowerTopology(ids.world, edges, {
    switchboardOutputs: { [ids.switchboard]: { 4: false } },
  });
  assert.notEqual(
    outputOff.nodes.find(({ instanceId }) => instanceId === ids.generator)!.gridId,
    outputOff.nodes.find(({ instanceId }) => instanceId === ids.nearbyConsumer)!.gridId,
  );
});

test("topology feeds AdvancedPowerGrid priority shedding and exposes restart/UI states", () => {
  const ids = buildWorld();
  const topology = buildPhysicalPowerTopology(ids.world, edgesFor(ids));
  const inputs = createPowerGridInputs(ids.world, topology, 1, {
    [ids.nearbyConsumer]: { active: true },
    [ids.overflowConsumer]: { active: true },
  });
  const input = inputs.find(({ gridId, consumers }) => (
    gridId === topology.nodes.find(({ instanceId }) => instanceId === ids.nearbyConsumer)!.gridId
    && consumers.some(({ id }) => id === ids.nearbyConsumer)
  ))!;
  assert.equal(input.consumers.find(({ id }) => id === ids.nearbyConsumer)!.priority, 4);
  assert.equal(input.generators[0].connected, true);

  const grid = new AdvancedPowerGrid(input.gridId);
  grid.step(input);
  grid.step(input);
  const result = grid.step(input);
  assert.deepEqual(result.shedConsumerIds, [ids.nearbyConsumer]);
  assert.deepEqual(createSequentialRestartPlan(topology, input.gridId), [
    { priority: 4, consumerIds: [ids.nearbyConsumer] },
  ]);
  const state = derivePhysicalPowerStates(topology, [result]).find(({ instanceId }) => instanceId === ids.nearbyConsumer)!;
  assert.equal(state.operationState, "shed");
  assert.equal(state.powered, false);
});

test("actual PowerEdge render data builds a cable model with persistent ids and grid metadata", () => {
  const ids = buildWorld();
  const topology = buildPhysicalPowerTopology(ids.world, edgesFor(ids));
  const materials = {
    dark: new THREE.MeshBasicMaterial(), steel: new THREE.MeshBasicMaterial(), pale: new THREE.MeshBasicMaterial(),
    cyan: new THREE.MeshBasicMaterial(), amber: new THREE.MeshBasicMaterial(), orange: new THREE.MeshBasicMaterial(),
    rubber: new THREE.MeshBasicMaterial(), copper: new THREE.MeshBasicMaterial(),
  };
  const cable = topology.cables.find(({ id }) => id === "high")!;
  const model = createPowerCableConnectionModel(cable, registry, materials);
  assert.equal(model.name, "power-edge:high");
  assert.equal(model.userData.powerEdgeId, "high");
  assert.equal(model.userData.gridId, cable.gridId);
  assert.deepEqual(model.userData.ownerIds, [ids.generator, ids.substation]);
});

test("invalid cross-profile cables are rejected before graph construction", () => {
  const ids = buildWorld();
  assert.throws(() => buildPhysicalPowerTopology(ids.world, [{
    id: "invalid",
    from: { ownerId: ids.generator, portId: "out" },
    to: { ownerId: ids.breaker, portId: "grid_in" },
  }]), /mixes power_high_voltage and power_local/);
});

test("opposing adjacent power ports infer one stable short cable", () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 2 } });
  const generator = world.place({ buildingId: "test_generator", position: { x: 0, z: 0 }, rotation: 0 });
  const substation = world.place({ buildingId: "substation", position: { x: 2, z: 0 }, rotation: 0 });
  assert.equal(generator.ok && substation.ok, true);
  const edges = inferAdjacentPowerEdges(world);
  assert.equal(edges.length, 1);
  assert.match(edges[0].id, /^auto-power:/);
  const topology = buildPhysicalPowerTopology(world, edges);
  assert.equal(topology.nodes.every(({ connectionState }) => connectionState === "connected"), true);
});
