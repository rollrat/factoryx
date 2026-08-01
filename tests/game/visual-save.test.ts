import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";

const seeded = () => {
  const simulation = new FactorySimulation(40);
  simulation.addStructure({ id: 1, type: "miner", x: -8, z: -3, rotation: 0 });
  simulation.addStructure({ id: 2, type: "belt", x: -6, z: -3, rotation: 1 });
  simulation.addStructure({ id: 3, type: "smelter", x: -4, z: -3, rotation: 0 });
  simulation.addStructure({ id: 4, type: "storage", x: 2, z: 2, rotation: 0 });
  return simulation;
};

test("visual simulation snapshot round-trips structures, buffers, belts, and clock", () => {
  const original = seeded();
  original.update(8.25);
  const saved = structuredClone(original.snapshot());
  const restored = new FactorySimulation(40, saved);

  assert.deepEqual(restored.snapshot(), saved);
  original.update(4.75);
  restored.update(4.75);
  assert.deepEqual(restored.snapshot(), original.snapshot());
});

test("visual simulation restore rejects missing machine state and belt items on machines", () => {
  const saved = seeded().snapshot();
  assert.throws(() => new FactorySimulation(40, { ...saved, machines: saved.machines.slice(1) }), /missing machine state/);
  assert.throws(() => new FactorySimulation(40, {
    ...saved,
    beltItems: [{ structureId: 1, item: { id: 1, type: "iron_ore", progress: 0.5 } }],
  }), /invalid belt item snapshot/);
});
