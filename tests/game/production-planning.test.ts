import assert from "node:assert/strict";
import test from "node:test";

import { START_DEFINITIONS } from "../../app/game/data/index.ts";
import { buildDefinitionLineageGraph, highlightLineagePath } from "../../app/game/telemetry/definitionLineage.ts";
import { calculateProjectProductionPlan } from "../../app/game/telemetry/productionPlanning.ts";

test("project reverse planning reproduces the documented machine-minute balance baselines", () => {
  const expected = new Map([
    ["phase_1_settlement_package", 23],
    ["phase_2_industrial_power_node", 105.33333333333333],
    ["phase_3_automation_core", 390],
    ["phase_4_chemistry_stabilization", 40],
    ["phase_4_thermal_management_verification", 22.9],
    ["phase_4_colony_seed", 165.16666666666666],
  ]);
  expected.forEach((machineMinutes, stageId) => {
    const plan = calculateProjectProductionPlan(START_DEFINITIONS, stageId);
    assert.ok(Math.abs(plan.machineMinutes - machineMinutes) < 1e-9, stageId);
    assert.equal(plan.unresolvedItemIds.length, 0);
    assert.ok(plan.rawRequirements.size > 0);
  });
});

test("active project highlighting marks its complete upstream recipe path only", () => {
  const graph = buildDefinitionLineageGraph(START_DEFINITIONS);
  const highlighted = highlightLineagePath(graph, "phase_3_automation_core");
  assert.equal(highlighted.nodes.find(({ id }) => id === "stage:phase_3_automation_core")?.highlighted, true);
  assert.equal(highlighted.nodes.find(({ id }) => id === "item:automation_core")?.highlighted, true);
  assert.equal(highlighted.nodes.find(({ id }) => id === "item:iron_ore")?.highlighted, true);
  assert.equal(highlighted.nodes.find(({ id }) => id === "stage:phase_1_settlement_package")?.highlighted, false);
  assert.ok(highlighted.edges.some(({ id, highlighted: active }) => id.startsWith("delivery:phase_3") && active));
});
