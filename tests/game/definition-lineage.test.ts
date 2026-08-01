import assert from "node:assert/strict";
import test from "node:test";

import { START_DEFINITIONS, START_REGISTRY } from "../../app/game/data/index.ts";
import { buildDefinitionLineageGraph } from "../../app/game/telemetry/definitionLineage.ts";

test("definition lineage derives every item, recipe dependency, and project contract from the registry", () => {
  const graph = buildDefinitionLineageGraph(START_DEFINITIONS);
  assert.equal(graph.nodes.filter(({ id }) => id.startsWith("item:")).length, START_REGISTRY.items.size);
  assert.equal(graph.nodes.filter(({ id }) => id.startsWith("stage:")).length, START_REGISTRY.projectStages.size);
  START_REGISTRY.recipes.forEach((recipe) => recipe.inputs.forEach((input) => recipe.outputs.forEach((output) => {
    assert.ok(graph.edges.some(({ from, to, id }) => (
      id.startsWith(`recipe:${recipe.id}:`)
      && from === `item:${input.itemId}`
      && to === `item:${output.itemId}`
    )));
  })));
  START_REGISTRY.projectStages.forEach((stage) => stage.deliveries.forEach((delivery) => {
    assert.ok(graph.edges.some(({ id, from, to }) => (
      id === `delivery:${stage.id}:${delivery.portId}`
      && from === `item:${delivery.itemId}`
      && to === `stage:${stage.id}`
    )));
  }));
  assert.ok(graph.nodes.find(({ id }) => id === "item:iron_ore")!.column! < graph.nodes.find(({ id }) => id === "item:automation_core")!.column!);
});
