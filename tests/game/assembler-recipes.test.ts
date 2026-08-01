import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulation } from "../../app/game/simulation.ts";

test("an idle empty assembler cycles through plate, rod, and fastener recipes", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "assembler", x: 0, z: 0, rotation: 0 });

  assert.equal(simulation.machines.get(1)?.recipeId, "form_iron_plate");
  assert.equal(simulation.cycleAssemblerRecipe(1)?.id, "form_iron_rod");
  assert.equal(simulation.cycleAssemblerRecipe(1)?.id, "form_fastener_pack");
  assert.equal(simulation.cycleAssemblerRecipe(1)?.id, "form_iron_plate");
});

test("rod and fastener recipes preserve their concrete input and output items", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "assembler", x: 0, z: 0, rotation: 0 });
  simulation.cycleAssemblerRecipe(1);
  const state = simulation.machines.get(1)!;
  state.input.push("iron_ingot");
  for (let tick = 0; tick < 90; tick += 1) simulation.update(0.05);
  assert.deepEqual(state.output, ["iron_rod", "iron_rod"]);

  state.output.length = 0;
  assert.equal(simulation.cycleAssemblerRecipe(1)?.id, "form_fastener_pack");
  state.input.push("iron_rod");
  for (let tick = 0; tick < 70; tick += 1) simulation.update(0.05);
  assert.deepEqual(state.output, ["fastener_pack", "fastener_pack"]);
});

test("recipe cannot change while an assembler has material or work in progress", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "assembler", x: 0, z: 0, rotation: 0 });
  simulation.machines.get(1)!.input.push("iron_ingot");
  assert.equal(simulation.cycleAssemblerRecipe(1), null);
});
