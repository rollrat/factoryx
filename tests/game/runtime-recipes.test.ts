import assert from "node:assert/strict";
import test from "node:test";

import {
  getRuntimeRecipe,
  resolveRuntimeRecipe,
} from "../../app/game/recipes/runtimeRecipes.ts";

test("selects iron and copper mining recipes from the live ore anchors", () => {
  const iron = resolveRuntimeRecipe({ type: "miner", x: -8, z: -3 });
  const copper = resolveRuntimeRecipe({ type: "miner", x: 7, z: 4 });

  assert.equal(iron?.id, "mine_iron_ore");
  assert.equal(iron?.name, "철광석 채굴");
  assert.deepEqual(iron?.inputs, []);
  assert.deepEqual(iron?.outputs, [{ itemId: "iron_ore", amount: 2 }]);
  assert.equal(iron?.durationSeconds, 4);
  assert.equal(copper?.id, "mine_copper_ore");
  assert.deepEqual(copper?.outputs, [{ itemId: "copper_ore", amount: 2 }]);
});

test("rejects a miner outside the two supported runtime anchors", () => {
  assert.equal(resolveRuntimeRecipe({ type: "miner", x: 0, z: 0 }), null);
  assert.equal(resolveRuntimeRecipe({ type: "miner", x: -8, z: 4 }), null);
});

test("selects the smelting recipe from the actual input item", () => {
  const iron = resolveRuntimeRecipe({ type: "smelter", inputItemId: "iron_ore" });
  const copper = resolveRuntimeRecipe({ type: "smelter", inputItemId: "copper_ore" });

  assert.equal(iron?.id, "smelt_iron_ingot");
  assert.deepEqual(iron?.inputs, [{ itemId: "iron_ore", amount: 2 }]);
  assert.deepEqual(iron?.outputs, [{ itemId: "iron_ingot", amount: 1 }]);
  assert.equal(iron?.durationSeconds, 4);
  assert.equal(copper?.id, "smelt_copper_ingot");
  assert.deepEqual(copper?.outputs, [{ itemId: "copper_ingot", amount: 1 }]);
});

test("rejects non-ore and unsupported smelter inputs", () => {
  assert.equal(resolveRuntimeRecipe({ type: "smelter", inputItemId: "iron_ingot" }), null);
  assert.equal(resolveRuntimeRecipe({ type: "smelter", inputItemId: "copper_ingot" }), null);
  assert.equal(resolveRuntimeRecipe({ type: "smelter", inputItemId: "iron_plate" }), null);
});

test("maps the visual assembler to the hydraulic iron plate recipe", () => {
  const empty = resolveRuntimeRecipe({ type: "assembler" });
  const loaded = resolveRuntimeRecipe({ type: "assembler", inputItemId: "iron_ingot" });

  assert.equal(empty?.id, "form_iron_plate");
  assert.equal(loaded?.buildingId, "hydraulic_former");
  assert.equal(loaded?.name, "철판 성형");
  assert.deepEqual(loaded?.inputs, [{ itemId: "iron_ingot", amount: 1 }]);
  assert.deepEqual(loaded?.outputs, [{ itemId: "iron_plate", amount: 2 }]);
  assert.equal(loaded?.durationSeconds, 4);
  assert.equal(resolveRuntimeRecipe({ type: "assembler", inputItemId: "copper_ingot" }), null);
});

test("direct lookup exposes only the visual runtime recipe subset", () => {
  assert.equal(getRuntimeRecipe("form_iron_plate")?.outputs[0]?.amount, 2);
  assert.equal(getRuntimeRecipe("form_iron_rod"), null);
  assert.equal(getRuntimeRecipe("missing_recipe"), null);
});

