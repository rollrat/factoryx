import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import type { BeltItem, StructureData } from "../../app/game/types.ts";

const add = (simulation: FactorySimulation, structures: StructureData[]) => {
  structures.forEach((structure) => simulation.addStructure(structure));
};

const item = (id: number): BeltItem => ({ id, type: "iron_ore", progress: 0.99 });

test("storage can dispatch stored items through its output port", () => {
  const simulation = new FactorySimulation();
  add(simulation, [
    { id: 1, type: "storage", x: 0, z: 0, rotation: 0 },
    { id: 2, type: "belt", x: 2, z: 0, rotation: 1 },
  ]);
  const storage = simulation.machines.get(1)!;
  storage.storedItems.push("iron_plate");
  storage.stored = 1;

  simulation.update(0.05);

  assert.equal(simulation.beltItems.get(2)?.type, "iron_plate");
  assert.equal(storage.stored, 0);
  assert.deepEqual(storage.storedItems, []);
});

test("splitter sends consecutive items to available outputs in round-robin order", () => {
  const simulation = new FactorySimulation();
  add(simulation, [
    { id: 1, type: "splitter", x: 0, z: 0, rotation: 1 },
    { id: 2, type: "belt", x: 1, z: 0, rotation: 1 },
    { id: 3, type: "belt", x: 0, z: -1, rotation: 2 },
    { id: 4, type: "belt", x: 0, z: 1, rotation: 0 },
  ]);

  const destinations: number[] = [];
  for (let id = 10; id < 13; id += 1) {
    simulation.beltItems.set(1, item(id));
    simulation.update(0.05);
    const destination = [2, 3, 4].find((beltId) => simulation.beltItems.get(beltId)?.id === id);
    assert.ok(destination);
    destinations.push(destination);
    simulation.beltItems.delete(destination);
  }

  assert.deepEqual(destinations, [2, 3, 4]);
});

test("merger accepts only one contender and alternates fairly", () => {
  const simulation = new FactorySimulation();
  add(simulation, [
    { id: 1, type: "belt", x: -1, z: 0, rotation: 1 },
    { id: 2, type: "belt", x: 0, z: -1, rotation: 0 },
    { id: 3, type: "merger", x: 0, z: 0, rotation: 1 },
  ]);

  const winners: number[] = [];
  for (let round = 0; round < 2; round += 1) {
    simulation.beltItems.set(1, item(10 + round * 2));
    simulation.beltItems.set(2, item(11 + round * 2));
    simulation.update(0.05);
    const merged = simulation.beltItems.get(3);
    assert.ok(merged);
    winners.push(merged.id);
    assert.equal([simulation.beltItems.has(1), simulation.beltItems.has(2)].filter(Boolean).length, 1);
    simulation.beltItems.clear();
  }

  assert.deepEqual(winners, [10, 13]);
});
