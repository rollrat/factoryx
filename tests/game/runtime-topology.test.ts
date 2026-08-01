import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import { buildRuntimeTopology } from "../../app/game/telemetry/topology.ts";
import type { StructureData } from "../../app/game/types.ts";

const seed: Array<Omit<StructureData, "id">> = [
  { type: "miner", x: -8, z: -3, rotation: 0 },
  { type: "belt", x: -6, z: -3, rotation: 1 },
  { type: "belt", x: -5, z: -3, rotation: 1 },
  { type: "belt", x: -4, z: -3, rotation: 1 },
  { type: "belt", x: -3, z: -3, rotation: 1 },
  { type: "smelter", x: -2, z: -3, rotation: 0 },
  { type: "belt", x: 0, z: -3, rotation: 1 },
  { type: "belt", x: 1, z: -3, rotation: 1 },
  { type: "assembler", x: 2, z: -3, rotation: 0 },
  { type: "belt", x: 4, z: -3, rotation: 1 },
  { type: "storage", x: 5, z: -3, rotation: 0 },
];

const createSeededSimulation = () => {
  const simulation = new FactorySimulation();
  seed.forEach((structure, index) => simulation.addStructure({ ...structure, id: index + 1 }));
  return simulation;
};

const machineNodes = (snapshot: ReturnType<typeof buildRuntimeTopology>) =>
  snapshot.graph.nodes.filter((node) => node.kind === "machine" && node.structureId !== null);

const nodeForStructure = (snapshot: ReturnType<typeof buildRuntimeTopology>, structureId: number) => {
  const node = snapshot.graph.nodes.find((candidate) => candidate.structureId === structureId);
  assert.ok(node, `missing topology node for structure ${structureId}`);
  return node;
};

const edgeBetween = (
  snapshot: ReturnType<typeof buildRuntimeTopology>,
  sourceStructureId: number,
  targetStructureId: number,
) => {
  const source = nodeForStructure(snapshot, sourceStructureId);
  const target = nodeForStructure(snapshot, targetStructureId);
  const edge = snapshot.graph.edges.find(({ source: from, target: to }) => from === source.id && to === target.id);
  assert.ok(edge, `missing topology edge ${sourceStructureId} -> ${targetStructureId}`);
  return edge;
};

test("seeded runtime topology contains only installed machines and their iron lineage", () => {
  const snapshot = buildRuntimeTopology(createSeededSimulation());
  const installed = machineNodes(snapshot);

  assert.equal(installed.length, 4);
  assert.deepEqual(installed.map(({ structureId }) => structureId).sort((a, b) => a! - b!), [1, 6, 9, 11]);
  assert.equal(installed.filter(({ structureId }) => structureId === 1).length, 1, "miner must not be duplicated");

  const installedItems = new Set(
    snapshot.graph.nodes
      .filter(({ kind }) => kind === "item")
      .map(({ id }) => id.replace(/^item:/, "")),
  );
  assert.deepEqual(installedItems, new Set(["iron_ore", "iron_ingot", "iron_plate"]));
  assert.equal(installedItems.has("copper_ore"), false);
  assert.equal(installedItems.has("limestone"), false);
  assert.equal(snapshot.graph.nodes.some(({ buildingId }) => buildingId === "crusher"), false);

  assert.equal(edgeBetween(snapshot, 1, 6).connected, true);
  assert.equal(edgeBetween(snapshot, 6, 9).connected, true);
  assert.equal(edgeBetween(snapshot, 9, 11).connected, true);
});

test("removed and reversed belts make the corresponding runtime edge disconnected", () => {
  const removed = createSeededSimulation();
  removed.removeStructure(3);
  const afterRemoval = buildRuntimeTopology(removed);
  assert.equal(edgeBetween(afterRemoval, 1, 6).connected, false);
  assert.equal(edgeBetween(afterRemoval, 6, 9).connected, true);

  const reversed = createSeededSimulation();
  reversed.removeStructure(7);
  reversed.addStructure({ id: 7, type: "belt", x: 0, z: -3, rotation: 3 });
  const afterReverse = buildRuntimeTopology(reversed);
  assert.equal(edgeBetween(afterReverse, 1, 6).connected, true);
  assert.equal(edgeBetween(afterReverse, 6, 9).connected, false);
});

test("machine removal deletes its node and reinstalling creates the new structure node", () => {
  const simulation = createSeededSimulation();
  simulation.removeStructure(9);
  const afterRemoval = buildRuntimeTopology(simulation);
  assert.equal(machineNodes(afterRemoval).length, 3);
  assert.equal(afterRemoval.graph.nodes.some(({ structureId }) => structureId === 9), false);

  simulation.addStructure({ id: 12, type: "assembler", x: 2, z: -3, rotation: 0 });
  const afterReinstall = buildRuntimeTopology(simulation);
  assert.equal(machineNodes(afterReinstall).length, 4);
  assert.equal(afterReinstall.graph.nodes.some(({ structureId }) => structureId === 12), true);
  assert.equal(edgeBetween(afterReinstall, 6, 12).connected, true);
  assert.equal(edgeBetween(afterReinstall, 12, 11).connected, true);
});
