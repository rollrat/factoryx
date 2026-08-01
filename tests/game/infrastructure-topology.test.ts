import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import { buildRuntimeTopology } from "../../app/game/telemetry/topology.ts";

const createFactory = () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 7, type: "miner", x: -8, z: -3, rotation: 0 });
  simulation.addStructure({ id: 2, type: "smelter", x: 0, z: 0, rotation: 0 });
  simulation.addStructure({ id: 9, type: "assembler", x: 4, z: 0, rotation: 0 });
  simulation.addStructure({ id: 4, type: "storage", x: 8, z: 0, rotation: 0 });
  return simulation;
};

test("adds one virtual project dock with its three solid delivery edges", () => {
  const topology = buildRuntimeTopology(createFactory());
  const docks = topology.graph.nodes.filter(({ buildingId }) => buildingId === "project_dock");
  assert.equal(docks.length, 1);

  const deliveries = topology.graph.edges.filter(({ target }) => target === docks[0].id);
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries.map(({ itemId, amount, medium, kind }) => ({ itemId, amount, medium, kind })), [
    { itemId: "iron_plate", amount: 120, medium: "solid", kind: "physical" },
    { itemId: "construction_block", amount: 80, medium: "solid", kind: "physical" },
    { itemId: "fastener_pack", amount: 40, medium: "solid", kind: "physical" },
  ]);
  deliveries.forEach((edge) => {
    assert.ok(topology.graph.nodes.some(({ id }) => id === edge.source));
    assert.equal(edge.beltCount, 0);
  });
});

test("adds one field core and a deterministic power edge to every production facility", () => {
  const topology = buildRuntimeTopology(createFactory());
  const cores = topology.graph.nodes.filter(({ buildingId }) => buildingId === "field_power_core");
  assert.equal(cores.length, 1);
  assert.equal(cores[0].capacity, 24);

  const powerEdges = topology.graph.edges.filter(({ medium }) => medium === "power");
  assert.equal(powerEdges.length, 4);
  assert.ok(powerEdges.every(({ source, kind, beltCount, jammed }) => (
    source === cores[0].id && kind === "power" && beltCount === 0 && !jammed
  )));
  assert.deepEqual(powerEdges.map(({ structureId, amount, connected }) => ({ structureId, amount, connected })), [
    { structureId: 2, amount: 8, connected: true },
    { structureId: 4, amount: 1, connected: true },
    { structureId: 7, amount: 4, connected: true },
    { structureId: 9, amount: 10, connected: true },
  ]);
});

test("existing production edges remain solid physical paths", () => {
  const topology = buildRuntimeTopology(createFactory());
  const productionEdges = topology.graph.edges.filter(({ id }) => id.startsWith("physical:"));
  assert.ok(productionEdges.every(({ medium, kind }) => medium === "solid" && kind === "physical"));
});

test("dock edges and project node reflect the live delivery lanes", () => {
  const simulation = createFactory();
  simulation.addStructure({ id: 20, type: "belt", x: 5, z: 7, rotation: 1 });
  simulation.beltItems.set(20, { id: 200, type: "iron_plate", progress: 0.99 });
  simulation.update(0.05);

  const topology = buildRuntimeTopology(simulation);
  const plateEdge = topology.graph.edges.find(({ id }) => id === "dock:phase1_plate_in");
  const dock = topology.graph.nodes.find(({ buildingId }) => buildingId === "project_dock");
  assert.equal(plateEdge?.connected, true);
  assert.deepEqual(plateEdge?.beltIds, [20]);
  assert.equal(dock?.stock, 1);
  assert.equal(dock?.capacity, 240);
  assert.equal(dock?.progress, 1 / 240);
});
