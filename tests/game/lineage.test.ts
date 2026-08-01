import assert from "node:assert/strict";
import test from "node:test";

import { START_DEFINITIONS } from "../../app/game/data/index.ts";
import type { DefinitionSource } from "../../app/game/domain/validate.ts";
import {
  buildingNodeId,
  buildLineageGraph,
  itemNodeId,
} from "../../app/game/telemetry/lineage.ts";

const edge = (recipeId: string, kind: "input" | "output") => (
  buildLineageGraph(START_DEFINITIONS).edges.find((candidate) => (
    candidate.recipeId === recipeId && candidate.kind === kind
  ))
);

test("deduplicates item and building nodes shared by many recipes", () => {
  const graph = buildLineageGraph(START_DEFINITIONS);
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.equal(graph.nodes.filter((node) => node.id === buildingNodeId("vein_miner")).length, 1);
  assert.equal(graph.nodes.filter((node) => node.id === buildingNodeId("hydraulic_former")).length, 1);
  assert.equal(graph.nodeById.get(itemNodeId("iron_ore"))?.label, "철광석");
  assert.equal(graph.nodeById.get(buildingNodeId("arc_smelter"))?.category, "building");
});

test("integrates the iron extraction, smelting, and forming lineage", () => {
  assert.deepEqual(edge("mine_iron_ore", "output"), {
    id: "recipe:mine_iron_ore:0:output:0",
    source: buildingNodeId("vein_miner"),
    target: itemNodeId("iron_ore"),
    kind: "output",
    amount: 2,
    recipeId: "mine_iron_ore",
  });
  assert.equal(edge("smelt_iron_ingot", "input")?.source, itemNodeId("iron_ore"));
  assert.equal(edge("smelt_iron_ingot", "output")?.target, itemNodeId("iron_ingot"));
  assert.equal(edge("form_iron_plate", "input")?.target, buildingNodeId("hydraulic_former"));
  assert.equal(edge("form_iron_plate", "output")?.amount, 2);
});

test("integrates the copper and limestone branches with recipe amounts", () => {
  assert.equal(edge("mine_copper_ore", "output")?.target, itemNodeId("copper_ore"));
  assert.equal(edge("smelt_copper_ingot", "input")?.amount, 2);
  assert.equal(edge("smelt_copper_ingot", "output")?.target, itemNodeId("copper_ingot"));

  assert.equal(edge("mine_limestone", "output")?.target, itemNodeId("limestone"));
  assert.equal(edge("crush_construction_block", "input")?.amount, 4);
  assert.equal(edge("crush_construction_block", "output")?.target, itemNodeId("construction_block"));
});

test("assigns finite columns to isolated and cyclic nodes", () => {
  const cyclic: DefinitionSource = {
    items: [
      { id: "a", name: "A", category: "material", medium: "solid", unlockId: "start", stackSize: 1, modelKey: "a" },
      { id: "b", name: "B", category: "material", medium: "solid", unlockId: "start", stackSize: 1, modelKey: "b" },
      { id: "isolated", name: "Isolated", category: "material", medium: "solid", unlockId: "phase_1_complete", stackSize: 1, modelKey: "isolated" },
    ],
    buildings: [
      {
        id: "loop_a",
        name: "Loop A",
        unlockId: "start",
        placementMode: "buildable",
        footprint: { x: 1, z: 1 },
        allowedRotations: [0],
        ports: [],
        recipeIds: ["a_to_b"],
        buildCost: [{ itemId: "a", amount: 1 }],
      },
      {
        id: "loop_b",
        name: "Loop B",
        unlockId: "start",
        placementMode: "buildable",
        footprint: { x: 1, z: 1 },
        allowedRotations: [0],
        ports: [],
        recipeIds: ["b_to_a"],
        buildCost: [{ itemId: "b", amount: 1 }],
      },
    ],
    recipes: [
      {
        id: "a_to_b",
        name: "A to B",
        buildingId: "loop_a",
        inputs: [{ itemId: "a", amount: 1, portId: "in" }],
        outputs: [{ itemId: "b", amount: 1, portId: "out", role: "primary" }],
        durationSeconds: 1,
        unlockId: "start",
      },
      {
        id: "b_to_a",
        name: "B to A",
        buildingId: "loop_b",
        inputs: [{ itemId: "b", amount: 1, portId: "in" }],
        outputs: [{ itemId: "a", amount: 1, portId: "out", role: "primary" }],
        durationSeconds: 1,
        unlockId: "start",
      },
    ],
    projectStages: [],
  };

  const graph = buildLineageGraph(cyclic);
  assert.equal(graph.nodes.length, 5);
  assert.ok(graph.nodes.every((node) => Number.isInteger(node.column) && node.column >= 0));
  assert.equal(graph.nodeById.get(itemNodeId("isolated"))?.column, 0);
  assert.equal(graph.nodeById.get(itemNodeId("isolated"))?.tier, 1);
});

