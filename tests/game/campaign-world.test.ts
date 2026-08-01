import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildingDefinition,
  DefinitionRegistry,
  ItemDefinition,
  ProjectStageDefinition,
} from "../../app/game/domain/types.ts";
import { CampaignWorldRuntime } from "../../app/game/sim/campaignWorld.ts";

const items = [
  { id: "plate", name: "Plate", category: "material", medium: "solid", unit: "item", unlockId: "start", defaultColor: "#aaa", geometryType: "plate", stackSize: 100, modelKey: "plate" },
  { id: "advanced_part", name: "Advanced Part", category: "part", medium: "solid", unit: "item", unlockId: "phase_1_complete", defaultColor: "#0aa", geometryType: "component", stackSize: 100, modelKey: "advanced" },
] as const satisfies readonly ItemDefinition[];

const preplaced = (
  id: string,
  position: { x: number; z: number },
  extras: Partial<BuildingDefinition>,
): BuildingDefinition => ({
  id,
  name: id,
  unlockId: "start",
  placementMode: "preplaced_unique",
  footprint: { x: 1, z: 1 },
  allowedRotations: [0],
  ports: [],
  recipeIds: [],
  buildCost: [],
  preplacedPolicy: { worldAnchor: position, fixedRotation: 0, canBuild: false, canClone: false, canDemolish: false },
  ...extras,
});

const buildings = [
  preplaced("field_power_core", { x: 0, z: 0 }, {
    generatorPolicy: { capacityMW: 24, minimumLoadRatio: 0, dispatchPriority: 1 },
  }),
  preplaced("project_dock", { x: 2, z: 0 }, { activeMW: 32, idleMW: 2 }),
  {
    id: "boost_generator",
    name: "Boost Generator",
    unlockId: "phase_1_complete",
    placementMode: "buildable",
    footprint: { x: 1, z: 1 },
    allowedRotations: [0],
    ports: [],
    recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 1 }],
    generatorPolicy: { capacityMW: 20, minimumLoadRatio: 1, dispatchPriority: 2 },
  },
  {
    id: "accumulator",
    name: "Accumulator",
    unlockId: "phase_1_complete",
    placementMode: "buildable",
    footprint: { x: 1, z: 1 },
    allowedRotations: [0],
    ports: [],
    recipeIds: [],
    buildCost: [{ itemId: "plate", amount: 1 }],
    powerStoragePolicy: { capacityMWh: 4, maxChargeMW: 24, maxDischargeMW: 48 },
  },
] as const satisfies readonly BuildingDefinition[];

const stages = [
  {
    id: "phase_1",
    completionUnlockId: "phase_1_complete",
    prerequisiteIds: [],
    deliveries: [{ itemId: "plate", amount: 1, medium: "solid", portId: "manual_in", commitPolicy: "solid_lock_complete" }],
    rewards: {
      resourceIds: [],
      itemIds: ["advanced_part"],
      recipeIds: [],
      buildingIds: ["boost_generator", "accumulator"],
      constructionCredits: { starter_machine: 2 },
    },
    dockPowerMode: "manual",
  },
  {
    id: "phase_2",
    prerequisiteIds: ["phase_1"],
    deliveries: [{ itemId: "advanced_part", amount: 1, medium: "solid", portId: "powered_in", commitPolicy: "solid_lock_complete" }],
    rewards: { resourceIds: [], itemIds: [], recipeIds: [], buildingIds: [] },
    dockPowerMode: "powered",
    requiredPowerMW: 32,
  },
] as const satisfies readonly ProjectStageDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(items.map((item) => [item.id, item])),
  recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(stages.map((stage) => [stage.id, stage])),
};

const createRuntime = () => new CampaignWorldRuntime({
  registry,
  bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
  constructionInventory: [{ itemId: "plate", amount: 4 }],
});

test("project completion applies world unlocks, item unlocks, and construction credits exactly once", () => {
  const runtime = createRuntime();
  assert.equal(runtime.world.place({ buildingId: "boost_generator", position: { x: 4, z: 0 }, rotation: 0 }).reason, "locked");
  assert.equal(runtime.isItemUnlocked("advanced_part"), false);

  const completed = runtime.deliverProject("phase_1", { portId: "manual_in", itemId: "plate", amount: 1 });
  assert.equal(completed.accepted, true);
  assert.equal(runtime.isItemUnlocked("advanced_part"), true);
  assert.equal(runtime.constructionCreditAmount("starter_machine"), 2);
  assert.equal(runtime.world.place({ buildingId: "boost_generator", position: { x: 4, z: 0 }, rotation: 0 }).ok, true);

  const repeated = runtime.deliverProject("phase_1", { portId: "manual_in", itemId: "plate", amount: 1 });
  assert.equal(repeated.accepted, false);
  assert.equal(runtime.constructionCreditAmount("starter_machine"), 2);
  assert.equal(runtime.spendConstructionCredit("starter_machine", 1), true);
  assert.equal(runtime.constructionCreditAmount("starter_machine"), 1);
});

test("world generators, consumers, and batteries synchronize into the advanced grid", () => {
  const runtime = createRuntime();
  runtime.deliverProject("phase_1", { portId: "manual_in", itemId: "plate", amount: 1 });
  const generator = runtime.world.place({ buildingId: "boost_generator", position: { x: 4, z: 0 }, rotation: 0 });
  const battery = runtime.world.place({ buildingId: "accumulator", position: { x: 5, z: 0 }, rotation: 0 });
  assert.equal(generator.ok, true);
  assert.equal(battery.ok, true);
  if (!generator.ok || !battery.ok) return;

  const power = runtime.stepPower(60, { [battery.instance.id]: { storedMWh: 1 } });
  assert.deepEqual(power.generators.map(({ id }) => id), [generator.instance.id, "preplaced:field_power_core"]);
  assert.equal(power.consumers.find(({ id }) => id === "preplaced:project_dock")?.requestedMW, 32);
  assert.equal(power.batteries[0].id, battery.instance.id);
  assert.equal(power.batteryChargeMW, 12);
  assert.equal(power.batteries[0].storedMWh, 1.2);
  assert.equal(power.satisfaction, 1);

  const delivered = runtime.deliverProject("phase_2", {
    portId: "powered_in",
    itemId: "advanced_part",
    amount: 1,
  });
  assert.equal(delivered.accepted, true, "the powered dock should receive its actual served 32 MW");
});

test("a powered project remains gated when synchronized dock supply is below 32 MW", () => {
  const runtime = createRuntime();
  runtime.deliverProject("phase_1", { portId: "manual_in", itemId: "plate", amount: 1 });
  const power = runtime.stepPower(1);
  assert.equal(power.dispatchableMW, 24);
  assert.equal(power.consumers.find(({ id }) => id === "preplaced:project_dock")?.servedMW, 24);
  const result = runtime.deliverProject("phase_2", { portId: "powered_in", itemId: "advanced_part", amount: 1 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "power_insufficient");
});

test("combined snapshot restores world, campaign rewards, credits, and power continuation", () => {
  const original = createRuntime();
  original.deliverProject("phase_1", { portId: "manual_in", itemId: "plate", amount: 1 });
  const generator = original.world.place({ buildingId: "boost_generator", position: { x: 4, z: 0 }, rotation: 0 });
  const battery = original.world.place({ buildingId: "accumulator", position: { x: 5, z: 0 }, rotation: 0 });
  assert.equal(generator.ok, true);
  assert.equal(battery.ok, true);
  if (!battery.ok) return;
  original.stepPower(60, { [battery.instance.id]: { storedMWh: 1 } });
  original.spendConstructionCredit("starter_machine", 1);

  const restored = new CampaignWorldRuntime({
    registry,
    bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 },
    snapshot: structuredClone(original.snapshot()),
  });
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.world.instance(generator.ok ? generator.instance.id : "" )?.definitionId, "boost_generator");
  assert.equal(restored.campaign.progress("phase_1")?.completed, true);
  assert.equal(restored.isItemUnlocked("advanced_part"), true);
  assert.equal(restored.constructionCreditAmount("starter_machine"), 1);
  assert.deepEqual(restored.stepPower(1), original.stepPower(1));
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
