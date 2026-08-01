import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";

test("the three dock lanes accept only their contracted items", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "belt", x: 5, z: 7, rotation: 1 });
  simulation.addStructure({ id: 2, type: "belt", x: 5, z: 8, rotation: 1 });
  simulation.addStructure({ id: 3, type: "belt", x: 5, z: 9, rotation: 1 });
  simulation.beltItems.set(1, { id: 11, type: "iron_plate", progress: 0.99 });
  simulation.beltItems.set(2, { id: 12, type: "construction_block", progress: 0.99 });
  simulation.beltItems.set(3, { id: 13, type: "fastener_pack", progress: 0.99 });

  simulation.update(0.05);

  assert.equal(simulation.beltItems.size, 0);
  assert.deepEqual(simulation.getProjectProgress().deliveries.map(({ delivered }) => delivered), [1, 1, 1]);
});

test("a wrong dock delivery remains on its belt without changing progress", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "belt", x: 5, z: 7, rotation: 1 });
  simulation.beltItems.set(1, { id: 11, type: "construction_block", progress: 0.99 });

  simulation.update(0.05);

  assert.equal(simulation.beltItems.get(1)?.type, "construction_block");
  assert.equal(simulation.beltItems.get(1)?.progress, 0.98);
  assert.equal(simulation.getProjectProgress().deliveredTotal, 0);
});

test("the project dock footprint is reserved from normal construction", () => {
  const simulation = new FactorySimulation();
  assert.equal(simulation.canPlace("belt", 6, 6), false);
  assert.equal(simulation.canPlace("storage", 10, 10), false);
  assert.equal(simulation.canPlace("belt", 5, 7), true);
});
