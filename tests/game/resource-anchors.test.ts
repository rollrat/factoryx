import assert from "node:assert/strict";
import test from "node:test";

import { RESOURCE_ANCHORS, getResourceAnchorAt } from "../../app/game/data/resourceAnchors.ts";
import type { BuildingDefinition, DefinitionRegistry, ItemDefinition, RecipeDefinition } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";
import { START_REGISTRY } from "../../app/game/data/index.ts";

const itemIds = ["iron_ore", "copper_ore", "limestone", "coal", "quartz", "crude_oil", "bauxite", "tungsten_ore"] as const;
const items = itemIds.map((id) => ({
  id, name: id, category: id === "crude_oil" ? "fluid" : "resource", medium: id === "crude_oil" ? "fluid" : "solid",
  unit: id === "crude_oil" ? "m3" : "item", unlockId: RESOURCE_ANCHORS.find((anchor) => anchor.itemId === id)!.unlockId,
  defaultColor: "#777", geometryType: id === "crude_oil" ? "fluid" : "ore_chunk", stackSize: 100, modelKey: id,
})) as readonly ItemDefinition[];

const extractionRecipes = RESOURCE_ANCHORS.map((anchor) => ({
  id: anchor.recipeId, name: anchor.recipeId, buildingId: anchor.extractionBuildingId, inputs: [],
  outputs: [{ itemId: anchor.itemId, amount: anchor.medium === "fluid" ? 3 : 2, portId: anchor.medium === "fluid" ? "fluid_out" : "solid_out", role: "primary" }],
  durationSeconds: 0.1, unlockId: anchor.unlockId,
})) as readonly RecipeDefinition[];

const outputPort = (medium: "solid" | "fluid") => ({
  id: medium === "solid" ? "solid_out" : "fluid_out", direction: "output" as const, medium,
  connectorProfile: medium === "solid" ? "belt_standard" as const : "pipe_mk1" as const,
  connectionCell: { x: 1, z: 0 }, localPosition: { x: 1, y: 0.5, z: 0 }, localFacing: { x: 1, z: 0 },
  bufferSlots: 1, acceptedItemIds: RESOURCE_ANCHORS.filter((anchor) => anchor.medium === medium).map((anchor) => anchor.itemId),
});
const inputPort = (medium: "solid" | "fluid") => ({
  id: "in", direction: "input" as const, medium,
  connectorProfile: medium === "solid" ? "belt_standard" as const : "pipe_mk1" as const,
  connectionCell: { x: -1, z: 0 }, localPosition: { x: -1, y: 0.5, z: 0 }, localFacing: { x: -1, z: 0 },
  bufferSlots: 2, acceptedItemIds: RESOURCE_ANCHORS.filter((anchor) => anchor.medium === medium).map((anchor) => anchor.itemId),
});
const build = (id: string, unlockId: BuildingDefinition["unlockId"], ports: BuildingDefinition["ports"], recipeIds: readonly string[]): BuildingDefinition => ({
  id, name: id, unlockId, placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0], ports, recipeIds,
  buildCost: [{ itemId: "iron_ore", amount: 1 }],
});
const buildings = [
  build("vein_miner", "start", [outputPort("solid")], extractionRecipes.filter(({ buildingId }) => buildingId === "vein_miner").map(({ id }) => id)),
  build("fluid_extractor", "phase_3_complete", [outputPort("fluid")], ["extract_crude_oil"]),
  build("solid_sink", "start", [inputPort("solid")], []),
  build("fluid_sink", "start", [inputPort("fluid")], []),
];
const registry: DefinitionRegistry = {
  items: new Map(items.map((item) => [item.id, item])), recipes: new Map(extractionRecipes.map((recipe) => [recipe.id, recipe])),
  buildings: new Map(buildings.map((building) => [building.id, building])), projectStages: new Map(),
};
const createWorld = () => new DataDrivenWorld({
  registry, bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 }, constructionInventory: [{ itemId: "iron_ore", amount: 100 }],
});

test("all eight document resources expose stable anchors for world and visual lookup", () => {
  assert.deepEqual(RESOURCE_ANCHORS.map(({ itemId }) => itemId), itemIds);
  assert.equal(new Set(RESOURCE_ANCHORS.map(({ position }) => `${position.x},${position.z}`)).size, 8);
  RESOURCE_ANCHORS.forEach((anchor) => assert.equal(getResourceAnchorAt(anchor.position)?.id, anchor.id));
});

test("every shipped anchor can fit its full-size extraction building inside the playable map", () => {
  for (const anchor of RESOURCE_ANCHORS) {
    const world = new DataDrivenWorld({ registry: START_REGISTRY, bounds: { minX: -128, maxX: 127, minZ: -128, maxZ: 127 } });
    (["phase_1_complete", "phase_2_complete", "phase_3_complete", "chemistry_stable", "thermal_verified"] as const)
      .forEach((unlockId) => world.unlock(unlockId));
    const definition = START_REGISTRY.buildings.get(anchor.extractionBuildingId)!;
    world.grantItems(definition.buildCost);
    const placed = world.place({ buildingId: anchor.extractionBuildingId, position: anchor.position, rotation: 0 });
    assert.equal(placed.ok, true, `${anchor.itemId} extractor must fit its authored anchor`);
  }
});

test("locked anchors reject extraction, then activate with their milestone", () => {
  const world = createWorld();
  const coal = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "coal")!;
  assert.deepEqual(world.place({ buildingId: "vein_miner", position: coal.position, rotation: 0 }), {
    ok: false, reason: "resource_locked", itemId: "coal",
  });
  assert.equal(world.resourceAnchorAt(coal.position)?.active, false);
  world.unlock("phase_1_complete");
  assert.equal(world.resourceAnchorAt(coal.position)?.active, true);
  assert.equal(world.place({ buildingId: "vein_miner", position: coal.position, rotation: 0 }).ok, true);
});

test("extraction buildings reject empty ground and the wrong anchor medium", () => {
  const world = createWorld();
  assert.equal(world.place({ buildingId: "vein_miner", position: { x: 0, z: 5 }, rotation: 0 }).reason, "invalid_resource_anchor");
  world.unlock("phase_3_complete");
  const oil = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "crude_oil")!;
  assert.equal(world.place({ buildingId: "vein_miner", position: oil.position, rotation: 0 }).reason, "invalid_resource_anchor");
  assert.equal(world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0 }).ok, true);
});

test("anchor position automatically selects the matching recipe and produces its resource", () => {
  const world = createWorld();
  const iron = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "iron_ore")!;
  const miner = world.place({ buildingId: "vein_miner", position: iron.position, rotation: 0 });
  const sink = world.place({ buildingId: "solid_sink", position: { x: iron.position.x + 2, z: iron.position.z }, rotation: 0 });
  assert.equal(miner.ok && sink.ok, true);
  if (!miner.ok || !sink.ok) return;
  assert.equal(miner.instance.selectedRecipeId, "mine_iron_ore");
  const simulation = new WorldProductionSimulation(world);
  assert.equal(simulation.machine(miner.instance.id)?.recipeId, "mine_iron_ore");
  assert.equal(simulation.selectRecipe(miner.instance.id, "mine_coal"), false);
  simulation.advance(0.5);
  assert.equal(simulation.inventory(sink.instance.id, "in", "input").itemId, "iron_ore");
});

test("world and production snapshot restore preserve anchor recipe deterministically", () => {
  const world = createWorld();
  world.unlock("phase_3_complete");
  const oil = RESOURCE_ANCHORS.find(({ itemId }) => itemId === "crude_oil")!;
  const extractor = world.place({ buildingId: "fluid_extractor", position: oil.position, rotation: 0 });
  const sink = world.place({ buildingId: "fluid_sink", position: { x: oil.position.x + 2, z: oil.position.z }, rotation: 0 });
  assert.equal(extractor.ok && sink.ok, true);
  if (!extractor.ok) return;
  const production = new WorldProductionSimulation(world);
  production.advance(0.25);
  const worldSnapshot = structuredClone(world.snapshot());
  const productionSnapshot = structuredClone(production.snapshot());
  const restoredWorld = new DataDrivenWorld({ registry, bounds: worldSnapshot.bounds, snapshot: worldSnapshot });
  const restored = new WorldProductionSimulation(restoredWorld, productionSnapshot);
  assert.equal(restored.machine(extractor.instance.id)?.recipeId, "extract_crude_oil");
  restored.advance(0.25); production.advance(0.25);
  assert.deepEqual(restored.snapshot(), production.snapshot());
});
