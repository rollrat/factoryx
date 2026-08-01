import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildingDefinition,
  DefinitionRegistry,
  ItemDefinition,
  ProjectStageDefinition,
} from "../../app/game/domain/types.ts";
import { CampaignProductionRuntime } from "../../app/game/sim/campaignProduction.ts";
import { ProjectDockDeliveryCommitter } from "../../app/game/sim/projectDockCommitter.ts";

const items = ["plate", "block", "wrong", "powered_part"].map((id) => ({
  id, name: id, category: "material", medium: "solid", unit: "item", unlockId: "start",
  defaultColor: "#888", geometryType: "component", stackSize: 100, modelKey: id,
})).concat([{
  id: "coolant", name: "coolant", category: "fluid", medium: "fluid", unit: "m3", unlockId: "start",
  defaultColor: "#48a", geometryType: "fluid", stackSize: 100, modelKey: "coolant",
}]) as readonly ItemDefinition[];

const dockPort = (
  id: string,
  medium: "solid" | "fluid" | "power",
  acceptedItemIds: string[],
) => ({
  id, direction: "input" as const, medium,
  connectorProfile: medium === "solid" ? "belt_standard" as const : medium === "fluid" ? "pipe_mk1" as const : "power_local" as const,
  connectionCell: { x: -1, z: 0 }, localPosition: { x: -1, y: 0.5, z: 0 }, localFacing: { x: -1, z: 0 },
  bufferSlots: medium === "power" ? 0 : 1, acceptedItemIds,
});

const preplaced = (
  id: string,
  x: number,
  extras: Partial<BuildingDefinition>,
): BuildingDefinition => ({
  id, name: id, unlockId: "start", placementMode: "preplaced_unique", footprint: { x: 1, z: 1 },
  allowedRotations: [0], ports: [], recipeIds: [], buildCost: [],
  preplacedPolicy: { worldAnchor: { x, z: 0 }, fixedRotation: 0, canBuild: false, canClone: false, canDemolish: false },
  ...extras,
});

const buildings = [
  preplaced("field_power_core", 0, { generatorPolicy: { capacityMW: 32, minimumLoadRatio: 0, dispatchPriority: 1 } }),
  preplaced("project_dock", 5, {
    activeMW: 32,
    idleMW: 2,
    ports: [
      dockPort("solid_a", "solid", ["plate", "powered_part"]),
      dockPort("solid_b", "solid", ["block", "wrong"]),
      dockPort("fluid_in", "fluid", ["coolant"]),
      dockPort("power_in", "power", []),
    ],
  }),
] as const satisfies readonly BuildingDefinition[];

const stages = [
  {
    id: "manual_stage", completionUnlockId: "phase_1_complete", prerequisiteIds: [],
    deliveries: [
      { itemId: "plate", amount: 4, medium: "solid", portId: "solid_a", commitPolicy: "solid_lock_complete" },
      { itemId: "block", amount: 2, medium: "solid", portId: "solid_b", commitPolicy: "solid_lock_complete" },
    ],
    rewards: { resourceIds: [], itemIds: [], recipeIds: [], buildingIds: [] }, dockPowerMode: "manual",
  },
  {
    id: "powered_stage", prerequisiteIds: ["manual_stage"],
    deliveries: [
      { itemId: "powered_part", amount: 3, medium: "solid", portId: "solid_a", commitPolicy: "solid_lock_complete" },
      { itemId: "coolant", amount: 3, medium: "fluid", portId: "fluid_in", commitPolicy: "fluid_accepted_per_tick" },
    ],
    rewards: { resourceIds: [], itemIds: [], recipeIds: [], buildingIds: [] },
    dockPowerMode: "powered", requiredPowerMW: 32,
  },
] as const satisfies readonly ProjectStageDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(items.map((item) => [item.id, item])),
  recipes: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  projectStages: new Map(stages.map((stage) => [stage.id, stage])),
};

const create = (snapshot?: ReturnType<CampaignProductionRuntime["snapshot"]>) => new CampaignProductionRuntime({
  registry,
  bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 2 },
  dockFluidThroughputM3PerMinute: 60,
  snapshot,
});

test("manual solid lanes lock partial loads and commit only when each requirement is complete", () => {
  const runtime = create();
  const dockId = "preplaced:project_dock";
  assert.equal(runtime.production.deposit(dockId, "solid_a", "input", "plate", 2), true);
  runtime.advance(0.1);
  assert.equal(runtime.campaignWorld.campaign.progress("manual_stage")?.deliveries[0].delivered, 0);
  assert.equal(runtime.production.inventory(dockId, "solid_a", "input").amount, 2);

  assert.equal(runtime.production.deposit(dockId, "solid_a", "input", "plate", 2), true);
  runtime.advance(0.05);
  assert.equal(runtime.campaignWorld.campaign.progress("manual_stage")?.deliveries[0].delivered, 4);
  assert.equal(runtime.production.inventory(dockId, "solid_a", "input").amount, 0);

  assert.equal(runtime.production.deposit(dockId, "solid_b", "input", "wrong", 2), true);
  runtime.advance(0.1);
  assert.equal(runtime.campaignWorld.campaign.progress("manual_stage")?.deliveries[1].delivered, 0);
  assert.deepEqual(runtime.production.inventory(dockId, "solid_b", "input"), {
    portId: "solid_b", itemId: "wrong", amount: 2, capacity: 100,
  });
  assert.equal(runtime.production.withdraw(dockId, "solid_b", "input", "wrong", 2), true);
  assert.equal(runtime.production.deposit(dockId, "solid_b", "input", "block", 2), true);
  runtime.advance(0.05);
  assert.equal(runtime.campaignWorld.campaign.progress("manual_stage")?.completed, true);
  assert.equal(runtime.campaignWorld.campaign.isUnlocked("powered_stage"), true);
});

const completeManual = (runtime: CampaignProductionRuntime) => {
  const dockId = "preplaced:project_dock";
  runtime.production.deposit(dockId, "solid_a", "input", "plate", 4);
  runtime.production.deposit(dockId, "solid_b", "input", "block", 2);
  runtime.advance(0.05);
};

test("powered solid and fluid delivery preserves buffers below 32 MW, then advances partially", () => {
  const runtime = create();
  completeManual(runtime);
  const dockId = "preplaced:project_dock";
  runtime.production.deposit(dockId, "solid_a", "input", "powered_part", 3);
  runtime.production.deposit(dockId, "fluid_in", "input", "coolant", 3);

  runtime.advance(1, { "preplaced:field_power_core": { enabled: false } });
  assert.equal(runtime.campaignWorld.campaign.progress("powered_stage")?.deliveredTotal, 0);
  assert.equal(runtime.production.inventory(dockId, "solid_a", "input").amount, 3);
  assert.equal(runtime.production.inventory(dockId, "fluid_in", "input").amount, 3);

  runtime.advance(1);
  const progress = runtime.campaignWorld.campaign.progress("powered_stage")!;
  assert.equal(progress.deliveries[0].delivered, 3);
  assert.equal(progress.deliveries[1].delivered, 1);
  assert.equal(progress.completed, false);
  runtime.advance(2);
  assert.equal(runtime.campaignWorld.campaign.progress("powered_stage")?.completed, true);
});

test("committer snapshot restores per-port credit and deterministic stage continuation", () => {
  const runtime = create();
  completeManual(runtime);
  const dockId = "preplaced:project_dock";
  runtime.production.deposit(dockId, "solid_a", "input", "powered_part", 3);
  runtime.production.deposit(dockId, "fluid_in", "input", "coolant", 3);
  runtime.advance(0.55);
  const snapshot = structuredClone(runtime.snapshot());
  assert.ok(snapshot.dockCommitter);
  const restored = create(snapshot);
  assert.deepEqual(restored.snapshot(), runtime.snapshot());
  restored.advance(1.5);
  runtime.advance(1.5);
  assert.deepEqual(restored.snapshot(), runtime.snapshot());
});

test("a rejected campaign transaction rolls the withdrawn dock amount back", () => {
  const runtime = create();
  const dockId = "preplaced:project_dock";
  runtime.production.deposit(dockId, "solid_a", "input", "plate", 4);
  const original = runtime.campaignWorld.deliverProject.bind(runtime.campaignWorld);
  runtime.campaignWorld.deliverProject = (() => ({
    accepted: false as const,
    reason: "stage_locked" as const,
    portId: "solid_a",
  })) as typeof runtime.campaignWorld.deliverProject;
  const committer = new ProjectDockDeliveryCommitter(runtime.campaignWorld, runtime.production);
  const report = committer.advanceFixedTick(0.05);
  assert.equal(report.entries[0].status, "rollback");
  assert.equal(runtime.production.inventory(dockId, "solid_a", "input").amount, 4);
  assert.equal(runtime.campaignWorld.campaign.progress("manual_stage")?.deliveredTotal, 0);
  runtime.campaignWorld.deliverProject = original;
});
