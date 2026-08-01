import assert from "node:assert/strict";
import test from "node:test";

import { START_DEFINITIONS } from "../../app/game/data/index.ts";
import { FactorySimulation } from "../../app/game/simulation.ts";
import { buildLineageGraph, buildingNodeId, itemNodeId } from "../../app/game/telemetry/lineage.ts";
import { buildLiveTelemetry } from "../../app/game/telemetry/live.ts";
import { buildLineageView } from "../../app/game/telemetry/presentation.ts";

test("lineage presentation joins definition relationships with live factory stock", () => {
  const simulation = new FactorySimulation();
  simulation.addStructure({ id: 1, type: "miner", x: -8, z: -3, rotation: 0 });
  simulation.addStructure({ id: 2, type: "belt", x: -6, z: -3, rotation: 1 });
  for (let tick = 0; tick < 120; tick += 1) simulation.update(1 / 20);

  const graph = buildLineageGraph(START_DEFINITIONS);
  const telemetry = buildLiveTelemetry(simulation);
  const view = buildLineageView(graph, START_DEFINITIONS, telemetry);
  const oreState = view.live.nodeStates[itemNodeId("iron_ore")];

  assert.ok(view.graph.nodes.some((node) => node.id === buildingNodeId("vein_miner")));
  assert.ok(view.graph.edges.some((edge) => edge.from === buildingNodeId("vein_miner") && edge.to === itemNodeId("iron_ore")));
  assert.ok((telemetry.itemStocks.iron_ore ?? 0) > 0);
  assert.equal(oreState?.status, "storing");
  assert.ok((oreState?.stock ?? 0) > 0);
});
