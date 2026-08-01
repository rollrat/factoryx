import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_RESOURCE_ANCHORS,
  resolveRuntimeRecipe,
} from "../../app/game/recipes/runtimeRecipes.ts";
import { FactorySimulation } from "../../app/game/simulation.ts";

const updateFor = (simulation: FactorySimulation, seconds: number) => {
  for (let tick = 0; tick < seconds * 20; tick += 1) simulation.update(1 / 20);
};

test("limestone anchor resolves the registry mining recipe", () => {
  const recipe = resolveRuntimeRecipe({ type: "miner", ...RUNTIME_RESOURCE_ANCHORS.limestone });
  assert.equal(recipe?.id, "mine_limestone");
  assert.equal(recipe?.name, "석회암 채굴");
  assert.deepEqual(recipe?.outputs, [{ itemId: "limestone", amount: 2 }]);
  assert.equal(recipe?.durationSeconds, 4);
});

test("crusher resolves only limestone into construction blocks", () => {
  const recipe = resolveRuntimeRecipe({ type: "crusher", inputItemId: "limestone" });
  assert.equal(recipe?.id, "crush_construction_block");
  assert.deepEqual(recipe?.inputs, [{ itemId: "limestone", amount: 4 }]);
  assert.deepEqual(recipe?.outputs, [{ itemId: "construction_block", amount: 2 }]);
  assert.equal(recipe?.durationSeconds, 4);
  assert.equal(resolveRuntimeRecipe({ type: "crusher", inputItemId: "iron_ore" }), null);
});

test("limestone miner and crusher execute their data-defined quantities", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "miner", ...RUNTIME_RESOURCE_ANCHORS.limestone, rotation: 0 });
  simulation.addStructure({ id: 2, type: "crusher", x: 0, z: 0, rotation: 0 });
  simulation.machines.get(2)!.input.push("limestone", "limestone", "limestone", "limestone");

  updateFor(simulation, 4.1);

  assert.deepEqual(simulation.machines.get(1)?.output, ["limestone", "limestone"]);
  assert.deepEqual(simulation.machines.get(2)?.output, ["construction_block", "construction_block"]);
  assert.equal(simulation.machines.get(2)?.recipeId, "crush_construction_block");
});

test("crusher belt intake accepts limestone and preserves a wrong item upstream", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "belt", x: -1, z: 0, rotation: 1 });
  simulation.addStructure({ id: 2, type: "crusher", x: 0, z: 0, rotation: 0 });

  simulation.beltItems.set(1, { id: 1, type: "limestone", progress: 0.99 });
  simulation.update(1 / 20);
  assert.deepEqual(simulation.machines.get(2)?.input, ["limestone"]);
  assert.equal(simulation.beltItems.has(1), false);

  simulation.beltItems.set(1, { id: 2, type: "iron_ore", progress: 0.99 });
  simulation.update(1 / 20);
  assert.deepEqual(simulation.machines.get(2)?.input, ["limestone"]);
  assert.equal(simulation.beltItems.get(1)?.type, "iron_ore");
  assert.equal(simulation.beltItems.get(1)?.progress, 0.98);
});

