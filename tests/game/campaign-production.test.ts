import assert from "node:assert/strict";
import test from "node:test";

import type { BuildingDefinition, DefinitionRegistry, ItemDefinition, ProjectStageDefinition, RecipeDefinition } from "../../app/game/domain/types.ts";
import { CampaignProductionRuntime } from "../../app/game/sim/campaignProduction.ts";

const items = [
  ["crude_oil", "fluid", "m3"], ["fuel_gas", "fluid", "m3"], ["polymer_resin", "solid", "item"],
].map(([id, medium, unit]) => ({
  id, name: id, category: medium === "fluid" ? "fluid" : "material", medium, unit,
  unlockId: "start", defaultColor: "#777", geometryType: medium === "fluid" ? "fluid" : "resin_pellet",
  stackSize: 100, modelKey: id,
})) as readonly ItemDefinition[];

const port = (id: string, direction: "input" | "output", medium: "solid" | "fluid" | "power", x: number, acceptedItemIds: string[]) => ({
  id, direction, medium,
  connectorProfile: medium === "solid" ? "belt_standard" as const : medium === "fluid" ? "pipe_mk1" as const : "power_local" as const,
  connectionCell: { x, z: 0 }, localPosition: { x, y: 0.5, z: 0 }, localFacing: { x: Math.sign(x), z: 0 },
  bufferSlots: medium === "power" ? 0 : 1, acceptedItemIds,
});

const preplaced = (id: string, x: number, extras: Partial<BuildingDefinition>): BuildingDefinition => ({
  id, name: id, unlockId: "start", placementMode: "preplaced_unique", footprint: { x: 1, z: 1 }, allowedRotations: [0],
  ports: [], recipeIds: [], buildCost: [], preplacedPolicy: { worldAnchor: { x, z: 0 }, fixedRotation: 0, canBuild: false, canClone: false, canDemolish: false }, ...extras,
});

const buildings = [
  preplaced("field_power_core", 0, { generatorPolicy: { capacityMW: 32, minimumLoadRatio: 0, dispatchPriority: 1 } }),
  preplaced("project_dock", 18, { activeMW: 32, idleMW: 2, ports: [port("fluid_in", "input", "fluid", -1, ["fuel_gas"]), port("power_in", "input", "power", 1, [])] }),
  { id: "extractor", ports: [port("oil_out", "output", "fluid", 1, ["crude_oil"])], recipeIds: ["extract_oil"] },
  { id: "refinery", ports: [port("oil_in", "input", "fluid", -1, ["crude_oil"]), port("gas_out", "output", "fluid", 1, ["fuel_gas"]), { ...port("resin_out", "output", "solid", 0, ["polymer_resin"]), connectionCell: { x: 0, z: 1 }, localFacing: { x: 0, z: 1 } }], recipeIds: ["refine_oil"] },
  { id: "pipe", ports: [port("in", "input", "fluid", -1, ["crude_oil", "fuel_gas"]), port("out", "output", "fluid", 1, ["crude_oil", "fuel_gas"])], recipeIds: [], transportPolicy: { throughputPerMinute: 120 } },
  { id: "resin_sink", ports: [{ ...port("in", "input", "solid", 0, ["polymer_resin"]), connectionCell: { x: 0, z: -1 }, localFacing: { x: 0, z: -1 } }], recipeIds: [] },
].map((definition) => "placementMode" in definition ? definition : ({
  ...definition, name: definition.id, unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0], buildCost: [{ itemId: "polymer_resin", amount: 1 }],
})) as readonly BuildingDefinition[];

const recipes = [
  { id: "extract_oil", buildingId: "extractor", inputs: [], outputs: [{ itemId: "crude_oil", amount: 3, portId: "oil_out", role: "primary" }], durationSeconds: 0.1 },
  { id: "refine_oil", buildingId: "refinery", inputs: [{ itemId: "crude_oil", amount: 3, portId: "oil_in" }], outputs: [{ itemId: "polymer_resin", amount: 1, portId: "resin_out", role: "primary" }, { itemId: "fuel_gas", amount: 2, portId: "gas_out", role: "byproduct" }], durationSeconds: 0.1 },
].map((recipe) => ({ ...recipe, name: recipe.id, unlockId: "start" })) as readonly RecipeDefinition[];

const stages = [{
  id: "chemistry", prerequisiteIds: [],
  deliveries: [{ itemId: "fuel_gas", amount: 12, medium: "fluid", portId: "fluid_in", commitPolicy: "fluid_accepted_per_tick" }],
  rewards: { resourceIds: [], itemIds: [], recipeIds: [], buildingIds: [] }, dockPowerMode: "powered", requiredPowerMW: 32,
}] as const satisfies readonly ProjectStageDefinition[];

const registry = (capacityMW = 32): DefinitionRegistry => {
  const definitions = buildings.map((building) => building.id === "field_power_core"
    ? { ...building, generatorPolicy: { ...building.generatorPolicy!, capacityMW } }
    : building);
  return {
    items: new Map(items.map((item) => [item.id, item])), recipes: new Map(recipes.map((recipe) => [recipe.id, recipe])),
    buildings: new Map(definitions.map((building) => [building.id, building])), projectStages: new Map(stages.map((stage) => [stage.id, stage])),
  };
};

const create = (capacityMW = 32) => {
  const runtime = new CampaignProductionRuntime({
    registry: registry(capacityMW), bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 3 },
    constructionInventory: [{ itemId: "polymer_resin", amount: 20 }], dockFluidThroughputM3PerMinute: 60,
  });
  const place = (buildingId: string, x: number, z = 0) => {
    const result = runtime.campaignWorld.world.place({ buildingId, position: { x, z }, rotation: 0 });
    assert.equal(result.ok, true); if (!result.ok) throw new Error("placement failed"); return result.instance.id;
  };
  const extractor = place("extractor", 2); place("pipe", 4); place("pipe", 6); const refinery = place("refinery", 8);
  const resinSink = place("resin_sink", 8, 2); place("pipe", 10); place("pipe", 12); place("pipe", 14); place("pipe", 16);
  runtime.production.syncWorld();
  return { runtime, extractor, refinery, resinSink };
};

test("refinery byproduct traverses a multi-pipe chain and commits into the powered dock per tick", () => {
  const { runtime } = create();
  runtime.advance(15);
  const progress = runtime.campaignWorld.campaign.progress("chemistry")!;
  assert.equal(progress.completed, true);
  assert.equal(progress.deliveries[0].delivered, 12);
  const dock = runtime.campaignWorld.world.instance("preplaced:project_dock")!;
  assert.equal(runtime.production.inventory(dock.id, "fluid_in", "input").amount >= 0, true);
});

test("blocked primary resin output prevents the gas byproduct cycle from starting", () => {
  const { runtime, refinery, resinSink } = create();
  assert.equal(runtime.production.deposit(refinery, "resin_out", "output", "polymer_resin", 100), true);
  assert.equal(runtime.production.deposit(resinSink, "in", "input", "polymer_resin", 100), true);
  runtime.advance(3);
  assert.equal(runtime.production.machine(refinery)?.runtimeState, "blocked");
  assert.equal(runtime.campaignWorld.campaign.progress("chemistry")?.deliveries[0].delivered, 0);
  assert.equal(runtime.production.withdraw(refinery, "resin_out", "output", "polymer_resin", 100), true);
  assert.equal(runtime.production.withdraw(resinSink, "in", "input", "polymer_resin", 100), true);
  runtime.advance(12);
  assert.ok((runtime.campaignWorld.campaign.progress("chemistry")?.deliveries[0].delivered ?? 0) > 0);
});

test("underpowered dock preserves received fluid without committing campaign progress", () => {
  const { runtime } = create(24);
  runtime.advance(10);
  const dock = runtime.campaignWorld.world.instance("preplaced:project_dock")!;
  assert.ok(runtime.production.inventory(dock.id, "fluid_in", "input").amount > 0);
  assert.equal(runtime.campaignWorld.campaign.progress("chemistry")?.deliveries[0].delivered, 0);
});

test("snapshot restore preserves pipe buffers, byproducts, dock fluid, commit credit, power, and campaign progress", () => {
  const { runtime } = create();
  runtime.advance(6);
  const snapshot = structuredClone(runtime.snapshot());
  const restored = new CampaignProductionRuntime({
    registry: runtime.campaignWorld.registry, bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 3 }, snapshot,
  });
  assert.deepEqual(restored.snapshot(), runtime.snapshot());
  restored.advance(2); runtime.advance(2);
  assert.deepEqual(restored.snapshot(), runtime.snapshot());
});
