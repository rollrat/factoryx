import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildingDefinition,
  DefinitionRegistry,
  ItemDefinition,
  PortDefinition,
  RecipeDefinition,
} from "../../app/game/domain/types.ts";
import { CampaignWorldRuntime } from "../../app/game/sim/campaignWorld.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";
import { buildWorldRuntimeTopology } from "../../app/game/telemetry/worldTopology.ts";

const ore: ItemDefinition = {
  id: "ore", name: "시험 광석", category: "resource", medium: "solid", unit: "item",
  unlockId: "start", defaultColor: "#888888", geometryType: "ore_chunk", stackSize: 20, modelKey: "ore",
};

const port = (
  id: string,
  direction: PortDefinition["direction"],
  medium: PortDefinition["medium"],
  x: number,
  facingX: number,
): PortDefinition => ({
  id,
  direction,
  medium,
  connectorProfile: medium === "power" ? "power_local" : "belt_standard",
  connectionCell: { x, z: 0 },
  localPosition: { x, y: 0.5, z: 0 },
  localFacing: { x: facingX, z: 0 },
  bufferSlots: 1,
  acceptedItemIds: medium === "solid" ? ["ore"] : [],
});

const building = (
  id: string,
  ports: readonly PortDefinition[],
  recipeIds: readonly string[] = [],
  extras: Partial<BuildingDefinition> = {},
): BuildingDefinition => ({
  id, name: id, unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 },
  allowedRotations: [0], ports, recipeIds, buildCost: [], ...extras,
});

const buildings: readonly BuildingDefinition[] = [
  building("real_miner", [port("out", "output", "solid", 1, 1)], ["mine"]),
  building("real_sink", [port("in", "input", "solid", -1, -1)]),
  building("real_generator", [port("power_out", "output", "power", 1, 1)], [], {
    generatorPolicy: { capacityMW: 12, minimumLoadRatio: 0, dispatchPriority: 1 },
  }),
  building("real_consumer", [port("power_in", "input", "power", -1, -1)], [], { activeMW: 8, idleMW: 1 }),
  building("isolated_sink", [port("in", "input", "solid", -1, -1)]),
];

const mine: RecipeDefinition = {
  id: "mine", name: "시험 채굴", buildingId: "real_miner", inputs: [],
  outputs: [{ itemId: "ore", amount: 1, portId: "out", role: "primary" }],
  durationSeconds: 0.1, unlockId: "start",
};

const registry: DefinitionRegistry = {
  items: new Map([[ore.id, ore]]),
  recipes: new Map([[mine.id, mine]]),
  buildings: new Map(buildings.map((definition) => [definition.id, definition])),
  projectStages: new Map(),
};

const setup = () => {
  const campaign = new CampaignWorldRuntime({
    registry,
    bounds: { minX: 0, maxX: 12, minZ: 0, maxZ: 4 },
  });
  const place = (buildingId: string, x: number, z: number) => {
    const result = campaign.world.place({ buildingId, position: { x, z }, rotation: 0 });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("placement failed");
    return result.instance.id;
  };
  const ids = {
    miner: place("real_miner", 0, 0),
    sink: place("real_sink", 2, 0),
    generator: place("real_generator", 0, 2),
    consumer: place("real_consumer", 2, 2),
    isolated: place("isolated_sink", 8, 0),
  };
  const production = new WorldProductionSimulation(campaign.world);
  campaign.stepPower(1, {
    [ids.generator]: { enabled: false },
    [ids.consumer]: { active: true },
  });
  production.applyPowerResult(campaign.powerResult()!);
  production.advance(0.25);
  return { campaign, production, ids };
};

test("Atlas topology contains only installed data-driven world instances and actual links", () => {
  const { campaign, production, ids } = setup();
  const topology = buildWorldRuntimeTopology(campaign, production);

  assert.equal(topology.graph.nodes.length, 5);
  assert.deepEqual(
    new Set(topology.graph.nodes.map(({ instanceId }) => instanceId)),
    new Set(Object.values(ids)),
  );
  assert.equal(topology.graph.nodes.some(({ id }) => id.includes("legacy") || id.includes("field_power_core")), false);
  assert.equal(topology.graph.nodes.some(({ buildingId }) => buildingId === "project_dock"), false);
  assert.equal(topology.graph.edges.filter(({ medium }) => medium === "solid").length, 1);
  assert.equal(topology.graph.edges.filter(({ medium }) => medium === "power").length, 1);
  assert.ok(topology.graph.edges.every(({ connected }) => connected));
  assert.equal(topology.graph.edges.some(({ source, target }) => source.includes(ids.isolated) || target.includes(ids.isolated)), false);
});

test("Atlas exposes actual recipe, buffers, progress, and stop reasons", () => {
  const { campaign, production, ids } = setup();
  const topology = buildWorldRuntimeTopology(campaign, production);
  const miner = topology.graph.nodes.find(({ instanceId }) => instanceId === ids.miner);
  const consumer = topology.graph.nodes.find(({ instanceId }) => instanceId === ids.consumer);
  const generator = topology.graph.nodes.find(({ instanceId }) => instanceId === ids.generator);
  const isolated = topology.graph.nodes.find(({ instanceId }) => instanceId === ids.isolated);

  assert.equal(miner?.recipeId, "mine");
  assert.ok((miner?.outputStock ?? 0) >= 0);
  assert.ok((miner?.progress ?? 0) >= 0);
  assert.match(miner?.statusLabel ?? "", /레시피 · 시험 채굴/);
  assert.equal(consumer?.status, "blocked");
  assert.equal(consumer?.stopReason, "전력 공급 중단");
  assert.equal(generator?.status, "idle");
  assert.equal(isolated?.status, "disconnected");
  assert.equal(isolated?.stopReason, "필수 포트 연결 없음");
  assert.equal(topology.live.nodeStates[`world:${ids.consumer}`]?.status, "blocked");
});
