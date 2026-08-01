import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";
import type { ItemType, StructureData } from "../../app/game/types.ts";

const updateFor = (simulation: FactorySimulation, fps: number, seconds: number) => {
  for (let frame = 0; frame < fps * seconds; frame += 1) simulation.update(1 / fps);
};

const lineSeed: Array<Omit<StructureData, "id">> = [
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
  { type: "miner", x: 7, z: 4, rotation: 0 },
];

test("ore anchors and recipe machines preserve concrete item identity", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "miner", x: -8, z: -3, rotation: 0 });
  simulation.addStructure({ id: 2, type: "miner", x: 7, z: 4, rotation: 0 });
  simulation.addStructure({ id: 3, type: "smelter", x: 0, z: 0, rotation: 0 });
  simulation.addStructure({ id: 4, type: "smelter", x: 4, z: 0, rotation: 0 });
  simulation.addStructure({ id: 5, type: "assembler", x: 8, z: 0, rotation: 0 });

  simulation.machines.get(3)!.input.push("iron_ore", "iron_ore");
  simulation.machines.get(4)!.input.push("copper_ore", "copper_ore");
  simulation.machines.get(5)!.input.push("iron_ingot");
  updateFor(simulation, 30, 5);

  assert.ok(simulation.machines.get(1)!.output.every((item) => item === "iron_ore"));
  assert.ok(simulation.machines.get(1)!.output.length > 0);
  assert.ok(simulation.machines.get(2)!.output.every((item) => item === "copper_ore"));
  assert.ok(simulation.machines.get(2)!.output.length > 0);
  assert.ok(simulation.machines.get(3)!.output.every((item) => item === "iron_ingot"));
  assert.ok(simulation.machines.get(3)!.output.length > 0);
  assert.ok(simulation.machines.get(4)!.output.every((item) => item === "copper_ingot"));
  assert.ok(simulation.machines.get(4)!.output.length > 0);
  assert.ok(simulation.machines.get(5)!.output.every((item) => item === "iron_plate"));
  assert.ok(simulation.machines.get(5)!.output.length > 0);
});

test("storage accepts concrete start solids without collapsing their identity", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "belt", x: -1, z: 0, rotation: 1 });
  simulation.addStructure({ id: 2, type: "storage", x: 0, z: 0, rotation: 0 });
  const items: ItemType[] = ["iron_ore", "copper_ore", "iron_ingot", "copper_ingot", "iron_plate"];

  items.forEach((type, index) => {
    simulation.beltItems.set(1, { id: index + 1, type, progress: 0.99 });
    simulation.update(1 / 20);
  });

  assert.deepEqual(simulation.machines.get(2)!.storedItems, items);
  assert.equal(simulation.getStoredComponents(), 1, "compatibility total counts stored iron plates");
});

const deterministicResult = (fps: number) => {
  const simulation = new FactorySimulation();
  lineSeed.forEach((structure, index) => simulation.addStructure({ ...structure, id: index + 1 }));
  updateFor(simulation, fps, 60);
  return {
    machines: [...simulation.machines].map(([id, state]) => ({
      id,
      input: [...state.input],
      output: [...state.output],
      storedItems: [...state.storedItems],
      recipeId: state.recipeId,
      progress: state.progress,
      working: state.working,
    })),
    belts: [...simulation.beltItems].map(([id, item]) => ({ id, type: item.type, progress: item.progress })),
  };
};

test("concrete production is deterministic at 30 and 144 render FPS", () => {
  const at30 = deterministicResult(30);
  const at144 = deterministicResult(144);

  assert.deepEqual(at144, at30);
  assert.ok(at30.machines.find(({ id }) => id === 11)?.storedItems.every((item) => item === "iron_plate"));
  assert.ok((at30.machines.find(({ id }) => id === 11)?.storedItems.length ?? 0) > 0);
  assert.ok(at30.machines.find(({ id }) => id === 12)?.output.every((item) => item === "copper_ore"));
});
