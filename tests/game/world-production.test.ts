import assert from "node:assert/strict";
import test from "node:test";

import type { BuildingDefinition, DefinitionRegistry, ItemDefinition, RecipeDefinition } from "../../app/game/domain/types.ts";
import { DataDrivenWorld } from "../../app/game/sim/world.ts";
import { WorldProductionSimulation } from "../../app/game/sim/worldProduction.ts";

const items = [
  ["ore", "solid", "item"], ["coolant", "fluid", "m3"], ["product", "solid", "item"], ["slag", "solid", "item"],
].map(([id, medium, unit]) => ({
  id, name: id, category: medium === "fluid" ? "fluid" : "material", medium, unit,
  unlockId: "start", defaultColor: "#777", geometryType: medium === "fluid" ? "fluid" : "component",
  stackSize: 20, modelKey: id,
})) as readonly ItemDefinition[];

const port = (
  id: string, direction: "input" | "output", medium: "solid" | "fluid", x: number, z: number, acceptedItemIds: string[],
) => ({
  id, direction, medium, connectorProfile: medium === "solid" ? "belt_standard" as const : "pipe_mk1" as const,
  connectionCell: { x, z }, localPosition: { x, y: 0.5, z }, localFacing: { x: Math.sign(x), z: Math.sign(z) },
  bufferSlots: 1, acceptedItemIds,
});

const buildings = [
  { id: "ore_source", ports: [port("out", "output", "solid", 1, 0, ["ore"])], recipeIds: ["mine_ore"] },
  { id: "fluid_source", ports: [port("out", "output", "fluid", 0, 1, ["coolant"])], recipeIds: ["pump_coolant"] },
  { id: "processor", ports: [
    port("ore_in", "input", "solid", -1, 0, ["ore"]), port("fluid_in", "input", "fluid", 0, -1, ["coolant"]),
    port("product_out", "output", "solid", 1, 0, ["product"]), port("slag_out", "output", "solid", 0, 1, ["slag"]),
  ], recipeIds: ["process_material"] },
  { id: "product_sink", ports: [port("in", "input", "solid", -1, 0, ["product"])], recipeIds: [] },
  { id: "slag_sink", ports: [port("in", "input", "solid", 0, -1, ["slag"])], recipeIds: [] },
].map(({ id, ports, recipeIds }) => ({
  id, name: id, unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
  ports, recipeIds, buildCost: [{ itemId: "product", amount: 1 }],
})) as readonly BuildingDefinition[];

const recipes = [
  { id: "mine_ore", buildingId: "ore_source", inputs: [], outputs: [{ itemId: "ore", amount: 2, portId: "out", role: "primary" }], durationSeconds: 0.1 },
  { id: "pump_coolant", buildingId: "fluid_source", inputs: [], outputs: [{ itemId: "coolant", amount: 3, portId: "out", role: "primary" }], durationSeconds: 0.1 },
  { id: "process_material", buildingId: "processor", inputs: [{ itemId: "ore", amount: 2, portId: "ore_in" }, { itemId: "coolant", amount: 3, portId: "fluid_in" }], outputs: [{ itemId: "product", amount: 1, portId: "product_out", role: "primary" }, { itemId: "slag", amount: 2, portId: "slag_out", role: "byproduct" }], durationSeconds: 0.2 },
].map((recipe) => ({ ...recipe, name: recipe.id, unlockId: "start" })) as readonly RecipeDefinition[];

const registry: DefinitionRegistry = {
  items: new Map(items.map((item) => [item.id, item])), recipes: new Map(recipes.map((recipe) => [recipe.id, recipe])),
  buildings: new Map(buildings.map((building) => [building.id, building])), projectStages: new Map(),
};

const setup = () => {
  const world = new DataDrivenWorld({ registry, bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 6 }, constructionInventory: [{ itemId: "product", amount: 10 }] });
  const place = (buildingId: string, x: number, z: number) => {
    const result = world.place({ buildingId, position: { x, z }, rotation: 0 });
    assert.equal(result.ok, true); if (!result.ok) throw new Error("placement failed"); return result.instance.id;
  };
  return { world, ids: {
    ore: place("ore_source", 0, 2), fluid: place("fluid_source", 2, 0), processor: place("processor", 2, 2),
    product: place("product_sink", 4, 2), slag: place("slag_sink", 2, 4),
  } };
};

test("connectionCell, medium, and connector profile build the expected links", () => {
  const { world, ids } = setup(); const simulation = new WorldProductionSimulation(world);
  assert.deepEqual(simulation.connections().map((link) => [link.fromInstanceId, link.toInstanceId, link.medium]), [
    [ids.ore, ids.processor, "solid"], [ids.fluid, ids.processor, "fluid"],
    [ids.processor, ids.product, "solid"], [ids.processor, ids.slag, "solid"],
  ]);
});

test("multi-input processing preserves primary and byproduct outputs across solid and fluid ports", () => {
  const { world, ids } = setup(); const simulation = new WorldProductionSimulation(world);
  simulation.advance(1);
  assert.ok(simulation.inventory(ids.product, "in", "input").amount > 0);
  assert.ok(simulation.inventory(ids.slag, "in", "input").amount > 0);
  assert.ok((simulation.machine(ids.processor)?.completedCycles ?? 0) > 0);
});

test("all outputs are preflighted so a blocked byproduct preserves inputs and WIP", () => {
  const { world, ids } = setup(); const simulation = new WorldProductionSimulation(world);
  assert.equal(simulation.deposit(ids.processor, "slag_out", "output", "slag", 20), true);
  assert.equal(simulation.deposit(ids.slag, "in", "input", "slag", 20), true);
  simulation.advance(0.5);
  assert.equal(simulation.machine(ids.processor)?.runtimeState, "blocked");
  assert.equal(simulation.machine(ids.processor)?.workInProgress, null);
  assert.ok(simulation.inventory(ids.processor, "ore_in", "input").amount >= 2);
  assert.ok(simulation.inventory(ids.processor, "fluid_in", "input").amount >= 3);
  assert.equal(simulation.withdraw(ids.processor, "slag_out", "output", "slag", 20), true);
  simulation.advance(0.5);
  assert.ok((simulation.machine(ids.processor)?.completedCycles ?? 0) > 0);
});

test("power satisfaction scales fixed-tick progress and snapshots restore deterministically", () => {
  const { world, ids } = setup(); const simulation = new WorldProductionSimulation(world);
  simulation.setPowerSatisfaction(ids.processor, 0);
  simulation.advance(0.4);
  assert.equal(simulation.machine(ids.processor)?.progress, 0);
  simulation.setPowerSatisfaction(ids.processor, 0.5);
  simulation.advance(0.2);
  assert.ok((simulation.machine(ids.processor)?.progress ?? 0) > 0);
  const snapshot = structuredClone(simulation.snapshot());
  const restored = new WorldProductionSimulation(world, snapshot);
  assert.deepEqual(restored.snapshot(), simulation.snapshot());
  restored.advance(0.25); simulation.advance(0.25);
  assert.deepEqual(restored.snapshot(), simulation.snapshot());
});

test("demolition returns live buffers and WIP through the world recovery contract", () => {
  const { world, ids } = setup(); const simulation = new WorldProductionSimulation(world);
  simulation.setPowerSatisfaction(ids.processor, 0.5);
  simulation.advance(0.25);
  const before = simulation.machine(ids.processor);
  assert.ok(before?.workInProgress);
  const demolition = simulation.demolish(ids.processor);
  assert.equal(demolition.ok, true);
  if (!demolition.ok) return;
  const recovered = new Map(demolition.recoveredItems.map(({ itemId, amount }) => [itemId, amount]));
  assert.ok((recovered.get("ore") ?? 0) > 0);
  assert.ok((recovered.get("coolant") ?? 0) > 0);
  assert.equal(simulation.machine(ids.processor), null);
});

const chainRegistry = (medium: "solid" | "fluid", includeStorage = false): DefinitionRegistry => {
  const itemId = medium === "solid" ? "ore" : "coolant";
  const profile = medium === "solid" ? "belt_standard" as const : "pipe_mk1" as const;
  const chainPort = (id: string, direction: "input" | "output", x: number) => ({
    id, direction, medium, connectorProfile: profile,
    connectionCell: { x, z: 0 }, localPosition: { x, y: 0.5, z: 0 }, localFacing: { x: Math.sign(x), z: 0 },
    bufferSlots: 1, acceptedItemIds: [itemId],
  });
  const make = (id: string, ports: ReturnType<typeof chainPort>[], extras: Partial<BuildingDefinition> = {}): BuildingDefinition => ({
    id, name: id, unlockId: "start", placementMode: "buildable", footprint: { x: 1, z: 1 }, allowedRotations: [0],
    ports, recipeIds: [], buildCost: [{ itemId, amount: 1 }], ...extras,
  });
  const chainBuildings = [
    make("source", [chainPort("out", "output", 1)]),
    make("segment", [chainPort("in", "input", -1), chainPort("out", "output", 1)], { transportPolicy: { throughputPerMinute: 120 } }),
    make("sink", [chainPort("in", "input", -1)]),
    ...(includeStorage ? [make("storage", [chainPort("in", "input", -1), chainPort("out", "output", 1)], {
      storagePolicy: { slotCount: 2, lockToSingleItem: true, supportsInputFilter: true, supportsOutputFilter: true, defaultRoutingPolicy: "pass_through" },
    })] : []),
  ];
  const item = items.find(({ id }) => id === itemId)!;
  return { items: new Map([[item.id, item]]), recipes: new Map(), buildings: new Map(chainBuildings.map((building) => [building.id, building])), projectStages: new Map() };
};

const runChain = (medium: "solid" | "fluid", includeStorage = false) => {
  const chain = chainRegistry(medium, includeStorage);
  const world = new DataDrivenWorld({
    registry: chain, bounds: { minX: 0, maxX: 14, minZ: 0, maxZ: 1 },
    constructionInventory: [{ itemId: medium === "solid" ? "ore" : "coolant", amount: 20 }],
  });
  const place = (buildingId: string, x: number) => {
    const result = world.place({ buildingId, position: { x, z: 0 }, rotation: 0 });
    assert.equal(result.ok, true); if (!result.ok) throw new Error("chain placement failed"); return result.instance.id;
  };
  const source = place("source", 0);
  place("segment", 2); place("segment", 4); place("segment", 6);
  if (includeStorage) { place("storage", 8); place("segment", 10); }
  const sink = place("sink", includeStorage ? 12 : 8);
  const simulation = new WorldProductionSimulation(world);
  const itemId = medium === "solid" ? "ore" : "coolant";
  assert.equal(simulation.deposit(source, "out", "output", itemId, 4), true);
  simulation.advance(8);
  return { simulation, sink, itemId };
};

test("three consecutive conveyors use fixed-tick throughput credit", () => {
  const { simulation, sink, itemId } = runChain("solid");
  assert.equal(simulation.inventory(sink, "in", "input").itemId, itemId);
  assert.equal(simulation.inventory(sink, "in", "input").amount, 4);
});

test("three consecutive pipes carry fluid quantities through internal transport", () => {
  const { simulation, sink, itemId } = runChain("fluid");
  assert.equal(simulation.inventory(sink, "in", "input").itemId, itemId);
  assert.equal(simulation.inventory(sink, "in", "input").amount, 4);
});

test("pass-through storage forwards items between a conveyor chain", () => {
  const { simulation, sink } = runChain("solid", true);
  assert.equal(simulation.inventory(sink, "in", "input").amount, 4);
});

test("ports sharing a cell do not connect unless their facings oppose", () => {
  const chain = chainRegistry("solid");
  const sink = chain.buildings.get("sink")!;
  const wrongFacing: BuildingDefinition = {
    ...sink, id: "wrong_sink",
    ports: sink.ports.map((candidate) => ({ ...candidate, localFacing: { x: 1, z: 0 } })),
  };
  const registryWithWrongFacing: DefinitionRegistry = { ...chain, buildings: new Map([...chain.buildings, [wrongFacing.id, wrongFacing]]) };
  const world = new DataDrivenWorld({ registry: registryWithWrongFacing, bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 1 }, constructionInventory: [{ itemId: "ore", amount: 4 }] });
  const source = world.place({ buildingId: "source", position: { x: 0, z: 0 }, rotation: 0 });
  const target = world.place({ buildingId: "wrong_sink", position: { x: 2, z: 0 }, rotation: 0 });
  assert.equal(source.ok && target.ok, true);
  assert.deepEqual(new WorldProductionSimulation(world).connections(), []);
});
